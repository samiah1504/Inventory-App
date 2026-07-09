import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/authStore'
import { useAppStore } from '../stores/appStore'
import { queueAction, isOnline } from '../lib/offline'
import { reserveStockForOrder, resolveOrderStock, startReturnProcess, receiveOrderStockAtWarehouse } from '../lib/stockOps'

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
      if (filters.status) query = query.eq('status', filters.status)
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
  return useQuery({
    queryKey: ['order', id],
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

  return useMutation({
    mutationFn: async (orderData) => {
      const { items, ...orderFields } = orderData

      // Get next order number
      const year = new Date().getFullYear()
      const { data: counter } = await supabase.rpc('get_next_counter', {
        counter_type: 'order',
        business_id_param: orderFields.business_id,
        year_param: year
      })
      const orderNumber = `ORD-${year}-${String(counter || 1).padStart(5, '0')}`

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

      const { data, error } = await supabase.from('orders').insert(payload).select().single()
      if (error) throw error

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

export function useUpdateOrderStatus() {
  const queryClient = useQueryClient()
  const { showToast } = useAppStore()
  const { user } = useAuthStore()

  return useMutation({
    mutationFn: async ({ id, status, extra = {}, timelineDesc, stockOutcome }) => {
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

      await supabase.from('order_timeline').insert({
        order_id: id,
        action: status,
        description: timelineDesc || `Status changed to ${status} by ${user?.name}`,
        staff_id: user?.id,
        staff_name: user?.name,
      })

      // Inventory side-effects: reserved stock becomes sold on payment,
      // releases on cancel, and on failed delivery the officer's choice
      // (returned / damaged / missing) decides. A returned order starts the
      // return-assessment process (stock goes to awaiting-inspection) —
      // inventory is only finalized when the return is processed.
      if (status === 'paid') await resolveOrderStock(data, 'sold', user?.id)
      else if (status === 'cancelled') await resolveOrderStock(data, 'release', user?.id)
      else if (status === 'returned') await startReturnProcess(data, user)
      else if (status === 'failed_delivery' && stockOutcome) await resolveOrderStock(data, stockOutcome, user?.id)
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
