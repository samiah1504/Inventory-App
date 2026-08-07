import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { Input, Select, Textarea } from '../../components/ui/Input'
import { useBusinesses } from '../../hooks/useBusinesses'
import { STAFF_STATUSES } from '../../hooks/useStaff'
import { useAppStore } from '../../stores/appStore'

export const ROLES = [
  { value: 'ceo', label: 'CEO / Super Admin' },
  { value: 'operations_manager', label: 'Operations Manager' },
  { value: 'customer_support', label: 'Customer Support' },
  { value: 'fulfillment', label: 'Fulfillment Officer' },
  { value: 'waybill', label: 'Waybill Officer' },
  { value: 'inventory', label: 'Inventory / Warehouse Staff' },
  { value: 'accountant', label: 'Accountant' },
]

export const EMPLOYMENT_TYPES = [
  { value: 'full_time', label: 'Full Time' },
  { value: 'part_time', label: 'Part Time' },
  { value: 'contract',  label: 'Contract' },
  { value: 'intern',    label: 'Intern' },
]

const emptyForm = {
  name: '', username: '', password: '', phone: '', staff_code: '',
  role: 'customer_support', email: '', address: '', department: '',
  position: '', employment_type: 'full_time', date_joined: '',
  status: 'active', business_id: '', business_ids: [],
}

// Legacy columns that always exist even before the HR migration runs
const LEGACY_FIELDS = ['name', 'username', 'password', 'phone', 'staff_code', 'role']

export function StaffFormModal({ isOpen, onClose, staff }) {
  const [form, setForm] = useState(emptyForm)
  const { data: businesses } = useBusinesses()
  const { showToast } = useAppStore()
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!isOpen) return
    if (!staff) { setForm(emptyForm); return }
    // Staff assigned to a single business before multi-business existed
    // start with that one ticked
    const ids = Array.isArray(staff.business_ids) ? staff.business_ids.filter(Boolean) : []
    setForm({
      ...emptyForm,
      ...Object.fromEntries(Object.keys(emptyForm).map(k => [k, staff[k] ?? emptyForm[k]])),
      business_ids: ids.length > 0 ? ids : (staff.business_id ? [staff.business_id] : []),
      password: '',
    })
  }, [isOpen, staff])

  const save = useMutation({
    mutationFn: async () => {
      const payload = { ...form }
      if (staff && !payload.password) delete payload.password
      Object.keys(payload).forEach(k => { if (payload[k] === '') payload[k] = null })
      if (!payload.role) payload.role = 'customer_support'
      // business_ids is the real assignment; business_id stays in sync with
      // the first ticked business for anything still reading the old column
      const ids = Array.isArray(form.business_ids) ? form.business_ids.filter(Boolean) : []
      payload.business_ids = ids
      payload.business_id = ids[0] || null

      const run = async (p) => staff
        ? supabase.from('staff_users').update(p).eq('id', staff.id).select('id').single()
        : supabase.from('staff_users').insert(p).select('id').single()

      let { data: saved, error } = await run(payload)
      if (error && /column/i.test(error.message || '')) {
        // HR migration not run yet — save the legacy fields so nothing is lost
        const legacy = {}
        LEGACY_FIELDS.forEach(k => { if (payload[k] !== undefined) legacy[k] = payload[k] })
        const retry = await run(legacy)
        saved = retry.data
        error = retry.error
        if (!error) showToast('Saved basic fields — run the latest migration for HR fields', 'info')
      }
      if (error) throw error

      // Replace the plain-text password with a salted hash (no-op
      // until the password migration adds the hash columns)
      if (payload.password && saved?.id) {
        const { tryUpgradeToHash } = await import('../../lib/passwords')
        await tryUpgradeToHash(saved.id, payload.password)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff'] })
      queryClient.invalidateQueries({ queryKey: ['staff_member'] })
      showToast(staff ? 'Staff updated' : 'Staff created', 'success')
      onClose()
    },
    onError: (err) => showToast(err.message, 'error'),
  })

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={staff ? 'Edit Staff Profile' : 'Add Staff'}
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
          <Button
            onClick={() => save.mutate()}
            loading={save.isPending}
            className="flex-1"
            disabled={!form.name || !form.username || (!staff && !form.password) || !form.staff_code}
          >
            {staff ? 'Save' : 'Create'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Input label="Full Name" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Username" placeholder="john.doe" required
            autoCapitalize="none" autoCorrect="off"
            value={form.username} onChange={e => setForm({ ...form, username: e.target.value.toLowerCase() })} />
          <Input label="Staff Code" placeholder="STF001" required
            value={form.staff_code} onChange={e => setForm({ ...form, staff_code: e.target.value.toUpperCase() })} />
        </div>
        <Input label="Password" type="password"
          placeholder={staff ? 'Leave blank to keep current' : 'Enter password'}
          value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Phone" type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
          <Input label="Email (optional)" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
        </div>
        <Textarea label="Address (optional)" rows={2} value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Department" placeholder="e.g. Operations" value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} />
          <Input label="Position" placeholder="e.g. Team Lead" value={form.position} onChange={e => setForm({ ...form, position: e.target.value })} />
        </div>
        <Select label="Role" required value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
          {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </Select>
        {businesses && businesses.length > 0 && form.role !== 'ceo' && (() => {
          const ids = Array.isArray(form.business_ids) ? form.business_ids : []
          const toggle = (id) => setForm({
            ...form,
            business_ids: ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id],
          })
          return (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Assigned Businesses (optional)
              </label>
              <p className="text-[11px] text-gray-400 mb-2">
                Tick every business this person works for. They only see orders, inventory,
                waybills and expenses for the ticked businesses. No ticks = all businesses.
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {businesses.map(b => {
                  const on = ids.includes(b.id)
                  return (
                    <button key={b.id} type="button" onClick={() => toggle(b.id)}
                      className={`flex items-center gap-2 px-2.5 py-2 rounded-xl border text-left transition-all active:scale-[0.99] ${
                        on ? 'border-yellow-400 bg-yellow-50' : 'border-gray-200 bg-white'
                      }`}>
                      <span className={`w-4 h-4 rounded flex items-center justify-center shrink-0 ${
                        on ? 'bg-yellow-400 text-gray-900' : 'bg-gray-100 text-transparent'
                      }`}>
                        <Check size={12} />
                      </span>
                      <span className="text-xs text-gray-800 truncate">{b.name}</span>
                    </button>
                  )
                })}
              </div>
              <p className="text-[11px] text-gray-400 mt-1.5">
                {ids.length === 0
                  ? 'All businesses'
                  : `${ids.length} business${ids.length !== 1 ? 'es' : ''} selected`}
                {' '}· applies at their next login
              </p>
            </div>
          )
        })()}
        <div className="grid grid-cols-2 gap-3">
          <Select label="Employment Type" value={form.employment_type || 'full_time'} onChange={e => setForm({ ...form, employment_type: e.target.value })}>
            {EMPLOYMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
          <Input label="Date Joined" type="date" value={form.date_joined || ''} onChange={e => setForm({ ...form, date_joined: e.target.value })} />
        </div>
        <Select label="Status" value={form.status || 'active'} onChange={e => setForm({ ...form, status: e.target.value })}>
          {STAFF_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </Select>
      </div>
    </Modal>
  )
}
