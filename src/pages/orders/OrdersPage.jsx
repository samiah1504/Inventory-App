import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, SlidersHorizontal, X } from 'lucide-react'
import { useOrders } from '../../hooks/useOrders'
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
  { key: 'new', label: 'New' },
  { key: 'awaiting_waybill', label: 'Awaiting' },
  { key: 'waybilled', label: 'Waybilled' },
  { key: 'received_at_warehouse', label: 'At Warehouse' },
  { key: 'processing', label: 'Processing' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'paid', label: 'Paid' },
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
  { key: 'received_at_warehouse', label: 'At Warehouse' },
  { key: 'processing', label: 'Processing' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'paid', label: 'Paid' },
  { key: 'failed_delivery', label: 'Failed' },
]

export function OrdersPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useAuthStore()

  const role = user?.role
  const isCS = role === 'customer_support'
  const isFulfillment = role === 'fulfillment'

  const statusTabs = isCS ? CS_STATUS_TABS : isFulfillment ? FULFILLMENT_STATUS_TABS : ALL_STATUS_TABS
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

  const filters = {
    search: search || undefined,
    status: activeTab !== 'all' ? activeTab : undefined,
    business_id: businessFilter || undefined,
    state: stateFilter || undefined,
    date_from: dateFrom ? `${dateFrom}T00:00:00` : undefined,
    date_to: dateTo ? `${dateTo}T23:59:59` : undefined,
    limit: 250,
  }

  const { data: orders, isLoading } = useOrders(filters)

  const canCreate = ['ceo', 'super_admin', 'customer_support', 'operations_manager'].includes(user?.role)

  function handleTabChange(tab) {
    setActiveTab(tab)
    if (tab !== 'all') setSearchParams({ status: tab })
    else setSearchParams({})
  }

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title={isCS ? 'My Orders' : 'Orders'}
        back={false}
        actions={
          <div className="flex gap-2">
            <button
              onClick={() => setShowDateFilter(v => !v)}
              className={`p-2 rounded-xl active:scale-95 transition-all relative ${hasDateFilter ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}
              title="Filter by date"
            >
              <SlidersHorizontal size={18} />
              {hasDateFilter && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-amber-400 rounded-full" />}
            </button>
            {canCreate && (
              <button
                onClick={() => navigate('/orders/new')}
                className="p-2 bg-blue-600 text-white rounded-xl active:scale-95 transition-all"
              >
                <Plus size={20} />
              </button>
            )}
          </div>
        }
      />

      <div className="px-4 py-3 space-y-3 bg-white border-b border-gray-100 sticky top-[57px] z-20">
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Search orders, customer, phone..."
        />
        {showDateFilter && (
          <div className="space-y-2">
            <div className="flex gap-2 items-center">
              <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="flex-1" />
              <span className="text-xs text-gray-400">to</span>
              <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="flex-1" />
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
        {canFilterBusiness && (
          <select
            value={stateFilter}
            onChange={e => setStateFilter(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All States</option>
            {NIGERIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
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
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {isLoading ? (
          <SkeletonList count={5} />
        ) : orders?.length === 0 ? (
          <EmptyState
            icon={<ShoppingCart size={28} />}
            title="No orders found"
            description={search ? 'Try adjusting your search' : 'No orders in this status yet'}
            action={canCreate ? () => navigate('/orders/new') : undefined}
            actionLabel="Create Order"
          />
        ) : (
          <>
            <p className="text-xs text-gray-500">
              {orders.length} order{orders.length !== 1 ? 's' : ''}
              {orders.length === 250 && ' (showing latest 250 — use date filter to narrow)'}
            </p>
            {orders.map(order => (
              <OrderCard key={order.id} order={order} onClick={() => navigate(`/orders/${order.id}`)} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
