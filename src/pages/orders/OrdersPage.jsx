import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Plus, SlidersHorizontal, X, CheckCircle, XCircle, Inbox } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useOrders, useUpdateOrderStatus } from '../../hooks/useOrders'
import { useAdvanceBatchStatus } from '../../hooks/useWaybillBatches'
import { useAppStore } from '../../stores/appStore'
import { useAuthStore } from '../../stores/authStore'
import { useBusinesses } from '../../hooks/useBusinesses'
import { TopBar } from '../../components/layout/TopBar'
import { SearchBar } from '../../components/ui/SearchBar'
import { SkeletonList } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'
import { OrderCard } from './OrderCard'
import { formatCurrency, formatDate, ORDER_STATUSES, statusLabel, NIGERIAN_STATES } from '../../utils/format'
import { ShoppingCart } from 'lucide-react'
import { Input } from '../../components/ui/Input'

const ALL_STATUS_TABS = [
  { key: 'all', label: 'All' },
  { key: 'unassigned', label: 'Unassigned States' },
  { key: 'new', label: 'New' },
  { key: 'awaiting_waybill', label: 'Awaiting' },
  { key: 'waybilled', label: 'Waybilled' },
  { key: 'arrived_at_park', label: 'At State Park' },
  { key: 'picked_up_from_park', label: 'Picked Up' },
  { key: 'received_at_warehouse', label: 'At Warehouse' },
  { key: 'processing', label: 'Processing' },
  { key: 'today', label: 'Due Today' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'paid', label: 'Paid' },
  { key: 'fee_pending', label: 'Fee Pending' },
  { key: 'partially_paid', label: 'Partial' },
  { key: 'failed_delivery', label: 'Failed' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'returned', label: 'Returned' },
]

// Customer Support only sees their own active orders
const CS_STATUS_TABS = [
  { key: 'all', label: 'All Mine' },
  { key: 'new', label: 'New' },
  { key: 'awaiting_waybill', label: 'Awaiting' },
  { key: 'cancelled', label: 'Cancelled' },
]

const FULFILLMENT_STATUS_TABS = [
  { key: 'new', label: 'New' },
  { key: 'awaiting_waybill', label: 'Awaiting' },
  { key: 'waybilled', label: 'Waybilled' },
  { key: 'arrived_at_park', label: 'At State Park' },
  { key: 'picked_up_from_park', label: 'Picked Up' },
  { key: 'received_at_warehouse', label: 'At Warehouse' },
  { key: 'processing', label: 'Processing' },
  { key: 'today', label: 'Due Today' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'paid', label: 'Paid' },
  { key: 'fee_pending', label: 'Fee Pending' },
  { key: 'failed_delivery', label: 'Failed' },
  { key: 'returned', label: 'Returned' },
]

export function OrdersPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useAuthStore()

  const role = user?.role
  const isCS = role === 'customer_support'
  const isFulfillment = role === 'fulfillment'

  const canSeeUnassigned = ['ceo', 'super_admin', 'operations_manager'].includes(role)
  const statusTabs = (isCS ? CS_STATUS_TABS : isFulfillment ? FULFILLMENT_STATUS_TABS : ALL_STATUS_TABS)
    .filter(t => t.key !== 'unassigned' || canSeeUnassigned)
  const defaultTab = isFulfillment ? 'new' : 'all'

  const statusParam = searchParams.get('status') || defaultTab
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState(statusParam)
  const [businessFilter, setBusinessFilter] = useState('')
  const [stateFilter, setStateFilter] = useState('')

  const canFilterBusiness = ['ceo', 'super_admin', 'operations_manager'].includes(role)
  const { data: businesses } = useBusinesses()

  const [showDateFilter, setShowDateFilter] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const hasDateFilter = !!(dateFrom || dateTo)

  const ACTIVE_STATUSES = ['new', 'awaiting_waybill', 'waybilled', 'arrived_at_park', 'picked_up_from_park', 'received_at_warehouse', 'processing']
  const today = new Date().toISOString().split('T')[0]

  const filters = {
    search: search || undefined,
    status: activeTab === 'fee_pending' ? 'paid'
      : ['all', 'unassigned', 'today'].includes(activeTab) ? undefined
      : activeTab,
    statuses: activeTab === 'unassigned' ? ACTIVE_STATUSES : undefined,
    planned_delivery_date: activeTab === 'today' ? today : undefined,
    delivery_fee_pending: activeTab === 'fee_pending' ? true : undefined,
    business_id: businessFilter || undefined,
    state: stateFilter || undefined,
    date_from: dateFrom ? `${dateFrom}T00:00:00` : undefined,
    date_to: dateTo ? `${dateTo}T23:59:59` : undefined,
    limit: 250,
  }

  const { data: orders, isLoading } = useOrders(filters)

  // Fulfillment board actions (merged in for the fulfillment officer)
  const { showToast } = useAppStore()
  const updateStatus = useUpdateOrderStatus()
  const advanceBatch = useAdvanceBatchStatus()
  const [actingOrder, setActingOrder] = useState(null)
  const canFulfill = ['ceo', 'super_admin', 'operations_manager', 'fulfillment'].includes(role)
  const showQuickActions = canFulfill && ['processing', 'today'].includes(activeTab)
  const showBatchArrive = canFulfill && activeTab === 'waybilled'

  async function quickDeliver(order) {
    if (actingOrder === order.id) return
    setActingOrder(order.id)
    try {
      await updateStatus.mutateAsync({
        id: order.id,
        status: 'delivered',
        extra: { delivered_at: new Date().toISOString() },
        timelineDesc: `Marked delivered by ${user?.name}`,
      })
    } finally { setActingOrder(null) }
  }

  async function quickFail(order) {
    if (actingOrder === order.id) return
    setActingOrder(order.id)
    try {
      await updateStatus.mutateAsync({
        id: order.id,
        status: 'failed_delivery',
        extra: { failed_reason: 'Failed delivery (marked from orders board)' },
        timelineDesc: `Marked failed delivery by ${user?.name}`,
      })
    } finally { setActingOrder(null) }
  }

  async function batchArrived(order) {
    if (actingOrder === order.id) return
    setActingOrder(order.id)
    try {
      const { data: batchOrderData } = await supabase
        .from('waybill_batch_orders')
        .select('batch_id, batch:waybill_batches(id, batch_number, status)')
        .eq('order_id', order.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!batchOrderData?.batch_id) {
        showToast('No waybill batch found for this order', 'error')
        return
      }
      const batchInfo = batchOrderData.batch
      if (batchInfo.status === 'received') {
        navigate(`/waybill/batches/${batchOrderData.batch_id}?tab=expenses`)
        return
      }
      const { data: allBatchOrders } = await supabase
        .from('waybill_batch_orders')
        .select('order_id')
        .eq('batch_id', batchOrderData.batch_id)
      await advanceBatch.mutateAsync({
        batchId: batchOrderData.batch_id,
        newStatus: 'received',
        batchNumber: batchInfo.batch_number,
        orderIds: (allBatchOrders || []).map(bo => bo.order_id).filter(Boolean),
      })
      showToast(`Batch ${batchInfo.batch_number} arrived at State Park`, 'success')
    } catch (err) {
      showToast(err.message, 'error')
    } finally { setActingOrder(null) }
  }

  // States covered by active fulfillment officers — orders outside them form
  // the Unassigned States queue (CEO / Operations Manager)
  const coveredStatesQ = useQuery({
    queryKey: ['fulfillment_covered_states'],
    enabled: canSeeUnassigned,
    staleTime: 60000,
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from('staff_users')
          .select('assigned_states')
          .eq('role', 'fulfillment')
          .eq('is_active', true)
        if (error) throw error
        const covered = new Set()
        ;(data || []).forEach(r => (r.assigned_states || []).forEach(s => covered.add(s)))
        return Array.from(covered)
      } catch { return [] }
    },
  })

  const displayOrders = activeTab === 'unassigned'
    ? (orders || []).filter(o => o.state && !(coveredStatesQ.data || []).includes(o.state))
    : (orders || [])

  const canCreate = ['ceo', 'super_admin', 'customer_support', 'operations_manager'].includes(user?.role)

  function handleTabChange(tab) {
    setActiveTab(tab)
    if (tab !== 'all') setSearchParams({ status: tab })
    else setSearchParams({})
  }

  return (
    <div className="flex flex-col h-full overflow-x-hidden w-full">
      <TopBar
        title={isCS ? 'My Orders' : 'Orders'}
        back={false}
        actions={
          <div className="flex gap-2">
            <button
              onClick={() => setShowDateFilter(v => !v)}
              className={`p-2 rounded-xl active:scale-95 transition-all relative ${hasDateFilter ? 'bg-blue-600 text-black' : 'bg-gray-100 text-gray-700'}`}
              title="Filter by date"
            >
              <SlidersHorizontal size={18} />
              {hasDateFilter && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-amber-400 rounded-full" />}
            </button>
            {canCreate && (
              <button
                onClick={() => navigate('/orders/new')}
                className="p-2 bg-blue-600 text-black rounded-xl active:scale-95 transition-all"
              >
                <Plus size={20} />
              </button>
            )}
          </div>
        }
      />

      <div className="px-4 py-3 space-y-3 bg-white border-b border-gray-100 sticky top-[57px] z-20 overflow-x-hidden w-full">
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Search orders, customer, phone..."
        />
        {showDateFilter && (
          <div className="space-y-2">
            <div className="flex gap-2 items-center">
              <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="flex-1 min-w-0" />
              <span className="text-xs text-gray-400">to</span>
              <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="flex-1 min-w-0" />
              {hasDateFilter && (
                <button onClick={() => { setDateFrom(''); setDateTo('') }} className="p-2 bg-gray-100 rounded-xl active:scale-95">
                  <X size={14} className="text-gray-500" />
                </button>
              )}
            </div>
          </div>
        )}
        {canFilterBusiness && businesses && businesses.length > 1 && (
          <select
            value={businessFilter}
            onChange={e => setBusinessFilter(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Businesses</option>
            {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        {(canFilterBusiness || isFulfillment) && (
          <select
            value={stateFilter}
            onChange={e => setStateFilter(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{isFulfillment && user?.assigned_states?.length > 0 ? 'All My States' : 'All States'}</option>
            {(isFulfillment && user?.assigned_states?.length > 0 ? user.assigned_states : NIGERIAN_STATES)
              .map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        {/* Status tabs */}
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scroll-smooth" style={{ scrollbarWidth: 'none' }}>
          {statusTabs.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => handleTabChange(key)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                activeTab === key
                  ? 'bg-blue-600 text-black'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-3">
        {activeTab === 'unassigned' && (
          <p className="text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2">
            Active orders in states no fulfillment officer covers. Assign states from Staff Management.
          </p>
        )}
        {isLoading ? (
          <SkeletonList count={5} />
        ) : displayOrders.length === 0 ? (
          <EmptyState
            icon={<ShoppingCart size={28} />}
            title={activeTab === 'unassigned' ? 'All states are covered' : 'No orders found'}
            description={activeTab === 'unassigned'
              ? 'Every active order is in a state with an assigned fulfillment officer'
              : search ? 'Try adjusting your search' : 'No orders in this status yet'}
            action={canCreate && activeTab !== 'unassigned' ? () => navigate('/orders/new') : undefined}
            actionLabel="Create Order"
          />
        ) : (
          <>
            <p className="text-xs text-gray-500">
              {displayOrders.length} order{displayOrders.length !== 1 ? 's' : ''}
              {displayOrders.length === 250 && ' (showing latest 250 — use date filter to narrow)'}
            </p>
            {displayOrders.map(order => (
              <div key={order.id}>
                <OrderCard order={order} onClick={() => navigate(`/orders/${order.id}`)} />
                {showQuickActions && (
                  <div className="flex gap-2 mt-1 px-0.5">
                    <button
                      onClick={() => quickDeliver(order)}
                      disabled={actingOrder === order.id}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold text-green-700 bg-green-50 border border-green-100 rounded-xl active:scale-95 transition-all disabled:opacity-50"
                    >
                      <CheckCircle size={14} />
                      {actingOrder === order.id ? 'Saving...' : 'Delivered'}
                    </button>
                    <button
                      onClick={() => quickFail(order)}
                      disabled={actingOrder === order.id}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold text-red-700 bg-red-50 border border-red-100 rounded-xl active:scale-95 transition-all disabled:opacity-50"
                    >
                      <XCircle size={14} />
                      Failed
                    </button>
                  </div>
                )}
                {showBatchArrive && (
                  <div className="mt-1 px-0.5">
                    <button
                      onClick={() => batchArrived(order)}
                      disabled={actingOrder === order.id}
                      className="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold text-cyan-800 bg-cyan-50 border border-cyan-200 rounded-xl active:scale-95 transition-all disabled:opacity-50"
                    >
                      <Inbox size={14} />
                      {actingOrder === order.id ? 'Processing...' : 'Arrived at State Park'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
