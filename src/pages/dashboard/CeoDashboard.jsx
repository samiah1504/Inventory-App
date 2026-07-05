import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ShoppingCart, DollarSign, Package, AlertTriangle, Users, Plus,
  BarChart3, TrendingUp, ChevronRight, Star, Briefcase, LineChart,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '../../stores/authStore'
import { useBusinesses } from '../../hooks/useBusinesses'
import { supabase } from '../../lib/supabase'
import { StatCard } from '../../components/ui/Card'
import { SkeletonList } from '../../components/ui/Skeleton'
import { formatCurrency, formatDate } from '../../utils/format'
import { StatusBadge } from '../../components/ui/Badge'

// ─── Constants ───────────────────────────────────────────────────────────────

const REVENUE_STATUSES = ['paid', 'partially_paid']

// ─── Helpers ─────────────────────────────────────────────────────────────────

function salesFromOrders(orders) {
  return orders
    .filter(o => REVENUE_STATUSES.includes(o.status))
    .reduce((s, o) => s + Number(o.amount_paid || o.total_amount || 0), 0)
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

function monthStartStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

// ─── Component ───────────────────────────────────────────────────────────────

export function CeoDashboard() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const { data: businesses } = useBusinesses()

  const today = todayStr()
  const monthStart = monthStartStr()

  // ── Queries ──────────────────────────────────────────────────────────────

  const todayOrdersQ = useQuery({
    queryKey: ['ceo_today_orders', today],
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from('orders')
          .select('id, total_amount, amount_paid, status, business_id, product_name')
          .gte('created_at', `${today}T00:00:00`)
          .lte('created_at', `${today}T23:59:59`)
        if (error) throw error
        return data || []
      } catch { return [] }
    },
    staleTime: 60000,
  })

  const monthOrdersQ = useQuery({
    queryKey: ['ceo_month_orders', monthStart, today],
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from('orders')
          .select('id, total_amount, amount_paid, status, business_id, product_name, customer_name, order_number, created_at, state')
          .gte('created_at', `${monthStart}T00:00:00`)
          .lte('created_at', `${today}T23:59:59`)
        if (error) throw error
        return data || []
      } catch { return [] }
    },
    staleTime: 60000,
  })

  const expensesTodayQ = useQuery({
    queryKey: ['ceo_expenses_today', today],
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from('expenses')
          .select('amount, business_id')
          .eq('date', today)
        if (error) throw error
        return data || []
      } catch { return [] }
    },
    staleTime: 60000,
  })

  const expensesMonthQ = useQuery({
    queryKey: ['ceo_expenses_month', monthStart, today],
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from('expenses')
          .select('amount, business_id, expense_type')
          .gte('date', monthStart)
          .lte('date', today)
        if (error) throw error
        return data || []
      } catch { return [] }
    },
    staleTime: 60000,
  })

  const inventoryQ = useQuery({
    queryKey: ['ceo_inventory'],
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from('inventory')
          .select('id, quantity_available, reorder_level, business_id')
        if (error) throw error
        return data || []
      } catch { return [] }
    },
    staleTime: 60000,
  })

  const partialOrdersQ = useQuery({
    queryKey: ['ceo_partial_orders'],
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from('orders')
          .select('id, balance_amount')
          .eq('status', 'partially_paid')
        if (error) throw error
        return data || []
      } catch { return [] }
    },
    staleTime: 60000,
  })

  const recentOrdersQ = useQuery({
    queryKey: ['ceo_recent_orders'],
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from('orders')
          .select('id, order_number, customer_name, status, total_amount, state, product_name, created_at, business:businesses(short_code)')
          .order('created_at', { ascending: false })
          .limit(8)
        if (error) throw error
        return data || []
      } catch { return [] }
    },
    staleTime: 60000,
  })

  // ── Derived values ────────────────────────────────────────────────────────

  const todayOrders   = todayOrdersQ.data   || []
  const monthOrders   = monthOrdersQ.data   || []
  const expensesToday = expensesTodayQ.data  || []
  const expensesMonth = expensesMonthQ.data  || []
  const inventory     = inventoryQ.data      || []
  const partialOrders = partialOrdersQ.data  || []
  const recentOrders  = recentOrdersQ.data   || []

  const salesToday      = salesFromOrders(todayOrders)
  const expTodayTotal   = expensesToday.reduce((s, e) => s + Number(e.amount || 0), 0)
  const profitToday     = salesToday - expTodayTotal

  const salesMonth      = salesFromOrders(monthOrders)
  const expMonthTotal   = expensesMonth.reduce((s, e) => s + Number(e.amount || 0), 0)
  const profitMonth     = salesMonth - expMonthTotal

  const outstandingBalance = partialOrders.reduce((s, o) => s + Number(o.balance_amount || 0), 0)

  const lowStock   = inventory.filter(i => i.quantity_available > 0 && i.quantity_available <= (i.reorder_level || 5)).length
  const outOfStock = inventory.filter(i => i.quantity_available <= 0).length
  const stockAlerts = lowStock + outOfStock

  const bestSeller = useMemo(() => {
    const counts = {}
    monthOrders.filter(o => REVENUE_STATUSES.includes(o.status)).forEach(o => {
      if (o.product_name) counts[o.product_name] = (counts[o.product_name] || 0) + 1
    })
    const sorted = Object.entries(counts).sort(([, a], [, b]) => b - a)
    return sorted[0] ? { name: sorted[0][0], count: sorted[0][1] } : null
  }, [monthOrders])

  const businessPerf = useMemo(() => {
    if (!businesses?.length) return []
    const byBizOrders = {}
    monthOrders.forEach(o => {
      if (!byBizOrders[o.business_id]) byBizOrders[o.business_id] = { orders: 0, sales: 0 }
      byBizOrders[o.business_id].orders++
      if (REVENUE_STATUSES.includes(o.status)) {
        byBizOrders[o.business_id].sales += Number(o.amount_paid || o.total_amount || 0)
      }
    })
    const byBizExp = {}
    expensesMonth.forEach(e => {
      byBizExp[e.business_id] = (byBizExp[e.business_id] || 0) + Number(e.amount || 0)
    })
    return businesses.map(b => ({
      id:         b.id,
      name:       b.name,
      short_code: b.short_code,
      orders:     byBizOrders[b.id]?.orders || 0,
      sales:      byBizOrders[b.id]?.sales  || 0,
      expenses:   byBizExp[b.id]            || 0,
      profit:    (byBizOrders[b.id]?.sales  || 0) - (byBizExp[b.id] || 0),
    }))
  }, [businesses, monthOrders, expensesMonth])

  const combinedProfit = businessPerf.reduce((s, b) => s + b.profit, 0)

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="overflow-y-auto overflow-x-hidden h-full w-full">

      {/* ── Dark Header ── */}
      <div className="bg-gray-900 text-white px-4 pt-12 pb-5">
        <p className="text-yellow-400 text-sm font-medium">Good {greeting()}</p>
        <h1 className="text-2xl font-bold mt-0.5">{user?.name}</h1>
        <p className="text-gray-400 text-sm mt-0.5">{formatDate(new Date().toISOString())}</p>

        {/* Today stats */}
        <div className="mt-4 bg-gray-800 rounded-2xl p-4 space-y-3">
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Orders Today</p>
            <p className="text-2xl font-bold text-white">
              {todayOrdersQ.isLoading ? '—' : todayOrders.length}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 border-t border-gray-700 pt-3">
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Sales Today</p>
              <p className="text-sm font-bold text-green-400">
                {todayOrdersQ.isLoading ? '—' : formatCurrency(salesToday)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Profit Today</p>
              <p className={`text-sm font-bold ${profitToday >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {(todayOrdersQ.isLoading || expensesTodayQ.isLoading) ? '—' : formatCurrency(profitToday)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="px-4 py-4 space-y-4">

        {/* This Month card */}
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-900">This Month</h3>
            <span className="text-xs text-gray-400">
              {new Date().toLocaleString('default', { month: 'long', year: 'numeric' })}
            </span>
          </div>
          {monthOrdersQ.isLoading ? (
            <div className="h-20 bg-gray-50 rounded-xl animate-pulse" />
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-gray-50 rounded-xl px-2 py-2">
                <p className="text-xs text-gray-500 mb-0.5">Orders</p>
                <p className="text-lg font-bold text-gray-900">{monthOrders.length}</p>
              </div>
              <div className="bg-gray-50 rounded-xl px-2 py-2">
                <p className="text-xs text-gray-500 mb-0.5">Sales</p>
                <p className="text-sm font-bold text-green-600">{formatCurrency(salesMonth)}</p>
              </div>
              <div className="bg-gray-50 rounded-xl px-2 py-2">
                <p className="text-xs text-gray-500 mb-0.5">Net Profit</p>
                <p className={`text-sm font-bold ${profitMonth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {formatCurrency(profitMonth)}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Outstanding + Stock Alerts */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="Outstanding"
            value={partialOrdersQ.isLoading ? '...' : formatCurrency(outstandingBalance)}
            icon={<AlertTriangle size={20} />}
            color="amber"
            sub={`${partialOrders.length} partial orders`}
            onClick={() => navigate('/orders?status=partially_paid')}
          />
          <StatCard
            label="Stock Alerts"
            value={inventoryQ.isLoading ? '...' : stockAlerts}
            icon={<Package size={20} />}
            color={stockAlerts > 0 ? 'red' : 'green'}
            sub={`${outOfStock} out · ${lowStock} low`}
            onClick={() => navigate('/inventory')}
          />
        </div>

        {/* Best Selling Product */}
        {bestSeller && (
          <button
            onClick={() => navigate('/reports')}
            className="w-full bg-blue-600 rounded-2xl p-4 text-left active:scale-95 transition-all"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <Star size={14} className="text-yellow-300 fill-yellow-300" />
                  <p className="text-xs font-medium text-blue-200">Best Seller This Month</p>
                </div>
                <p className="text-base font-bold text-white leading-tight">{bestSeller.name}</p>
                <p className="text-xs text-blue-300 mt-0.5">{bestSeller.count} orders</p>
              </div>
              <ChevronRight size={20} className="text-blue-300" />
            </div>
          </button>
        )}

        {/* Business Performance */}
        {businessPerf.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-4 pt-4 pb-2 flex items-center gap-2">
              <Briefcase size={16} className="text-gray-500" />
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Business Performance</h3>
                <p className="text-xs text-gray-400">This month</p>
              </div>
            </div>

            <div className="divide-y divide-gray-50">
              {businessPerf.map(biz => (
                <div key={biz.id} className="px-4 py-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-gray-900">{biz.name}</span>
                    {biz.short_code && (
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                        {biz.short_code}
                      </span>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">Orders</span>
                      <span className="text-sm font-bold text-gray-900">{biz.orders}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">Sales</span>
                      <span className="text-sm font-bold text-green-600">{formatCurrency(biz.sales)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">Expenses</span>
                      <span className="text-sm font-bold text-red-500">{formatCurrency(biz.expenses)}</span>
                    </div>
                    <div className="flex items-center justify-between border-t border-gray-100 pt-1.5">
                      <span className="text-xs font-semibold text-gray-700">Profit</span>
                      <span className={`text-sm font-bold ${biz.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {formatCurrency(biz.profit)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}

              {/* Combined totals when >1 business */}
              {businessPerf.length > 1 && (
                <div className="px-4 py-3 bg-gray-50">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-gray-600">Combined Total</span>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">Orders</span>
                      <span className="text-sm font-bold text-gray-900">{businessPerf.reduce((s, b) => s + b.orders, 0)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">Sales</span>
                      <span className="text-sm font-bold text-green-600">{formatCurrency(businessPerf.reduce((s, b) => s + b.sales, 0))}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">Expenses</span>
                      <span className="text-sm font-bold text-red-500">{formatCurrency(businessPerf.reduce((s, b) => s + b.expenses, 0))}</span>
                    </div>
                    <div className="flex items-center justify-between border-t border-gray-100 pt-1.5">
                      <span className="text-xs font-semibold text-gray-700">Profit</span>
                      <span className={`text-sm font-bold ${combinedProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {formatCurrency(combinedProfit)}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Quick Actions */}
        <div className="bg-white rounded-2xl p-4 border border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Quick Actions</h3>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'New Order',  icon: Plus,       action: () => navigate('/orders/new'),       color: 'bg-blue-50 text-blue-600' },
              { label: 'Analytics', icon: LineChart,  action: () => navigate('/analytics'),        color: 'bg-purple-50 text-purple-600' },
              { label: 'Staff',     icon: Users,      action: () => navigate('/settings/staff'),   color: 'bg-green-50 text-green-600' },
              { label: 'Inventory', icon: Package,    action: () => navigate('/inventory'),        color: 'bg-amber-50 text-amber-600' },
              { label: 'Customers', icon: Users,      action: () => navigate('/customers'),        color: 'bg-pink-50 text-pink-600' },
              { label: 'Accounting',icon: DollarSign, action: () => navigate('/accounting'),       color: 'bg-teal-50 text-teal-600' },
            ].map(({ label, icon: Icon, action, color }) => (
              <button
                key={label}
                onClick={action}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-xl ${color} active:scale-95 transition-all`}
              >
                <Icon size={20} />
                <span className="text-xs font-medium">{label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Recent Orders */}
        <div className="bg-white rounded-2xl border border-gray-100">
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <h3 className="text-sm font-semibold text-gray-900">Recent Orders</h3>
            <button onClick={() => navigate('/orders')} className="text-xs text-blue-600 font-medium">
              View all
            </button>
          </div>

          {recentOrdersQ.isLoading ? (
            <div className="px-4 pb-4"><SkeletonList count={4} /></div>
          ) : recentOrders.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No orders yet</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {recentOrders.map(order => (
                <button
                  key={order.id}
                  onClick={() => navigate(`/orders/${order.id}`)}
                  className="w-full px-4 py-3 text-left hover:bg-gray-50 active:bg-gray-100 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-mono text-gray-500">{order.order_number}</span>
                        {order.business?.short_code && (
                          <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                            {order.business.short_code}
                          </span>
                        )}
                        <StatusBadge status={order.status} />
                      </div>
                      <p className="text-sm font-medium text-gray-900 mt-0.5 truncate">{order.customer_name}</p>
                      <p className="text-xs text-gray-500 truncate">{order.product_name} · {order.state}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-gray-900">{formatCurrency(order.total_amount)}</p>
                      <p className="text-xs text-gray-400">{formatDate(order.created_at)}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
