import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/authStore'
import { useAppStore } from '../stores/appStore'

export function useInventory(filters = {}) {
  return useQuery({
    queryKey: ['inventory', filters],
    queryFn: async () => {
      let query = supabase
        .from('inventory')
        .select(`
          *,
          product:products(id, name, selling_price, cost_price, category:product_categories(name)),
          warehouse:warehouses(id, name, state),
          business:businesses(id, name)
        `)
        .order('quantity_available', { ascending: true })

      if (filters.warehouse_id) query = query.eq('warehouse_id', filters.warehouse_id)
      if (filters.business_id) query = query.eq('business_id', filters.business_id)
      if (filters.low_stock) query = query.lte('quantity_available', 5)

      const { data, error } = await query
      if (error) throw error
      return data || []
    },
    staleTime: 30000,
  })
}

// Movement history for one product (used by the expanded inventory card)
export function useProductMovements(productId) {
  return useQuery({
    queryKey: ['inventory_movements', productId],
    enabled: !!productId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_movements')
        .select('*, warehouse:warehouses(name, state), staff:staff_users(name)')
        .eq('product_id', productId)
        .order('created_at', { ascending: false })
        .limit(30)
      if (error) throw error
      return data || []
    },
    staleTime: 30000,
  })
}

export function useAddStock() {
  const queryClient = useQueryClient()
  const { showToast } = useAppStore()
  const { user } = useAuthStore()

  return useMutation({
    mutationFn: async (stockData) => {
      const { product_id, warehouse_id, business_id, quantity, unit_cost, supplier, notes, date } = stockData

      // Upsert inventory record
      const { data: existing } = await supabase
        .from('inventory')
        .select('*')
        .eq('product_id', product_id)
        .eq('warehouse_id', warehouse_id)
        .single()

      if (existing) {
        await supabase
          .from('inventory')
          .update({
            quantity_physical: existing.quantity_physical + quantity,
            quantity_available: existing.quantity_available + quantity,
          })
          .eq('id', existing.id)
      } else {
        await supabase.from('inventory').insert({
          product_id, warehouse_id, business_id,
          quantity_physical: quantity,
          quantity_available: quantity,
        })
      }

      // Movement record
      const movement = {
        product_id, warehouse_id, business_id,
        movement_type: 'purchase',
        quantity,
        unit_cost,
        total_cost: quantity * unit_cost,
        supplier,
        notes,
        staff_id: user?.id,
      }
      if (date) movement.created_at = `${date}T12:00:00`

      const { data, error } = await supabase.from('inventory_movements').insert(movement).select().single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] })
      queryClient.invalidateQueries({ queryKey: ['inventory_movements'] })
      showToast('Stock received', 'success')
    },
    onError: (err) => showToast(err.message, 'error'),
  })
}

export function useAdjustStock() {
  const queryClient = useQueryClient()
  const { showToast } = useAppStore()
  const { user } = useAuthStore()

  return useMutation({
    mutationFn: async ({ inventory_id, product_id, warehouse_id, business_id, adjustment, reason }) => {
      const { data: existing, error: fetchErr } = await supabase
        .from('inventory')
        .select('*')
        .eq('id', inventory_id)
        .single()
      if (fetchErr) throw fetchErr

      const newAvailable = existing.quantity_available + adjustment
      const newPhysical = existing.quantity_physical + adjustment
      if (newAvailable < 0) throw new Error('Adjustment would result in negative stock')

      const { error: updateErr } = await supabase
        .from('inventory')
        .update({
          quantity_available: newAvailable,
          quantity_physical: newPhysical,
        })
        .eq('id', inventory_id)
      if (updateErr) throw updateErr

      const { error: movErr } = await supabase.from('inventory_movements').insert({
        product_id, warehouse_id, business_id,
        movement_type: adjustment > 0 ? 'adjustment_in' : 'adjustment_out',
        quantity: adjustment,
        notes: reason,
        staff_id: user?.id,
      })
      if (movErr) throw movErr
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] })
      queryClient.invalidateQueries({ queryKey: ['inventory_movements'] })
      showToast('Stock adjusted', 'success')
    },
    onError: (err) => showToast(err.message, 'error'),
  })
}

// Set the low-stock alert threshold for every warehouse row of a product
export function useSetMinStock() {
  const queryClient = useQueryClient()
  const { showToast } = useAppStore()

  return useMutation({
    mutationFn: async ({ product_id, threshold }) => {
      const { error } = await supabase
        .from('inventory')
        .update({ low_stock_threshold: threshold })
        .eq('product_id', product_id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] })
      showToast('Minimum stock level updated', 'success')
    },
    onError: (err) => showToast(err.message, 'error'),
  })
}

export function useWarehouseTransfers(filters = {}) {
  return useQuery({
    queryKey: ['warehouse_transfers', filters],
    queryFn: async () => {
      let query = supabase
        .from('warehouse_transfers')
        .select(`
          *,
          product:products(name),
          from_warehouse:warehouses!warehouse_transfers_from_warehouse_id_fkey(name, state),
          to_warehouse:warehouses!warehouse_transfers_to_warehouse_id_fkey(name, state)
        `)
        .order('created_at', { ascending: false })

      if (filters.status) query = query.eq('status', filters.status)

      const { data, error } = await query
      if (error) throw error
      return data || []
    },
    staleTime: 30000,
  })
}

// Start a transfer: stock leaves the source warehouse and goes in transit
export function useTransferStock() {
  const queryClient = useQueryClient()
  const { showToast } = useAppStore()
  const { user } = useAuthStore()

  return useMutation({
    mutationFn: async ({ product_id, product_name, from_warehouse_id, to_warehouse_id, quantity, date, notes }) => {
      if (from_warehouse_id === to_warehouse_id) throw new Error('Source and destination must differ')

      const { data: source, error: srcErr } = await supabase
        .from('inventory')
        .select('*')
        .eq('product_id', product_id)
        .eq('warehouse_id', from_warehouse_id)
        .single()
      if (srcErr || !source) throw new Error('No stock record in the source warehouse')
      if (source.quantity_available < quantity) {
        throw new Error(`Only ${source.quantity_available} available in source warehouse`)
      }

      const transfer_number = `TRF-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`

      const { data: transfer, error: trfErr } = await supabase
        .from('warehouse_transfers')
        .insert({
          transfer_number, product_id, product_name, quantity,
          from_warehouse_id, to_warehouse_id,
          date_transferred: date || new Date().toISOString().split('T')[0],
          status: 'in_transit',
          notes,
          created_by: user?.id,
        })
        .select()
        .single()
      if (trfErr) throw trfErr

      // Stock leaves the source immediately
      await supabase.from('inventory').update({
        quantity_physical: source.quantity_physical - quantity,
        quantity_available: source.quantity_available - quantity,
      }).eq('id', source.id)

      await supabase.from('inventory_movements').insert({
        product_id, warehouse_id: from_warehouse_id, business_id: source.business_id,
        movement_type: 'transfer_out',
        quantity: -quantity,
        reference_id: transfer.id,
        reference_type: 'transfer',
        notes: `${transfer_number} → destination warehouse`,
        staff_id: user?.id,
      })

      return transfer
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] })
      queryClient.invalidateQueries({ queryKey: ['warehouse_transfers'] })
      queryClient.invalidateQueries({ queryKey: ['inventory_movements'] })
      showToast('Transfer created — stock in transit', 'success')
    },
    onError: (err) => showToast(err.message, 'error'),
  })
}

// Complete a transfer: stock arrives at the destination warehouse
export function useReceiveTransfer() {
  const queryClient = useQueryClient()
  const { showToast } = useAppStore()
  const { user } = useAuthStore()

  return useMutation({
    mutationFn: async (transfer) => {
      const { error: updErr } = await supabase
        .from('warehouse_transfers')
        .update({ status: 'received', received_by: user?.id, received_at: new Date().toISOString() })
        .eq('id', transfer.id)
        .eq('status', 'in_transit')
      if (updErr) throw updErr

      // Upsert destination inventory row
      const { data: dest } = await supabase
        .from('inventory')
        .select('*')
        .eq('product_id', transfer.product_id)
        .eq('warehouse_id', transfer.to_warehouse_id)
        .single()

      let business_id = dest?.business_id
      if (dest) {
        await supabase.from('inventory').update({
          quantity_physical: dest.quantity_physical + transfer.quantity,
          quantity_available: dest.quantity_available + transfer.quantity,
        }).eq('id', dest.id)
      } else {
        // Carry the business over from the source row
        const { data: src } = await supabase
          .from('inventory')
          .select('business_id')
          .eq('product_id', transfer.product_id)
          .eq('warehouse_id', transfer.from_warehouse_id)
          .single()
        business_id = src?.business_id || null
        await supabase.from('inventory').insert({
          product_id: transfer.product_id,
          warehouse_id: transfer.to_warehouse_id,
          business_id,
          quantity_physical: transfer.quantity,
          quantity_available: transfer.quantity,
        })
      }

      await supabase.from('inventory_movements').insert({
        product_id: transfer.product_id,
        warehouse_id: transfer.to_warehouse_id,
        business_id,
        movement_type: 'transfer_in',
        quantity: transfer.quantity,
        reference_id: transfer.id,
        reference_type: 'transfer',
        notes: `${transfer.transfer_number} received`,
        staff_id: user?.id,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] })
      queryClient.invalidateQueries({ queryKey: ['warehouse_transfers'] })
      queryClient.invalidateQueries({ queryKey: ['inventory_movements'] })
      showToast('Transfer received into warehouse', 'success')
    },
    onError: (err) => showToast(err.message, 'error'),
  })
}

// ─── Returns ─────────────────────────────────────────────────────────────────

export function useReturns(filters = {}) {
  return useQuery({
    queryKey: ['returns', filters],
    queryFn: async () => {
      let query = supabase
        .from('returns')
        .select(`
          *,
          warehouse:warehouses(name, state),
          business:businesses(name),
          timeline:return_timeline(*)
        `)
        .order('created_at', { ascending: false })
      if (filters.status) query = query.eq('status', filters.status)
      const { data, error } = await query
      if (error) throw error
      // Timeline oldest-first for display
      return (data || []).map(r => ({
        ...r,
        timeline: [...(r.timeline || [])].sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '')),
      }))
    },
    staleTime: 30000,
    retry: false,
  })
}

export function useProcessReturn() {
  const queryClient = useQueryClient()
  const { showToast } = useAppStore()
  const { user } = useAuthStore()

  return useMutation({
    mutationFn: async ({ ret, form }) => {
      const { applyReturnOutcome, addReturnTimeline } = await import('../lib/stockOps')

      const REASON_LABELS = {
        changed_mind: 'Customer changed mind', rejected_on_delivery: 'Customer rejected on delivery',
        wrong_product: 'Wrong product delivered', wrong_colour: 'Wrong colour', wrong_size: 'Wrong size',
        damaged_delivery: 'Damaged during delivery', factory_defect: 'Factory defect',
        missing_parts: 'Missing parts', complaint: 'Customer complaint', exchange: 'Exchange request', other: 'Other',
      }
      const OUTCOME_LABELS = {
        restocked: 'Returned to available stock', inspection: 'Sent for inspection', repair: 'Sent for repair',
        damaged: 'Marked as damaged', written_off: 'Written off', supplier_return: 'Returned to supplier',
        display_item: 'Kept as display item', other: 'Other',
      }
      const RESOLUTION_LABELS = {
        no_refund: 'No refund', full_refund: 'Full refund', partial_refund: 'Partial refund',
        exchanged: 'Product exchanged', store_credit: 'Store credit', replacement_sent: 'Replacement sent',
      }

      const { error } = await supabase.from('returns').update({
        return_date: form.return_date || ret.return_date,
        reason: form.reason,
        reason_note: form.reason_note || null,
        outcome: form.outcome,
        outcome_note: form.outcome_note || null,
        customer_resolution: form.customer_resolution,
        refund_amount: Number(form.refund_amount) || 0,
        replacement_product_id: form.replacement_product_id || null,
        replacement_product_name: form.replacement_product_name || null,
        replacement_quantity: form.replacement_quantity ? Number(form.replacement_quantity) : null,
        replacement_order_number: form.replacement_order_number || null,
        difference_paid: Number(form.difference_paid) || 0,
        status: 'completed',
        processed_by: user?.id || null,
        processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', ret.id)
      if (error) throw error

      await addReturnTimeline(ret.id, 'inspected',
        `Inspected — reason: ${REASON_LABELS[form.reason] || form.reason}${form.reason_note ? ` (${form.reason_note})` : ''}`, user)

      // Inventory action (skipped for 'inspection' — stock stays in the inspection bucket)
      if (form.outcome !== 'inspection') {
        await applyReturnOutcome(ret, form.outcome, user)
      } else {
        await addReturnTimeline(ret.id, 'inspection_hold', 'Kept in inspection — stock unchanged', user)
      }

      await addReturnTimeline(ret.id, 'resolution',
        `Customer resolution: ${RESOLUTION_LABELS[form.customer_resolution] || form.customer_resolution}` +
        (Number(form.refund_amount) > 0 ? ` — ₦${Number(form.refund_amount).toLocaleString()}` : '') +
        (form.customer_resolution === 'exchanged' && form.replacement_product_name
          ? ` — replacement: ${form.replacement_product_name} ×${form.replacement_quantity || 1}${form.replacement_order_number ? ` (${form.replacement_order_number})` : ''}`
          : ''), user)
      await addReturnTimeline(ret.id, 'completed', `Return processed: ${OUTCOME_LABELS[form.outcome] || form.outcome}`, user)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['returns'] })
      queryClient.invalidateQueries({ queryKey: ['inventory'] })
      queryClient.invalidateQueries({ queryKey: ['inventory_movements'] })
      showToast('Return processed', 'success')
    },
    onError: (err) => showToast(err.message, 'error'),
  })
}
