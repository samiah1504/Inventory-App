import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Package, DollarSign, Clock, CheckSquare, ChevronRight, CheckCircle } from 'lucide-react'
import { useWaybillBatch, useSaveBatchExpenses, useTogglePackingItem, useAdvanceBatchStatus } from '../../hooks/useWaybillBatches'
import { TopBar } from '../../components/layout/TopBar'
import { Button } from '../../components/ui/Button'
import { Input, Textarea } from '../../components/ui/Input'
import { useAppStore } from '../../stores/appStore'
import { formatCurrency, formatDate } from '../../utils/format'
import { generatePackingList, generateWaybillSummary, savePdf } from '../../lib/pdf'

const STATUS_LABEL = {
  created: 'Created',
  packed: 'Packed',
  waybilled: 'In Transit',
  in_transit: 'In Transit',
  received: 'Received',
}

const STATUS_COLOR = {
  created: 'bg-blue-100 text-blue-700',
  packed: 'bg-purple-100 text-purple-700',
  waybilled: 'bg-amber-100 text-amber-700',
  in_transit: 'bg-amber-100 text-amber-700',
  received: 'bg-green-100 text-green-700',
}

const TABS = [
  { key: 'orders', label: 'Orders', icon: ChevronRight },
  { key: 'pack', label: 'Pack', icon: Package },
  { key: 'expenses', label: 'Expenses', icon: DollarSign },
  { key: 'timeline', label: 'Timeline', icon: Clock },
]

export function WaybillBatchDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { showToast } = useAppStore()
  const [tab, setTab] = useState('orders')
  const [allocationMode, setAllocationMode] = useState('equal')
  const [expenses, setExpenses] = useState({
    waybill_cost: '', packaging_cost: '', loading_cost: '',
    transport_cost: '', dispatch_cost: '', other_cost: '', expense_notes: '',
  })
  const [expensesLoaded, setExpensesLoaded] = useState(false)

  const { data, isLoading, error } = useWaybillBatch(id)
  const saveBatchExpenses = useSaveBatchExpenses()
  const togglePackingItem = useTogglePackingItem()
  const advanceBatchStatus = useAdvanceBatchStatus()

  // Populate expense fields from DB once loaded
  if (data?.batch && !expensesLoaded) {
    const b = data.batch
    setExpenses({
      waybill_cost: b.waybill_cost || '',
      packaging_cost: b.packaging_cost || '',
      loading_cost: b.loading_cost || '',
      transport_cost: b.transport_cost || '',
      dispatch_cost: b.dispatch_cost || '',
      other_cost: b.other_cost || '',
      expense_notes: b.expense_notes || '',
    })
    setExpensesLoaded(true)
    if (b.cost_allocation) setAllocationMode(b.cost_allocation)
  }

  if (isLoading) return (
    <div className="flex flex-col h-full">
      <TopBar title="Batch Detail" />
      <div className="flex-1 flex items-center justify-center">
        <p className="text-gray-400 text-sm">Loading...</p>
      </div>
    </div>
  )

  if (error || !data) return (
    <div className="flex flex-col h-full">
      <TopBar title="Batch Detail" />
      <div className="flex-1 flex items-center justify-center">
        <p className="text-red-500 text-sm">Failed to load batch</p>
      </div>
    </div>
  )

  const { batch, orders, packingItems, timeline } = data
  const orderIds = orders.map(bo => bo.order?.id).filter(Boolean)
  const status = batch.status
  const isTransit = status === 'waybilled' || status === 'in_transit'
  const isDone = status === 'received'

  const expenseTotal = ['waybill_cost', 'packaging_cost', 'loading_cost', 'transport_cost', 'dispatch_cost', 'other_cost']
    .reduce((s, k) => s + (Number(expenses[k]) || 0), 0)

  async function handleAdvance(newStatus) {
    await advanceBatchStatus.mutateAsync({
      batchId: id,
      newStatus,
      batchNumber: batch.batch_number,
      orderIds,
    })
    showToast(
      newStatus === 'packed' ? 'Packing confirmed' :
      newStatus === 'waybilled' ? 'Batch dispatched' :
      'Marked as received', 'success'
    )
  }

  async function handleSaveExpenses() {
    await saveBatchExpenses.mutateAsync({
      batchId: id,
      expenses,
      allocationMode,
      batchOrders: orders,
    })
    showToast('Expenses saved', 'success')
  }

  async function handleTogglePack(item) {
    await togglePackingItem.mutateAsync({
      itemId: item.id,
      isPacked: !item.is_packed,
      batchId: id,
    })
  }

  const allPacked = packingItems.length > 0 && packingItems.every(i => i.is_packed)

  return (
    <div className="flex flex-col h-full">
      <TopBar title={batch.batch_number} />

      {/* Batch Header */}
      <div className="bg-gray-900 text-white px-4 pt-4 pb-5">
        <div className="flex items-center justify-between mb-1">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[status] || 'bg-gray-100 text-gray-600'}`}>
            {STATUS_LABEL[status] || status}
          </span>
          <span className="text-xs text-gray-400">{formatDate(batch.created_at)}</span>
        </div>
        <p className="text-base font-semibold text-white mt-1">{batch.courier_company || 'No courier'}</p>
        <p className="text-xs text-gray-400">{batch.destination_state}{batch.tracking_number ? ` · ${batch.tracking_number}` : ''}</p>
        <p className="text-xs text-gray-400">{orders.length} order{orders.length !== 1 ? 's' : ''} · Total cost: {formatCurrency(batch.total_cost || 0)}</p>

        {/* Action buttons */}
        {!isDone && (
          <div className="mt-3 flex gap-2">
            {status === 'created' && (
              <Button size="sm" onClick={() => handleAdvance('packed')} disabled={advanceBatchStatus.isPending}
                className="flex-1">
                {allPacked ? 'Confirm Packing Done' : 'Confirm Packing Done'}
              </Button>
            )}
            {status === 'packed' && (
              <Button size="sm" onClick={() => handleAdvance('waybilled')} disabled={advanceBatchStatus.isPending}
                className="flex-1">
                Confirm Dispatched
              </Button>
            )}
            {isTransit && (
              <Button size="sm" onClick={() => handleAdvance('received')} disabled={advanceBatchStatus.isPending}
                className="flex-1">
                Mark Received
              </Button>
            )}
            <button
              onClick={() => savePdf(generatePackingList(batch, packingItems, orders), `${batch.batch_number}-packing.pdf`)}
              className="px-3 py-2 bg-gray-800 text-gray-300 rounded-xl text-xs font-medium active:scale-95 transition-all"
            >
              Packing PDF
            </button>
            <button
              onClick={() => savePdf(generateWaybillSummary(batch, orders, expenses), `${batch.batch_number}-summary.pdf`)}
              className="px-3 py-2 bg-gray-800 text-gray-300 rounded-xl text-xs font-medium active:scale-95 transition-all"
            >
              Summary PDF
            </button>
          </div>
        )}
        {isDone && (
          <div className="mt-3 flex items-center gap-2 text-green-400">
            <CheckCircle size={16} />
            <span className="text-sm font-medium">Received at warehouse</span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-100 sticky top-[57px] z-20">
        <div className="flex gap-0">
          {TABS.map(({ key, label }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`flex-1 py-3 text-xs font-medium transition-colors border-b-2 ${tab === key ? 'border-yellow-500 text-gray-900' : 'border-transparent text-gray-400'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">

        {/* Orders Tab */}
        {tab === 'orders' && (
          <div className="space-y-2">
            {orders.length === 0 && <p className="text-sm text-gray-400 text-center py-8">No orders in this batch</p>}
            {orders.map(bo => {
              const o = bo.order
              if (!o) return null
              return (
                <button key={bo.id} onClick={() => navigate(`/orders/${o.id}`)}
                  className="w-full bg-white rounded-2xl p-4 border border-gray-100 text-left active:bg-gray-50 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono text-gray-400">{o.order_number}</p>
                      <p className="text-sm font-semibold text-gray-900">{o.customer_name}</p>
                      <p className="text-xs text-gray-500">{o.product_name} · {o.state}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-gray-900">{formatCurrency(o.total_amount)}</p>
                      {bo.allocated_logistics_cost > 0 && (
                        <p className="text-xs text-gray-400">+{formatCurrency(bo.allocated_logistics_cost)} logistics</p>
                      )}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {/* Pack Tab */}
        {tab === 'pack' && (
          <div className="space-y-4">
            {packingItems.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-8">No packing items</p>
            )}
            {packingItems.length > 0 && (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-500">{packingItems.filter(i => i.is_packed).length}/{packingItems.length} packed</p>
                  {allPacked && (
                    <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                      <CheckCircle size={12} /> All packed
                    </span>
                  )}
                </div>

                {/* Group by state */}
                {Array.from(new Set(packingItems.map(i => i.state))).map(state => (
                  <div key={state} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                    <div className="px-4 py-2 bg-gray-50 border-b border-gray-100">
                      <p className="text-xs font-semibold text-gray-700">{state}</p>
                    </div>
                    {packingItems.filter(i => i.state === state).map(item => (
                      <button
                        key={item.id}
                        onClick={() => !isDone && handleTogglePack(item)}
                        disabled={isDone || togglePackingItem.isPending}
                        className="w-full px-4 py-3 flex items-center gap-3 active:bg-gray-50 transition-colors border-b border-gray-50 last:border-b-0"
                      >
                        <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all ${
                          item.is_packed ? 'bg-green-500 border-green-500' : 'border-gray-300'
                        }`}>
                          {item.is_packed && <svg viewBox="0 0 10 10" className="w-3 h-3"><path d="M1 5l3 3 5-6" stroke="white" strokeWidth="1.5" fill="none"/></svg>}
                        </div>
                        <div className="flex-1 text-left">
                          <p className={`text-sm font-medium ${item.is_packed ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                            {item.product_name}
                          </p>
                          <p className="text-xs text-gray-400">Qty: {item.quantity}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                ))}

                {status === 'created' && (
                  <Button
                    onClick={() => handleAdvance('packed')}
                    disabled={advanceBatchStatus.isPending}
                    className="w-full"
                  >
                    Confirm Packing Done
                  </Button>
                )}
              </>
            )}
          </div>
        )}

        {/* Expenses Tab */}
        {tab === 'expenses' && (
          <div className="space-y-4">
            {batch.expenses_saved && (
              <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center gap-2">
                <CheckCircle size={14} className="text-green-600 shrink-0" />
                <p className="text-xs text-green-700 font-medium">Expenses saved · {formatCurrency(batch.total_cost)}</p>
              </div>
            )}

            <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
              {[
                { key: 'waybill_cost', label: 'Waybill Fee' },
                { key: 'packaging_cost', label: 'Packaging' },
                { key: 'loading_cost', label: 'Loading' },
                { key: 'transport_cost', label: 'Transport' },
                { key: 'dispatch_cost', label: 'Dispatch' },
                { key: 'other_cost', label: 'Other' },
              ].map(({ key, label }) => (
                <Input
                  key={key}
                  label={label + ' (₦)'}
                  type="number"
                  inputMode="decimal"
                  value={expenses[key]}
                  onChange={e => setExpenses(prev => ({ ...prev, [key]: e.target.value }))}
                  disabled={isDone}
                />
              ))}

              <div className="pt-2 border-t border-gray-100">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-700">Total</span>
                  <span className="text-lg font-bold text-gray-900">{formatCurrency(expenseTotal)}</span>
                </div>
                {orders.length > 0 && expenseTotal > 0 && (
                  <p className="text-xs text-gray-400 mt-0.5 text-right">
                    ≈ {formatCurrency(expenseTotal / orders.length)} per order (equal split)
                  </p>
                )}
              </div>

              <Textarea
                label="Notes"
                rows={2}
                value={expenses.expense_notes}
                onChange={e => setExpenses(prev => ({ ...prev, expense_notes: e.target.value }))}
                disabled={isDone}
              />
            </div>

            {!isDone && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <button
                    onClick={() => setAllocationMode('equal')}
                    className={`flex-1 py-2.5 rounded-xl text-xs font-medium transition-all border ${allocationMode === 'equal' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200'}`}
                  >
                    Equal Split
                  </button>
                  <button
                    onClick={() => setAllocationMode('manual')}
                    className={`flex-1 py-2.5 rounded-xl text-xs font-medium transition-all border ${allocationMode === 'manual' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200'}`}
                  >
                    Manual
                  </button>
                </div>
                <Button
                  onClick={handleSaveExpenses}
                  disabled={saveBatchExpenses.isPending}
                  className="w-full"
                >
                  Save Expenses
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Timeline Tab */}
        {tab === 'timeline' && (
          <div className="space-y-0">
            {timeline.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-8">No timeline events</p>
            )}
            {timeline.map((event, idx) => (
              <div key={event.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-500 mt-1 shrink-0" />
                  {idx < timeline.length - 1 && <div className="w-0.5 bg-gray-200 flex-1 my-1" />}
                </div>
                <div className="pb-5 flex-1">
                  <p className="text-sm font-semibold text-gray-900">{event.event}</p>
                  {event.notes && <p className="text-xs text-gray-500 mt-0.5">{event.notes}</p>}
                  <p className="text-xs text-gray-400 mt-0.5">
                    {event.staff_name && `${event.staff_name} · `}{formatDate(event.created_at)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
