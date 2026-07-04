import { useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Plus, Truck } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useOrders } from '../../hooks/useOrders'
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
import { useQueryClient } from '@tanstack/react-query'

const TABS = [
  { key: 'awaiting', label: 'Awaiting Waybill' },
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

  const awaitingOrders = useOrders({ status: 'awaiting_waybill' })
  const waybilledOrders = useOrders({ status: 'waybilled' })

  const batches = useQuery({
    queryKey: ['waybill_batches'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('waybill_batches')
        .select('*, items:waybill_batch_orders(count), warehouse:warehouses(name, state)')
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
    destination_state: '', destination_warehouse_id: '', total_cost: '', notes: ''
  })

  async function createBatch() {
    if (selectedOrders.length === 0) { showToast('Select at least one order', 'error'); return }
    const year = new Date().getFullYear()
    const { data: lastBatch } = await supabase
      .from('waybill_batches').select('batch_number').order('created_at', { ascending: false }).limit(1).maybeSingle()
    const lastNum = lastBatch?.batch_number ? parseInt(lastBatch.batch_number.split('-').pop()) || 0 : 0
    const batchNumber = `WB-${year}-${String(lastNum + 1).padStart(5, '0')}`

    const { data: batch, error } = await supabase.from('waybill_batches').insert({
      ...batchForm,
      batch_number: batchNumber,
      total_cost: Number(batchForm.total_cost) || 0,
      business_id: awaitingOrders.data?.find(o => selectedOrders.includes(o.id))?.business_id || null,
      created_by: user?.id,
    }).select().single()

    if (error) { showToast(error.message, 'error'); return }

    const costPerOrder = Number(batchForm.total_cost) / selectedOrders.length

    for (const orderId of selectedOrders) {
      await supabase.from('waybill_batch_orders').insert({
        batch_id: batch.id, order_id: orderId, allocated_cost: costPerOrder
      })
      await supabase.from('orders').update({
        status: 'waybilled',
        has_waybill: true,
        updated_at: new Date().toISOString()
      }).eq('id', orderId)
      await supabase.from('order_timeline').insert({
        order_id: orderId,
        action: 'waybilled',
        description: `Waybilled in batch ${batchNumber} via ${batchForm.courier_company || 'courier'}`,
        staff_id: user?.id,
        staff_name: user?.name,
      })
    }

    showToast(`Batch ${batchNumber} created`, 'success')
    setShowBatchModal(false)
    setSelectedOrders([])
    queryClient.invalidateQueries({ queryKey: ['orders'] })
    queryClient.invalidateQueries({ queryKey: ['waybill_batches'] })
  }

  async function markReceived(batchId, batchNumber) {
    await supabase.from('waybill_batches').update({
      status: 'received', received_at: new Date().toISOString(), received_by: user?.id
    }).eq('id', batchId)

    const { data: batchOrders } = await supabase
      .from('waybill_batch_orders').select('order_id').eq('batch_id', batchId)

    for (const bo of batchOrders || []) {
      await supabase.from('orders').update({
        status: 'received_at_warehouse',
        updated_at: new Date().toISOString(),
      }).eq('id', bo.order_id)
      await supabase.from('order_timeline').insert({
        order_id: bo.order_id,
        action: 'received_at_warehouse',
        description: `Received at warehouse from batch ${batchNumber} by ${user?.name}`,
        staff_id: user?.id,
        staff_name: user?.name,
      })
    }
    showToast('Marked as received', 'success')
    queryClient.invalidateQueries({ queryKey: ['waybill_batches'] })
    queryClient.invalidateQueries({ queryKey: ['orders'] })
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
    const allIds = (awaitingOrders.data || []).map(o => o.id)
    if (selectedOrders.length === allIds.length) {
      setSelectedOrders([])
    } else {
      setSelectedOrders(allIds)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Waybill"
        back={false}
        actions={
          tab === 'awaiting' && (
            <Button size="sm" onClick={() => setShowBatchModal(true)} disabled={selectedOrders.length === 0}>
              Create Batch ({selectedOrders.length})
            </Button>
          )
        }
      />

      <div className="bg-white border-b border-gray-100 sticky top-[57px] z-20">
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

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {tab === 'awaiting' && (
          <div className="space-y-3">
            {awaitingOrders.data && awaitingOrders.data.length > 0 && (
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500">{awaitingOrders.data.length} order{awaitingOrders.data.length !== 1 ? 's' : ''}</p>
                <button
                  onClick={toggleSelectAll}
                  className="text-xs font-medium text-blue-600 active:scale-95"
                >
                  {selectedOrders.length === awaitingOrders.data.length ? 'Deselect All' : 'Select All'}
                </button>
              </div>
            )}
            {awaitingOrders.isLoading ? <SkeletonList count={4} /> :
             awaitingOrders.data?.length === 0 ? <EmptyState title="No orders awaiting waybill" icon={<Truck size={28} />} /> :
             awaitingOrders.data.map(order => (
              <div key={order.id} className="relative">
                <button
                  onClick={() => toggleOrder(order.id)}
                  className={`absolute top-3 left-3 z-10 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${
                    selectedOrders.includes(order.id) ? 'bg-blue-600 border-blue-600' : 'border-gray-300 bg-white'
                  }`}
                >
                  {selectedOrders.includes(order.id) && <svg viewBox="0 0 10 10" className="w-3 h-3 fill-white"><path d="M1 5l3 3 5-6" stroke="white" strokeWidth="1.5" fill="none"/></svg>}
                </button>
                <div className="pl-8">
                  <OrderCard order={order} onClick={() => navigate(`/orders/${order.id}`)} />
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'batches' && (
          <div className="space-y-3">
            {batches.isLoading ? <SkeletonList count={3} /> :
             batches.data?.length === 0 ? <EmptyState title="No waybill batches" icon={<Truck size={28} />} /> :
             batches.data.map(batch => (
              <div key={batch.id} className="bg-white rounded-2xl p-4 border border-gray-100">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <span className="text-xs font-mono text-gray-400">{batch.batch_number}</span>
                    <span className={`ml-2 text-xs px-2 py-0.5 rounded-full font-medium ${batch.status === 'received' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                      {batch.status === 'received' ? 'Received' : 'In Transit'}
                    </span>
                  </div>
                  <span className="text-xs text-gray-400">{formatDate(batch.created_at)}</span>
                </div>
                <p className="text-sm font-medium text-gray-900">{batch.courier_company}</p>
                <p className="text-xs text-gray-500">{batch.warehouse?.name || batch.destination_state} · {batch.tracking_number}</p>
                {batch.status === 'in_transit' && (
                  <button onClick={() => markReceived(batch.id, batch.batch_number)}
                    className="mt-3 w-full py-2 bg-green-600 text-white text-sm font-medium rounded-xl active:scale-95 transition-all">
                    Mark Received at Warehouse
                  </button>
                )}
              </div>
            ))}
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
          <p className="text-sm text-gray-500">{selectedOrders.length} order(s) selected</p>
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
          <Select label="Destination State" value={batchForm.destination_state}
            onChange={e => setBatchForm({ ...batchForm, destination_state: e.target.value })}>
            <option value="">Select state...</option>
            {NIGERIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </Select>
          <Select label="Destination Warehouse" value={batchForm.destination_warehouse_id}
            onChange={e => setBatchForm({ ...batchForm, destination_warehouse_id: e.target.value })}>
            <option value="">Select warehouse...</option>
            {(warehouses || []).map(w => <option key={w.id} value={w.id}>{w.name} ({w.state})</option>)}
          </Select>
          <Input label="Total Waybill Cost (₦)" type="number" inputMode="decimal"
            value={batchForm.total_cost} onChange={e => setBatchForm({ ...batchForm, total_cost: e.target.value })} />
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
    </div>
  )
}
