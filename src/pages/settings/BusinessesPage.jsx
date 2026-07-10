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
  const EMPTY = { name: '', short_code: '', invoice_prefix: '', address: '', phone: '',
    email: '', website: '', logo_url: '', bank_name: '', bank_account_name: '', bank_account_number: '' }
  const [form, setForm] = useState(EMPTY)
  const { data: businesses, isLoading } = useBusinesses()
  const { showToast } = useAppStore()
  const queryClient = useQueryClient()

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      // Branding/bank columns come from a newer migration — save the
      // core fields first, then the extras best-effort
      const { email, website, logo_url, bank_name, bank_account_name, bank_account_number, ...core } = data
      const extras = { email: email || null, website: website || null, logo_url: logo_url || null,
        bank_name: bank_name || null, bank_account_name: bank_account_name || null,
        bank_account_number: bank_account_number || null }
      if (editing) {
        const { error } = await supabase.from('businesses').update(core).eq('id', editing.id)
        if (error) throw error
        await supabase.from('businesses').update(extras).eq('id', editing.id)
      } else {
        const { data: created, error } = await supabase.from('businesses').insert(core).select('id').single()
        if (error) throw error
        if (created) await supabase.from('businesses').update(extras).eq('id', created.id)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['businesses'] })
      showToast(editing ? 'Business updated' : 'Business added', 'success')
      setShowModal(false)
      setEditing(null)
      setForm(EMPTY)
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
    setForm({ name: b.name, short_code: b.short_code, invoice_prefix: b.invoice_prefix,
      address: b.address || '', phone: b.phone || '',
      email: b.email || '', website: b.website || '', logo_url: b.logo_url || '',
      bank_name: b.bank_name || '', bank_account_name: b.bank_account_name || '',
      bank_account_number: b.bank_account_number || '' })
    setShowModal(true)
  }

  return (
    <div className="flex flex-col h-full overflow-x-hidden w-full">
      <TopBar
        title="Businesses"
        actions={
          <button onClick={() => { setEditing(null); setForm(EMPTY); setShowModal(true) }}
            className="p-2 bg-blue-600 text-black rounded-xl active:scale-95">
            <Plus size={20} />
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-3">
        {(businesses || []).map(b => (
          <div key={b.id} className="bg-white rounded-2xl p-4 border border-gray-100">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-bold text-gray-900">{b.name}</p>
                <p className="text-xs text-gray-500">Code: {b.short_code} · Prefix: {b.invoice_prefix}</p>
                {b.address && <p className="text-xs text-gray-400">{b.address}</p>}
                {(b.email || b.website) && (
                  <p className="text-xs text-gray-400">{[b.email, b.website].filter(Boolean).join(' · ')}</p>
                )}
                {b.bank_name && (
                  <p className="text-xs text-gray-400">
                    {b.bank_name} · {b.bank_account_name} · {b.bank_account_number}
                  </p>
                )}
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
          <div className="grid grid-cols-2 gap-3">
            <Input label="Email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
            <Input label="Website" placeholder="www.example.com" value={form.website} onChange={e => setForm({ ...form, website: e.target.value })} />
          </div>
          <Input label="Logo Link" type="url" placeholder="https:// — PNG or JPG of your logo"
            value={form.logo_url} onChange={e => setForm({ ...form, logo_url: e.target.value })} />
          <p className="text-[11px] text-gray-400 -mt-2">Shown on invoices. If empty, a monogram of the business initial is used.</p>
          <Input label="Bank Name" value={form.bank_name} onChange={e => setForm({ ...form, bank_name: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Account Name" value={form.bank_account_name} onChange={e => setForm({ ...form, bank_account_name: e.target.value })} />
            <Input label="Account Number" inputMode="numeric" value={form.bank_account_number} onChange={e => setForm({ ...form, bank_account_number: e.target.value })} />
          </div>
        </div>
      </Modal>
    </div>
  )
}
