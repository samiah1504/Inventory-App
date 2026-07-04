import { useNavigate } from 'react-router-dom'
import { Truck, Package, Clock, MapPin, CheckCircle, AlertTriangle } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useOrders } from '../../hooks/useOrders'
import { StatCard } from '../../components/ui/Card'
import { formatDate } from '../../utils/format'

export function FulfillmentDashboard() {
  const { user } = useAuthStore()
  const navigate = useNavigate()

  const today = new Date().toISOString().split('T')[0]
  const newOrders = useOrders({ status: 'new' })
  const awaitingWaybill = useOrders({ status: 'awaiting_waybill' })
  const waybilled = useOrders({ status: 'waybilled' })
  const atWarehouse = useOrders({ status: 'received_at_warehouse' })
  const processing = useOrders({ status: 'processing' })
  const todayDelivery = useOrders({ planned_delivery_date: today })
  const delivered = useOrders({ status: 'delivered' })
  const overdue = useOrders({ status: 'processing', planned_delivery_date_lt: today })

  return (
    <div className="overflow-y-auto h-full">
      <div className="bg-blue-600 text-white px-4 pt-12 pb-6">
        <p className="text-blue-200 text-sm">Fulfillment</p>
        <h1 className="text-2xl font-bold">{user?.name}</h1>
        <p className="text-blue-200 text-sm mt-0.5">{user?.staff_code}</p>
      </div>

      <div className="px-4 -mt-4 space-y-4 pb-6">
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="New Orders" value={newOrders.data?.length ?? '...'} icon={<Package size={20} />} color="blue"
            onClick={() => navigate('/fulfillment?tab=new')} />
          <StatCard label="Awaiting Waybill" value={awaitingWaybill.data?.length ?? '...'} icon={<Clock size={20} />} color="amber"
            onClick={() => navigate('/fulfillment?tab=awaiting_waybill')} />
          <StatCard label="Waybilled" value={waybilled.data?.length ?? '...'} icon={<Truck size={20} />} color="purple"
            onClick={() => navigate('/fulfillment?tab=waybilled')} />
          <StatCard label="At Warehouse" value={atWarehouse.data?.length ?? '...'} icon={<MapPin size={20} />} color="indigo"
            onClick={() => navigate('/fulfillment?tab=received_at_warehouse')} />
          <StatCard label="Processing" value={processing.data?.length ?? '...'} icon={<AlertTriangle size={20} />} color="green"
            onClick={() => navigate('/fulfillment?tab=processing')} />
          <StatCard label="Delivered (Unpaid)" value={delivered.data?.length ?? '...'} icon={<CheckCircle size={20} />} color="gray"
            onClick={() => navigate('/fulfillment?tab=delivered')} />
        </div>

        {/* Scheduled Today + Overdue */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => navigate('/fulfillment?tab=today')}
            className="bg-white rounded-2xl p-4 border border-gray-100 text-left active:scale-[0.99] transition-all"
          >
            <p className="text-xs text-gray-500 mb-1">Today</p>
            <p className="text-3xl font-bold text-blue-600">{todayDelivery.data?.length ?? '—'}</p>
            <p className="text-xs text-gray-400 mt-0.5">{formatDate(new Date().toISOString())}</p>
          </button>
          <button
            onClick={() => navigate('/fulfillment?tab=processing')}
            className={`rounded-2xl p-4 border text-left active:scale-[0.99] transition-all ${(overdue.data?.length ?? 0) > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-gray-100'}`}
          >
            <p className={`text-xs mb-1 ${(overdue.data?.length ?? 0) > 0 ? 'text-red-600 font-medium' : 'text-gray-500'}`}>Overdue</p>
            <p className={`text-3xl font-bold ${(overdue.data?.length ?? 0) > 0 ? 'text-red-600' : 'text-gray-400'}`}>
              {overdue.data?.length ?? '—'}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">Past delivery date</p>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => navigate('/fulfillment')}
            className="py-3.5 bg-blue-600 text-white rounded-2xl font-semibold text-sm active:scale-95 transition-all"
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
