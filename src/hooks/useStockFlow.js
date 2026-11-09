import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/authStore'
import { useAppStore } from '../stores/appStore'
import { scopeToBusinesses, allowedBusinessIds } from '../lib/businessScope'
import { allowedWarehouseIds, allowedWarehouseStates, pgList } from '../lib/inventoryAccess'
import { applyStock, weekStart } from '../lib/inventoryCore'
import { recordDamaged, orderLines } from '../lib/stockOps'

// ═══════════════════════════════════════════════════════════════════
// Goods in Transit · Damaged goods · stock badges · weekly stock take
// ═══════════════════════════════════════════════════════════════════

const isCeo = (u) => ['ceo', 'super_admin'].includes(u?.role)

function useFlowMutation(fn, successMsg) {
  const queryClient = useQueryClient()
  const { showToast } = useAppStore()
  const { user } = useAuthStore()
  return useMutation({
    mutationFn: (args) => fn(args, user),
    onSuccess: (res) => {
      for (const k of ['stock_in_transit', 'damaged_goods', 'inventory', 'inventory_movements',
        'holding_queue', 'stock_counts', 'stock_count', 'stock_availability', 'orders', 'order']) {
        queryClient.invalidateQueries({ queryKey: [k] })
      }
      if (res?.warning) showToast(res.warning, 'warning', 9000)
      else if (successMsg) showToast(successMsg, 'success')
    },
    onError: (err) => showToast(err.message, 'error', 6000),
  })
}

// ─── Goods in Transit ─────────────────────────────────────────────────

export const TRANSIT_STATUSES = {
  in_transit:   { label: 'In Transit',            color: 'bg-purple-50 text-purple-700' },
  delivered:    { label: 'Delivered',             color: 'bg-green-50 text-green-700' },
  at_warehouse: { label: 'Received at Warehouse', color: 'bg-blue-50 text-blue-700' },
  at_park:      { label: 'Moved to Goods at Park', color: 'bg-cyan-50 text-cyan-700' },
  damaged:      { label: 'Damaged',               color: 'bg-red-50 text-red-700' },
  missing:      { label: 'Missing',               color: 'bg-gray-100 text-gray-600' },
  returned:     { label: 'Returned by Customer',  color: 'bg-amber-50 text-amber-700' },
}

// null = table missing (migration not run)
export function useInTransit(includeClosed = false) {
  const { user } = useAuthStore()
  return useQuery({
    queryKey: ['stock_in_transit', includeClosed, user?.id],
    retry: false,
    queryFn: async () => {
      let q = supabase.from('stock_in_transit')
        .select('*, from_warehouse:warehouses!stock_in_transit_from_warehouse_id_fkey(name, state), order:orders(id, status, customer_name)')
        .order('created_at', { ascending: false })
        .limit(includeClosed ? 300 : 1000)
      if (!includeClosed) q = q.eq('status', 'in_transit')
      q = scopeToBusinesses(q, user)
      // Warehouse-limited staff: goods leaving or heading to their warehouses/states
      const whIds = allowedWarehouseIds(user)
      if (whIds) {
        const states = await allowedWarehouseStates(user)
        q = q.or([
          `from_warehouse_id.in.${pgList(whIds)}`,
          `destination_warehouse_id.in.${pgList(whIds)}`,
          ...(states.length ? [`destination_state.in.${pgList(states)}`] : []),
        ].join(','))
      }
      const { data, error } = await q
      if (error) return null
      return data || []
    },
    staleTime: 20000,
  })
}

// Claim an open transit row (two people can't settle it twice)
async function claimTransit(row, status, note, user, extra = {}) {
  const { data, error } = await supabase.from('stock_in_transit').update({
    status, closed_note: note || null, closed_at: new Date().toISOString(),
    closed_by_name: user?.name || null, updated_at: new Date().toISOString(), ...extra,
  }).eq('id', row.id).eq('status', 'in_transit').select('id')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error('This item was already settled by someone else')
}
async function reopenTransit(row) {
  await supabase.from('stock_in_transit').update({
    status: 'in_transit', closed_note: row.closed_note || null, closed_at: null, closed_by_name: null,
  }).eq('id', row.id)
}

// Settle an in-transit item by hand
// action: 'warehouse' { warehouse } | 'park' { park } | 'damaged' { reason } | 'delivered' { note }
export function useTransitAction() {
  return useFlowMutation(async ({ row, action, warehouse, park, reason, note }, user) => {
    if (action === 'warehouse') {
      if (!warehouse) throw new Error('Choose the warehouse')
      await claimTransit(row, 'at_warehouse', `Received at ${warehouse.name}${note ? ` · ${note}` : ''}`, user,
        { destination_warehouse_id: warehouse.id })
      if (row.product_id) {
        try {
          await applyStock({
            productId: row.product_id, warehouseId: warehouse.id, businessId: row.business_id,
            qty: row.quantity, color: row.color, size: row.size, type: 'transit_in', refId: row.order_id || row.id,
            refType: row.order_id ? 'order' : 'transit', staffId: user?.id,
            notes: `Goods in Transit received at ${warehouse.name}${row.order_number ? ` — ${row.order_number}` : ''}`,
          })
        } catch (e) {
          await reopenTransit(row)
          throw new Error(`Stock not updated — ${e.message}`)
        }
      }
      // An active order now ships from this warehouse
      if (row.order_id && row.order && !['paid', 'partially_paid', 'cancelled', 'returned', 'failed_delivery'].includes(row.order.status)) {
        await supabase.from('orders').update({ stock_source: 'warehouse', stock_warehouse_id: warehouse.id }).eq('id', row.order_id)
      }
      return null
    }
    if (action === 'park') {
      if (!park?.state) throw new Error('Enter the state of the park')
      await claimTransit(row, 'at_park', `Left at ${park.park_name || `${park.state} park`}`, user)
      const { data: hold, error } = await supabase.from('holding_queue').insert({
        product_id: row.product_id || null, product_name: row.product_name, quantity: row.quantity,
        state: park.state, city: park.city || null, park_name: park.park_name || null,
        park_location: park.park_location || null, contact_name: park.contact_name || null,
        contact_phone: park.contact_phone || null, contact_role: park.contact_role || null,
        custodian_id: user?.id || null, custodian_name: user?.name || null,
        source_order_id: row.order_id || null, source_order_number: row.order_number || null,
        business_id: row.business_id || null, status: 'holding',
      }).select('id').single()
      if (error) { await reopenTransit(row); throw new Error(error.message) }
      await supabase.from('holding_queue').update({ color: row.color || null, size: row.size || null }).eq('id', hold.id)
      await supabase.from('holding_history').insert({
        holding_id: hold.id, action: 'entered_queue',
        details: `From Goods in Transit${row.order_number ? ` (${row.order_number})` : ''} — left at ${park.park_name || `${park.state} park`}`,
        staff_id: user?.id || null, staff_name: user?.name || null,
      })
      return null
    }
    if (action === 'damaged') {
      await claimTransit(row, 'damaged', reason || 'Damaged in transit', user)
      try {
        await recordDamaged({
          product_id: row.product_id || null, product_name: row.product_name, quantity: row.quantity,
          color: row.color, size: row.size,
          business_id: row.business_id || null, source: 'in_transit', state: row.destination_state || null,
          order_id: row.order_id || null, order_number: row.order_number || null,
          reference_id: row.id, reason: reason || 'Damaged in transit',
        }, user)
      } catch (e) { await reopenTransit(row); throw e }
      return null
    }
    if (action === 'delivered') {
      await claimTransit(row, 'delivered', note || 'Delivered to customer', user)
      return null
    }
    throw new Error('Unknown action')
  }, 'Updated')
}

// ─── Damaged goods ────────────────────────────────────────────────────

export const DAMAGED_STATUSES = {
  damaged:         { label: 'Damaged',              color: 'bg-red-50 text-red-700' },
  repair:          { label: 'Awaiting Repair',      color: 'bg-amber-50 text-amber-700' },
  repaired:        { label: 'Repaired — Restocked', color: 'bg-green-50 text-green-700' },
  written_off:     { label: 'Written Off',          color: 'bg-gray-100 text-gray-600' },
  supplier_return: { label: 'Returned to Supplier', color: 'bg-indigo-50 text-indigo-700' },
}
export const DAMAGE_SOURCES = {
  warehouse: 'Warehouse', in_transit: 'In transit', park: 'At park', return: 'Customer return', delivery: 'Delivery',
}

export function useDamagedGoods(includeClosed = false) {
  const { user } = useAuthStore()
  return useQuery({
    queryKey: ['damaged_goods', includeClosed, user?.id],
    retry: false,
    queryFn: async () => {
      let q = supabase.from('damaged_goods')
        .select('*, warehouse:warehouses(name, state)')
        .order('created_at', { ascending: false })
        .limit(includeClosed ? 300 : 1000)
      if (!includeClosed) q = q.in('status', ['damaged', 'repair'])
      q = scopeToBusinesses(q, user)
      const whIds = allowedWarehouseIds(user)
      if (whIds) {
        const states = await allowedWarehouseStates(user)
        q = q.or([
          `warehouse_id.in.${pgList(whIds)}`,
          ...(states.length ? [`and(warehouse_id.is.null,state.in.${pgList(states)})`] : []),
        ].join(','))
      }
      const { data, error } = await q
      if (error) return null
      return data || []
    },
    staleTime: 20000,
  })
}

// Tag units on a warehouse shelf as damaged: out of sellable stock,
// into the Damaged list
export function useMarkDamagedFromStock() {
  return useFlowMutation(async ({ row, quantity, reason, color, size }, user) => {
    const qty = Math.trunc(Number(quantity) || 0)
    if (qty <= 0) throw new Error('Enter how many are damaged')
    await applyStock({
      productId: row.product_id, warehouseId: row.warehouse_id, businessId: row.business_id,
      qty: -qty, damaged: qty, color, size, type: 'damage', staffId: user?.id,
      notes: `Marked damaged in ${row.warehouse?.name || 'warehouse'} — ${reason || 'no reason given'}`,
    })
    try {
      await recordDamaged({
        product_id: row.product_id, product_name: row.product?.name || 'Unknown', quantity: qty,
        color, size,
        business_id: row.business_id || null, source: 'warehouse', warehouse_id: row.warehouse_id,
        state: row.warehouse?.state || null, reason: reason || null,
      }, user)
    } catch (e) {
      return { warning: `Stock reduced, but the Damaged list entry failed — ${e.message}` }
    }
    return null
  }, 'Moved to Damaged goods')
}

// outcome: 'repaired' (needs warehouse) | 'repair' | 'written_off' | 'supplier_return'
export function useResolveDamaged() {
  return useFlowMutation(async ({ item, outcome, warehouse, note }, user) => {
    if (outcome === 'repaired' && !warehouse) throw new Error('Choose the warehouse it goes back into')
    const final = outcome !== 'repair'
    const { data, error } = await supabase.from('damaged_goods').update({
      status: outcome,
      resolved_note: [note, outcome === 'repaired' ? `Back in ${warehouse.name}` : null].filter(Boolean).join(' · ') || null,
      ...(final ? { resolved_at: new Date().toISOString(), resolved_by_name: user?.name || null } : {}),
      ...(outcome === 'repaired' ? { warehouse_id: warehouse.id } : {}),
      updated_at: new Date().toISOString(),
    }).eq('id', item.id).in('status', ['damaged', 'repair']).select('id')
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) throw new Error('This item was already settled by someone else')
    if (outcome === 'repaired' && item.product_id) {
      try {
        await applyStock({
          productId: item.product_id, warehouseId: warehouse.id, businessId: item.business_id,
          qty: item.quantity, color: item.color, size: item.size,
          type: 'repaired_in', refId: item.id, refType: 'damaged', staffId: user?.id,
          notes: `Repaired — back into ${warehouse.name}${note ? ` · ${note}` : ''}`,
        })
      } catch (e) {
        await supabase.from('damaged_goods').update({
          status: item.status, resolved_note: item.resolved_note || null, resolved_at: null, resolved_by_name: null,
          warehouse_id: item.warehouse_id || null,
        }).eq('id', item.id)
        throw new Error(`Stock not updated — ${e.message}`)
      }
    }
    return null
  }, 'Damaged item updated')
}

// ─── Stock badges on orders ───────────────────────────────────────────

// Sellable stock per state + the list of states that have a warehouse
export function useStockAvailability() {
  const { user } = useAuthStore()
  return useQuery({
    queryKey: ['stock_availability', user?.id],
    queryFn: async () => {
      const { data: whs } = await supabase.from('warehouses').select('id, state').eq('is_active', true)
      let q = supabase.from('inventory').select('product_id, warehouse_id, quantity_available').gt('quantity_available', 0)
      q = scopeToBusinesses(q, user)
      const { data: inv } = await q
      const { data: anyRows } = await supabase.from('inventory').select('product_id')
      const stateOf = Object.fromEntries((whs || []).map(w => [w.id, w.state]))
      const byStateProduct = {}
      for (const r of inv || []) {
        const st = stateOf[r.warehouse_id]
        if (!st) continue
        const k = `${st}|${r.product_id}`
        byStateProduct[k] = (byStateProduct[k] || 0) + Number(r.quantity_available || 0)
      }
      return {
        byStateProduct,
        statesWithWarehouse: new Set((whs || []).map(w => w.state)),
        tracked: new Set((anyRows || []).map(r => r.product_id)),
      }
    },
    staleTime: 60000,
  })
}

// Before dispatch: is the stock already in the customer's state?
export const PRE_DISPATCH = ['new', 'awaiting_waybill', 'processing', 'customer_rescheduled', 'batch_processing']
export function orderStockBadge(order, avail) {
  if (!avail || !order || !PRE_DISPATCH.includes(order.status)) return null
  if (order.stock_source === 'supplier_direct') return { tone: 'gray', text: 'Supplier direct' }
  if (order.has_waybill) return null
  const lines = orderLines(order).filter(l => l.product_id && avail.tracked.has(l.product_id))
  if (lines.length === 0) return null
  const st = order.state
  const inState = lines.every(l => (avail.byStateProduct[`${st}|${l.product_id}`] || 0) >= l.quantity)
  if (inState) return { tone: 'green', text: `Stock available in ${st}` }
  return {
    tone: 'amber',
    text: avail.statesWithWarehouse.has(st)
      ? `Stock not in ${st} — waybill needed`
      : `No warehouse in ${st} — waybill needed`,
  }
}

// ─── Weekly stock take ────────────────────────────────────────────────

export function useStockCounts() {
  const { user } = useAuthStore()
  return useQuery({
    queryKey: ['stock_counts', user?.id],
    retry: false,
    queryFn: async () => {
      let q = supabase.from('stock_counts')
        .select('*, warehouse:warehouses(name, state), lines:stock_count_lines(id, status, variance)')
        .order('submitted_at', { ascending: false })
        .limit(60)
      // Park counts span businesses (no business_id) — always visible
      const ids = allowedBusinessIds(user)
      if (ids) q = q.or(`business_id.in.(${ids.join(',')}),business_id.is.null`)
      const whIds = allowedWarehouseIds(user)
      if (whIds) q = q.or(`warehouse_id.in.${pgList(whIds)},scope.eq.park`)
      const { data, error } = await q
      if (error) return null
      return data || []
    },
    staleTime: 20000,
  })
}

export function useStockCount(id) {
  return useQuery({
    queryKey: ['stock_count', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_counts')
        .select('*, warehouse:warehouses(name, state), lines:stock_count_lines(*)')
        .eq('id', id).single()
      if (error) throw error
      data.lines = [...(data.lines || [])].sort((a, b) =>
        (Math.abs(b.variance) - Math.abs(a.variance)) || a.product_name.localeCompare(b.product_name))
      return data
    },
  })
}

// What there is to count — WITHOUT the app's numbers (a blind count)
export function useCountSheet(scope, warehouseId) {
  const { user } = useAuthStore()
  return useQuery({
    queryKey: ['count_sheet', scope, warehouseId, user?.id],
    enabled: scope === 'park' || !!warehouseId,
    queryFn: async () => {
      if (scope === 'park') {
        let q = supabase.from('holding_queue')
          .select('id, product_id, product_name, state, city, park_name, color, size')
          .in('status', ['holding', 'collected']).order('state')
        q = scopeToBusinesses(q, user)
        const { data } = await q
        return (data || []).map(h => ({
          key: `h:${h.id}`, holding_id: h.id, product_id: h.product_id, product_name: h.product_name,
          location_label: [h.park_name, h.city, h.state].filter(Boolean).join(', '),
          detail: [h.color, h.size].filter(Boolean).join(' · '),
        }))
      }
      const { data } = await supabase.from('inventory')
        .select('product_id, product:products(name)')
        .eq('warehouse_id', warehouseId)
      // Products with colours/sizes are counted per variation, plus one
      // line for units with no colour/size recorded
      const variants = await warehouseVariants(warehouseId)
      const out = []
      for (const r of (data || []).sort((a, b) => (a.product?.name || '').localeCompare(b.product?.name || ''))) {
        const name = r.product?.name || 'Unknown'
        const vs = variants.filter(v => v.product_id === r.product_id)
        for (const v of vs) {
          out.push({
            key: `v:${r.product_id}:${v.variant_key}`, product_id: r.product_id, product_name: name,
            color: v.color, size: v.size, detail: [v.color, v.size].filter(Boolean).join(' / '),
          })
        }
        out.push({
          key: `p:${r.product_id}`, product_id: r.product_id, product_name: name,
          detail: vs.length ? 'No colour/size recorded (incl. items awaiting inspection)' : null,
        })
      }
      return out
    },
    staleTime: 0,
  })
}

// Every variation row in a warehouse ([] before the variations migration)
async function warehouseVariants(warehouseId) {
  const { data, error } = await supabase.from('inventory_variants')
    .select('product_id, variant_key, color, size, quantity').eq('warehouse_id', warehouseId)
  return error ? [] : (data || [])
}

// Submit a count: the app's figures are snapshotted NOW and compared
export function useSubmitStockCount() {
  return useFlowMutation(async ({ scope, warehouse, entries, notes }, user) => {
    const filled = entries.filter(e => e.counted !== '' && e.counted != null)
    if (filled.length === 0) throw new Error('Enter at least one counted quantity')
    if (filled.some(e => !Number.isInteger(Number(e.counted)) || Number(e.counted) < 0)) {
      throw new Error('Counted quantities must be whole numbers, 0 or more')
    }

    let systemOf = {}
    if (scope === 'park') {
      const ids = filled.map(e => e.holding_id)
      const { data } = await supabase.from('holding_queue').select('id, quantity, status').in('id', ids)
      for (const h of data || []) systemOf[`h:${h.id}`] = ['holding', 'collected'].includes(h.status) ? h.quantity : 0
    } else {
      const { data } = await supabase.from('inventory').select('product_id, quantity_physical')
        .eq('warehouse_id', warehouse.id).in('product_id', filled.map(e => e.product_id))
      const variants = await warehouseVariants(warehouse.id)
      for (const r of data || []) {
        const vs = variants.filter(v => v.product_id === r.product_id)
        // Without colour/size = everything on the shelf not in a variation
        systemOf[`p:${r.product_id}`] = (Number(r.quantity_physical) || 0) - vs.reduce((a, v) => a + (Number(v.quantity) || 0), 0)
        for (const v of vs) systemOf[`v:${r.product_id}:${v.variant_key}`] = Number(v.quantity) || 0
      }
    }

    const { data: count, error } = await supabase.from('stock_counts').insert({
      scope,
      warehouse_id: scope === 'warehouse' ? warehouse.id : null,
      business_id: scope === 'warehouse' ? (warehouse.business_id || null) : null,
      week_start: weekStart(),
      status: 'submitted',
      notes: notes || null,
      counted_by: user?.id || null,
      counted_by_name: user?.name || null,
    }).select().single()
    if (error) throw new Error(error.message)

    const lines = filled.map(e => {
      const system_qty = systemOf[e.key] || 0
      const counted_qty = Number(e.counted)
      const variance = counted_qty - system_qty
      return {
        count_id: count.id,
        product_id: e.product_id || null,
        product_name: e.product_name,
        holding_id: e.holding_id || null,
        location_label: e.location_label || null,
        system_qty, counted_qty, variance,
        status: variance === 0 ? 'matched' : 'pending',
        note: e.note || null,
        // colour/size columns exist once the variations migration has run
        ...((e.color || e.size) ? { color: e.color || null, size: e.size || null } : {}),
      }
    })
    const { error: lErr } = await supabase.from('stock_count_lines').insert(lines)
    if (lErr) {
      await supabase.from('stock_counts').delete().eq('id', count.id)
      throw new Error(lErr.message)
    }
    if (lines.every(l => l.status === 'matched')) {
      await supabase.from('stock_counts').update({ status: 'approved', approved_by_name: 'Auto — no differences', approved_at: new Date().toISOString() }).eq('id', count.id)
    }
    const diffs = lines.filter(l => l.variance !== 0).length
    return diffs > 0
      ? { warning: `Count submitted — ${diffs} difference${diffs === 1 ? '' : 's'} sent to the CEO for approval` }
      : null
  }, 'Count submitted — everything matches')
}

// CEO approves (stock corrected) or rejects (no change) count lines
export function useDecideCountLines() {
  return useFlowMutation(async ({ count, lines, decision }, user) => {
    if (!isCeo(user)) throw new Error('Only the CEO can approve stock count corrections')
    const problems = []
    for (const line of lines) {
      const { data: claimed } = await supabase.from('stock_count_lines').update({
        status: decision === 'approve' ? 'approved' : 'rejected',
        decided_by_name: user?.name || null,
        decided_at: new Date().toISOString(),
      }).eq('id', line.id).eq('status', 'pending').select('id')
      if (!claimed || claimed.length === 0) continue // already decided
      if (decision !== 'approve' || line.variance === 0) continue

      const note = `Stock count adjustment (week of ${count.week_start}) — counted ${line.counted_qty}, app had ${line.system_qty}, approved by ${user?.name}`
      try {
        if (count.scope === 'park') {
          if (!line.holding_id) continue
          const { data: h } = await supabase.from('holding_queue').select('*').eq('id', line.holding_id).single()
          const newQty = Math.max(0, (Number(h?.quantity) || 0) + line.variance)
          await supabase.from('holding_queue').update({
            quantity: newQty,
            ...(newQty === 0 ? { status: 'missing' } : {}),
            notes: [h?.notes, note].filter(Boolean).join(' · '),
            updated_at: new Date().toISOString(),
          }).eq('id', line.holding_id)
          await supabase.from('holding_history').insert({
            holding_id: line.holding_id, action: 'stock_count_adjustment', details: note,
            staff_id: user?.id || null, staff_name: user?.name || null,
          })
        } else {
          const res = await applyStock({
            productId: line.product_id, warehouseId: count.warehouse_id, businessId: count.business_id,
            qty: line.variance, clamp: true, color: line.color, size: line.size, type: 'stock_count_adjustment',
            refId: count.id, refType: 'stock_count', staffId: user?.id, notes: note,
          })
          if (res.applied !== line.variance) {
            problems.push(`${line.product_name}${line.color || line.size ? ` (${[line.color, line.size].filter(Boolean).join(' / ')})` : ''}: only ${-res.applied} could be removed (stock has changed since the count)`)
          }
        }
      } catch (e) {
        await supabase.from('stock_count_lines').update({ status: 'pending', decided_by_name: null, decided_at: null }).eq('id', line.id)
        problems.push(`${line.product_name}: ${e.message}`)
      }
    }
    const { data: rest } = await supabase.from('stock_count_lines').select('id').eq('count_id', count.id).eq('status', 'pending')
    if ((rest || []).length === 0) {
      await supabase.from('stock_counts').update({
        status: 'approved', approved_by_name: user?.name || null, approved_at: new Date().toISOString(),
      }).eq('id', count.id)
    }
    return problems.length ? { warning: `Some lines need attention: ${problems.join(' · ')}` } : null
  }, 'Stock count decision saved')
}

// Is this week's count done? (Monday reminder)
export function useWeeklyCountStatus() {
  const counts = useStockCounts()
  const ws = weekStart()
  const list = counts.data || []
  const thisWeek = list.filter(c => c.week_start === ws)
  const pendingApproval = list.filter(c => c.status === 'submitted' &&
    (c.lines || []).some(l => l.status === 'pending'))
  return {
    ready: counts.data !== undefined && counts.data !== null,
    weekStart: ws,
    doneThisWeek: thisWeek.length > 0,
    thisWeek,
    pendingApproval,
  }
}
