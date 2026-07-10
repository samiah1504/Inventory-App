import { useState, useMemo } from 'react'
import { Navigate } from 'react-router-dom'
import { Plus, DollarSign, ChevronDown, ChevronUp, Trash2, Pencil } from 'lucide-react'
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
import { useAppStore } from '../../stores/appStore'
import { formatCurrency, formatDate } from '../../utils/format'

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

const EMPTY_FORM = {
  business_id: '', expense_type: 'misc', amount: '', description: '',
  date: new Date().toISOString().split('T')[0], notes: '',
  paid_to: '', payment_method: 'cash',
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AccountingPage() {
  const [showModal, setShowModal]   = useState(false)
  const [editingExp, setEditingExp] = useState(null)
  const [expanded, setExpanded]     = useState(null)
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().split('T')[0]
  })
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0])
  const [businessFilter, setBusinessFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [statusFilter, setStatusFilter]     = useState('')
  const [search, setSearch] = useState('')
  const [sort, setSort]     = useState('newest')
  const [form, setForm]     = useState(EMPTY_FORM)

  const { user }             = useAuthStore()
  const { data: businesses } = useBusinesses()
  const { showToast }        = useAppStore()
  const queryClient          = useQueryClient()
  const isCeo                = ['ceo', 'super_admin'].includes(user?.role)

  // ── Expenses query ────────────────────────────────────────────────────────

  const { data: expenses, isLoading } = useQuery({
    queryKey: ['expenses', dateFrom, dateTo, isCeo, businessFilter],
    queryFn: async () => {
      let q = supabase.from('expenses').select('*, business:businesses(name)')
        .gte('date', dateFrom).lte('date', dateTo)
        .order('date', { ascending: false }).limit(300)
      if (!isCeo) q = q.eq('is_admin_only', false)
      if (businessFilter) q = q.eq('business_id', businessFilter)
      const { data, error } = await q
      if (error) throw error
      return data || []
    },
    staleTime: 30000,
  })

  // Staff names for "Created By" (deleted accounts shown as former staff)
  const staffQ = useQuery({
    queryKey: ['expense_staff_names'],
    queryFn: async () => {
      try {
        const { data, error } = await supabase.from('staff_users').select('*')
        if (error) throw error
        return new Map((data || []).map(s =>
          [s.id, s.is_deleted ? `${s.name} (Former Staff)` : s.name]))
      } catch { return new Map() }
    },
    staleTime: 60000 * 5,
  })
  const staffName = (id) => (id && staffQ.data?.get(id)) || null

  // ── Save (create / CEO edit) ──────────────────────────────────────────────

  const saveExpense = useMutation({
    mutationFn: async (data) => {
      const isAdminType = ADMIN_ONLY_TYPES.includes(data.expense_type)
      const flags = { is_admin_only: isAdminType, category: isAdminType ? 'admin' : 'operational' }
      const core = {
        business_id: data.business_id,
        expense_type: data.expense_type,
        amount: Number(data.amount),
        description: data.description || null,
        date: data.date,
        notes: data.notes || null,
        ...flags,
      }
      // Newer columns — best-effort so saves work pre-migration
      const extras = {
        paid_to: data.paid_to || null,
        payment_method: data.payment_method || null,
        created_by_name: user?.name || null,
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
        if (created) await supabase.from('expenses').update(extras).eq('id', created.id)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] })
      showToast(editingExp ? 'Expense updated' : 'Expense added', 'success')
      setShowModal(false)
      setEditingExp(null)
      setForm(EMPTY_FORM)
    },
    onError: (err) => showToast(err.message, 'error'),
  })

  // ── Permanent delete — CEO / super admin only ─────────────────────────────

  const deleteExpense = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('expenses').delete().eq('id', id)
      if (error) throw error
      const { data: still } = await supabase.from('expenses').select('id').eq('id', id).limit(1)
      if (still && still.length > 0) throw new Error('The database blocked the delete')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] })
      showToast('Expense deleted', 'success')
    },
    onError: (err) => showToast(err.message, 'error'),
  })

  // ── Derived list: search, category/status filters, sorting ───────────────

  const expListAll = expenses || []

  const list = useMemo(() => {
    let l = expListAll
    if (categoryFilter) l = l.filter(e => e.expense_type === categoryFilter)
    if (statusFilter === 'active') l = l.filter(e => e.status !== 'voided')
    if (statusFilter === 'voided') l = l.filter(e => e.status === 'voided')
    if (search) {
      const q = search.toLowerCase()
      l = l.filter(e =>
        (e.description || '').toLowerCase().includes(q) ||
        (e.business?.name || '').toLowerCase().includes(q) ||
        typeLabel(e.expense_type).toLowerCase().includes(q) ||
        (staffName(e.staff_id) || e.created_by_name || '').toLowerCase().includes(q) ||
        (e.paid_to || '').toLowerCase().includes(q))
    }
    const sorted = [...l]
    if (sort === 'newest')  sorted.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    if (sort === 'oldest')  sorted.sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    if (sort === 'highest') sorted.sort((a, b) => Number(b.amount) - Number(a.amount))
    if (sort === 'lowest')  sorted.sort((a, b) => Number(a.amount) - Number(b.amount))
    return sorted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expListAll, categoryFilter, statusFilter, search, sort, staffQ.data])

  // Summary counts active records only; voided stay listed for audit
  const activeList = list.filter(e => e.status !== 'voided')
  const totalExpenses = activeList.reduce((s, e) => s + Number(e.amount || 0), 0)
  const voidedCount = list.filter(e => e.status === 'voided').length

  function openEdit(exp) {
    setForm({
      business_id: exp.business_id || '',
      expense_type: exp.expense_type || 'misc',
      amount: String(exp.amount ?? ''),
      description: exp.description || '',
      date: exp.date || new Date().toISOString().split('T')[0],
      notes: exp.notes || '',
      paid_to: exp.paid_to || '',
      payment_method: exp.payment_method || 'cash',
    })
    setEditingExp(exp)
    setShowModal(true)
  }

  // The full accounting module — everyone's expenses — is only for
  // roles with accounting access. Everyone else manages their own
  // expenses on /my-expenses.
  if (!accessFor(user).includes('accounting')) return <Navigate to="/my-expenses" replace />

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

      {/* ── Filters ── */}
      <div className="px-4 py-3 bg-white border-b border-gray-100 sticky top-[57px] z-20 space-y-2">
        <SearchBar value={search} onChange={setSearch} placeholder="Search title, business, category, staff..." />
        <div className="flex gap-2">
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="flex-1 min-w-0" />
          <Input type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)}   className="flex-1 min-w-0" />
        </div>
        <div className="flex gap-2">
          {businesses && businesses.length > 1 && (
            <div className="flex-1 min-w-0">
              <Select value={businessFilter} onChange={e => setBusinessFilter(e.target.value)}>
                <option value="">All Businesses</option>
                {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <Select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
              <option value="">All Categories</option>
              {EXPENSE_TYPES.filter(t => isCeo || !ADMIN_ONLY_TYPES.includes(t)).map(t => (
                <option key={t} value={t} className="capitalize">{typeLabel(t)}</option>
              ))}
            </Select>
          </div>
        </div>
        <div className="flex gap-2">
          <div className="flex-1 min-w-0">
            <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">All Status</option>
              <option value="active">Active</option>
              <option value="voided">Voided</option>
            </Select>
          </div>
          <div className="flex-1 min-w-0">
            <Select value={sort} onChange={e => setSort(e.target.value)}>
              {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </Select>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-4">

        {/* ── Expense Summary ── */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <p className="text-xs text-gray-500">Total Expenses</p>
              <p className="text-lg font-bold text-red-600 leading-tight">{formatCurrency(totalExpenses)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Records</p>
              <p className="text-lg font-bold text-gray-900 leading-tight">{activeList.length}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Voided</p>
              <p className="text-lg font-bold text-gray-400 leading-tight">{voidedCount}</p>
            </div>
          </div>
          <p className="text-[11px] text-gray-400 mt-2">
            Profit &amp; Loss, sales and business performance live in Reports.
          </p>
        </div>

        {/* ── Expense list ── */}
        {isLoading ? <SkeletonList count={5} /> :
         list.length === 0 ? (
           <EmptyState
             title="No expenses found for the selected filters."
             icon={<DollarSign size={28} />}
             action={() => { setEditingExp(null); setForm(EMPTY_FORM); setShowModal(true) }}
             actionLabel="Add Expense"
           />
         ) : (
           <div className="space-y-3">
             {list.map(exp => {
               const voided = exp.status === 'voided'
               const isOpen = expanded === exp.id
               const createdBy = staffName(exp.staff_id) || exp.created_by_name
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
                             voided ? 'bg-gray-200 text-gray-600' : 'bg-green-50 text-green-700'
                           }`}>
                             {voided ? 'VOIDED' : 'ACTIVE'}
                           </span>
                         </div>
                         <p className="text-xs text-gray-500 capitalize">
                           {[exp.business?.name, typeLabel(exp.expense_type), formatDate(exp.date)].filter(Boolean).join(' · ')}
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
                           ['Paid To', exp.paid_to],
                           ['Payment Method', PAYMENT_METHODS.find(m => m.value === exp.payment_method)?.label || exp.payment_method],
                           ['Created By', createdBy],
                           ['Date', formatDate(exp.date)],
                         ].filter(([, v]) => v).map(([label, value]) => (
                           <div key={label}>
                             <p className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</p>
                             <p className="text-xs font-semibold text-gray-800 truncate">{value}</p>
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
                       {isCeo && !voided && (
                         <div className="flex gap-2">
                           <Button size="sm" variant="secondary" className="flex-1" onClick={() => openEdit(exp)}>
                             <span className="flex items-center justify-center gap-1.5"><Pencil size={13} /> Edit</span>
                           </Button>
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
                       {isCeo && voided && (
                         <Button size="sm" variant="danger" className="w-full"
                           loading={deleteExpense.isPending}
                           onClick={() => {
                             if (window.confirm('Permanently delete this voided expense? This cannot be undone.')) {
                               deleteExpense.mutate(exp.id)
                             }
                           }}>
                           <span className="flex items-center justify-center gap-1.5"><Trash2 size={13} /> Delete Permanently</span>
                         </Button>
                       )}
                     </div>
                   )}
                 </div>
               )
             })}
             <p className="text-xs text-gray-400">{list.length} expense record{list.length !== 1 ? 's' : ''}</p>
           </div>
         )
        }
      </div>

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
