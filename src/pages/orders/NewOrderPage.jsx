import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { Search, Plus, X, Trash2 } from 'lucide-react'
import { TopBar } from '../../components/layout/TopBar'
import { Input, Select, Textarea } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { useCreateOrder } from '../../hooks/useOrders'
import { useBusinesses, useProducts } from '../../hooks/useBusinesses'
import { useAuthStore } from '../../stores/authStore'
import { NIGERIAN_STATES, ORDER_SOURCES, DELIVERY_WINDOWS, formatCurrency } from '../../utils/format'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../stores/appStore'

function newItem() {
  return { key: Date.now() + Math.random(), product_id: '', product_name: '', business_id: '', quantity: 1, unit_price: '', color: '', size: '' }
}

export function NewOrderPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user } = useAuthStore()
  const { showToast } = useAppStore()
  const createOrder = useCreateOrder()
  const { data: businesses } = useBusinesses()
  const { data: allProducts } = useProducts()

  const [items, setItems] = useState([newItem()])
  const [activeSearchIdx, setActiveSearchIdx] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [customerHistory, setCustomerHistory] = useState(null)

  const [showCustomModal, setShowCustomModal] = useState(false)
  const [customForm, setCustomForm] = useState({ name: '', business_id: '', selling_price: '' })
  const [savingCustom, setSavingCustom] = useState(false)

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm({
    defaultValues: {
      source: 'WhatsApp',
      preferred_delivery_time: 'Anytime',
      customer_phone: searchParams.get('phone') || '',
      customer_name: searchParams.get('name') || '',
      address: searchParams.get('address') || '',
      city: searchParams.get('city') || '',
      state: searchParams.get('state') || '',
    }
  })

  const watchPhone = watch('customer_phone')

  const grandTotal = items.reduce((s, item) =>
    s + (Number(item.quantity) || 0) * (Number(item.unit_price) || 0), 0)

  const firstBusinessId = items.find(i => i.business_id)?.business_id || ''
  const firstBusinessName = businesses?.find(b => b.id === firstBusinessId)?.name || ''

  const filteredProducts = (allProducts || []).filter(p =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.business?.name?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (watchPhone?.length >= 10) {
        const { data } = await supabase
          .from('customers')
          .select('*, addresses:customer_addresses(*)')
          .eq('phone', watchPhone)
          .single()
        setCustomerHistory(data)
        if (data) {
          setValue('customer_name', data.name)
          const primaryAddr = data.addresses?.find(a => a.is_primary) || data.addresses?.[0]
          if (primaryAddr) {
            setValue('address', primaryAddr.address || '')
            setValue('city', primaryAddr.city || '')
            setValue('state', primaryAddr.state || '')
          }
        }
      } else {
        setCustomerHistory(null)
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [watchPhone, setValue])

  function updateItem(idx, updates) {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, ...updates } : item))
  }

  function removeItem(idx) {
    setItems(prev => prev.filter((_, i) => i !== idx))
  }

  function selectProduct(product) {
    updateItem(activeSearchIdx, {
      product_id: product.id,
      product_name: product.name,
      business_id: product.business_id,
      unit_price: product.selling_price || '',
    })
    setActiveSearchIdx(null)
    setSearchQuery('')
  }

  async function onSubmit(data) {
    const validItems = items.filter(i => i.product_name.trim())
    if (validItems.length === 0) {
      showToast('Please add at least one product', 'error')
      return
    }
    if (!firstBusinessId) {
      showToast('Please select a product from the list first', 'error')
      return
    }

    const primaryItem = validItems[0]
    const summaryName = validItems.length === 1
      ? primaryItem.product_name
      : `${primaryItem.product_name} +${validItems.length - 1} more`

    const result = await createOrder.mutateAsync({
      ...data,
      business_id: firstBusinessId,
      product_id: primaryItem.product_id || null,
      product_name: summaryName,
      quantity: Number(primaryItem.quantity) || 1,
      unit_price: Number(primaryItem.unit_price) || 0,
      color: primaryItem.color || null,
      size: primaryItem.size || null,
      total_amount: grandTotal,
      items: validItems.map(item => ({
        product_id: item.product_id || null,
        product_name: item.product_name,
        quantity: Number(item.quantity) || 1,
        unit_price: Number(item.unit_price) || 0,
        total_amount: (Number(item.quantity) || 1) * (Number(item.unit_price) || 0),
        color: item.color || null,
        size: item.size || null,
      })),
    })
    if (result) navigate(`/orders/${result.id}`)
  }

  async function saveCustomProduct() {
    if (!customForm.name.trim() || !customForm.business_id) {
      showToast('Product name and business are required', 'error')
      return
    }
    setSavingCustom(true)
    try {
      const { data, error } = await supabase
        .from('products')
        .insert({
          name: customForm.name.trim(),
          business_id: customForm.business_id,
          selling_price: customForm.selling_price ? Number(customForm.selling_price) : null,
          created_by: user?.id,
          is_active: true,
          is_verified: false,
        })
        .select('*, business:businesses(name)')
        .single()
      if (error) throw error
      // Re-open search so user can select the new product
      setShowCustomModal(false)
      setCustomForm({ name: '', business_id: '', selling_price: '' })
      showToast('Product added — select it below', 'success')
      setSearchQuery(data.name)
    } catch (err) {
      showToast(err.message, 'error')
    } finally {
      setSavingCustom(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <TopBar title="New Order" />
      <div className="flex-1 overflow-y-auto">
        <form onSubmit={handleSubmit(onSubmit)} className="px-4 py-4 space-y-4 pb-8">

          {/* Customer Info */}
          <div className="bg-white rounded-2xl p-4 border border-gray-100 space-y-3">
            <h3 className="text-sm font-semibold text-gray-900">Customer Details</h3>

            {customerHistory && (
              <div className="bg-blue-50 rounded-xl p-3">
                <p className="text-xs text-blue-700 font-medium">Returning customer</p>
                <p className="text-xs text-blue-600">
                  {customerHistory.total_orders} orders · {formatCurrency(customerHistory.total_spent)} spent
                  {customerHistory.failed_orders > 0 && ` · ⚠️ ${customerHistory.failed_orders} failed`}
                </p>
              </div>
            )}

            <Input label="Phone Number" type="tel" placeholder="08012345678" inputMode="tel" required
              error={errors.customer_phone?.message}
              {...register('customer_phone', { required: 'Phone is required' })} />
            <Input label="Customer Name" placeholder="Full name" required
              error={errors.customer_name?.message}
              {...register('customer_name', { required: 'Name is required' })} />
            <Input label="Address" placeholder="Street address" {...register('address')} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="City / Area" placeholder="City" {...register('city')} />
              <Select label="State" required error={errors.state?.message}
                {...register('state', { required: 'State is required' })}>
                <option value="">State...</option>
                {NIGERIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </Select>
            </div>
          </div>

          {/* Products */}
          <div className="bg-white rounded-2xl p-4 border border-gray-100 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">Products</h3>
              {firstBusinessName && (
                <span className="text-xs font-medium text-yellow-700 bg-yellow-50 px-2 py-0.5 rounded-full">
                  {firstBusinessName}
                </span>
              )}
            </div>

            {items.map((item, idx) => (
              <ItemRow
                key={item.key}
                item={item}
                idx={idx}
                canRemove={items.length > 1}
                onOpenSearch={() => { setActiveSearchIdx(idx); setSearchQuery(item.product_name || '') }}
                onUpdate={updates => updateItem(idx, updates)}
                onRemove={() => removeItem(idx)}
              />
            ))}

            <button
              type="button"
              onClick={() => setItems(prev => [...prev, newItem()])}
              className="w-full py-3 border-2 border-dashed border-gray-200 rounded-xl text-sm text-gray-500 font-medium flex items-center justify-center gap-2 active:scale-[0.99] transition-all hover:border-yellow-400 hover:text-yellow-600"
            >
              <Plus size={16} /> Add Another Product
            </button>

            {grandTotal > 0 && (
              <div className="bg-yellow-50 rounded-xl p-3 flex justify-between items-center">
                <span className="text-sm font-semibold text-yellow-800">Grand Total</span>
                <span className="text-xl font-bold text-yellow-800">{formatCurrency(grandTotal)}</span>
              </div>
            )}
          </div>

          {/* Delivery Info */}
          <div className="bg-white rounded-2xl p-4 border border-gray-100 space-y-3">
            <h3 className="text-sm font-semibold text-gray-900">Delivery Details</h3>
            <Input label="Delivery Note" placeholder="Assembly instructions, floor, etc."
              {...register('delivery_note')} />
            <Input label="Customer Requested Delivery Date" type="date"
              {...register('customer_requested_delivery_date')} />
            <Select label="Preferred Delivery Time" {...register('preferred_delivery_time')}>
              {DELIVERY_WINDOWS.map(w => <option key={w} value={w}>{w}</option>)}
            </Select>
          </div>

          {/* Order Source */}
          <div className="bg-white rounded-2xl p-4 border border-gray-100 space-y-3">
            <h3 className="text-sm font-semibold text-gray-900">Order Source</h3>
            <Select label="Order came from" {...register('source')}>
              {ORDER_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
            </Select>
            <Textarea label="Internal Notes" placeholder="Any internal notes about this order..."
              rows={2} {...register('internal_note')} />
          </div>

          <Button type="submit" size="xl" loading={createOrder.isPending} className="w-full">
            Create Order
          </Button>
        </form>
      </div>

      {/* Product Search Modal */}
      <Modal
        isOpen={activeSearchIdx !== null}
        onClose={() => { setActiveSearchIdx(null); setSearchQuery('') }}
        title="Select Product"
      >
        <div className="space-y-3">
          <Input
            placeholder="Search products..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            leftIcon={<Search size={16} />}
            autoFocus
          />
          <div className="space-y-0.5 max-h-64 overflow-y-auto -mx-2">
            {filteredProducts.length === 0 && searchQuery && (
              <p className="text-xs text-gray-400 text-center py-6">No products found</p>
            )}
            {filteredProducts.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => selectProduct(p)}
                className="w-full px-3 py-2.5 text-left hover:bg-gray-50 rounded-xl flex items-center justify-between gap-3 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{p.name}</p>
                  <p className="text-xs text-gray-400">{p.business?.name}{p.category?.name ? ` · ${p.category.name}` : ''}</p>
                </div>
                {p.selling_price && (
                  <span className="text-sm font-semibold text-gray-700 shrink-0">{formatCurrency(p.selling_price)}</span>
                )}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              setShowCustomModal(true)
              setCustomForm(f => ({ ...f, name: searchQuery }))
              setActiveSearchIdx(null)
            }}
            className="w-full py-2.5 text-sm text-blue-600 font-medium flex items-center justify-center gap-2 border-t border-gray-100 pt-3"
          >
            <Plus size={14} /> Add "{searchQuery || 'new product'}" as new product
          </button>
        </div>
      </Modal>

      {/* Custom Product Modal */}
      <Modal
        isOpen={showCustomModal}
        onClose={() => setShowCustomModal(false)}
        title="Add New Product"
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowCustomModal(false)} className="flex-1">Cancel</Button>
            <Button onClick={saveCustomProduct} loading={savingCustom} className="flex-1"
              disabled={!customForm.name.trim() || !customForm.business_id}>
              Add Product
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input label="Product Name" required value={customForm.name}
            onChange={e => setCustomForm(f => ({ ...f, name: e.target.value }))} />
          <Select label="Business" required value={customForm.business_id}
            onChange={e => setCustomForm(f => ({ ...f, business_id: e.target.value }))}>
            <option value="">Select business...</option>
            {(businesses || []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
          <Input label="Selling Price (₦) — optional" type="number" min="0" step="0.01" inputMode="decimal"
            value={customForm.selling_price}
            onChange={e => setCustomForm(f => ({ ...f, selling_price: e.target.value }))} />
          <p className="text-xs text-gray-400">This product will be saved and reviewed by an admin.</p>
        </div>
      </Modal>
    </div>
  )
}

function ItemRow({ item, idx, canRemove, onOpenSearch, onUpdate, onRemove }) {
  const itemTotal = (Number(item.quantity) || 0) * (Number(item.unit_price) || 0)
  return (
    <div className="bg-gray-50 rounded-xl p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold text-gray-400 shrink-0">#{idx + 1}</span>
        <button
          type="button"
          onClick={onOpenSearch}
          className="flex-1 flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-left active:scale-[0.99] transition-all min-w-0"
        >
          <Search size={14} className="text-gray-400 shrink-0" />
          <span className={`text-sm flex-1 truncate ${item.product_name ? 'text-gray-900 font-medium' : 'text-gray-400'}`}>
            {item.product_name || 'Select product...'}
          </span>
        </button>
        {canRemove && (
          <button type="button" onClick={onRemove}
            className="p-2 text-red-400 hover:bg-red-50 rounded-xl active:scale-95 transition-all shrink-0">
            <Trash2 size={16} />
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Input label="Qty" type="number" min="1" inputMode="numeric"
          value={item.quantity}
          onChange={e => onUpdate({ quantity: e.target.value })} />
        <Input label="Unit Price (₦)" type="number" min="0" step="0.01" inputMode="decimal"
          value={item.unit_price}
          onChange={e => onUpdate({ unit_price: e.target.value })} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Input label="Color (optional)" placeholder="e.g. Brown"
          value={item.color} onChange={e => onUpdate({ color: e.target.value })} />
        <Input label="Size (optional)" placeholder="e.g. 3x2"
          value={item.size} onChange={e => onUpdate({ size: e.target.value })} />
      </div>

      {itemTotal > 0 && (
        <div className="flex justify-between items-center pt-1">
          <span className="text-xs text-gray-500">Item subtotal</span>
          <span className="text-sm font-bold text-gray-800">{formatCurrency(itemTotal)}</span>
        </div>
      )}
    </div>
  )
}
