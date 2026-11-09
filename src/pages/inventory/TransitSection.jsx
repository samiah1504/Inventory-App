import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Truck, ArrowLeftRight } from 'lucide-react'
import { useInTransit, useTransitAction, TRANSIT_STATUSES } from '../../hooks/useStockFlow'
import { useWarehouseTransfers, useReceiveTransfer, useTransferAtPark } from '../../hooks/useInventory'
import { Modal } from '../../components/ui/Modal'
import { Input, Select } from '../../components/ui/Input'
import { HoldingQueueContent } from '../holding/HoldingQueuePage'
import { formatDate, NIGERIAN_STATES } from '../../utils/format'
import { Panel, ProductThumb, Segmented, ToolSelect, Tag, Btn, EmptyNote, SetupNote, fmt } from './ui'
import { useWarehouses } from '../../hooks/useBusinesses'
import { useAuthStore } from '../../stores/authStore'
import { allowedWarehouseIds } from '../../lib/inventoryAccess'

const ageDays = (d) => d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : 0

function StatusTag({ item }) {
  if (item.kind === 'transfer') {
    if (item.status === 'at_park') return <Tag tone="warn">At state park</Tag>
    if (item.status === 'received') return <Tag tone="good">Received</Tag>
    return <Tag tone="warn">In transit</Tag>
  }
  const st = item.raw?.status || 'in_transit'
  if (st === 'in_transit') return <Tag tone="warn">In transit</Tag>
  if (['delivered', 'at_warehouse'].includes(st)) return <Tag tone="good">{TRANSIT_STATUSES[st]?.label}</Tag>
  if (['damaged', 'missing'].includes(st)) return <Tag tone="bad">{TRANSIT_STATUSES[st]?.label}</Tag>
  return <Tag>{TRANSIT_STATUSES[st]?.label || st}</Tag>
}

function Route({ from, to }) {
  return (
    <span className="inline-flex items-center gap-2 min-w-0 text-[13px]">
      <span className="truncate text-charcoal">{from}</span>
      <span className="flex items-center shrink-0 text-brand" aria-label="to">
        <span className="w-4 h-px bg-[#E5C774]" /><ArrowRight size={13} />
      </span>
      <span className="truncate text-charcoal">{to}</span>
    </span>
  )
}

export function TransitSection({ model, search, canEdit, initialView = 'transit' }) {
  const [view, setView] = useState(initialView)
  return (
    <div className="space-y-4">
      <Segmented value={view} onChange={setView} options={[
        { value: 'transit', label: `In transit (${fmt(model.transit.length)})` },
        { value: 'transfers', label: 'Warehouse transfers' },
        { value: 'park', label: `Goods at park (${fmt(model.park.length)})` },
      ]} />
      {view === 'transit' && <InTransitList model={model} search={search} canEdit={canEdit} />}
      {view === 'transfers' && <TransferHistory search={search} />}
      {view === 'park' && (
        <Panel title="Goods at park" bodyClass="p-4">
          <HoldingQueueContent embedded readOnly={!canEdit} />
        </Panel>
      )}
    </div>
  )
}

// Settled order shipment lines, shaped like the model's transit items
function historyItems(rows, warehouses) {
  const whName = Object.fromEntries((warehouses || []).map(w => [w.id, w.name]))
  return (rows || []).map(t => ({
    id: `t:${t.id}`, kind: 'order', raw: t, product_id: t.product_id, name: t.product_name,
    sku: null, image_url: null, quantity: Number(t.quantity) || 0,
    from: t.from_warehouse?.name || t.from_label || 'Unknown origin',
    to: t.destination_type === 'warehouse'
      ? (whName[t.destination_warehouse_id] || `${t.destination_state || '—'} warehouse`)
      : `Customer · ${t.destination_state || '—'}`,
    toState: t.destination_state || null, dispatchedAt: t.created_at, status: t.status, reference: t.order_number,
  }))
}

function InTransitList({ model, search, canEdit }) {
  const [destination, setDestination] = useState('')
  const [kind, setKind] = useState('')
  const [open, setOpen] = useState(null)
  const historyQ = useInTransit(kind === 'history')
  const warehouses = useWarehousesList()

  if (!model.transitReady) return <SetupNote what="Goods in Transit" />

  let list = kind === 'history' ? historyItems(historyQ.data, warehouses) : model.transit
  if (search) {
    const q = search.toLowerCase()
    list = list.filter(t => t.name.toLowerCase().includes(q) || (t.sku && String(t.sku).toLowerCase().includes(q)) ||
      (t.reference && t.reference.toLowerCase().includes(q)))
  }
  if (kind && kind !== 'history') list = list.filter(t => t.kind === kind)
  if (destination) list = list.filter(t => t.toState === destination)
  const states = [...new Set(model.transit.map(t => t.toState).filter(Boolean))].sort()
  const units = list.reduce((a, t) => a + t.quantity, 0)

  return (
    <Panel title="Products in transit" subtitle={`${fmt(list.length)} line${list.length === 1 ? '' : 's'} · ${fmt(units)} units on the move`} bodyClass="">
      <div className="flex flex-wrap gap-2 px-4 py-3 border-b border-line bg-[#FCFBF9]">
        <ToolSelect label="Type" value={kind} onChange={setKind} className="flex-1 sm:flex-none">
          <option value="">All shipments</option>
          <option value="order">For customer orders</option>
          <option value="transfer">Warehouse transfers</option>
          <option value="history">Order shipments incl. settled (history)</option>
        </ToolSelect>
        <ToolSelect label="Destination" value={destination} onChange={setDestination} className="flex-1 sm:flex-none">
          <option value="">All destinations</option>
          {states.map(s => <option key={s} value={s}>{s}</option>)}
        </ToolSelect>
      </div>

      {list.length === 0 ? (
        <EmptyNote icon={<Truck size={18} />} title="Nothing in transit">Goods appear here when a waybill batch is marked Waybilled or a transfer is created.</EmptyNote>
      ) : (
        <>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-faint border-b border-line">
                  <th className="text-left font-medium pl-4 pr-3 py-2.5">Product</th>
                  <th className="text-right font-medium px-3 py-2.5">Qty</th>
                  <th className="text-left font-medium px-3 py-2.5">Route</th>
                  <th className="text-left font-medium px-3 py-2.5">Dispatched</th>
                  <th className="text-left font-medium px-3 py-2.5">Reference</th>
                  <th className="text-left font-medium pl-3 pr-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {list.map(t => {
                  const age = ageDays(t.dispatchedAt)
                  return (
                    <tr key={t.id} onClick={() => setOpen(t)} className="border-b border-line last:border-0 hover:bg-ivory cursor-pointer">
                      <td className="pl-4 pr-3 py-2.5">
                        <div className="flex items-center gap-3 min-w-0">
                          <ProductThumb src={t.image_url} name={t.name} />
                          <div className="min-w-0">
                            <p className="font-semibold text-charcoal truncate max-w-[260px]">{t.name}</p>
                            <p className="text-[11px] text-faint">{[t.variant, t.sku ? `SKU ${t.sku}` : null].filter(Boolean).join(' · ') || '—'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right tnum font-semibold">{fmt(t.quantity)}</td>
                      <td className="px-3 py-2.5 max-w-[320px]"><Route from={t.from} to={t.to} /></td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {t.dispatchedAt ? formatDate(t.dispatchedAt) : '—'}
                        <span className={`block text-[11px] ${age > 7 ? 'text-bad font-semibold' : 'text-faint'}`}>{age === 0 ? 'today' : `${age} day${age === 1 ? '' : 's'} ago`}</span>
                      </td>
                      <td className="px-3 py-2.5 text-mute">
                        {t.kind === 'order' ? 'Order' : 'Transfer'}
                        <span className="block text-[11px] text-faint font-mono">{t.reference || '—'}</span>
                      </td>
                      <td className="pl-3 pr-4 py-2.5"><StatusTag item={t} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <ul className="md:hidden divide-y divide-line">
            {list.map(t => (
              <li key={t.id}>
                <button onClick={() => setOpen(t)} className="w-full text-left px-4 py-3 flex gap-3 active:bg-ivory">
                  <ProductThumb src={t.image_url} name={t.name} size={40} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[13px] font-semibold text-charcoal leading-snug truncate">{t.name}</p>
                      <p className="text-[13px] font-semibold tnum shrink-0">{fmt(t.quantity)}</p>
                    </div>
                    <div className="mt-0.5 text-xs"><Route from={t.from} to={t.to} /></div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-faint">
                      <StatusTag item={t} />
                      <span>{t.dispatchedAt ? `Sent ${formatDate(t.dispatchedAt)}` : ''}</span>
                      {t.reference && <span className="font-mono truncate">{t.reference}</span>}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {open && <TransitDetail item={open} canEdit={canEdit} onClose={() => setOpen(null)} />}
    </Panel>
  )
}

// Full details of one shipment line + the actions that settle it
function TransitDetail({ item, canEdit, onClose }) {
  const navigate = useNavigate()
  const act = useTransitAction()
  const receive = useReceiveTransfer()
  const atPark = useTransferAtPark()
  const [mode, setMode] = useState(null)       // 'warehouse' | 'park'
  const [whId, setWhId] = useState(item.raw?.destination_warehouse_id || item.raw?.to_warehouse_id || '')
  const [park, setPark] = useState({ state: item.toState || '', city: '', park_name: '', contact_name: '', contact_phone: '', contact_role: 'driver' })
  const r = item.raw || {}
  const warehouses = useWarehousesList()
  const orderClosed = r.order && ['cancelled', 'failed_delivery', 'returned'].includes(r.order.status)
  const isOpenOrderLine = item.kind === 'order' && r.status === 'in_transit'

  async function run(args) {
    try { await act.mutateAsync({ row: r, ...args }); onClose() } catch { /* toast shown */ }
  }

  const facts = [
    ['Quantity', `${fmt(item.quantity)} units`],
    ['From', item.from],
    ['To', item.to],
    ['Dispatched', item.dispatchedAt ? formatDate(item.dispatchedAt) : '—'],
    ...(r.expected_arrival ? [['Expected arrival', formatDate(r.expected_arrival)]] : []),
    ['Type', item.kind === 'order' ? 'Goods for a customer order' : 'Warehouse transfer'],
    ['Reference', item.reference || '—'],
    ...(item.kind === 'order' ? [
      ['Taken from stock', r.deducted_qty < r.quantity ? `${fmt(r.deducted_qty)} of ${fmt(r.quantity)} (rest not from our stock)` : `${fmt(r.deducted_qty)} units`],
      ['Courier', [r.courier, r.waybill_number && `waybill ${r.waybill_number}`].filter(Boolean).join(' · ') || '—'],
      ['Recorded by', r.created_by_name || '—'],
    ] : [
      ['Courier', [r.courier_company, r.waybill_number && `waybill ${r.waybill_number}`].filter(Boolean).join(' · ') || '—'],
    ]),
  ]

  return (
    <Modal isOpen onClose={onClose} size="lg" title={item.name}>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <ProductThumb src={item.image_url} name={item.name} size={48} />
          <div className="min-w-0">
            <p className="text-xs text-faint">{item.sku ? `SKU ${item.sku}` : 'No SKU'}</p>
            <div className="mt-1"><Route from={item.from} to={item.to} /></div>
          </div>
          <div className="ml-auto"><StatusTag item={item} /></div>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line pt-3">
          {facts.map(([k, v]) => (
            <div key={k}><dt className="text-[11px] text-faint">{k}</dt><dd className="text-[13px] text-charcoal">{v}</dd></div>
          ))}
        </dl>
        {r.closed_note && <p className="text-xs text-mute">{r.closed_note}</p>}
        {r.notes && <p className="text-xs text-mute">{r.notes}</p>}
        {item.kind === 'order' && r.order_id && (
          <Btn variant="secondary" size="sm" onClick={() => navigate(`/orders/${r.order_id}`)}>
            Open order {r.order_number}{r.order?.customer_name ? ` — ${r.order.customer_name}` : ''}
          </Btn>
        )}

        {/* Settle an order shipment line */}
        {canEdit && isOpenOrderLine && !mode && (
          <div className="border-t border-line pt-3">
            <p className="text-[11px] uppercase tracking-wide text-faint mb-2">Update</p>
            <p className="text-xs text-mute mb-2">Order goods close automatically when the order is paid or received at a warehouse. Use these when something else happened.</p>
            <div className="grid grid-cols-2 gap-2">
              <Btn variant="dark" onClick={() => setMode('warehouse')} className="justify-center">Into warehouse</Btn>
              <Btn onClick={() => setMode('park')} className="justify-center">Left at park</Btn>
              {(!r.order_id || orderClosed) && (
                <Btn loading={act.isPending} className="justify-center" onClick={() => {
                  const note = window.prompt('Delivered to whom? (optional)')
                  if (note !== null) run({ action: 'delivered', note: note || 'Delivered to customer' })
                }}>Delivered</Btn>
              )}
              <Btn variant="danger" loading={act.isPending} className={`justify-center ${(!r.order_id || orderClosed) ? '' : 'col-span-2'}`} onClick={() => {
                const reason = window.prompt('What happened? (damage details)')
                if (reason !== null) run({ action: 'damaged', reason: reason || 'Damaged in transit' })
              }}>Damaged</Btn>
            </div>
          </div>
        )}
        {mode === 'warehouse' && (
          <div className="border-t border-line pt-3 space-y-3">
            <Select label="Received into which warehouse?" required value={whId} onChange={e => setWhId(e.target.value)}>
              <option value="">Select warehouse…</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name} ({w.state})</option>)}
            </Select>
            <div className="flex gap-2">
              <Btn onClick={() => setMode(null)}>Back</Btn>
              <Btn variant="dark" disabled={!whId} loading={act.isPending} className="flex-1 justify-center"
                onClick={() => run({ action: 'warehouse', warehouse: warehouses.find(w => w.id === whId) })}>Add to stock</Btn>
            </div>
          </div>
        )}
        {mode === 'park' && (
          <div className="border-t border-line pt-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Select label="State" required value={park.state} onChange={e => setPark({ ...park, state: e.target.value })}>
                <option value="">Select…</option>
                {NIGERIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </Select>
              <Input label="City" value={park.city} onChange={e => setPark({ ...park, city: e.target.value })} />
            </div>
            <Input label="Park name" value={park.park_name} onChange={e => setPark({ ...park, park_name: e.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Contact name" value={park.contact_name} onChange={e => setPark({ ...park, contact_name: e.target.value })} />
              <Input label="Contact phone" type="tel" value={park.contact_phone} onChange={e => setPark({ ...park, contact_phone: e.target.value })} />
            </div>
            <div className="flex gap-2">
              <Btn onClick={() => setMode(null)}>Back</Btn>
              <Btn variant="dark" disabled={!park.state} loading={act.isPending} className="flex-1 justify-center"
                onClick={() => run({ action: 'park', park })}>Move to Goods at Park</Btn>
            </div>
          </div>
        )}

        {/* Warehouse transfer actions */}
        {canEdit && item.kind === 'transfer' && ['in_transit', 'at_park'].includes(r.status) && (
          <div className="border-t border-line pt-3 grid grid-cols-2 gap-2">
            {r.status === 'in_transit' && (
              <Btn loading={atPark.isPending} className="justify-center"
                onClick={async () => { try { await atPark.mutateAsync(r); onClose() } catch { /* toast */ } }}>At state park</Btn>
            )}
            <Btn variant="dark" loading={receive.isPending} className={`justify-center ${r.status === 'at_park' ? 'col-span-2' : ''}`}
              onClick={async () => { try { await receive.mutateAsync(r); onClose() } catch { /* toast */ } }}>
              Receive into {r.to_warehouse?.name || 'warehouse'}
            </Btn>
          </div>
        )}
      </div>
    </Modal>
  )
}

// Allowed warehouses for pickers
function useWarehousesList() {
  const { user } = useAuthStore()
  const { data } = useWarehouses()
  const ids = allowedWarehouseIds(user)
  return (data || []).filter(w => !ids || ids.includes(w.id))
}

// Every warehouse-to-warehouse transfer, newest first
function TransferHistory({ search }) {
  const { data: transfers, isLoading } = useWarehouseTransfers()
  const [status, setStatus] = useState('')
  const list = useMemo(() => {
    let l = transfers || []
    if (status) l = l.filter(t => t.status === status)
    if (search) {
      const q = search.toLowerCase()
      l = l.filter(t => (t.product?.name || t.product_name || '').toLowerCase().includes(q) || (t.transfer_number || '').toLowerCase().includes(q))
    }
    return l
  }, [transfers, status, search])
  return (
    <Panel title="Warehouse transfers" subtitle="Stock moved between warehouses" bodyClass=""
      action={<ToolSelect label="Status" value={status} onChange={setStatus}>
        <option value="">All</option><option value="in_transit">In transit</option><option value="at_park">At state park</option><option value="received">Received</option>
      </ToolSelect>}>
      {isLoading ? <div className="p-4"><div className="h-20 shimmer" /></div> : list.length === 0 ? (
        <EmptyNote icon={<ArrowLeftRight size={18} />} title="No transfers">Use Stock Transfer to move stock between warehouses.</EmptyNote>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] min-w-[640px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-faint border-b border-line">
                <th className="text-left font-medium pl-4 pr-3 py-2.5">Transfer</th>
                <th className="text-left font-medium px-3 py-2.5">Product</th>
                <th className="text-right font-medium px-3 py-2.5">Qty</th>
                <th className="text-left font-medium px-3 py-2.5">Route</th>
                <th className="text-left font-medium px-3 py-2.5">Date</th>
                <th className="text-left font-medium pl-3 pr-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {list.map(t => (
                <tr key={t.id} className="border-b border-line last:border-0">
                  <td className="pl-4 pr-3 py-2.5 font-mono text-xs text-mute">{t.transfer_number}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2"><ProductThumb src={t.product?.image_url} name={t.product?.name || t.product_name} size={28} />
                      <span className="font-medium text-charcoal truncate max-w-[220px]">{t.product?.name || t.product_name}</span></div>
                  </td>
                  <td className="px-3 py-2.5 text-right tnum font-semibold">{fmt(t.quantity)}</td>
                  <td className="px-3 py-2.5"><Route from={t.from_warehouse?.name || '—'} to={t.to_warehouse?.name || '—'} /></td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-mute">{t.date_transferred ? formatDate(t.date_transferred) : formatDate(t.created_at)}</td>
                  <td className="pl-3 pr-4 py-2.5"><StatusTag item={{ kind: 'transfer', status: t.status }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}
