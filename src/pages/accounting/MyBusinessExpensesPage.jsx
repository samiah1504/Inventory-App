import { useState, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, DollarSign, Ban, ExternalLink } from 'lucide-react'
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

// Operational categories only — no salaries, rent, utilities or
// marketing here; those stay admin-only in Accounting (CEO)
export const LOGISTICS_EXPENSE_TYPES = [
  { value: 'warehouse_handling',   label: 'Warehouse Handling' },
  { value: 'warehouse_storage',    label: 'Warehouse Storage' },
  { value: 'park_charges',         label: 'Transport Park Charges' },
  { value: 'interstate_transport', label: 'Interstate Transport' },
  { value: 'loading',              label: 'Vehicle Loading' },
  { value: 'offloading',           label: 'Offloading' },
  { value: 'courier_operational',  label: 'Courier Operational' },
  { value: 'local_transport',      label: 'Local Transport' },
  { value: 'fuel',                 label: 'Fuel' },
  { value: 'airtime_data',         label: 'Airtime / Data' },
  { value: 'office_supplies',      label: 'Office Supplies' },
  { value: 'logistics_misc',       label: 'Miscellaneous' },
]

const EMPTY_FORM = {
  business_id: '', expense_type: 'park_charges', amount: '',
  date: new Date().toISOString().split('T')[0],
  description: '', paid_to: '', receipt_url: '',
}

function monthStart() {
  const d = new Date(); d.setDate(1); return d.toISOString().split('T')[0]
}

export function MyBusinessExpensesPage() {
  const { user } = useAuthStore()
  const { data: businesses } = useBusinesses()
  const { showToast } = useAppStore()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()

  const [dateFrom, setDateFrom] = useState(monthStart)
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0])
  const [showAdd, setShowAdd] = useState(searchParams.get('add') === '1')
  const [form, setForm] = useState(EMPTY_FORM)

  // Role preview keeps the CEO's identity, so their own entries would
  // show here and look like a leak — a preview sees an empty page,
  // exactly like a brand-new officer
  const previewing = !!user?._preview

  // Only this officer's own business expenses — never other staff's
  // records and never order-linked expenses
  const { data: expenses, isLoading } = useQuery({
    queryKey: ['my_business_expenses', user?.id, dateFrom, dateTo],
    queryFn: async () => {
      const { data, error } = await supabase.from('expenses')
        .select('*, business:businesses(name)')
        .eq('staff_id', user.id)
        .is('order_id', null)
        .gte('date', dateFrom).lte('date', dateTo)
        .order('date', { ascending: false })
      if (error) throw error
      return data || []
    },
    enabled: !!user?.id && !previewing,
    staleTime: 30000,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['my_business_expenses'] })
    queryClient.invalidateQueries({ queryKey: ['expenses'] })
    queryClient.invalidateQueries({ queryKey: ['report_expenses'] })
  }

  const addExpense = useMutation({
    mutationFn: async (f) => {
      if (previewing) throw new Error('Exit role preview to record expenses')
      const { data, error } = await supabase.from('expenses').insert({
        business_id: f.business_id,
        expense_type: f.expense_type,
        amount: Number(f.amount),
        description: f.description || null,
        date: f.date,
        category: 'operational',
        is_admin_only: false,
        staff_id: user?.id,
      }).select('id').single()
      if (error) throw error
      // Newer columns may not exist until the migration runs — best-effort
      await supabase.from('expenses').update({
        paid_to: f.paid_to || null,
        receipt_url: f.receipt_url || null,
        created_by_name: user?.name || null,
        status: 'active',
      }).eq('id', data.id)
    },
    onSuccess: () => {
      invalidate()
      showToast('Business expense recorded', 'success')
      setShowAdd(false)
      setForm(EMPTY_FORM)
      if (searchParams.get('add')) setSearchParams({}, { replace: true })
    },
    onError: (err) => showToast(err.message, 'error'),
  })

  // No edits — once recorded, an expense can only be changed by the CEO
  // (from Accounting). A mistaken entry is voided and re-added.
  // No deletes — a mistaken entry is voided and kept for audit.
  // Permanent removal is CEO-only, from the Accounting module.
  const voidExpense = useMutation({
    mutationFn: async ({ item, reason }) => {
      const { error } = await supabase.from('expenses').update({
        status: 'voided',
        void_reason: reason || null,
        voided_by: user?.name || null,
        voided_at: new Date().toISOString(),
      }).eq('id', item.id).eq('staff_id', user.id)
      if (error) throw new Error('Could not void — run the Business Expenses migration first')
    },
    onSuccess: () => { invalidate(); showToast('Expense voided — kept for audit', 'success') },
    onError: (err) => showToast(err.message, 'error'),
  })

  const list = previewing ? [] : (expenses || [])
  const activeList = list.filter(e => e.status !== 'voided')
  const total = activeList.reduce((s, e) => s + Number(e.amount || 0), 0)

  const byType = useMemo(() => {
    const map = {}
    activeList.forEach(e => { map[e.expense_type] = (map[e.expense_type] || 0) + Number(e.amount) })
    return Object.entries(map).sort(([, a], [, b]) => b - a)
  }, [activeList])

  const typeLabel = (t) =>
    LOGISTICS_EXPENSE_TYPES.find(x => x.value === t)?.label || (t || '').replace(/_/g, ' ')

  const formValid = form.business_id && form.expense_type && Number(form.amount) > 0 && form.date

  const expenseForm = (
    <div className="space-y-4">
      <Select label="Expense Category" required value={form.expense_type}
        onChange={e => setForm({ ...form, expense_type: e.target.value })}>
        {LOGISTICS_EXPENSE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
      </Select>
      <Input label="Amount (₦)" type="number" inputMode="decimal" required
        value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
      <Select label="Business" required value={form.business_id}
        onChange={e => setForm({ ...form, business_id: e.target.value })}>
        <option value="">Select business...</option>
        {(businesses || []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
      </Select>
      <Input label="Date Incurred" type="date" required
        value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
      <Textarea label="Description / Notes" rows={2} required
        placeholder="What was this expense for?"
        value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
      <Input label="Paid To" required placeholder="Person or company paid"
        value={form.paid_to} onChange={e => setForm({ ...form, paid_to: e.target.value })} />
      <Input label="Receipt Link (optional)" type="url" placeholder="https:// — photo or scan of the receipt"
        value={form.receipt_url} onChange={e => setForm({ ...form, receipt_url: e.target.value })} />
    </div>
  )

  return (
    <div className="flex flex-col h-full overflow-x-hidden w-full">
      <TopBar
        title="My Expenses"
        actions={
          <button onClick={() => { setForm(EMPTY_FORM); setShowAdd(true) }}
            className="p-2 bg-blue-600 text-white rounded-xl active:scale-95">
            <Plus size={20} />
          </button>
        }
      />

      <div className="px-4 py-3 bg-white border-b border-gray-100 sticky top-[57px] z-20">
        <div className="flex gap-2">
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="flex-1 min-w-0" />
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="flex-1 min-w-0" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-4">
        {previewing && (
          <div className="bg-cyan-50 border border-cyan-200 rounded-2xl p-3 text-xs text-cyan-800">
            <span className="font-semibold">Role preview:</span> every officer sees only the expenses
            they added themselves, so this page starts empty. Your own entries as CEO live in Accounting.
          </div>
        )}
        <p className="text-xs text-gray-500">
          Expenses you personally incur on duty, not tied to a customer order — transport, park charges,
          handling, storage. You only ever see expenses you recorded yourself.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white rounded-2xl p-4 border border-gray-100">
            <p className="text-xs text-gray-500">Total This Period</p>
            <p className="text-xl font-bold text-red-600">{formatCurrency(total)}</p>
          </div>
          <div className="bg-white rounded-2xl p-4 border border-gray-100">
            <p className="text-xs text-gray-500">Entries</p>
            <p className="text-xl font-bold text-gray-900">{activeList.length}</p>
          </div>
        </div>

        {byType.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-1.5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">By Category</p>
            {byType.map(([t, amt]) => (
              <div key={t} className="flex items-center justify-between py-1 border-b border-gray-50 last:border-0">
                <span className="text-sm text-gray-700">{typeLabel(t)}</span>
                <span className="text-sm font-bold text-gray-900">{formatCurrency(amt)}</span>
              </div>
            ))}
          </div>
        )}

        {isLoading ? <SkeletonList count={4} /> :
         list.length === 0 ? (
          <EmptyState
            icon={<DollarSign size={28} />}
            title="No business expenses yet"
            description="Record logistics and warehouse costs that aren't tied to an order"
            action={() => { setForm(EMPTY_FORM); setShowAdd(true) }}
            actionLabel="Add Business Expense"
          />
        ) : (
          <div className="space-y-3">
            {list.map(exp => {
              const voided = exp.status === 'voided'
              return (
                <div key={exp.id}
                  className={`bg-white rounded-2xl p-4 border ${voided ? 'border-gray-100 opacity-60' : 'border-gray-100'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <p className={`text-sm font-semibold text-gray-900 ${voided ? 'line-through' : ''}`}>
                          {typeLabel(exp.expense_type)}
                        </p>
                        {voided && (
                          <span className="text-[10px] font-semibold bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded">VOIDED</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500">{exp.business?.name} · {formatDate(exp.date)}</p>
                      {exp.paid_to && <p className="text-xs text-gray-500">Paid to: {exp.paid_to}</p>}
                      {exp.description && <p className="text-xs text-gray-400 mt-0.5">{exp.description}</p>}
                      {voided && exp.void_reason && (
                        <p className="text-xs text-gray-400 mt-0.5">Void reason: {exp.void_reason}</p>
                      )}
                      {exp.last_edited_by && !voided && (
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          Edited by {exp.last_edited_by}{exp.last_edited_at ? ` · ${formatDate(exp.last_edited_at)}` : ''}
                        </p>
                      )}
                      {exp.receipt_url && (
                        <a href={exp.receipt_url} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-blue-600 font-medium mt-1">
                          <ExternalLink size={12} /> Receipt
                        </a>
                      )}
                    </div>
                    <p className={`text-base font-bold shrink-0 ${voided ? 'text-gray-400 line-through' : 'text-red-600'}`}>
                      {formatCurrency(exp.amount)}
                    </p>
                  </div>
                  {!voided && (
                    <div className="flex gap-2 mt-3">
                      <Button size="sm" variant="danger" className="flex-1"
                        loading={voidExpense.isPending}
                        onClick={() => {
                          const reason = window.prompt('Why is this expense being voided?')
                          if (reason !== null) voidExpense.mutate({ item: exp, reason })
                        }}>
                        <span className="flex items-center justify-center gap-1.5"><Ban size={13} /> Void</span>
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
            <p className="text-[11px] text-gray-400">
              Recorded expenses can't be edited — only the CEO can amend an expense. Made a mistake?
              Void the entry (it stays on record for audit) and add it again correctly.
            </p>
          </div>
        )}
      </div>

      {/* Add modal */}
      <Modal isOpen={showAdd} onClose={() => setShowAdd(false)} title="Add Business Expense"
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowAdd(false)} className="flex-1">Cancel</Button>
            <Button className="flex-1" disabled={!formValid || !form.description || !form.paid_to}
              loading={addExpense.isPending}
              onClick={() => addExpense.mutate(form)}>
              Save Expense
            </Button>
          </div>
        }>
        {expenseForm}
      </Modal>

    </div>
  )
}
