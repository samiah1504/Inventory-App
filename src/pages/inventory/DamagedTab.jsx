import { useState, useMemo } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useDamagedGoods, useResolveDamaged, DAMAGED_STATUSES, DAMAGE_SOURCES } from '../../hooks/useStockFlow'
import { useWarehouses } from '../../hooks/useBusinesses'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { Select, Textarea } from '../../components/ui/Input'
import { SkeletonList } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'
import { formatDate } from '../../utils/format'

const OUTCOMES = [
  { value: 'repair',          label: 'Send for repair',        desc: 'Stays on this list as Awaiting Repair' },
  { value: 'repaired',        label: 'Repaired — back in stock', desc: 'Added back to a warehouse as sellable stock' },
  { value: 'supplier_return', label: 'Returned to supplier',   desc: 'Closed — gone back to the supplier' },
  { value: 'written_off',     label: 'Write off',              desc: 'Closed — cannot be sold or repaired' },
]

// Every damaged item, wherever it was found (warehouse, transit, park,
// customer return, delivery)
export function DamagedTab({ canManage }) {
  const [showClosed, setShowClosed] = useState(false)
  const [sourceFilter, setSourceFilter] = useState('')
  const { data: rows, isLoading } = useDamagedGoods(showClosed)
  const { data: warehouses } = useWarehouses()
  const resolve = useResolveDamaged()
  const [item, setItem] = useState(null)
  const [form, setForm] = useState({ outcome: '', warehouse_id: '', note: '' })

  const list = useMemo(() => (rows || []).filter(r => !sourceFilter || r.source === sourceFilter), [rows, sourceFilter])
  const totalUnits = list.filter(r => ['damaged', 'repair'].includes(r.status)).reduce((s, r) => s + Number(r.quantity || 0), 0)

  if (rows === null) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
        <p className="font-semibold mb-1">Damaged goods not set up yet</p>
        <p>Run the "Inventory v2" section of <span className="font-mono text-xs">supabase/migrations.sql</span> in the Supabase SQL editor.</p>
      </div>
    )
  }

  const outcomes = OUTCOMES.filter(o => !(item?.status === 'repair' && o.value === 'repair'))

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="flex-1 min-w-0">
          <Select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}>
            <option value="">Found anywhere</option>
            {Object.entries(DAMAGE_SOURCES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </div>
        <button onClick={() => setShowClosed(v => !v)}
          className={`shrink-0 px-3 rounded-xl text-xs font-medium border ${showClosed ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200'}`}>
          {showClosed ? 'All records' : 'Open only'}
        </button>
      </div>
      <p className="text-xs text-gray-500">
        {totalUnits} damaged unit{totalUnits !== 1 ? 's' : ''} not yet settled. Damaged goods are never counted as sellable stock.
      </p>

      {isLoading ? <SkeletonList count={4} /> : list.length === 0 ? (
        <EmptyState icon={<AlertTriangle size={28} />} title="No damaged goods"
          description="Anything tagged damaged — in a warehouse, in transit, at a park or on return — appears here" />
      ) : list.map(r => {
        const st = DAMAGED_STATUSES[r.status] || { label: r.status, color: 'bg-gray-100 text-gray-600' }
        const open = ['damaged', 'repair'].includes(r.status)
        return (
          <div key={r.id} className="bg-white rounded-lg border border-line p-4 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${st.color}`}>{st.label.toUpperCase()}</span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                {DAMAGE_SOURCES[r.source] || r.source}
              </span>
            </div>
            <p className="text-sm font-semibold text-gray-900">{r.quantity} × {r.product_name}
              {(r.color || r.size) && <span className="font-normal text-mute"> · {[r.color, r.size].filter(Boolean).join(' / ')}</span>}</p>
            <p className="text-xs text-gray-600">
              {[r.warehouse?.name, r.location_note, r.state].filter(Boolean).join(' · ') || 'Location not recorded'}
            </p>
            {r.reason && <p className="text-xs text-gray-500">Reason: {r.reason}</p>}
            {r.order_number && <p className="text-xs text-gray-500">Order {r.order_number}</p>}
            {r.resolved_note && <p className="text-xs text-gray-500">{r.resolved_note}</p>}
            <p className="text-[11px] text-gray-400">
              {formatDate(r.created_at)}{r.recorded_by_name ? ` · ${r.recorded_by_name}` : ''}
              {r.resolved_by_name ? ` · settled by ${r.resolved_by_name}` : ''}
            </p>
            {open && canManage && (
              <Button size="sm" variant="secondary" className="w-full mt-1"
                onClick={() => { setForm({ outcome: '', warehouse_id: r.warehouse_id || '', note: '' }); setItem(r) }}>
                Update status
              </Button>
            )}
          </div>
        )
      })}

      <Modal isOpen={!!item} onClose={() => setItem(null)} title={item ? `${item.quantity} × ${item.product_name}` : ''}
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setItem(null)} className="flex-1">Cancel</Button>
            <Button className="flex-1" loading={resolve.isPending}
              disabled={!form.outcome || (form.outcome === 'repaired' && !form.warehouse_id)}
              onClick={async () => {
                try {
                  await resolve.mutateAsync({
                    item, outcome: form.outcome, note: form.note.trim(),
                    warehouse: (warehouses || []).find(w => w.id === form.warehouse_id),
                  })
                  setItem(null)
                } catch { /* toast already shown */ }
              }}>Save</Button>
          </div>
        }>
        <div className="space-y-3">
          {outcomes.map(o => (
            <button key={o.value} type="button" onClick={() => setForm({ ...form, outcome: o.value })}
              className={`w-full text-left p-3 rounded-xl border-2 ${form.outcome === o.value ? 'border-blue-600 bg-blue-50' : 'border-gray-200'}`}>
              <span className="block text-sm font-semibold text-gray-900">{o.label}</span>
              <span className="block text-xs text-gray-500">{o.desc}</span>
            </button>
          ))}
          {form.outcome === 'repaired' && (
            <Select label="Back into which warehouse?" required value={form.warehouse_id} onChange={e => setForm({ ...form, warehouse_id: e.target.value })}>
              <option value="">Select warehouse…</option>
              {(warehouses || []).map(w => <option key={w.id} value={w.id}>{w.name} ({w.state})</option>)}
            </Select>
          )}
          <Textarea label="Note (optional)" rows={2} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} />
        </div>
      </Modal>
    </div>
  )
}
