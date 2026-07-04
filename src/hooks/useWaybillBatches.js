import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/authStore'

export function useWaybillBatch(id) {
  return useQuery({
    queryKey: ['waybill_batch', id],
    enabled: !!id,
    queryFn: async () => {
      const [batchR, batchOrdersR, packingR, timelineR] = await Promise.all([
        supabase.from('waybill_batches').select('*').eq('id', id).single(),
        supabase.from('waybill_batch_orders')
          .select('*, order:orders(id, order_number, customer_name, state, product_name, quantity, total_amount, status, customer_phone, address, city)')
          .eq('batch_id', id),
        supabase.from('waybill_batch_packing_items')
          .select('*').eq('batch_id', id).order('state').order('product_name'),
        supabase.from('waybill_batch_timeline')
          .select('*').eq('batch_id', id).order('created_at', { ascending: true }),
      ])
      if (batchR.error) throw batchR.error
      return {
        batch: batchR.data,
        orders: batchOrdersR.data || [],
        packingItems: packingR.data || [],
        timeline: timelineR.data || [],
      }
    },
    staleTime: 15000,
  })
}

export function useCreateWaybillBatch() {
  const queryClient = useQueryClient()
  const { user } = useAuthStore()
  return useMutation({
    mutationFn: async ({ form, selectedOrders, awaitingOrders }) => {
      const year = new Date().getFullYear()
      const { data: lastBatch } = await supabase
        .from('waybill_batches').select('batch_number').order('created_at', { ascending: false }).limit(1).maybeSingle()
      const lastNum = lastBatch?.batch_number ? parseInt(lastBatch.batch_number.split('-').pop()) || 0 : 0
      const batchNumber = `WB-${year}-${String(lastNum + 1).padStart(5, '0')}`

      const { data: batch, error } = await supabase.from('waybill_batches').insert({
        ...form,
        batch_number: batchNumber,
        total_cost: Number(form.total_cost) || 0,
        status: 'created',
        business_id: awaitingOrders?.find(o => selectedOrders.includes(o.id))?.business_id || null,
        created_by: user?.id,
      }).select().single()
      if (error) throw error

      for (const orderId of selectedOrders) {
        await supabase.from('waybill_batch_orders').insert({
          batch_id: batch.id, order_id: orderId, allocated_cost: 0,
        })
      }

      // Group orders into packing items by state + product
      const grouped = {}
      for (const order of (awaitingOrders || []).filter(o => selectedOrders.includes(o.id))) {
        const key = `${order.state}||${order.product_name}`
        if (!grouped[key]) grouped[key] = { state: order.state, product_name: order.product_name, quantity: 0 }
        grouped[key].quantity += Number(order.quantity) || 1
      }
      for (const item of Object.values(grouped)) {
        await supabase.from('waybill_batch_packing_items').insert({ batch_id: batch.id, ...item })
      }

      await supabase.from('waybill_batch_timeline').insert({
        batch_id: batch.id,
        event: 'Batch Created',
        notes: `${selectedOrders.length} orders added`,
        staff_id: user?.id,
        staff_name: user?.name,
      })

      return { batch, batchNumber }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['waybill_batches'] })
      queryClient.invalidateQueries({ queryKey: ['orders'] })
    },
  })
}

export function useSaveBatchExpenses() {
  const queryClient = useQueryClient()
  const { user } = useAuthStore()
  return useMutation({
    mutationFn: async ({ batchId, expenses, allocationMode, batchOrders }) => {
      const { expense_notes, ...costFields } = expenses
      const total = Object.values(costFields).reduce((s, v) => s + (Number(v) || 0), 0)

      await supabase.from('waybill_batches').update({
        ...costFields,
        expense_notes,
        total_cost: total,
        expenses_saved: true,
        cost_allocation: allocationMode,
        updated_at: new Date().toISOString(),
      }).eq('id', batchId)

      if (allocationMode === 'equal' && batchOrders.length > 0) {
        const perOrder = total / batchOrders.length
        for (const bo of batchOrders) {
          await supabase.from('waybill_batch_orders').update({
            allocated_logistics_cost: perOrder,
          }).eq('id', bo.id)
        }
      }

      await supabase.from('waybill_batch_timeline').insert({
        batch_id: batchId,
        event: 'Expenses Saved',
        notes: `Total: ₦${total.toLocaleString()}`,
        staff_id: user?.id,
        staff_name: user?.name,
      })
    },
    onSuccess: (_, { batchId }) => {
      queryClient.invalidateQueries({ queryKey: ['waybill_batch', batchId] })
      queryClient.invalidateQueries({ queryKey: ['waybill_batches'] })
    },
  })
}

export function useTogglePackingItem() {
  const queryClient = useQueryClient()
  const { user } = useAuthStore()
  return useMutation({
    mutationFn: async ({ itemId, isPacked, batchId }) => {
      await supabase.from('waybill_batch_packing_items').update({
        is_packed: isPacked,
        packed_at: isPacked ? new Date().toISOString() : null,
        packed_by: isPacked ? user?.id : null,
      }).eq('id', itemId)
    },
    onSuccess: (_, { batchId }) => {
      queryClient.invalidateQueries({ queryKey: ['waybill_batch', batchId] })
    },
  })
}

export function useAdvanceBatchStatus() {
  const queryClient = useQueryClient()
  const { user } = useAuthStore()
  return useMutation({
    mutationFn: async ({ batchId, newStatus, batchNumber, orderIds, notes }) => {
      await supabase.from('waybill_batches').update({
        status: newStatus,
        ...(newStatus === 'received' ? { received_at: new Date().toISOString(), received_by: user?.id } : {}),
        updated_at: new Date().toISOString(),
      }).eq('id', batchId)

      if (newStatus === 'waybilled') {
        for (const orderId of orderIds) {
          await supabase.from('orders').update({
            status: 'waybilled', has_waybill: true, updated_at: new Date().toISOString(),
          }).eq('id', orderId)
          await supabase.from('order_timeline').insert({
            order_id: orderId,
            action: 'waybilled',
            description: `Dispatched in batch ${batchNumber} by ${user?.name}`,
            staff_id: user?.id,
            staff_name: user?.name,
          })
        }
      } else if (newStatus === 'received') {
        for (const orderId of orderIds) {
          await supabase.from('orders').update({
            status: 'received_at_warehouse', updated_at: new Date().toISOString(),
          }).eq('id', orderId)
          await supabase.from('order_timeline').insert({
            order_id: orderId,
            action: 'received_at_warehouse',
            description: `Received from batch ${batchNumber}`,
            staff_id: user?.id,
            staff_name: user?.name,
          })
        }
      }

      const LABELS = {
        packed: 'Packing Confirmed',
        waybilled: 'Dispatched / Waybilled',
        received: 'Received at Warehouse',
      }
      await supabase.from('waybill_batch_timeline').insert({
        batch_id: batchId,
        event: LABELS[newStatus] || newStatus,
        notes: notes || null,
        staff_id: user?.id,
        staff_name: user?.name,
      })
    },
    onSuccess: (_, { batchId }) => {
      queryClient.invalidateQueries({ queryKey: ['waybill_batch', batchId] })
      queryClient.invalidateQueries({ queryKey: ['waybill_batches'] })
      queryClient.invalidateQueries({ queryKey: ['orders'] })
    },
  })
}
