import { useNavigate } from 'react-router-dom'
import { ShoppingCart, Truck, Package, FileText, BarChart3, Users, DollarSign } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useOrders } from '../../hooks/useOrders'
import { StatCard } from '../../components/ui/Card'

function today() { return new Date().toISOString().split('T')[0] }

export function OperationsManagerDashboard() {
  const { user } = useAuthStore()
  const navigate = useNavigate()

  const todayOrders = useOrders({ date_from: `${today()}T00:00:00` })
  const processing = useOrders({ status: 'processing' })
  const waybilled = useOrders({ status: 'waybilled' })
  const awaitingWaybill = useOrders({ status: 'awaiting_waybill' })

  return (
    <div className="overflow-y-auto h-full">
      <div className="bg-blue-600 text-white px-4 pt-12 pb-6">
        <p className="text-blue-200 text-sm">Operations Manager</p>
        <h1 className="text-2xl font-bold">{user?.name}</h1>
        <p className="text-blue-200 text-sm mt-0.5">{user?.staff_code}</p>
      </div>
      <div className="px-4 -mt-4 space-y-4 pb-6">
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="Orders Today"
            value={todayOrders.data?.length ?? '...'}
            icon={<ShoppingCart size={20} />}
            color="blue"
            onClick={() => navigate('/orders')}
          />
          <StatCard
            label="Processing"
            value={processing.data?.length ?? '...'}
            icon={<Package size={20} />}
            color="green"
            onClick={() => navigate('/fulfillment?tab=processing')}
          />
          <StatCard
            label="Waybilled"
            value={waybilled.data?.length ?? '...'}
            icon={<Truck size={20} />}
            color="purple"
            onClick={() => navigate('/fulfillment?tab=waybilled')}
          />
          <StatCard
            label="Awaiting Waybill"
            value={awaitingWaybill.data?.length ?? '...'}
            icon={<Truck size={20} />}
            color="amber"
            onClick={() => navigate('/fulfillment?tab=awaiting_waybill')}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => navigate('/documents')}
            className="py-3.5 bg-white border border-gray-200 rounded-2xl text-sm font-medium text-gray-700 flex flex-col items-center gap-1.5 active:scale-95 transition-all"
          >
            <FileText size={20} className="text-blue-600" />
            Documents
          </button>
          <button
            onClick={() => navigate('/reports')}
            className="py-3.5 bg-white border border-gray-200 rounded-2xl text-sm font-medium text-gray-700 flex flex-col items-center gap-1.5 active:scale-95 transition-all"
          >
            <BarChart3 size={20} className="text-purple-600" />
            Reports
          </button>
          <button
            onClick={() => navigate('/customers')}
            className="py-3.5 bg-white border border-gray-200 rounded-2xl text-sm font-medium text-gray-700 flex flex-col items-center gap-1.5 active:scale-95 transition-all"
          >
            <Users size={20} className="text-green-600" />
            Customers
          </button>
          <button
            onClick={() => navigate('/fulfillment')}
            className="py-3.5 bg-white border border-gray-200 rounded-2xl text-sm font-medium text-gray-700 flex flex-col items-center gap-1.5 active:scale-95 transition-all"
          >
            <Truck size={20} className="text-amber-600" />
            Fulfillment
          </button>
          <button
            onClick={() => navigate('/accounting')}
            className="py-3.5 bg-white border border-gray-200 rounded-2xl text-sm font-medium text-gray-700 flex flex-col items-center gap-1.5 active:scale-95 transition-all"
          >
            <DollarSign size={20} className="text-teal-600" />
            Accounting
          </button>
        </div>
      </div>
    </div>
  )
}
