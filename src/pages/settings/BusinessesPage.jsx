import { useState } from 'react'
import { Plus, Edit, ToggleLeft, ToggleRight } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useBusinesses } from '../../hooks/useBusinesses'
import { TopBar } from '../../components/layout/TopBar'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { useAppStore } from '../../stores/appStore'

export function BusinessesPage() {
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ name: '', short_code: '', invoice_prefix: '', address: '', phone: '' })
  const { data: businesses, isLoading } = useBusinesses()
  const { showToast } = useAppStore()
  const queryClient = useQueryClient()

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      if (editing) {
        const { error } = await supabase.from('businesses').update(data).eq('id', editing.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('businesses').insert(data)
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['businesses'] })
      showToast(editing ? 'Business updated' : 'Business added', 'success')
      setShowModal(false)
      setEditing(null)
      setForm({ name: '', short_code: '', invoice_prefix: '', address: '', phone: '' })
    },
    onError: (err) => showToast(err.message, 'error'),
  })

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }) => {
      const { error } = await supabase.from('businesses').update({ is_active: !is_active }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['businesses'] }),
  })

  function openEdit(b) {
    setEditing(b)
    setForm({ name: b.name, short_code: b.short_code, invoice_prefix: b.invoice_prefix, address: b.address || '', phone: b.phone || '' })
    setShowModal(true)
  }

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Businesses"
        actions={
          <button onClick={() => { setEditing(null); setForm({ name: '', short_code: '', invoice_prefix: '', address: '', phone: '' }); setShowModal(true) }}
            className="p-2 bg-blue-600 text-white rounded-xl active:scale-95">
            <Plus size={20} />
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {(businesses || []).map(b => (
          <div key={b.id} className="bg-white rounded-2xl p-4 border border-gray-100">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-bold text-gray-900">{b.name}</p>
                <p className="text-xs text-gray-500">Code: {b.short_code} · Prefix: {b.invoice_prefix}</p>
                {b.address && <p className="text-xs text-gray-400">{b.address}</p>}
              </div>
              <div className="flex gap-2">
                <button onClick={() => openEdit(b)} className="p-2 bg-gray-100 rounded-xl active:scale-95">
                  <Edit size={16} className="text-gray-600" />
                </button>
                <button onClick={() => toggleActive.mutate({ id: b.id, is_active: b.is_active })}
                  className={`p-2 rounded-xl active:scale-95 ${b.is_active ? 'bg-green-50' : 'bg-gray-50'}`}>
                  {b.is_active ? <ToggleRight size={16} className="text-green-600" /> : <ToggleLeft size={16} className="text-gray-400" />}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Business' : 'Add Business'}
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowModal(false)} className="flex-1">Cancel</Button>
            <Button onClick={() => saveMutation.mutate(form)} loading={saveMutation.isPending} className="flex-1"
              disabled={!form.name || !form.short_code || !form.invoice_prefix}>
              {editing ? 'Save' : 'Add'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input label="Business Name" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Short Code" placeholder="KZY" required value={form.short_code}
              onChange={e => setForm({ ...form, short_code: e.target.value.toUpperCase() })} maxLength={5} />
            <Input label="Invoice Prefix" placeholder="KZY" required value={form.invoice_prefix}
              onChange={e => setForm({ ...form, invoice_prefix: e.target.value.toUpperCase() })} maxLength={5} />
          </div>
          <Input label="Address" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
          <Input label="Phone" type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
        </div>
      </Modal>
    </div>
  )
}
