import { useNavigate } from 'react-router-dom'
import { Truck, Package, Clock, MapPin, CheckCircle, AlertTriangle, Inbox, DollarSign, Plus } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { StatCard } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { formatDate } from '../../utils/format'
import { useReceiveTransfer, useTransferAtPark } from '../../hooks/useInventory'

export function FulfillmentDashboard() {
  const { user } = useAuthStore()
  const navigate = useNavigate()

  const today = new Date().toISOString().split('T')[0]

  // Officers with assigned states only count orders in those states
  const myStates = Array.isArray(user?.assigned_states) && user.assigned_states.length > 0
    ? user.assigned_states : null

  const counts = useQuery({
    queryKey: ['fulfillment_counts', today, myStates],
    queryFn: async () => {
      const scoped = (q) => myStates ? q.in('state', myStates) : q
      const byStatus = (status) =>
        scoped(supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', status))

      const [newR, awaitingR, waybilledR, atParkR, pickedR, atWarehouseR, processingR, deliveredR, paidR, failedR, returnedR, todayR, overdueR] = await Promise.all([
        byStatus('new'),
        byStatus('awaiting_waybill'),
        byStatus('waybilled'),
        byStatus('arrived_at_park'),
        byStatus('picked_up_from_park'),
        byStatus('received_at_warehouse'),
        byStatus('processing'),
        byStatus('delivered'),
        byStatus('paid'),
        byStatus('failed_delivery'),
        byStatus('returned'),
        scoped(supabase.from('orders').select('*', { count: 'exact', head: true }).eq('planned_delivery_date', today)),
        scoped(supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'processing').lt('planned_delivery_date', today)),
      ])
      return {
        new: newR.count || 0,
        awaiting_waybill: awaitingR.count || 0,
        waybilled: waybilledR.count || 0,
        at_park: atParkR.count || 0,
        picked_up: pickedR.count || 0,
        at_warehouse: atWarehouseR.count || 0,
        processing: processingR.count || 0,
        delivered: deliveredR.count || 0,
        paid: paidR.count || 0,
        failed: failedR.count || 0,
        returned: returnedR.count || 0,
        today: todayR.count || 0,
        overdue: overdueR.count || 0,
      }
    },
    staleTime: 30000,
  })

  // Incoming transfers heading to this officer's state(s)
  const incomingQ = useQuery({
    queryKey: ['incoming_transfers', myStates],
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from('warehouse_transfers')
          .select(`
            *,
            product:products(name),
            from_warehouse:warehouses!warehouse_transfers_from_warehouse_id_fkey(name, state),
            to_warehouse:warehouses!warehouse_transfers_to_warehouse_id_fkey(name, state)
          `)
          .in('status', ['in_transit', 'at_park'])
          .order('created_at', { ascending: false })
        if (error) throw error
        const list = data || []
        return myStates ? list.filter(t => t.to_warehouse?.state && myStates.includes(t.to_warehouse.state)) : list
      } catch { return [] }
    },
    staleTime: 30000,
  })
  const receiveTransfer = useReceiveTransfer()
  const transferAtPark = useTransferAtPark()
  const incoming = incomingQ.data || []

  // Products held at parks in this officer's state(s)
  const holdingQ = useQuery({
    queryKey: ['holding_count', myStates],
    queryFn: async () => {
      try {
        let q = supabase.from('holding_queue')
          .select('*', { count: 'exact', head: true })
          .in('status', ['holding', 'collected'])
        if (myStates) q = q.in('state', myStates)
        const { count, error } = await q
        if (error) throw error
        return count || 0
      } catch { return 0 }
    },
    staleTime: 30000,
  })
  const holdingCount = holdingQ.data || 0

  // This officer's own business expenses this month (voided excluded)
  const myExpensesQ = useQuery({
    queryKey: ['my_expenses_month', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      try {
        const d = new Date(); d.setDate(1)
        const { data, error } = await supabase.from('expenses')
          .select('*')
          .eq('staff_id', user.id)
          .is('order_id', null)
          .gte('date', d.toISOString().split('T')[0])
        if (error) throw error
        return (data || []).filter(e => e.status !== 'voided')
          .reduce((s, e) => s + Number(e.amount || 0), 0)
      } catch { return 0 }
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
        {myStates && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {myStates.map(s => (
              <span key={s} className="text-[11px] font-medium bg-gray-800 text-yellow-400 px-2 py-0.5 rounded-full">{s}</span>
            ))}
          </div>
        )}
      </div>

      <div className="px-4 -mt-4 space-y-4 pb-6">

        {/* Incoming transfers to this officer's state(s) */}
        {incoming.length > 0 && (
          <div className="bg-white rounded-2xl border border-cyan-200 overflow-hidden">
            <div className="px-4 pt-4 pb-2 flex items-center gap-2 bg-cyan-50">
              <Inbox size={16} className="text-cyan-700" />
              <h3 className="text-sm font-semibold text-cyan-900">
                Incoming Transfer{incoming.length !== 1 ? 's' : ''} ({incoming.length})
              </h3>
            </div>
            <div className="divide-y divide-gray-50">
              {incoming.map(t => (
                <div key={t.id} className="px-4 py-3">
                  <p className="text-sm text-gray-800">
                    <span className="font-bold">{t.quantity}</span> × {t.product?.name || t.product_name}
                    {t.status === 'in_transit'
                      ? ` on the way from ${t.from_warehouse?.state || 'origin'} to ${t.to_warehouse?.state}`
                      : ` at the ${t.to_warehouse?.state} State Park`}
                  </p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{t.transfer_number}{t.notes ? ` · ${t.notes}` : ''}</p>
                  {t.status === 'in_transit' ? (
                    <div className="flex gap-2 mt-2">
                      <Button variant="secondary" size="sm" className="flex-1"
                        loading={transferAtPark.isPending}
                        onClick={() => transferAtPark.mutateAsync(t)}>
                        Received at State Park
                      </Button>
                      <Button size="sm" className="flex-1"
                        loading={receiveTransfer.isPending}
                        onClick={() => receiveTransfer.mutateAsync(t)}>
                        Received at Warehouse
                      </Button>
                    </div>
                  ) : (
                    <Button size="sm" className="w-full mt-2"
                      loading={receiveTransfer.isPending}
                      onClick={() => receiveTransfer.mutateAsync(t)}>
                      Receive into Warehouse
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <StatCard label="New / To Review" value={loading ? '...' : c.new} icon={<Package size={20} />} color="blue"
            onClick={() => navigate('/orders?status=new')} />
          <StatCard label="Awaiting Waybill" value={loading ? '...' : c.awaiting_waybill} icon={<Clock size={20} />} color="amber"
            onClick={() => navigate('/orders?status=awaiting_waybill')} />
          <StatCard label="Waybilled" value={loading ? '...' : c.waybilled} icon={<Truck size={20} />} color="purple"
            onClick={() => navigate('/orders?status=waybilled')} />
          <StatCard label="At State Park" value={loading ? '...' : c.at_park} icon={<MapPin size={20} />} color="blue"
            onClick={() => navigate('/orders?status=arrived_at_park')} />
          <StatCard label="Picked Up from Park" value={loading ? '...' : c.picked_up} icon={<Truck size={20} />} color="green"
            onClick={() => navigate('/orders?status=picked_up_from_park')} />
          <StatCard label="At Warehouse" value={loading ? '...' : c.at_warehouse} icon={<MapPin size={20} />} color="indigo"
            onClick={() => navigate('/orders?status=received_at_warehouse')} />
          <StatCard label="Processing" value={loading ? '...' : c.processing} icon={<AlertTriangle size={20} />} color="green"
            onClick={() => navigate('/orders?status=processing')} />
          <StatCard label="Delivered (Unpaid)" value={loading ? '...' : c.delivered} icon={<CheckCircle size={20} />} color="gray"
            onClick={() => navigate('/orders?status=delivered')} />
          <StatCard label="Paid" value={loading ? '...' : c.paid} icon={<CheckCircle size={20} />} color="green"
            onClick={() => navigate('/orders?status=paid')} />
          <StatCard label="Failed / Returned" value={loading ? '...' : c.failed + c.returned} icon={<AlertTriangle size={20} />} color={c && (c.failed + c.returned) > 0 ? 'red' : 'gray'}
            onClick={() => navigate('/orders?status=failed_delivery')} />
          <StatCard label="Holding Queue" value={holdingQ.isLoading ? '...' : holdingCount} icon={<Inbox size={20} />} color={holdingCount > 0 ? 'amber' : 'gray'}
            onClick={() => navigate('/holding')} />
        </div>

        {/* Business expenses — logistics costs not tied to an order */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <DollarSign size={16} className="text-red-500 shrink-0" />
              <h3 className="text-sm font-semibold text-gray-900 truncate">Business Expenses</h3>
            </div>
            <span className="text-sm font-bold text-red-600 shrink-0">
              {myExpensesQ.isLoading ? '...' : `₦${Number(myExpensesQ.data || 0).toLocaleString()}`}
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">Your logistics costs this month — park charges, handling, storage</p>
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => navigate('/my-expenses?add=1')}
              className="flex-1 py-2.5 bg-blue-600 text-black rounded-xl font-semibold text-xs active:scale-95 transition-all flex items-center justify-center gap-1.5">
              <Plus size={14} /> Add Business Expense
            </button>
            <button
              onClick={() => navigate('/my-expenses')}
              className="flex-1 py-2.5 bg-gray-100 text-gray-700 rounded-xl font-semibold text-xs active:scale-95 transition-all">
              View My Expenses
            </button>
          </div>
        </div>

        {/* Scheduled Today + Overdue */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => navigate('/orders?status=today')}
            className="bg-white rounded-2xl p-4 border border-gray-100 text-left active:scale-[0.99] transition-all"
          >
            <p className="text-xs text-gray-500 mb-1">Today</p>
            <p className="text-3xl font-bold text-blue-600">{loading ? '—' : c.today}</p>
            <p className="text-xs text-gray-400 mt-0.5">{formatDate(new Date().toISOString())}</p>
          </button>
          <button
            onClick={() => navigate('/orders?status=processing')}
            className={`rounded-2xl p-4 border text-left active:scale-[0.99] transition-all ${(!loading && c.overdue > 0) ? 'bg-red-50 border-red-200' : 'bg-white border-gray-100'}`}
          >
            <p className={`text-xs mb-1 ${(!loading && c.overdue > 0) ? 'text-red-600 font-medium' : 'text-gray-500'}`}>Overdue</p>
            <p className={`text-3xl font-bold ${(!loading && c.overdue > 0) ? 'text-red-600' : 'text-gray-400'}`}>
              {loading ? '—' : c.overdue}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">Past delivery date</p>
          </button>
        </div>

        <button
          onClick={() => navigate('/orders')}
          className="w-full py-3.5 bg-blue-600 text-black rounded-2xl font-semibold text-sm active:scale-95 transition-all"
        >
          Open Orders Board
        </button>
      </div>
    </div>
  )
}
