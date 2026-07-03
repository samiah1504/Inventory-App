import { useNavigate } from 'react-router-dom'
import { Truck, Package, ArrowRight } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useOrders } from '../../hooks/useOrders'
import { StatCard } from '../../components/ui/Card'

export function WaybillDashboard() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  const awaitingWaybill = useOrders({ status: 'awaiting_waybill' })
  const waybilled = useOrders({ status: 'waybilled' })

  return (
    <div className="overflow-y-auto h-full">
      <div className="bg-blue-600 text-white px-4 pt-12 pb-6">
        <p className="text-blue-200 text-sm">Waybill Dashboard</p>
        <h1 className="text-2xl font-bold">{user?.name}</h1>
      </div>
      <div className="px-4 -mt-4 space-y-4 pb-6">
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Awaiting Waybill" value={awaitingWaybill.data?.length || 0} icon={<Package size={20} />} color="amber"
            onClick={() => navigate('/waybill?tab=awaiting')} />
          <StatCard label="Waybilled (In Transit)" value={waybilled.data?.length || 0} icon={<Truck size={20} />} color="blue"
            onClick={() => navigate('/waybill?tab=waybilled')} />
        </div>
        <button onClick={() => navigate('/waybill')}
          className="w-full py-3.5 bg-blue-600 text-white rounded-2xl font-semibold text-sm active:scale-95 transition-all flex items-center justify-center gap-2">
          Open Waybill Module <ArrowRight size={16} />
        </button>
        <button onClick={logout} className="w-full py-3 text-sm text-red-600 font-medium">Sign Out</button>
      </div>
    </div>
  )
}
