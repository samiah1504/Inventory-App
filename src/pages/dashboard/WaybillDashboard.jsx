import { useNavigate } from 'react-router-dom'
import { Truck, Package, ArrowRight, RotateCcw, CheckCircle, ChevronRight, Boxes } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { StatCard } from '../../components/ui/Card'
import { formatDate } from '../../utils/format'
import { scopeToBusinesses } from '../../lib/businessScope'
import { DisciplinaryBanner } from '../../components/staff/DisciplinaryBanner'

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
    queryKey: ['waybill_dashboard', user?.id],
    queryFn: async () => {
      const count = (builder) => builder.then(r => r.count || 0)
      const s = (q) => scopeToBusinesses(q, user)
      const [toPack, toDispatch, inTransit, completed, sentToPark, awaiting, holding, recentR] = await Promise.all([
        count(s(supabase.from('waybill_batches').select('*', { count: 'exact', head: true }).eq('status', 'created'))),
        count(s(supabase.from('waybill_batches').select('*', { count: 'exact', head: true }).eq('status', 'packed'))),
        count(s(supabase.from('waybill_batches').select('*', { count: 'exact', head: true }).in('status', ['waybilled', 'in_transit']))),
        count(s(supabase.from('waybill_batches').select('*', { count: 'exact', head: true }).eq('status', 'received'))),
        count(s(supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'sent_to_park'))),
        count(s(supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'awaiting_waybill'))),
        count(s(supabase.from('holding_queue').select('*', { count: 'exact', head: true }).in('status', ['holding', 'collected']))).catch(() => 0),
        s(supabase.from('waybill_batches')
          .select('id, batch_number, status, courier_company, destination_state, created_at')
          .order('created_at', { ascending: false })
          .limit(5)),
      ])
      return { toPack, toDispatch, inTransit, completed, sentToPark, awaiting, holding, recent: recentR.data || [] }
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

        {/* Unread disciplinary notice for this employee */}
        <DisciplinaryBanner />
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
