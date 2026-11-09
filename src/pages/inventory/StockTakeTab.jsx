import { useState, useEffect, useMemo } from 'react'
import { ClipboardCheck, CheckCircle2 } from 'lucide-react'
import {
  useStockCounts, useStockCount, useCountSheet, useSubmitStockCount, useDecideCountLines, useWeeklyCountStatus,
} from '../../hooks/useStockFlow'
import { useWarehouses, useProducts } from '../../hooks/useBusinesses'
import { useAuthStore } from '../../stores/authStore'
import { allowedWarehouseIds } from '../../lib/inventoryAccess'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { Select, Textarea } from '../../components/ui/Input'
import { SkeletonList } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'
import { formatDate, formatDateTime } from '../../utils/format'

const LINE_STATUS = {
  matched:  { label: 'Matches',            color: 'bg-green-50 text-green-700' },
  pending:  { label: 'Awaiting CEO',       color: 'bg-amber-50 text-amber-700' },
  approved: { label: 'Approved — corrected', color: 'bg-blue-50 text-blue-700' },
  rejected: { label: 'Rejected — no change', color: 'bg-gray-100 text-gray-600' },
}

const signed = (n) => (n > 0 ? `+${n}` : String(n))

// Weekly stock take: the inventory manager counts warehouses and park
// goods WITHOUT seeing the app's figures; the app compares, and only the
// CEO can approve a correction (logged as a stock count adjustment).
export function StockTakeTab({ canCount }) {
  const { user } = useAuthStore()
  const isCeo = ['ceo', 'super_admin'].includes(user?.role)
  const { data: counts, isLoading } = useStockCounts()
  const status = useWeeklyCountStatus()
  const [counting, setCounting] = useState(false)
  const [openId, setOpenId] = useState(null)

  if (counts === null) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
        <p className="font-semibold mb-1">Stock take not set up yet</p>
        <p>Run the "Inventory v2" section of <span className="font-mono text-xs">supabase/migrations.sql</span> in the Supabase SQL editor.</p>
      </div>
    )
  }

  const isMonday = new Date().getDay() === 1
  return (
    <div className="space-y-3">
      <div className={`rounded-lg p-4 border ${status.doneThisWeek ? 'bg-green-50 border-green-100' : 'bg-amber-50 border-amber-200'}`}>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Week of {formatDate(status.weekStart)}</p>
        {status.doneThisWeek ? (
          <p className="text-sm font-semibold text-green-800 mt-1 flex items-center gap-1.5">
            <CheckCircle2 size={16} /> {status.thisWeek.length} count{status.thisWeek.length !== 1 ? 's' : ''} submitted this week
          </p>
        ) : (
          <p className="text-sm font-semibold text-amber-800 mt-1">
            {isMonday ? 'Today is stock count day — ' : ''}This week's stock count is due (every Monday)
          </p>
        )}
        <p className="text-xs text-gray-600 mt-1">
          Count each warehouse and the goods at parks. You won't see the app's numbers while counting — the app
          compares afterwards and sends any differences to the CEO.
        </p>
        {canCount && (
          <Button className="w-full mt-3" onClick={() => setCounting(true)}>
            <ClipboardCheck size={16} className="mr-1" /> Start a Count
          </Button>
        )}
      </div>

      {isCeo && status.pendingApproval.length > 0 && (
        <p className="text-xs font-semibold text-amber-700">
          {status.pendingApproval.length} count{status.pendingApproval.length !== 1 ? 's' : ''} waiting for your approval
        </p>
      )}

      {isLoading ? <SkeletonList count={3} /> : (counts || []).length === 0 ? (
        <EmptyState icon={<ClipboardCheck size={28} />} title="No counts yet"
          description="Submitted stock counts and their differences appear here" />
      ) : counts.map(c => {
        const lines = c.lines || []
        const diffs = lines.filter(l => l.variance !== 0)
        const pending = lines.filter(l => l.status === 'pending').length
        return (
          <button key={c.id} onClick={() => setOpenId(c.id)}
            className="w-full text-left bg-white rounded-lg border border-line p-4 active:bg-gray-50">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-gray-900">
                {c.scope === 'park' ? 'Goods at Park' : `${c.warehouse?.name || 'Warehouse'}${c.warehouse?.state ? ` · ${c.warehouse.state}` : ''}`}
              </p>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${pending ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'}`}>
                {pending ? `${pending} TO APPROVE` : 'DONE'}
              </span>
            </div>
            <p className="text-xs text-gray-600 mt-1">
              {lines.length} item{lines.length !== 1 ? 's' : ''} counted · {diffs.length === 0 ? 'everything matched' : `${diffs.length} difference${diffs.length !== 1 ? 's' : ''}`}
            </p>
            <p className="text-[11px] text-gray-400 mt-0.5">
              Week of {formatDate(c.week_start)} · {c.counted_by_name || '—'} · {formatDateTime(c.submitted_at)}
            </p>
          </button>
        )
      })}

      {counting && <CountModal onClose={() => setCounting(false)} />}
      {openId && <CountReport id={openId} isCeo={isCeo && !user?._preview} onClose={() => setOpenId(null)} />}
    </div>
  )
}

function CountModal({ onClose }) {
  const { user } = useAuthStore()
  const { data: allWarehouses } = useWarehouses()
  // Only the warehouses this person is allowed to see
  const allowedIds = allowedWarehouseIds(user)
  const warehouses = (allWarehouses || []).filter(w => !allowedIds || allowedIds.includes(w.id))
  const { data: products } = useProducts()
  const submit = useSubmitStockCount()
  const [target, setTarget] = useState('')            // warehouse id or 'park'
  const scope = target === 'park' ? 'park' : 'warehouse'
  const sheetQ = useCountSheet(target ? scope : null, scope === 'warehouse' ? target : null)
  const [entries, setEntries] = useState([])
  const [addId, setAddId] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    setEntries((sheetQ.data || []).map(i => ({ ...i, counted: '' })))
  }, [sheetQ.data])

  const listed = useMemo(() => new Set(entries.map(e => e.product_id)), [entries])
  const warehouse = (warehouses || []).find(w => w.id === target)
  const filled = entries.filter(e => e.counted !== '').length

  function setCount(key, value) {
    setEntries(list => list.map(e => (e.key === key ? { ...e, counted: value.replace(/[^0-9]/g, '') } : e)))
  }

  return (
    <Modal isOpen onClose={onClose} size="lg" title="Stock Count"
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
          <Button className="flex-1" loading={submit.isPending} disabled={!target || filled === 0}
            onClick={async () => {
              if (filled < entries.length && !window.confirm(`${entries.length - filled} item(s) have no count and will be skipped. Submit anyway?`)) return
              try {
                await submit.mutateAsync({ scope, warehouse, entries, notes: notes.trim() })
                onClose()
              } catch { /* toast already shown */ }
            }}>
            Submit Count ({filled})
          </Button>
        </div>
      }>
      <div className="space-y-3">
        <Select label="What are you counting?" value={target} onChange={e => setTarget(e.target.value)}>
          <option value="">Choose…</option>
          {(warehouses || []).map(w => <option key={w.id} value={w.id}>{w.name} ({w.state})</option>)}
          <option value="park">Goods at Park (all parks)</option>
        </Select>

        {target && (
          sheetQ.isLoading ? <SkeletonList count={4} /> : (
            <>
              <p className="text-xs text-gray-500">
                {scope === 'park'
                  ? 'Confirm each item at the parks (call the contact if needed). Enter 0 if it is no longer there.'
                  : 'Count what is physically on the shelves, including items awaiting inspection. Enter 0 if none.'}
              </p>
              {entries.length === 0 && <p className="text-sm text-gray-500">Nothing on record here yet{scope === 'warehouse' ? ' — add products below.' : '.'}</p>}
              <div className="divide-y divide-gray-100 border border-gray-100 rounded-xl">
                {entries.map(e => (
                  <div key={e.key} className="flex items-center gap-3 px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900 truncate">{e.product_name}</p>
                      {(e.location_label || e.detail) && (
                        <p className="text-[11px] text-gray-500 truncate">{[e.location_label, e.detail].filter(Boolean).join(' · ')}</p>
                      )}
                    </div>
                    <input
                      inputMode="numeric" placeholder="Qty" value={e.counted}
                      onChange={ev => setCount(e.key, ev.target.value)}
                      className="w-20 shrink-0 border border-gray-200 rounded-lg px-2 py-2 text-right text-sm font-semibold focus:outline-none focus:border-blue-500" />
                  </div>
                ))}
              </div>
              {scope === 'warehouse' && (
                <div className="flex gap-2 items-end">
                  <div className="flex-1 min-w-0">
                    <Select label="Found something not on the list?" value={addId} onChange={e => setAddId(e.target.value)}>
                      <option value="">Choose product…</option>
                      {(products || []).filter(p => !listed.has(p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </Select>
                  </div>
                  <Button size="sm" variant="secondary" disabled={!addId} onClick={() => {
                    const p = (products || []).find(x => x.id === addId)
                    if (p) setEntries(list => [...list, { key: `p:${p.id}`, product_id: p.id, product_name: p.name, counted: '' }])
                    setAddId('')
                  }}>Add</Button>
                </div>
              )}
              <Textarea label="Notes (optional)" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
            </>
          )
        )}
      </div>
    </Modal>
  )
}

function CountReport({ id, isCeo, onClose }) {
  const { data: count, isLoading } = useStockCount(id)
  const decide = useDecideCountLines()
  const lines = count?.lines || []
  const diffs = lines.filter(l => l.variance !== 0)
  const pending = lines.filter(l => l.status === 'pending')
  const matched = lines.filter(l => l.variance === 0)

  async function run(selected, decision) {
    if (decision === 'approve' && !window.confirm(`Correct the app's stock for ${selected.length} item(s) to match the count?`)) return
    try { await decide.mutateAsync({ count, lines: selected, decision }) } catch { /* toast shown */ }
  }

  return (
    <Modal isOpen onClose={onClose} size="lg"
      title={count ? (count.scope === 'park' ? 'Goods at Park count' : `${count.warehouse?.name || 'Warehouse'} count`) : 'Stock count'}
      footer={isCeo && pending.length > 0 ? (
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" loading={decide.isPending} onClick={() => run(pending, 'reject')}>Reject all</Button>
          <Button className="flex-1" loading={decide.isPending} onClick={() => run(pending, 'approve')}>Approve all ({pending.length})</Button>
        </div>
      ) : null}>
      {isLoading || !count ? <SkeletonList count={4} /> : (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            Week of {formatDate(count.week_start)} · counted by {count.counted_by_name || '—'} · {formatDateTime(count.submitted_at)}
            {count.approved_by_name ? ` · closed by ${count.approved_by_name}` : ''}
          </p>
          {count.notes && <p className="text-xs text-gray-600">Notes: {count.notes}</p>}
          {!isCeo && pending.length > 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 rounded-lg p-2">Only the CEO can approve corrections. Stock is unchanged until then.</p>
          )}

          {diffs.length > 0 && (
            <div className="border border-gray-100 rounded-xl divide-y divide-gray-100">
              <div className="grid grid-cols-12 gap-1 px-3 py-2 text-[11px] font-semibold text-gray-400 uppercase">
                <span className="col-span-6">Item</span><span className="col-span-2 text-right">App</span>
                <span className="col-span-2 text-right">Count</span><span className="col-span-2 text-right">Diff</span>
              </div>
              {diffs.map(l => {
                const st = LINE_STATUS[l.status] || LINE_STATUS.pending
                return (
                  <div key={l.id} className="px-3 py-2 space-y-1.5">
                    <div className="grid grid-cols-12 gap-1 items-center">
                      <div className="col-span-6 min-w-0">
                        <p className="text-sm text-gray-900 truncate">{l.product_name}{(l.color || l.size) ? <span className="text-gray-500"> · {[l.color, l.size].filter(Boolean).join(' / ')}</span> : null}</p>
                        {l.location_label && <p className="text-[11px] text-gray-500 truncate">{l.location_label}</p>}
                      </div>
                      <span className="col-span-2 text-right text-sm text-gray-600">{l.system_qty}</span>
                      <span className="col-span-2 text-right text-sm font-semibold text-gray-900">{l.counted_qty}</span>
                      <span className={`col-span-2 text-right text-sm font-bold ${l.variance < 0 ? 'text-red-600' : 'text-blue-600'}`}>{signed(l.variance)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${st.color}`}>
                        {st.label}{l.decided_by_name ? ` · ${l.decided_by_name}` : ''}
                      </span>
                      {isCeo && l.status === 'pending' && (
                        <div className="flex gap-1.5">
                          <Button size="sm" variant="secondary" loading={decide.isPending} onClick={() => run([l], 'reject')}>Reject</Button>
                          <Button size="sm" loading={decide.isPending} onClick={() => run([l], 'approve')}>Approve</Button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <p className="text-xs text-gray-500">
            {matched.length} item{matched.length !== 1 ? 's' : ''} matched exactly{diffs.length === 0 ? ' — nothing to correct.' : '.'}
          </p>
          {matched.length > 0 && (
            <details className="text-xs text-gray-600">
              <summary className="cursor-pointer">Show matched items</summary>
              <ul className="mt-1 space-y-0.5">
                {matched.map(l => <li key={l.id}>{l.product_name}{(l.color || l.size) ? ` · ${[l.color, l.size].filter(Boolean).join(' / ')}` : ''}{l.location_label ? ` (${l.location_label})` : ''} — {l.counted_qty}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}
    </Modal>
  )
}
