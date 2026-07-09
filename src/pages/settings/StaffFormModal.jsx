import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
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
  status: 'active', business_id: '',
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
    setForm(staff ? {
      ...emptyForm,
      ...Object.fromEntries(Object.keys(emptyForm).map(k => [k, staff[k] ?? emptyForm[k]])),
      password: '',
    } : emptyForm)
  }, [isOpen, staff])

  const save = useMutation({
    mutationFn: async () => {
      const payload = { ...form }
      if (staff && !payload.password) delete payload.password
      Object.keys(payload).forEach(k => { if (payload[k] === '') payload[k] = null })
      if (!payload.role) payload.role = 'customer_support'

      const run = async (p) => staff
        ? supabase.from('staff_users').update(p).eq('id', staff.id)
        : supabase.from('staff_users').insert(p)

      let { error } = await run(payload)
      if (error && /column/i.test(error.message || '')) {
        // HR migration not run yet — save the legacy fields so nothing is lost
        const legacy = {}
        LEGACY_FIELDS.forEach(k => { if (payload[k] !== undefined) legacy[k] = payload[k] })
        const retry = await run(legacy)
        error = retry.error
        if (!error) showToast('Saved basic fields — run the latest migration for HR fields', 'info')
      }
      if (error) throw error
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
        {businesses && businesses.length > 0 && (
          <Select label="Assigned Business (optional)" value={form.business_id || ''} onChange={e => setForm({ ...form, business_id: e.target.value })}>
            <option value="">All / Not specific</option>
            {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        )}
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
