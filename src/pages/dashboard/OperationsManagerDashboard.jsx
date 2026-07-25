import { useNavigate } from 'react-router-dom'
import { ShoppingCart, Truck, Package, FileText, BarChart3, Users, DollarSign, ClipboardList, Inbox, ShieldQuestion, Warehouse } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { StatCard } from '../../components/ui/Card'
import { scopeToBusinesses } from '../../lib/businessScope'
import { DisciplinaryBanner } from '../../components/staff/DisciplinaryBanner'

function today() { return new Date().toISOString().split('T')[0] }

export function OperationsManagerDashboard() {
  const { user } = useAuthStore()
  const navigate = useNavigate()

  const counts = useQuery({
    queryKey: ['ops_counts', today()],
    queryFn: async () => {
      const s = (q) => scopeToBusinesses(q, user)
      const [todayR, processingR, waybilledR, awaitingR, holdingR, unverifiedR] = await Promise.all([
        s(supabase.from('orders').select('*', { count: 'exact', head: true }).gte('created_at', `${today()}T00:00:00`).lte('created_at', `${today()}T23:59:59`)),
        s(supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'processing')),
        s(supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'waybilled')),
        s(supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'awaiting_waybill')),
        s(supabase.from('holding_queue').select('*', { count: 'exact', head: true }).in('status', ['holding', 'collected'])).then(r => r, () => ({ count: 0 })),
        s(supabase.from('products').select('*', { count: 'exact', head: true }).eq('is_verified', false).eq('is_active', true)).then(r => r, () => ({ count: 0 })),
      ])
      return {
        today: todayR.count || 0,
        processing: processingR.count || 0,
        waybilled: waybilledR.count || 0,
        awaiting_waybill: awaitingR.count || 0,
        holding: holdingR.count || 0,
        unverified: unverifiedR.count || 0,
      }
    },
    staleTime: 30000,
  })

  const c = counts.data
  const loading = counts.isLoading

  return (
    <div className="overflow-y-auto overflow-x-hidden h-full w-full">
      <div className="bg-gray-900 text-white px-4 pt-12 pb-6">
        <p className="text-yellow-400 text-sm font-medium">Operations Manager</p>
        <h1 className="text-2xl font-bold">{user?.name}</h1>
        <p className="text-gray-400 text-sm mt-0.5">{user?.staff_code}</p>
      </div>
      <div className="px-4 -mt-4 space-y-4 pb-6">

        {/* Unread disciplinary notice for this employee */}
        <DisciplinaryBanner />
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="Orders Today"
            value={loading ? '...' : c.today}
            icon={<ShoppingCart size={20} />}
            color="blue"
            onClick={() => navigate('/orders')}
          />
          <StatCard
            label="Processing"
            value={loading ? '...' : c.processing}
            icon={<Package size={20} />}
            color="green"
            onClick={() => navigate('/fulfillment?tab=processing')}
          />
          <StatCard
            label="Waybilled"
            value={loading ? '...' : c.waybilled}
            icon={<Truck size={20} />}
            color="purple"
            onClick={() => navigate('/fulfillment?tab=waybilled')}
          />
          <StatCard
            label="Awaiting Waybill"
            value={loading ? '...' : c.awaiting_waybill}
            icon={<Truck size={20} />}
            color="amber"
            onClick={() => navigate('/fulfillment?tab=awaiting_waybill')}
          />
          <StatCard
            label="Holding Queue"
            value={loading ? '...' : c.holding}
            icon={<Inbox size={20} />}
            color={c?.holding > 0 ? 'amber' : 'gray'}
            sub="products at state parks"
            onClick={() => navigate('/holding')}
          />
          <StatCard
            label="Unverified Products"
            value={loading ? '...' : c.unverified}
            icon={<ShieldQuestion size={20} />}
            color={c?.unverified > 0 ? 'amber' : 'gray'}
            sub="need your review"
            onClick={() => navigate('/settings/products?tab=unverified')}
          />
        </div>

        <div className="bg-white rounded-2xl p-4 border border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Quick Actions</h3>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Orders', icon: ShoppingCart, action: () => navigate('/orders'), color: 'bg-blue-50 text-blue-600' },
              { label: 'Reports', icon: BarChart3, action: () => navigate('/reports'), color: 'bg-purple-50 text-purple-600' },
              { label: 'Documents', icon: FileText, action: () => navigate('/documents'), color: 'bg-blue-50 text-blue-700' },
              { label: 'Customers', icon: Users, action: () => navigate('/customers'), color: 'bg-green-50 text-green-600' },
              { label: 'Fulfillment', icon: Truck, action: () => navigate('/fulfillment'), color: 'bg-amber-50 text-amber-600' },
              { label: 'My Expenses', icon: DollarSign, action: () => navigate('/my-expenses'), color: 'bg-teal-50 text-teal-600' },
              { label: 'Holding', icon: Inbox, action: () => navigate('/holding'), color: 'bg-cyan-50 text-cyan-600' },
              { label: 'Products', icon: Package, action: () => navigate('/settings/products'), color: 'bg-indigo-50 text-indigo-600' },
              { label: 'Warehouses', icon: Warehouse, action: () => navigate('/settings/warehouses'), color: 'bg-orange-50 text-orange-600' },
            ].map(({ label, icon: Icon, action, color }) => (
              <button key={label} onClick={action}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-xl ${color} active:scale-95 transition-all`}>
                <Icon size={20} />
                <span className="text-xs font-medium">{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
