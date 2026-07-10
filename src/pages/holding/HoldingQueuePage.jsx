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
  CONTACT_ROLES, HOLDING_STATUSES, ACTIVE_HOLDING,
} from '../../hooks/useHolding'

const ageDays = (d) => Math.floor((Date.now() - new Date(d).getTime()) / 86400000)

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

  const { data: items, isLoading } = useHoldingQueue(showClosed)
  const updateHolding = useUpdateHolding()
  const collectHolding = useCollectHolding()
  const toWarehouse = useHoldingToWarehouse()
  const markDamaged = useHoldingDamaged()

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
                        onClick={() => { setWhId(''); setWhItem(item) }}>
                        Move to Warehouse
                      </Button>
                      <Button size="sm" variant="danger"
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
            <Button className="flex-1" disabled={!whId} loading={toWarehouse.isPending}
              onClick={async () => {
                const warehouse = (warehouses || []).find(w => w.id === whId)
                await toWarehouse.mutateAsync({ item: whItem, warehouse })
                setWhItem(null)
              }}>
              Confirm
            </Button>
          </div>
        }>
        <div className="space-y-4">
          {whItem && (
            <p className="text-xs text-gray-500">
              {whItem.quantity} × {whItem.product_name} becomes available stock in the selected warehouse.
            </p>
          )}
          <Select label="Warehouse" required value={whId} onChange={e => setWhId(e.target.value)}>
            <option value="">Select warehouse...</option>
            {(warehouses || [])
              .filter(w => !whItem?.state || w.state === whItem.state || isManager)
              .map(w => <option key={w.id} value={w.id}>{w.name} ({w.state})</option>)}
          </Select>
        </div>
      </Modal>
    </div>
  )
}
