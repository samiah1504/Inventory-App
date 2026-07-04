import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { TopBar } from '../../components/layout/TopBar'
import { StatCard } from '../../components/ui/Card'
import { SkeletonList } from '../../components/ui/Skeleton'
import { formatCurrency, formatDate, NIGERIAN_STATES } from '../../utils/format'
import { useAuthStore } from '../../stores/authStore'
import { BarChart3, TrendingUp, Package, Truck, Users, DollarSign, AlertCircle, Download } from 'lucide-react'
import { Select, Input } from '../../components/ui/Input'
import { useBusinesses } from '../../hooks/useBusinesses'

const REPORT_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'orders', label: 'Orders' },
  { key: 'sales', label: 'Sales' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'staff', label: 'Staff' },
]

export function ReportsPage() {
  const [tab, setTab] = useState('overview')
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().split('T')[0]
  })
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0])
  const [businessId, setBusinessId] = useState('')
  const { user } = useAuthStore()
  const { data: businesses } = useBusinesses()

  const isCeo = ['ceo', 'super_admin'].includes(user?.role)

  const ordersReport = useQuery({
    queryKey: ['report_orders', dateFrom, dateTo, businessId],
    queryFn: async () => {
      let query = supabase
        .from('orders')
        .select('order_number, customer_name, customer_phone, status, state, source, product_name, total_amount, amount_paid, balance_amount, created_by, created_at, business_id')
        .gte('created_at', `${dateFrom}T00:00:00`)
        .lte('created_at', `${dateTo}T23:59:59`)
        .order('created_at', { ascending: false })
      if (businessId) query = query.eq('business_id', businessId)
      const { data, error } = await query
      if (error) throw error
      return data || []
    },
    enabled: !!dateFrom && !!dateTo,
  })

  const expensesReport = useQuery({
    queryKey: ['report_expenses', dateFrom, dateTo, businessId],
    enabled: isCeo,
    queryFn: async () => {
      let query = supabase
        .from('expenses')
        .select('*')
        .gte('date', dateFrom)
        .lte('date', dateTo)
      if (businessId) query = query.eq('business_id', businessId)
      if (!isCeo) query = query.eq('is_admin_only', false)
      const { data, error } = await query
      if (error) throw error
      return data || []
    },
  })

  const staffReport = useQuery({
    queryKey: ['report_staff', dateFrom, dateTo],
    enabled: isCeo,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('created_by, status, staff:staff_users!orders_created_by_fkey(name, staff_code)')
        .gte('created_at', `${dateFrom}T00:00:00`)
        .lte('created_at', `${dateTo}T23:59:59`)
      if (error) throw error
      return data || []
    },
  })

  const inventoryReport = useQuery({
    queryKey: ['report_inventory', businessId],
    queryFn: async () => {
      let query = supabase
        .from('inventory')
        .select('*, product:products(name, business:businesses(name)), warehouse:warehouses(name, state)')
        .order('quantity_available', { ascending: true })
      if (businessId) query = query.eq('business_id', businessId)
      const { data, error } = await query
      if (error) throw error
      return data || []
    },
  })

  const inventoryMovements = useQuery({
    queryKey: ['report_inventory_movements', dateFrom, dateTo, businessId],
    enabled: tab === 'inventory',
    queryFn: async () => {
      let query = supabase
        .from('inventory_movements')
        .select('*, product:products(name), warehouse:warehouses(name)')
        .gte('created_at', `${dateFrom}T00:00:00`)
        .lte('created_at', `${dateTo}T23:59:59`)
        .order('created_at', { ascending: false })
      if (businessId) query = query.eq('business_id', businessId)
      const { data, error } = await query
      if (error) throw error
      return data || []
    },
  })

  const orders = ordersReport.data || []
  const expenses = expensesReport.data || []
  const staffOrders = staffReport.data || []
  const inventoryItems = inventoryReport.data || []

  // Compute stats
  const totalOrders = orders.length
  const paidOrders = orders.filter(o => ['paid', 'partially_paid'].includes(o.status))
  const totalSales = paidOrders.reduce((s, o) => s + Number(o.amount_paid || o.total_amount), 0)
  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0)
  const netProfit = totalSales - totalExpenses

  const byStatus = {}
  orders.forEach(o => { byStatus[o.status] = (byStatus[o.status] || 0) + 1 })

  const byState = {}
  orders.forEach(o => { byState[o.state] = (byState[o.state] || 0) + 1 })

  const bySource = {}
  orders.forEach(o => { if (o.source) bySource[o.source] = (bySource[o.source] || 0) + 1 })

  const byExpenseType = {}
  expenses.forEach(e => { byExpenseType[e.expense_type] = (byExpenseType[e.expense_type] || 0) + Number(e.amount) })

  const outstandingOrders = orders.filter(o => o.status === 'partially_paid')
  const outstanding = outstandingOrders.reduce((s, o) => s + Number(o.balance_amount || 0), 0)

  function downloadCSV(rows, filename) {
    if (!rows.length) return
    const headers = Object.keys(rows[0])
    const csv = [
      headers.join(','),
      ...rows.map(row =>
        headers.map(h => {
          const val = row[h] === null || row[h] === undefined ? '' : String(row[h])
          return val.includes(',') || val.includes('"') || val.includes('\n')
            ? `"${val.replace(/"/g, '""')}"` : val
        }).join(',')
      )
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }

  function handleExport() {
    if (tab === 'orders' || tab === 'overview' || tab === 'sales') {
      const rows = orders.map(o => ({
        order_number: o.order_number || '',
        customer_name: o.customer_name || '',
        customer_phone: o.customer_phone || '',
        status: o.status,
        state: o.state || '',
        source: o.source || '',
        product: o.product_name || '',
        total_amount: o.total_amount,
        amount_paid: o.amount_paid || '',
        balance: o.balance_amount || '',
        created_at: o.created_at ? o.created_at.slice(0, 10) : '',
      }))
      downloadCSV(rows, `orders-${dateFrom}-to-${dateTo}.csv`)
    } else if (tab === 'expenses') {
      const rows = expenses.map(e => ({
        date: e.date,
        expense_type: e.expense_type,
        amount: e.amount,
        description: e.description || '',
        category: e.category || '',
        notes: e.notes || '',
      }))
      downloadCSV(rows, `expenses-${dateFrom}-to-${dateTo}.csv`)
    } else if (tab === 'staff') {
      const byStaff = {}
      staffOrders.forEach(o => {
        const name = o.staff?.name || o.created_by || 'Unknown'
        const code = o.staff?.staff_code || ''
        if (!byStaff[name]) byStaff[name] = { name, staff_code: code, total: 0, paid: 0, failed: 0, cancelled: 0 }
        byStaff[name].total++
        if (['paid', 'partially_paid'].includes(o.status)) byStaff[name].paid++
        if (o.status === 'failed_delivery') byStaff[name].failed++
        if (o.status === 'cancelled') byStaff[name].cancelled++
      })
      downloadCSV(Object.values(byStaff), `staff-report-${dateFrom}-to-${dateTo}.csv`)
    } else if (tab === 'inventory') {
      const movements = inventoryMovements.data || []
      if (movements.length > 0) {
        const rows = movements.map(m => ({
          date: m.created_at?.slice(0, 10) || '',
          product: m.product?.name || '',
          warehouse: m.warehouse?.name || '',
          movement_type: m.movement_type || '',
          quantity: m.quantity,
          unit_cost: m.unit_cost || '',
          total_cost: m.total_cost || '',
          supplier: m.supplier || '',
          notes: m.notes || '',
        }))
        downloadCSV(rows, `inventory-movements-${dateFrom}-to-${dateTo}.csv`)
      } else {
        const rows = inventoryItems.map(i => ({
          product: i.product?.name || '',
          warehouse: i.warehouse?.name || '',
          quantity_available: i.quantity_available,
          quantity_reserved: i.quantity_reserved || 0,
        }))
        downloadCSV(rows, `inventory-snapshot.csv`)
      }
    }
  }

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Reports"
        back={false}
        actions={
          <button
            onClick={handleExport}
            className="p-2 bg-gray-100 text-gray-700 rounded-xl active:scale-95 transition-all"
            title="Export CSV"
          >
            <Download size={18} />
          </button>
        }
      />

      {/* Filters */}
      <div className="bg-white border-b border-gray-100 px-4 py-3 space-y-2 sticky top-[57px] z-20">
        <div className="flex gap-2">
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="flex-1" />
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="flex-1" />
        </div>
        <Select value={businessId} onChange={e => setBusinessId(e.target.value)}>
          <option value="">All Businesses</option>
          {(businesses || []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
        <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {REPORT_TABS.map(({ key, label }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium ${tab === key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}
            >{label}</button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {tab === 'overview' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Total Orders" value={totalOrders} icon={<BarChart3 size={20} />} color="blue" />
              <StatCard label="Total Sales" value={formatCurrency(totalSales)} icon={<DollarSign size={20} />} color="green" />
              {isCeo && <StatCard label="Total Expenses" value={formatCurrency(totalExpenses)} icon={<TrendingUp size={20} />} color="red" />}
              {isCeo && <StatCard label="Net Profit" value={formatCurrency(netProfit)} icon={<TrendingUp size={20} />} color={netProfit >= 0 ? 'green' : 'red'} />}
              <StatCard label="Outstanding" value={formatCurrency(outstanding)} icon={<AlertCircle size={20} />} color="amber" sub={`${outstandingOrders.length} orders`} />
            </div>

            {/* Order status breakdown */}
            <div className="bg-white rounded-2xl p-4 border border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Orders by Status</h3>
              <div className="space-y-2">
                {Object.entries(byStatus).sort(([,a],[,b]) => b - a).map(([status, count]) => (
                  <div key={status} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`w-2.5 h-2.5 rounded-full status-${status}`} style={{ background: 'currentColor' }} />
                      <span className="text-sm text-gray-700 capitalize">{status.replace('_', ' ')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded-full"
                          style={{ width: `${(count / totalOrders) * 100}%` }}
                        />
                      </div>
                      <span className="text-sm font-semibold text-gray-900 w-8 text-right">{count}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Top products */}
            {(() => {
              const byProduct = {}
              orders.forEach(o => {
                if (o.product_name) {
                  if (!byProduct[o.product_name]) byProduct[o.product_name] = { count: 0, revenue: 0 }
                  byProduct[o.product_name].count++
                  byProduct[o.product_name].revenue += Number(o.total_amount)
                }
              })
              const topProducts = Object.entries(byProduct).sort(([,a],[,b]) => b.count - a.count).slice(0, 8)
              return topProducts.length > 0 ? (
                <div className="bg-white rounded-2xl p-4 border border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Top Products</h3>
                  <div className="space-y-2">
                    {topProducts.map(([name, stats]) => (
                      <div key={name} className="flex items-center justify-between gap-2 py-1 border-b border-gray-50 last:border-0">
                        <p className="text-sm text-gray-700 truncate flex-1">{name}</p>
                        <span className="text-xs text-gray-500 shrink-0">{stats.count} orders</span>
                        <span className="text-sm font-bold text-gray-900 shrink-0">{formatCurrency(stats.revenue)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null
            })()}
          </>
        )}

        {tab === 'orders' && (
          <>
            {/* By State */}
            <div className="bg-white rounded-2xl p-4 border border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Orders by State</h3>
              <div className="space-y-2">
                {Object.entries(byState).sort(([,a],[,b]) => b - a).slice(0, 15).map(([state, count]) => (
                  <div key={state} className="flex items-center justify-between">
                    <span className="text-sm text-gray-700">{state}</span>
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-1.5 bg-gray-100 rounded-full">
                        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(count / totalOrders) * 100}%` }} />
                      </div>
                      <span className="text-sm font-bold w-8 text-right">{count}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* By Source */}
            <div className="bg-white rounded-2xl p-4 border border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Orders by Source</h3>
              <div className="space-y-2">
                {Object.entries(bySource).sort(([,a],[,b]) => b - a).map(([source, count]) => (
                  <div key={source} className="flex items-center justify-between">
                    <span className="text-sm text-gray-700">{source}</span>
                    <span className="text-sm font-bold text-gray-900">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {tab === 'sales' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Total Revenue" value={formatCurrency(totalSales)} icon={<DollarSign size={20} />} color="green" />
              <StatCard label="Outstanding" value={formatCurrency(outstanding)} icon={<AlertCircle size={20} />} color="amber" />
            </div>

            {/* Revenue by state */}
            {(() => {
              const byStateRevenue = {}
              orders.filter(o => ['paid', 'partially_paid'].includes(o.status)).forEach(o => {
                const s = o.state || 'Unknown'
                byStateRevenue[s] = (byStateRevenue[s] || 0) + Number(o.amount_paid || o.total_amount)
              })
              const stateEntries = Object.entries(byStateRevenue).sort(([,a],[,b]) => b - a)
              const maxRevenue = stateEntries[0]?.[1] || 1
              return stateEntries.length > 0 ? (
                <div className="bg-white rounded-2xl p-4 border border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Revenue by State</h3>
                  <div className="space-y-2">
                    {stateEntries.slice(0, 10).map(([state, amount]) => (
                      <div key={state} className="flex items-center justify-between gap-3">
                        <span className="text-sm text-gray-700 w-28 truncate">{state}</span>
                        <div className="flex-1 h-1.5 bg-gray-100 rounded-full">
                          <div className="h-full bg-green-500 rounded-full" style={{ width: `${(amount / maxRevenue) * 100}%` }} />
                        </div>
                        <span className="text-sm font-bold text-gray-900 w-24 text-right">{formatCurrency(amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null
            })()}

            <div className="bg-white rounded-2xl p-4 border border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Outstanding Balances</h3>
              {outstandingOrders.length === 0 ? (
                <p className="text-sm text-gray-400">No outstanding balances</p>
              ) : (
                <div className="space-y-2">
                  {outstandingOrders.map(o => (
                    <div key={o.id} className="flex justify-between py-1.5 border-b border-gray-50">
                      <div>
                        <p className="text-xs font-mono text-gray-400">{o.order_number}</p>
                        <p className="text-sm text-gray-700">{o.customer_name}</p>
                      </div>
                      <p className="text-sm font-bold text-amber-600">{formatCurrency(o.balance_amount)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'expenses' && isCeo && (
          <div className="space-y-4">
            <StatCard label="Total Expenses" value={formatCurrency(totalExpenses)} icon={<DollarSign size={20} />} color="red" />
            <div className="bg-white rounded-2xl p-4 border border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">By Type</h3>
              <div className="space-y-2">
                {Object.entries(byExpenseType).sort(([,a],[,b]) => b - a).map(([type, amount]) => (
                  <div key={type} className="flex justify-between py-1.5 border-b border-gray-50 last:border-0">
                    <span className="text-sm text-gray-700 capitalize">{type.replace('_', ' ')}</span>
                    <span className="text-sm font-bold text-gray-900">{formatCurrency(amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'staff' && isCeo && (
          <div className="bg-white rounded-2xl p-4 border border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Orders by Staff</h3>
            {(() => {
              const byStaff = {}
              staffOrders.forEach(o => {
                const name = o.staff?.name || o.created_by || 'Unknown'
                const code = o.staff?.staff_code || ''
                const key = name
                if (!byStaff[key]) byStaff[key] = { name, code, total: 0, paid: 0, failed: 0, cancelled: 0 }
                byStaff[key].total++
                if (['paid', 'partially_paid'].includes(o.status)) byStaff[key].paid++
                if (o.status === 'failed_delivery') byStaff[key].failed++
                if (o.status === 'cancelled') byStaff[key].cancelled++
              })
              return (
                <div className="space-y-3">
                  {Object.values(byStaff).sort((a, b) => b.total - a.total).map(stats => (
                    <div key={stats.name} className="py-2 border-b border-gray-50 last:border-0">
                      <div className="flex justify-between mb-1">
                        <div>
                          <span className="text-sm font-medium text-gray-900">{stats.name}</span>
                          {stats.code && <span className="ml-1.5 text-xs text-gray-400">{stats.code}</span>}
                        </div>
                        <span className="text-sm font-bold text-gray-900">{stats.total} orders</span>
                      </div>
                      <div className="flex gap-3 text-xs text-gray-500">
                        <span className="text-green-600">{stats.paid} paid</span>
                        <span className="text-red-500">{stats.failed} failed</span>
                        <span className="text-gray-400">{stats.cancelled} cancelled</span>
                      </div>
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>
        )}

        {tab === 'inventory' && (
          <div className="space-y-4">
            {/* Current snapshot stats */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white rounded-2xl p-3 border border-gray-100 text-center">
                <p className="text-2xl font-bold text-gray-900">{inventoryItems.length}</p>
                <p className="text-xs text-gray-500">Stock Lines</p>
              </div>
              <div className="bg-white rounded-2xl p-3 border border-gray-100 text-center">
                <p className="text-2xl font-bold text-amber-600">{inventoryItems.filter(i => i.quantity_available > 0 && i.quantity_available <= 5).length}</p>
                <p className="text-xs text-gray-500">Low Stock</p>
              </div>
              <div className="bg-white rounded-2xl p-3 border border-gray-100 text-center">
                <p className="text-2xl font-bold text-red-600">{inventoryItems.filter(i => i.quantity_available <= 0).length}</p>
                <p className="text-xs text-gray-500">Out of Stock</p>
              </div>
            </div>

            {/* Movements in date range */}
            {(() => {
              const movements = inventoryMovements.data || []
              const totalUnits = movements.reduce((s, m) => s + Number(m.quantity || 0), 0)
              const totalCost = movements.reduce((s, m) => s + Number(m.total_cost || 0), 0)
              return (
                <div className="bg-white rounded-2xl border border-gray-100">
                  <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-900">Stock In ({dateFrom} – {dateTo})</h3>
                    <span className="text-xs text-gray-400">{movements.length} movements</span>
                  </div>
                  {movements.length > 0 && (
                    <div className="px-4 pb-3 flex gap-4">
                      <div>
                        <p className="text-xs text-gray-500">Units received</p>
                        <p className="text-base font-bold text-blue-600">{totalUnits}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Total cost</p>
                        <p className="text-base font-bold text-gray-900">{formatCurrency(totalCost)}</p>
                      </div>
                    </div>
                  )}
                  <div className="divide-y divide-gray-50">
                    {inventoryMovements.isLoading ? (
                      <p className="text-sm text-gray-400 text-center py-6">Loading...</p>
                    ) : movements.length === 0 ? (
                      <p className="text-sm text-gray-400 text-center py-6">No stock movements in this period</p>
                    ) : (
                      movements.slice(0, 20).map(m => (
                        <div key={m.id} className="px-4 py-2.5 flex items-center justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-gray-900 truncate">{m.product?.name}</p>
                            <p className="text-xs text-gray-400">{m.warehouse?.name} · {m.created_at?.slice(0, 10)}</p>
                            {m.supplier && <p className="text-xs text-gray-400">From: {m.supplier}</p>}
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-sm font-bold text-blue-600">+{m.quantity}</p>
                            {m.total_cost > 0 && <p className="text-xs text-gray-500">{formatCurrency(m.total_cost)}</p>}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )
            })()}

            {/* Current stock levels */}
            <div className="bg-white rounded-2xl border border-gray-100">
              <div className="px-4 pt-4 pb-2">
                <h3 className="text-sm font-semibold text-gray-900">Current Stock Levels</h3>
              </div>
              <div className="divide-y divide-gray-50">
                {inventoryItems.slice(0, 30).map(item => (
                  <div key={item.id} className="px-4 py-2.5 flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900 truncate">{item.product?.name}</p>
                      <p className="text-xs text-gray-400">{item.warehouse?.name}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className={`text-sm font-bold ${item.quantity_available <= 0 ? 'text-red-600' : item.quantity_available <= 5 ? 'text-amber-600' : 'text-green-600'}`}>
                        {item.quantity_available}
                      </span>
                      <span className="text-xs text-gray-400">avail</span>
                    </div>
                  </div>
                ))}
                {inventoryItems.length === 0 && (
                  <p className="text-sm text-gray-400 text-center py-6">No inventory records</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
