import { useState, useMemo } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { Plus, DollarSign, ChevronDown, ChevronUp, Trash2, Pencil, ChevronRight } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { TopBar } from '../../components/layout/TopBar'
import { SearchBar } from '../../components/ui/SearchBar'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { Input, Select, Textarea } from '../../components/ui/Input'
import { SkeletonList } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'
import { useAuthStore } from '../../stores/authStore'
import { useBusinesses } from '../../hooks/useBusinesses'
import { accessFor } from '../../hooks/useStaff'
import { scopeToBusinesses } from '../../lib/businessScope'
import { useAppStore } from '../../stores/appStore'
import { formatCurrency, formatDate, formatDateTime } from '../../utils/format'

// ─── Constants ───────────────────────────────────────────────────────────────

const EXPENSE_TYPES = [
  'delivery', 'installation', 'offloading', 'waybill',
  'supplier_payment', 'rent', 'salary', 'ads', 'electricity',
  'fuel', 'office', 'marketing', 'misc', 'other',
]

const ADMIN_ONLY_TYPES = [
  'supplier_payment', 'rent', 'salary', 'ads', 'electricity', 'fuel', 'office', 'marketing',
]

const PAYMENT_METHODS = [
  { value: 'cash',          label: 'Cash' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'card',          label: 'Card' },
  { value: 'pos',           label: 'POS' },
  { value: 'other',         label: 'Other' },
]

const SORTS = [
  { value: 'newest',  label: 'Newest' },
  { value: 'oldest',  label: 'Oldest' },
  { value: 'highest', label: 'Highest Amount' },
  { value: 'lowest',  label: 'Lowest Amount' },
]

const typeLabel = (t) => (t || '').replace(/_/g, ' ')
const iso = (d) => d.toISOString().split('T')[0]

const EMPTY_FORM = {
  business_id: '', expense_type: 'misc', amount: '', description: '',
  date: new Date().toISOString().split('T')[0], notes: '',
  paid_to: '', payment_method: 'cash',
}

const DEFAULT_FILTERS = () => {
  const d = new Date(); d.setDate(1)
  return {
    search: '', dateFrom: iso(d), dateTo: iso(new Date()),
    business: '', category: '', status: '', staff: '', method: '', state: '',
    sort: 'newest',
  }
}

// Enrich expense rows with their linked order (number, customer, state…)
async function fetchExpensesWithOrders({ from, to, isCeo, businessId, user }) {
  let q = supabase.from('expenses').select('*, business:businesses(name)')
    .gte('date', from).lte('date', to)
    .order('date', { ascending: false }).limit(500)
  if (!isCeo) q = q.eq('is_admin_only', false)
  if (businessId) q = q.eq('business_id', businessId)
  q = scopeToBusinesses(q, user)
  const { data, error } = await q
  if (error) throw error
  const rows = data || []
  const orderIds = [...new Set(rows.map(e => e.order_id).filter(Boolean))]
  let orders = {}
  if (orderIds.length > 0) {
    try {
      const { data: os } = await supabase.from('orders')
        .select('id, order_number, customer_name, state, status, total_amount, amount_paid, business_id')
        .in('id', orderIds)
      for (const o of (os || [])) orders[o.id] = o
    } catch { /* orders still render without enrichment */ }
  }
  return rows.map(e => ({ ...e, order: e.order_id ? orders[e.order_id] || null : null }))
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AccountingPage() {
  // Dashboard drill-downs: ?add=1 opens the create form,
  // ?today=1 opens the list pre-filtered to today
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState(searchParams.get('today') ? 'list' : 'overview')
  const [showModal, setShowModal]   = useState(searchParams.get('add') === '1')
  const [editingExp, setEditingExp] = useState(null)
  const [expanded, setExpanded]     = useState(null)
  const [openGroup, setOpenGroup]   = useState('business')
  const [f, setFilters]             = useState(() => {
    const base = DEFAULT_FILTERS()
    if (searchParams.get('today')) {
      const t = iso(new Date())
      return { ...base, dateFrom: t, dateTo: t }
    }
    return base
  })
  const [form, setForm]             = useState(EMPTY_FORM)

  const { user }             = useAuthStore()
  const { data: businesses } = useBusinesses()
  const { showToast }        = useAppStore()
  const queryClient          = useQueryClient()
  const isCeo                = ['ceo', 'super_admin'].includes(user?.role)

  const setF = (patch) => setFilters(prev => ({ ...prev, ...patch }))
  // Every summary card / breakdown row drills into the filtered list
  const drill = (patch) => {
    setFilters({ ...DEFAULT_FILTERS(), ...patch })
    setTab('list')
  }

  const todayISO = iso(new Date())
  const monthStart = useMemo(() => { const d = new Date(); d.setDate(1); return iso(d) }, [])
  const weekStart = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - 6); return iso(d) }, [])
  const overviewFrom = weekStart < monthStart ? weekStart : monthStart

  // ── Queries ───────────────────────────────────────────────────────────────

  // Overview: this month + trailing 7 days, fixed scope
  const overviewQ = useQuery({
    queryKey: ['expenses_overview', overviewFrom, todayISO, isCeo, user?.id],
    queryFn: () => fetchExpensesWithOrders({ from: overviewFrom, to: todayISO, isCeo, user }),
    staleTime: 30000,
  })

  // List: driven by the filter bar
  const listQ = useQuery({
    queryKey: ['expenses', f.dateFrom, f.dateTo, isCeo, f.business, user?.id],
    queryFn: () => fetchExpensesWithOrders({ from: f.dateFrom, to: f.dateTo, isCeo, businessId: f.business, user }),
    staleTime: 30000,
  })

  const staffQ = useQuery({
    queryKey: ['expense_staff_names'],
    queryFn: async () => {
      try {
        const { data, error } = await supabase.from('staff_users').select('*')
        if (error) throw error
        const list = (data || []).map(s => ({
          id: s.id,
          name: s.is_deleted ? `${s.name} (Former Staff)` : s.name,
          is_deleted: !!s.is_deleted,
        }))
        return { list, map: new Map(list.map(s => [s.id, s.name])) }
      } catch { return { list: [], map: new Map() } }
    },
    staleTime: 60000 * 5,
  })
  const staffName = (e) => (e.staff_id && staffQ.data?.map.get(e.staff_id)) || e.created_by_name || null

  // ── Save / delete (unchanged mechanics) ───────────────────────────────────

  const saveExpense = useMutation({
    mutationFn: async (data) => {
      const isAdminType = ADMIN_ONLY_TYPES.includes(data.expense_type)
      const core = {
        business_id: data.business_id,
        expense_type: data.expense_type,
        amount: Number(data.amount),
        description: data.description || null,
        date: data.date,
        notes: data.notes || null,
        is_admin_only: isAdminType,
        category: isAdminType ? 'admin' : 'operational',
      }
      if (editingExp) {
        const { error } = await supabase.from('expenses').update(core).eq('id', editingExp.id)
        if (error) throw error
        await supabase.from('expenses').update({
          paid_to: data.paid_to || null,
          payment_method: data.payment_method || null,
          last_edited_by: user?.name || null,
          last_edited_at: new Date().toISOString(),
        }).eq('id', editingExp.id)
      } else {
        const { data: created, error } = await supabase.from('expenses')
          .insert({ ...core, staff_id: user?.id }).select('id').single()
        if (error) throw error
        if (created) {
          await supabase.from('expenses').update({
            paid_to: data.paid_to || null,
            payment_method: data.payment_method || null,
            created_by_name: user?.name || null,
          }).eq('id', created.id)
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] })
      queryClient.invalidateQueries({ queryKey: ['expenses_overview'] })
      showToast(editingExp ? 'Expense updated' : 'Expense added', 'success')
      setShowModal(false)
      setEditingExp(null)
      setForm(EMPTY_FORM)
    },
    onError: (err) => showToast(err.message, 'error'),
  })

  const deleteExpense = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('expenses').delete().eq('id', id)
      if (error) throw error
      const { data: still } = await supabase.from('expenses').select('id').eq('id', id).limit(1)
      if (still && still.length > 0) throw new Error('The database blocked the delete')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] })
      queryClient.invalidateQueries({ queryKey: ['expenses_overview'] })
      showToast('Expense deleted', 'success')
    },
    onError: (err) => showToast(err.message, 'error'),
  })

  // ── Overview aggregates ───────────────────────────────────────────────────

  const ov = useMemo(() => {
    const rows = overviewQ.data || []
    const active = rows.filter(e => e.status !== 'voided')
    const monthRows = active.filter(e => (e.date || '') >= monthStart)
    const sum = (l) => l.reduce((s, e) => s + Number(e.amount || 0), 0)

    const group = (getKey, getLabel) => {
      const m = {}
      for (const e of monthRows) {
        const key = getKey(e)
        if (!key) continue
        if (!m[key]) m[key] = { key, label: getLabel(e), total: 0, count: 0 }
        m[key].total += Number(e.amount || 0)
        m[key].count++
      }
      return Object.values(m).sort((a, b) => b.total - a.total)
    }

    // Staff leaderboard: today + this month per person
    const staffMap = {}
    for (const e of active) {
      const id = e.staff_id
      if (!id) continue
      if (!staffMap[id]) staffMap[id] = { id, today: 0, month: 0 }
      if (e.date === todayISO) staffMap[id].today += Number(e.amount || 0)
      if ((e.date || '') >= monthStart) staffMap[id].month += Number(e.amount || 0)
    }

    // Order-linked expenses grouped by order
    const orderMap = {}
    for (const e of monthRows.filter(x => x.order_id)) {
      if (!orderMap[e.order_id]) orderMap[e.order_id] = { order: e.order, total: 0, byType: {}, order_id: e.order_id }
      orderMap[e.order_id].total += Number(e.amount || 0)
      orderMap[e.order_id].byType[e.expense_type] =
        (orderMap[e.order_id].byType[e.expense_type] || 0) + Number(e.amount || 0)
    }

    return {
      today: sum(active.filter(e => e.date === todayISO)),
      week: sum(active.filter(e => (e.date || '') >= weekStart)),
      month: sum(monthRows),
      records: monthRows.length,
      pending: rows.filter(e => e.status === 'pending' && (e.date || '') >= monthStart).length,
      voided: rows.filter(e => e.status === 'voided' && (e.date || '') >= monthStart).length,
      byBusiness: group(e => e.business_id, e => e.business?.name || 'No business'),
      byCategory: group(e => e.expense_type, e => typeLabel(e.expense_type)),
      byStaff:    group(e => e.staff_id, e => e.staff_id),
      byState:    group(e => e.order?.state || 'General (no order)', e => e.order?.state || 'General (no order)'),
      leaderboard: Object.values(staffMap).sort((a, b) => b.month - a.month),
      orderExpenses: Object.values(orderMap).sort((a, b) => b.total - a.total).slice(0, 20),
    }
  }, [overviewQ.data, monthStart, weekStart, todayISO])

  // ── Filtered + sorted list ────────────────────────────────────────────────

  const list = useMemo(() => {
    let l = listQ.data || []
    if (f.category) l = l.filter(e => e.expense_type === f.category)
    if (f.status === 'active')  l = l.filter(e => e.status !== 'voided' && e.status !== 'pending')
    if (f.status === 'voided')  l = l.filter(e => e.status === 'voided')
    if (f.status === 'pending') l = l.filter(e => e.status === 'pending')
    if (f.staff)  l = l.filter(e => e.staff_id === f.staff)
    if (f.method) l = l.filter(e => e.payment_method === f.method)
    if (f.state)  l = l.filter(e => (e.order?.state || 'General (no order)') === f.state)
    if (f.search) {
      const q = f.search.toLowerCase()
      l = l.filter(e =>
        (e.description || '').toLowerCase().includes(q) ||
        (e.business?.name || '').toLowerCase().includes(q) ||
        typeLabel(e.expense_type).toLowerCase().includes(q) ||
        (staffName(e) || '').toLowerCase().includes(q) ||
        (e.paid_to || '').toLowerCase().includes(q) ||
        (e.order?.order_number || '').toLowerCase().includes(q) ||
        (e.order?.customer_name || '').toLowerCase().includes(q))
    }
    const sorted = [...l]
    if (f.sort === 'newest')  sorted.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    if (f.sort === 'oldest')  sorted.sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    if (f.sort === 'highest') sorted.sort((a, b) => Number(b.amount) - Number(a.amount))
    if (f.sort === 'lowest')  sorted.sort((a, b) => Number(a.amount) - Number(b.amount))
    return sorted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listQ.data, f, staffQ.data])

  const listActive = list.filter(e => e.status !== 'voided')
  const listTotal = listActive.reduce((s, e) => s + Number(e.amount || 0), 0)

  const availableStates = useMemo(() =>
    [...new Set((listQ.data || []).map(e => e.order?.state || 'General (no order)'))].sort()
  , [listQ.data])

  function openEdit(exp) {
    setForm({
      business_id: exp.business_id || '',
      expense_type: exp.expense_type || 'misc',
      amount: String(exp.amount ?? ''),
      description: exp.description || '',
      date: exp.date || iso(new Date()),
      notes: exp.notes || '',
      paid_to: exp.paid_to || '',
      payment_method: exp.payment_method || 'cash',
    })
    setEditingExp(exp)
    setShowModal(true)
  }

  if (!accessFor(user).includes('accounting')) return <Navigate to="/my-expenses" replace />

  const summaryCards = [
    { label: 'Today',      value: ov.today, money: true,  drill: { dateFrom: todayISO, dateTo: todayISO } },
    { label: 'This Week',  value: ov.week,  money: true,  drill: { dateFrom: weekStart, dateTo: todayISO } },
    { label: 'This Month', value: ov.month, money: true,  drill: { dateFrom: monthStart, dateTo: todayISO } },
    { label: 'Records',    value: ov.records,             drill: { dateFrom: monthStart, dateTo: todayISO } },
    { label: 'Pending',    value: ov.pending,             drill: { dateFrom: monthStart, dateTo: todayISO, status: 'pending' } },
    { label: 'Voided',     value: ov.voided,              drill: { dateFrom: monthStart, dateTo: todayISO, status: 'voided' } },
  ]

  const breakdowns = [
    { key: 'business', title: 'By Business', rows: ov.byBusiness, toDrill: r => ({ business: r.key }) },
    { key: 'category', title: 'By Category', rows: ov.byCategory, toDrill: r => ({ category: r.key }) },
    { key: 'staff',    title: 'By Staff Member', rows: ov.byStaff.map(r => ({ ...r, label: staffQ.data?.map.get(r.key) || 'Unknown staff' })), toDrill: r => ({ staff: r.key }) },
    { key: 'state',    title: 'By State (from linked orders)', rows: ov.byState, toDrill: r => ({ state: r.key }) },
  ]

  return (
    <div className="flex flex-col h-full overflow-x-hidden w-full">
      <TopBar
        title="Expenses"
        actions={
          <button
            onClick={() => { setEditingExp(null); setForm(EMPTY_FORM); setShowModal(true) }}
            className="p-2 bg-blue-600 text-white rounded-xl active:scale-95"
          >
            <Plus size={20} />
          </button>
        }
      />

      {/* Tabs */}
      <div className="px-4 pt-3 pb-2 bg-white border-b border-gray-100 sticky top-[57px] z-20">
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
          {[{ key: 'overview', label: 'Overview' }, { key: 'list', label: 'All Expenses' }].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
                tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ═══ OVERVIEW ═══ */}
      {tab === 'overview' && (
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-4">
          {overviewQ.isLoading ? <SkeletonList count={5} /> : (
            <>
              {/* 1. Expense summary — every card drills down */}
              <div className="grid grid-cols-3 gap-2">
                {summaryCards.map(c => (
                  <button key={c.label} onClick={() => drill(c.drill)}
                    className="bg-white rounded-2xl p-3 border border-gray-100 text-left active:scale-[0.98] transition-all">
                    <p className="text-[11px] text-gray-500">{c.label}</p>
                    <p className={`font-bold leading-tight ${c.money ? 'text-sm text-red-600' : 'text-lg text-gray-900'}`}>
                      {c.money ? formatCurrency(c.value) : c.value}
                    </p>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 -mt-2">
                This month · tap any figure to see the expenses behind it. P&amp;L lives in Reports.
              </p>

              {/* 2. Spending breakdown */}
              {breakdowns.map(b => (
                <div key={b.key} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                  <button onClick={() => setOpenGroup(openGroup === b.key ? null : b.key)}
                    className="w-full px-4 py-3 flex items-center justify-between active:bg-gray-50">
                    <span className="text-sm font-semibold text-gray-900">{b.title}</span>
                    {openGroup === b.key ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                  </button>
                  {openGroup === b.key && (
                    <div className="border-t border-gray-50">
                      {b.rows.length === 0 ? (
                        <p className="text-xs text-gray-400 px-4 py-3">No expenses this month</p>
                      ) : b.rows.map(r => (
                        <button key={r.key} onClick={() => drill(b.toDrill(r))}
                          className="w-full px-4 py-2.5 flex items-center justify-between gap-2 active:bg-gray-50 border-b border-gray-50 last:border-0">
                          <span className="text-sm text-gray-700 capitalize truncate">{r.label}</span>
                          <span className="flex items-center gap-1.5 shrink-0">
                            <span className="text-[11px] text-gray-400">{r.count}×</span>
                            <span className="text-sm font-bold text-gray-900">{formatCurrency(r.total)}</span>
                            <ChevronRight size={14} className="text-gray-300" />
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {/* 3. Staff spending leaderboard */}
              <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                <div className="px-4 pt-3 pb-2">
                  <h3 className="text-sm font-semibold text-gray-900">Staff Spending</h3>
                </div>
                {ov.leaderboard.length === 0 ? (
                  <p className="text-xs text-gray-400 px-4 pb-4">No staff expenses this month</p>
                ) : (
                  <div className="divide-y divide-gray-50">
                    {ov.leaderboard.map(s => (
                      <button key={s.id} onClick={() => drill({ staff: s.id })}
                        className="w-full px-4 py-3 flex items-center justify-between gap-2 active:bg-gray-50">
                        <div className="min-w-0 text-left">
                          <p className="text-sm font-semibold text-gray-900 truncate">
                            {staffQ.data?.map.get(s.id) || 'Unknown staff'}
                          </p>
                          <p className="text-xs text-gray-500">Today: {formatCurrency(s.today)}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-bold text-red-600">{formatCurrency(s.month)}</p>
                          <p className="text-[11px] text-gray-400">this month</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 4. Order expenses */}
              <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                <div className="px-4 pt-3 pb-2">
                  <h3 className="text-sm font-semibold text-gray-900">Order Expenses</h3>
                  <p className="text-[11px] text-gray-400">Expenses attached to customer orders this month</p>
                </div>
                {ov.orderExpenses.length === 0 ? (
                  <p className="text-xs text-gray-400 px-4 pb-4">No order-linked expenses this month</p>
                ) : (
                  <div className="divide-y divide-gray-50">
                    {ov.orderExpenses.map(oe => {
                      const o = oe.order
                      const paidRevenue = o && ['paid', 'partially_paid'].includes(o.status)
                        ? Number(o.amount_paid || o.total_amount || 0) : null
                      return (
                        <button key={oe.order_id}
                          onClick={() => drill({ search: o?.order_number || '' })}
                          className="w-full px-4 py-3 text-left active:bg-gray-50">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-mono text-gray-500">{o?.order_number || 'Unknown order'}</span>
                            <span className="text-sm font-bold text-red-600 shrink-0">{formatCurrency(oe.total)}</span>
                          </div>
                          <p className="text-sm font-medium text-gray-900 truncate">{o?.customer_name || '—'}</p>
                          <p className="text-xs text-gray-500 capitalize truncate">
                            {Object.entries(oe.byType).map(([t, amt]) => `${typeLabel(t)} ${formatCurrency(amt)}`).join(' · ')}
                          </p>
                          {paidRevenue !== null && (
                            <p className={`text-xs mt-0.5 font-medium ${paidRevenue - oe.total >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              Collected {formatCurrency(paidRevenue)} − expenses = {formatCurrency(paidRevenue - oe.total)}
                            </p>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══ ALL EXPENSES ═══ */}
      {tab === 'list' && (
        <>
          <div className="px-4 py-3 bg-white border-b border-gray-100 space-y-2">
            <SearchBar value={f.search} onChange={v => setF({ search: v })}
              placeholder="Search title, staff, order #, customer, business..." />
            <div className="flex gap-2">
              <Input type="date" value={f.dateFrom} onChange={e => setF({ dateFrom: e.target.value })} className="flex-1 min-w-0" />
              <Input type="date" value={f.dateTo} onChange={e => setF({ dateTo: e.target.value })} className="flex-1 min-w-0" />
            </div>
            <div className="flex gap-2">
              <div className="flex-1 min-w-0">
                <Select value={f.business} onChange={e => setF({ business: e.target.value })}>
                  <option value="">All Businesses</option>
                  {(businesses || []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Select>
              </div>
              <div className="flex-1 min-w-0">
                <Select value={f.category} onChange={e => setF({ category: e.target.value })}>
                  <option value="">All Categories</option>
                  {EXPENSE_TYPES.filter(t => isCeo || !ADMIN_ONLY_TYPES.includes(t)).map(t => (
                    <option key={t} value={t}>{typeLabel(t)}</option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="flex gap-2">
              <div className="flex-1 min-w-0">
                <Select value={f.staff} onChange={e => setF({ staff: e.target.value })}>
                  <option value="">All Staff</option>
                  {(staffQ.data?.list || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </div>
              <div className="flex-1 min-w-0">
                <Select value={f.state} onChange={e => setF({ state: e.target.value })}>
                  <option value="">All States</option>
                  {availableStates.map(s => <option key={s} value={s}>{s}</option>)}
                </Select>
              </div>
            </div>
            <div className="flex gap-2">
              <div className="flex-1 min-w-0">
                <Select value={f.method} onChange={e => setF({ method: e.target.value })}>
                  <option value="">All Methods</option>
                  {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </Select>
              </div>
              <div className="flex-1 min-w-0">
                <Select value={f.status} onChange={e => setF({ status: e.target.value })}>
                  <option value="">All Status</option>
                  <option value="active">Active</option>
                  <option value="pending">Pending</option>
                  <option value="voided">Voided</option>
                </Select>
              </div>
              <div className="flex-1 min-w-0">
                <Select value={f.sort} onChange={e => setF({ sort: e.target.value })}>
                  {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </Select>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">{list.length} record{list.length !== 1 ? 's' : ''}</p>
              <p className="text-xs font-bold text-red-600">{formatCurrency(listTotal)}</p>
            </div>

            {listQ.isLoading ? <SkeletonList count={5} /> :
             list.length === 0 ? (
               <EmptyState
                 title="No expenses found for the selected filters."
                 icon={<DollarSign size={28} />}
                 action={() => { setEditingExp(null); setForm(EMPTY_FORM); setShowModal(true) }}
                 actionLabel="Add Expense"
               />
             ) : list.map(exp => {
               const voided = exp.status === 'voided'
               const isOpen = expanded === exp.id
               return (
                 <div key={exp.id} className={`bg-white rounded-2xl border border-gray-100 overflow-hidden ${voided ? 'opacity-60' : ''}`}>
                   <button onClick={() => setExpanded(isOpen ? null : exp.id)}
                     className="w-full text-left p-4 active:bg-gray-50 transition-colors">
                     <div className="flex items-start justify-between gap-2">
                       <div className="flex-1 min-w-0">
                         <div className="flex items-center gap-2 flex-wrap mb-0.5">
                           <p className={`text-sm font-semibold text-gray-900 ${voided ? 'line-through' : ''}`}>
                             {exp.description || <span className="capitalize">{typeLabel(exp.expense_type)}</span>}
                           </p>
                           {exp.is_admin_only && (
                             <span className="text-[10px] font-semibold bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">ADMIN</span>
                           )}
                           <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                             voided ? 'bg-gray-200 text-gray-600'
                             : exp.status === 'pending' ? 'bg-amber-50 text-amber-700'
                             : 'bg-green-50 text-green-700'
                           }`}>
                             {voided ? 'VOIDED' : exp.status === 'pending' ? 'PENDING' : 'ACTIVE'}
                           </span>
                         </div>
                         <p className="text-xs text-gray-500 capitalize truncate">
                           {[exp.business?.name, typeLabel(exp.expense_type),
                             exp.order?.order_number, formatDate(exp.date)].filter(Boolean).join(' · ')}
                         </p>
                       </div>
                       <div className="flex items-center gap-1.5 shrink-0">
                         <p className={`text-base font-bold ${voided ? 'text-gray-400 line-through' : 'text-red-600'}`}>
                           {formatCurrency(exp.amount)}
                         </p>
                         {isOpen ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                       </div>
                     </div>
                   </button>

                   {isOpen && (
                     <div className="px-4 pb-4 space-y-3">
                       <div className="bg-gray-50 rounded-xl p-3 grid grid-cols-2 gap-2">
                         {[
                           ['Linked Order', exp.order ? `${exp.order.order_number} — ${exp.order.customer_name}` : null],
                           ['State', exp.order?.state],
                           ['Paid To', exp.paid_to],
                           ['Payment Method', PAYMENT_METHODS.find(m => m.value === exp.payment_method)?.label || exp.payment_method],
                           ['Created By', staffName(exp)],
                           ['Approved By', exp.approved_by],
                           ['Date & Time', exp.created_at ? formatDateTime(exp.created_at) : formatDate(exp.date)],
                         ].filter(([, v]) => v).map(([label, value]) => (
                           <div key={label}>
                             <p className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</p>
                             <p className="text-xs font-semibold text-gray-800 break-words">{value}</p>
                           </div>
                         ))}
                       </div>
                       {exp.notes && <p className="text-xs text-gray-600"><span className="text-gray-400">Notes: </span>{exp.notes}</p>}
                       {voided && (exp.void_reason || exp.voided_by) && (
                         <p className="text-xs text-gray-500">
                           Voided{exp.voided_by ? ` by ${exp.voided_by}` : ''}{exp.void_reason ? `: ${exp.void_reason}` : ''}
                         </p>
                       )}
                       {exp.last_edited_by && (
                         <p className="text-[11px] text-gray-400">
                           Edited by {exp.last_edited_by}{exp.last_edited_at ? ` · ${formatDate(exp.last_edited_at)}` : ''}
                         </p>
                       )}
                       {isCeo && (
                         <div className="flex gap-2">
                           {!voided && (
                             <Button size="sm" variant="secondary" className="flex-1" onClick={() => openEdit(exp)}>
                               <span className="flex items-center justify-center gap-1.5"><Pencil size={13} /> Edit</span>
                             </Button>
                           )}
                           <Button size="sm" variant="danger" className="flex-1"
                             loading={deleteExpense.isPending}
                             onClick={() => {
                               if (window.confirm('Permanently delete this expense? This cannot be undone.')) {
                                 deleteExpense.mutate(exp.id)
                               }
                             }}>
                             <span className="flex items-center justify-center gap-1.5"><Trash2 size={13} /> Delete</span>
                           </Button>
                         </div>
                       )}
                     </div>
                   )}
                 </div>
               )
             })}
          </div>
        </>
      )}

      {/* ── Add / Edit Expense Modal ── */}
      <Modal
        isOpen={showModal}
        onClose={() => { setShowModal(false); setEditingExp(null) }}
        title={editingExp ? 'Edit Expense' : 'Add Expense'}
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => { setShowModal(false); setEditingExp(null) }} className="flex-1">Cancel</Button>
            <Button
              onClick={() => saveExpense.mutate(form)}
              loading={saveExpense.isPending}
              className="flex-1"
              disabled={!form.business_id || !form.amount}
            >
              {editingExp ? 'Save Changes' : 'Add'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input label="Expense Title" placeholder="What was this expense for?"
            value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          <Select label="Business" required value={form.business_id} onChange={e => setForm({ ...form, business_id: e.target.value })}>
            <option value="">Select business...</option>
            {(businesses || []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
          <Select label="Category" required value={form.expense_type} onChange={e => setForm({ ...form, expense_type: e.target.value })}>
            {EXPENSE_TYPES
              .filter(t => isCeo || !ADMIN_ONLY_TYPES.includes(t))
              .map(t => <option key={t} value={t}>{typeLabel(t)}</option>)
            }
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Amount (₦)" type="number" inputMode="decimal" required
              value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })}
            />
            <Input
              label="Date" type="date"
              value={form.date} onChange={e => setForm({ ...form, date: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Paid To" placeholder="Person or company"
              value={form.paid_to} onChange={e => setForm({ ...form, paid_to: e.target.value })} />
            <Select label="Payment Method" value={form.payment_method}
              onChange={e => setForm({ ...form, payment_method: e.target.value })}>
              {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </Select>
          </div>
          <Textarea
            label="Notes" rows={2}
            value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
          />
        </div>
      </Modal>
    </div>
  )
}
