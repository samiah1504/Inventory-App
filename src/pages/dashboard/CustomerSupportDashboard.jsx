import { useNavigate } from 'react-router-dom'
import { Plus, Phone, Clock, CheckCircle } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useOrders } from '../../hooks/useOrders'
import { StatCard } from '../../components/ui/Card'
import { StatusBadge } from '../../components/ui/Badge'
import { formatCurrency, formatDate } from '../../utils/format'
import { Button } from '../../components/ui/Button'
import { openDialer, openWhatsApp } from '../../utils/whatsapp'

export function CustomerSupportDashboard() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  const myOrders = useOrders({ statuses: ['new', 'awaiting_waybill'] })
  const myNewOrders = useOrders({ status: 'new' })

  return (
    <div className="overflow-y-auto h-full">
      <div className="bg-blue-600 text-white px-4 pt-12 pb-6">
        <p className="text-blue-200 text-sm">Welcome back 👋</p>
        <h1 className="text-2xl font-bold">{user?.name}</h1>
        <p className="text-blue-200 text-sm mt-0.5">Customer Support · {user?.staff_code}</p>
      </div>

      <div className="px-4 -mt-4 space-y-4 pb-6">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="My Active Orders"
            value={myOrders.isLoading ? '...' : (myOrders.data?.length || 0)}
            icon={<Clock size={20} />}
            color="blue"
            onClick={() => navigate('/orders')}
          />
          <StatCard
            label="New Orders"
            value={myNewOrders.isLoading ? '...' : (myNewOrders.data?.length || 0)}
            icon={<CheckCircle size={20} />}
            color="green"
          />
        </div>

        {/* Primary Action */}
        <Button size="xl" onClick={() => navigate('/orders/new')} className="w-full" leftIcon={<Plus size={20} />}>
          Create New Order
        </Button>

        {/* Recent Orders */}
        <div className="bg-white rounded-2xl border border-gray-100">
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <h3 className="text-sm font-semibold text-gray-900">My Orders</h3>
            <button onClick={() => navigate('/orders')} className="text-xs text-blue-600 font-medium">View all</button>
          </div>
          <div className="divide-y divide-gray-50">
            {(myOrders.data || []).slice(0, 10).map(order => (
              <div key={order.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0" onClick={() => navigate(`/orders/${order.id}`)} role="button">
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
                  </div>
                </div>
              </div>
            ))}
            {myOrders.data?.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-8">No active orders</p>
            )}
          </div>
        </div>

        <button onClick={logout} className="w-full py-3 text-sm text-red-600 font-medium">
          Sign Out
        </button>
      </div>
    </div>
  )
}
