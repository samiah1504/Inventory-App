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
  AlertCircle, Download, ChevronDown, ChevronUp, Search, X,
} from 'lucide-react'
import { Select, Input } from '../../components/ui/Input'
import { useBusinesses, useProducts, useWarehouses } from '../../hooks/useBusinesses'

// ─── Constants ───────────────────────────────────────────────────────────────

const REVENUE_STATUSES = ['paid', 'partially_paid']
// Broader set for product-level breakdown: delivered counts as a completed sale
const SOLD_STATUSES = ['delivered', 'paid', 'partially_paid']

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

const DELIVERY_EXP_TYPES = ['delivery', 'logistics', 'shipping', 'dispatch', 'courier']

function buildProductStats(revenueOrders, orderItemRows, allExpenses) {
  const byProduct = {}
  const addItem = (name, qty, revenue, orderId) => {
    const key = (name || 'Unknown').trim()
    if (!byProduct[key]) byProduct[key] = { qty: 0, revenue: 0, orderIds: new Set() }
    byProduct[key].qty     += Number(qty) || 1
    byProduct[key].revenue += Number(revenue) || 0
    if (orderId) byProduct[key].orderIds.add(orderId)
  }

  // Priority 1 — items_data JSONB: always complete, stores correct per-item price
  const coveredByJson = new Set()
  revenueOrders.forEach(o => {
    const fromJson = Array.isArray(o.items_data) && o.items_data.length > 0 ? o.items_data : null
    if (!fromJson) return
    coveredByJson.add(o.id)
    fromJson.forEach(item => {
      const name = (item.product_name || item.name || 'Unknown').trim()
      const rev  = Number(item.total_amount) || (Number(item.unit_price) || 0) * (Number(item.quantity) || 1)
      addItem(name, item.quantity, rev, o.id)
    })
  })

  // Priority 2 — order_items table: only for orders that have no items_data
  const revOrderIds  = new Set(revenueOrders.map(o => o.id))
  const validItems   = orderItemRows.filter(i => revOrderIds.has(i.order_id) && !coveredByJson.has(i.order_id))
  const coveredByTbl = new Set(validItems.map(i => i.order_id))
  validItems.forEach(item => {
    const name = (item.product_name || item.name || 'Unknown').trim()
    const rev  = Number(item.total_amount) || (Number(item.unit_price) || 0) * (Number(item.quantity) || 1)
    addItem(name, item.quantity, rev, item.order_id)
  })

  // Priority 3 — product_name string: last resort so NO order is ever dropped.
  // Multi-product summaries like "Sofa +2 more" attribute the full order
  // revenue to the primary product (better than losing the order entirely).
  revenueOrders.forEach(o => {
    if (coveredByJson.has(o.id) || coveredByTbl.has(o.id)) return
    const name = (o.product_name || 'Unknown').replace(/\s*\+\s*\d+\s*more\s*$/i, '').trim() || 'Unknown'
    const rev  = Number(o.amount_paid) || Number(o.total_amount) || 0
    addItem(name, o.quantity || 1, rev, o.id)
  })

  const totalRevenue    = Object.values(byProduct).reduce((s, p) => s + p.revenue, 0)
  const deliveryExpTotal = allExpenses
    .filter(e => DELIVERY_EXP_TYPES.some(t => (e.expense_type || '').toLowerCase().includes(t)))
    .reduce((s, e) => s + Number(e.amount || 0), 0)
  const otherExpTotal   = allExpenses.reduce((s, e) => s + Number(e.amount || 0), 0) - deliveryExpTotal

  return Object.entries(byProduct).map(([name, s]) => {
    const share          = totalRevenue > 0 ? s.revenue / totalRevenue : 0
    const deliveryExpenses = deliveryExpTotal * share
    const otherExpenses    = otherExpTotal    * share
    const totalExpenses    = deliveryExpenses + otherExpenses
    const grossProfit      = s.revenue - deliveryExpenses
    const netProfit        = s.revenue - totalExpenses
    const margin           = s.revenue > 0 ? (netProfit / s.revenue) * 100 : 0
    return {
      name, qty: s.qty, revenue: s.revenue, orderCount: s.orderIds.size,
      deliveryExpenses, otherExpenses, totalExpenses, grossProfit, netProfit, margin,
    }
  }).sort((a, b) => b.revenue - a.revenue)
}

// Product performance (units/orders only, no financials) — same 3-priority
// item sourcing as buildProductStats, but keeps per-order detail for drill-down.
function buildProductPerformance(soldOrders, orderItemRows) {
  const byProduct = {}
  const addItem = (name, productId, qty, order) => {
    const key = (name || 'Unknown').trim()
    if (!byProduct[key]) byProduct[key] = { name: key, productId: null, qty: 0, orders: new Map(), lastSoldAt: null }
    const p = byProduct[key]
    if (productId && !p.productId) p.productId = productId
    p.qty += Number(qty) || 1
    if (order) {
      const prev = p.orders.get(order.id)
      p.orders.set(order.id, { order, qty: (prev?.qty || 0) + (Number(qty) || 1) })
      if (!p.lastSoldAt || (order.created_at || '') > p.lastSoldAt) p.lastSoldAt = order.created_at
    }
  }

  const ordersById = new Map(soldOrders.map(o => [o.id, o]))

  const coveredByJson = new Set()
  soldOrders.forEach(o => {
    const fromJson = Array.isArray(o.items_data) && o.items_data.length > 0 ? o.items_data : null
    if (!fromJson) return
    coveredByJson.add(o.id)
    fromJson.forEach(item => addItem(item.product_name || item.name, item.product_id, item.quantity, o))
  })

  const validItems   = orderItemRows.filter(i => ordersById.has(i.order_id) && !coveredByJson.has(i.order_id))
  const coveredByTbl = new Set(validItems.map(i => i.order_id))
  validItems.forEach(item => addItem(item.product_name, item.product_id, item.quantity, ordersById.get(item.order_id)))

  soldOrders.forEach(o => {
    if (coveredByJson.has(o.id) || coveredByTbl.has(o.id)) return
    const name = (o.product_name || 'Unknown').replace(/\s*\+\s*\d+\s*more\s*$/i, '').trim() || 'Unknown'
    addItem(name, o.product_id, o.quantity, o)
  })

  return Object.values(byProduct)
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

  const [productSearch, setProductSearch]                   = useState('')
  const [productSort, setProductSort]                       = useState('units')
  const [productCategoryFilter, setProductCategoryFilter]   = useState('')
  const [productFilter, setProductFilter]                   = useState('')
  const [productWarehouseFilter, setProductWarehouseFilter] = useState('')
  const [expandedProduct, setExpandedProduct]               = useState(null)

  const [expSearch, setExpSearch]           = useState('')
  const [expKindFilter, setExpKindFilter]   = useState('')      // '' | 'order' | 'business'
  const [expTypeFilter, setExpTypeFilter]   = useState('')
  const [expStaffFilter, setExpStaffFilter] = useState('')
  const [expSort, setExpSort]               = useState('recent')
  const [expandedExpCat, setExpandedExpCat] = useState(null)

  const { user } = useAuthStore()
  const { data: businesses } = useBusinesses()
  const { data: catalogProducts } = useProducts()
  const { data: warehouses } = useWarehouses()
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
          .select('id, order_number, customer_name, customer_phone, status, state, source, product_id, product_name, quantity, total_amount, amount_paid, balance_amount, created_by, created_at, business_id, items_data')
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
        let q = supabase.from('expenses').select('*, business:businesses(name)')
          .gte('date', dateFrom).lte('date', dateTo)
        if (businessId) q = q.eq('business_id', businessId)
        const { data, error } = await q
        if (error) throw error
        return data || []
      } catch { return [] }
    },
    staleTime: 60000,
  })

  // Orders referenced by order-linked expenses (may fall outside the date range)
  const expenseOrderIds = useMemo(() =>
    Array.from(new Set((expensesReport.data || []).filter(e => e.order_id).map(e => e.order_id)))
  , [expensesReport.data])

  const expenseOrdersQ = useQuery({
    queryKey: ['report_expense_orders', expenseOrderIds],
    enabled: tab === 'expenses' && isCeo && expenseOrderIds.length > 0,
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from('orders')
          .select('id, order_number, customer_name, product_name')
          .in('id', expenseOrderIds)
        if (error) throw error
        return data || []
      } catch { return [] }
    },
    staleTime: 60000,
  })

  const staffListQ = useQuery({
    queryKey: ['report_staff_list'],
    enabled: tab === 'expenses' && isCeo,
    queryFn: async () => {
      try {
        const { data, error } = await supabase.from('staff_users').select('id, name')
        if (error) throw error
        return data || []
      } catch { return [] }
    },
    staleTime: 60000 * 5,
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
    enabled: tab === 'inventory' || tab === 'products',
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

  // Products query — run when tab = products OR sales, orders loaded, and ≤500 orders
  const canQueryItems = (tab === 'products' || tab === 'sales') && ordersReport.isSuccess && (ordersReport.data?.length || 0) > 0 && (ordersReport.data?.length || 0) <= 500
  const productsReport = useQuery({
    queryKey: ['report_products', dateFrom, dateTo, businessId],
    enabled: canQueryItems,
    queryFn: async () => {
      try {
        const soldOrders = (ordersReport.data || []).filter(o => SOLD_STATUSES.includes(o.status))
        const orderIds = soldOrders.map(o => o.id).filter(Boolean)
        if (orderIds.length === 0) return []
        const { data, error } = await supabase
          .from('order_items')
          .select('order_id, product_id, product_name, quantity, unit_price, total_amount')
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

  // ── Expense analytics ─────────────────────────────────────────────────────

  // Enriched + filtered expense list for the Expenses tab
  const expenseData = useMemo(() => {
    const ordersById = new Map((expenseOrdersQ.data || []).map(o => [o.id, o]))
    const staffById  = new Map((staffListQ.data || []).map(s => [s.id, s.name]))

    let list = expenses.map(e => ({
      ...e,
      isOrderExpense: !!e.order_id,
      order: e.order_id ? ordersById.get(e.order_id) || null : null,
      staffName: staffById.get(e.staff_id) || null,
      businessName: e.business?.name || null,
    }))

    if (expSearch) {
      const q = expSearch.toLowerCase()
      list = list.filter(e =>
        (e.expense_type || '').toLowerCase().includes(q) ||
        (e.description || '').toLowerCase().includes(q) ||
        (e.order?.order_number || '').toLowerCase().includes(q))
    }
    if (expKindFilter)  list = list.filter(e => expKindFilter === 'order' ? e.isOrderExpense : !e.isOrderExpense)
    if (expTypeFilter)  list = list.filter(e => e.expense_type === expTypeFilter)
    if (expStaffFilter) list = list.filter(e => e.staff_id === expStaffFilter)

    return list.sort((a, b) => {
      if (expSort === 'high')   return Number(b.amount) - Number(a.amount)
      if (expSort === 'low')    return Number(a.amount) - Number(b.amount)
      if (expSort === 'oldest') return (a.date || '').localeCompare(b.date || '')
      return (b.date || '').localeCompare(a.date || '')
    })
  }, [expenses, expenseOrdersQ.data, staffListQ.data, expSearch, expKindFilter, expTypeFilter, expStaffFilter, expSort])

  // Group filtered expenses by category, split into order-linked vs overhead
  const expenseGroups = useMemo(() => {
    const group = (list) => {
      const m = {}
      list.forEach(e => {
        const t = e.expense_type || 'other'
        if (!m[t]) m[t] = { type: t, total: 0, entries: [], orderIds: new Set() }
        m[t].total += Number(e.amount || 0)
        m[t].entries.push(e)
        if (e.order_id) m[t].orderIds.add(e.order_id)
      })
      return Object.values(m).sort((a, b) => b.total - a.total)
    }
    return {
      order:    group(expenseData.filter(e => e.isOrderExpense)),
      business: group(expenseData.filter(e => !e.isOrderExpense)),
    }
  }, [expenseData])

  const expSummary = useMemo(() => {
    const orderTotal = expenseGroups.order.reduce((s, g) => s + g.total, 0)
    const bizTotal   = expenseGroups.business.reduce((s, g) => s + g.total, 0)
    const paidOrderCount = orders.filter(o => REVENUE_STATUSES.includes(o.status)).length
    return {
      total: orderTotal + bizTotal,
      orderTotal,
      bizTotal,
      avgPerPaidOrder: paidOrderCount > 0 ? orderTotal / paidOrderCount : 0,
    }
  }, [expenseGroups, orders])

  // Combined per-category totals (order + business) for widget + chart
  const expenseCats = useMemo(() => {
    const m = {}
    expenseData.forEach(e => {
      const t = e.expense_type || 'other'
      m[t] = (m[t] || 0) + Number(e.amount || 0)
    })
    return Object.entries(m).map(([type, total]) => ({ type, total }))
      .sort((a, b) => b.total - a.total)
  }, [expenseData])

  // Filter options come from the unfiltered period expenses
  const expTypeOptions = useMemo(() =>
    Array.from(new Set(expenses.map(e => e.expense_type).filter(Boolean))).sort()
  , [expenses])

  const expStaffOptions = useMemo(() => {
    const staffById = new Map((staffListQ.data || []).map(s => [s.id, s.name]))
    const ids = Array.from(new Set(expenses.map(e => e.staff_id).filter(Boolean)))
    return ids.map(id => ({ id, name: staffById.get(id) || 'Unknown' }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [expenses, staffListQ.data])

  // ── Product analytics ─────────────────────────────────────────────────────

  const productStats = useMemo(() => {
    const soldOrders = orders.filter(o => SOLD_STATUSES.includes(o.status))
    return buildProductStats(soldOrders, productsReport.data || [], expenses)
  }, [orders, productsReport.data, expenses])

  // Product performance (units / orders / stock — no financials)
  const productPerf = useMemo(() => {
    const soldOrders = orders.filter(o => SOLD_STATUSES.includes(o.status))
    const catalog  = catalogProducts || []
    const byId     = new Map(catalog.map(p => [p.id, p]))
    const byName   = new Map(catalog.map(p => [p.name.trim().toLowerCase(), p]))
    const bizById  = new Map((businesses || []).map(b => [b.id, b.name]))
    const movements = inventoryMovements.data || []

    return buildProductPerformance(soldOrders, productsReport.data || []).map(p => {
      const cat = (p.productId && byId.get(p.productId)) || byName.get(p.name.toLowerCase()) || null
      const catalogId = cat?.id || p.productId || null

      const matchesProduct = r =>
        catalogId ? r.product_id === catalogId
                  : (r.product?.name || '').trim().toLowerCase() === p.name.toLowerCase()
      const matchesWarehouse = r => !productWarehouseFilter || r.warehouse_id === productWarehouseFilter

      const inv = inventoryItems.filter(r => matchesProduct(r) && matchesWarehouse(r))
      const available = inv.reduce((s, r) => s + Number(r.quantity_available || 0), 0)
      const received  = movements
        .filter(m => matchesProduct(m) && matchesWarehouse(m) && Number(m.quantity) > 0)
        .reduce((s, m) => s + Number(m.quantity || 0), 0)

      const orderRows = Array.from(p.orders.values())
        .sort((a, b) => (b.order.created_at || '').localeCompare(a.order.created_at || ''))
      const firstOrder = orderRows[0]?.order

      return {
        ...p,
        orderCount: p.orders.size,
        orderRows,
        business: cat?.business?.name || bizById.get(firstOrder?.business_id) || '—',
        category: cat?.category?.name || null,
        sku: cat?.sku || cat?.barcode || null,
        hasInventory: inv.length > 0,
        available,
        received,
        opening: available - received + p.qty,
      }
    })
  }, [orders, productsReport.data, catalogProducts, businesses, inventoryItems, inventoryMovements.data, productWarehouseFilter])

  const productCategories = useMemo(() =>
    Array.from(new Set(productPerf.map(p => p.category).filter(Boolean))).sort()
  , [productPerf])

  const filteredSortedProducts = useMemo(() => {
    let list = productPerf
    if (productSearch) {
      const q = productSearch.toLowerCase()
      list = list.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.sku && String(p.sku).toLowerCase().includes(q)))
    }
    if (productCategoryFilter) list = list.filter(p => p.category === productCategoryFilter)
    if (productFilter)         list = list.filter(p => p.name === productFilter)
    return [...list].sort((a, b) => {
      if (productSort === 'name')   return a.name.localeCompare(b.name)
      if (productSort === 'orders') return b.orderCount - a.orderCount
      if (productSort === 'recent') return (b.lastSoldAt || '').localeCompare(a.lastSoldAt || '')
      return b.qty - a.qty
    })
  }, [productPerf, productSearch, productSort, productCategoryFilter, productFilter])

  const prodSummary = useMemo(() => {
    const orderIds = new Set()
    productPerf.forEach(p => p.orders.forEach((_, id) => orderIds.add(id)))
    return {
      units: productPerf.reduce((s, p) => s + p.qty, 0),
      uniqueProducts: productPerf.length,
      orders: orderIds.size,
    }
  }, [productPerf])

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
      const addP = (name, qty) => {
        const clean = (name || '').replace(/\s*\+\s*\d+\s*more\s*$/i, '').trim()
        if (clean) pCounts[clean] = (pCounts[clean] || 0) + (Number(qty) || 1)
      }
      revOrds.forEach(o => {
        const fromJson = Array.isArray(o.items_data) && o.items_data.length > 0 ? o.items_data : null
        if (fromJson) fromJson.forEach(i => addP(i.product_name || i.name, i.quantity))
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
      const rows = expenseData.map(e => ({
        date: e.date, expense_type: e.expense_type, amount: e.amount,
        kind: e.isOrderExpense ? 'order' : 'business',
        business: e.businessName || '', description: e.description || '',
        order_number: e.order?.order_number || '', entered_by: e.staffName || '',
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
      downloadCSV(filteredSortedProducts.map(p => ({
        product_name: p.name, business: p.business, category: p.category || '',
        units_sold: p.qty, order_count: p.orderCount,
        last_sold: p.lastSoldAt?.slice(0, 10) || '',
        available_stock: p.hasInventory ? p.available : '',
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
      downloadXLSX(expenseData.map(e => ({
        Date: e.date, Type: e.expense_type, Amount: e.amount,
        Kind: e.isOrderExpense ? 'Order' : 'Business',
        Business: e.businessName || '', Description: e.description || '',
        'Order #': e.order?.order_number || '', 'Entered By': e.staffName || '',
      })), 'Expenses', `expenses-${dateFrom}-to-${dateTo}.xlsx`)
    } else if (tab === 'products') {
      downloadXLSX(filteredSortedProducts.map(p => ({
        Product: p.name, Business: p.business, Category: p.category || '',
        'Units Sold': p.qty, Orders: p.orderCount,
        'Last Sold': p.lastSoldAt?.slice(0, 10) || '',
        'Available Stock': p.hasInventory ? p.available : '',
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
    <div className="flex flex-col h-full overflow-x-hidden w-full">
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
      <div className="bg-white border-b border-gray-100 px-4 py-3 space-y-2 sticky top-[57px] z-20 w-full overflow-x-hidden">
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
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="flex-1 min-w-0" />
          <Input type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)}   className="flex-1 min-w-0" />
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
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-4">

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
              <div className="divide-y divide-gray-50">
                {Object.entries(byStatus).sort(([, a], [, b]) => b - a).map(([status, count]) => (
                  <div key={status} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
                    <span className="text-sm text-gray-700 capitalize">{status.replace(/_/g, ' ')}</span>
                    <span className="text-sm font-bold text-gray-900">{count}</span>
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
          <div className="space-y-4">

            {/* ── Summary ── */}
            <div className="bg-white rounded-2xl p-4 border border-gray-100 space-y-3">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Period Summary</p>

              {/* Total orders — full-width stat card, no justify-between */}
              <div className="bg-gray-50 rounded-xl px-4 py-3">
                <p className="text-xs text-gray-500 mb-1">Total Orders</p>
                <p className="text-3xl font-bold text-gray-900">{totalOrders}</p>
              </div>

              {/* Status grid — label above value, no horizontal stretching */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Delivered',  key: 'delivered',       color: 'text-green-600'   },
                  { label: 'Paid',       key: 'paid',            color: 'text-emerald-600' },
                  { label: 'Failed',     key: 'failed_delivery', color: 'text-red-500'     },
                  { label: 'Returned',   key: 'returned',        color: 'text-orange-500'  },
                  { label: 'Cancelled',  key: 'cancelled',       color: 'text-gray-400'    },
                ].map(({ label, key, color }) => (
                  <div key={key} className="bg-gray-50 rounded-xl px-2 py-2">
                    <p className="text-xs text-gray-500 mb-0.5 truncate">{label}</p>
                    <p className={`text-lg font-bold ${color}`}>{byStatus[key] || 0}</p>
                  </div>
                ))}
              </div>

              {/* Paid order rate — full-width card, label above value */}
              <div className="bg-blue-50 rounded-xl px-4 py-3">
                <p className="text-xs text-blue-600 mb-1">Paid Order Rate</p>
                <p className="text-2xl font-bold text-blue-700">
                  {totalOrders > 0 ? (((byStatus['paid'] || 0) / totalOrders) * 100).toFixed(1) : '0.0'}%
                </p>
              </div>
            </div>

            {/* ── Orders by State ── */}
            <div className="bg-white rounded-2xl p-4 border border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Orders by State</h3>
              <div className="divide-y divide-gray-50">
                {Object.entries(byState).sort(([, a], [, b]) => b - a).map(([state, count], i) => (
                  <div key={state} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                    <span className="text-xs font-bold text-gray-300 w-4 shrink-0">{i + 1}</span>
                    <span className="text-lg font-bold text-gray-900 w-8 shrink-0">{count}</span>
                    <span className="text-sm text-gray-600 truncate">{state}</span>
                  </div>
                ))}
                {Object.keys(byState).length === 0 && (
                  <p className="text-sm text-gray-400">No orders for this period</p>
                )}
              </div>
            </div>
          </div>
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
                      <div key={state} className="flex items-center gap-2 py-2.5 first:pt-0 last:pb-0">
                        <span className="text-xs font-bold text-gray-300 w-4 shrink-0">{i + 1}</span>
                        <span className="text-sm text-gray-800 flex-1 min-w-0 truncate">{state}</span>
                        <span className="text-sm font-bold text-gray-900 shrink-0">{formatCurrency(amt)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null
            })()}

            {/* Revenue by product — uses the same 3-priority logic as the Products tab */}
            {productStats.length > 0 && (
              <div className="bg-white rounded-2xl p-4 border border-gray-100">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Revenue by Product</h3>
                <div className="divide-y divide-gray-50">
                  {productStats.map((p, i) => (
                    <div key={p.name} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-bold text-gray-300 w-4 shrink-0">{i + 1}</span>
                        <span className="text-sm text-gray-800 truncate">{p.name}</span>
                      </div>
                      <div className="text-right shrink-0 ml-2">
                        <p className="text-sm font-bold text-gray-900">{formatCurrency(p.revenue)}</p>
                        <p className="text-xs text-gray-400">{p.orderCount} order{p.orderCount !== 1 ? 's' : ''}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-white rounded-2xl p-4 border border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Outstanding Balances</h3>
              {outstandingOrders.length === 0 ? (
                <p className="text-sm text-gray-400">No outstanding balances</p>
              ) : (
                <div className="space-y-2">
                  {outstandingOrders.map(o => (
                    <div key={o.order_number} className="flex gap-2 py-1.5 border-b border-gray-50 last:border-0">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-mono text-gray-400 truncate">{o.order_number}</p>
                        <p className="text-sm text-gray-700 truncate">{o.customer_name}</p>
                      </div>
                      <p className="text-sm font-bold text-amber-600 shrink-0">{formatCurrency(o.balance_amount)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* PRODUCTS — Product Performance Report (no financials) */}
        {tab === 'products' && (
          <div className="space-y-4">
            {(productsReport.isLoading && canQueryItems) ? (
              <SkeletonList count={4} />
            ) : (
              <>
                {(ordersReport.data?.length || 0) > 500 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-sm text-amber-800">
                    Over 500 orders — product data sourced from order records.
                  </div>
                )}

                {/* ── Summary cards ── */}
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Units Sold', value: prodSummary.units,          color: 'text-blue-600' },
                    { label: 'Products',   value: prodSummary.uniqueProducts, color: 'text-gray-900' },
                    { label: 'Orders',     value: prodSummary.orders,         color: 'text-green-600' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="bg-white rounded-2xl border border-gray-100 px-3 py-3">
                      <p className="text-xs text-gray-500 mb-0.5 truncate">{label}</p>
                      <p className={`text-xl font-bold ${color}`}>{value}</p>
                    </div>
                  ))}
                </div>

                {/* ── Search ── */}
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  <input
                    type="text"
                    value={productSearch}
                    onChange={e => setProductSearch(e.target.value)}
                    placeholder="Search by name, SKU or barcode…"
                    className="w-full pl-8 pr-8 py-2.5 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-blue-400"
                  />
                  {productSearch && (
                    <button onClick={() => setProductSearch('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 active:scale-95">
                      <X size={14} />
                    </button>
                  )}
                </div>

                {/* ── Filters ── */}
                <div className="grid grid-cols-2 gap-2">
                  <Select value={productCategoryFilter} onChange={e => setProductCategoryFilter(e.target.value)}>
                    <option value="">All Categories</option>
                    {productCategories.map(c => <option key={c} value={c}>{c}</option>)}
                  </Select>
                  <Select value={productFilter} onChange={e => setProductFilter(e.target.value)}>
                    <option value="">All Products</option>
                    {[...productPerf].sort((a, b) => a.name.localeCompare(b.name)).map(p => (
                      <option key={p.name} value={p.name}>{p.name}</option>
                    ))}
                  </Select>
                </div>
                <Select value={productWarehouseFilter} onChange={e => setProductWarehouseFilter(e.target.value)}>
                  <option value="">All Warehouses (stock figures)</option>
                  {(warehouses || []).map(w => <option key={w.id} value={w.id}>{w.name} ({w.state})</option>)}
                </Select>

                {/* ── Sort pills ── */}
                <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
                  {[
                    { key: 'units',  label: 'Units Sold' },
                    { key: 'orders', label: 'Orders' },
                    { key: 'recent', label: 'Recently Sold' },
                    { key: 'name',   label: 'A → Z' },
                  ].map(s => (
                    <button key={s.key} onClick={() => setProductSort(s.key)}
                      className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-all ${
                        productSort === s.key ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'
                      }`}>
                      {s.label}
                    </button>
                  ))}
                </div>

                {/* ── Product list ── */}
                <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                  <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                    <span className="text-xs font-semibold text-gray-500">
                      Products{filteredSortedProducts.length > 0 ? ` · ${filteredSortedProducts.length}` : ''}
                    </span>
                  </div>

                  <div className="divide-y divide-gray-50">
                    {filteredSortedProducts.length === 0 ? (
                      <p className="text-sm text-gray-400 text-center py-10">
                        {productSearch ? `No products matching "${productSearch}"` : 'No products sold in this period'}
                      </p>
                    ) : filteredSortedProducts.map(p => {
                      const isOpen = expandedProduct === p.name
                      return (
                        <div key={p.name}>
                          <button
                            onClick={() => setExpandedProduct(isOpen ? null : p.name)}
                            className="w-full text-left px-4 py-3.5 active:bg-gray-50 transition-colors"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-gray-900 leading-snug">{p.name}</p>
                                <p className="text-xs text-gray-500 mt-0.5 truncate">
                                  {p.business}{p.category ? ` · ${p.category}` : ''}
                                </p>
                                <p className="text-xs text-gray-400 mt-1">
                                  <span className="font-bold text-blue-600">{p.qty}</span> unit{p.qty !== 1 ? 's' : ''} ·{' '}
                                  <span className="font-bold text-gray-700">{p.orderCount}</span> order{p.orderCount !== 1 ? 's' : ''}
                                  {p.hasInventory && <> · <span className="font-bold text-green-600">{p.available}</span> in stock</>}
                                </p>
                              </div>
                              {isOpen
                                ? <ChevronUp size={18} className="text-gray-400 shrink-0" />
                                : <ChevronDown size={18} className="text-gray-400 shrink-0" />}
                            </div>
                          </button>

                          {isOpen && (
                            <div className="px-4 pb-4 space-y-3">
                              {/* Product info */}
                              <div className="bg-gray-50 rounded-xl p-3 space-y-1">
                                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Product Info</p>
                                <p className="text-xs text-gray-600"><span className="text-gray-400">Business: </span>{p.business}</p>
                                <p className="text-xs text-gray-600"><span className="text-gray-400">Category: </span>{p.category || '—'}</p>
                                {p.sku && <p className="text-xs text-gray-600"><span className="text-gray-400">SKU: </span>{p.sku}</p>}
                              </div>

                              {/* Inventory summary */}
                              <div className="bg-gray-50 rounded-xl p-3">
                                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Inventory</p>
                                {p.hasInventory ? (
                                  <div className="grid grid-cols-3 gap-2">
                                    <div>
                                      <p className="text-xs text-gray-400 mb-0.5">Opening (est.)</p>
                                      <p className="text-base font-bold text-gray-900">{p.opening}</p>
                                    </div>
                                    <div>
                                      <p className="text-xs text-gray-400 mb-0.5">Received</p>
                                      <p className="text-base font-bold text-blue-600">{p.received}</p>
                                    </div>
                                    <div>
                                      <p className="text-xs text-gray-400 mb-0.5">Available</p>
                                      <p className={`text-base font-bold ${p.available <= 0 ? 'text-red-600' : p.available <= 5 ? 'text-amber-600' : 'text-green-600'}`}>
                                        {p.available}
                                      </p>
                                    </div>
                                  </div>
                                ) : (
                                  <p className="text-xs text-gray-400">No inventory records for this product</p>
                                )}
                              </div>

                              {/* Orders containing this product */}
                              <div className="bg-gray-50 rounded-xl overflow-hidden">
                                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-3 pt-3 pb-1">
                                  Orders · {p.orderRows.length}
                                </p>
                                <div className="divide-y divide-gray-100">
                                  {p.orderRows.map(({ order, qty }) => (
                                    <div key={order.id} className="px-3 py-2.5">
                                      <div className="flex items-center justify-between gap-2">
                                        <p className="text-xs font-mono text-gray-400 truncate">{order.order_number}</p>
                                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full capitalize shrink-0 status-${order.status}`}>
                                          {(order.status || '').replace(/_/g, ' ')}
                                        </span>
                                      </div>
                                      <div className="flex items-center justify-between gap-2 mt-0.5">
                                        <p className="text-sm text-gray-800 truncate">{order.customer_name}</p>
                                        <p className="text-xs font-semibold text-gray-600 shrink-0">×{qty}</p>
                                      </div>
                                      <p className="text-xs text-gray-400 mt-0.5">{formatDate(order.created_at)}</p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
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
                  <div className="flex justify-between border-t border-gray-700 pt-2">
                    <span className="text-xs text-gray-400">Profit Margin</span>
                    <span className={`text-sm font-bold ${plStats.margin >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {plStats.margin.toFixed(1)}%
                    </span>
                  </div>
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
                <div className="grid grid-cols-2 gap-2 mb-3">
                  {[
                    { label: 'Total Orders', value: biz.totalOrders, color: 'text-gray-900' },
                    { label: 'Delivered',    value: biz.delivered,   color: 'text-green-600' },
                    { label: 'Failed',       value: biz.failed,      color: 'text-red-500' },
                    { label: 'Cancelled',    value: biz.cancelled,   color: 'text-gray-400' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-xl">
                      <p className="text-xs text-gray-500">{label}</p>
                      <p className={`text-base font-bold ${color}`}>{value}</p>
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

        {/* EXPENSES — all money going out, split order vs business */}
        {tab === 'expenses' && isCeo && (
          <div className="space-y-4">

            {/* ── Summary cards ── */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Total Expenses',    value: expSummary.total,           color: 'text-red-600'    },
                { label: 'Order Expenses',    value: expSummary.orderTotal,      color: 'text-amber-600'  },
                { label: 'Business Expenses', value: expSummary.bizTotal,        color: 'text-purple-600' },
                { label: 'Avg / Paid Order',  value: expSummary.avgPerPaidOrder, color: 'text-gray-900'   },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-white rounded-2xl border border-gray-100 p-4">
                  <p className="text-xs text-gray-500 mb-1">{label}</p>
                  <p className={`text-lg font-bold leading-tight ${color}`}>{formatCurrency(value)}</p>
                </div>
              ))}
            </div>

            {/* ── Top expense categories widget ── */}
            {expenseCats.length > 0 && (
              <div className="bg-gray-900 rounded-2xl p-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Top Expense Categories</p>
                <div className="space-y-1.5">
                  {expenseCats.slice(0, 4).map((c, i) => (
                    <div key={c.type} className="flex items-center gap-2">
                      <span className="text-xs font-bold text-gray-500 w-4 shrink-0">{i + 1}</span>
                      <span className="text-sm text-gray-300 capitalize truncate flex-1 min-w-0">{c.type.replace(/_/g, ' ')}</span>
                      <span className="text-sm font-bold text-white shrink-0">{formatCurrency(c.total)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Expenses by category chart ── */}
            {expenseCats.length > 0 && (() => {
              const top       = expenseCats.slice(0, 8)
              const restTotal = expenseCats.slice(8).reduce((s, c) => s + c.total, 0)
              const cats      = restTotal > 0 ? [...top, { type: 'other (combined)', total: restTotal }] : top
              const max       = Math.max(...cats.map(c => c.total), 1)
              return (
                <div className="bg-white rounded-2xl p-4 border border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Expenses by Category</h3>
                  <div className="space-y-3">
                    {cats.map(c => (
                      <div key={c.type}>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-xs text-gray-600 capitalize truncate min-w-0">{c.type.replace(/_/g, ' ')}</span>
                          <span className="text-xs font-semibold text-gray-900 shrink-0">{formatCurrency(c.total)}</span>
                        </div>
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.max((c.total / max) * 100, 2)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}

            {/* ── Search ── */}
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                type="text"
                value={expSearch}
                onChange={e => setExpSearch(e.target.value)}
                placeholder="Search category, order #, description…"
                className="w-full pl-8 pr-8 py-2.5 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-blue-400"
              />
              {expSearch && (
                <button onClick={() => setExpSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 active:scale-95">
                  <X size={14} />
                </button>
              )}
            </div>

            {/* ── Order / Business toggle ── */}
            <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
              {[
                { key: '',         label: 'All' },
                { key: 'order',    label: 'Order' },
                { key: 'business', label: 'Business' },
              ].map(v => (
                <button key={v.key} onClick={() => setExpKindFilter(v.key)}
                  className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
                    expKindFilter === v.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
                  }`}>
                  {v.label}
                </button>
              ))}
            </div>

            {/* ── Category + staff filters ── */}
            <div className="grid grid-cols-2 gap-2">
              <Select value={expTypeFilter} onChange={e => setExpTypeFilter(e.target.value)}>
                <option value="">All Categories</option>
                {expTypeOptions.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
              </Select>
              <Select value={expStaffFilter} onChange={e => setExpStaffFilter(e.target.value)}>
                <option value="">All Staff</option>
                {expStaffOptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </div>

            {/* ── Sort pills ── */}
            <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
              {[
                { key: 'recent', label: 'Most Recent' },
                { key: 'oldest', label: 'Oldest' },
                { key: 'high',   label: 'Highest' },
                { key: 'low',    label: 'Lowest' },
              ].map(s => (
                <button key={s.key} onClick={() => setExpSort(s.key)}
                  className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-all ${
                    expSort === s.key ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'
                  }`}>
                  {s.label}
                </button>
              ))}
            </div>

            {/* ── A. Order expenses ── */}
            {expKindFilter !== 'business' && (
              <ExpenseSection
                title="Order Expenses"
                subtitle="Costs tied to fulfilling customer orders"
                groups={expenseGroups.order}
                showOrderStats
                expandedKey="order"
                expanded={expandedExpCat}
                onToggle={setExpandedExpCat}
              />
            )}

            {/* ── B. Business expenses ── */}
            {expKindFilter !== 'order' && (
              <ExpenseSection
                title="Business Expenses"
                subtitle="General overhead, not tied to orders"
                groups={expenseGroups.business}
                expandedKey="business"
                expanded={expandedExpCat}
                onToggle={setExpandedExpCat}
              />
            )}
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

// ─── Expense report pieces ───────────────────────────────────────────────────

function ExpenseSection({ title, subtitle, groups, showOrderStats, expandedKey, expanded, onToggle }) {
  const total = groups.reduce((s, g) => s + g.total, 0)
  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <div className="px-4 pt-4 pb-3 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        <p className="text-xs text-gray-400">{subtitle}</p>
        <p className="text-lg font-bold text-gray-900 mt-1">{formatCurrency(total)}</p>
      </div>
      <div className="divide-y divide-gray-50">
        {groups.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No expenses in this period</p>
        ) : groups.map(g => {
          const key = `${expandedKey}:${g.type}`
          const isOpen = expanded === key
          return (
            <div key={g.type}>
              <button
                onClick={() => onToggle(isOpen ? null : key)}
                className="w-full text-left px-4 py-3 active:bg-gray-50 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 capitalize truncate">{g.type.replace(/_/g, ' ')}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {showOrderStats
                        ? `${g.orderIds.size} order${g.orderIds.size !== 1 ? 's' : ''} · avg ${formatCurrency(g.orderIds.size > 0 ? g.total / g.orderIds.size : g.total)}/order`
                        : `${g.entries.length} ${g.entries.length !== 1 ? 'entries' : 'entry'}`}
                    </p>
                    <p className="text-base font-bold text-gray-900 mt-0.5">{formatCurrency(g.total)}</p>
                  </div>
                  {isOpen
                    ? <ChevronUp size={18} className="text-gray-400 shrink-0" />
                    : <ChevronDown size={18} className="text-gray-400 shrink-0" />}
                </div>
              </button>
              {isOpen && (
                <div className="px-4 pb-3 space-y-2">
                  {g.entries.map(e => <ExpenseEntry key={e.id} e={e} />)}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ExpenseEntry({ e }) {
  return (
    <div className="bg-gray-50 rounded-xl px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-gray-400">{formatDate(e.date)}</p>
        <p className="text-sm font-bold text-gray-900 shrink-0">{formatCurrency(e.amount)}</p>
      </div>
      {e.description && <p className="text-sm text-gray-700 mt-0.5">{e.description}</p>}
      {(e.businessName || e.staffName) && (
        <p className="text-xs text-gray-400 mt-0.5 truncate">
          {[e.businessName, e.staffName ? `by ${e.staffName}` : null].filter(Boolean).join(' · ')}
        </p>
      )}
      {e.order && (
        <div className="mt-1.5 bg-white rounded-lg px-2.5 py-1.5 border border-gray-100">
          <p className="text-xs font-mono text-gray-500">{e.order.order_number}</p>
          <p className="text-xs text-gray-600 truncate">
            {e.order.customer_name}{e.order.product_name ? ` · ${e.order.product_name}` : ''}
          </p>
        </div>
      )}
      {e.receipt_url && (
        <a href={e.receipt_url} target="_blank" rel="noreferrer"
          className="text-xs text-blue-600 font-medium mt-1.5 inline-block">
          View receipt →
        </a>
      )}
    </div>
  )
}
