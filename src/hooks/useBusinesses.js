import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export function useBusinesses() {
  return useQuery({
    queryKey: ['businesses'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('businesses')
        .select('*')
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      return data || []
    },
    staleTime: 60000 * 5,
  })
}

export function useProducts(businessId = null) {
  return useQuery({
    queryKey: ['products', businessId],
    queryFn: async () => {
      let query = supabase
        .from('products')
        .select('*, category:product_categories(name), business:businesses(name)')
        .eq('is_active', true)
        .order('name')
      if (businessId) query = query.eq('business_id', businessId)
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
