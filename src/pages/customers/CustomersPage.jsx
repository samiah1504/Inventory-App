import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Phone, MessageCircle, ShoppingCart, AlertTriangle } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { TopBar } from '../../components/layout/TopBar'
import { SearchBar } from '../../components/ui/SearchBar'
import { SkeletonList } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'
import { formatCurrency, formatDate } from '../../utils/format'
import { openDialer, openWhatsApp } from '../../utils/whatsapp'

export function CustomersPage() {
  const [search, setSearch] = useState('')
  const navigate = useNavigate()

  const { data: customers, isLoading } = useQuery({
    queryKey: ['customers', search],
    queryFn: async () => {
      let query = supabase
        .from('customers')
        .select('*')
        .order('last_order_at', { ascending: false, nullsFirst: false })
        .limit(100)
      if (search) {
        query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%`)
      }
      const { data, error } = await query
      if (error) throw error
      return data || []
    },
    staleTime: 30000,
  })

  return (
    <div className="flex flex-col h-full overflow-x-hidden w-full">
      <TopBar title="Customers" back={false} />
      <div className="px-4 py-3 bg-white border-b border-gray-100 sticky top-[57px] z-20 overflow-x-hidden w-full">
        <SearchBar value={search} onChange={setSearch} placeholder="Search by name or phone..." />
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4">
        {isLoading ? <SkeletonList count={5} /> :
         customers?.length === 0 ? (
           <EmptyState title="No customers yet" description="Customers are created automatically when orders are placed" />
         ) : (
           <div className="space-y-3">
             <p className="text-xs text-gray-500">{customers.length} customer{customers.length !== 1 ? 's' : ''}</p>
             {customers.map(customer => (
               <div
                 key={customer.id}
                 onClick={() => navigate(`/customers/${customer.id}`)}
                 className="bg-white rounded-2xl p-4 border border-gray-100 cursor-pointer active:scale-[0.99] transition-transform"
               >
                 <div className="flex items-start justify-between gap-2 mb-2">
                   <div className="flex-1 min-w-0">
                     <div className="flex items-center gap-2">
                       <p className="text-sm font-semibold text-gray-900">{customer.name}</p>
                       {customer.failed_orders > 1 && (
                         <div className="flex items-center gap-0.5 text-red-500">
                           <AlertTriangle size={12} />
                           <span className="text-xs">{customer.failed_orders}</span>
                         </div>
                       )}
                     </div>
                     <p className="text-xs text-gray-500">{customer.phone}</p>
                   </div>
                   <div className="text-right shrink-0">
                     <p className="text-sm font-bold text-gray-900">{formatCurrency(customer.total_spent)}</p>
                     <p className="text-xs text-gray-400">{customer.total_orders} orders</p>
                   </div>
                 </div>
                 <div className="flex items-center justify-between">
                   <p className="text-xs text-gray-400">
                     Last order: {customer.last_order_at ? formatDate(customer.last_order_at) : 'Never'}
                   </p>
                   <div className="flex gap-2">
                     <button
                       onClick={e => { e.stopPropagation(); openDialer(customer.phone) }}
                       className="p-1.5 bg-green-50 text-green-600 rounded-lg active:scale-95 transition-all"
                     >
                       <Phone size={14} />
                     </button>
                     <button
                       onClick={e => { e.stopPropagation(); openWhatsApp(customer.phone) }}
                       className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg active:scale-95 transition-all"
                     >
                       <MessageCircle size={14} />
                     </button>
                   </div>
                 </div>
               </div>
             ))}
           </div>
         )
        }
      </div>
    </div>
  )
}
