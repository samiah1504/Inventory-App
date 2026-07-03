import { useState } from 'react'
import { Plus, DollarSign } from 'lucide-react'
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

const EXPENSE_TYPES = [
  'delivery', 'installation', 'offloading', 'waybill',
  'supplier_payment', 'rent', 'salary', 'ads', 'electricity',
  'fuel', 'office', 'marketing', 'misc', 'other'
]

const ADMIN_ONLY_TYPES = ['supplier_payment', 'rent', 'salary', 'ads', 'electricity', 'fuel', 'office', 'marketing']

export function AccountingPage() {
  const [showModal, setShowModal] = useState(false)
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().split('T')[0])
  const [form, setForm] = useState({
    business_id: '', expense_type: 'misc', amount: '', description: '',
    date: new Date().toISOString().split('T')[0], notes: '', is_admin_only: false
  })
  const { user } = useAuthStore()
  const { data: businesses } = useBusinesses()
  const { showToast } = useAppStore()
  const queryClient = useQueryClient()

  const isCeo = ['ceo', 'super_admin'].includes(user?.role)

  const { data: expenses, isLoading } = useQuery({
    queryKey: ['expenses', dateFrom, isCeo],
    queryFn: async () => {
      let query = supabase.from('expenses').select('*, business:businesses(name)')
        .gte('date', dateFrom).order('created_at', { ascending: false }).limit(100)
      if (!isCeo) query = query.eq('is_admin_only', false)
      const { data, error } = await query
      if (error) throw error
      return data || []
    },
    staleTime: 30000,
  })

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
      showToast('Expense added', 'success')
      setShowModal(false)
      setForm({ business_id: '', expense_type: 'misc', amount: '', description: '', date: new Date().toISOString().split('T')[0], notes: '', is_admin_only: false })
    },
    onError: (err) => showToast(err.message, 'error'),
  })

  const totalExpenses = (expenses || []).reduce((s, e) => s + Number(e.amount), 0)
  const adminExpenses = (expenses || []).filter(e => e.is_admin_only)
  const opsExpenses = (expenses || []).filter(e => !e.is_admin_only)

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Expenses"
        actions={
          <button onClick={() => setShowModal(true)} className="p-2 bg-blue-600 text-white rounded-xl active:scale-95">
            <Plus size={20} />
          </button>
        }
      />

      <div className="px-4 py-3 bg-white border-b border-gray-100 sticky top-[57px] z-20">
        <Input type="date" label="From date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Summary */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white rounded-2xl p-4 border border-gray-100">
            <p className="text-xs text-gray-500">Total Expenses</p>
            <p className="text-xl font-bold text-red-600">{formatCurrency(totalExpenses)}</p>
          </div>
          {isCeo && (
            <div className="bg-white rounded-2xl p-4 border border-gray-100">
              <p className="text-xs text-gray-500">Admin Only</p>
              <p className="text-xl font-bold text-gray-900">
                {formatCurrency(adminExpenses.reduce((s, e) => s + Number(e.amount), 0))}
              </p>
            </div>
          )}
        </div>

        {/* Expense list */}
        {isLoading ? <SkeletonList count={5} /> :
         expenses?.length === 0 ? (
           <EmptyState title="No expenses recorded" icon={<DollarSign size={28} />} action={() => setShowModal(true)} actionLabel="Add Expense" />
         ) : (
           <div className="space-y-3">
             <p className="text-xs text-gray-500">{expenses.length} expense{expenses.length !== 1 ? 's' : ''}</p>
             {expenses.map(exp => (
               <div key={exp.id} className="bg-white rounded-2xl p-4 border border-gray-100">
                 <div className="flex items-start justify-between gap-2">
                   <div className="flex-1 min-w-0">
                     <div className="flex items-center gap-2 mb-0.5">
                       <p className="text-sm font-semibold text-gray-900 capitalize">{exp.expense_type.replace('_', ' ')}</p>
                       {exp.is_admin_only && <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-medium">Admin</span>}
                     </div>
                     <p className="text-xs text-gray-500">{exp.business?.name} · {formatDate(exp.date)}</p>
                     {exp.description && <p className="text-xs text-gray-400">{exp.description}</p>}
                   </div>
                   <p className="text-base font-bold text-red-600 shrink-0">{formatCurrency(exp.amount)}</p>
                 </div>
               </div>
             ))}
           </div>
         )
        }
      </div>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Add Expense"
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowModal(false)} className="flex-1">Cancel</Button>
            <Button onClick={() => addExpense.mutate(form)} loading={addExpense.isPending} className="flex-1"
              disabled={!form.business_id || !form.amount}>Add</Button>
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
              .map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)
            }
          </Select>
          <Input label="Amount (₦)" type="number" inputMode="decimal" required
            value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
          <Input label="Description" placeholder="Brief description"
            value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          <Input label="Date" type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
          <Textarea label="Notes" rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
        </div>
      </Modal>
    </div>
  )
}
