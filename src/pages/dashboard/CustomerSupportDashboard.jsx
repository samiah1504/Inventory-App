import { useNavigate } from 'react-router-dom'
import { Plus, Phone, MessageCircle, Clock, ShoppingCart } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useOrders } from '../../hooks/useOrders'
import { StatCard } from '../../components/ui/Card'
import { StatusBadge } from '../../components/ui/Badge'
import { formatCurrency } from '../../utils/format'
import { Button } from '../../components/ui/Button'
import { openDialer, openWhatsApp } from '../../utils/whatsapp'

export function CustomerSupportDashboard() {
  const { user } = useAuthStore()
  const navigate = useNavigate()

  const myActive = useOrders({ statuses: ['new', 'awaiting_waybill'] })
  const myNew = useOrders({ status: 'new' })

  return (
    <div className="overflow-y-auto overflow-x-hidden h-full w-full">
      <div className="bg-gray-900 text-white px-4 pt-12 pb-6">
        <p className="text-yellow-400 text-sm font-medium">Customer Support</p>
        <h1 className="text-2xl font-bold">{user?.name}</h1>
        <p className="text-gray-400 text-sm mt-0.5">{user?.staff_code}</p>
      </div>

      <div className="px-4 -mt-4 space-y-4 pb-6">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="Active Orders"
            value={myActive.data?.length ?? '...'}
            icon={<Clock size={20} />}
            color="blue"
            onClick={() => navigate('/orders')}
          />
          <StatCard
            label="New (Pending)"
            value={myNew.data?.length ?? '...'}
            icon={<ShoppingCart size={20} />}
            color="green"
            onClick={() => navigate('/orders?status=new')}
          />
        </div>

        {/* Primary Action */}
        <Button size="xl" onClick={() => navigate('/orders/new')} className="w-full" leftIcon={<Plus size={20} />}>
          Create New Order
        </Button>

        {/* My Active Orders */}
        <div className="bg-white rounded-2xl border border-gray-100">
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <h3 className="text-sm font-semibold text-gray-900">My Active Orders</h3>
            <button onClick={() => navigate('/orders')} className="text-xs text-blue-600 font-medium">View all</button>
          </div>
          <div className="divide-y divide-gray-50">
            {myActive.data?.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-8">No active orders</p>
            )}
            {(myActive.data || []).slice(0, 8).map(order => (
              <div key={order.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => navigate(`/orders/${order.id}`)}>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-mono text-gray-400">{order.order_number}</span>
                      <StatusBadge status={order.status} />
                    </div>
                    <p className="text-sm font-semibold text-gray-900">{order.customer_name}</p>
                    <p className="text-xs text-gray-500">{order.product_name} · {order.state}</p>
                    <p className="text-xs font-medium text-gray-700 mt-0.5">{formatCurrency(order.total_amount)}</p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button
                      onClick={() => openDialer(order.customer_phone)}
                      className="p-2 bg-green-50 text-green-600 rounded-xl active:scale-95 transition-all"
                    >
                      <Phone size={16} />
                    </button>
                    <button
                      onClick={() => openWhatsApp(order.customer_phone)}
                      className="p-2 bg-emerald-50 text-emerald-600 rounded-xl active:scale-95 transition-all"
                    >
                      <MessageCircle size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
