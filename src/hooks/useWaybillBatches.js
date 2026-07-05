import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/authStore'

export function useWaybillBatch(id) {
  return useQuery({
    queryKey: ['waybill_batch', id],
    enabled: !!id,
    queryFn: async () => {
      const [batchR, batchOrdersR, packingR, timelineR, stateExpensesR] = await Promise.all([
        supabase.from('waybill_batches')
          .select('*, source_warehouse:warehouses!waybill_batches_source_warehouse_id_fkey(id, name, state, city)')
          .eq('id', id).single(),
        supabase.from('waybill_batch_orders')
          .select('*, order:orders(id, order_number, customer_name, state, product_name, quantity, total_amount, status, customer_phone, address, city)')
          .eq('batch_id', id),
        supabase.from('waybill_batch_packing_items')
          .select('*').eq('batch_id', id).order('state').order('product_name'),
        supabase.from('waybill_batch_timeline')
          .select('*').eq('batch_id', id).order('created_at', { ascending: true }),
        supabase.from('waybill_batch_state_expenses')
          .select('*').eq('batch_id', id).order('state'),
      ])
      if (batchR.error) throw batchR.error
      return {
        batch: batchR.data,
        orders: batchOrdersR.data || [],
        packingItems: packingR.data || [],
        timeline: timelineR.data || [],
        stateExpenses: stateExpensesR.data || [],
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

      // Derive destination states from the selected orders
      const selectedOrderData = (awaitingOrders || []).filter(o => selectedOrders.includes(o.id))
      const destinationStates = [...new Set(selectedOrderData.map(o => o.state).filter(Boolean))].sort()

      const { data: batch, error } = await supabase.from('waybill_batches').insert({
        courier_company: form.courier_company,
        waybill_type: form.waybill_type,
        tracking_number: form.tracking_number,
        date_shipped: form.date_shipped,
        notes: form.notes,
        source_warehouse_id: form.source_warehouse_id || null,
        destination_state: destinationStates.join(', '),
        batch_number: batchNumber,
        total_cost: 0,
        status: 'created',
        business_id: selectedOrderData[0]?.business_id || null,
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
      for (const order of selectedOrderData) {
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
        notes: `${selectedOrders.length} orders — destinations: ${destinationStates.join(', ') || 'unknown'}`,
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
    // stateExpenses: { [state]: { destination_city, waybill_cost, packaging_cost, loading_cost, transport_cost, dispatch_cost, other_cost, expense_notes } }
    // batchOrders: the batch orders array (with order.state to compute per-state order counts)
    mutationFn: async ({ batchId, stateExpenses, batchOrders }) => {
      const COST_KEYS = ['waybill_cost', 'packaging_cost', 'loading_cost', 'transport_cost', 'dispatch_cost', 'other_cost']

      let grandTotal = 0

      for (const [state, exp] of Object.entries(stateExpenses)) {
        const stateTotal = COST_KEYS.reduce((s, k) => s + (Number(exp[k]) || 0), 0)
        grandTotal += stateTotal

        await supabase.from('waybill_batch_state_expenses').upsert({
          batch_id: batchId,
          state,
          destination_city: exp.destination_city || null,
          waybill_cost: Number(exp.waybill_cost) || 0,
          packaging_cost: Number(exp.packaging_cost) || 0,
          loading_cost: Number(exp.loading_cost) || 0,
          transport_cost: Number(exp.transport_cost) || 0,
          dispatch_cost: Number(exp.dispatch_cost) || 0,
          other_cost: Number(exp.other_cost) || 0,
          expense_notes: exp.expense_notes || null,
        }, { onConflict: 'batch_id,state' })

        // Allocate this state's cost equally among orders going to that state
        const stateOrders = batchOrders.filter(bo => bo.order?.state === state)
        if (stateOrders.length > 0 && stateTotal > 0) {
          const perOrder = stateTotal / stateOrders.length
          for (const bo of stateOrders) {
            await supabase.from('waybill_batch_orders').update({
              allocated_logistics_cost: perOrder,
            }).eq('id', bo.id)
          }
        }
      }

      await supabase.from('waybill_batches').update({
        total_cost: grandTotal,
        expenses_saved: true,
        updated_at: new Date().toISOString(),
      }).eq('id', batchId)

      await supabase.from('waybill_batch_timeline').insert({
        batch_id: batchId,
        event: 'Expenses Saved',
        notes: `Total: ₦${grandTotal.toLocaleString()} across ${Object.keys(stateExpenses).length} state(s)`,
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
