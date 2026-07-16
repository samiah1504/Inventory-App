import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/authStore'
import { useAppStore } from '../stores/appStore'
import { queueAction, isOnline } from '../lib/offline'
import { reserveStockForOrder, resolveOrderStock, startReturnProcess, receiveOrderStockAtWarehouse, resolveFailedDeliveryStock } from '../lib/stockOps'
import { scopeToBusinesses, businessAllowed } from '../lib/businessScope'

export function useOrders(filters = {}) {
  const { user } = useAuthStore()

  return useQuery({
    queryKey: ['orders', filters, user?.id],
    queryFn: async () => {
      let query = supabase
        .from('orders')
        .select(`
          *,
          business:businesses(id, name, short_code),
          created_by_staff:staff_users!orders_created_by_fkey(id, name, staff_code)
        `)
        .order('created_at', { ascending: false })

      if (user?.role === 'customer_support') {
        query = query.eq('created_by', user.id)
      }
      // Fulfillment officers only see orders for their assigned state(s).
      // No assignment yet (or migration not run) keeps the legacy all-states view.
      if (user?.role === 'fulfillment' && Array.isArray(user?.assigned_states) && user.assigned_states.length > 0) {
        query = query.in('state', user.assigned_states)
      }
      // Business restriction: staff only ever receive rows for their
      // assigned business(es) — enforced in the database request
      query = scopeToBusinesses(query, user)
      if (filters.status) query = query.eq('status', filters.status)
      if (filters.delivery_fee_pending) query = query.eq('delivery_fee_pending', true)
      if (filters.statuses) query = query.in('status', filters.statuses)
      if (filters.state) query = query.eq('state', filters.state)
      if (filters.business_id) query = query.eq('business_id', filters.business_id)
      if (filters.search) {
        query = query.or(`order_number.ilike.%${filters.search}%,customer_name.ilike.%${filters.search}%,customer_phone.ilike.%${filters.search}%,product_name.ilike.%${filters.search}%`)
      }
      if (filters.date_from) query = query.gte('created_at', filters.date_from)
      if (filters.date_to) query = query.lte('created_at', filters.date_to)
      if (filters.limit) query = query.limit(filters.limit)
      if (filters.planned_delivery_date) query = query.eq('planned_delivery_date', filters.planned_delivery_date)
      if (filters.planned_delivery_date_lt) query = query.lt('planned_delivery_date', filters.planned_delivery_date_lt)

      const { data, error } = await query
      if (error) throw error
      return data || []
    },
    staleTime: 30000,
  })
}

export function useOrder(id) {
  const { user } = useAuthStore()
  return useQuery({
    queryKey: ['order', id, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          business:businesses(*),
          customer:customers(*),
          created_by_staff:staff_users!orders_created_by_fkey(id, name, staff_code),
          timeline:order_timeline(*, staff:staff_users(name)),
          notes:order_notes(*, staff:staff_users(name)),
          expenses:expenses(*)
        `)
        .eq('id', id)
        .single()
      if (error) throw error

      // A direct URL must not bypass the business restriction
      if (!businessAllowed(user, data.business_id)) {
        throw new Error('Order not found')
      }

      // Load items: prefer order_items table, fall back to items_data JSONB column on the order
      let items = []
      try {
        const { data: itemsData } = await supabase
          .from('order_items')
          .select('id, product_id, product_name, quantity, unit_price, total_amount, color, size')
          .eq('order_id', id)
        items = itemsData || []
      } catch {
        items = []
      }

      // Fall back to items_data column (always available once migration runs)
      if (items.length === 0 && Array.isArray(data.items_data) && data.items_data.length > 0) {
        items = data.items_data
      }

      return { ...data, items }
    },
    enabled: !!id,
  })
}

export function useCreateOrder() {
  const queryClient = useQueryClient()
  const { showToast } = useAppStore()
  const { user } = useAuthStore()

  // Same ORD-YYYY-NNNNN format, but generated atomically in the
  // database from ONE global sequence — never reused, unaffected by
  // deletions, safe under concurrent staff
  async function nextOrderNumber(businessId) {
    try {
      const { data, error } = await supabase.rpc('get_next_order_number')
      if (!error && data) return data
    } catch { /* function not migrated yet */ }
    // Legacy per-business counter until the migration runs
    const year = new Date().getFullYear()
    const { data: counter } = await supabase.rpc('get_next_counter', {
      counter_type: 'order', business_id_param: businessId, year_param: year,
    })
    if (counter) return `ORD-${year}-${String(counter).padStart(5, '0')}`
    // Last resort: one above the highest existing number this year
    const { data: last } = await supabase.from('orders')
      .select('order_number').ilike('order_number', `ORD-${year}-%`)
      .order('order_number', { ascending: false }).limit(1)
    const lastN = parseInt(last?.[0]?.order_number?.split('-')[2]) || 0
    return `ORD-${year}-${String(lastN + 1).padStart(5, '0')}`
  }

  return useMutation({
    mutationFn: async (orderData) => {
      const { items, ...orderFields } = orderData

      // Upsert customer
      const { data: customer } = await supabase
        .from('customers')
        .upsert({
          name: orderFields.customer_name,
          phone: orderFields.customer_phone,
        }, { onConflict: 'phone', ignoreDuplicates: false })
        .select()
        .single()

      // Build clean items array
      const cleanItems = (items || []).map(item => ({
        product_id: item.product_id || null,
        product_name: item.product_name,
        quantity: Number(item.quantity) || 1,
        unit_price: Number(item.unit_price) || 0,
        total_amount: (Number(item.quantity) || 1) * (Number(item.unit_price) || 0),
        color: item.color || null,
        size: item.size || null,
      }))

      // Generate + insert with automatic retry: if a duplicate number
      // somehow slips through, a fresh number is drawn and retried.
      // No partial order is ever created, and the raw database error
      // never reaches the user.
      let data = null
      let orderNumber = null
      for (let attempt = 0; attempt < 5; attempt++) {
        orderNumber = await nextOrderNumber(orderFields.business_id)
        const payload = {
          ...orderFields,
          order_number: orderNumber,
          customer_id: customer?.id,
          staff_code: user?.staff_code,
          created_by: user?.id,
          status: 'new',
          // Store all items as JSON directly on the order — always works, no extra table needed
          items_data: cleanItems.length > 0 ? cleanItems : null,
        }
        const res = await supabase.from('orders').insert(payload).select().single()
        if (!res.error) { data = res.data; break }
        const isDuplicate = res.error.code === '23505' || /duplicate key/i.test(res.error.message || '')
        if (!isDuplicate) throw new Error(res.error.message)
      }
      if (!data) {
        throw new Error('We could not generate a unique order number. Please try again.')
      }

      // Also insert into order_items table when it exists (for waybill packing queries)
      if (cleanItems.length > 0) {
        for (const item of cleanItems) {
          // Silently ignore if table doesn't exist yet
          await supabase.from('order_items').insert({ order_id: data.id, ...item })
        }
      }

      // Timeline entry
      await supabase.from('order_timeline').insert({
        order_id: data.id,
        action: 'created',
        description: `Order created by ${user?.name}`,
        staff_id: user?.id,
        staff_name: user?.name,
      })

      // Custom products typed during intake join the catalogue as
      // UNVERIFIED — the Operations Manager reviews them later.
      // Best-effort: order creation never fails because of this.
      for (const item of cleanItems.filter(i => !i.product_id && i.product_name?.trim())) {
        try {
          const name = item.product_name.trim()
          const { data: existing } = await supabase.from('products')
            .select('id').ilike('name', name).limit(1)
          if (existing && existing.length > 0) continue
          const { data: p, error: pErr } = await supabase.from('products').insert({
            name,
            business_id: orderFields.business_id || null,
            selling_price: Number(item.unit_price) || null,
            is_verified: false,
            is_active: true,
          }).select('id').single()
          if (pErr || !p) continue
          // Columns from the governance migration — ignore if missing
          await supabase.from('products').update({
            created_by: user?.id || null,
            created_by_name: user?.name || null,
            first_order_id: data.id,
            first_order_number: orderNumber,
          }).eq('id', p.id)
          await supabase.from('product_audit').insert({
            product_id: p.id,
            action: 'created_from_order',
            details: `Created as unverified during order ${orderNumber}`,
            staff_id: user?.id || null,
            staff_name: user?.name || null,
          })
        } catch (e) { console.warn('unverified product create failed', e) }
      }

      // Auto-reserve stock for products tracked in inventory
      await reserveStockForOrder(data, user?.id)

      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      queryClient.invalidateQueries({ queryKey: ['inventory'] })
      showToast('Order created successfully', 'success')
    },
    onError: (err) => showToast(err.message, 'error'),
  })
}

// CEO-only correction tool: move an order — and every operational and
// financial record linked to it — to a different business. Reports,
// dashboards, P&L and documents all derive from business_id at query
// time, so once the rows move the numbers follow automatically.
export function useReassignOrderBusiness() {
  const queryClient = useQueryClient()
  const { showToast } = useAppStore()
  const { user } = useAuthStore()

  return useMutation({
    mutationFn: async ({ order, newBusinessId, newBusinessName, reason }) => {
      if (!['ceo', 'super_admin'].includes(user?.role) || user?._preview) {
        throw new Error('Only the CEO can change the business on an order')
      }
      if (!newBusinessId || newBusinessId === order.business_id) {
        throw new Error('Select a different business')
      }
      const oldName = order.business?.name || 'Unknown'

      // 1. The order itself — verified after write: a silently-blocked
      //    update (0 rows) must never be reported as success
      const { error } = await supabase.from('orders')
        .update({ business_id: newBusinessId, updated_at: new Date().toISOString() })
        .eq('id', order.id)
      if (error) throw new Error(error.message)
      const { data: check } = await supabase.from('orders')
        .select('business_id').eq('id', order.id).single()
      if (check?.business_id !== newBusinessId) {
        throw new Error('The database did not accept the business change. Nothing was moved.')
      }

      // 2. Financial + operational records linked to this order.
      //    Each is best-effort (table/column may predate a migration) —
      //    the counts are reported back for transparency.
      const moved = {}
      async function move(table, column) {
        try {
          const { data, error: e } = await supabase.from(table)
            .update({ business_id: newBusinessId })
            .eq(column, order.id)
            .select('id')
          if (e) throw e
          moved[table] = (data || []).length
        } catch { moved[table] = 0 }
      }
      await move('expenses', 'order_id')            // delivery, waybill, installation, offloading…
      await move('returns', 'order_id')
      await move('holding_queue', 'source_order_id')
      try {
        const { data } = await supabase.from('inventory_movements')
          .update({ business_id: newBusinessId })
          .eq('reference_id', order.id)
          .eq('reference_type', 'order')
          .select('id')
        moved.inventory_movements = (data || []).length
      } catch { moved.inventory_movements = 0 }

      // 3. Waybill batches: a batch is retagged only when every order in
      //    it now belongs to the new business — shared batches stay put.
      try {
        const { data: links } = await supabase.from('waybill_batch_orders')
          .select('batch_id').eq('order_id', order.id)
        const batchIds = Array.from(new Set((links || []).map(l => l.batch_id)))
        for (const batchId of batchIds) {
          const { data: siblings } = await supabase.from('waybill_batch_orders')
            .select('order:orders(business_id)').eq('batch_id', batchId)
          const allNew = (siblings || []).every(s => s.order?.business_id === newBusinessId)
          if (allNew) {
            await supabase.from('waybill_batches')
              .update({ business_id: newBusinessId }).eq('id', batchId)
          }
        }
      } catch { /* batches table variations — non-fatal */ }

      // 4. Permanent record in the order timeline
      await supabase.from('order_timeline').insert({
        order_id: order.id,
        action: 'business_changed',
        description: `Business changed from ${oldName} to ${newBusinessName} — Reason: ${reason.trim()} — by ${user?.name} (${user?.role})`,
        staff_id: user?.id,
        staff_name: user?.name,
      })

      return { moved }
    },
    onSuccess: (_res, { order }) => {
      // Every dashboard, report and analytics screen recalculates from
      // business_id — flush the entire cache so nothing shows stale totals
      queryClient.invalidateQueries()
      queryClient.invalidateQueries({ queryKey: ['order', order.id] })
      showToast('Order moved to the new business', 'success')
    },
    onError: (err) => showToast(err.message, 'error'),
  })
}

export function useUpdateOrderStatus() {
  const queryClient = useQueryClient()
  const { showToast } = useAppStore()
  const { user } = useAuthStore()

  return useMutation({
    mutationFn: async ({ id, status, extra = {}, extraSafe, timelineDesc, extraTimeline, stockOutcome }) => {
      if (!isOnline()) {
        await queueAction({ type: 'update_order_status', payload: { id, status, extra } })
        showToast('Saved offline. Will sync when connected.', 'info')
        return { offline: true }
      }

      const updateData = { status, updated_at: new Date().toISOString(), ...extra }

      if (status === 'delivered') updateData.delivered_at = new Date().toISOString()
      if (status === 'paid') updateData.paid_at = new Date().toISOString()

      const { data, error } = await supabase
        .from('orders')
        .update(updateData)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error

      // Best-effort details (columns that may not exist before the migration)
      if (extraSafe && Object.keys(extraSafe).length > 0) {
        await supabase.from('orders').update(extraSafe).eq('id', id) // error ignored by design
      }

      await supabase.from('order_timeline').insert({
        order_id: id,
        action: status,
        description: timelineDesc || `Status changed to ${status} by ${user?.name}`,
        staff_id: user?.id,
        staff_name: user?.name,
      })

      // Optional second timeline entry (e.g. park → warehouse transfer + receipt)
      if (extraTimeline) {
        await supabase.from('order_timeline').insert({
          order_id: id,
          action: extraTimeline.action || status,
          description: extraTimeline.description,
          staff_id: user?.id,
          staff_name: user?.name,
        })
      }

      // Inventory side-effects: reserved stock becomes sold on payment,
      // releases on cancel, and on failed delivery the officer's choice
      // (returned / damaged / missing) decides. A returned order starts the
      // return-assessment process (stock goes to awaiting-inspection) —
      // inventory is only finalized when the return is processed.
      if (status === 'paid') await resolveOrderStock(data, 'sold', user?.id)
      else if (status === 'cancelled') await resolveOrderStock(data, 'release', user?.id)
      else if (status === 'returned') await startReturnProcess(data, user)
      else if (status === 'failed_delivery' && stockOutcome) await resolveFailedDeliveryStock(data, stockOutcome, user)
      else if (status === 'received_at_warehouse') await receiveOrderStockAtWarehouse(data, user)

      return data
    },
    onSuccess: (data, { id }) => {
      if (!data?.offline) {
        queryClient.invalidateQueries({ queryKey: ['orders'] })
        queryClient.invalidateQueries({ queryKey: ['order', id] })
        queryClient.invalidateQueries({ queryKey: ['inventory'] })
        queryClient.invalidateQueries({ queryKey: ['returns'] })
        showToast('Order updated', 'success')
      }
    },
    onError: (err) => showToast(err.message, 'error'),
  })
}
