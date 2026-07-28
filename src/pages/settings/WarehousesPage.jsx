import { useState } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { Plus, Edit, Package } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { TopBar } from '../../components/layout/TopBar'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { Input, Select } from '../../components/ui/Input'
import { useAppStore } from '../../stores/appStore'
import { NIGERIAN_STATES } from '../../utils/format'
import { useAuthStore } from '../../stores/authStore'
import { accessFor } from '../../hooks/useStaff'

export function WarehousesPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ name: '', state: '', city: '', address: '', contact_person: '', contact_phone: '', whatsapp_group: '' })
  const { showToast } = useAppStore()
  const queryClient = useQueryClient()

  // Warehouse management is switchable per staff member by the CEO —
  // a direct URL must respect the toggle too
  const allowed = accessFor(user).includes('warehouses')

  // Management view includes deactivated warehouses (operational
  // pickers elsewhere only ever see active ones)
  const { data: warehouses } = useQuery({
    queryKey: ['warehouses_admin'],
    queryFn: async () => {
      const { data, error } = await supabase.from('warehouses').select('*').order('name')
      if (error) throw error
      return data || []
    },
    staleTime: 30000,
  })

  // Fulfillment officers covering each warehouse's state (assignment
  // itself lives in Staff Management → Assigned States)
  const officersQ = useQuery({
    queryKey: ['fulfillment_officers_states'],
    queryFn: async () => {
      try {
        const { data, error } = await supabase.from('staff_users')
          .select('id, name, assigned_states')
          .eq('role', 'fulfillment').eq('is_active', true)
        if (error) throw error
        return data || []
      } catch { return [] }
    },
    staleTime: 60000,
  })
  const officersFor = (state) =>
    (officersQ.data || []).filter(o => Array.isArray(o.assigned_states) && o.assigned_states.includes(state))

  const toggleActive = useMutation({
    mutationFn: async (w) => {
      const { error } = await supabase.from('warehouses')
        .update({ is_active: w.is_active === false }).eq('id', w.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['warehouses'] })
      queryClient.invalidateQueries({ queryKey: ['warehouses_admin'] })
      showToast('Warehouse status updated', 'success')
    },
    onError: (err) => showToast(err.message, 'error'),
  })

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      if (editing) {
        const { error } = await supabase.from('warehouses').update(data).eq('id', editing.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('warehouses').insert(data)
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['warehouses'] })
      queryClient.invalidateQueries({ queryKey: ['warehouses_admin'] })
      showToast(editing ? 'Warehouse updated' : 'Warehouse added', 'success')
      setShowModal(false)
      setEditing(null)
    },
    onError: (err) => showToast(err.message, 'error'),
  })

  function openEdit(w) {
    setEditing(w)
    setForm({ name: w.name, state: w.state, city: w.city || '', address: w.address || '',
      contact_person: w.contact_person || '', contact_phone: w.contact_phone || '', whatsapp_group: w.whatsapp_group || '' })
    setShowModal(true)
  }

  if (!allowed) return <Navigate to="/settings" replace />

  return (
    <div className="flex flex-col h-full overflow-x-hidden w-full">
      <TopBar
        title="Warehouses"
        actions={
          <button onClick={() => { setEditing(null); setForm({ name: '', state: '', city: '', address: '', contact_person: '', contact_phone: '', whatsapp_group: '' }); setShowModal(true) }}
            className="p-2 bg-blue-600 text-black rounded-xl active:scale-95">
            <Plus size={20} />
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-3">
        <p className="text-xs text-gray-500">
          Warehouses with stock or order history are deactivated, never deleted — records stay intact.
        </p>
        {(warehouses || []).map(w => {
          const inactive = w.is_active === false
          const officers = officersFor(w.state)
          return (
          <div key={w.id} className={`bg-white rounded-2xl p-4 border border-gray-100 ${inactive ? 'opacity-60' : ''}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-bold text-gray-900">{w.name}</p>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                    inactive ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
                  }`}>
                    {inactive ? 'INACTIVE' : 'ACTIVE'}
                  </span>
                </div>
                <p className="text-xs text-gray-500">{w.state}{w.city ? `, ${w.city}` : ''}</p>
                {w.address && <p className="text-xs text-gray-400">{w.address}</p>}
                {w.contact_person && <p className="text-xs text-gray-400">{w.contact_person} · {w.contact_phone}</p>}
                {w.whatsapp_group && <p className="text-xs text-gray-400">WA: {w.whatsapp_group}</p>}
                <p className="text-[11px] text-gray-400 mt-1">
                  Fulfillment: {officers.length > 0
                    ? officers.map(o => o.name).join(', ')
                    : 'no officer assigned to this state yet'}
                </p>
              </div>
              <button onClick={() => openEdit(w)} className="p-2 bg-gray-100 rounded-xl active:scale-95 shrink-0">
                <Edit size={16} className="text-gray-600" />
              </button>
            </div>
            <div className="flex gap-2 mt-3">
              <Button size="sm" variant="secondary" className="flex-1"
                onClick={() => navigate('/inventory?tab=warehouse')}>
                <span className="flex items-center justify-center gap-1.5"><Package size={13} /> View Stock</span>
              </Button>
              <Button size="sm" variant={inactive ? 'primary' : 'danger'} className="flex-1"
                loading={toggleActive.isPending}
                onClick={() => {
                  if (inactive || window.confirm(`Deactivate ${w.name}? Its records stay intact.`)) {
                    toggleActive.mutate(w)
                  }
                }}>
                {inactive ? 'Reactivate' : 'Deactivate'}
              </Button>
            </div>
          </div>
        )})}
      </div>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Warehouse' : 'Add Warehouse'}
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowModal(false)} className="flex-1">Cancel</Button>
            <Button onClick={() => saveMutation.mutate(form)} loading={saveMutation.isPending} className="flex-1"
              disabled={!form.name || !form.state}>Save</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input label="Warehouse Name" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Select label="State" required value={form.state} onChange={e => setForm({ ...form, state: e.target.value })}>
              <option value="">Select state...</option>
              {NIGERIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </Select>
            <Input label="City" value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} />
          </div>
          <Input label="Address" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
          <Input label="Contact Person" value={form.contact_person} onChange={e => setForm({ ...form, contact_person: e.target.value })} />
          <Input label="Contact Phone" type="tel" value={form.contact_phone} onChange={e => setForm({ ...form, contact_phone: e.target.value })} />
          <Input label="WhatsApp Group Name" placeholder="e.g. Lagos Warehouse WA Group"
            value={form.whatsapp_group} onChange={e => setForm({ ...form, whatsapp_group: e.target.value })} />
        </div>
      </Modal>
    </div>
  )
}
