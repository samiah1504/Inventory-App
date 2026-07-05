import { useState, useMemo, useRef, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import { supabase } from '../../lib/supabase'
import { TopBar } from '../../components/layout/TopBar'
import { StatCard } from '../../components/ui/Card'
import { SkeletonList } from '../../components/ui/Skeleton'
import { formatCurrency, formatDate } from '../../utils/format'
import { useAuthStore } from '../../stores/authStore'
import {
  BarChart3, TrendingUp, Package, Truck, Users, DollarSign,
  AlertCircle, Download, ChevronDown, ChevronUp,
} from 'lucide-react'
import { Select, Input } from '../../components/ui/Input'
import { useBusinesses } from '../../hooks/useBusinesses'

// ─── Constants ───────────────────────────────────────────────────────────────

const REVENUE_STATUSES = ['paid', 'partially_paid']

const REPORT_TABS = [
  { key: 'overview',  label: 'Overview' },
  { key: 'orders',    label: 'Orders' },
  { key: 'sales',     label: 'Sales' },
  { key: 'products',  label: 'Products' },
  { key: 'profit',    label: 'P&L' },
  { key: 'compare',   label: 'Compare' },
  { key: 'expenses',  label: 'Expenses' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'staff',     label: 'Staff' },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function salesFromOrders(orders) {
  return orders
    .filter(o => REVENUE_STATUSES.includes(o.status))
    .reduce((s, o) => s + Number(o.amount_paid || o.total_amount || 0), 0)
}

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
    ),
  ].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function downloadXLSX(rows, sheetName, filename) {
  if (!rows.length) return
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, filename)
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ReportsPage() {
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState(searchParams.get('tab') || 'overview')
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().split('T')[0]
  })
  const [dateTo, setDateTo]   = useState(new Date().toISOString().split('T')[0])
  const [businessId, setBusinessId] = useState('')
  const [showExportMenu, setShowExportMenu] = useState(false)
  const exportRef = useRef(null)

  const { user } = useAuthStore()
  const { data: businesses } = useBusinesses()
  const isCeo = ['ceo', 'super_admin'].includes(user?.role)

  // Close export menu on outside click
  useEffect(() => {
    function handleOutside(e) {
      if (exportRef.current && !exportRef.current.contains(e.target)) {
        setShowExportMenu(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [])

  // ── Period presets ────────────────────────────────────────────────────────

  function applyPreset(preset) {
    const now = new Date()
    const todayISO = now.toISOString().split('T')[0]
    if (preset === 'today') {
      setDateFrom(todayISO); setDateTo(todayISO)
    } else if (preset === 'week') {
      const monday = new Date(now)
      monday.setDate(now.getDate() - ((now.getDay() + 6) % 7))
      setDateFrom(monday.toISOString().split('T')[0]); setDateTo(todayISO)
    } else if (preset === 'month') {
      setDateFrom(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`)
      setDateTo(todayISO)
    } else if (preset === 'lastmonth') {
      const firstOfThis = new Date(now.getFullYear(), now.getMonth(), 1)
      const lastOfPrev  = new Date(firstOfThis - 1)
      const firstOfPrev = new Date(lastOfPrev.getFullYear(), lastOfPrev.getMonth(), 1)
      setDateFrom(firstOfPrev.toISOString().split('T')[0])
      setDateTo(lastOfPrev.toISOString().split('T')[0])
    }
  }

  // ── Main queries ──────────────────────────────────────────────────────────

  const ordersReport = useQuery({
    queryKey: ['report_orders', dateFrom, dateTo, businessId],
    queryFn: async () => {
      try {
        let q = supabase
          .from('orders')
          .select('id, order_number, customer_name, customer_phone, status, state, source, product_name, quantity, total_amount, amount_paid, balance_amount, created_by, created_at, business_id, items_data')
          .gte('created_at', `${dateFrom}T00:00:00`)
          .lte('created_at', `${dateTo}T23:59:59`)
          .order('created_at', { ascending: false })
        if (businessId) q = q.eq('business_id', businessId)
        const { data, error } = await q
        if (error) throw error
        return data || []
      } catch { return [] }
    },
    enabled: !!dateFrom && !!dateTo,
    staleTime: 60000,
  })

  const expensesReport = useQuery({
    queryKey: ['report_expenses', dateFrom, dateTo, businessId],
    enabled: isCeo,
    queryFn: async () => {
      try {
        let q = supabase.from('expenses').select('*')
          .gte('date', dateFrom).lte('date', dateTo)
        if (businessId) q = q.eq('business_id', businessId)
        const { data, error } = await q
        if (error) throw error
        return data || []
      } catch { return [] }
    },
    staleTime: 60000,
  })

  const staffReport = useQuery({
    queryKey: ['report_staff', dateFrom, dateTo],
    enabled: isCeo,
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from('orders')
          .select('created_by, status, staff:staff_users!orders_created_by_fkey(name, staff_code)')
          .gte('created_at', `${dateFrom}T00:00:00`)
          .lte('created_at', `${dateTo}T23:59:59`)
        if (error) throw error
        return data || []
      } catch { return [] }
    },
    staleTime: 60000,
  })

  const inventoryReport = useQuery({
    queryKey: ['report_inventory', businessId],
    queryFn: async () => {
      try {
        let q = supabase
          .from('inventory')
          .select('*, product:products(name, business:businesses(name)), warehouse:warehouses(name, state)')
          .order('quantity_available', { ascending: true })
        if (businessId) q = q.eq('business_id', businessId)
        const { data, error } = await q
        if (error) throw error
        return data || []
      } catch { return [] }
    },
    staleTime: 60000,
  })

  const inventoryMovements = useQuery({
    queryKey: ['report_inventory_movements', dateFrom, dateTo, businessId],
    enabled: tab === 'inventory',
    queryFn: async () => {
      try {
        let q = supabase
          .from('inventory_movements')
          .select('*, product:products(name), warehouse:warehouses(name)')
          .gte('created_at', `${dateFrom}T00:00:00`)
          .lte('created_at', `${dateTo}T23:59:59`)
          .order('created_at', { ascending: false })
        if (businessId) q = q.eq('business_id', businessId)
        const { data, error } = await q
        if (error) throw error
        return data || []
      } catch { return [] }
    },
    staleTime: 60000,
  })

  // Products query — only run when tab = products, orders loaded, and ≤500 orders
  const canQueryItems = tab === 'products' && ordersReport.isSuccess && (ordersReport.data?.length || 0) > 0 && (ordersReport.data?.length || 0) <= 500
  const productsReport = useQuery({
    queryKey: ['report_products', dateFrom, dateTo, businessId],
    enabled: canQueryItems,
    queryFn: async () => {
      try {
        const revenueOrders = (ordersReport.data || []).filter(o => REVENUE_STATUSES.includes(o.status))
        const orderIds = revenueOrders.map(o => o.id).filter(Boolean)
        if (orderIds.length === 0) return []
        const { data, error } = await supabase
          .from('order_items')
          .select('order_id, product_name, quantity, total_amount')
          .in('order_id', orderIds)
        if (error) throw error
        return data || []
      } catch { return [] }
    },
    staleTime: 60000,
  })

  // ── Derived stats ─────────────────────────────────────────────────────────

  const orders       = ordersReport.data || []
  const expenses     = expensesReport.data || []
  const staffOrders  = staffReport.data || []
  const inventoryItems = inventoryReport.data || []

  const totalOrders   = orders.length
  const totalSales    = salesFromOrders(orders)
  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0)
  const netProfit     = totalSales - totalExpenses

  const outstandingOrders = orders.filter(o => o.status === 'partially_paid')
  const outstanding       = outstandingOrders.reduce((s, o) => s + Number(o.balance_amount || 0), 0)

  const byStatus = {}
  orders.forEach(o => { byStatus[o.status] = (byStatus[o.status] || 0) + 1 })

  const byState = {}
  orders.forEach(o => { if (o.state) byState[o.state] = (byState[o.state] || 0) + 1 })

  const bySource = {}
  orders.forEach(o => { if (o.source) bySource[o.source] = (bySource[o.source] || 0) + 1 })

  const byExpenseType = {}
  expenses.forEach(e => { byExpenseType[e.expense_type] = (byExpenseType[e.expense_type] || 0) + Number(e.amount) })

  // ── Product analytics ─────────────────────────────────────────────────────

  const productStats = useMemo(() => {
    const revenueOrders = orders.filter(o => REVENUE_STATUSES.includes(o.status))
    const orderItemRows = productsReport.data || []

    const byProduct = {}
    const addItem = (name, qty, revenue, orderId) => {
      const key = (name || 'Unknown').trim()
      if (!byProduct[key]) byProduct[key] = { qty: 0, revenue: 0, orderIds: new Set() }
      byProduct[key].qty += Number(qty) || 1
      byProduct[key].revenue += Number(revenue) || 0
      if (orderId) byProduct[key].orderIds.add(orderId)
    }

    // Step 1: from order_items table
    const coveredByTable = new Set(orderItemRows.map(i => i.order_id))
    orderItemRows.forEach(item => addItem(item.product_name, item.quantity, item.total_amount, item.order_id))

    // Step 2: for orders not in order_items, expand items_data JSONB or fall back to product_name
    revenueOrders.forEach(o => {
      if (coveredByTable.has(o.id)) return
      const fromJson = Array.isArray(o.items_data) && o.items_data.length > 0 ? o.items_data : null
      if (fromJson) {
        const perItem = Number(o.total_amount || 0) / fromJson.reduce((s, i) => s + (Number(i.quantity) || 1), 0)
        fromJson.forEach(item => addItem(item.product_name, item.quantity, perItem * (Number(item.quantity) || 1), o.id))
      } else if (o.product_name && !o.product_name.includes('+')) {
        addItem(o.product_name, o.quantity || 1, o.total_amount, o.id)
      }
    })

    return Object.entries(byProduct)
      .map(([name, s]) => ({ name, qty: s.qty, revenue: s.revenue, orderCount: s.orderIds.size }))
      .sort((a, b) => b.qty - a.qty)
  }, [orders, productsReport.data])

  // ── P&L stats ─────────────────────────────────────────────────────────────

  const plStats = useMemo(() => {
    const revenueOrds = orders.filter(o => REVENUE_STATUSES.includes(o.status))
    const grossSales   = revenueOrds.reduce((s, o) => s + Number(o.total_amount || 0), 0)
    const cashCollected = orders.filter(o => ['paid', 'partially_paid'].includes(o.status))
      .reduce((s, o) => s + Number(o.amount_paid || 0), 0)
    const pendingCollection = Math.max(0, grossSales - cashCollected)

    const opsExpenses   = expenses.filter(e => !e.is_admin_only).reduce((s, e) => s + Number(e.amount || 0), 0)
    const adminExpenses = expenses.filter(e =>  e.is_admin_only).reduce((s, e) => s + Number(e.amount || 0), 0)
    const totalExp      = opsExpenses + adminExpenses
    const netPrft       = grossSales - totalExp
    const margin        = grossSales > 0 ? (netPrft / grossSales) * 100 : 0

    const byType = {}
    expenses.forEach(e => { byType[e.expense_type] = (byType[e.expense_type] || 0) + Number(e.amount || 0) })

    return { grossSales, cashCollected, pendingCollection, opsExpenses, adminExpenses, totalExpenses: totalExp, netProfit: netPrft, margin, byType }
  }, [orders, expenses])

  // ── Compare stats ─────────────────────────────────────────────────────────

  const compareStats = useMemo(() => {
    if (!businesses?.length) return []
    return businesses.map(biz => {
      const bizOrders   = orders.filter(o => o.business_id === biz.id)
      const bizExpenses = expenses.filter(e => e.business_id === biz.id)
      const revOrds     = bizOrders.filter(o => REVENUE_STATUSES.includes(o.status))
      const grossSales  = revOrds.reduce((s, o) => s + Number(o.total_amount || 0), 0)
      const totalExp    = bizExpenses.reduce((s, e) => s + Number(e.amount || 0), 0)
      const netPrft     = grossSales - totalExp
      const margin      = grossSales > 0 ? (netPrft / grossSales) * 100 : 0

      const delivered = bizOrders.filter(o => o.status === 'delivered').length
      const failed    = bizOrders.filter(o => o.status === 'failed_delivery').length
      const returned  = bizOrders.filter(o => o.status === 'returned').length
      const cancelled = bizOrders.filter(o => o.status === 'cancelled').length
      const delivBase = delivered + failed + returned
      const delivRate = delivBase > 0 ? (delivered / delivBase) * 100 : 0

      const pCounts = {}
      const addP = (name, qty) => { if (name && !name.includes('+')) pCounts[name.trim()] = (pCounts[name.trim()] || 0) + (Number(qty) || 1) }
      revOrds.forEach(o => {
        const fromJson = Array.isArray(o.items_data) && o.items_data.length > 0 ? o.items_data : null
        if (fromJson) fromJson.forEach(i => addP(i.product_name, i.quantity))
        else addP(o.product_name, o.quantity || 1)
      })
      const topProduct = Object.entries(pCounts).sort(([, a], [, b]) => b - a)[0]

      return {
        id: biz.id, name: biz.name, short_code: biz.short_code,
        totalOrders: bizOrders.length, delivered, failed, cancelled, returned,
        grossSales, totalExpenses: totalExp, netProfit: netPrft, margin, deliverySuccessRate: delivRate,
        bestProduct: topProduct ? { name: topProduct[0], count: topProduct[1] } : null,
      }
    })
  }, [businesses, orders, expenses])

  // ── Visible tabs ──────────────────────────────────────────────────────────

  const visibleTabs = REPORT_TABS.filter(t => {
    if (t.key === 'profit'   && !isCeo) return false
    if (t.key === 'compare'  && !isCeo && (!businesses || businesses.length <= 1)) return false
    if (t.key === 'expenses' && !isCeo) return false
    if (t.key === 'staff'    && !isCeo) return false
    return true
  })

  // ── Export handlers ───────────────────────────────────────────────────────

  function handleExportCSV() {
    if (tab === 'expenses') {
      const rows = expenses.map(e => ({
        date: e.date, expense_type: e.expense_type, amount: e.amount,
        description: e.description || '', category: e.category || '',
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
        downloadCSV(movements.map(m => ({
          date: m.created_at?.slice(0, 10) || '', product: m.product?.name || '',
          warehouse: m.warehouse?.name || '', movement_type: m.movement_type || '',
          quantity: m.quantity, unit_cost: m.unit_cost || '', total_cost: m.total_cost || '',
        })), `inventory-movements-${dateFrom}-to-${dateTo}.csv`)
      } else {
        downloadCSV(inventoryItems.map(i => ({
          product: i.product?.name || '', warehouse: i.warehouse?.name || '',
          quantity_available: i.quantity_available,
        })), `inventory-snapshot.csv`)
      }
    } else if (tab === 'products') {
      downloadCSV(productStats.map(p => ({
        product_name: p.name, quantity_sold: p.qty, order_count: p.orderCount,
        total_revenue: p.revenue,
      })), `products-${dateFrom}-to-${dateTo}.csv`)
    } else if (tab === 'compare') {
      downloadCSV(compareStats.map(b => ({
        business: b.name, total_orders: b.totalOrders, delivered: b.delivered,
        failed: b.failed, cancelled: b.cancelled, gross_sales: b.grossSales,
        expenses: b.totalExpenses, net_profit: b.netProfit,
        margin_pct: b.margin.toFixed(1), delivery_rate_pct: b.deliverySuccessRate.toFixed(1),
      })), `compare-${dateFrom}-to-${dateTo}.csv`)
    } else {
      // orders/overview/sales/profit
      downloadCSV(orders.map(o => ({
        order_number: o.order_number || '', customer_name: o.customer_name || '',
        customer_phone: o.customer_phone || '', status: o.status, state: o.state || '',
        source: o.source || '', product: o.product_name || '',
        total_amount: o.total_amount, amount_paid: o.amount_paid || '',
        balance: o.balance_amount || '', created_at: o.created_at?.slice(0, 10) || '',
      })), `orders-${dateFrom}-to-${dateTo}.csv`)
    }
  }

  function handleExportXLSX() {
    if (tab === 'expenses') {
      downloadXLSX(expenses.map(e => ({
        Date: e.date, Type: e.expense_type, Amount: e.amount,
        Description: e.description || '', Category: e.category || '',
      })), 'Expenses', `expenses-${dateFrom}-to-${dateTo}.xlsx`)
    } else if (tab === 'products') {
      downloadXLSX(productStats.map(p => ({
        Product: p.name, 'Qty Sold': p.qty, Orders: p.orderCount, Revenue: p.revenue,
      })), 'Products', `products-${dateFrom}-to-${dateTo}.xlsx`)
    } else if (tab === 'compare') {
      downloadXLSX(compareStats.map(b => ({
        Business: b.name, Orders: b.totalOrders, Delivered: b.delivered,
        Failed: b.failed, 'Gross Sales': b.grossSales, Expenses: b.totalExpenses,
        'Net Profit': b.netProfit, 'Margin %': b.margin.toFixed(1),
        'Delivery Rate %': b.deliverySuccessRate.toFixed(1),
      })), 'Compare', `compare-${dateFrom}-to-${dateTo}.xlsx`)
    } else {
      downloadXLSX(orders.map(o => ({
        'Order #': o.order_number || '', Customer: o.customer_name || '',
        Status: o.status, State: o.state || '', Product: o.product_name || '',
        'Total (NGN)': o.total_amount, 'Paid (NGN)': o.amount_paid || 0,
        Date: o.created_at?.slice(0, 10) || '',
      })), 'Orders', `orders-${dateFrom}-to-${dateTo}.xlsx`)
    }
  }

  function handleExportPDF() {
    const { grossSales, cashCollected, pendingCollection, opsExpenses, adminExpenses, totalExpenses: totExp, netProfit: netPrft, margin } = plStats
    const doc = new jsPDF()
    const fmtAmt = (v) => `NGN ${Number(v).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    const LINE = 8
    let y = 22

    doc.setFontSize(18); doc.setFont('helvetica', 'bold')
    doc.text('Profit & Loss Statement', 20, y); y += LINE + 2

    doc.setFontSize(10); doc.setFont('helvetica', 'normal')
    doc.text(`Period: ${dateFrom}  to  ${dateTo}`, 20, y)
    if (businessId && businesses) {
      const bName = businesses.find(b => b.id === businessId)?.name || ''
      if (bName) { y += LINE; doc.text(`Business: ${bName}`, 20, y) }
    }
    y += LINE * 2

    // Revenue
    doc.setFontSize(13); doc.setFont('helvetica', 'bold')
    doc.text('REVENUE', 20, y); y += LINE
    doc.setFontSize(10); doc.setFont('helvetica', 'normal')
    const RX = 185
    doc.text('Gross Sales:', 25, y);           doc.text(fmtAmt(grossSales), RX, y, { align: 'right' }); y += LINE
    doc.text('Cash Collected:', 25, y);        doc.text(fmtAmt(cashCollected), RX, y, { align: 'right' }); y += LINE
    doc.text('Pending Collection:', 25, y);    doc.text(fmtAmt(pendingCollection), RX, y, { align: 'right' }); y += LINE * 1.5

    // Expenses
    doc.setFontSize(13); doc.setFont('helvetica', 'bold')
    doc.text('EXPENSES', 20, y); y += LINE
    doc.setFontSize(10); doc.setFont('helvetica', 'normal')
    doc.text('Operational Expenses:', 25, y);  doc.text(fmtAmt(opsExpenses), RX, y, { align: 'right' }); y += LINE
    if (isCeo) {
      doc.text('Admin Expenses:', 25, y);      doc.text(fmtAmt(adminExpenses), RX, y, { align: 'right' }); y += LINE
    }
    doc.setFont('helvetica', 'bold')
    doc.text('Total Expenses:', 25, y);        doc.text(fmtAmt(totExp), RX, y, { align: 'right' }); y += LINE * 1.5

    // Summary
    doc.setFontSize(13)
    doc.text('SUMMARY', 20, y); y += LINE
    doc.setFontSize(11)
    doc.text('Net Profit:', 25, y);            doc.text(fmtAmt(netPrft), RX, y, { align: 'right' }); y += LINE
    doc.text('Profit Margin:', 25, y);         doc.text(`${margin.toFixed(1)}%`, RX, y, { align: 'right' })

    doc.save(`pl-report-${dateFrom}-to-${dateTo}.pdf`)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Reports"
        back={false}
        actions={
          <div className="relative" ref={exportRef}>
            <button
              onClick={() => setShowExportMenu(v => !v)}
              className="p-2 bg-gray-100 text-gray-700 rounded-xl active:scale-95 transition-all flex items-center gap-1"
              title="Export"
            >
              <Download size={18} />
              <ChevronDown size={13} />
            </button>
            {showExportMenu && (
              <div className="absolute right-0 top-full mt-1 bg-white rounded-xl shadow-lg border border-gray-100 z-50 min-w-36 overflow-hidden">
                <button onClick={() => { handleExportCSV();  setShowExportMenu(false) }}
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                  <Download size={14} /> CSV
                </button>
                <button onClick={() => { handleExportXLSX(); setShowExportMenu(false) }}
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                  <Download size={14} /> Excel (XLSX)
                </button>
                <button onClick={() => { handleExportPDF();  setShowExportMenu(false) }}
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                  <Download size={14} /> PDF
                </button>
              </div>
            )}
          </div>
        }
      />

      {/* ── Filters ── */}
      <div className="bg-white border-b border-gray-100 px-4 py-3 space-y-2 sticky top-[57px] z-20">
        {/* Period presets */}
        <div className="flex gap-2 overflow-x-auto pb-0.5" style={{ scrollbarWidth: 'none' }}>
          {[
            { label: 'Today',      key: 'today' },
            { label: 'This Week',  key: 'week' },
            { label: 'This Month', key: 'month' },
            { label: 'Last Month', key: 'lastmonth' },
          ].map(p => (
            <button key={p.key} onClick={() => applyPreset(p.key)}
              className="shrink-0 px-3 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 active:scale-95 transition-all">
              {p.label}
            </button>
          ))}
        </div>

        {/* Date range */}
        <div className="flex gap-2">
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="flex-1" />
          <Input type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)}   className="flex-1" />
        </div>

        {/* Business selector */}
        <Select value={businessId} onChange={e => setBusinessId(e.target.value)}>
          <option value="">All Businesses</option>
          {(businesses || []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>

        {/* Tab pills */}
        <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {visibleTabs.map(({ key, label }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                tab === key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab content ── */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

        {/* OVERVIEW */}
        {tab === 'overview' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Total Orders" value={totalOrders}                icon={<BarChart3 size={20} />} color="blue" />
              <StatCard label="Total Sales"  value={formatCurrency(totalSales)} icon={<DollarSign size={20} />} color="green" />
              {isCeo && <StatCard label="Total Expenses" value={formatCurrency(totalExpenses)} icon={<TrendingUp size={20} />} color="red" />}
              {isCeo && <StatCard label="Net Profit"     value={formatCurrency(netProfit)} icon={<TrendingUp size={20} />} color={netProfit >= 0 ? 'green' : 'red'} />}
              <StatCard label="Outstanding" value={formatCurrency(outstanding)} icon={<AlertCircle size={20} />} color="amber" sub={`${outstandingOrders.length} orders`} />
            </div>

            {/* Orders by status */}
            <div className="bg-white rounded-2xl p-4 border border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Orders by Status</h3>
              <div className="space-y-2">
                {Object.entries(byStatus).sort(([, a], [, b]) => b - a).map(([status, count]) => (
                  <div key={status} className="flex items-center justify-between gap-2">
                    <span className="text-sm text-gray-700 capitalize w-36 truncate">{status.replace(/_/g, ' ')}</span>
                    <div className="flex items-center gap-2 flex-1">
                      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${totalOrders ? (count / totalOrders) * 100 : 0}%` }} />
                      </div>
                      <span className="text-sm font-semibold text-gray-900 w-8 text-right">{count}</span>
                    </div>
                  </div>
                ))}
                {Object.keys(byStatus).length === 0 && <p className="text-sm text-gray-400">No orders</p>}
              </div>
            </div>

            {/* Top products */}
            {productStats.length > 0 && (
              <div className="bg-white rounded-2xl p-4 border border-gray-100">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Top Products</h3>
                <div className="space-y-2">
                  {productStats.slice(0, 8).map(p => (
                    <div key={p.name} className="flex items-center justify-between gap-2 py-1 border-b border-gray-50 last:border-0">
                      <p className="text-sm text-gray-700 truncate flex-1">{p.name}</p>
                      <span className="text-xs text-gray-500 shrink-0">{p.orderCount} orders</span>
                      <span className="text-sm font-bold text-gray-900 shrink-0">{formatCurrency(p.revenue)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ORDERS */}
        {tab === 'orders' && (
          <>
            <div className="bg-white rounded-2xl p-4 border border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Orders by State</h3>
              <div className="space-y-2">
                {Object.entries(byState).sort(([, a], [, b]) => b - a).slice(0, 15).map(([state, count]) => (
                  <div key={state} className="flex items-center justify-between gap-2">
                    <span className="text-sm text-gray-700 w-32 truncate">{state}</span>
                    <div className="flex items-center gap-2 flex-1">
                      <div className="flex-1 h-1.5 bg-gray-100 rounded-full">
                        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${totalOrders ? (count / totalOrders) * 100 : 0}%` }} />
                      </div>
                      <span className="text-sm font-bold w-8 text-right">{count}</span>
                    </div>
                  </div>
                ))}
                {Object.keys(byState).length === 0 && <p className="text-sm text-gray-400">No data</p>}
              </div>
            </div>

            <div className="bg-white rounded-2xl p-4 border border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Orders by Source</h3>
              <div className="space-y-2">
                {Object.entries(bySource).sort(([, a], [, b]) => b - a).map(([source, count]) => (
                  <div key={source} className="flex items-center justify-between">
                    <span className="text-sm text-gray-700">{source}</span>
                    <span className="text-sm font-bold text-gray-900">{count}</span>
                  </div>
                ))}
                {Object.keys(bySource).length === 0 && <p className="text-sm text-gray-400">No data</p>}
              </div>
            </div>
          </>
        )}

        {/* SALES */}
        {tab === 'sales' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Total Revenue" value={formatCurrency(totalSales)} icon={<DollarSign size={20} />} color="green" />
              <StatCard label="Outstanding"   value={formatCurrency(outstanding)} icon={<AlertCircle size={20} />} color="amber" />
            </div>

            {/* Revenue by state */}
            {(() => {
              const byStateRev = {}
              orders.filter(o => REVENUE_STATUSES.includes(o.status)).forEach(o => {
                const s = o.state || 'Unknown'
                byStateRev[s] = (byStateRev[s] || 0) + Number(o.amount_paid || o.total_amount)
              })
              const entries = Object.entries(byStateRev).sort(([, a], [, b]) => b - a)
              return entries.length > 0 ? (
                <div className="bg-white rounded-2xl p-4 border border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Revenue by State</h3>
                  <div className="divide-y divide-gray-50">
                    {entries.slice(0, 10).map(([state, amt], i) => (
                      <div key={state} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-gray-300 w-4">{i + 1}</span>
                          <span className="text-sm text-gray-800">{state}</span>
                        </div>
                        <span className="text-sm font-bold text-gray-900">{formatCurrency(amt)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null
            })()}

            {/* Revenue by product */}
            {(() => {
              const byProductRev = {}
              orders.filter(o => REVENUE_STATUSES.includes(o.status)).forEach(o => {
                const amt = Number(o.amount_paid || o.total_amount || 0)
                const fromJson = Array.isArray(o.items_data) && o.items_data.length > 0 ? o.items_data : null
                if (fromJson) {
                  const totalQty = fromJson.reduce((s, i) => s + (Number(i.quantity) || 1), 0)
                  fromJson.forEach(item => {
                    const name = (item.product_name || 'Unknown').trim()
                    const share = totalQty > 0 ? (Number(item.quantity) || 1) / totalQty * amt : amt / fromJson.length
                    byProductRev[name] = (byProductRev[name] || 0) + share
                  })
                } else if (o.product_name && !o.product_name.includes('+')) {
                  const name = o.product_name.trim()
                  byProductRev[name] = (byProductRev[name] || 0) + amt
                }
              })
              const entries = Object.entries(byProductRev).sort(([, a], [, b]) => b - a)
              return entries.length > 0 ? (
                <div className="bg-white rounded-2xl p-4 border border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Revenue by Product</h3>
                  <div className="divide-y divide-gray-50">
                    {entries.map(([product, amt], i) => (
                      <div key={product} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs font-bold text-gray-300 w-4 shrink-0">{i + 1}</span>
                          <span className="text-sm text-gray-800 truncate">{product}</span>
                        </div>
                        <span className="text-sm font-bold text-gray-900 shrink-0 ml-2">{formatCurrency(amt)}</span>
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
                    <div key={o.order_number} className="flex justify-between py-1.5 border-b border-gray-50 last:border-0">
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

        {/* PRODUCTS */}
        {tab === 'products' && (
          <div className="space-y-4">
            {(productsReport.isLoading && canQueryItems) ? (
              <SkeletonList count={4} />
            ) : (
              <>
                {(ordersReport.data?.length || 0) > 500 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-sm text-amber-800">
                    Over 500 orders — showing product data from order records (approximate).
                  </div>
                )}

                {/* Top sellers */}
                <div className="bg-white rounded-2xl p-4 border border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Top Sellers</h3>
                  {productStats.length === 0 ? (
                    <p className="text-sm text-gray-400">No product data for this period</p>
                  ) : (
                    <div className="space-y-3">
                      {productStats.slice(0, 15).map((p, idx) => {
                        const maxQty = productStats[0]?.qty || 1
                        return (
                          <div key={p.name}>
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                <span className="text-xs text-gray-400 w-4">{idx + 1}</span>
                                <p className="text-sm text-gray-900 truncate">{p.name}</p>
                              </div>
                              <div className="text-right shrink-0">
                                <span className="text-sm font-bold text-gray-900">{p.qty} units</span>
                                <span className="text-xs text-gray-400 ml-2">{p.orderCount} orders</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 bg-gray-100 rounded-full">
                                <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(p.qty / maxQty) * 100}%` }} />
                              </div>
                              <span className="text-xs text-gray-500 w-24 text-right">{formatCurrency(p.revenue)}</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* Slow / no sales */}
                {productStats.filter(p => p.orderCount < 2).length > 0 && (
                  <div className="bg-white rounded-2xl p-4 border border-gray-100">
                    <h3 className="text-sm font-semibold text-gray-900 mb-3">Slow / Low Sales</h3>
                    <p className="text-xs text-gray-400 mb-2">Products with fewer than 2 orders in this period</p>
                    <div className="space-y-2">
                      {productStats.filter(p => p.orderCount < 2).map(p => (
                        <div key={p.name} className="flex justify-between py-1.5 border-b border-gray-50 last:border-0">
                          <p className="text-sm text-gray-700 truncate flex-1">{p.name}</p>
                          <span className="text-xs text-gray-400 shrink-0">{p.orderCount} order(s)</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* By business */}
                {businesses && businesses.length > 1 && (
                  <div className="bg-white rounded-2xl p-4 border border-gray-100">
                    <h3 className="text-sm font-semibold text-gray-900 mb-3">Top Product by Business</h3>
                    <div className="space-y-3">
                      {businesses.map(biz => {
                        const bizRevOrds = orders.filter(o => o.business_id === biz.id && REVENUE_STATUSES.includes(o.status))
                        const bpCounts = {}
                        const addBP = (name, qty) => { if (name && !name.includes('+')) bpCounts[name.trim()] = (bpCounts[name.trim()] || 0) + (Number(qty) || 1) }
                        bizRevOrds.forEach(o => {
                          const fj = Array.isArray(o.items_data) && o.items_data.length > 0 ? o.items_data : null
                          if (fj) fj.forEach(i => addBP(i.product_name, i.quantity))
                          else addBP(o.product_name, o.quantity || 1)
                        })
                        const top = Object.entries(bpCounts).sort(([, a], [, b]) => b - a)[0]
                        return (
                          <div key={biz.id} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                            <span className="text-sm font-medium text-gray-700">{biz.name}</span>
                            {top ? (
                              <div className="text-right">
                                <p className="text-sm text-gray-900 truncate max-w-40">{top[0]}</p>
                                <p className="text-xs text-gray-400">{top[1]} orders</p>
                              </div>
                            ) : <span className="text-xs text-gray-400">No data</span>}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* P&L */}
        {tab === 'profit' && isCeo && (
          <div className="space-y-4">
            {/* Revenue section */}
            <div className="bg-white rounded-2xl p-4 border border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Revenue</h3>
              <div className="space-y-2">
                <div className="flex justify-between py-1.5">
                  <span className="text-sm text-gray-600">Gross Sales</span>
                  <span className="text-sm font-bold text-green-600">{formatCurrency(plStats.grossSales)}</span>
                </div>
                <div className="flex justify-between py-1.5 border-t border-gray-50">
                  <span className="text-sm text-gray-600">Cash Collected</span>
                  <span className="text-sm font-semibold text-gray-900">{formatCurrency(plStats.cashCollected)}</span>
                </div>
                <div className="flex justify-between py-1.5 border-t border-gray-50">
                  <span className="text-sm text-gray-500">Pending Collection</span>
                  <span className="text-sm font-medium text-amber-600">{formatCurrency(plStats.pendingCollection)}</span>
                </div>
              </div>
            </div>

            {/* Expenses section */}
            <div className="bg-white rounded-2xl p-4 border border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Expenses</h3>
              <div className="space-y-2 mb-3">
                <div className="flex justify-between py-1.5">
                  <span className="text-sm text-gray-600">Operational</span>
                  <span className="text-sm font-semibold text-gray-900">{formatCurrency(plStats.opsExpenses)}</span>
                </div>
                <div className="flex justify-between py-1.5 border-t border-gray-50">
                  <span className="text-sm text-gray-600">Admin</span>
                  <span className="text-sm font-semibold text-gray-900">{formatCurrency(plStats.adminExpenses)}</span>
                </div>
                <div className="flex justify-between py-1.5 border-t border-gray-100 pt-2">
                  <span className="text-sm font-semibold text-gray-900">Total Expenses</span>
                  <span className="text-sm font-bold text-red-600">{formatCurrency(plStats.totalExpenses)}</span>
                </div>
              </div>
              {/* By type breakdown */}
              {Object.keys(plStats.byType).length > 0 && (
                <div className="pt-3 border-t border-gray-100">
                  <p className="text-xs text-gray-500 mb-2 font-medium">Breakdown by type</p>
                  <div className="space-y-1.5">
                    {Object.entries(plStats.byType).sort(([, a], [, b]) => b - a).map(([type, amt]) => (
                      <div key={type} className="flex justify-between">
                        <span className="text-xs text-gray-600 capitalize">{type.replace(/_/g, ' ')}</span>
                        <span className="text-xs font-medium text-gray-900">{formatCurrency(amt)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Summary */}
            <div className="bg-gray-900 rounded-2xl p-4 text-white">
              <h3 className="text-sm font-semibold text-gray-300 mb-3">P&L Summary</h3>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-300">Gross Sales</span>
                  <span className="text-sm font-bold text-green-400">{formatCurrency(plStats.grossSales)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-300">(-) Total Expenses</span>
                  <span className="text-sm font-bold text-red-400">{formatCurrency(plStats.totalExpenses)}</span>
                </div>
                <div className="border-t border-gray-700 pt-2 flex justify-between">
                  <span className="text-sm font-semibold text-white">Net Profit</span>
                  <span className={`text-lg font-bold ${plStats.netProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {formatCurrency(plStats.netProfit)}
                  </span>
                </div>
                {plStats.grossSales > 0 && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-xs text-gray-400">Profit Margin</span>
                      <span className={`text-sm font-bold ${plStats.margin >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {plStats.margin.toFixed(1)}%
                      </span>
                    </div>
                    <div className="mt-2 h-2 bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${plStats.margin >= 0 ? 'bg-green-500' : 'bg-red-500'}`}
                        style={{ width: `${Math.min(100, Math.abs(plStats.margin))}%` }}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* COMPARE */}
        {tab === 'compare' && (isCeo || (businesses && businesses.length > 1)) && (
          <div className="space-y-4">
            {compareStats.map(biz => (
              <div key={biz.id} className="bg-white rounded-2xl p-4 border border-gray-100">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-base font-bold text-gray-900">{biz.name}</h3>
                  {biz.short_code && (
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">{biz.short_code}</span>
                  )}
                </div>

                {/* Order counts */}
                <div className="grid grid-cols-4 gap-2 mb-3">
                  {[
                    { label: 'Total',     value: biz.totalOrders, color: 'text-gray-900' },
                    { label: 'Delivered', value: biz.delivered,   color: 'text-green-600' },
                    { label: 'Failed',    value: biz.failed,      color: 'text-red-500' },
                    { label: 'Cancelled', value: biz.cancelled,   color: 'text-gray-400' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="text-center p-2 bg-gray-50 rounded-xl">
                      <p className={`text-lg font-bold ${color}`}>{value}</p>
                      <p className="text-xs text-gray-500">{label}</p>
                    </div>
                  ))}
                </div>

                {/* Financials */}
                <div className="space-y-1.5 mb-3">
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Gross Sales</span>
                    <span className="text-sm font-bold text-green-600">{formatCurrency(biz.grossSales)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Expenses</span>
                    <span className="text-sm font-semibold text-red-500">{formatCurrency(biz.totalExpenses)}</span>
                  </div>
                  <div className="flex justify-between border-t border-gray-100 pt-1.5">
                    <span className="text-sm font-semibold text-gray-900">Net Profit</span>
                    <div className="text-right">
                      <span className={`text-sm font-bold ${biz.netProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {formatCurrency(biz.netProfit)}
                      </span>
                      <span className={`text-xs ml-2 ${biz.margin >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {biz.margin.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* Extras */}
                <div className="flex gap-4 text-xs text-gray-500 border-t border-gray-50 pt-2">
                  <div>
                    <span className="text-gray-400">Delivery rate: </span>
                    <span className={`font-semibold ${biz.deliverySuccessRate >= 70 ? 'text-green-600' : 'text-amber-600'}`}>
                      {biz.deliverySuccessRate.toFixed(0)}%
                    </span>
                  </div>
                  {biz.bestProduct && (
                    <div className="flex-1 truncate">
                      <span className="text-gray-400">Best: </span>
                      <span className="font-semibold text-gray-700">{biz.bestProduct.name}</span>
                      <span className="text-gray-400 ml-1">({biz.bestProduct.count})</span>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Combined totals */}
            {compareStats.length > 1 && (
              <div className="bg-gray-900 rounded-2xl p-4 text-white">
                <h3 className="text-sm font-semibold text-gray-300 mb-3">Combined Totals</h3>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Total Orders', value: compareStats.reduce((s, b) => s + b.totalOrders, 0).toString(), color: 'text-white' },
                    { label: 'Gross Sales',  value: formatCurrency(compareStats.reduce((s, b) => s + b.grossSales, 0)),    color: 'text-green-400' },
                    { label: 'Expenses',     value: formatCurrency(compareStats.reduce((s, b) => s + b.totalExpenses, 0)), color: 'text-red-400' },
                    { label: 'Net Profit',   value: formatCurrency(compareStats.reduce((s, b) => s + b.netProfit, 0)),
                      color: compareStats.reduce((s, b) => s + b.netProfit, 0) >= 0 ? 'text-green-400' : 'text-red-400' },
                  ].map(({ label, value, color }) => (
                    <div key={label}>
                      <p className="text-xs text-gray-400">{label}</p>
                      <p className={`text-base font-bold ${color}`}>{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {compareStats.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-8">No businesses to compare</p>
            )}
          </div>
        )}

        {/* EXPENSES */}
        {tab === 'expenses' && isCeo && (
          <div className="space-y-4">
            <StatCard label="Total Expenses" value={formatCurrency(totalExpenses)} icon={<DollarSign size={20} />} color="red" />
            <div className="bg-white rounded-2xl p-4 border border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">By Type</h3>
              <div className="space-y-2">
                {Object.entries(byExpenseType).sort(([, a], [, b]) => b - a).map(([type, amt]) => (
                  <div key={type} className="flex justify-between py-1.5 border-b border-gray-50 last:border-0">
                    <span className="text-sm text-gray-700 capitalize">{type.replace(/_/g, ' ')}</span>
                    <span className="text-sm font-bold text-gray-900">{formatCurrency(amt)}</span>
                  </div>
                ))}
                {Object.keys(byExpenseType).length === 0 && <p className="text-sm text-gray-400">No expenses</p>}
              </div>
            </div>
          </div>
        )}

        {/* STAFF */}
        {tab === 'staff' && isCeo && (
          <div className="bg-white rounded-2xl p-4 border border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Orders by Staff</h3>
            {(() => {
              const byStaff = {}
              staffOrders.forEach(o => {
                const name = o.staff?.name || o.created_by || 'Unknown'
                const code = o.staff?.staff_code || ''
                if (!byStaff[name]) byStaff[name] = { name, code, total: 0, paid: 0, failed: 0, cancelled: 0 }
                byStaff[name].total++
                if (['paid', 'partially_paid'].includes(o.status)) byStaff[name].paid++
                if (o.status === 'failed_delivery') byStaff[name].failed++
                if (o.status === 'cancelled') byStaff[name].cancelled++
              })
              const rows = Object.values(byStaff).sort((a, b) => b.total - a.total)
              if (rows.length === 0) return <p className="text-sm text-gray-400">No data</p>
              return (
                <div className="space-y-3">
                  {rows.map(s => (
                    <div key={s.name} className="py-2 border-b border-gray-50 last:border-0">
                      <div className="flex justify-between mb-1">
                        <div>
                          <span className="text-sm font-medium text-gray-900">{s.name}</span>
                          {s.code && <span className="ml-1.5 text-xs text-gray-400">{s.code}</span>}
                        </div>
                        <span className="text-sm font-bold text-gray-900">{s.total} orders</span>
                      </div>
                      <div className="flex gap-3 text-xs text-gray-500">
                        <span className="text-green-600">{s.paid} paid</span>
                        <span className="text-red-500">{s.failed} failed</span>
                        <span className="text-gray-400">{s.cancelled} cancelled</span>
                      </div>
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>
        )}

        {/* INVENTORY */}
        {tab === 'inventory' && (
          <div className="space-y-4">
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

            {/* Movements */}
            {(() => {
              const movements = inventoryMovements.data || []
              const totalUnits = movements.reduce((s, m) => s + Number(m.quantity || 0), 0)
              const totalCost  = movements.reduce((s, m) => s + Number(m.total_cost || 0), 0)
              return (
                <div className="bg-white rounded-2xl border border-gray-100">
                  <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-900">Stock In ({dateFrom} – {dateTo})</h3>
                    <span className="text-xs text-gray-400">{movements.length} movements</span>
                  </div>
                  {movements.length > 0 && (
                    <div className="px-4 pb-3 flex gap-4">
                      <div><p className="text-xs text-gray-500">Units received</p><p className="text-base font-bold text-blue-600">{totalUnits}</p></div>
                      <div><p className="text-xs text-gray-500">Total cost</p><p className="text-base font-bold text-gray-900">{formatCurrency(totalCost)}</p></div>
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

            {/* Current stock */}
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
                    <span className={`text-sm font-bold shrink-0 ${item.quantity_available <= 0 ? 'text-red-600' : item.quantity_available <= 5 ? 'text-amber-600' : 'text-green-600'}`}>
                      {item.quantity_available}
                    </span>
                  </div>
                ))}
                {inventoryItems.length === 0 && <p className="text-sm text-gray-400 text-center py-6">No inventory records</p>}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
