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
  holding:     { label: 'At State Park',      color: 'bg-cyan-50 text-cyan-700' },
  collected:   { label: 'Collected from Park', color: 'bg-blue-50 text-blue-700' },
  warehouse:   { label: 'Moved to Warehouse', color: 'bg-green-50 text-green-700' },
  transferred: { label: 'Used in Waybill',    color: 'bg-purple-50 text-purple-700' },
  damaged:     { label: 'Damaged',            color: 'bg-red-50 text-red-700' },
}

export const ACTIVE_HOLDING = ['holding', 'collected']

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
      queryClient.invalidateQueries({ queryKey: ['inventory'] })
      queryClient.invalidateQueries({ queryKey: ['inventory_movements'] })
      if (successMsg) showToast(successMsg, 'success')
    },
    onError: (err) => showToast(err.message, 'error'),
  })
}

// Update contact / location / notes
export function useUpdateHolding() {
  return useHoldingMutation(async ({ id, fields }) => {
    const { error } = await supabase.from('holding_queue')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
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
  }, 'Marked collected from park')
}

// Move the product into a warehouse — it becomes available inventory
export function useHoldingToWarehouse() {
  return useHoldingMutation(async ({ item, warehouse }, user) => {
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
        notes: `From holding queue (${item.source_order_number || 'failed order'}) into ${warehouse.name}`,
        staff_id: user?.id || null,
      })
    }
    const { error } = await supabase.from('holding_queue')
      .update({ status: 'warehouse', updated_at: new Date().toISOString(),
        notes: [item.notes, `Moved to ${warehouse.name} by ${user?.name}`].filter(Boolean).join(' · ') })
      .eq('id', item.id)
    if (error) throw error
  }, 'Moved to warehouse — stock is available')
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
  }, 'Marked damaged')
}
