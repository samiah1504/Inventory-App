import { useState } from 'react'
import { Plus, Edit, UserX, UserCheck } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { TopBar } from '../../components/layout/TopBar'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { Input, Select } from '../../components/ui/Input'
import { Badge } from '../../components/ui/Badge'
import { useAppStore } from '../../stores/appStore'

const ROLES = [
  { value: 'ceo', label: 'CEO / Super Admin' },
  { value: 'operations_manager', label: 'Operations Manager' },
  { value: 'customer_support', label: 'Customer Support' },
  { value: 'fulfillment', label: 'Fulfillment Officer' },
  { value: 'waybill', label: 'Waybill Officer' },
  { value: 'inventory', label: 'Inventory Staff' },
]

const roleColors = {
  ceo: 'purple',
  operations_manager: 'blue',
  customer_support: 'green',
  fulfillment: 'amber',
  waybill: 'blue',
  inventory: 'gray',
}

export function StaffPage() {
  const [showModal, setShowModal] = useState(false)
  const [editingStaff, setEditingStaff] = useState(null)
  const { showToast } = useAppStore()
  const queryClient = useQueryClient()

  const [form, setForm] = useState({ name: '', username: '', password: '', phone: '', staff_code: '', role: 'customer_support' })

  const { data: staff, isLoading } = useQuery({
    queryKey: ['staff'],
    queryFn: async () => {
      const { data, error } = await supabase.from('staff_users').select('*').order('name')
      if (error) throw error
      return data || []
    },
  })

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      // Don't overwrite password if left blank during edit
      const payload = editingStaff && !data.password
        ? { name: data.name, username: data.username, phone: data.phone, staff_code: data.staff_code, role: data.role }
        : data
      if (editingStaff) {
        const { error } = await supabase.from('staff_users').update(payload).eq('id', editingStaff.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('staff_users').insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff'] })
      showToast(editingStaff ? 'Staff updated' : 'Staff created', 'success')
      setShowModal(false)
      setEditingStaff(null)
      setForm({ name: '', username: '', password: '', phone: '', staff_code: '', role: 'customer_support' })
    },
    onError: (err) => showToast(err.message, 'error'),
  })

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }) => {
      const { error } = await supabase.from('staff_users').update({ is_active: !is_active }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staff'] }),
  })

  function openEdit(member) {
    setEditingStaff(member)
    setForm({ name: member.name, username: member.username, password: '', phone: member.phone || '', staff_code: member.staff_code, role: member.role })
    setShowModal(true)
  }

  function openNew() {
    setEditingStaff(null)
    setForm({ name: '', username: '', password: '', phone: '', staff_code: '', role: 'customer_support' })
    setShowModal(true)
  }

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Staff Management"
        actions={
          <button onClick={openNew} className="p-2 bg-blue-600 text-black rounded-xl active:scale-95">
            <Plus size={20} />
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {isLoading ? (
          <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 shimmer rounded-2xl" />)}</div>
        ) : (
          <>
            <p className="text-xs text-gray-500">{staff?.length} staff members</p>
            {(staff || []).map(member => (
              <div key={member.id} className="bg-white rounded-2xl p-4 border border-gray-100">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-sm font-semibold text-gray-900">{member.name}</p>
                      {!member.is_active && <Badge color="red">Inactive</Badge>}
                    </div>
                    <p className="text-xs text-gray-500">@{member.username} · {member.staff_code}</p>
                    {member.phone && <p className="text-xs text-gray-400">{member.phone}</p>}
                    <div className="mt-1">
                      <Badge color={roleColors[member.role] || 'gray'}>
                        {ROLES.find(r => r.value === member.role)?.label || member.role}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => openEdit(member)}
                      className="p-2 bg-gray-100 text-gray-600 rounded-xl active:scale-95 transition-all">
                      <Edit size={16} />
                    </button>
                    <button
                      onClick={() => toggleActive.mutate({ id: member.id, is_active: member.is_active })}
                      className={`p-2 rounded-xl active:scale-95 transition-all ${member.is_active ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}
                    >
                      {member.is_active ? <UserX size={16} /> : <UserCheck size={16} />}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editingStaff ? 'Edit Staff' : 'Add Staff'}
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowModal(false)} className="flex-1">Cancel</Button>
            <Button
              onClick={() => saveMutation.mutate(form)}
              loading={saveMutation.isPending}
              className="flex-1"
              disabled={!form.name || !form.username || (!editingStaff && !form.password) || !form.staff_code}
            >
              {editingStaff ? 'Save' : 'Create'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input label="Full Name" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <Input label="Username" placeholder="e.g. john.doe" required
            autoCapitalize="none" autoCorrect="off"
            value={form.username} onChange={e => setForm({ ...form, username: e.target.value.toLowerCase() })} />
          <Input label="Password" type="password"
            placeholder={editingStaff ? 'Leave blank to keep current' : 'Enter password'}
            value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
          <Input label="Phone Number (optional)" type="tel"
            value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
          <Input label="Staff Code" placeholder="e.g. STF001" required
            value={form.staff_code} onChange={e => setForm({ ...form, staff_code: e.target.value.toUpperCase() })} />
          <Select label="Role" required value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
            {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </Select>
        </div>
      </Modal>
    </div>
  )
}
