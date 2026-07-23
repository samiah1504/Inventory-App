import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { PackageOpen, ChevronDown, ChevronUp, Phone, Truck } from 'lucide-react'
import { TopBar } from '../../components/layout/TopBar'
import { SearchBar } from '../../components/ui/SearchBar'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { Input, Select, Textarea } from '../../components/ui/Input'
import { SkeletonList } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'
import { useAuthStore } from '../../stores/authStore'
import { useWarehouses } from '../../hooks/useBusinesses'
import { formatDate, NIGERIAN_STATES } from '../../utils/format'
import { openDialer } from '../../utils/whatsapp'
import {
  useHoldingQueue, useUpdateHolding, useCollectHolding, useHoldingToWarehouse, useHoldingDamaged,
  useHoldingWaybilled, useHoldingParkTransfer, useHoldingHistory, useHoldingDelivered,
  CONTACT_ROLES, HOLDING_STATUSES, ACTIVE_HOLDING,
} from '../../hooks/useHolding'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { scopeToBusinesses } from '../../lib/businessScope'

const ageDays = (d) => Math.floor((Date.now() - new Date(d).getTime()) / 86400000)

function HistoryTrail({ holdingId }) {
  const historyQ = useHoldingHistory(holdingId)
  const rows = historyQ.data || []
  if (rows.length === 0) return null
  return (
    <div className="bg-gray-50 rounded-xl p-3">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Movement History</p>
      <div className="space-y-1.5">
        {rows.map(h => (
          <div key={h.id}>
            <p className="text-xs text-gray-700 capitalize font-medium">{(h.action || '').replace(/_/g, ' ')}</p>
            {h.details && <p className="text-[11px] text-gray-500">{h.details}</p>}
            <p className="text-[10px] text-gray-400">
              {[h.staff_name, new Date(h.created_at).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })].filter(Boolean).join(' · ')}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

export function HoldingQueuePage() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const { data: warehouses } = useWarehouses()

  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [cityFilter, setCityFilter] = useState('')
  const [parkFilter, setParkFilter] = useState('')
  const [showClosed, setShowClosed] = useState(false)
  const [expanded, setExpanded] = useState(null)
  const [editItem, setEditItem] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [whItem, setWhItem] = useState(null)
  const [whId, setWhId] = useState('')
  const [whForm, setWhForm] = useState({})
  const [wbItem, setWbItem] = useState(null)
  const [wbForm, setWbForm] = useState({})
  const [ptItem, setPtItem] = useState(null)
  const [ptForm, setPtForm] = useState({})
  // "Delivered to Another Customer" — pick the order that received it
  const [dlItem, setDlItem] = useState(null)
  const [dlSearch, setDlSearch] = useState('')
  const [dlOrder, setDlOrder] = useState(null)
  const [dlNotes, setDlNotes] = useState('')

  const { data: items, isLoading } = useHoldingQueue(showClosed)
  const updateHolding = useUpdateHolding()
  const collectHolding = useCollectHolding()
  const toWarehouse = useHoldingToWarehouse()
  const markDamaged = useHoldingDamaged()
  const waybillHolding = useHoldingWaybilled()
  const parkTransfer = useHoldingParkTransfer()
  const deliveredToOrder = useHoldingDelivered()

  // Orders matching the picker search (business-scoped; cancelled excluded)
  const dlOrdersQ = useQuery({
    queryKey: ['holding_order_pick', dlSearch, user?.id],
    enabled: !!dlItem && dlSearch.trim().length >= 2,
    queryFn: async () => {
      const q = dlSearch.trim().replace(/([%_\\])/g, '\\$1')
      let query = supabase.from('orders')
        .select('id, order_number, customer_name, customer_phone, state, city, status, product_name')
        .or(`order_number.ilike.%${q}%,customer_name.ilike.%${q}%,customer_phone.ilike.%${q}%`)
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false })
        .limit(10)
      query = scopeToBusinesses(query, user)
      const { data, error } = await query
      if (error) throw error
      return data || []
    },
    staleTime: 15000,
  })

  const isFulfillment = user?.role === 'fulfillment'
  const isWaybill = user?.role === 'waybill'
  const isManager = ['ceo', 'super_admin', 'operations_manager'].includes(user?.role)
  const canAct = isFulfillment || isManager

  const list = useMemo(() => {
    let l = items || []
    if (search) {
      const q = search.toLowerCase()
      l = l.filter(i =>
        (i.product_name || '').toLowerCase().includes(q) ||
        (i.source_order_number || '').toLowerCase().includes(q) ||
        (i.park_name || '').toLowerCase().includes(q) ||
        (i.contact_name || '').toLowerCase().includes(q))
    }
    if (stateFilter) l = l.filter(i => i.state === stateFilter)
    if (cityFilter) l = l.filter(i => i.city === cityFilter)
    if (parkFilter) l = l.filter(i => (i.park_name || 'No park recorded') === parkFilter)
    return l
  }, [items, search, stateFilter, cityFilter, parkFilter])

  const availableStates = useMemo(() =>
    [...new Set((items || []).map(i => i.state).filter(Boolean))].sort()
  , [items])
  const availableCities = useMemo(() =>
    [...new Set((items || [])
      .filter(i => !stateFilter || i.state === stateFilter)
      .map(i => i.city).filter(Boolean))].sort()
  , [items, stateFilter])
  const availableParks = useMemo(() =>
    [...new Set((items || [])
      .filter(i => !stateFilter || i.state === stateFilter)
      .map(i => i.park_name || 'No park recorded'))].sort()
  , [items, stateFilter])

  if (items === null && !isLoading) {
    return (
      <div className="flex flex-col h-full overflow-x-hidden w-full">
        <TopBar title="Holding Queue" />
        <div className="px-4 py-4">
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800">
            <p className="font-semibold mb-1">Holding queue not set up yet</p>
            <p>Run the Product Holding Queue section of <span className="font-mono text-xs">supabase/migrations.sql</span> in the Supabase SQL editor.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-x-hidden w-full">
      <TopBar title="Holding Queue" />

      <div className="bg-white border-b border-gray-100 sticky top-[57px] z-20 px-4 pt-3 pb-2 space-y-2 w-full overflow-x-hidden">
        <SearchBar value={search} onChange={setSearch} placeholder="Search product, order #, park, contact..." />
        <div className="flex gap-2">
          <div className="flex-1 min-w-0">
            <Select value={stateFilter} onChange={e => { setStateFilter(e.target.value); setCityFilter(''); setParkFilter('') }}>
              <option value="">All States</option>
              {availableStates.map(s => <option key={s} value={s}>{s}</option>)}
            </Select>
          </div>
          <button
            onClick={() => setShowClosed(v => !v)}
            className={`shrink-0 px-3 rounded-xl text-xs font-medium border ${showClosed ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200'}`}>
            {showClosed ? 'All records' : 'Active only'}
          </button>
        </div>
        <div className="flex gap-2">
          <div className="flex-1 min-w-0">
            <Select value={cityFilter} onChange={e => setCityFilter(e.target.value)}>
              <option value="">All Cities</option>
              {availableCities.map(c => <option key={c} value={c}>{c}</option>)}
            </Select>
          </div>
          <div className="flex-1 min-w-0">
            <Select value={parkFilter} onChange={e => setParkFilter(e.target.value)}>
              <option value="">All Locations</option>
              {availableParks.map(p => <option key={p} value={p}>{p}</option>)}
            </Select>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-3">
        <p className="text-xs text-gray-500">
          Products from failed deliveries awaiting their next move — not part of an order or warehouse yet.
        </p>

        {isLoading ? <SkeletonList count={4} /> :
         list.length === 0 ? (
          <EmptyState
            icon={<PackageOpen size={28} />}
            title="Holding queue is empty"
            description="Products left at a State Park after a failed delivery appear here"
          />
        ) : list.map(item => {
          const isOpen = expanded === item.id
          const st = HOLDING_STATUSES[item.status] || { label: item.status, color: 'bg-gray-100 text-gray-600' }
          const age = ageDays(item.created_at)
          const active = ACTIVE_HOLDING.includes(item.status)
          return (
            <div key={item.id} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <button onClick={() => setExpanded(isOpen ? null : item.id)}
                className="w-full text-left p-4 active:bg-gray-50 transition-colors">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${st.color}`}>{st.label.toUpperCase()}</span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                    active && age > 14 ? 'bg-red-50 text-red-700' : active && age > 7 ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {age === 0 ? 'today' : `${age} day${age !== 1 ? 's' : ''}`}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 leading-tight">
                      {item.quantity} × {item.product_name}
                      {(item.color || item.size) && (
                        <span className="text-gray-500 font-normal"> ({[item.color, item.size].filter(Boolean).join(', ')})</span>
                      )}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5 truncate">
                      {[item.state, item.city, item.park_name].filter(Boolean).join(' · ')}
                    </p>
                    {item.source_order_number && (
                      <p className="text-[11px] font-mono text-gray-400 mt-0.5">from {item.source_order_number}</p>
                    )}
                  </div>
                  {isOpen ? <ChevronUp size={18} className="text-gray-400 shrink-0" /> : <ChevronDown size={18} className="text-gray-400 shrink-0" />}
                </div>
              </button>

              {isOpen && (
                <div className="px-4 pb-4 space-y-3">
                  {/* Location & contact */}
                  <div className="bg-gray-50 rounded-xl p-3 space-y-1">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Location & Contact</p>
                    {item.park_location && <p className="text-xs text-gray-600"><span className="text-gray-400">Park location: </span>{item.park_location}</p>}
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-gray-600 min-w-0 truncate">
                        <span className="text-gray-400">Contact: </span>
                        {item.contact_name || '—'}
                        {item.contact_role ? ` (${CONTACT_ROLES.find(r => r.value === item.contact_role)?.label || item.contact_role})` : ''}
                      </p>
                      {item.contact_phone && (
                        <button onClick={() => openDialer(item.contact_phone)}
                          className="flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-1 rounded-lg shrink-0 active:scale-95">
                          <Phone size={12} /> {item.contact_phone}
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-gray-600"><span className="text-gray-400">Custodian: </span>{item.custodian_name || '—'}</p>
                    <p className="text-xs text-gray-600"><span className="text-gray-400">Entered: </span>{formatDate(item.created_at)}</p>
                    {item.notes && <p className="text-xs text-gray-600"><span className="text-gray-400">Notes: </span>{item.notes}</p>}
                  </div>

                  {/* Actions */}
                  {active && canAct && (
                    <div className="grid grid-cols-2 gap-2">
                      <Button size="sm" variant="secondary"
                        onClick={() => {
                          setEditForm({
                            city: item.city || '', park_name: item.park_name || '', park_location: item.park_location || '',
                            contact_name: item.contact_name || '', contact_phone: item.contact_phone || '',
                            contact_role: item.contact_role || 'driver', notes: item.notes || '',
                          })
                          setEditItem(item)
                        }}>
                        Update Details
                      </Button>
                      {item.status === 'holding' && (
                        <Button size="sm" variant="secondary"
                          loading={collectHolding.isPending}
                          onClick={() => collectHolding.mutate({ item })}>
                          Collected from Park
                        </Button>
                      )}
                      <Button size="sm"
                        onClick={() => {
                          setWhId('')
                          setWhForm({
                            date: new Date().toISOString().split('T')[0],
                            time: new Date().toTimeString().slice(0, 5),
                            received_by: user?.name || '', condition: 'good', notes: '',
                          })
                          setWhItem(item)
                        }}>
                        Move to Warehouse
                      </Button>
                      <Button size="sm" variant="secondary"
                        onClick={() => {
                          setPtForm({
                            date: new Date().toISOString().split('T')[0],
                            time: new Date().toTimeString().slice(0, 5),
                            transferred_by: user?.name || '', destination: '', notes: '',
                          })
                          setPtItem(item)
                        }}>
                        Transferred from Park
                      </Button>
                      <Button size="sm" className="col-span-2"
                        onClick={() => {
                          setDlSearch(''); setDlOrder(null); setDlNotes('')
                          setDlItem(item)
                        }}>
                        Delivered to Another Customer
                      </Button>
                      <Button size="sm" variant="danger" className="col-span-2"
                        loading={markDamaged.isPending}
                        onClick={() => {
                          const reason = window.prompt('Damage details (optional)') ?? null
                          if (reason !== null) markDamaged.mutate({ item, reason })
                        }}>
                        Mark Damaged
                      </Button>
                    </div>
                  )}
                  {active && (isWaybill || isManager) && (
                    <Button size="sm" className="w-full"
                      onClick={() => {
                        setWbForm({
                          dest_state: '', dest_city: '', dest_location: '', courier: '',
                          waybill_number: '', date_shipped: new Date().toISOString().split('T')[0],
                          expense: '', dest_contact: '', dest_contact_phone: '', notes: '',
                        })
                        setWbItem(item)
                      }}>
                      <span className="flex items-center justify-center gap-1.5">
                        <Truck size={14} /> Waybilled to Another Location
                      </span>
                    </Button>
                  )}

                  {/* Full movement history */}
                  <HistoryTrail holdingId={item.id} />
                  {active && (isWaybill || isManager) && (
                    <div className="space-y-1.5">
                      <Button size="sm" variant="secondary" className="w-full"
                        onClick={() => navigate(`/waybill?tab=awaiting&holding=${item.id}`)}>
                        <span className="flex items-center justify-center gap-1.5">
                          <Truck size={14} /> Use as Waybill Source
                        </span>
                      </Button>
                      <p className="text-[11px] text-gray-400">
                        Interstate transfer — select the orders to ship, and this product becomes the batch source.
                      </p>
                    </div>
                  )}
                  {active && isFulfillment && (
                    <p className="text-[11px] text-gray-400">
                      Interstate transfers are handled by the Waybill Officer — contact them if this product needs to move to another state.
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Delivered to another customer — record which order received it */}
      <Modal isOpen={!!dlItem} onClose={() => setDlItem(null)} title="Delivered to Another Customer"
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setDlItem(null)}>Cancel</Button>
            <Button className="flex-1"
              disabled={!dlOrder}
              loading={deliveredToOrder.isPending}
              onClick={async () => {
                await deliveredToOrder.mutateAsync({ item: dlItem, order: dlOrder, notes: dlNotes.trim() })
                setDlItem(null)
              }}>
              Confirm
            </Button>
          </div>
        }>
        <div className="space-y-3">
          {dlItem && (
            <div className="bg-emerald-50 rounded-xl p-3">
              <p className="text-xs text-emerald-800">
                <span className="font-semibold">{dlItem.quantity} × {dlItem.product_name}</span>
                {' '}was used to fulfil a different customer's order. Pick that order below —
                the item leaves the active queue and the delivery is recorded on both histories.
              </p>
            </div>
          )}
          <Input label="Which order was it delivered to?" required
            placeholder="Search order number, customer name or phone..."
            value={dlSearch}
            onChange={e => { setDlSearch(e.target.value); setDlOrder(null) }} />
          {dlOrder ? (
            <div className="bg-white border border-emerald-300 rounded-xl p-3">
              <p className="text-sm font-semibold text-gray-900">{dlOrder.order_number} · {dlOrder.customer_name}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {[dlOrder.product_name, [dlOrder.city, dlOrder.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
              </p>
              <button className="text-xs text-blue-700 underline mt-1"
                onClick={() => { setDlOrder(null); setDlSearch('') }}>
                Change order
              </button>
            </div>
          ) : dlSearch.trim().length >= 2 ? (
            <div className="space-y-1.5 max-h-56 overflow-y-auto">
              {(dlOrdersQ.data || []).map(o => (
                <button key={o.id} type="button"
                  onClick={() => setDlOrder(o)}
                  className="w-full text-left bg-white border border-gray-100 rounded-xl p-3 active:bg-gray-50">
                  <p className="text-sm font-semibold text-gray-900">{o.order_number} · {o.customer_name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {[o.product_name, [o.city, o.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
                  </p>
                </button>
              ))}
              {dlOrdersQ.isLoading && <p className="text-xs text-gray-400 px-1">Searching...</p>}
              {!dlOrdersQ.isLoading && (dlOrdersQ.data || []).length === 0 && (
                <p className="text-xs text-gray-400 px-1">No orders match — check the order number</p>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-gray-400">Type at least 2 characters to search orders</p>
          )}
          <Textarea label="Notes (optional)" rows={2}
            placeholder="e.g. delivered by rider from the park"
            value={dlNotes} onChange={e => setDlNotes(e.target.value)} />
        </div>
      </Modal>

      {/* Update details modal */}
      <Modal isOpen={!!editItem} onClose={() => setEditItem(null)} title="Update Holding Details"
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setEditItem(null)} className="flex-1">Cancel</Button>
            <Button className="flex-1" loading={updateHolding.isPending}
              onClick={async () => {
                await updateHolding.mutateAsync({ id: editItem.id, fields: editForm })
                setEditItem(null)
              }}>
              Save
            </Button>
          </div>
        }>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="City" value={editForm.city || ''} onChange={e => setEditForm({ ...editForm, city: e.target.value })} />
            <Input label="State Park Name" value={editForm.park_name || ''} onChange={e => setEditForm({ ...editForm, park_name: e.target.value })} />
          </div>
          <Input label="Exact Park Location" value={editForm.park_location || ''} onChange={e => setEditForm({ ...editForm, park_location: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Contact Name" value={editForm.contact_name || ''} onChange={e => setEditForm({ ...editForm, contact_name: e.target.value })} />
            <Input label="Contact Phone" type="tel" value={editForm.contact_phone || ''} onChange={e => setEditForm({ ...editForm, contact_phone: e.target.value })} />
          </div>
          <Select label="Contact Role" value={editForm.contact_role || 'driver'} onChange={e => setEditForm({ ...editForm, contact_role: e.target.value })}>
            {CONTACT_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </Select>
          <Textarea label="Notes" rows={2} value={editForm.notes || ''} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} />
        </div>
      </Modal>

      {/* Move to warehouse modal */}
      <Modal isOpen={!!whItem} onClose={() => setWhItem(null)} title="Move to Warehouse"
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setWhItem(null)} className="flex-1">Cancel</Button>
            <Button className="flex-1" disabled={!whId || !whForm.received_by} loading={toWarehouse.isPending}
              onClick={async () => {
                const warehouse = (warehouses || []).find(w => w.id === whId)
                await toWarehouse.mutateAsync({
                  item: whItem, warehouse,
                  dateReceived: whForm.date, timeReceived: whForm.time,
                  receivedBy: whForm.received_by, condition: whForm.condition, notes: whForm.notes,
                })
                setWhItem(null)
              }}>
              Confirm
            </Button>
          </div>
        }>
        <div className="space-y-4">
          {whItem && (
            <p className="text-xs text-gray-500">
              {whItem.quantity} × {whItem.product_name} becomes available stock in the selected warehouse
              and leaves the active Holding Queue.
            </p>
          )}
          <Select label="Warehouse" required value={whId} onChange={e => setWhId(e.target.value)}>
            <option value="">Select warehouse...</option>
            {(warehouses || [])
              .filter(w => !whItem?.state || w.state === whItem.state || isManager)
              .map(w => <option key={w.id} value={w.id}>{w.name} ({w.state})</option>)}
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Date Received" type="date" value={whForm.date || ''}
              onChange={e => setWhForm({ ...whForm, date: e.target.value })} />
            <Input label="Time Received" type="time" value={whForm.time || ''}
              onChange={e => setWhForm({ ...whForm, time: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Received By" required value={whForm.received_by || ''}
              onChange={e => setWhForm({ ...whForm, received_by: e.target.value })} />
            <Select label="Condition" value={whForm.condition || 'good'}
              onChange={e => setWhForm({ ...whForm, condition: e.target.value })}>
              <option value="good">Good condition</option>
              <option value="minor_damage">Minor damage</option>
              <option value="damaged">Damaged</option>
              <option value="incomplete">Incomplete / missing parts</option>
            </Select>
          </div>
          <Textarea label="Notes (optional)" rows={2} value={whForm.notes || ''}
            onChange={e => setWhForm({ ...whForm, notes: e.target.value })} />
        </div>
      </Modal>

      {/* Waybilled to another location */}
      <Modal isOpen={!!wbItem} onClose={() => setWbItem(null)} title="Waybilled to Another Location"
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setWbItem(null)} className="flex-1">Cancel</Button>
            <Button className="flex-1" loading={waybillHolding.isPending}
              disabled={!wbForm.dest_state || !wbForm.courier || !wbForm.date_shipped}
              onClick={async () => {
                await waybillHolding.mutateAsync({ item: wbItem, form: wbForm })
                setWbItem(null)
              }}>
              Confirm Waybill
            </Button>
          </div>
        }>
        <div className="space-y-4">
          {wbItem && (
            <p className="text-xs text-gray-500">
              {wbItem.quantity} × {wbItem.product_name} leaves {wbItem.park_name || `${wbItem.state} State Park`} and
              moves in transit to the destination. The record leaves the active queue.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Select label="Destination State" required value={wbForm.dest_state || ''}
              onChange={e => setWbForm({ ...wbForm, dest_state: e.target.value })}>
              <option value="">Select...</option>
              {NIGERIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </Select>
            <Input label="Destination City" value={wbForm.dest_city || ''}
              onChange={e => setWbForm({ ...wbForm, dest_city: e.target.value })} />
          </div>
          <Input label="Destination Warehouse / State Park" value={wbForm.dest_location || ''}
            onChange={e => setWbForm({ ...wbForm, dest_location: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Courier / Transport" required value={wbForm.courier || ''}
              onChange={e => setWbForm({ ...wbForm, courier: e.target.value })} />
            <Input label="Waybill Number" value={wbForm.waybill_number || ''}
              onChange={e => setWbForm({ ...wbForm, waybill_number: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Date Shipped" type="date" required value={wbForm.date_shipped || ''}
              onChange={e => setWbForm({ ...wbForm, date_shipped: e.target.value })} />
            <Input label="Waybill Expense (₦)" type="number" inputMode="decimal" value={wbForm.expense || ''}
              onChange={e => setWbForm({ ...wbForm, expense: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Contact at Destination" value={wbForm.dest_contact || ''}
              onChange={e => setWbForm({ ...wbForm, dest_contact: e.target.value })} />
            <Input label="Contact Phone" type="tel" value={wbForm.dest_contact_phone || ''}
              onChange={e => setWbForm({ ...wbForm, dest_contact_phone: e.target.value })} />
          </div>
          <Textarea label="Notes (optional)" rows={2} value={wbForm.notes || ''}
            onChange={e => setWbForm({ ...wbForm, notes: e.target.value })} />
          <p className="text-[11px] text-gray-400">
            The waybill expense is recorded automatically in Expenses. The original failed-order link is preserved.
          </p>
        </div>
      </Modal>

      {/* Transferred from park */}
      <Modal isOpen={!!ptItem} onClose={() => setPtItem(null)} title="Transferred from Park"
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setPtItem(null)} className="flex-1">Cancel</Button>
            <Button className="flex-1" loading={parkTransfer.isPending}
              disabled={!ptForm.date || !ptForm.transferred_by || !ptForm.destination}
              onClick={async () => {
                await parkTransfer.mutateAsync({ item: ptItem, form: ptForm })
                setPtItem(null)
              }}>
              Confirm
            </Button>
          </div>
        }>
        <div className="space-y-4">
          {ptItem && (
            <p className="text-xs text-gray-500">
              Records that {ptItem.quantity} × {ptItem.product_name} has physically left
              {' '}{ptItem.park_name || 'the park'}. The record leaves the active queue.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Input label="Date Transferred" type="date" required value={ptForm.date || ''}
              onChange={e => setPtForm({ ...ptForm, date: e.target.value })} />
            <Input label="Time Transferred" type="time" value={ptForm.time || ''}
              onChange={e => setPtForm({ ...ptForm, time: e.target.value })} />
          </div>
          <Input label="Transferred By" required value={ptForm.transferred_by || ''}
            onChange={e => setPtForm({ ...ptForm, transferred_by: e.target.value })} />
          <Input label="Destination" required placeholder="Where did the product go?"
            value={ptForm.destination || ''}
            onChange={e => setPtForm({ ...ptForm, destination: e.target.value })} />
          <Textarea label="Notes (optional)" rows={2} value={ptForm.notes || ''}
            onChange={e => setPtForm({ ...ptForm, notes: e.target.value })} />
        </div>
      </Modal>
    </div>
  )
}
