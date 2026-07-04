import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Filter, SlidersHorizontal } from 'lucide-react'
import { useOrders } from '../../hooks/useOrders'
import { useAuthStore } from '../../stores/authStore'
import { TopBar } from '../../components/layout/TopBar'
import { SearchBar } from '../../components/ui/SearchBar'
import { StatusBadge } from '../../components/ui/Badge'
import { SkeletonList } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'
import { OrderCard } from './OrderCard'
import { formatCurrency, formatDate, ORDER_STATUSES, statusLabel } from '../../utils/format'
import { ShoppingCart } from 'lucide-react'

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

  const filters = {
    search: search || undefined,
    status: activeTab !== 'all' ? activeTab : undefined,
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
        actions={canCreate && (
          <button
            onClick={() => navigate('/orders/new')}
            className="p-2 bg-blue-600 text-white rounded-xl active:scale-95 transition-all"
          >
            <Plus size={20} />
          </button>
        )}
      />

      <div className="px-4 py-3 space-y-3 bg-white border-b border-gray-100 sticky top-[57px] z-20">
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Search orders, customer, phone..."
        />
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
            <p className="text-xs text-gray-500">{orders.length} order{orders.length !== 1 ? 's' : ''}</p>
            {orders.map(order => (
              <OrderCard key={order.id} order={order} onClick={() => navigate(`/orders/${order.id}`)} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
