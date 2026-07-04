import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { MapPin, Package, CheckCircle, XCircle } from 'lucide-react'
import { useOrders, useUpdateOrderStatus } from '../../hooks/useOrders'
import { TopBar } from '../../components/layout/TopBar'
import { SearchBar } from '../../components/ui/SearchBar'
import { OrderCard } from './OrderCard'
import { SkeletonList } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'
import { NIGERIAN_STATES } from '../../utils/format'
import { useAuthStore } from '../../stores/authStore'

const TABS = [
  { key: 'new', label: 'New' },
  { key: 'awaiting_waybill', label: 'Awaiting Waybill' },
  { key: 'waybilled', label: 'Waybilled' },
  { key: 'received_at_warehouse', label: 'At Warehouse' },
  { key: 'processing', label: 'Processing' },
  { key: 'today', label: 'Today' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'failed_delivery', label: 'Failed' },
  { key: 'by_state', label: 'By State' },
]

// Statuses where quick deliver/fail actions make sense
const QUICK_ACTION_TABS = ['processing', 'today']

export function FulfillmentPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState(searchParams.get('tab') || 'new')
  const [search, setSearch] = useState('')
  const [selectedState, setSelectedState] = useState('')
  const [actingOrder, setActingOrder] = useState(null)
  const { user } = useAuthStore()
  const updateStatus = useUpdateOrderStatus()

  const today = new Date().toISOString().split('T')[0]

  const ACTIVE_STATUSES = ['new', 'awaiting_waybill', 'waybilled', 'received_at_warehouse', 'processing']

  const filters = {
    search: search || undefined,
    status: ['today', 'by_state'].includes(tab) ? undefined : tab,
    statuses: tab === 'by_state' ? ACTIVE_STATUSES : undefined,
    planned_delivery_date: tab === 'today' ? today : undefined,
  }

  const { data: orders, isLoading } = useOrders(filters)

  const displayOrders = tab === 'by_state' && selectedState
    ? (orders || []).filter(o => o.state === selectedState)
    : orders || []

  const stateGroups = tab === 'by_state'
    ? NIGERIAN_STATES.filter(s => (orders || []).some(o => o.state === s))
    : []

  const showQuickActions = QUICK_ACTION_TABS.includes(tab)

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
    } finally {
      setActingOrder(null)
    }
  }

  async function quickFail(order) {
    if (actingOrder === order.id) return
    setActingOrder(order.id)
    try {
      await updateStatus.mutateAsync({
        id: order.id,
        status: 'failed_delivery',
        extra: { failed_reason: 'Failed delivery (marked from fulfillment board)' },
        timelineDesc: `Marked failed delivery by ${user?.name}`,
      })
    } finally {
      setActingOrder(null)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <TopBar title="Fulfillment Board" back={false} />

      <div className="bg-white border-b border-gray-100 sticky top-[57px] z-20">
        <div className="px-4 pt-3">
          <SearchBar value={search} onChange={setSearch} placeholder="Search orders..." />
        </div>
        <div className="flex gap-2 px-4 py-3 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => { setTab(key); setSelectedState('') }}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                tab === key ? 'bg-blue-600 text-black' : 'bg-gray-100 text-gray-600'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {tab === 'by_state' && !selectedState ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-700 mb-3">Select a state</p>
            {stateGroups.length === 0 ? (
              <EmptyState title="No orders" icon={<MapPin size={28} />} />
            ) : (
              stateGroups.map(state => {
                const count = (orders || []).filter(o => o.state === state).length
                return (
                  <button
                    key={state}
                    onClick={() => setSelectedState(state)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-white rounded-2xl border border-gray-100 active:scale-[0.98] transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <MapPin size={16} className="text-blue-500" />
                      <span className="text-sm font-medium text-gray-900">{state}</span>
                    </div>
                    <span className="text-sm font-bold text-blue-600">{count}</span>
                  </button>
                )
              })
            )}
          </div>
        ) : isLoading ? (
          <SkeletonList count={4} />
        ) : displayOrders.length === 0 ? (
          <EmptyState title="No orders" icon={<Package size={28} />} />
        ) : (
          <div className="space-y-3">
            {tab === 'by_state' && selectedState && (
              <div className="flex items-center gap-2">
                <button onClick={() => setSelectedState('')} className="text-xs text-blue-600">← All States</button>
                <span className="text-xs text-gray-400">·</span>
                <span className="text-xs font-medium text-gray-700">{selectedState} ({displayOrders.length})</span>
              </div>
            )}
            {displayOrders.length > 0 && (
              <p className="text-xs text-gray-500">{displayOrders.length} order{displayOrders.length !== 1 ? 's' : ''}</p>
            )}
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
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
