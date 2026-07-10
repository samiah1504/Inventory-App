import { useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Plus, Truck, ChevronRight } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useOrders } from '../../hooks/useOrders'
import { useCreateWaybillBatch } from '../../hooks/useWaybillBatches'
import { TopBar } from '../../components/layout/TopBar'
import { SearchBar } from '../../components/ui/SearchBar'
import { OrderCard } from '../orders/OrderCard'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { Input, Select, Textarea } from '../../components/ui/Input'
import { SkeletonList } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'
import { useAuthStore } from '../../stores/authStore'
import { useAppStore } from '../../stores/appStore'
import { useWarehouses, useProducts } from '../../hooks/useBusinesses'
import { NIGERIAN_STATES, formatDate } from '../../utils/format'

const TABS = [
  { key: 'awaiting', label: 'Awaiting Waybill' },
  { key: 'sent_to_park', label: 'Sent Back to Park' },
  { key: 'batches', label: 'Batches' },
  { key: 'waybilled', label: 'In Transit' },
  { key: 'transfers', label: 'Transfers' },
]

export function WaybillPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState(searchParams.get('tab') || 'awaiting')
  const [search, setSearch] = useState('')
  const [showBatchModal, setShowBatchModal] = useState(false)
  const [showTransferModal, setShowTransferModal] = useState(false)
  const [selectedOrders, setSelectedOrders] = useState([])
  const { user } = useAuthStore()
  const { showToast } = useAppStore()
  const queryClient = useQueryClient()
  const { data: warehouses } = useWarehouses()
  const { data: products } = useProducts()
  const [transferForm, setTransferForm] = useState({
    product_id: '', from_warehouse_id: '', to_warehouse_id: '', quantity: '', notes: ''
  })

  const awaitingOrders = useOrders({ statuses: ['awaiting_waybill', 'sent_to_park', 'batch_processing'] })
  const waybilledOrders = useOrders({ status: 'waybilled' })

  const batches = useQuery({
    queryKey: ['waybill_batches'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('waybill_batches')
        .select('*, items:waybill_batch_orders(count)')
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return data || []
    },
    staleTime: 30000,
  })

  const transfers = useQuery({
    queryKey: ['warehouse_transfers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('warehouse_transfers')
        .select('*, product:products(name), from_wh:warehouses!warehouse_transfers_from_warehouse_id_fkey(name), to_wh:warehouses!warehouse_transfers_to_warehouse_id_fkey(name)')
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return data || []
    },
    staleTime: 30000,
  })

  const [batchForm, setBatchForm] = useState({
    courier_company: '', waybill_type: 'external', tracking_number: '',
    date_shipped: new Date().toISOString().split('T')[0],
    source_warehouse_id: '', notes: '',
  })
  // Leaving From: 'warehouse' (default) or a Product Holding Queue record
  const [sourceType, setSourceType] = useState('warehouse')
  const [showHoldingPicker, setShowHoldingPicker] = useState(false)
  const [holdingSearch, setHoldingSearch] = useState('')
  const [sourceHolding, setSourceHolding] = useState(null)  // selected holding record
  const [holdingQty, setHoldingQty] = useState('')

  const holdingQ = useQuery({
    queryKey: ['holding_queue', 'picker'],
    enabled: showHoldingPicker || sourceType === 'holding',
    retry: false,
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from('holding_queue')
          .select('*')
          .in('status', ['holding', 'collected'])
          .order('created_at', { ascending: false })
        if (error) throw error
        return data || []
      } catch { return null }
    },
    staleTime: 30000,
  })

  const createWaybillBatch = useCreateWaybillBatch()

  async function createBatch() {
    if (selectedOrders.length === 0) { showToast('Select at least one order', 'error'); return }
    if (sourceType === 'holding' && !sourceHolding) {
      showToast('Select the product from the Holding Queue', 'error'); return
    }
    try {
      const { batch, batchNumber } = await createWaybillBatch.mutateAsync({
        form: sourceType === 'holding' ? { ...batchForm, source_warehouse_id: '' } : batchForm,
        selectedOrders,
        awaitingOrders: awaitingOrders.data,
      })

      // Shipment originates from a Holding Queue product: link it, record the
      // origin details, and deduct the used quantity from the queue
      if (sourceType === 'holding' && sourceHolding) {
        const useQty = Math.min(Math.max(1, Number(holdingQty) || sourceHolding.quantity), sourceHolding.quantity)
        const remaining = sourceHolding.quantity - useQty
        await supabase.from('waybill_batches').update({
          source_type: 'holding',
          source_holding_id: sourceHolding.id,
          source_state: sourceHolding.state,
          source_details: [
            [sourceHolding.state, sourceHolding.city].filter(Boolean).join(', '),
            sourceHolding.park_name,
            sourceHolding.contact_name ? `${sourceHolding.contact_name} (${sourceHolding.contact_phone || 'no phone'})` : null,
          ].filter(Boolean).join(' · '),
        }).eq('id', batch.id) // best-effort: columns may not exist pre-migration
        await supabase.from('holding_queue').update(
          remaining > 0
            ? { quantity: remaining, updated_at: new Date().toISOString() }
            : {
                quantity: 0, status: 'transferred',
                notes: [sourceHolding.notes, `Used in ${batchNumber}`].filter(Boolean).join(' · '),
                updated_at: new Date().toISOString(),
              }
        ).eq('id', sourceHolding.id)
        await supabase.from('waybill_batch_timeline').insert({
          batch_id: batch.id,
          event: 'Source: Product Holding Queue',
          notes: `${useQty} × ${sourceHolding.product_name} from ${sourceHolding.state}${sourceHolding.park_name ? ` (${sourceHolding.park_name})` : ''}${sourceHolding.source_order_number ? ` — originally ${sourceHolding.source_order_number}` : ''}`,
          staff_id: user?.id,
          staff_name: user?.name,
        })
        queryClient.invalidateQueries({ queryKey: ['holding_queue'] })
      }

      showToast(`Batch ${batchNumber} created`, 'success')
      setShowBatchModal(false)
      setSelectedOrders([])
      setSourceType('warehouse')
      setSourceHolding(null)
      setHoldingQty('')
      navigate(`/waybill/batches/${batch.id}`)
    } catch (err) {
      showToast(err.message, 'error')
    }
  }

  async function createTransfer() {
    if (!transferForm.product_id || !transferForm.from_warehouse_id || !transferForm.to_warehouse_id || !transferForm.quantity) {
      showToast('Fill in all required fields', 'error'); return
    }
    if (transferForm.from_warehouse_id === transferForm.to_warehouse_id) {
      showToast('Source and destination must be different', 'error'); return
    }
    const year = new Date().getFullYear()
    const { data: lastTransfer } = await supabase
      .from('warehouse_transfers').select('transfer_number').order('created_at', { ascending: false }).limit(1).maybeSingle()
    const lastTrNum = lastTransfer?.transfer_number ? parseInt(lastTransfer.transfer_number.split('-').pop()) || 0 : 0
    const transferNumber = `TR-${year}-${String(lastTrNum + 1).padStart(5, '0')}`
    const { error } = await supabase.from('warehouse_transfers').insert({
      transfer_number: transferNumber,
      product_id: transferForm.product_id,
      from_warehouse_id: transferForm.from_warehouse_id,
      to_warehouse_id: transferForm.to_warehouse_id,
      quantity: Number(transferForm.quantity),
      notes: transferForm.notes,
      status: 'in_transit',
      created_by: user?.id,
    })
    if (error) { showToast(error.message, 'error'); return }
    showToast(`Transfer ${transferNumber} created`, 'success')
    setShowTransferModal(false)
    setTransferForm({ product_id: '', from_warehouse_id: '', to_warehouse_id: '', quantity: '', notes: '' })
    queryClient.invalidateQueries({ queryKey: ['warehouse_transfers'] })
  }

  function toggleOrder(orderId) {
    setSelectedOrders(prev =>
      prev.includes(orderId) ? prev.filter(id => id !== orderId) : [...prev, orderId]
    )
  }

  function toggleSelectAll() {
    const all = awaitingOrders.data || []
    const pool = tab === 'sent_to_park'
      ? all.filter(o => o.status === 'sent_to_park')
      : all.filter(o => o.status === 'awaiting_waybill')
    const selectableIds = pool.map(o => o.id)
    if (selectedOrders.length === selectableIds.length) {
      setSelectedOrders([])
    } else {
      setSelectedOrders(selectableIds)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-x-hidden w-full">
      <TopBar
        title="Waybill"
        back={false}
        actions={
          (tab === 'awaiting' || tab === 'sent_to_park') && (
            <Button size="sm" onClick={() => setShowBatchModal(true)} disabled={selectedOrders.length === 0}>
              Create Batch ({selectedOrders.length})
            </Button>
          )
        }
      />

      <div className="bg-white border-b border-gray-100 sticky top-[57px] z-20 overflow-x-hidden w-full">
        <div className="px-4 pt-3">
          <SearchBar value={search} onChange={setSearch} placeholder="Search..." />
        </div>
        <div className="flex gap-2 px-4 py-3 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {TABS.map(({ key, label }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium ${tab === key ? 'bg-blue-600 text-black' : 'bg-gray-100 text-gray-600'}`}
            >{label}</button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4">
        {(tab === 'awaiting' || tab === 'sent_to_park') && (() => {
          const all = awaitingOrders.data || []
          // "Sent Back to Park" = returned orders re-routed to another state,
          // awaiting a fresh waybill; the Awaiting tab keeps normal new orders
          const orders = tab === 'sent_to_park'
            ? all.filter(o => o.status === 'sent_to_park')
            : all.filter(o => o.status !== 'sent_to_park')
          const selectableOrders = orders.filter(o => ['awaiting_waybill', 'sent_to_park'].includes(o.status))
          const inBatchCount = orders.filter(o => o.status === 'batch_processing').length
          return (
            <div className="space-y-3">
              {tab === 'sent_to_park' && (
                <p className="text-xs text-cyan-800 bg-cyan-50 rounded-xl px-3 py-2">
                  Returned products sent back to a State Park for transfer to another state — select and create a new waybill to ship them.
                </p>
              )}
              {orders.length > 0 && (
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-500">
                    {selectableOrders.length} ready
                    {inBatchCount > 0 ? ` · ${inBatchCount} in batch` : ''}
                  </p>
                  {selectableOrders.length > 0 && (
                    <button onClick={toggleSelectAll} className="text-xs font-medium text-blue-600 active:scale-95">
                      {selectedOrders.length === selectableOrders.length ? 'Deselect All' : 'Select All'}
                    </button>
                  )}
                </div>
              )}
              {awaitingOrders.isLoading ? <SkeletonList count={4} /> :
               orders.length === 0 ? (
                 <EmptyState
                   title={tab === 'sent_to_park' ? 'Nothing sent back to park' : 'No orders awaiting waybill'}
                   description={tab === 'sent_to_park' ? 'Returned orders re-routed to another state will appear here' : undefined}
                   icon={<Truck size={28} />}
                 />
               ) :
               orders.map(order => {
                const inBatch = order.status === 'batch_processing'
                return (
                  <div key={order.id} className="relative">
                    <div className="absolute top-3 left-3 z-10">
                      {inBatch ? (
                        <div className="w-5 h-5 rounded-md border-2 border-amber-400 bg-amber-50 flex items-center justify-center">
                          <div className="w-2 h-2 rounded-full bg-amber-400" />
                        </div>
                      ) : (
                        <button
                          onClick={() => toggleOrder(order.id)}
                          className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${
                            selectedOrders.includes(order.id) ? 'bg-blue-600 border-blue-600' : 'border-gray-300 bg-white'
                          }`}
                        >
                          {selectedOrders.includes(order.id) && <svg viewBox="0 0 10 10" className="w-3 h-3 fill-white"><path d="M1 5l3 3 5-6" stroke="white" strokeWidth="1.5" fill="none"/></svg>}
                        </button>
                      )}
                    </div>
                    <div className="pl-8">
                      {inBatch && (
                        <p className="text-xs text-amber-600 font-medium mb-1 flex items-center gap-1">
                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" />
                          Waybill in Process
                        </p>
                      )}
                      <OrderCard order={order} onClick={() => navigate(`/orders/${order.id}`)} />
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })()}

        {tab === 'batches' && (
          <div className="space-y-3">
            {batches.isLoading ? <SkeletonList count={3} /> :
             batches.data?.length === 0 ? <EmptyState title="No waybill batches" icon={<Truck size={28} />} /> :
             batches.data.map(batch => {
               const statusColor = batch.status === 'received' ? 'bg-green-100 text-green-700'
                 : batch.status === 'packed' ? 'bg-purple-100 text-purple-700'
                 : batch.status === 'created' ? 'bg-blue-100 text-blue-700'
                 : 'bg-amber-100 text-amber-700'
               const statusLabel = batch.status === 'received' ? 'Received'
                 : batch.status === 'packed' ? 'Packed'
                 : batch.status === 'created' ? 'Created'
                 : 'In Transit'
               return (
                 <button key={batch.id} onClick={() => navigate(`/waybill/batches/${batch.id}`)}
                   className="w-full bg-white rounded-2xl p-4 border border-gray-100 text-left active:bg-gray-50 transition-colors">
                   <div className="flex items-start justify-between mb-2">
                     <div>
                       <span className="text-xs font-mono text-gray-400">{batch.batch_number}</span>
                       <span className={`ml-2 text-xs px-2 py-0.5 rounded-full font-medium ${statusColor}`}>
                         {statusLabel}
                       </span>
                     </div>
                     <ChevronRight size={16} className="text-gray-300 mt-0.5" />
                   </div>
                   <p className="text-sm font-medium text-gray-900">{batch.courier_company}</p>
                   <p className="text-xs text-gray-500">{batch.destination_state || '—'}{batch.tracking_number ? ` · ${batch.tracking_number}` : ''}</p>
                   <p className="text-xs text-gray-400 mt-0.5">{formatDate(batch.created_at)}</p>
                 </button>
               )
             })}
          </div>
        )}

        {tab === 'waybilled' && (
          <div className="space-y-3">
            {waybilledOrders.isLoading ? <SkeletonList count={4} /> :
             waybilledOrders.data?.length === 0 ? <EmptyState title="No orders in transit" icon={<Truck size={28} />} /> :
             waybilledOrders.data.map(order => (
              <OrderCard key={order.id} order={order} onClick={() => navigate(`/orders/${order.id}`)} />
            ))}
          </div>
        )}

        {tab === 'transfers' && (
          <div className="space-y-3">
            <button onClick={() => setShowTransferModal(true)}
              className="w-full py-3 bg-blue-600 text-black rounded-2xl text-sm font-medium flex items-center justify-center gap-2 active:scale-95 transition-all">
              <Plus size={16} /> New Warehouse Transfer
            </button>
            {transfers.isLoading ? <SkeletonList count={3} /> :
             transfers.data?.length === 0 ? <EmptyState title="No transfers" /> :
             transfers.data.map(t => (
              <div key={t.id} className="bg-white rounded-2xl p-4 border border-gray-100">
                <div className="flex justify-between items-start mb-1">
                  <span className="text-xs font-mono text-gray-400">{t.transfer_number}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${t.status === 'received' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                    {t.status}
                  </span>
                </div>
                <p className="text-sm font-semibold text-gray-900">{t.product?.name || t.product_name}</p>
                <p className="text-xs text-gray-500">Qty: {t.quantity} · {t.from_wh?.name} → {t.to_wh?.name}</p>
                <p className="text-xs text-gray-400">{formatDate(t.created_at)}</p>
                {t.status === 'in_transit' && (
                  <button
                    onClick={async () => {
                      await supabase.from('warehouse_transfers').update({
                        status: 'received', received_at: new Date().toISOString(), received_by: user?.id
                      }).eq('id', t.id)
                      showToast('Transfer marked as received', 'success')
                      queryClient.invalidateQueries({ queryKey: ['warehouse_transfers'] })
                    }}
                    className="mt-3 w-full py-2 bg-green-600 text-white text-sm font-medium rounded-xl active:scale-95 transition-all"
                  >
                    Mark Received
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Batch Modal */}
      <Modal
        isOpen={showBatchModal}
        onClose={() => setShowBatchModal(false)}
        title="Create Waybill Batch"
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowBatchModal(false)} className="flex-1">Cancel</Button>
            <Button onClick={createBatch} className="flex-1">Create Batch</Button>
          </div>
        }
      >
        <div className="space-y-4">
          {/* Destination states — auto-derived from selected orders */}
          {(() => {
            const states = [...new Set(
              (awaitingOrders.data || [])
                .filter(o => selectedOrders.includes(o.id))
                .map(o => o.state).filter(Boolean)
            )].sort()
            return states.length > 0 ? (
              <div className="bg-blue-50 rounded-xl px-3 py-2.5">
                <p className="text-xs font-semibold text-blue-700 mb-1">Destination States</p>
                <div className="flex flex-wrap gap-1.5">
                  {states.map(s => (
                    <span key={s} className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full font-medium">{s}</span>
                  ))}
                </div>
              </div>
            ) : null
          })()}

          {/* Leaving From — warehouse or a product already in the Holding Queue */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-1.5">Leaving From</p>
            <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-2">
              {[
                { key: 'warehouse', label: 'Warehouse' },
                { key: 'holding',   label: 'Holding Queue' },
              ].map(v => (
                <button key={v.key} type="button"
                  onClick={() => { setSourceType(v.key); if (v.key === 'warehouse') setSourceHolding(null) }}
                  className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
                    sourceType === v.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
                  }`}>
                  {v.label}
                </button>
              ))}
            </div>

            {sourceType === 'warehouse' ? (
              <Select value={batchForm.source_warehouse_id}
                onChange={e => setBatchForm({ ...batchForm, source_warehouse_id: e.target.value })}>
                <option value="">Select warehouse...</option>
                {(warehouses || []).map(w => <option key={w.id} value={w.id}>{w.name} — {w.state}</option>)}
              </Select>
            ) : sourceHolding ? (
              <div className="bg-cyan-50 rounded-xl p-3 space-y-1">
                <p className="text-sm font-semibold text-gray-900">{sourceHolding.quantity} × {sourceHolding.product_name}</p>
                <p className="text-xs text-gray-600">
                  {[sourceHolding.state, sourceHolding.city, sourceHolding.park_name].filter(Boolean).join(' · ')}
                </p>
                {sourceHolding.contact_name && (
                  <p className="text-xs text-gray-600">Contact: {sourceHolding.contact_name} · {sourceHolding.contact_phone}</p>
                )}
                {sourceHolding.source_order_number && (
                  <p className="text-[11px] font-mono text-gray-400">from {sourceHolding.source_order_number}</p>
                )}
                <div className="flex items-end gap-2 pt-1">
                  <div className="flex-1">
                    <Input label="Quantity to use" type="number" inputMode="numeric" min="1" max={sourceHolding.quantity}
                      value={holdingQty} onChange={e => setHoldingQty(e.target.value)} />
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => setShowHoldingPicker(true)}>Change</Button>
                </div>
              </div>
            ) : (
              <Button variant="secondary" className="w-full" onClick={() => setShowHoldingPicker(true)}>
                Select Product from Holding Queue
              </Button>
            )}
          </div>
          <Select label="Waybill Type" value={batchForm.waybill_type}
            onChange={e => setBatchForm({ ...batchForm, waybill_type: e.target.value })}>
            <option value="external">External Courier</option>
            <option value="internal">Internal (Own Vehicle)</option>
          </Select>
          <Input label="Courier Company" placeholder="e.g. GIG Logistics"
            value={batchForm.courier_company} onChange={e => setBatchForm({ ...batchForm, courier_company: e.target.value })} />
          <Input label="Tracking / Waybill Number"
            value={batchForm.tracking_number} onChange={e => setBatchForm({ ...batchForm, tracking_number: e.target.value })} />
          <Input label="Date Shipped" type="date"
            value={batchForm.date_shipped} onChange={e => setBatchForm({ ...batchForm, date_shipped: e.target.value })} />
          <Textarea label="Notes" rows={2}
            value={batchForm.notes} onChange={e => setBatchForm({ ...batchForm, notes: e.target.value })} />
        </div>
      </Modal>

      {/* Create Transfer Modal */}
      <Modal
        isOpen={showTransferModal}
        onClose={() => setShowTransferModal(false)}
        title="New Warehouse Transfer"
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowTransferModal(false)} className="flex-1">Cancel</Button>
            <Button onClick={createTransfer} className="flex-1">Create Transfer</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Select label="Product" required value={transferForm.product_id}
            onChange={e => setTransferForm({ ...transferForm, product_id: e.target.value })}>
            <option value="">Select product...</option>
            {(products || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Select label="From Warehouse" required value={transferForm.from_warehouse_id}
            onChange={e => setTransferForm({ ...transferForm, from_warehouse_id: e.target.value })}>
            <option value="">Select source...</option>
            {(warehouses || []).map(w => <option key={w.id} value={w.id}>{w.name} ({w.state})</option>)}
          </Select>
          <Select label="To Warehouse" required value={transferForm.to_warehouse_id}
            onChange={e => setTransferForm({ ...transferForm, to_warehouse_id: e.target.value })}>
            <option value="">Select destination...</option>
            {(warehouses || []).map(w => <option key={w.id} value={w.id}>{w.name} ({w.state})</option>)}
          </Select>
          <Input label="Quantity" type="number" inputMode="numeric" required
            value={transferForm.quantity}
            onChange={e => setTransferForm({ ...transferForm, quantity: e.target.value })} />
          <Textarea label="Notes" rows={2}
            value={transferForm.notes}
            onChange={e => setTransferForm({ ...transferForm, notes: e.target.value })} />
        </div>
      </Modal>

      {/* Holding Queue picker — use an undelivered product as the shipment source */}
      <Modal
        isOpen={showHoldingPicker}
        onClose={() => setShowHoldingPicker(false)}
        title="Select from Holding Queue"
      >
        <div className="space-y-3">
          <SearchBar value={holdingSearch} onChange={setHoldingSearch} placeholder="Search product, state, order #..." />
          {holdingQ.data === null ? (
            <p className="text-sm text-amber-700 bg-amber-50 rounded-xl p-3">
              Run the Product Holding Queue migration first.
            </p>
          ) : (holdingQ.data || []).filter(h => {
            const q = holdingSearch.toLowerCase()
            return !q || (h.product_name || '').toLowerCase().includes(q) ||
              (h.state || '').toLowerCase().includes(q) ||
              (h.source_order_number || '').toLowerCase().includes(q)
          }).length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No products in the holding queue</p>
          ) : (holdingQ.data || []).filter(h => {
            const q = holdingSearch.toLowerCase()
            return !q || (h.product_name || '').toLowerCase().includes(q) ||
              (h.state || '').toLowerCase().includes(q) ||
              (h.source_order_number || '').toLowerCase().includes(q)
          }).map(h => (
            <button key={h.id} type="button"
              onClick={() => {
                setSourceHolding(h)
                setHoldingQty(String(h.quantity))
                setShowHoldingPicker(false)
              }}
              className="w-full text-left bg-white border border-gray-200 rounded-xl p-3 active:scale-[0.99] transition-all">
              <p className="text-sm font-semibold text-gray-900">{h.quantity} × {h.product_name}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {[h.state, h.city, h.park_name].filter(Boolean).join(' · ')}
              </p>
              {h.contact_name && (
                <p className="text-xs text-gray-500">Contact: {h.contact_name}{h.contact_phone ? ` · ${h.contact_phone}` : ''}</p>
              )}
              {h.source_order_number && (
                <p className="text-[11px] font-mono text-gray-400 mt-0.5">from {h.source_order_number}</p>
              )}
            </button>
          ))}
          <p className="text-[11px] text-gray-400">
            Approval for using a holding product happens in the WhatsApp operations group — the app records the final choice.
          </p>
        </div>
      </Modal>
    </div>
  )
}
