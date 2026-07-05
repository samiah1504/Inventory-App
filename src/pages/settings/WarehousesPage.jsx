import { useState } from 'react'
import { Plus, Edit } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useWarehouses } from '../../hooks/useBusinesses'
import { TopBar } from '../../components/layout/TopBar'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { Input, Select } from '../../components/ui/Input'
import { useAppStore } from '../../stores/appStore'
import { NIGERIAN_STATES } from '../../utils/format'

export function WarehousesPage() {
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ name: '', state: '', city: '', address: '', contact_person: '', contact_phone: '', whatsapp_group: '' })
  const { data: warehouses } = useWarehouses()
  const { showToast } = useAppStore()
  const queryClient = useQueryClient()

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
        {(warehouses || []).map(w => (
          <div key={w.id} className="bg-white rounded-2xl p-4 border border-gray-100">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-bold text-gray-900">{w.name}</p>
                <p className="text-xs text-gray-500">{w.state}{w.city ? `, ${w.city}` : ''}</p>
                {w.contact_person && <p className="text-xs text-gray-400">{w.contact_person} · {w.contact_phone}</p>}
              </div>
              <button onClick={() => openEdit(w)} className="p-2 bg-gray-100 rounded-xl active:scale-95">
                <Edit size={16} className="text-gray-600" />
              </button>
            </div>
          </div>
        ))}
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
