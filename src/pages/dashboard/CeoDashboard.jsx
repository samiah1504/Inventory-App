import { useNavigate } from 'react-router-dom'
import { ShoppingCart, DollarSign, Package, AlertTriangle, Users, Plus, BarChart3 } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useOrders } from '../../hooks/useOrders'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { StatCard } from '../../components/ui/Card'
import { SkeletonList } from '../../components/ui/Skeleton'
import { formatCurrency, formatDate } from '../../utils/format'
import { StatusBadge } from '../../components/ui/Badge'

function today() {
  return new Date().toISOString().split('T')[0]
}

export function CeoDashboard() {
  const { user } = useAuthStore()
  const navigate = useNavigate()

  const todayOrders = useOrders({ date_from: `${today()}T00:00:00`, date_to: `${today()}T23:59:59` })
  const recentOrders = useOrders({ limit: 8 })
  const paidToday = useOrders({ status: 'paid', date_from: `${today()}T00:00:00` })
  const partialOrders = useOrders({ status: 'partially_paid' })

  const totalCount = useQuery({
    queryKey: ['orders_total_count'],
    queryFn: async () => {
      const { count, error } = await supabase.from('orders').select('*', { count: 'exact', head: true })
      if (error) throw error
      return count || 0
    },
    staleTime: 60000,
  })

  const totalSalesToday = (paidToday.data || []).reduce((s, o) => s + Number(o.total_amount), 0)
  const outstandingBalance = (partialOrders.data || []).reduce((s, o) => s + Number(o.balance_amount || 0), 0)

  return (
    <div className="overflow-y-auto h-full">
      {/* Header */}
      <div className="bg-blue-600 text-white px-4 pt-12 pb-6">
        <p className="text-blue-200 text-sm">Good {greeting()}, 👋</p>
        <h1 className="text-2xl font-bold">{user?.name}</h1>
        <p className="text-blue-200 text-sm mt-0.5">{formatDate(new Date().toISOString())}</p>
      </div>

      <div className="px-4 -mt-4 space-y-4 pb-6">
        {/* Stats row */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="Orders Today"
            value={todayOrders.isLoading ? '...' : (todayOrders.data?.length || 0)}
            icon={<ShoppingCart size={20} />}
            color="blue"
            onClick={() => navigate('/orders')}
          />
          <StatCard
            label="Sales Today"
            value={paidToday.isLoading ? '...' : formatCurrency(totalSalesToday)}
            icon={<DollarSign size={20} />}
            color="green"
          />
          <StatCard
            label="Outstanding"
            value={partialOrders.isLoading ? '...' : formatCurrency(outstandingBalance)}
            icon={<AlertTriangle size={20} />}
            color="amber"
            sub={`${partialOrders.data?.length || 0} partial orders`}
            onClick={() => navigate('/orders?status=partially_paid')}
          />
          <StatCard
            label="Total Orders"
            value={totalCount.isLoading ? '...' : (totalCount.data || 0)}
            icon={<BarChart3 size={20} />}
            color="purple"
            onClick={() => navigate('/reports')}
          />
        </div>

        {/* Quick Actions */}
        <div className="bg-white rounded-2xl p-4 border border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Quick Actions</h3>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'New Order', icon: Plus, action: () => navigate('/orders/new'), color: 'bg-blue-50 text-blue-600' },
              { label: 'Reports', icon: BarChart3, action: () => navigate('/reports'), color: 'bg-purple-50 text-purple-600' },
              { label: 'Staff', icon: Users, action: () => navigate('/settings/staff'), color: 'bg-green-50 text-green-600' },
              { label: 'Inventory', icon: Package, action: () => navigate('/inventory'), color: 'bg-amber-50 text-amber-600' },
              { label: 'Customers', icon: Users, action: () => navigate('/customers'), color: 'bg-pink-50 text-pink-600' },
              { label: 'Accounting', icon: DollarSign, action: () => navigate('/accounting'), color: 'bg-teal-50 text-teal-600' },
            ].map(({ label, icon: Icon, action, color }) => (
              <button
                key={label}
                onClick={action}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-xl ${color} active:scale-95 transition-all`}
              >
                <Icon size={20} />
                <span className="text-xs font-medium">{label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Recent Orders */}
        <div className="bg-white rounded-2xl border border-gray-100">
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <h3 className="text-sm font-semibold text-gray-900">Recent Orders</h3>
            <button onClick={() => navigate('/orders')} className="text-xs text-blue-600 font-medium">View all</button>
          </div>
          {recentOrders.isLoading ? (
            <div className="px-4 pb-4"><SkeletonList count={3} /></div>
          ) : (
            <div className="divide-y divide-gray-50">
              {(recentOrders.data || []).map(order => (
                <button
                  key={order.id}
                  onClick={() => navigate(`/orders/${order.id}`)}
                  className="w-full px-4 py-3 text-left hover:bg-gray-50 active:bg-gray-100 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-gray-500">{order.order_number}</span>
                        <StatusBadge status={order.status} />
                      </div>
                      <p className="text-sm font-medium text-gray-900 mt-0.5">{order.customer_name}</p>
                      <p className="text-xs text-gray-500">{order.product_name} · {order.state}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-gray-900">{formatCurrency(order.total_amount)}</p>
                      <p className="text-xs text-gray-400">{formatDate(order.created_at)}</p>
                    </div>
                  </div>
                </button>
              ))}
              {recentOrders.data?.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-8">No orders yet</p>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}
