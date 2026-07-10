import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/authStore'
import { useAppStore } from '../stores/appStore'

export const CONTACT_ROLES = [
  { value: 'driver',       label: 'Driver' },
  { value: 'park_manager', label: 'Park Manager' },
  { value: 'stockkeeper',  label: 'Stockkeeper' },
  { value: 'other',        label: 'Other' },
]

export const HOLDING_STATUSES = {
  // Active — the product is still physically waiting at the park
  holding:       { label: 'At State Park',        color: 'bg-cyan-50 text-cyan-700' },
  collected:     { label: 'Collected — Awaiting Decision', color: 'bg-blue-50 text-blue-700' },
  // History — the product has left the temporary location
  warehouse:     { label: 'Moved to Warehouse',   color: 'bg-green-50 text-green-700' },
  waybilled:     { label: 'Waybilled / In Transit', color: 'bg-purple-50 text-purple-700' },
  park_transfer: { label: 'Transferred from Park', color: 'bg-indigo-50 text-indigo-700' },
  transferred:   { label: 'Used in Waybill Batch', color: 'bg-purple-50 text-purple-700' },
  damaged:       { label: 'Damaged',              color: 'bg-red-50 text-red-700' },
}

export const ACTIVE_HOLDING = ['holding', 'collected']

// Best-effort per-record history trail (table may predate migration)
export async function holdingHistory(holding_id, action, details, user) {
  try {
    await supabase.from('holding_history').insert({
      holding_id, action, details: details || null,
      staff_id: user?.id || null, staff_name: user?.name || null,
    })
  } catch { /* ignore */ }
}

export function useHoldingHistory(holdingId) {
  return useQuery({
    queryKey: ['holding_history', holdingId],
    enabled: !!holdingId,
    retry: false,
    queryFn: async () => {
      try {
        const { data } = await supabase.from('holding_history')
          .select('*').eq('holding_id', holdingId)
          .order('created_at', { ascending: false })
        return data || []
      } catch { return [] }
    },
    staleTime: 15000,
  })
}

// null result = table missing (migration not run)
export function useHoldingQueue(includeClosed = false) {
  const { user } = useAuthStore()
  return useQuery({
    queryKey: ['holding_queue', includeClosed, user?.role, user?.assigned_states],
    retry: false,
    queryFn: async () => {
      try {
        let q = supabase.from('holding_queue').select('*').order('created_at', { ascending: false })
        if (!includeClosed) q = q.in('status', ACTIVE_HOLDING)
        // Fulfillment officers only see their assigned states
        if (user?.role === 'fulfillment' && Array.isArray(user?.assigned_states) && user.assigned_states.length > 0) {
          q = q.in('state', user.assigned_states)
        }
        const { data, error } = await q
        if (error) throw error
        return data || []
      } catch { return null }
    },
    staleTime: 30000,
  })
}

function useHoldingMutation(fn, successMsg) {
  const queryClient = useQueryClient()
  const { showToast } = useAppStore()
  const { user } = useAuthStore()
  return useMutation({
    mutationFn: (args) => fn(args, user),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['holding_queue'] })
      queryClient.invalidateQueries({ queryKey: ['holding_history'] })
      queryClient.invalidateQueries({ queryKey: ['inventory'] })
      queryClient.invalidateQueries({ queryKey: ['inventory_movements'] })
      queryClient.invalidateQueries({ queryKey: ['expenses'] })
      if (successMsg) showToast(successMsg, 'success')
    },
    onError: (err) => showToast(err.message, 'error'),
  })
}

// Update contact / location / notes
export function useUpdateHolding() {
  return useHoldingMutation(async ({ id, fields }, user) => {
    const { error } = await supabase.from('holding_queue')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
    await holdingHistory(id, 'details_updated', 'Location/contact details updated', user)
  }, 'Holding record updated')
}

// Product physically collected from the park (still awaiting decision)
export function useCollectHolding() {
  return useHoldingMutation(async ({ item }, user) => {
    const { error } = await supabase.from('holding_queue')
      .update({
        status: 'collected',
        custodian_id: user?.id || null,
        custodian_name: user?.name || null,
        notes: [item.notes, `Collected from park by ${user?.name || 'staff'}`].filter(Boolean).join(' · '),
        updated_at: new Date().toISOString(),
      })
      .eq('id', item.id)
      .eq('status', 'holding')
    if (error) throw error
    await holdingHistory(item.id, 'collected', `Collected from ${item.park_name || 'park'} by ${user?.name}`, user)
  }, 'Marked collected from park')
}

// Move the product into a warehouse — it leaves the active queue and
// becomes available inventory
export function useHoldingToWarehouse() {
  return useHoldingMutation(async ({ item, warehouse, dateReceived, timeReceived, receivedBy, condition, notes }, user) => {
    if (item.product_id) {
      const { data: inv } = await supabase.from('inventory').select('*')
        .eq('product_id', item.product_id).eq('warehouse_id', warehouse.id).single()
      if (inv) {
        await supabase.from('inventory').update({
          quantity_physical: (inv.quantity_physical || 0) + item.quantity,
          quantity_available: (inv.quantity_available || 0) + item.quantity,
        }).eq('id', inv.id)
      } else {
        await supabase.from('inventory').insert({
          product_id: item.product_id,
          warehouse_id: warehouse.id,
          business_id: item.business_id || null,
          quantity_physical: item.quantity,
          quantity_available: item.quantity,
        })
      }
      await supabase.from('inventory_movements').insert({
        product_id: item.product_id,
        warehouse_id: warehouse.id,
        business_id: item.business_id || null,
        movement_type: 'return',
        quantity: item.quantity,
        reference_id: item.id,
        reference_type: 'holding',
        notes: `From holding queue (${item.source_order_number || 'failed order'}) into ${warehouse.name}` +
          `${condition ? ` · condition: ${condition}` : ''}${receivedBy ? ` · received by ${receivedBy}` : ''}`,
        staff_id: user?.id || null,
      })
    }
    const summary = `Received into ${warehouse.name}${dateReceived ? ` on ${dateReceived}` : ''}` +
      `${timeReceived ? ` at ${timeReceived}` : ''}${receivedBy ? ` by ${receivedBy}` : ''}` +
      `${condition ? ` · condition: ${condition}` : ''}${notes ? ` · ${notes}` : ''}`
    const { error } = await supabase.from('holding_queue')
      .update({
        status: 'warehouse',
        custodian_id: user?.id || null,
        custodian_name: receivedBy || user?.name || null,
        updated_at: new Date().toISOString(),
        notes: [item.notes, summary].filter(Boolean).join(' · '),
      })
      .eq('id', item.id)
    if (error) throw error
    await holdingHistory(item.id, 'moved_to_warehouse', summary, user)
  }, 'Moved to warehouse — stock is available and the item left the active queue')
}

// Waybilled from the park to another state/warehouse/destination —
// leaves the active queue and continues as an in-transit movement
export function useHoldingWaybilled() {
  return useHoldingMutation(async ({ item, form }, user) => {
    const destination = [form.dest_location, form.dest_city, form.dest_state].filter(Boolean).join(', ')
    const summary =
      `Waybilled to ${destination}` +
      `${form.courier ? ` via ${form.courier}` : ''}` +
      `${form.waybill_number ? ` · waybill ${form.waybill_number}` : ''}` +
      `${form.date_shipped ? ` · shipped ${form.date_shipped}` : ''}` +
      `${form.dest_contact ? ` · destination contact: ${form.dest_contact}` : ''}` +
      `${form.notes ? ` · ${form.notes}` : ''}`

    const { error } = await supabase.from('holding_queue')
      .update({
        status: 'waybilled',
        state: form.dest_state || item.state,
        city: form.dest_city || null,
        park_name: form.dest_location || null,
        park_location: null,
        contact_name: form.dest_contact || null,
        contact_phone: form.dest_contact_phone || null,
        custodian_id: user?.id || null,
        custodian_name: user?.name || null,
        updated_at: new Date().toISOString(),
        notes: [item.notes, summary].filter(Boolean).join(' · '),
      })
      .eq('id', item.id)
    if (error) throw error

    // Logistics movement record, linked back to the holding item and
    // (through it) the original failed order
    try {
      await supabase.from('inventory_movements').insert({
        product_id: item.product_id || null,
        warehouse_id: null,
        business_id: item.business_id || null,
        movement_type: 'holding_waybilled',
        quantity: 0,
        reference_id: item.id,
        reference_type: 'holding',
        notes: `${item.quantity} × ${item.product_name} — ${summary} (originally ${item.source_order_number || 'failed order'})`,
        staff_id: user?.id || null,
      })
    } catch { /* movement log is best-effort */ }

    // Waybill expense feeds straight into business expenses
    if (Number(form.expense) > 0) {
      try {
        const { data: created } = await supabase.from('expenses').insert({
          business_id: item.business_id || null,
          expense_type: 'waybill',
          amount: Number(form.expense),
          description: `Holding queue waybill: ${item.product_name} → ${destination}`,
          date: form.date_shipped || new Date().toISOString().split('T')[0],
          category: 'operational',
          is_admin_only: false,
          staff_id: user?.id || null,
        }).select('id').single()
        if (created) {
          await supabase.from('expenses').update({
            paid_to: form.courier || null, created_by_name: user?.name || null,
          }).eq('id', created.id)
        }
      } catch { /* expense log is best-effort */ }
    }

    await holdingHistory(item.id, 'waybilled', summary, user)
  }, 'Waybilled — the item left the active queue')
}

// Product physically left the park (handed over / carried onward)
export function useHoldingParkTransfer() {
  return useHoldingMutation(async ({ item, form }, user) => {
    const summary =
      `Transferred from ${item.park_name || 'park'}` +
      `${form.date ? ` on ${form.date}` : ''}${form.time ? ` at ${form.time}` : ''}` +
      `${form.transferred_by ? ` by ${form.transferred_by}` : ''}` +
      `${form.destination ? ` → ${form.destination}` : ''}` +
      `${form.notes ? ` · ${form.notes}` : ''}`
    const { error } = await supabase.from('holding_queue')
      .update({
        status: 'park_transfer',
        custodian_id: user?.id || null,
        custodian_name: form.transferred_by || user?.name || null,
        updated_at: new Date().toISOString(),
        notes: [item.notes, summary].filter(Boolean).join(' · '),
      })
      .eq('id', item.id)
    if (error) throw error
    try {
      await supabase.from('inventory_movements').insert({
        product_id: item.product_id || null,
        warehouse_id: null,
        business_id: item.business_id || null,
        movement_type: 'park_transfer',
        quantity: 0,
        reference_id: item.id,
        reference_type: 'holding',
        notes: `${item.quantity} × ${item.product_name} — ${summary} (originally ${item.source_order_number || 'failed order'})`,
        staff_id: user?.id || null,
      })
    } catch { /* movement log is best-effort */ }
    await holdingHistory(item.id, 'park_transfer', summary, user)
  }, 'Recorded — the item left the active queue')
}

export function useHoldingDamaged() {
  return useHoldingMutation(async ({ item, reason }, user) => {
    const { error } = await supabase.from('holding_queue')
      .update({
        status: 'damaged',
        notes: [item.notes, `Damaged: ${reason || 'no reason given'} — ${user?.name}`].filter(Boolean).join(' · '),
        updated_at: new Date().toISOString(),
      })
      .eq('id', item.id)
    if (error) throw error
    await holdingHistory(item.id, 'damaged', reason || 'Marked damaged', user)
  }, 'Marked damaged')
}
