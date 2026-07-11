import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ShoppingCart, CheckCircle, DollarSign, XCircle,
  AlertTriangle, RotateCcw, Package, TrendingUp,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { TopBar } from '../../components/layout/TopBar'
import { useAuthStore } from '../../stores/authStore'
import { scopeToBusinesses } from '../../lib/businessScope'
import { useBusinesses } from '../../hooks/useBusinesses'

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

function MetricCard({ icon: Icon, label, value, color, sub }) {
  return (
    <div className="bg-white rounded-2xl p-4 border border-gray-100 flex flex-col gap-1">
      <div className={`w-8 h-8 rounded-xl flex items-center justify-center mb-1 ${color}`}>
        <Icon size={16} />
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500 leading-tight">{label}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  )
}

export function SalesAnalyticsPage() {
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [businessId, setBusinessId] = useState('')

  const { user } = useAuthStore()
  const { data: businesses } = useBusinesses()
  const isCeo = ['ceo', 'super_admin'].includes(user?.role)

  const dateFrom = `${year}-${String(month).padStart(2, '0')}-01`
  const dateTo = `${year}-${String(month).padStart(2, '0')}-${new Date(year, month, 0).getDate()}`

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['analytics_orders', year, month, businessId],
    queryFn: async () => {
      let q = supabase
        .from('orders')
        .select('id, status, total_amount, amount_paid, product_name, quantity, items_data, business_id, created_at')
        .gte('created_at', `${dateFrom}T00:00:00`)
        .lte('created_at', `${dateTo}T23:59:59`)
        .order('created_at', { ascending: false })

      if (businessId) q = q.eq('business_id', businessId)
      q = scopeToBusinesses(q, user)

      const { data, error } = await q
      if (error) throw error
      return data || []
    },
    staleTime: 60000,
  })

  const orderIds = orders.map(o => o.id)

  const { data: orderItems = [] } = useQuery({
    queryKey: ['analytics_items', year, month, businessId],
    enabled: orderIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from('order_items')
        .select('order_id, product_name, quantity')
        .in('order_id', orderIds)
      return data || []
    },
    staleTime: 60000,
  })

  const metrics = useMemo(() => {
    const received  = orders.length
    const delivered = orders.filter(o => ['delivered', 'paid', 'partially_paid'].includes(o.status)).length
    const paid      = orders.filter(o => ['paid', 'partially_paid'].includes(o.status)).length
    const cancelled = orders.filter(o => o.status === 'cancelled').length
    const failed    = orders.filter(o => o.status === 'failed_delivery').length
    const returned  = orders.filter(o => o.status === 'returned').length
    const successRate = received > 0 ? ((delivered / received) * 100).toFixed(1) : '0.0'
    return { received, delivered, paid, cancelled, failed, returned, successRate }
  }, [orders])

  const productMap = useMemo(() => {
    const map = {}

    // From order_items table
    for (const item of orderItems) {
      const name = (item.product_name || 'Unknown').trim()
      map[name] = (map[name] || 0) + (Number(item.quantity) || 1)
    }

    // From orders not covered by order_items
    const coveredIds = new Set(orderItems.map(i => i.order_id))
    for (const order of orders) {
      if (coveredIds.has(order.id)) continue
      // Try items_data JSONB first
      const fromJson = Array.isArray(order.items_data) && order.items_data.length > 0
        ? order.items_data : null
      if (fromJson) {
        for (const item of fromJson) {
          const name = (item.product_name || 'Unknown').trim()
          map[name] = (map[name] || 0) + (Number(item.quantity) || 1)
        }
      } else if (order.product_name) {
        const name = order.product_name.trim()
        map[name] = (map[name] || 0) + (Number(order.quantity) || 1)
      }
    }

    return map
  }, [orders, orderItems])

  const productList = useMemo(() => {
    return Object.entries(productMap)
      .map(([name, qty]) => ({ name, qty }))
      .sort((a, b) => b.qty - a.qty)
  }, [productMap])

  const totalQty = productList.reduce((s, p) => s + p.qty, 0)

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i)

  return (
    <div className="flex flex-col h-full overflow-x-hidden w-full">
      <TopBar title="Sales Analytics" />

      <div className="flex-1 overflow-y-auto">
        {/* Filters */}
        <div className="bg-white border-b border-gray-100 px-4 py-3 flex flex-col gap-2 sticky top-[57px] z-10">
          <div className="flex gap-2">
            <select
              value={month}
              onChange={e => setMonth(Number(e.target.value))}
              className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white"
            >
              {MONTHS.map((m, i) => (
                <option key={i} value={i + 1}>{m}</option>
              ))}
            </select>
            <select
              value={year}
              onChange={e => setYear(Number(e.target.value))}
              className="w-28 border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white"
            >
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          {isCeo && businesses?.length > 1 && (
            <select
              value={businessId}
              onChange={e => setBusinessId(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white"
            >
              <option value="">All Businesses</option>
              {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <p className="text-xs text-gray-400">
            {MONTHS[month - 1]} {year}
            {businessId && businesses ? ` · ${businesses.find(b => b.id === businessId)?.name}` : ''}
          </p>
        </div>

        <div className="px-4 py-4 space-y-5">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse" />
              ))}
            </div>
          ) : (
            <>
              {/* Order Metrics Grid */}
              <div>
                <h2 className="text-sm font-semibold text-gray-700 mb-3">Order Metrics</h2>
                <div className="grid grid-cols-2 gap-3">
                  <MetricCard
                    icon={ShoppingCart}
                    label="Orders Received"
                    value={metrics.received}
                    color="bg-blue-50 text-blue-600"
                  />
                  <MetricCard
                    icon={CheckCircle}
                    label="Orders Delivered"
                    value={metrics.delivered}
                    color="bg-green-50 text-green-600"
                    sub={metrics.received > 0 ? `${((metrics.delivered / metrics.received) * 100).toFixed(1)}% of received` : undefined}
                  />
                  <MetricCard
                    icon={DollarSign}
                    label="Paid Orders"
                    value={metrics.paid}
                    color="bg-emerald-50 text-emerald-600"
                  />
                  <MetricCard
                    icon={XCircle}
                    label="Cancelled Orders"
                    value={metrics.cancelled}
                    color="bg-gray-50 text-gray-500"
                  />
                  <MetricCard
                    icon={AlertTriangle}
                    label="Failed Deliveries"
                    value={metrics.failed}
                    color="bg-red-50 text-red-500"
                  />
                  <MetricCard
                    icon={RotateCcw}
                    label="Returned Orders"
                    value={metrics.returned}
                    color="bg-orange-50 text-orange-500"
                  />
                </div>
              </div>

              {/* Summary Row */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-900 rounded-2xl p-4 text-white">
                  <p className="text-xs text-gray-400 mb-1">Success Rate</p>
                  <p className="text-3xl font-bold">{metrics.successRate}%</p>
                  <p className="text-xs text-gray-400 mt-1">Delivered / Received</p>
                  <div className="mt-3 bg-gray-700 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-green-400 h-full rounded-full transition-all"
                      style={{ width: `${metrics.successRate}%` }}
                    />
                  </div>
                </div>
                <div className="bg-blue-600 rounded-2xl p-4 text-white">
                  <p className="text-xs text-blue-200 mb-1">Total Qty Sold</p>
                  <p className="text-3xl font-bold">{totalQty.toLocaleString()}</p>
                  <p className="text-xs text-blue-200 mt-1">
                    {productList.length} product{productList.length !== 1 ? 's' : ''}
                  </p>
                  <div className="flex items-center gap-1 mt-3">
                    <Package size={12} className="text-blue-200" />
                    <span className="text-xs text-blue-200">Units shipped</span>
                  </div>
                </div>
              </div>

              {/* Product Breakdown */}
              <div>
                <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <TrendingUp size={15} className="text-blue-600" />
                  Quantity Sold Per Product
                </h2>
                {productList.length === 0 ? (
                  <div className="text-center py-10 text-gray-400 text-sm">
                    No product data for this period
                  </div>
                ) : (
                  <div className="space-y-2">
                    {productList.map(({ name, qty }, idx) => {
                      const pct = totalQty > 0 ? (qty / totalQty) * 100 : 0
                      return (
                        <div key={name} className="bg-white rounded-2xl border border-gray-100 px-4 py-3">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-xs font-bold text-gray-400 w-5 shrink-0">
                                {idx + 1}
                              </span>
                              <span className="text-sm font-medium text-gray-900 truncate">{name}</span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0 ml-2">
                              <span className="text-sm font-bold text-gray-900">{qty.toLocaleString()}</span>
                              <span className="text-xs text-gray-400">{pct.toFixed(1)}%</span>
                            </div>
                          </div>
                          <div className="bg-gray-100 rounded-full h-1.5 overflow-hidden">
                            <div
                              className="bg-blue-500 h-full rounded-full transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
