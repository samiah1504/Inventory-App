import { useNavigate } from 'react-router-dom'
import { Truck, Package, ArrowRight, ClipboardList } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useOrders } from '../../hooks/useOrders'
import { StatCard } from '../../components/ui/Card'

export function WaybillDashboard() {
  const { user } = useAuthStore()
  const navigate = useNavigate()

  const awaitingWaybill = useOrders({ status: 'awaiting_waybill' })
  const waybilled = useOrders({ status: 'waybilled' })
  const atWarehouse = useOrders({ status: 'received_at_warehouse' })

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
            value={awaitingWaybill.data?.length ?? '...'}
            icon={<Package size={20} />}
            color="amber"
            onClick={() => navigate('/waybill?tab=awaiting')}
          />
          <StatCard
            label="In Transit"
            value={waybilled.data?.length ?? '...'}
            icon={<Truck size={20} />}
            color="blue"
            onClick={() => navigate('/waybill?tab=waybilled')}
          />
          <StatCard
            label="At Warehouse"
            value={atWarehouse.data?.length ?? '...'}
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
