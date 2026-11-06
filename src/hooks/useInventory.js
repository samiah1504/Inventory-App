import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/authStore'
import { useAppStore } from '../stores/appStore'
import { scopeToBusinesses } from '../lib/businessScope'
import { applyStock } from '../lib/inventoryCore'

export function useInventory(filters = {}) {
  const { user } = useAuthStore()
  return useQuery({
    queryKey: ['inventory', filters, user?.id],
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
      query = scopeToBusinesses(query, user)

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
        .select('*, warehouse:warehouses(name, state), staff:staff_users(*)')
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
      const qty = Math.trunc(Number(quantity) || 0)
      if (qty <= 0) throw new Error('Enter a quantity greater than zero')
      // Stock row + purchase log in one atomic step
      return applyStock({
        productId: product_id, warehouseId: warehouse_id, businessId: business_id,
        qty, type: 'purchase', unitCost: unit_cost, supplier, notes,
        staffId: user?.id, movementAt: date ? `${date}T12:00:00` : null,
      })
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
    mutationFn: async ({ product_id, warehouse_id, business_id, adjustment, reason }) => {
      const qty = Math.trunc(Number(adjustment) || 0)
      if (qty === 0) throw new Error('Enter an adjustment other than zero')
      // Refuses (with the real available figure) if it would go negative
      await applyStock({
        productId: product_id, warehouseId: warehouse_id, businessId: business_id,
        qty, type: qty > 0 ? 'adjustment_in' : 'adjustment_out', notes: reason, staffId: user?.id,
      })
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

      const transfer_number = `TRF-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`
      const transferId = crypto.randomUUID()
      const qty = Math.trunc(Number(quantity) || 0)
      if (qty <= 0) throw new Error('Enter a quantity greater than zero')

      // Stock leaves the source first — atomically, and refused if there
      // isn't enough — so a transfer can never exist without its stock
      const { data: srcRow } = await supabase.from('inventory').select('business_id')
        .eq('product_id', product_id).eq('warehouse_id', from_warehouse_id).limit(1)
      await applyStock({
        productId: product_id, warehouseId: from_warehouse_id, businessId: srcRow?.[0]?.business_id,
        qty: -qty, type: 'transfer_out', refId: transferId, refType: 'transfer',
        notes: `${transfer_number} → destination warehouse`, staffId: user?.id,
      })

      const { data: transfer, error: trfErr } = await supabase
        .from('warehouse_transfers')
        .insert({
          id: transferId,
          transfer_number, product_id, product_name, quantity: qty,
          from_warehouse_id, to_warehouse_id,
          date_transferred: date || new Date().toISOString().split('T')[0],
          status: 'in_transit',
          notes,
          created_by: user?.id,
        })
        .select()
        .single()
      if (trfErr) {
        // Put the stock back so nothing disappears
        await applyStock({
          productId: product_id, warehouseId: from_warehouse_id, qty,
          type: 'transfer_cancelled', refId: transferId, refType: 'transfer',
          notes: `${transfer_number} could not be created — stock returned`, staffId: user?.id,
        })
        throw trfErr
      }

      return transfer
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] })
      queryClient.invalidateQueries({ queryKey: ['warehouse_transfers'] })
      queryClient.invalidateQueries({ queryKey: ['incoming_transfers'] })
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
      // Claim it first: two people tapping Receive can't add it twice
      const { data: claimed, error: updErr } = await supabase
        .from('warehouse_transfers')
        .update({ status: 'received', received_by: user?.id, received_at: new Date().toISOString() })
        .eq('id', transfer.id)
        .in('status', ['in_transit', 'at_park'])
        .select('id')
      if (updErr) throw updErr
      if (!claimed || claimed.length === 0) throw new Error('This transfer was already received')

      const { data: src } = await supabase.from('inventory').select('business_id')
        .eq('product_id', transfer.product_id).eq('warehouse_id', transfer.from_warehouse_id).limit(1)
      try {
        await applyStock({
          productId: transfer.product_id, warehouseId: transfer.to_warehouse_id,
          businessId: src?.[0]?.business_id || null,
          qty: transfer.quantity, type: 'transfer_in',
          refId: transfer.id, refType: 'transfer', notes: `${transfer.transfer_number} received`, staffId: user?.id,
        })
      } catch (e) {
        await supabase.from('warehouse_transfers')
          .update({ status: transfer.status, received_by: null, received_at: null }).eq('id', transfer.id)
        throw new Error(`Stock not updated — ${e.message}`)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] })
      queryClient.invalidateQueries({ queryKey: ['warehouse_transfers'] })
      queryClient.invalidateQueries({ queryKey: ['incoming_transfers'] })
      queryClient.invalidateQueries({ queryKey: ['inventory_movements'] })
      showToast('Transfer received into warehouse', 'success')
    },
    onError: (err) => showToast(err.message, 'error'),
  })
}

// Transfer arrived at the destination State Park — physically in the state but
// NOT yet available for orders. Receiving into the warehouse completes it.
export function useTransferAtPark() {
  const queryClient = useQueryClient()
  const { showToast } = useAppStore()
  const { user } = useAuthStore()

  return useMutation({
    mutationFn: async (transfer) => {
      const { error } = await supabase
        .from('warehouse_transfers')
        .update({ status: 'at_park' })
        .eq('id', transfer.id)
        .eq('status', 'in_transit')
      if (error) throw error

      await supabase.from('inventory_movements').insert({
        product_id: transfer.product_id,
        warehouse_id: transfer.to_warehouse_id,
        movement_type: 'at_state_park',
        quantity: 0,
        reference_id: transfer.id,
        reference_type: 'transfer',
        notes: `${transfer.transfer_number} received at ${transfer.to_warehouse?.state || 'destination'} State Park — not yet available`,
        staff_id: user?.id,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['warehouse_transfers'] })
      queryClient.invalidateQueries({ queryKey: ['incoming_transfers'] })
      queryClient.invalidateQueries({ queryKey: ['inventory_movements'] })
      showToast('Received at State Park — not yet available for orders', 'success')
    },
    onError: (err) => showToast(err.message, 'error'),
  })
}

// ─── Returns ─────────────────────────────────────────────────────────────────

export function useReturns(filters = {}) {
  const { user } = useAuthStore()
  return useQuery({
    queryKey: ['returns', filters, user?.id],
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
      query = scopeToBusinesses(query, user)
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
      let stockWarnings = []
      if (form.outcome !== 'inspection') {
        stockWarnings = await applyReturnOutcome(ret, form.outcome, user)
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
      return { stockWarnings }
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['returns'] })
      queryClient.invalidateQueries({ queryKey: ['inventory'] })
      queryClient.invalidateQueries({ queryKey: ['inventory_movements'] })
      queryClient.invalidateQueries({ queryKey: ['damaged_goods'] })
      if (res?.stockWarnings?.length) showToast(`Return processed, but: ${res.stockWarnings.join(' · ')}`, 'warning', 9000)
      else showToast('Return processed', 'success')
    },
    onError: (err) => showToast(err.message, 'error'),
  })
}
