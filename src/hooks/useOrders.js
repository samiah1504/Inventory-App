import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/authStore'
import { useAppStore } from '../stores/appStore'
import { queueAction, isOnline } from '../lib/offline'

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
      return data
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
      // Get next order number
      const year = new Date().getFullYear()
      const { data: counter } = await supabase.rpc('get_next_counter', {
        counter_type: 'order',
        business_id_param: orderData.business_id,
        year_param: year
      })
      const orderNumber = `ORD-${year}-${String(counter || 1).padStart(5, '0')}`

      // Upsert customer
      const { data: customer } = await supabase
        .from('customers')
        .upsert({
          name: orderData.customer_name,
          phone: orderData.customer_phone,
        }, { onConflict: 'phone', ignoreDuplicates: false })
        .select()
        .single()

      const payload = {
        ...orderData,
        order_number: orderNumber,
        customer_id: customer?.id,
        staff_code: user?.staff_code,
        created_by: user?.id,
        status: 'new',
      }

      const { data, error } = await supabase.from('orders').insert(payload).select().single()
      if (error) throw error

      // Timeline entry
      await supabase.from('order_timeline').insert({
        order_id: data.id,
        action: 'created',
        description: `Order created by ${user?.name}`,
        staff_id: user?.id,
        staff_name: user?.name,
      })

      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] })
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
    mutationFn: async ({ id, status, extra = {}, timelineDesc }) => {
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

      return data
    },
    onSuccess: (data, { id }) => {
      if (!data?.offline) {
        queryClient.invalidateQueries({ queryKey: ['orders'] })
        queryClient.invalidateQueries({ queryKey: ['order', id] })
        showToast('Order updated', 'success')
      }
    },
    onError: (err) => showToast(err.message, 'error'),
  })
}
