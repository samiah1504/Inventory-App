import { useNavigate } from 'react-router-dom'
import { Truck, Package, Clock, MapPin } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useOrders } from '../../hooks/useOrders'
import { StatCard } from '../../components/ui/Card'
import { formatDate } from '../../utils/format'

export function FulfillmentDashboard() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  const newOrders = useOrders({ status: 'new' })
  const waybilled = useOrders({ status: 'waybilled' })
  const processing = useOrders({ status: 'processing' })
  const awaitingWaybill = useOrders({ status: 'awaiting_waybill' })
  const todayDelivery = useOrders({ planned_delivery_date: new Date().toISOString().split('T')[0] })

  return (
    <div className="overflow-y-auto h-full">
      <div className="bg-blue-600 text-white px-4 pt-12 pb-6">
        <p className="text-blue-200 text-sm">Fulfillment Dashboard</p>
        <h1 className="text-2xl font-bold">{user?.name}</h1>
      </div>

      <div className="px-4 -mt-4 space-y-4 pb-6">
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="New Orders" value={newOrders.data?.length || 0} icon={<Package size={20} />} color="blue"
            onClick={() => navigate('/fulfillment?tab=new')} />
          <StatCard label="Awaiting Waybill" value={awaitingWaybill.data?.length || 0} icon={<Clock size={20} />} color="amber"
            onClick={() => navigate('/fulfillment?tab=awaiting_waybill')} />
          <StatCard label="Waybilled" value={waybilled.data?.length || 0} icon={<Truck size={20} />} color="purple"
            onClick={() => navigate('/fulfillment?tab=waybilled')} />
          <StatCard label="Processing" value={processing.data?.length || 0} icon={<MapPin size={20} />} color="green"
            onClick={() => navigate('/fulfillment?tab=processing')} />
        </div>

        <div className="bg-white rounded-2xl p-4 border border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">Scheduled Today</h3>
          <p className="text-2xl font-bold text-blue-600">{todayDelivery.data?.length || 0}</p>
          <p className="text-xs text-gray-500">{formatDate(new Date().toISOString())}</p>
          <button onClick={() => navigate('/fulfillment?tab=today')}
            className="mt-3 text-sm text-blue-600 font-medium">View orders →</button>
        </div>

        <button onClick={() => navigate('/fulfillment')}
          className="w-full py-3.5 bg-blue-600 text-white rounded-2xl font-semibold text-sm active:scale-95 transition-all">
          Open Fulfillment Board
        </button>

        <button onClick={logout} className="w-full py-3 text-sm text-red-600 font-medium">Sign Out</button>
      </div>
    </div>
  )
}
