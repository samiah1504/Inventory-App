import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  DollarSign, Plus, ChevronRight, ChevronDown, ChevronUp, Truck, Inbox, Warehouse,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/authStore'
import { useBusinesses } from '../../hooks/useBusinesses'
import { Modal } from '../../components/ui/Modal'
import { formatCurrency, formatDateTime } from '../../utils/format'

const iso = (d) => d.toISOString().split('T')[0]
const todayStr = () => iso(new Date())
const monthStartStr = () => { const d = new Date(); d.setDate(1); return iso(d) }

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}


export function CeoDashboard() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const { data: businesses } = useBusinesses()

  const [showInbox, setShowInbox] = useState(false)
  const [showBiz, setShowBiz] = useState(false)
  const [showActivity, setShowActivity] = useState(false)

  const today = todayStr()
  const monthStart = monthStartStr()

  // ── Today's orders (rows are light; sums computed client-side) ────────────
  const todayOrdersQ = useQuery({
    queryKey: ['ceo_today_orders', today],
    queryFn: async () => {
      const { data } = await supabase.from('orders')
        .select('id, status, total_amount, amount_paid, business_id')
        .gte('created_at', `${today}T00:00:00`)
      return data || []
    },
    staleTime: 30000,
  })

  // ── Attention / inbox counts & rows ───────────────────────────────────────
  const attentionQ = useQuery({
    queryKey: ['ceo_attention', today],
    queryFn: async () => {
      const count = (b) => b.then(r => r.count || 0)
      const rows = (b) => b.then(r => r.data || [], () => [])
      const [
        newC, awaitingC, failedRows, delayedRows, deliveredRows, partialRows,
        feePendingC, returnedRows, cashRows, transfersC, pendingLeaveC,
        activeStaffC, onLeaveRows, unverifiedC, holdingC,
      ] = await Promise.all([
        count(supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'new')),
        count(supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'awaiting_waybill')),
        rows(supabase.from('orders').select('id, business_id').eq('status', 'failed_delivery')),
        rows(supabase.from('orders').select('id, business_id').eq('status', 'processing').lt('planned_delivery_date', today)),
        rows(supabase.from('orders').select('id, business_id, total_amount').eq('status', 'delivered')),
        rows(supabase.from('orders').select('id, business_id, total_amount, amount_paid').eq('status', 'partially_paid')),
        count(supabase.from('orders').select('*', { count: 'exact', head: true }).eq('delivery_fee_pending', true).then(r => r, () => ({ count: 0 }))),
        rows(supabase.from('orders').select('id, return_decision').eq('status', 'returned')),
        rows(supabase.from('orders').select('id, amount_paid, total_amount').gte('paid_at', `${today}T00:00:00`)),
        count(supabase.from('warehouse_transfers').select('*', { count: 'exact', head: true }).eq('status', 'in_transit').then(r => r, () => ({ count: 0 }))),
        count(supabase.from('staff_leave').select('*', { count: 'exact', head: true }).eq('status', 'pending').then(r => r, () => ({ count: 0 }))),
        count(supabase.from('staff_users').select('*', { count: 'exact', head: true }).eq('is_active', true)),
        rows(supabase.from('staff_leave').select('id').eq('status', 'approved').lte('start_date', today).gte('end_date', today)),
        count(supabase.from('products').select('*', { count: 'exact', head: true }).eq('is_verified', false).eq('is_active', true).then(r => r, () => ({ count: 0 }))),
        count(supabase.from('holding_queue').select('*', { count: 'exact', head: true }).in('status', ['holding', 'collected']).then(r => r, () => ({ count: 0 }))),
      ])
      return {
        newC, awaitingC, failedRows, delayedRows, deliveredRows, partialRows,
        feePendingC,
        returnsAwaiting: returnedRows.filter(r => !r.return_decision).length,
        cashToday: cashRows.reduce((s, o) => s + Number(o.amount_paid || 0), 0),
        // Orders whose full payment was recorded today (any order age)
        paidTodayC: cashRows.length,
        transfersC, pendingLeaveC, activeStaffC,
        onLeaveC: onLeaveRows.length,
        unverifiedC,
        holdingC,
      }
    },
    staleTime: 30000,
  })

  // ── Expenses today + pending approvals ────────────────────────────────────
  const expensesQ = useQuery({
    queryKey: ['ceo_expenses_today', today, monthStart],
    queryFn: async () => {
      const { data } = await supabase.from('expenses').select('*').gte('date', monthStart).lte('date', today)
      const all = (data || []).filter(e => e.status !== 'voided')
      return {
        today: all.filter(e => e.date === today).reduce((s, e) => s + Number(e.amount || 0), 0),
        pending: (data || []).filter(e => e.status === 'pending').length,
      }
    },
    staleTime: 30000,
  })

  // ── Inventory health ──────────────────────────────────────────────────────
  const inventoryQ = useQuery({
    queryKey: ['ceo_inventory_health'],
    queryFn: async () => {
      try {
        const { data } = await supabase.from('inventory')
          .select('product_id, quantity_available, low_stock_threshold')
        const byProduct = {}
        for (const r of (data || [])) {
          if (!r.product_id) continue
          if (!byProduct[r.product_id]) byProduct[r.product_id] = { avail: 0, threshold: 5 }
          byProduct[r.product_id].avail += Number(r.quantity_available || 0)
          byProduct[r.product_id].threshold = Math.max(byProduct[r.product_id].threshold, r.low_stock_threshold ?? 5)
        }
        const products = Object.values(byProduct)
        return {
          low: products.filter(p => p.avail > 0 && p.avail <= p.threshold).length,
          out: products.filter(p => p.avail <= 0).length,
        }
      } catch { return { low: 0, out: 0 } }
    },
    staleTime: 60000,
  })

  // ── Recent activity (order timeline is the universal feed) ────────────────
  const activityQ = useQuery({
    queryKey: ['ceo_recent_activity'],
    queryFn: async () => {
      const { data } = await supabase.from('order_timeline')
        .select('id, description, staff_name, created_at')
        .order('created_at', { ascending: false })
        .limit(30)
      return data || []
    },
    staleTime: 30000,
  })

  const a = attentionQ.data
  const exp = expensesQ.data
  const inv = inventoryQ.data
  const loading = attentionQ.isLoading || todayOrdersQ.isLoading

  // ── Derived figures ───────────────────────────────────────────────────────
  const todayRows = todayOrdersQ.data || []
  const ordersToday = todayRows.length
  // Revenue = money actually received, attributed to the day the payment
  // was RECORDED (cash basis, same rule as the Reports page): full
  // payments with paid_at today — whatever day the order was created —
  // plus part-payments on today's orders (partials carry no timestamp)
  const salesToday = (a?.cashToday || 0) + todayRows
    .filter(o => o.status === 'partially_paid')
    .reduce((s, o) => s + (Number(o.amount_paid) || 0), 0)
  const cashToday = a?.cashToday || 0
  const expensesToday = exp?.today || 0
  const netToday = cashToday - expensesToday

  const outstanding =
    (a?.partialRows || []).reduce((s, o) => s + Math.max(0, Number(o.total_amount || 0) - Number(o.amount_paid || 0)), 0) +
    (a?.deliveredRows || []).reduce((s, o) => s + Number(o.total_amount || 0), 0)

  // Business health: attention = failed or delayed orders open right now
  const bizHealth = useMemo(() => {
    const attention = new Map()
    for (const o of [...(a?.failedRows || []), ...(a?.delayedRows || [])]) {
      if (!o.business_id) continue
      if (!attention.has(o.business_id)) attention.set(o.business_id, { failed: 0, delayed: 0 })
    }
    for (const o of (a?.failedRows || [])) if (o.business_id) attention.get(o.business_id).failed++
    for (const o of (a?.delayedRows || [])) if (o.business_id) attention.get(o.business_id).delayed++
    const list = (businesses || []).map(b => ({
      ...b,
      failed: attention.get(b.id)?.failed || 0,
      delayed: attention.get(b.id)?.delayed || 0,
      ordersToday: todayRows.filter(o => o.business_id === b.id).length,
    }))
    return {
      list,
      needsAttention: list.filter(b => b.failed > 0 || b.delayed > 0).length,
      normal: list.filter(b => b.failed === 0 && b.delayed === 0).length,
    }
  }, [businesses, a, todayRows])

  // ── CEO Inbox: every decision waiting for the CEO, one place ─────────────
  const inboxItems = [
    { label: 'Orders awaiting review',   count: a?.newC || 0,            to: '/orders?status=new' },
    { label: 'Failed deliveries',        count: (a?.failedRows || []).length, to: '/orders?status=failed_delivery' },
    { label: 'Returns awaiting decision', count: a?.returnsAwaiting || 0, to: '/orders?status=returned' },
    { label: 'Delivery fees pending',    count: a?.feePendingC || 0,     to: '/orders?status=fee_pending' },
    { label: 'Pending expense approvals', count: exp?.pending || 0,      to: '/accounting' },
    { label: 'Leave requests pending',   count: a?.pendingLeaveC || 0,   to: '/settings/leave-requests' },
    { label: 'Low stock products',       count: inv?.low || 0,           to: '/inventory?filter=low_stock' },
    { label: 'Unverified products',      count: a?.unverifiedC || 0,     to: '/settings/products?tab=unverified' },
    { label: 'Products in holding queue', count: a?.holdingC || 0,       to: '/holding' },
  ]
  const inboxTotal = inboxItems.reduce((s, i) => s + i.count, 0)

  const attentionCards = [
    { label: 'Awaiting Review',   count: a?.newC || 0,                 to: '/orders?status=new' },
    { label: 'Awaiting Waybill',  count: a?.awaitingC || 0,            to: '/orders?status=awaiting_waybill' },
    { label: 'Delayed Deliveries', count: (a?.delayedRows || []).length, to: '/orders?status=processing' },
    { label: 'Failed Deliveries', count: (a?.failedRows || []).length, to: '/orders?status=failed_delivery' },
    { label: 'Delivered — Unpaid', count: (a?.deliveredRows || []).length, to: '/orders?status=delivered' },
    { label: 'Expense Approvals', count: exp?.pending || 0,            to: '/accounting' },
    { label: 'Part Payments',     count: (a?.partialRows || []).length, to: '/orders?status=partially_paid' },
    { label: 'Low Stock',         count: inv?.low || 0,                to: '/inventory?filter=low_stock' },
  ]

  const overviewRows = [
    { label: 'Orders Today',        value: String(ordersToday), to: '/orders' },
    { label: 'Orders Paid Today',   value: String(a?.paidTodayC || 0), to: '/orders?status=paid', color: 'text-green-600' },
    { label: 'Revenue Today (from payments)', value: formatCurrency(salesToday), to: '/reports' },
    { label: 'Cash Collected Today', value: formatCurrency(cashToday), to: '/orders?status=paid', color: 'text-green-600' },
    { label: 'Expenses Today',      value: formatCurrency(expensesToday), to: '/accounting?today=1', color: 'text-red-600' },
    { label: 'Net Today (cash)',    value: formatCurrency(netToday), to: '/reports', color: netToday >= 0 ? 'text-green-600' : 'text-red-600', bold: true },
  ]

  return (
    <div className="overflow-y-auto overflow-x-hidden h-full w-full">
      {/* Header */}
      <div className="bg-gray-900 text-white px-4 pt-12 pb-6">
        <p className="text-yellow-400 text-sm font-medium">{greeting()}</p>
        <h1 className="text-2xl font-bold">{user?.name}</h1>
        <p className="text-gray-400 text-sm mt-0.5">{user?.staff_code} · Executive view</p>
      </div>

      <div className="px-4 -mt-4 space-y-4 pb-8">

        {/* ── 10 → first: CEO Inbox ── */}
        <button onClick={() => setShowInbox(v => !v)}
          className={`w-full rounded-2xl p-4 text-left active:scale-[0.99] transition-all border ${
            inboxTotal > 0 ? 'bg-yellow-400 border-yellow-500' : 'bg-white border-gray-100'
          }`}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <Inbox size={20} className={inboxTotal > 0 ? 'text-gray-900' : 'text-gray-400'} />
              <div>
                <p className={`text-base font-bold ${inboxTotal > 0 ? 'text-gray-900' : 'text-gray-700'}`}>
                  CEO Inbox {loading ? '' : `(${inboxTotal})`}
                </p>
                <p className={`text-xs ${inboxTotal > 0 ? 'text-gray-800' : 'text-gray-400'}`}>
                  {inboxTotal > 0 ? 'Decisions waiting for you' : 'Nothing needs your decision'}
                </p>
              </div>
            </div>
            {showInbox ? <ChevronUp size={18} className="text-gray-700" /> : <ChevronDown size={18} className={inboxTotal > 0 ? 'text-gray-700' : 'text-gray-300'} />}
          </div>
        </button>
        {showInbox && (
          <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-50 -mt-2">
            {inboxItems.filter(i => i.count > 0).length === 0 ? (
              <p className="text-xs text-gray-400 px-4 py-3">All clear — nothing pending.</p>
            ) : inboxItems.filter(i => i.count > 0).map(i => (
              <button key={i.label} onClick={() => navigate(i.to)}
                className="w-full px-4 py-3 flex items-center justify-between gap-2 active:bg-gray-50">
                <span className="text-sm text-gray-800">{i.label}</span>
                <span className="flex items-center gap-1.5">
                  <span className="text-sm font-bold text-gray-900 bg-yellow-100 px-2 py-0.5 rounded-full">{i.count}</span>
                  <ChevronRight size={14} className="text-gray-300" />
                </span>
              </button>
            ))}
          </div>
        )}

        {/* ── 1. Today's Overview ── */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">Today's Overview</h3>
          <div className="divide-y divide-gray-50">
            {overviewRows.map(r => (
              <button key={r.label} onClick={() => navigate(r.to)}
                className="w-full py-2.5 flex items-center justify-between gap-2 active:bg-gray-50">
                <span className={`text-sm ${r.bold ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>{r.label}</span>
                <span className="flex items-center gap-1.5">
                  <span className={`text-sm font-bold ${r.color || 'text-gray-900'}`}>{loading ? '…' : r.value}</span>
                  <ChevronRight size={14} className="text-gray-300" />
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* ── 2. Attention Required — numbers only ── */}
        <div>
          <h3 className="text-sm font-semibold text-gray-900 mb-2 px-1">Attention Required</h3>
          <div className="grid grid-cols-4 gap-2">
            {attentionCards.map(c => (
              <button key={c.label} onClick={() => navigate(c.to)}
                className={`rounded-2xl p-2.5 border text-center active:scale-[0.97] transition-all ${
                  c.count > 0 ? 'bg-white border-amber-200' : 'bg-white border-gray-100'
                }`}>
                <p className={`text-xl font-bold leading-tight ${c.count > 0 ? 'text-amber-600' : 'text-gray-300'}`}>
                  {loading ? '…' : c.count}
                </p>
                <p className="text-[10px] text-gray-500 leading-tight mt-0.5">{c.label}</p>
              </button>
            ))}
          </div>
        </div>

        {/* ── 3. Business Health ── */}
        <button onClick={() => setShowBiz(v => !v)}
          className="w-full bg-white rounded-2xl border border-gray-100 p-4 text-left active:scale-[0.99] transition-all">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-900">Business Health</h3>
            {showBiz ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
          </div>
          <div className="flex gap-4 mt-2">
            <div>
              <p className="text-xl font-bold text-green-600">{bizHealth.normal}</p>
              <p className="text-[11px] text-gray-500">running normally</p>
            </div>
            <div>
              <p className={`text-xl font-bold ${bizHealth.needsAttention > 0 ? 'text-amber-600' : 'text-gray-300'}`}>{bizHealth.needsAttention}</p>
              <p className="text-[11px] text-gray-500">need attention</p>
            </div>
          </div>
        </button>
        {showBiz && (
          <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-50 -mt-2">
            {bizHealth.list.map(b => (
              <div key={b.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-gray-900">{b.name}</p>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                    b.failed > 0 || b.delayed > 0 ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'
                  }`}>
                    {b.failed > 0 || b.delayed > 0 ? 'ATTENTION' : 'NORMAL'}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  {b.ordersToday} order{b.ordersToday !== 1 ? 's' : ''} today
                  {b.failed > 0 ? ` · ${b.failed} failed` : ''}
                  {b.delayed > 0 ? ` · ${b.delayed} delayed` : ''}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* ── 4. Inventory Health ── */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">Inventory Health</h3>
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: 'Low Stock', value: inv?.low || 0, to: '/inventory?filter=low_stock', warn: (inv?.low || 0) > 0 },
              { label: 'Out of Stock', value: inv?.out || 0, to: '/inventory', warn: (inv?.out || 0) > 0, red: true },
              { label: 'In Transit', value: a?.transfersC || 0, to: '/inventory?tab=transfers' },
              { label: 'Holding Queue', value: a?.holdingC || 0, to: '/holding', warn: (a?.holdingC || 0) > 0 },
            ].map(c => (
              <button key={c.label} onClick={() => navigate(c.to)}
                className="rounded-xl bg-gray-50 p-2.5 text-center active:scale-[0.97] transition-all">
                <p className={`text-lg font-bold ${c.warn ? (c.red ? 'text-red-600' : 'text-amber-600') : 'text-gray-900'}`}>
                  {c.value}
                </p>
                <p className="text-[10px] text-gray-500">{c.label}</p>
              </button>
            ))}
          </div>
        </div>

        {/* ── 5. Financial Snapshot ── */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-1">Financial Snapshot</h3>
          <div className="divide-y divide-gray-50">
            {[
              { label: 'Outstanding Customer Payments', value: formatCurrency(outstanding), to: '/orders?status=partially_paid', color: 'text-amber-600' },
              { label: 'Pending Delivery Fees', value: String(a?.feePendingC || 0), to: '/orders?status=fee_pending' },
              { label: 'Cash Received Today', value: formatCurrency(cashToday), to: '/orders?status=paid', color: 'text-green-600' },
            ].map(r => (
              <button key={r.label} onClick={() => navigate(r.to)}
                className="w-full py-2.5 flex items-center justify-between gap-2 active:bg-gray-50">
                <span className="text-sm text-gray-600">{r.label}</span>
                <span className="flex items-center gap-1.5">
                  <span className={`text-sm font-bold ${r.color || 'text-gray-900'}`}>{loading ? '…' : r.value}</span>
                  <ChevronRight size={14} className="text-gray-300" />
                </span>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-gray-400 mt-1.5">Full Profit &amp; Loss lives in Reports.</p>
        </div>

        {/* ── 6. Staff Activity ── */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">Staff</h3>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Active', value: a?.activeStaffC || 0, to: '/settings/staff' },
              { label: 'On Leave Today', value: a?.onLeaveC || 0, to: '/settings/staff' },
              { label: 'Leave Requests', value: a?.pendingLeaveC || 0, to: '/settings/staff', warn: (a?.pendingLeaveC || 0) > 0 },
            ].map(c => (
              <button key={c.label} onClick={() => navigate(c.to)}
                className="rounded-xl bg-gray-50 p-2.5 text-center active:scale-[0.97] transition-all">
                <p className={`text-lg font-bold ${c.warn ? 'text-amber-600' : 'text-gray-900'}`}>{c.value}</p>
                <p className="text-[10px] text-gray-500">{c.label}</p>
              </button>
            ))}
          </div>
        </div>

        {/* ── 7. Recent Activity ── */}
        <div className="bg-white rounded-2xl border border-gray-100">
          <div className="flex items-center justify-between px-4 pt-4 pb-1">
            <h3 className="text-sm font-semibold text-gray-900">Recent Activity</h3>
            <button onClick={() => setShowActivity(true)} className="text-xs text-blue-600 font-medium">
              View All
            </button>
          </div>
          {(activityQ.data || []).length === 0 ? (
            <p className="text-xs text-gray-400 px-4 pb-4">No activity yet</p>
          ) : (
            <div className="divide-y divide-gray-50 pb-1">
              {(activityQ.data || []).slice(0, 5).map(ev => (
                <div key={ev.id} className="px-4 py-2.5">
                  <p className="text-xs text-gray-700 leading-snug">{ev.description}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    {[ev.staff_name, formatDateTime(ev.created_at)].filter(Boolean).join(' · ')}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── 9. Quick Actions ── */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'New Order',  icon: Plus,       to: '/orders/new',       color: 'bg-blue-50 text-blue-600' },
            { label: 'Add Expense', icon: DollarSign, to: '/accounting?add=1', color: 'bg-teal-50 text-teal-600' },
            { label: 'Waybill',    icon: Truck,      to: '/waybill',          color: 'bg-amber-50 text-amber-600' },
            { label: 'Inventory',  icon: Warehouse,  to: '/inventory',        color: 'bg-indigo-50 text-indigo-600' },
          ].map(({ label, icon: Icon, to, color }) => (
            <button key={label} onClick={() => navigate(to)}
              className={`flex flex-col items-center gap-1.5 p-3 rounded-2xl ${color} active:scale-95 transition-all`}>
              <Icon size={18} />
              <span className="text-[10px] font-medium leading-tight">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* View All Activities */}
      <Modal isOpen={showActivity} onClose={() => setShowActivity(false)} title="Recent Activity">
        <div className="space-y-0 divide-y divide-gray-50 max-h-[70vh] overflow-y-auto">
          {(activityQ.data || []).map(ev => (
            <div key={ev.id} className="py-2.5">
              <p className="text-xs text-gray-700 leading-snug">{ev.description}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">
                {[ev.staff_name, formatDateTime(ev.created_at)].filter(Boolean).join(' · ')}
              </p>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  )
}
