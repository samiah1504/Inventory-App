import { useNavigate } from 'react-router-dom'
import { Truck, Package, ArrowRight, RotateCcw, CheckCircle, ChevronRight, Boxes, DollarSign, Plus } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { StatCard } from '../../components/ui/Card'
import { formatDate } from '../../utils/format'

const BATCH_STATUS = {
  created:  { label: 'To Pack',    color: 'bg-blue-100 text-blue-700' },
  packed:   { label: 'To Dispatch', color: 'bg-purple-100 text-purple-700' },
  waybilled: { label: 'In Transit', color: 'bg-amber-100 text-amber-700' },
  in_transit: { label: 'In Transit', color: 'bg-amber-100 text-amber-700' },
  received: { label: 'Completed',  color: 'bg-green-100 text-green-700' },
}

export function WaybillDashboard() {
  const { user } = useAuthStore()
  const navigate = useNavigate()

  const dash = useQuery({
    queryKey: ['waybill_dashboard'],
    queryFn: async () => {
      const count = (builder) => builder.then(r => r.count || 0)
      const [toPack, toDispatch, inTransit, completed, sentToPark, awaiting, holding, recentR] = await Promise.all([
        count(supabase.from('waybill_batches').select('*', { count: 'exact', head: true }).eq('status', 'created')),
        count(supabase.from('waybill_batches').select('*', { count: 'exact', head: true }).eq('status', 'packed')),
        count(supabase.from('waybill_batches').select('*', { count: 'exact', head: true }).in('status', ['waybilled', 'in_transit'])),
        count(supabase.from('waybill_batches').select('*', { count: 'exact', head: true }).eq('status', 'received')),
        count(supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'sent_to_park')),
        count(supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'awaiting_waybill')),
        count(supabase.from('holding_queue').select('*', { count: 'exact', head: true }).in('status', ['holding', 'collected'])).catch(() => 0),
        supabase.from('waybill_batches')
          .select('id, batch_number, status, courier_company, destination_state, created_at')
          .order('created_at', { ascending: false })
          .limit(5),
      ])
      return { toPack, toDispatch, inTransit, completed, sentToPark, awaiting, holding, recent: recentR.data || [] }
    },
    staleTime: 30000,
  })

  // This officer's own business expenses this month (voided excluded)
  const myExpensesQ = useQuery({
    queryKey: ['waybill_my_expenses', user?.id],
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

  const c = dash.data
  const loading = dash.isLoading

  return (
    <div className="overflow-y-auto overflow-x-hidden h-full w-full">
      <div className="bg-gray-900 text-white px-4 pt-12 pb-6">
        <p className="text-yellow-400 text-sm font-medium">Waybill</p>
        <h1 className="text-2xl font-bold">{user?.name}</h1>
        <p className="text-gray-400 text-sm mt-0.5">{user?.staff_code}</p>
      </div>

      <div className="px-4 -mt-4 space-y-4 pb-6">
        {/* Waybill batches by stage */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="Batches to Pack"
            value={loading ? '...' : c.toPack}
            icon={<Boxes size={20} />}
            color="blue"
            onClick={() => navigate('/waybill?tab=batches')}
          />
          <StatCard
            label="Ready to Dispatch"
            value={loading ? '...' : c.toDispatch}
            icon={<Package size={20} />}
            color="purple"
            onClick={() => navigate('/waybill?tab=batches')}
          />
          <StatCard
            label="In Transit"
            value={loading ? '...' : c.inTransit}
            icon={<Truck size={20} />}
            color="amber"
            onClick={() => navigate('/waybill?tab=batches')}
          />
          <StatCard
            label="Completed"
            value={loading ? '...' : c.completed}
            icon={<CheckCircle size={20} />}
            color="green"
            onClick={() => navigate('/waybill?tab=batches')}
          />
        </div>

        {/* Work queues that need a new waybill */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="Awaiting Waybill"
            value={loading ? '...' : c.awaiting}
            icon={<Truck size={20} />}
            color={c?.awaiting > 0 ? 'amber' : 'gray'}
            sub="need a new batch"
            onClick={() => navigate('/waybill?tab=awaiting')}
          />
          <StatCard
            label="Sent Back to Park"
            value={loading ? '...' : c.sentToPark}
            icon={<RotateCcw size={20} />}
            color={c?.sentToPark > 0 ? 'amber' : 'gray'}
            sub="returns to re-ship"
            onClick={() => navigate('/waybill?tab=sent_to_park')}
          />
          <StatCard
            label="Holding Queue"
            value={loading ? '...' : c.holding}
            icon={<Package size={20} />}
            color={c?.holding > 0 ? 'blue' : 'gray'}
            sub="products usable as source"
            onClick={() => navigate('/holding')}
          />
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

        {/* Recent batches */}
        <div className="bg-white rounded-2xl border border-gray-100">
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <h3 className="text-sm font-semibold text-gray-900">Recent Waybills</h3>
            <button onClick={() => navigate('/waybill?tab=batches')} className="text-xs text-blue-600 font-medium">
              View all
            </button>
          </div>
          {loading ? (
            <div className="px-4 pb-4 space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-14 shimmer rounded-xl" />)}</div>
          ) : (c?.recent || []).length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No waybill batches yet</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {c.recent.map(b => {
                const st = BATCH_STATUS[b.status] || { label: b.status, color: 'bg-gray-100 text-gray-600' }
                return (
                  <button key={b.id} onClick={() => navigate(`/waybill/batches/${b.id}`)}
                    className="w-full px-4 py-3 text-left active:bg-gray-50 transition-colors">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-mono text-gray-500">{b.batch_number}</span>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${st.color}`}>{st.label}</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5 truncate">
                          {[b.courier_company, b.destination_state].filter(Boolean).join(' · ')} · {formatDate(b.created_at)}
                        </p>
                      </div>
                      <ChevronRight size={16} className="text-gray-300 shrink-0" />
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <button
          onClick={() => navigate('/waybill')}
          className="w-full py-3.5 bg-blue-600 text-black rounded-2xl font-semibold text-sm active:scale-95 transition-all flex items-center justify-center gap-2"
        >
          Open Waybill Module <ArrowRight size={16} />
        </button>
      </div>
    </div>
  )
}
