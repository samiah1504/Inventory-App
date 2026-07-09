import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { Package, DollarSign, Clock, ChevronRight, CheckCircle, MapPin, Copy } from 'lucide-react'
import { useWaybillBatch, useSaveBatchExpenses, useTogglePackingItem, useAdvanceBatchStatus, useMarkStateArrival } from '../../hooks/useWaybillBatches'
import { TopBar } from '../../components/layout/TopBar'
import { Button } from '../../components/ui/Button'
import { Input, Textarea } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { useAppStore } from '../../stores/appStore'
import { formatCurrency, formatDate } from '../../utils/format'
import { generatePackingList, generateWaybillSummary, savePdf } from '../../lib/pdf'

const COST_KEYS = [
  { key: 'waybill_cost', label: 'Waybill Fee' },
  { key: 'packaging_cost', label: 'Packaging' },
  { key: 'loading_cost', label: 'Loading' },
  { key: 'transport_cost', label: 'Transport' },
  { key: 'dispatch_cost', label: 'Dispatch' },
  { key: 'other_cost', label: 'Other' },
]

function emptyStateExpense() {
  return { destination_city: '', waybill_cost: '', packaging_cost: '', loading_cost: '', transport_cost: '', dispatch_cost: '', other_cost: '', expense_notes: '' }
}

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
  { key: 'transit', label: 'Arrival', icon: MapPin },
  { key: 'expenses', label: 'Expenses', icon: DollarSign },
  { key: 'timeline', label: 'Timeline', icon: Clock },
]

// Units shipped to a state in this batch (items_data first, order qty fallback)
function stateUnits(stateOrders) {
  return stateOrders.reduce((s, bo) => {
    const o = bo.order
    if (!o) return s
    if (Array.isArray(o.items_data) && o.items_data.length > 0) {
      return s + o.items_data.reduce((x, i) => x + (Number(i.quantity) || 1), 0)
    }
    return s + (Number(o.quantity) || 1)
  }, 0)
}

export function WaybillBatchDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { showToast } = useAppStore()
  const [tab, setTab] = useState(searchParams.get('tab') || 'orders')
  // { [state]: { destination_city, waybill_cost, ..., expense_notes } }
  const [stateExpenses, setStateExpenses] = useState({})
  // Track which states we've already initialised so user edits aren't overwritten on refetch
  const initialisedStatesRef = useRef(new Set())

  const { data, isLoading, error } = useWaybillBatch(id)
  const saveBatchExpenses = useSaveBatchExpenses()
  const togglePackingItem = useTogglePackingItem()
  const advanceBatchStatus = useAdvanceBatchStatus()
  const markArrival = useMarkStateArrival()
  const [arrivalState, setArrivalState] = useState(null)
  const [arrivalForm, setArrivalForm] = useState({ driver_name: '', driver_phone: '', park_address: '', notes: '' })

  // Initialise expense form state for each destination state as data arrives
  useEffect(() => {
    if (!data?.orders?.length) return
    const destStates = [...new Set(data.orders.map(bo => bo.order?.state).filter(Boolean))].sort()
    if (destStates.length === 0) return

    const newStates = destStates.filter(s => !initialisedStatesRef.current.has(s))
    if (newStates.length === 0) return

    setStateExpenses(prev => {
      const next = { ...prev }
      for (const state of newStates) {
        const saved = (data.stateExpenses || []).find(e => e.state === state)
        next[state] = saved ? {
          destination_city: saved.destination_city || '',
          waybill_cost: saved.waybill_cost || '',
          packaging_cost: saved.packaging_cost || '',
          loading_cost: saved.loading_cost || '',
          transport_cost: saved.transport_cost || '',
          dispatch_cost: saved.dispatch_cost || '',
          other_cost: saved.other_cost || '',
          expense_notes: saved.expense_notes || '',
        } : emptyStateExpense()
        initialisedStatesRef.current.add(state)
      }
      return next
    })
  }, [data])

  if (isLoading) return (
    <div className="flex flex-col h-full overflow-x-hidden w-full">
      <TopBar title="Batch Detail" />
      <div className="flex-1 flex items-center justify-center">
        <p className="text-gray-400 text-sm">Loading...</p>
      </div>
    </div>
  )

  if (error || !data) return (
    <div className="flex flex-col h-full overflow-x-hidden w-full">
      <TopBar title="Batch Detail" />
      <div className="flex-1 flex items-center justify-center">
        <p className="text-red-500 text-sm">Failed to load batch</p>
      </div>
    </div>
  )

  const { batch, orders, packingItems, orderItems, timeline, stateArrivals } = data
  const orderIds = orders.map(bo => bo.order?.id).filter(Boolean)
  const status = batch.status
  const isTransit = status === 'waybilled' || status === 'in_transit'
  const isDone = status === 'received'
  // Lock expenses once saved — can't edit again after that
  const expensesLocked = batch.expenses_saved

  const grandExpenseTotal = Object.values(stateExpenses).reduce((sum, exp) =>
    sum + COST_KEYS.reduce((s, { key }) => s + (Number(exp[key]) || 0), 0), 0)

  async function handleAdvance(newStatus) {
    await advanceBatchStatus.mutateAsync({
      batchId: id,
      newStatus,
      batchNumber: batch.batch_number,
      orderIds,
    })
    showToast(
      newStatus === 'packed' ? 'Packing confirmed' :
      newStatus === 'waybilled' ? 'Batch dispatched — add expenses below' :
      'Marked as received', 'success'
    )
    if (newStatus === 'waybilled' || newStatus === 'received') setTab('expenses')
  }

  async function handleSaveExpenses() {
    await saveBatchExpenses.mutateAsync({
      batchId: id,
      stateExpenses,
      batchOrders: orders,
    })
    showToast('Expenses saved', 'success')
  }

  function updateStateExpense(state, field, value) {
    setStateExpenses(prev => ({ ...prev, [state]: { ...prev[state], [field]: value } }))
  }

  // ── Per-state arrival ─────────────────────────────────────────────────────

  const destStates = [...new Set(orders.map(bo => bo.order?.state).filter(Boolean))].sort()
  const arrivalByState = Object.fromEntries((stateArrivals || []).map(a => [a.state, a]))

  function copyArrivalNotification(state, arrival) {
    const stateOrders = orders.filter(bo => bo.order?.state === state)
    const msg = [
      '*Incoming Stock Notification*',
      '',
      `Batch No: ${batch.batch_number}`,
      `State: ${state}`,
      `Orders: ${stateOrders.length}`,
      `Products: ${stateUnits(stateOrders)}`,
      '',
      `Driver: ${arrival.driver_name}`,
      `Phone: ${arrival.driver_phone}`,
      ...(arrival.park_address ? [`State Park: ${arrival.park_address}`] : []),
      '',
      'The shipment has arrived at the state park. Please contact the driver, collect the goods, confirm receipt in the app, and proceed with customer deliveries.',
    ].join('\n')
    navigator.clipboard.writeText(msg).then(() =>
      showToast('Notification copied — paste it into the state WhatsApp group', 'success'))
  }

  async function handleArrivalSubmit() {
    if (!arrivalForm.driver_name.trim() || !arrivalForm.driver_phone.trim()) {
      showToast("Driver's name and phone number are required", 'error')
      return
    }
    const state = arrivalState
    const stateOrders = orders.filter(bo => bo.order?.state === state)
    try {
      await markArrival.mutateAsync({
        batch,
        state,
        stateOrders,
        form: arrivalForm,
        allStates: destStates,
        arrivedStates: (stateArrivals || []).map(a => a.state),
      })
      setArrivalState(null)
      const savedForm = { ...arrivalForm }
      setArrivalForm({ driver_name: '', driver_phone: '', park_address: '', notes: '' })
      showToast(`${state} received at State Park`, 'success')
      copyArrivalNotification(state, savedForm)
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  async function handleTogglePack(item) {
    await togglePackingItem.mutateAsync({
      itemId: item.id,
      isPacked: !item.is_packed,
      batchId: id,
    })
  }


  return (
    <div className="flex flex-col h-full overflow-x-hidden w-full">
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
        {(batch.source_state || batch.source_warehouse_id) && (
          <p className="text-xs text-gray-400">From: {batch.source_state || 'warehouse'}</p>
        )}
        <p className="text-xs text-gray-400">
          To: {[...new Set(orders.map(bo => bo.order?.state).filter(Boolean))].sort().join(', ') || batch.destination_state || '—'}
          {batch.tracking_number ? ` · ${batch.tracking_number}` : ''}
        </p>
        <p className="text-xs text-gray-400">{orders.length} order{orders.length !== 1 ? 's' : ''} · Total cost: {formatCurrency(batch.total_cost || 0)}</p>

        {/* Action buttons */}
        {!isDone && (
          <div className="mt-3 space-y-2">
            <div className="flex gap-2">
              {status === 'created' && (
                <Button size="sm" onClick={() => handleAdvance('packed')} disabled={advanceBatchStatus.isPending}
                  className="flex-1">
                  Confirm Packing Done
                </Button>
              )}
              {status === 'packed' && (
                <Button size="sm" onClick={() => handleAdvance('waybilled')} disabled={advanceBatchStatus.isPending}
                  className="flex-1">
                  Confirm Dispatched
                </Button>
              )}
              {isTransit && (
                <Button size="sm" onClick={() => setTab('transit')}
                  className="flex-1">
                  Product Arrived at State Park
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => savePdf(generatePackingList(batch, packingItems, orders, orderItems), `${batch.batch_number}-packing.pdf`)}
                className="flex-1 py-2 bg-gray-800 text-gray-300 rounded-xl text-xs font-medium active:scale-95 transition-all"
              >
                Packing PDF
              </button>
              <button
                onClick={() => savePdf(generateWaybillSummary(batch, orders, expenses), `${batch.batch_number}-summary.pdf`)}
                className="flex-1 py-2 bg-gray-800 text-gray-300 rounded-xl text-xs font-medium active:scale-95 transition-all"
              >
                Summary PDF
              </button>
            </div>
          </div>
        )}
        {isDone && (
          <div className="mt-3 flex items-center gap-2 text-green-400">
            <CheckCircle size={16} />
            <span className="text-sm font-medium">All states received at State Park</span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-100 sticky top-[57px] z-20 overflow-x-hidden w-full">
        <div className="flex gap-0">
          {TABS.map(({ key, label }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`flex-1 py-3 text-xs font-medium transition-colors border-b-2 ${tab === key ? 'border-yellow-500 text-gray-900' : 'border-transparent text-gray-400'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4">

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
        {tab === 'pack' && (() => {
          // Build display items, preferring (in order):
          // 1. items_data JSONB on the order (always saved from new orders)
          // 2. order_items table rows (from orderItems hook data)
          // 3. order summary fields (single-product fallback)
          const itemsByOrderTable = {}
          for (const oi of (orderItems || [])) {
            if (!itemsByOrderTable[oi.order_id]) itemsByOrderTable[oi.order_id] = []
            itemsByOrderTable[oi.order_id].push(oi)
          }

          const grouped = {}
          for (const bo of orders) {
            if (!bo.order) continue
            const state = bo.order.state
            if (!state) continue

            const fromJson = Array.isArray(bo.order.items_data) && bo.order.items_data.length > 0
              ? bo.order.items_data
              : null
            const fromTable = itemsByOrderTable[bo.order.id]?.length > 0
              ? itemsByOrderTable[bo.order.id]
              : null
            const lineItems = fromJson || fromTable
              || [{ product_name: bo.order.product_name, quantity: bo.order.quantity || 1, color: bo.order.color, size: bo.order.size }]

            for (const li of lineItems) {
              const key = `${state}||${li.product_name}`
              if (!grouped[key]) {
                const storedItem = packingItems.find(pi => pi.state === state && pi.product_name === li.product_name)
                grouped[key] = {
                  id: storedItem?.id,
                  state,
                  product_name: li.product_name,
                  color: li.color,
                  size: li.size,
                  quantity: 0,
                  is_packed: storedItem?.is_packed || false,
                }
              }
              grouped[key].quantity += Number(li.quantity) || 1
            }
          }

          const displayItems = Object.values(grouped)
          const destStates = [...new Set(displayItems.map(i => i.state))].sort()
          const packedCount = displayItems.filter(i => i.is_packed).length

          return (
            <div className="space-y-4">
              {displayItems.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-8">No packing items</p>
              )}
              {displayItems.length > 0 && (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-500">{packedCount}/{displayItems.length} packed</p>
                    {packedCount === displayItems.length && (
                      <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                        <CheckCircle size={12} /> All packed
                      </span>
                    )}
                  </div>

                  {destStates.map(state => (
                    <div key={state} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                      <div className="px-4 py-2 bg-gray-50 border-b border-gray-100">
                        <p className="text-xs font-semibold text-gray-700">{state}</p>
                      </div>
                      {displayItems.filter(i => i.state === state).map((item, idx) => (
                        <button
                          key={item.id || idx}
                          onClick={() => !isDone && item.id && handleTogglePack(item)}
                          disabled={isDone || togglePackingItem.isPending || !item.id}
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
                              {item.color ? ` · ${item.color}` : ''}
                              {item.size ? ` · ${item.size}` : ''}
                            </p>
                            <p className="text-xs text-gray-400">Qty: {item.quantity}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  ))}

                  {status === 'created' && (
                    <Button onClick={() => handleAdvance('packed')} disabled={advanceBatchStatus.isPending} className="w-full">
                      Confirm Packing Done
                    </Button>
                  )}
                </>
              )}
            </div>
          )
        })()}

        {/* Expenses Tab */}
        {tab === 'expenses' && (
          <div className="space-y-4">
            {batch.expenses_saved ? (
              <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center gap-2">
                <CheckCircle size={14} className="text-green-600 shrink-0" />
                <p className="text-xs text-green-700 font-medium">Expenses saved · Grand total: {formatCurrency(batch.total_cost)} · Locked</p>
              </div>
            ) : (isTransit || isDone) && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
                <p className="text-xs font-semibold text-blue-800 mb-0.5">
                  {isDone ? 'Waybill received — enter expenses' : 'Batch dispatched — enter expenses'}
                </p>
                <p className="text-xs text-blue-600">Optional. Fill in now or save after the waybill fee is paid on delivery.</p>
              </div>
            )}

            {Object.keys(stateExpenses).length === 0 && (
              <p className="text-sm text-gray-400 text-center py-6">No destination states found</p>
            )}

            {/* Per-state expense cards */}
            {Object.entries(stateExpenses).map(([state, exp]) => {
              const stateTotal = COST_KEYS.reduce((s, { key }) => s + (Number(exp[key]) || 0), 0)
              const stateOrders = orders.filter(bo => bo.order?.state === state)
              return (
                <div key={state} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                  <div className="bg-gray-50 border-b border-gray-100 px-4 py-2.5 flex items-center justify-between">
                    <p className="text-sm font-bold text-gray-800">{state}</p>
                    <span className="text-xs text-gray-500">{stateOrders.length} order{stateOrders.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="p-4 space-y-3">
                    <Input
                      label="Destination City"
                      placeholder="e.g. Ibadan"
                      value={exp.destination_city}
                      onChange={e => updateStateExpense(state, 'destination_city', e.target.value)}
                      disabled={expensesLocked}
                    />
                    {COST_KEYS.map(({ key, label }) => (
                      <Input
                        key={key}
                        label={label + ' (₦)'}
                        type="number"
                        inputMode="decimal"
                        value={exp[key]}
                        onChange={e => updateStateExpense(state, key, e.target.value)}
                        disabled={expensesLocked}
                      />
                    ))}
                    <Textarea
                      label="Notes"
                      rows={2}
                      value={exp.expense_notes}
                      onChange={e => updateStateExpense(state, 'expense_notes', e.target.value)}
                      disabled={expensesLocked}
                    />
                    {stateTotal > 0 && (
                      <div className="pt-2 border-t border-gray-100 flex justify-between items-center">
                        <span className="text-xs text-gray-500">State subtotal</span>
                        <div className="text-right">
                          <p className="text-sm font-bold text-gray-900">{formatCurrency(stateTotal)}</p>
                          {stateOrders.length > 0 && (
                            <p className="text-xs text-gray-400">≈ {formatCurrency(stateTotal / stateOrders.length)} / order</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

            {/* Grand total */}
            {grandExpenseTotal > 0 && (
              <div className="bg-yellow-50 rounded-2xl px-4 py-3">
                <p className="text-xs text-yellow-700 mb-0.5">Grand Total</p>
                <p className="text-xl font-bold text-yellow-800">{formatCurrency(grandExpenseTotal)}</p>
              </div>
            )}

            {!expensesLocked && Object.keys(stateExpenses).length > 0 && (
              <Button
                onClick={handleSaveExpenses}
                disabled={saveBatchExpenses.isPending}
                className="w-full"
              >
                {saveBatchExpenses.isPending ? 'Saving...' : 'Save Expenses'}
              </Button>
            )}
          </div>
        )}

        {/* Timeline Tab */}
        {/* ── ARRIVAL — per-state transit tracking ── */}
        {tab === 'transit' && (
          <div className="space-y-3">
            {stateArrivals === null && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-sm text-amber-800">
                Run the latest migration (per-state transit tracking) in Supabase to record arrivals.
              </div>
            )}
            {!isTransit && !isDone && (
              <p className="text-xs text-gray-500 bg-gray-50 rounded-xl px-3 py-2.5">
                Arrivals are confirmed after dispatch — pack and dispatch the batch first.
              </p>
            )}
            {destStates.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No destination states in this batch</p>
            ) : destStates.map(state => {
              const stateOrders = orders.filter(bo => bo.order?.state === state)
              const arrival = arrivalByState[state]
              return (
                <div key={state} className="bg-white rounded-2xl border border-gray-100 p-4">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-sm font-semibold text-gray-900">{state}</p>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                      arrival ? 'bg-cyan-50 text-cyan-700' : 'bg-amber-50 text-amber-700'
                    }`}>
                      {arrival ? 'RECEIVED AT STATE PARK' : 'IN TRANSIT'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">
                    {stateOrders.length} order{stateOrders.length !== 1 ? 's' : ''} · {stateUnits(stateOrders)} product{stateUnits(stateOrders) !== 1 ? 's' : ''}
                  </p>

                  {arrival ? (
                    <>
                      <div className="bg-gray-50 rounded-xl p-3 mt-2 space-y-0.5">
                        <p className="text-xs text-gray-700">
                          <span className="text-gray-400">Driver: </span>{arrival.driver_name} · {arrival.driver_phone}
                        </p>
                        {arrival.park_address && (
                          <p className="text-xs text-gray-700"><span className="text-gray-400">Park: </span>{arrival.park_address}</p>
                        )}
                        {arrival.notes && (
                          <p className="text-xs text-gray-700"><span className="text-gray-400">Notes: </span>{arrival.notes}</p>
                        )}
                        <p className="text-[11px] text-gray-400 pt-1">
                          Confirmed by {arrival.confirmed_by_name || '—'} · {new Date(arrival.created_at).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                      <Button
                        variant="secondary" size="sm" className="w-full mt-2"
                        onClick={() => copyArrivalNotification(state, arrival)}
                      >
                        <Copy size={14} className="mr-1.5" /> Copy WhatsApp Notification
                      </Button>
                    </>
                  ) : (isTransit || isDone) && stateArrivals !== null && (
                    <Button
                      size="sm" className="w-full mt-3"
                      onClick={() => {
                        setArrivalForm({ driver_name: '', driver_phone: '', park_address: '', notes: '' })
                        setArrivalState(state)
                      }}
                    >
                      Mark as Received at State Park
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        )}

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

      {/* Arrival confirmation modal */}
      <Modal
        isOpen={!!arrivalState}
        onClose={() => setArrivalState(null)}
        title={arrivalState ? `Received at ${arrivalState} State Park` : ''}
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setArrivalState(null)} className="flex-1">Cancel</Button>
            <Button
              onClick={handleArrivalSubmit}
              loading={markArrival.isPending}
              className="flex-1"
              disabled={!arrivalForm.driver_name.trim() || !arrivalForm.driver_phone.trim()}
            >
              Confirm Arrival
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-xs text-gray-500">
            Only {arrivalState} is confirmed — other states in this batch stay in transit.
            The date, time and your name are recorded automatically.
          </p>
          <Input label="Driver's Name" required placeholder="e.g. Ibrahim Musa"
            value={arrivalForm.driver_name}
            onChange={e => setArrivalForm({ ...arrivalForm, driver_name: e.target.value })} />
          <Input label="Driver's Phone Number" type="tel" inputMode="tel" required placeholder="08012345678"
            value={arrivalForm.driver_phone}
            onChange={e => setArrivalForm({ ...arrivalForm, driver_phone: e.target.value })} />
          <Input label="State Park Address (optional)" placeholder="e.g. GUO Transport Park, Jibowu"
            value={arrivalForm.park_address}
            onChange={e => setArrivalForm({ ...arrivalForm, park_address: e.target.value })} />
          <Textarea label="Additional Notes (optional)" rows={2}
            value={arrivalForm.notes}
            onChange={e => setArrivalForm({ ...arrivalForm, notes: e.target.value })} />
          <p className="text-[11px] text-gray-400">
            After saving, the WhatsApp notification is copied automatically — paste it into the {arrivalState} WhatsApp group.
          </p>
        </div>
      </Modal>
    </div>
  )
}
