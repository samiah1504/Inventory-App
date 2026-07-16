import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, Edit, CheckCircle, AlertCircle, Tag, GitMerge } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useBusinesses } from '../../hooks/useBusinesses'
import { TopBar } from '../../components/layout/TopBar'
import { SearchBar } from '../../components/ui/SearchBar'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { Input, Select } from '../../components/ui/Input'
import { Badge } from '../../components/ui/Badge'
import { useAuthStore } from '../../stores/authStore'
import { useAppStore } from '../../stores/appStore'
import { formatCurrency, formatDate } from '../../utils/format'
import { findLinkedOrders, applyProductToOrders } from '../../lib/productLinkUpdates'

const EMPTY_FORM = {
  name: '', business_id: '', category_id: '', selling_price: '', cost_price: '',
  sku: '', image_url: '', description: '', is_verified: true,
}

export function ProductsPage() {
  const [searchParams] = useSearchParams()
  const [mainTab, setMainTab] = useState('products')
  const [search, setSearch] = useState('')
  const [filterBusiness, setFilterBusiness] = useState('')
  const [filterTab, setFilterTab] = useState(searchParams.get('tab') === 'unverified' ? 'unverified' : 'all')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [mergeSource, setMergeSource] = useState(null)
  const [mergeSearch, setMergeSearch] = useState('')
  // Verification flow: full correction form + linked-order summary
  const [verifying, setVerifying] = useState(null)
  const [vForm, setVForm] = useState(EMPTY_FORM)
  const [vApply, setVApply] = useState(true)
  const { user } = useAuthStore()
  // Cost price drives profit reporting — only the CEO enters or amends it
  const isCeo = ['ceo', 'super_admin'].includes(user?.role) && !user?._preview

  // Every catalogue action leaves an audit record (best-effort pre-migration)
  async function audit(product_id, action, details) {
    try {
      await supabase.from('product_audit').insert({
        product_id, action, details,
        staff_id: user?.id || null, staff_name: user?.name || null,
      })
    } catch { /* table may not exist yet */ }
  }

  // Category management state
  const [showCatModal, setShowCatModal] = useState(false)
  const [editingCat, setEditingCat] = useState(null)
  const [catForm, setCatForm] = useState({ name: '', description: '' })

  const { data: businesses } = useBusinesses()
  const { showToast } = useAppStore()
  const queryClient = useQueryClient()

  const { data: products } = useQuery({
    queryKey: ['all_products', search, filterBusiness],
    queryFn: async () => {
      let query = supabase.from('products')
        .select('*, business:businesses(name), category:product_categories(name)')
        .order('name')
      if (filterBusiness) query = query.eq('business_id', filterBusiness)
      const { data, error } = await query
      if (error) throw error
      let list = data || []
      if (search) {
        const q = search.toLowerCase()
        list = list.filter(p =>
          (p.name || '').toLowerCase().includes(q) ||
          (p.sku ? String(p.sku).toLowerCase().includes(q) : false))
      }
      return list
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
      const { sku, image_url, description, ...core } = data
      const payload = {
        ...core,
        selling_price: data.selling_price ? Number(data.selling_price) : null,
        cost_price: data.cost_price ? Number(data.cost_price) : null,
      }
      // Only the CEO may set or amend cost price — an edit by anyone
      // else never touches the stored cost
      if (!isCeo && editing) delete payload.cost_price
      // SKU / image / description live in newer columns — save them
      // separately so the core save works pre-migration too
      const extras = { sku: sku || null, image_url: image_url || null, description: description || null }
      if (editing) {
        const { error } = await supabase.from('products').update(payload).eq('id', editing.id)
        if (error) throw error
        await supabase.from('products').update(extras).eq('id', editing.id)
        await audit(editing.id, 'edited', `Edited by ${user?.name}`)
      } else {
        const { data: created, error } = await supabase.from('products').insert(payload).select('id').single()
        if (error) throw error
        if (created) {
          await supabase.from('products').update(extras).eq('id', created.id)
          await audit(created.id, 'created', `Added by ${user?.name}`)
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all_products'] })
      queryClient.invalidateQueries({ queryKey: ['products'] })
      showToast(editing ? 'Product updated' : 'Product added', 'success')
      setShowModal(false)
      setEditing(null)
      setForm(EMPTY_FORM)
    },
    onError: (err) => showToast(err.message, 'error'),
  })

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }) => {
      const { error } = await supabase.from('products').update({ is_active: !is_active }).eq('id', id)
      if (error) throw error
      await audit(id, is_active ? 'deactivated' : 'reactivated',
        `${is_active ? 'Deactivated' : 'Reactivated'} by ${user?.name}`)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['all_products'] }),
  })

  // Orders that reference the product being verified (for the summary
  // and the past-order update)
  const linkedOrdersQ = useQuery({
    queryKey: ['product_linked_orders', verifying?.id],
    enabled: !!verifying,
    queryFn: () => findLinkedOrders(verifying),
    staleTime: 30000,
  })

  const verifyMutation = useMutation({
    mutationFn: async ({ product, form, apply }) => {
      const newName = form.name.trim()
      // Cost price is CEO-only; an Operations Manager's verify never
      // touches whatever cost the CEO has set
      const newCost = isCeo
        ? (form.cost_price ? Number(form.cost_price) : null)
        : (product.cost_price ?? null)
      const payload = {
        name: newName,
        business_id: form.business_id || null,
        category_id: form.category_id || null,
        selling_price: form.selling_price ? Number(form.selling_price) : null,
        cost_price: newCost,
        is_verified: true,
      }
      const { error } = await supabase.from('products').update(payload).eq('id', product.id)
      if (error) throw error
      // Newer columns — best-effort
      await supabase.from('products').update({
        sku: form.sku || null,
        verified_by: user?.name || null,
        verified_at: new Date().toISOString(),
      }).eq('id', product.id)

      // Correct the past orders that reference the unverified product:
      // official name + product link everywhere, and the verified cost on
      // lines without a confirmed historical cost
      let ordersUpdated = 0
      if (apply) {
        ordersUpdated = await applyProductToOrders({
          product,
          target: { id: product.id, name: newName, cost_price: newCost },
          applyCost: true,
          user,
          linkedOrders: linkedOrdersQ.data || null,
        })
      }

      const changes = [
        newName !== product.name ? `name "${product.name}" → "${newName}"` : null,
        form.business_id !== (product.business_id || '') ? 'business changed' : null,
        form.category_id !== (product.category_id || '') ? 'category changed' : null,
        newCost && Number(newCost) !== Number(product.cost_price || 0) ? `cost price ₦${Number(newCost).toLocaleString()}` : null,
      ].filter(Boolean).join('; ')
      await audit(product.id, 'verified',
        `Verified by ${user?.name}${changes ? ` — ${changes}` : ''} — ${ordersUpdated} linked order${ordersUpdated !== 1 ? 's' : ''} updated`)
      return { ordersUpdated }
    },
    onSuccess: ({ ordersUpdated }) => {
      // Names and costs on past orders changed — every list, document
      // source and report must recalculate
      queryClient.invalidateQueries()
      showToast(
        ordersUpdated > 0
          ? `Product verified — ${ordersUpdated} past order${ordersUpdated !== 1 ? 's' : ''} updated`
          : 'Product verified — available for order intake',
        'success')
      setVerifying(null)
    },
    onError: (err) => showToast(err.message, 'error'),
  })

  // Merge a duplicate into the final product. Linked orders are repointed
  // to the target AND adopt its official name; the target's cost price is
  // stamped on lines without a confirmed historical cost. The duplicate is
  // closed, never deleted — audit history stays intact.
  const mergeMutation = useMutation({
    mutationFn: async ({ source, target }) => {
      const ordersUpdated = await applyProductToOrders({
        product: source,
        target: { id: target.id, name: target.name, cost_price: target.cost_price },
        applyCost: true,
        user,
      })
      try {
        const { data: srcRows } = await supabase.from('inventory').select('*').eq('product_id', source.id)
        for (const row of (srcRows || [])) {
          const { data: tgtRows } = await supabase.from('inventory').select('*')
            .eq('product_id', target.id).eq('warehouse_id', row.warehouse_id).limit(1)
          const tgt = tgtRows?.[0]
          if (tgt) {
            await supabase.from('inventory').update({
              quantity_physical: (tgt.quantity_physical || 0) + (row.quantity_physical || 0),
              quantity_available: (tgt.quantity_available || 0) + (row.quantity_available || 0),
              quantity_reserved: (tgt.quantity_reserved || 0) + (row.quantity_reserved || 0),
            }).eq('id', tgt.id)
            await supabase.from('inventory').delete().eq('id', row.id)
          } else {
            await supabase.from('inventory').update({ product_id: target.id }).eq('id', row.id)
          }
        }
      } catch (e) { console.warn('inventory merge', e) }
      await supabase.from('inventory_movements').update({ product_id: target.id }).eq('product_id', source.id)
      await supabase.from('holding_queue').update({ product_id: target.id }).eq('product_id', source.id)
      const { error } = await supabase.from('products')
        .update({ is_active: false, is_verified: true }).eq('id', source.id)
      if (error) throw error
      await supabase.from('products').update({ merged_into: target.id }).eq('id', source.id)
      await audit(source.id, 'merged',
        `Merged into "${target.name}" by ${user?.name} — ${ordersUpdated} linked order${ordersUpdated !== 1 ? 's' : ''} updated to the official name`)
      await audit(target.id, 'merge_target', `"${source.name}" merged into this product by ${user?.name}`)
      return { ordersUpdated }
    },
    onSuccess: ({ ordersUpdated }) => {
      queryClient.invalidateQueries()
      showToast(
        ordersUpdated > 0
          ? `Products merged — ${ordersUpdated} past order${ordersUpdated !== 1 ? 's' : ''} now show the official product`
          : 'Products merged — history moved to the final product',
        'success')
      setMergeSource(null)
      setMergeSearch('')
    },
    onError: (err) => showToast(err.message, 'error'),
  })

  const saveCatMutation = useMutation({
    mutationFn: async (data) => {
      if (editingCat) {
        const { error } = await supabase.from('product_categories').update(data).eq('id', editingCat.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('product_categories').insert(data)
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] })
      showToast(editingCat ? 'Category updated' : 'Category added', 'success')
      setShowCatModal(false)
      setEditingCat(null)
      setCatForm({ name: '', description: '' })
    },
    onError: (err) => showToast(err.message, 'error'),
  })

  function openEdit(p) {
    setEditing(p)
    setForm({ name: p.name, business_id: p.business_id || '', category_id: p.category_id || '',
      selling_price: p.selling_price || '', cost_price: p.cost_price || '',
      sku: p.sku || '', image_url: p.image_url || '', description: p.description || '',
      is_verified: p.is_verified })
    setShowModal(true)
  }

  function openCatEdit(cat) {
    setEditingCat(cat)
    setCatForm({ name: cat.name, description: cat.description || '' })
    setShowCatModal(true)
  }

  function openNewCat() {
    setEditingCat(null)
    setCatForm({ name: '', description: '' })
    setShowCatModal(true)
  }

  const allProducts = products || []
  const unverified = allProducts.filter(p => !p.is_verified)
  const visibleProducts = filterTab === 'unverified'
    ? allProducts.filter(p => !p.is_verified)
    : filterTab === 'inactive'
    ? allProducts.filter(p => !p.is_active)
    : allProducts

  return (
    <div className="flex flex-col h-full overflow-x-hidden w-full">
      <TopBar
        title="Products"
        actions={
          <button
            onClick={() => mainTab === 'categories' ? openNewCat() : (setEditing(null), setForm(EMPTY_FORM), setShowModal(true))}
            className="p-2 bg-blue-600 text-black rounded-xl active:scale-95"
          >
            <Plus size={20} />
          </button>
        }
      />

      {/* Main tab switcher */}
      <div className="px-4 pt-3 pb-0 bg-white border-b border-gray-100 sticky top-[57px] z-20 space-y-2">
        <div className="flex gap-2 border-b border-gray-100 pb-2">
          <button onClick={() => setMainTab('products')}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-xl transition-all ${mainTab === 'products' ? 'bg-blue-600 text-black' : 'bg-gray-100 text-gray-600'}`}>
            Products
          </button>
          <button onClick={() => setMainTab('categories')}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-xl transition-all ${mainTab === 'categories' ? 'bg-blue-600 text-black' : 'bg-gray-100 text-gray-600'}`}>
            <Tag size={14} /> Categories {categories?.length ? `(${categories.length})` : ''}
          </button>
        </div>

        {mainTab === 'products' && (
          <div className="space-y-2 pb-2">
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
                  className={`px-3 py-1.5 rounded-full text-xs font-medium ${filterTab === key ? 'bg-blue-600 text-black' : 'bg-gray-100 text-gray-600'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {mainTab === 'products' ? (
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-3">
          <p className="text-xs text-gray-500">{visibleProducts.length} product{visibleProducts.length !== 1 ? 's' : ''}</p>
          {visibleProducts.map(p => (
            <div key={p.id} className="bg-white rounded-2xl p-4 border border-gray-100">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <p className="text-sm font-semibold text-gray-900">{p.name}</p>
                    {!p.is_verified && <Badge color="amber">Unverified</Badge>}
                    {!p.is_active && <Badge color="red">Inactive</Badge>}
                  </div>
                  <p className="text-xs text-gray-500">
                    {p.business?.name} · {p.category?.name || 'No category'}{p.sku ? ` · SKU ${p.sku}` : ''}
                  </p>
                  <div className="flex gap-3 mt-1">
                    {p.selling_price && <p className="text-xs text-green-600 font-medium">Sale: {formatCurrency(p.selling_price)}</p>}
                    {p.cost_price && <p className="text-xs text-gray-500">Cost: {formatCurrency(p.cost_price)}</p>}
                  </div>
                  {!p.is_verified && (p.created_by_name || p.first_order_number || p.created_at) && (
                    <p className="text-[11px] text-gray-400 mt-1">
                      {[
                        p.created_by_name ? `Added by ${p.created_by_name}` : null,
                        p.created_at ? formatDate(p.created_at) : null,
                        p.first_order_number ? `first used in ${p.first_order_number}` : null,
                      ].filter(Boolean).join(' · ')}
                    </p>
                  )}
                  {p.merged_into && <p className="text-[11px] text-gray-400 mt-0.5">Merged into another product</p>}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => openEdit(p)} className="p-2 bg-gray-100 rounded-xl active:scale-95">
                    <Edit size={16} className="text-gray-600" />
                  </button>
                  <button onClick={() => { setMergeSource(p); setMergeSearch('') }}
                    className="p-2 bg-purple-50 rounded-xl active:scale-95" title="Merge into another product">
                    <GitMerge size={16} className="text-purple-600" />
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
                  onClick={() => {
                    setVerifying(p)
                    setVApply(true)
                    setVForm({
                      name: p.name, business_id: p.business_id || '', category_id: p.category_id || '',
                      selling_price: p.selling_price || '', cost_price: p.cost_price || '',
                      sku: p.sku || '', image_url: p.image_url || '', description: p.description || '',
                      is_verified: true,
                    })
                  }}
                  className="mt-2 w-full py-1.5 text-xs font-medium text-green-700 bg-green-50 rounded-lg flex items-center justify-center gap-1 active:scale-95 transition-all"
                >
                  <CheckCircle size={12} /> Verify Product
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-3">
          <p className="text-xs text-gray-500">{(categories || []).length} categor{(categories || []).length !== 1 ? 'ies' : 'y'}</p>
          {(categories || []).length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <Tag size={32} className="mx-auto mb-2 opacity-40" />
              <p className="text-sm">No categories yet</p>
              <button onClick={openNewCat} className="mt-3 text-sm text-blue-600 font-medium">Add first category</button>
            </div>
          )}
          {(categories || []).map(cat => {
            const productCount = allProducts.filter(p => p.category_id === cat.id).length
            return (
              <div key={cat.id} className="bg-white rounded-2xl p-4 border border-gray-100">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{cat.name}</p>
                    {cat.description && <p className="text-xs text-gray-500 mt-0.5">{cat.description}</p>}
                    <p className="text-xs text-gray-400 mt-0.5">{productCount} product{productCount !== 1 ? 's' : ''}</p>
                  </div>
                  <button onClick={() => openCatEdit(cat)} className="p-2 bg-gray-100 rounded-xl active:scale-95 shrink-0">
                    <Edit size={16} className="text-gray-600" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Product modal */}
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
            <Input label={isCeo ? 'Cost Price (₦)' : 'Cost Price (CEO only)'} type="number" inputMode="decimal"
              disabled={!isCeo}
              value={form.cost_price} onChange={e => setForm({ ...form, cost_price: e.target.value })} />
          </div>
          <Input label="SKU / Product Code" placeholder="e.g. KZ-TRI-001"
            value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} />
          <Input label="Product Image Link" type="url" placeholder="https:// — photo of the product"
            value={form.image_url} onChange={e => setForm({ ...form, image_url: e.target.value })} />
          <Input label="Description (optional)"
            value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
        </div>
      </Modal>

      {/* Product verification modal — corrections + linked-order update */}
      <Modal isOpen={!!verifying} onClose={() => setVerifying(null)} title="Verify Product"
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setVerifying(null)}>Cancel</Button>
            <Button className="flex-1"
              disabled={!vForm.name.trim() || !vForm.business_id}
              loading={verifyMutation.isPending}
              onClick={() => {
                const n = (linkedOrdersQ.data || []).length
                if (!window.confirm(
                  `Verify "${vForm.name.trim()}"${vApply && n > 0 ? ` and update ${n} linked order${n !== 1 ? 's' : ''}` : ''}?`
                )) return
                verifyMutation.mutate({ product: verifying, form: vForm, apply: vApply })
              }}>
              Verify Product
            </Button>
          </div>
        }
      >
        {verifying && (
          <div className="space-y-4">
            <p className="text-xs text-gray-500">
              Correct the details Customer Support typed during order entry. The verified record
              becomes the one official product used across the app.
            </p>
            <Input label="Product Name" required value={vForm.name}
              onChange={e => setVForm({ ...vForm, name: e.target.value })} />
            <Select label="Business" required value={vForm.business_id}
              onChange={e => setVForm({ ...vForm, business_id: e.target.value })}>
              <option value="">Select business...</option>
              {(businesses || []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
            <Select label="Category" value={vForm.category_id}
              onChange={e => setVForm({ ...vForm, category_id: e.target.value })}>
              <option value="">No category</option>
              {(categories || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Selling Price (₦)" type="number" inputMode="decimal"
                value={vForm.selling_price} onChange={e => setVForm({ ...vForm, selling_price: e.target.value })} />
              <Input label={isCeo ? 'Cost Price (₦)' : 'Cost Price (CEO only)'} type="number" inputMode="decimal"
                disabled={!isCeo}
                value={vForm.cost_price} onChange={e => setVForm({ ...vForm, cost_price: e.target.value })} />
            </div>
            {!isCeo && (
              <p className="text-[11px] text-gray-400 -mt-2">
                Cost price affects profit reporting and can only be entered or amended by the CEO.
              </p>
            )}
            <Input label="SKU / Product Code" placeholder="e.g. KZ-TRI-001"
              value={vForm.sku} onChange={e => setVForm({ ...vForm, sku: e.target.value })} />

            {/* Summary of what verification will do */}
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 space-y-1.5">
              <p className="text-xs font-semibold text-blue-900">Verification Summary</p>
              {vForm.name.trim() !== verifying.name ? (
                <p className="text-xs text-blue-800">
                  Name: <span className="line-through opacity-60">{verifying.name}</span>{' '}
                  → <span className="font-semibold">{vForm.name.trim()}</span>
                </p>
              ) : (
                <p className="text-xs text-blue-800">Name unchanged: {verifying.name}</p>
              )}
              <p className="text-xs text-blue-800">
                Linked orders: <span className="font-semibold">
                  {linkedOrdersQ.isLoading ? 'checking...' : (linkedOrdersQ.data || []).length}
                </span>
              </p>
              {isCeo && vForm.cost_price && (
                <p className="text-xs text-blue-800">
                  Unit cost: <span className="font-semibold">{formatCurrency(Number(vForm.cost_price))}</span>
                  {' '}— applied only to order lines without a confirmed historical cost
                </p>
              )}
              <p className="text-[11px] text-blue-700 opacity-80">
                Sales, product, COGS, profit and P&amp;L reports recalculate automatically. Invoices,
                receipts, delivery notes and packing lists generated afterwards use the verified name.
              </p>
            </div>

            <label className="flex items-start gap-2.5 bg-gray-50 rounded-xl p-3 cursor-pointer">
              <input type="checkbox" checked={vApply}
                onChange={e => setVApply(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-yellow-400 shrink-0" />
              <span className="text-xs text-gray-700">
                Apply verified name and cost to linked orders without confirmed historical costs.
                Costs already confirmed on past orders are never overwritten.
              </span>
            </label>
          </div>
        )}
      </Modal>

      {/* Merge duplicate modal */}
      <Modal isOpen={!!mergeSource} onClose={() => setMergeSource(null)}
        title="Merge with Existing Product">
        <div className="space-y-3">
          {mergeSource && (
            <div className="bg-purple-50 rounded-xl p-3">
              <p className="text-xs text-purple-700">
                <span className="font-semibold">"{mergeSource.name}"</span> will be closed and all its
                orders, stock and history moved to the product you pick below. Past orders adopt the
                official product name, and its cost price applies to order lines without a confirmed
                historical cost. Audit history is preserved.
              </p>
            </div>
          )}
          <SearchBar value={mergeSearch} onChange={setMergeSearch} placeholder="Search the product to keep..." />
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {allProducts
              .filter(t => t.id !== mergeSource?.id && !t.merged_into)
              .filter(t => !mergeSearch || (t.name || '').toLowerCase().includes(mergeSearch.toLowerCase()))
              .slice(0, 30)
              .map(t => (
                <button key={t.id}
                  disabled={mergeMutation.isPending}
                  onClick={() => {
                    if (window.confirm(`Merge "${mergeSource.name}" into "${t.name}"?`)) {
                      mergeMutation.mutate({ source: mergeSource, target: t })
                    }
                  }}
                  className="w-full text-left bg-white border border-gray-100 rounded-xl p-3 active:bg-gray-50">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-gray-900">{t.name}</p>
                    {t.is_verified ? <Badge color="green">Verified</Badge> : <Badge color="amber">Unverified</Badge>}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {t.business?.name}{t.selling_price ? ` · ${formatCurrency(t.selling_price)}` : ''}
                  </p>
                </button>
              ))}
          </div>
        </div>
      </Modal>

      {/* Category modal */}
      <Modal isOpen={showCatModal} onClose={() => setShowCatModal(false)} title={editingCat ? 'Edit Category' : 'Add Category'}
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowCatModal(false)} className="flex-1">Cancel</Button>
            <Button onClick={() => saveCatMutation.mutate(catForm)} loading={saveCatMutation.isPending} className="flex-1"
              disabled={!catForm.name.trim()}>Save</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input label="Category Name" required value={catForm.name}
            onChange={e => setCatForm({ ...catForm, name: e.target.value })} />
          <Input label="Description (optional)" value={catForm.description}
            onChange={e => setCatForm({ ...catForm, description: e.target.value })} />
        </div>
      </Modal>
    </div>
  )
}
