import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Truck } from 'lucide-react'
import { useInTransit, useTransitAction, TRANSIT_STATUSES } from '../../hooks/useStockFlow'
import { useWarehouses } from '../../hooks/useBusinesses'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { Input, Select } from '../../components/ui/Input'
import { SkeletonList } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'
import { formatDate, NIGERIAN_STATES } from '../../utils/format'

const ageDays = (d) => Math.floor((Date.now() - new Date(d).getTime()) / 86400000)

// Goods that left a warehouse (or a park) and are on the road. Order
// goods settle automatically (paid → sold, received at warehouse →
// stock, failed → park / warehouse / damaged); the buttons here are for
// everything else.
export function TransitTab({ canManage }) {
  const navigate = useNavigate()
  const [showClosed, setShowClosed] = useState(false)
  const [stateFilter, setStateFilter] = useState('')
  const { data: rows, isLoading } = useInTransit(showClosed)
  const { data: warehouses } = useWarehouses()
  const act = useTransitAction()

  const [whRow, setWhRow] = useState(null)
  const [whId, setWhId] = useState('')
  const [parkRow, setParkRow] = useState(null)
  const [park, setPark] = useState({})

  const list = useMemo(() =>
    (rows || []).filter(r => !stateFilter || r.destination_state === stateFilter)
  , [rows, stateFilter])
  const states = useMemo(() =>
    [...new Set((rows || []).map(r => r.destination_state).filter(Boolean))].sort()
  , [rows])

  if (rows === null) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800">
        <p className="font-semibold mb-1">Goods in Transit not set up yet</p>
        <p>Run the "Inventory v2" section of <span className="font-mono text-xs">supabase/migrations.sql</span> in the Supabase SQL editor.</p>
      </div>
    )
  }

  async function run(args) {
    try { await act.mutateAsync(args); return true } catch { return false }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="flex-1 min-w-0">
          <Select value={stateFilter} onChange={e => setStateFilter(e.target.value)}>
            <option value="">All destinations</option>
            {states.map(s => <option key={s} value={s}>{s}</option>)}
          </Select>
        </div>
        <button onClick={() => setShowClosed(v => !v)}
          className={`shrink-0 px-3 rounded-xl text-xs font-medium border ${showClosed ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200'}`}>
          {showClosed ? 'All records' : 'In transit only'}
        </button>
      </div>
      <p className="text-xs text-gray-500">
        Goods waybilled out of a warehouse are removed from that warehouse immediately and listed here until
        the order is delivered and paid, they reach a warehouse, or they end up at a park.
      </p>

      {isLoading ? <SkeletonList count={4} /> : list.length === 0 ? (
        <EmptyState icon={<Truck size={28} />} title="Nothing in transit"
          description="Goods appear here when a waybill batch is marked Waybilled" />
      ) : list.map(r => {
        const st = TRANSIT_STATUSES[r.status] || { label: r.status, color: 'bg-gray-100 text-gray-600' }
        const age = ageDays(r.created_at)
        const open = r.status === 'in_transit'
        const orderClosed = r.order && ['cancelled', 'failed_delivery', 'returned'].includes(r.order.status)
        return (
          <div key={r.id} className="bg-white rounded-2xl border border-gray-100 p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${st.color}`}>{st.label.toUpperCase()}</span>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${open && age > 7 ? 'bg-red-50 text-red-700' : open && age > 3 ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
                {age === 0 ? 'today' : `${age} day${age !== 1 ? 's' : ''}`}
              </span>
            </div>
            <p className="text-sm font-semibold text-gray-900">
              {r.quantity} × {r.product_name}
              {(r.color || r.size) && <span className="text-xs font-normal text-gray-500"> · {[r.color, r.size].filter(Boolean).join(' · ')}</span>}
            </p>
            <p className="text-xs text-gray-600">
              {r.from_warehouse?.name || r.from_label || 'Unknown origin'} → {r.destination_state || '—'}
              {' '}({r.destination_type === 'warehouse' ? 'to warehouse' : 'to customer'})
            </p>
            {r.order_number && (
              <button onClick={() => r.order_id && navigate(`/orders/${r.order_id}`)}
                className="text-xs font-semibold text-blue-700">
                To fulfil order {r.order_number}{r.order?.customer_name ? ` — ${r.order.customer_name}` : ''}
                {r.order?.status ? ` (${r.order.status.replace(/_/g, ' ')})` : ''}
              </button>
            )}
            {r.deducted_qty < r.quantity && (
              <p className="text-[11px] text-amber-700">
                {r.deducted_qty === 0 ? 'Not taken from our warehouse stock' : `Only ${r.deducted_qty} taken from warehouse stock`}
                {r.from_label ? ` · from ${r.from_label}` : ''}
              </p>
            )}
            {(r.courier || r.waybill_number) && (
              <p className="text-[11px] text-gray-500">{[r.courier, r.waybill_number && `Waybill ${r.waybill_number}`].filter(Boolean).join(' · ')}</p>
            )}
            {r.closed_note && <p className="text-[11px] text-gray-500">{r.closed_note}</p>}
            <p className="text-[11px] text-gray-400">
              Since {formatDate(r.created_at)}{r.created_by_name ? ` · ${r.created_by_name}` : ''}
              {r.closed_by_name ? ` · settled by ${r.closed_by_name}` : ''}
            </p>

            {open && canManage && (
              <div className="grid grid-cols-2 gap-2 pt-1">
                <Button size="sm" onClick={() => {
                  const dest = r.destination_warehouse_id ||
                    (warehouses || []).find(w => w.state === r.destination_state)?.id || ''
                  setWhId(dest); setWhRow(r)
                }}>Into Warehouse</Button>
                <Button size="sm" variant="secondary" onClick={() => {
                  setPark({ state: r.destination_state || '', city: '', park_name: '', contact_name: '', contact_phone: '', contact_role: 'driver' })
                  setParkRow(r)
                }}>Left at Park</Button>
                {(!r.order_id || orderClosed) && (
                  <Button size="sm" variant="success" loading={act.isPending}
                    onClick={() => {
                      const note = window.prompt('Delivered to whom? (optional)')
                      if (note !== null) run({ row: r, action: 'delivered', note: note || 'Delivered to customer' })
                    }}>Delivered</Button>
                )}
                <Button size="sm" variant="danger" loading={act.isPending}
                  className={(!r.order_id || orderClosed) ? '' : 'col-span-2'}
                  onClick={() => {
                    const reason = window.prompt('What happened? (damage details)')
                    if (reason !== null) run({ row: r, action: 'damaged', reason: reason || 'Damaged in transit' })
                  }}>Damaged</Button>
              </div>
            )}
          </div>
        )
      })}

      <Modal isOpen={!!whRow} onClose={() => setWhRow(null)} title="Received into Warehouse"
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setWhRow(null)} className="flex-1">Cancel</Button>
            <Button className="flex-1" loading={act.isPending} disabled={!whId}
              onClick={async () => {
                const ok = await run({ row: whRow, action: 'warehouse', warehouse: (warehouses || []).find(w => w.id === whId) })
                if (ok) setWhRow(null)
              }}>Add to Stock</Button>
          </div>
        }>
        {whRow && (
          <div className="space-y-3">
            <p className="text-xs text-gray-500">{whRow.quantity} × {whRow.product_name} is added to the chosen warehouse's stock.</p>
            <Select label="Warehouse" required value={whId} onChange={e => setWhId(e.target.value)}>
              <option value="">Select warehouse…</option>
              {(warehouses || []).map(w => <option key={w.id} value={w.id}>{w.name} ({w.state})</option>)}
            </Select>
          </div>
        )}
      </Modal>

      <Modal isOpen={!!parkRow} onClose={() => setParkRow(null)} title="Left at a State Park"
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setParkRow(null)} className="flex-1">Cancel</Button>
            <Button className="flex-1" loading={act.isPending} disabled={!park.state}
              onClick={async () => {
                const ok = await run({ row: parkRow, action: 'park', park })
                if (ok) setParkRow(null)
              }}>Move to Goods at Park</Button>
          </div>
        }>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Select label="State" required value={park.state || ''} onChange={e => setPark({ ...park, state: e.target.value })}>
              <option value="">Select…</option>
              {NIGERIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </Select>
            <Input label="City" value={park.city || ''} onChange={e => setPark({ ...park, city: e.target.value })} />
          </div>
          <Input label="Park name" value={park.park_name || ''} onChange={e => setPark({ ...park, park_name: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Contact name" value={park.contact_name || ''} onChange={e => setPark({ ...park, contact_name: e.target.value })} />
            <Input label="Contact phone" type="tel" value={park.contact_phone || ''} onChange={e => setPark({ ...park, contact_phone: e.target.value })} />
          </div>
        </div>
      </Modal>
    </div>
  )
}
