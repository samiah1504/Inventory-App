import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/authStore'
import { scopeToBusinesses } from '../lib/businessScope'

export function useBusinesses() {
  const { user } = useAuthStore()
  return useQuery({
    queryKey: ['businesses', user?.id],
    queryFn: async () => {
      // Restricted staff only ever see their assigned business(es) —
      // this scopes every business picker and order-intake default
      let q = supabase
        .from('businesses')
        .select('*')
        .eq('is_active', true)
        .order('name')
      q = scopeToBusinesses(q, user, 'id')
      const { data, error } = await q
      if (error) throw error
      return data || []
    },
    staleTime: 60000 * 5,
  })
}

export function useProducts(businessId = null) {
  const { user } = useAuthStore()
  return useQuery({
    queryKey: ['products', businessId, user?.id],
    queryFn: async () => {
      let query = supabase
        .from('products')
        .select('*, category:product_categories(name), business:businesses(name)')
        .eq('is_active', true)
        .order('name')
      if (businessId) query = query.eq('business_id', businessId)
      query = scopeToBusinesses(query, user)
      const { data, error } = await query
      if (error) throw error
      return data || []
    },
    staleTime: 60000 * 2,
  })
}

export function useWarehouses() {
  return useQuery({
    queryKey: ['warehouses'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('warehouses')
        .select('*')
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      return data || []
    },
    staleTime: 60000 * 5,
  })
}
