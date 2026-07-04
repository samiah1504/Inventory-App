import { useState } from 'react'
import { Plus, Edit, CheckCircle, AlertCircle } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useBusinesses } from '../../hooks/useBusinesses'
import { TopBar } from '../../components/layout/TopBar'
import { SearchBar } from '../../components/ui/SearchBar'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { Input, Select } from '../../components/ui/Input'
import { Badge } from '../../components/ui/Badge'
import { useAppStore } from '../../stores/appStore'
import { formatCurrency } from '../../utils/format'

export function ProductsPage() {
  const [search, setSearch] = useState('')
  const [filterBusiness, setFilterBusiness] = useState('')
  const [filterTab, setFilterTab] = useState('all')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ name: '', business_id: '', category_id: '', selling_price: '', cost_price: '', is_verified: true })
  const { data: businesses } = useBusinesses()
  const { showToast } = useAppStore()
  const queryClient = useQueryClient()

  const { data: products } = useQuery({
    queryKey: ['all_products', search, filterBusiness],
    queryFn: async () => {
      let query = supabase.from('products')
        .select('*, business:businesses(name), category:product_categories(name)')
        .order('name')
      if (search) query = query.ilike('name', `%${search}%`)
      if (filterBusiness) query = query.eq('business_id', filterBusiness)
      const { data, error } = await query
      if (error) throw error
      return data || []
    },
    staleTime: 30000,
  })

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data, error } = await supabase.from('product_categories').select('*').order('name')
      if (error) throw error
      return data || []
    },
  })

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      const payload = {
        ...data,
        selling_price: data.selling_price ? Number(data.selling_price) : null,
        cost_price: data.cost_price ? Number(data.cost_price) : null,
      }
      if (editing) {
        const { error } = await supabase.from('products').update(payload).eq('id', editing.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('products').insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all_products'] })
      queryClient.invalidateQueries({ queryKey: ['products'] })
      showToast(editing ? 'Product updated' : 'Product added', 'success')
      setShowModal(false)
      setEditing(null)
      setForm({ name: '', business_id: '', category_id: '', selling_price: '', cost_price: '', is_verified: true })
    },
    onError: (err) => showToast(err.message, 'error'),
  })

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }) => {
      const { error } = await supabase.from('products').update({ is_active: !is_active }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['all_products'] }),
  })

  function openEdit(p) {
    setEditing(p)
    setForm({ name: p.name, business_id: p.business_id || '', category_id: p.category_id || '',
      selling_price: p.selling_price || '', cost_price: p.cost_price || '', is_verified: p.is_verified })
    setShowModal(true)
  }

  const allProducts = products || []
  const unverified = allProducts.filter(p => !p.is_verified)
  const visibleProducts = filterTab === 'unverified'
    ? allProducts.filter(p => !p.is_verified)
    : filterTab === 'inactive'
    ? allProducts.filter(p => !p.is_active)
    : allProducts

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Products"
        actions={
          <button onClick={() => { setEditing(null); setShowModal(true) }}
            className="p-2 bg-blue-600 text-white rounded-xl active:scale-95">
            <Plus size={20} />
          </button>
        }
      />
      <div className="px-4 py-3 bg-white border-b border-gray-100 sticky top-[57px] z-20 space-y-2">
        <SearchBar value={search} onChange={setSearch} placeholder="Search products..." />
        {businesses && businesses.length > 1 && (
          <select value={filterBusiness} onChange={e => setFilterBusiness(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All Businesses</option>
            {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        <div className="flex gap-2">
          {[
            { key: 'all', label: 'All' },
            { key: 'unverified', label: `Unverified${unverified.length ? ` (${unverified.length})` : ''}` },
            { key: 'inactive', label: 'Inactive' },
          ].map(({ key, label }) => (
            <button key={key} onClick={() => setFilterTab(key)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium ${filterTab === key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        <p className="text-xs text-gray-500">{visibleProducts.length} product{visibleProducts.length !== 1 ? 's' : ''}</p>
        {visibleProducts.map(p => (
          <div key={p.id} className="bg-white rounded-2xl p-4 border border-gray-100">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-sm font-semibold text-gray-900">{p.name}</p>
                  {!p.is_verified && <Badge color="amber">Unverified</Badge>}
                  {!p.is_active && <Badge color="red">Inactive</Badge>}
                </div>
                <p className="text-xs text-gray-500">{p.business?.name} · {p.category?.name}</p>
                <div className="flex gap-3 mt-1">
                  {p.selling_price && <p className="text-xs text-green-600 font-medium">Sale: {formatCurrency(p.selling_price)}</p>}
                  {p.cost_price && <p className="text-xs text-gray-500">Cost: {formatCurrency(p.cost_price)}</p>}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => openEdit(p)} className="p-2 bg-gray-100 rounded-xl active:scale-95">
                  <Edit size={16} className="text-gray-600" />
                </button>
                <button
                  onClick={() => toggleActive.mutate({ id: p.id, is_active: p.is_active })}
                  className={`p-2 rounded-xl active:scale-95 transition-all ${p.is_active ? 'bg-red-50 text-red-500' : 'bg-green-50 text-green-600'}`}
                  title={p.is_active ? 'Deactivate' : 'Activate'}
                >
                  {p.is_active ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                </button>
              </div>
            </div>
            {!p.is_verified && (
              <button
                onClick={() => supabase.from('products').update({ is_verified: true }).eq('id', p.id).then(() => queryClient.invalidateQueries({ queryKey: ['all_products'] }))}
                className="mt-2 w-full py-1.5 text-xs font-medium text-green-700 bg-green-50 rounded-lg flex items-center justify-center gap-1 active:scale-95 transition-all"
              >
                <CheckCircle size={12} /> Approve Product
              </button>
            )}
          </div>
        ))}
      </div>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Product' : 'Add Product'}
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowModal(false)} className="flex-1">Cancel</Button>
            <Button onClick={() => saveMutation.mutate(form)} loading={saveMutation.isPending} className="flex-1"
              disabled={!form.name || !form.business_id}>Save</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input label="Product Name" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <Select label="Business" required value={form.business_id} onChange={e => setForm({ ...form, business_id: e.target.value })}>
            <option value="">Select business...</option>
            {(businesses || []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
          <Select label="Category" value={form.category_id} onChange={e => setForm({ ...form, category_id: e.target.value })}>
            <option value="">No category</option>
            {(categories || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Selling Price (₦)" type="number" inputMode="decimal"
              value={form.selling_price} onChange={e => setForm({ ...form, selling_price: e.target.value })} />
            <Input label="Cost Price (₦)" type="number" inputMode="decimal"
              value={form.cost_price} onChange={e => setForm({ ...form, cost_price: e.target.value })} />
          </div>
        </div>
      </Modal>
    </div>
  )
}
