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
          product:products(id, name, selling_price, cost_price),
          warehouse:warehouses(id, name, state)
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

export function useAddStock() {
  const queryClient = useQueryClient()
  const { showToast } = useAppStore()
  const { user } = useAuthStore()

  return useMutation({
    mutationFn: async (stockData) => {
      const { product_id, warehouse_id, business_id, quantity, unit_cost, supplier, notes } = stockData

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
      const { data, error } = await supabase.from('inventory_movements').insert({
        product_id, warehouse_id, business_id,
        movement_type: 'purchase',
        quantity,
        unit_cost,
        total_cost: quantity * unit_cost,
        supplier,
        notes,
        staff_id: user?.id,
      }).select().single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] })
      showToast('Stock added successfully', 'success')
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
        quantity: Math.abs(adjustment),
        notes: reason,
        staff_id: user?.id,
      })
      if (movErr) throw movErr
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] })
      showToast('Stock adjusted', 'success')
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
