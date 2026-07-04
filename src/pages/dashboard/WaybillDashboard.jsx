import { useNavigate } from 'react-router-dom'
import { Truck, Package, ArrowRight, ClipboardList } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { StatCard } from '../../components/ui/Card'

export function WaybillDashboard() {
  const { user } = useAuthStore()
  const navigate = useNavigate()

  const counts = useQuery({
    queryKey: ['waybill_counts'],
    queryFn: async () => {
      const [awaitingR, waybilledR, atWarehouseR] = await Promise.all([
        supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'awaiting_waybill'),
        supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'waybilled'),
        supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'received_at_warehouse'),
      ])
      return {
        awaiting_waybill: awaitingR.count || 0,
        waybilled: waybilledR.count || 0,
        at_warehouse: atWarehouseR.count || 0,
      }
    },
    staleTime: 30000,
  })

  const c = counts.data
  const loading = counts.isLoading

  return (
    <div className="overflow-y-auto h-full">
      <div className="bg-blue-600 text-white px-4 pt-12 pb-6">
        <p className="text-blue-200 text-sm">Waybill</p>
        <h1 className="text-2xl font-bold">{user?.name}</h1>
        <p className="text-blue-200 text-sm mt-0.5">{user?.staff_code}</p>
      </div>
      <div className="px-4 -mt-4 space-y-4 pb-6">
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="Awaiting Waybill"
            value={loading ? '...' : c.awaiting_waybill}
            icon={<Package size={20} />}
            color="amber"
            onClick={() => navigate('/waybill?tab=awaiting')}
          />
          <StatCard
            label="In Transit"
            value={loading ? '...' : c.waybilled}
            icon={<Truck size={20} />}
            color="blue"
            onClick={() => navigate('/waybill?tab=waybilled')}
          />
          <StatCard
            label="At Warehouse"
            value={loading ? '...' : c.at_warehouse}
            icon={<ClipboardList size={20} />}
            color="green"
            onClick={() => navigate('/orders?status=received_at_warehouse')}
          />
          <StatCard
            label="Batches"
            value="View"
            icon={<Truck size={20} />}
            color="purple"
            onClick={() => navigate('/waybill?tab=batches')}
          />
        </div>
        <button
          onClick={() => navigate('/waybill')}
          className="w-full py-3.5 bg-blue-600 text-white rounded-2xl font-semibold text-sm active:scale-95 transition-all flex items-center justify-center gap-2"
        >
          Open Waybill Module <ArrowRight size={16} />
        </button>
      </div>
    </div>
  )
}
