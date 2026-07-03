import { useParams, useNavigate } from 'react-router-dom'
import { Phone, MessageCircle, ShoppingCart, AlertTriangle } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { TopBar } from '../../components/layout/TopBar'
import { StatusBadge } from '../../components/ui/Badge'
import { formatCurrency, formatDate } from '../../utils/format'
import { openDialer, openWhatsApp } from '../../utils/whatsapp'

export function CustomerDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()

  const { data: customer, isLoading } = useQuery({
    queryKey: ['customer', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('*, orders(id, order_number, status, product_name, total_amount, created_at, state)')
        .eq('id', id)
        .single()
      if (error) throw error
      return data
    },
    enabled: !!id,
  })

  if (isLoading) return (
    <div className="flex flex-col h-full">
      <TopBar title="Customer" />
      <div className="p-4 space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 shimmer rounded-2xl" />)}</div>
    </div>
  )
  if (!customer) return null

  const orders = customer.orders || []
  const successRate = customer.total_orders > 0
    ? Math.round((customer.successful_orders / customer.total_orders) * 100) : 0

  return (
    <div className="flex flex-col h-full">
      <TopBar title={customer.name} />
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 pb-8">

        {/* Profile */}
        <div className="bg-white rounded-2xl p-4 border border-gray-100">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h2 className="text-lg font-bold text-gray-900">{customer.name}</h2>
              <p className="text-sm text-gray-500">{customer.phone}</p>
              {customer.failed_orders > 1 && (
                <div className="flex items-center gap-1 text-red-500 mt-1">
                  <AlertTriangle size={14} />
                  <span className="text-xs font-medium">{customer.failed_orders} failed deliveries — handle with care</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-3 mb-4">
            <button onClick={() => openDialer(customer.phone)}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-green-50 text-green-700 rounded-xl text-sm font-medium active:scale-95 transition-all">
              <Phone size={16} /> Call
            </button>
            <button onClick={() => openWhatsApp(customer.phone)}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-emerald-50 text-emerald-700 rounded-xl text-sm font-medium active:scale-95 transition-all">
              <MessageCircle size={16} /> WhatsApp
            </button>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center bg-gray-50 rounded-xl p-2">
              <p className="text-xl font-bold text-gray-900">{customer.total_orders}</p>
              <p className="text-xs text-gray-500">Orders</p>
            </div>
            <div className="text-center bg-gray-50 rounded-xl p-2">
              <p className="text-xl font-bold text-green-600">{formatCurrency(customer.total_spent)}</p>
              <p className="text-xs text-gray-500">Spent</p>
            </div>
            <div className="text-center bg-gray-50 rounded-xl p-2">
              <p className="text-xl font-bold text-gray-900">{successRate}%</p>
              <p className="text-xs text-gray-500">Success</p>
            </div>
          </div>
        </div>

        {/* Orders */}
        <div className="bg-white rounded-2xl border border-gray-100">
          <div className="px-4 pt-4 pb-2">
            <h3 className="text-sm font-semibold text-gray-900">Order History</h3>
          </div>
          {orders.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No orders</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {orders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).map(order => (
                <button
                  key={order.id}
                  onClick={() => navigate(`/orders/${order.id}`)}
                  className="w-full px-4 py-3 text-left hover:bg-gray-50 active:bg-gray-100 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-mono text-gray-400">{order.order_number}</span>
                        <StatusBadge status={order.status} />
                      </div>
                      <p className="text-sm text-gray-700">{order.product_name}</p>
                      <p className="text-xs text-gray-400">{order.state}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-gray-900">{formatCurrency(order.total_amount)}</p>
                      <p className="text-xs text-gray-400">{formatDate(order.created_at)}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
