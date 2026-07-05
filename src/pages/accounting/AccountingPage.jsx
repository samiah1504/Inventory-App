import { useState, useMemo } from 'react'
import { Plus, DollarSign, ChevronDown, ChevronUp, TrendingUp } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { TopBar } from '../../components/layout/TopBar'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { Input, Select, Textarea } from '../../components/ui/Input'
import { SkeletonList } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'
import { useAuthStore } from '../../stores/authStore'
import { useBusinesses } from '../../hooks/useBusinesses'
import { useAppStore } from '../../stores/appStore'
import { formatCurrency, formatDate } from '../../utils/format'

// ─── Constants ───────────────────────────────────────────────────────────────

const REVENUE_STATUSES = ['paid', 'partially_paid']

const EXPENSE_TYPES = [
  'delivery', 'installation', 'offloading', 'waybill',
  'supplier_payment', 'rent', 'salary', 'ads', 'electricity',
  'fuel', 'office', 'marketing', 'misc', 'other',
]

const ADMIN_ONLY_TYPES = [
  'supplier_payment', 'rent', 'salary', 'ads', 'electricity', 'fuel', 'office', 'marketing',
]

// ─── Component ───────────────────────────────────────────────────────────────

export function AccountingPage() {
  const [showModal, setShowModal]             = useState(false)
  const [showExpenseSummary, setShowExpenseSummary] = useState(false)
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().split('T')[0]
  })
  const [dateTo,   setDateTo]   = useState(new Date().toISOString().split('T')[0])
  const [businessFilter, setBusinessFilter]   = useState('')
  const [form, setForm] = useState({
    business_id: '', expense_type: 'misc', amount: '', description: '',
    date: new Date().toISOString().split('T')[0], notes: '', is_admin_only: false,
  })

  const { user }          = useAuthStore()
  const { data: businesses } = useBusinesses()
  const { showToast }     = useAppStore()
  const queryClient       = useQueryClient()
  const isCeo             = ['ceo', 'super_admin'].includes(user?.role)

  // ── Expenses query ────────────────────────────────────────────────────────

  const { data: expenses, isLoading } = useQuery({
    queryKey: ['expenses', dateFrom, dateTo, isCeo, businessFilter],
    queryFn: async () => {
      let q = supabase.from('expenses').select('*, business:businesses(name)')
        .gte('date', dateFrom).lte('date', dateTo)
        .order('date', { ascending: false }).limit(200)
      if (!isCeo) q = q.eq('is_admin_only', false)
      if (businessFilter) q = q.eq('business_id', businessFilter)
      const { data, error } = await q
      if (error) throw error
      return data || []
    },
    staleTime: 30000,
  })

  // ── Orders query for P&L ──────────────────────────────────────────────────

  const ordersForPL = useQuery({
    queryKey: ['accounting_orders_pl', dateFrom, dateTo, businessFilter],
    queryFn: async () => {
      try {
        let q = supabase
          .from('orders')
          .select('id, total_amount, amount_paid, status, business_id')
          .gte('created_at', `${dateFrom}T00:00:00`)
          .lte('created_at', `${dateTo}T23:59:59`)
        if (businessFilter) q = q.eq('business_id', businessFilter)
        const { data, error } = await q
        if (error) throw error
        return data || []
      } catch { return [] }
    },
    staleTime: 60000,
  })

  // ── Add expense mutation ──────────────────────────────────────────────────

  const addExpense = useMutation({
    mutationFn: async (data) => {
      const isAdminType = ADMIN_ONLY_TYPES.includes(data.expense_type)
      const { error } = await supabase.from('expenses').insert({
        ...data,
        amount: Number(data.amount),
        is_admin_only: isAdminType,
        category: isAdminType ? 'admin' : 'operational',
        staff_id: user?.id,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] })
      queryClient.invalidateQueries({ queryKey: ['accounting_orders_pl'] })
      showToast('Expense added', 'success')
      setShowModal(false)
      setForm({
        business_id: '', expense_type: 'misc', amount: '', description: '',
        date: new Date().toISOString().split('T')[0], notes: '', is_admin_only: false,
      })
    },
    onError: (err) => showToast(err.message, 'error'),
  })

  // ── Derived values ────────────────────────────────────────────────────────

  const expList      = expenses || []
  const orderList    = ordersForPL.data || []

  const totalExpenses  = expList.reduce((s, e) => s + Number(e.amount), 0)
  const adminExpenses  = expList.filter(e =>  e.is_admin_only)
  const opsExpenses    = expList.filter(e => !e.is_admin_only)
  const adminTotal     = adminExpenses.reduce((s, e) => s + Number(e.amount), 0)

  const grossSales = orderList
    .filter(o => REVENUE_STATUSES.includes(o.status))
    .reduce((s, o) => s + Number(o.total_amount || 0), 0)

  const cashCollected = orderList
    .filter(o => ['paid', 'partially_paid'].includes(o.status))
    .reduce((s, o) => s + Number(o.amount_paid || 0), 0)

  const plNetProfit = grossSales - totalExpenses
  const plMargin    = grossSales > 0 ? (plNetProfit / grossSales) * 100 : 0

  // Expense type totals
  const byExpenseType = useMemo(() => {
    const map = {}
    expList.forEach(e => { map[e.expense_type] = (map[e.expense_type] || 0) + Number(e.amount) })
    return Object.entries(map).sort(([, a], [, b]) => b - a)
  }, [expList])

  // Per-business P&L
  const bizPL = useMemo(() => {
    if (!businesses || businesses.length <= 1) return []
    return businesses.map(biz => {
      const bizOrders = orderList.filter(o => o.business_id === biz.id)
      const bizExp    = expList.filter(e => e.business_id === biz.id)
      const sales     = bizOrders.filter(o => REVENUE_STATUSES.includes(o.status)).reduce((s, o) => s + Number(o.total_amount || 0), 0)
      const exp       = bizExp.reduce((s, e) => s + Number(e.amount || 0), 0)
      return { id: biz.id, name: biz.name, short_code: biz.short_code, sales, expenses: exp, profit: sales - exp }
    })
  }, [businesses, orderList, expList])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-x-hidden w-full">
      <TopBar
        title="Expenses"
        actions={
          <button
            onClick={() => setShowModal(true)}
            className="p-2 bg-blue-600 text-white rounded-xl active:scale-95"
          >
            <Plus size={20} />
          </button>
        }
      />

      {/* ── Filters ── */}
      <div className="px-4 py-3 bg-white border-b border-gray-100 sticky top-[57px] z-20 space-y-2">
        <div className="flex gap-2">
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="flex-1 min-w-0" />
          <Input type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)}   className="flex-1 min-w-0" />
        </div>
        {businesses && businesses.length > 1 && (
          <select
            value={businessFilter}
            onChange={e => setBusinessFilter(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Businesses</option>
            {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-4">

        {/* ── P&L Summary ── */}
        <div className="bg-gray-900 rounded-2xl p-4 text-white">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={16} className="text-gray-400" />
            <h3 className="text-sm font-semibold text-gray-300">P&L Summary</h3>
          </div>
          {ordersForPL.isLoading ? (
            <div className="h-20 bg-gray-800 rounded-xl animate-pulse" />
          ) : (
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-gray-300">Gross Sales</span>
                <span className="text-sm font-bold text-green-400">{formatCurrency(grossSales)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-300">Cash Collected</span>
                <span className="text-sm font-semibold text-gray-100">{formatCurrency(cashCollected)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-300">(-) Expenses</span>
                <span className="text-sm font-bold text-red-400">{formatCurrency(totalExpenses)}</span>
              </div>
              <div className="border-t border-gray-700 pt-2">
                <p className="text-xs text-gray-400 mb-0.5">Net Profit</p>
                <p className={`text-lg font-bold ${plNetProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {formatCurrency(plNetProfit)}
                </p>
              </div>
              {grossSales > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-400">Margin</span>
                  <span className={`text-sm font-bold ${plMargin >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {plMargin.toFixed(1)}%
                  </span>
                </div>
              )}
              {/* Margin bar */}
              {grossSales > 0 && (
                <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden mt-1">
                  <div
                    className={`h-full rounded-full ${plNetProfit >= 0 ? 'bg-green-500' : 'bg-red-500'}`}
                    style={{ width: `${Math.min(100, Math.abs(plMargin))}%` }}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Per-business P&L ── */}
        {bizPL.length > 1 && (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-4 pt-3 pb-2">
              <h3 className="text-sm font-semibold text-gray-900">By Business</h3>
            </div>
            <div className="divide-y divide-gray-50">
              {bizPL.map(biz => (
                <div key={biz.id} className="px-4 py-2.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium text-gray-900">{biz.name}</span>
                    {biz.short_code && (
                      <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">{biz.short_code}</span>
                    )}
                  </div>
                  <div className="space-y-1.5">
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
            </div>
          </div>
        )}

        {/* ── Existing summary cards ── */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white rounded-2xl p-4 border border-gray-100">
            <p className="text-xs text-gray-500">Total Expenses</p>
            <p className="text-xl font-bold text-red-600">{formatCurrency(totalExpenses)}</p>
          </div>
          {isCeo && (
            <div className="bg-white rounded-2xl p-4 border border-gray-100">
              <p className="text-xs text-gray-500">Admin Only</p>
              <p className="text-xl font-bold text-gray-900">{formatCurrency(adminTotal)}</p>
            </div>
          )}
        </div>

        {/* ── Expense type breakdown (collapsed accordion) ── */}
        {expList.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <button
              onClick={() => setShowExpenseSummary(v => !v)}
              className="w-full px-4 py-3 flex items-center justify-between active:bg-gray-50 transition-colors"
            >
              <span className="text-sm font-semibold text-gray-900">Breakdown by Type</span>
              {showExpenseSummary
                ? <ChevronUp size={16} className="text-gray-500" />
                : <ChevronDown size={16} className="text-gray-500" />
              }
            </button>
            {showExpenseSummary && (
              <div className="px-4 pb-4 space-y-1.5 border-t border-gray-50">
                {byExpenseType.map(([type, amt]) => (
                  <div key={type} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                    <div className="flex items-center gap-2">
                      {ADMIN_ONLY_TYPES.includes(type)
                        ? <span className="w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0" />
                        : <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                      }
                      <span className="text-sm text-gray-700 capitalize">{type.replace(/_/g, ' ')}</span>
                    </div>
                    <span className="text-sm font-bold text-gray-900">{formatCurrency(amt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Expense list ── */}
        {isLoading ? <SkeletonList count={5} /> :
         expList.length === 0 ? (
           <EmptyState
             title="No expenses recorded"
             icon={<DollarSign size={28} />}
             action={() => setShowModal(true)}
             actionLabel="Add Expense"
           />
         ) : (
           <div className="space-y-3">
             <p className="text-xs text-gray-500">{expList.length} expense{expList.length !== 1 ? 's' : ''}</p>
             {expList.map(exp => (
               <div key={exp.id} className="bg-white rounded-2xl p-4 border border-gray-100">
                 <div className="flex items-start justify-between gap-2">
                   <div className="flex-1 min-w-0">
                     <div className="flex items-center gap-2 mb-0.5">
                       <p className="text-sm font-semibold text-gray-900 capitalize">
                         {exp.expense_type.replace(/_/g, ' ')}
                       </p>
                       {exp.is_admin_only && (
                         <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-medium">Admin</span>
                       )}
                     </div>
                     <p className="text-xs text-gray-500">{exp.business?.name} · {formatDate(exp.date)}</p>
                     {exp.description && <p className="text-xs text-gray-400 mt-0.5">{exp.description}</p>}
                   </div>
                   <p className="text-base font-bold text-red-600 shrink-0">{formatCurrency(exp.amount)}</p>
                 </div>
               </div>
             ))}
           </div>
         )
        }

      </div>

      {/* ── Add Expense Modal ── */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title="Add Expense"
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowModal(false)} className="flex-1">Cancel</Button>
            <Button
              onClick={() => addExpense.mutate(form)}
              loading={addExpense.isPending}
              className="flex-1"
              disabled={!form.business_id || !form.amount}
            >
              Add
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Select label="Business" required value={form.business_id} onChange={e => setForm({ ...form, business_id: e.target.value })}>
            <option value="">Select business...</option>
            {(businesses || []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
          <Select label="Expense Type" required value={form.expense_type} onChange={e => setForm({ ...form, expense_type: e.target.value })}>
            {EXPENSE_TYPES
              .filter(t => isCeo || !ADMIN_ONLY_TYPES.includes(t))
              .map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)
            }
          </Select>
          <Input
            label="Amount (₦)" type="number" inputMode="decimal" required
            value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })}
          />
          <Input
            label="Description" placeholder="Brief description"
            value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
          />
          <Input
            label="Date" type="date"
            value={form.date} onChange={e => setForm({ ...form, date: e.target.value })}
          />
          <Textarea
            label="Notes" rows={2}
            value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
          />
        </div>
      </Modal>
    </div>
  )
}
