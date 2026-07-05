import { useNavigate } from 'react-router-dom'
import { Truck, Package, Clock, MapPin, CheckCircle, AlertTriangle } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { StatCard } from '../../components/ui/Card'
import { formatDate } from '../../utils/format'

export function FulfillmentDashboard() {
  const { user } = useAuthStore()
  const navigate = useNavigate()

  const today = new Date().toISOString().split('T')[0]

  const counts = useQuery({
    queryKey: ['fulfillment_counts', today],
    queryFn: async () => {
      const [newR, awaitingR, waybilledR, atWarehouseR, processingR, deliveredR, todayR, overdueR] = await Promise.all([
        supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'new'),
        supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'awaiting_waybill'),
        supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'waybilled'),
        supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'received_at_warehouse'),
        supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'processing'),
        supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'delivered'),
        supabase.from('orders').select('*', { count: 'exact', head: true }).eq('planned_delivery_date', today),
        supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'processing').lt('planned_delivery_date', today),
      ])
      return {
        new: newR.count || 0,
        awaiting_waybill: awaitingR.count || 0,
        waybilled: waybilledR.count || 0,
        at_warehouse: atWarehouseR.count || 0,
        processing: processingR.count || 0,
        delivered: deliveredR.count || 0,
        today: todayR.count || 0,
        overdue: overdueR.count || 0,
      }
    },
    staleTime: 30000,
  })

  const c = counts.data
  const loading = counts.isLoading

  return (
    <div className="overflow-y-auto overflow-x-hidden h-full w-full">
      <div className="bg-gray-900 text-white px-4 pt-12 pb-6">
        <p className="text-yellow-400 text-sm font-medium">Fulfillment</p>
        <h1 className="text-2xl font-bold">{user?.name}</h1>
        <p className="text-gray-400 text-sm mt-0.5">{user?.staff_code}</p>
      </div>

      <div className="px-4 -mt-4 space-y-4 pb-6">
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="New Orders" value={loading ? '...' : c.new} icon={<Package size={20} />} color="blue"
            onClick={() => navigate('/fulfillment?tab=new')} />
          <StatCard label="Awaiting Waybill" value={loading ? '...' : c.awaiting_waybill} icon={<Clock size={20} />} color="amber"
            onClick={() => navigate('/fulfillment?tab=awaiting_waybill')} />
          <StatCard label="Waybilled" value={loading ? '...' : c.waybilled} icon={<Truck size={20} />} color="purple"
            onClick={() => navigate('/fulfillment?tab=waybilled')} />
          <StatCard label="At Warehouse" value={loading ? '...' : c.at_warehouse} icon={<MapPin size={20} />} color="indigo"
            onClick={() => navigate('/fulfillment?tab=received_at_warehouse')} />
          <StatCard label="Processing" value={loading ? '...' : c.processing} icon={<AlertTriangle size={20} />} color="green"
            onClick={() => navigate('/fulfillment?tab=processing')} />
          <StatCard label="Delivered (Unpaid)" value={loading ? '...' : c.delivered} icon={<CheckCircle size={20} />} color="gray"
            onClick={() => navigate('/fulfillment?tab=delivered')} />
        </div>

        {/* Scheduled Today + Overdue */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => navigate('/fulfillment?tab=today')}
            className="bg-white rounded-2xl p-4 border border-gray-100 text-left active:scale-[0.99] transition-all"
          >
            <p className="text-xs text-gray-500 mb-1">Today</p>
            <p className="text-3xl font-bold text-blue-600">{loading ? '—' : c.today}</p>
            <p className="text-xs text-gray-400 mt-0.5">{formatDate(new Date().toISOString())}</p>
          </button>
          <button
            onClick={() => navigate('/fulfillment?tab=processing')}
            className={`rounded-2xl p-4 border text-left active:scale-[0.99] transition-all ${(!loading && c.overdue > 0) ? 'bg-red-50 border-red-200' : 'bg-white border-gray-100'}`}
          >
            <p className={`text-xs mb-1 ${(!loading && c.overdue > 0) ? 'text-red-600 font-medium' : 'text-gray-500'}`}>Overdue</p>
            <p className={`text-3xl font-bold ${(!loading && c.overdue > 0) ? 'text-red-600' : 'text-gray-400'}`}>
              {loading ? '—' : c.overdue}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">Past delivery date</p>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => navigate('/fulfillment')}
            className="py-3.5 bg-blue-600 text-black rounded-2xl font-semibold text-sm active:scale-95 transition-all"
          >
            Fulfillment Board
          </button>
          <button
            onClick={() => navigate('/fulfillment?tab=by_state')}
            className="py-3.5 bg-white border border-gray-200 text-gray-700 rounded-2xl font-semibold text-sm active:scale-95 transition-all"
          >
            By State
          </button>
        </div>
      </div>
    </div>
  )
}
