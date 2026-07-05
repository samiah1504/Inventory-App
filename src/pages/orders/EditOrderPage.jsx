import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { Search } from 'lucide-react'
import { TopBar } from '../../components/layout/TopBar'
import { Input, Select, Textarea } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { useOrder } from '../../hooks/useOrders'
import { useBusinesses, useProducts } from '../../hooks/useBusinesses'
import { useAuthStore } from '../../stores/authStore'
import { useAppStore } from '../../stores/appStore'
import { NIGERIAN_STATES, ORDER_SOURCES, DELIVERY_WINDOWS, formatCurrency } from '../../utils/format'
import { supabase } from '../../lib/supabase'
import { useQueryClient } from '@tanstack/react-query'

export function EditOrderPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { showToast } = useAppStore()
  const queryClient = useQueryClient()
  const { data: order, isLoading } = useOrder(id)
  const { data: businesses } = useBusinesses()
  const { data: allProducts } = useProducts()
  const [saving, setSaving] = useState(false)
  const [productSearch, setProductSearch] = useState('')
  const [showProductSearch, setShowProductSearch] = useState(false)

  const { register, handleSubmit, watch, setValue, reset, formState: { errors } } = useForm()

  const watchQuantity = watch('quantity')
  const watchUnitPrice = watch('unit_price')
  const watchBusinessId = watch('business_id')
  const total = (Number(watchQuantity) || 0) * (Number(watchUnitPrice) || 0)

  // Pre-fill form from existing order
  useEffect(() => {
    if (order) {
      reset({
        customer_name: order.customer_name,
        customer_phone: order.customer_phone,
        address: order.address || '',
        city: order.city || '',
        state: order.state,
        product_id: order.product_id || '',
        product_name: order.product_name,
        business_id: order.business_id || '',
        color: order.color || '',
        size: order.size || '',
        quantity: order.quantity,
        unit_price: order.unit_price,
        delivery_note: order.delivery_note || '',
        customer_requested_delivery_date: order.customer_requested_delivery_date || '',
        preferred_delivery_time: order.preferred_delivery_time || 'Anytime',
        source: order.source || 'WhatsApp',
        internal_note: order.internal_note || '',
      })
      setProductSearch(order.product_name || '')
    }
  }, [order, reset])

  const filteredProducts = (allProducts || []).filter(p =>
    p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
    p.business?.name?.toLowerCase().includes(productSearch.toLowerCase())
  )

  function selectProduct(product) {
    setValue('product_id', product.id)
    setValue('product_name', product.name)
    setValue('business_id', product.business_id)
    if (product.selling_price) setValue('unit_price', product.selling_price)
    setProductSearch(product.name)
    setShowProductSearch(false)
  }

  async function onSubmit(data) {
    if (!data.business_id) { showToast('Please select a product', 'error'); return }
    setSaving(true)
    try {
      const { error } = await supabase
        .from('orders')
        .update({
          customer_name: data.customer_name,
          customer_phone: data.customer_phone,
          address: data.address,
          city: data.city,
          state: data.state,
          product_id: data.product_id || null,
          product_name: data.product_name,
          business_id: data.business_id,
          color: data.color,
          size: data.size,
          quantity: Number(data.quantity),
          unit_price: Number(data.unit_price),
          total_amount: total || order.total_amount,
          delivery_note: data.delivery_note,
          customer_requested_delivery_date: data.customer_requested_delivery_date || null,
          preferred_delivery_time: data.preferred_delivery_time,
          source: data.source,
          internal_note: data.internal_note,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
      if (error) throw error

      await supabase.from('order_timeline').insert({
        order_id: id,
        action: 'edited',
        description: `Order edited by ${user?.name}`,
        staff_id: user?.id,
        staff_name: user?.name,
      })

      queryClient.invalidateQueries({ queryKey: ['orders'] })
      queryClient.invalidateQueries({ queryKey: ['order', id] })
      showToast('Order updated', 'success')
      navigate(`/orders/${id}`)
    } catch (err) {
      showToast(err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) return (
    <div className="flex flex-col h-full overflow-x-hidden w-full">
      <TopBar title="Edit Order" />
      <div className="flex-1 p-4 space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 shimmer rounded-2xl" />)}</div>
    </div>
  )

  if (!order || order.status !== 'new') {
    return (
      <div className="flex flex-col h-full overflow-x-hidden w-full">
        <TopBar title="Edit Order" />
        <div className="flex-1 flex items-center justify-center px-4">
          <p className="text-gray-500 text-center">This order can no longer be edited.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-x-hidden w-full">
      <TopBar title={`Edit ${order.order_number}`} />
      <div className="flex-1 overflow-y-auto">
        <form onSubmit={handleSubmit(onSubmit)} className="px-4 py-4 space-y-4 pb-8">

          {/* Customer */}
          <div className="bg-white rounded-2xl p-4 border border-gray-100 space-y-3">
            <h3 className="text-sm font-semibold text-gray-900">Customer Details</h3>
            <Input label="Phone Number" type="tel" inputMode="tel" required
              error={errors.customer_phone?.message}
              {...register('customer_phone', { required: 'Phone is required' })} />
            <Input label="Customer Name" required
              error={errors.customer_name?.message}
              {...register('customer_name', { required: 'Name is required' })} />
            <Input label="Address" {...register('address')} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="City / Area" {...register('city')} />
              <Select label="State" required error={errors.state?.message}
                {...register('state', { required: 'State is required' })}>
                <option value="">State...</option>
                {NIGERIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </Select>
            </div>
          </div>

          {/* Product */}
          <div className="bg-white rounded-2xl p-4 border border-gray-100 space-y-3">
            <h3 className="text-sm font-semibold text-gray-900">Product Details</h3>

            {watchBusinessId && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Business:</span>
                <span className="text-xs font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">
                  {businesses?.find(b => b.id === watchBusinessId)?.name || '—'}
                </span>
              </div>
            )}

            <div className="relative">
              <Input label="Product" placeholder="Search products..."
                value={productSearch}
                onChange={e => { setProductSearch(e.target.value); setValue('product_name', e.target.value); setShowProductSearch(true) }}
                onFocus={() => setShowProductSearch(true)}
                leftIcon={<Search size={16} />} required
                error={errors.product_name?.message}
              />
              <input type="hidden" {...register('product_name', { required: 'Product is required' })} />
              <input type="hidden" {...register('product_id')} />
              <input type="hidden" {...register('business_id')} />

              {showProductSearch && productSearch && (
                <div className="absolute z-30 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                  {filteredProducts.map(p => (
                    <button key={p.id} type="button" onClick={() => selectProduct(p)}
                      className="w-full px-4 py-2.5 text-left hover:bg-gray-50 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{p.name}</p>
                        <p className="text-xs text-gray-400">{p.business?.name}{p.category?.name ? ` · ${p.category.name}` : ''}</p>
                      </div>
                      {p.selling_price && <span className="text-sm font-medium text-gray-700">{formatCurrency(p.selling_price)}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input label="Color (optional)" {...register('color')} />
              <Input label="Size (optional)" {...register('size')} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Quantity" type="number" min="1" inputMode="numeric" required
                error={errors.quantity?.message}
                {...register('quantity', { required: true, min: 1, valueAsNumber: true })} />
              <Input label="Unit Price (₦)" type="number" min="0" step="0.01" inputMode="decimal" required
                error={errors.unit_price?.message}
                {...register('unit_price', { required: 'Price is required', valueAsNumber: true })} />
            </div>
            {total > 0 && (
              <div className="bg-blue-50 rounded-xl p-3">
                <p className="text-xs text-blue-600 mb-0.5">Total Amount</p>
                <p className="text-lg font-bold text-blue-700">{formatCurrency(total)}</p>
              </div>
            )}
          </div>

          {/* Delivery */}
          <div className="bg-white rounded-2xl p-4 border border-gray-100 space-y-3">
            <h3 className="text-sm font-semibold text-gray-900">Delivery Details</h3>
            <Input label="Delivery Note" placeholder="Assembly instructions, floor, etc." {...register('delivery_note')} />
            <Input label="Customer Requested Delivery Date" type="date" {...register('customer_requested_delivery_date')} />
            <Select label="Preferred Delivery Time" {...register('preferred_delivery_time')}>
              {DELIVERY_WINDOWS.map(w => <option key={w} value={w}>{w}</option>)}
            </Select>
          </div>

          {/* Source & Notes */}
          <div className="bg-white rounded-2xl p-4 border border-gray-100 space-y-3">
            <h3 className="text-sm font-semibold text-gray-900">Order Source</h3>
            <Select label="Order came from" {...register('source')}>
              {ORDER_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
            </Select>
            <Textarea label="Internal Notes" placeholder="Any internal notes..." rows={2} {...register('internal_note')} />
          </div>

          <Button type="submit" size="xl" loading={saving} className="w-full">Save Changes</Button>
        </form>
      </div>
      {showProductSearch && (
        <div className="fixed inset-0 z-20" onClick={() => setShowProductSearch(false)} />
      )}
    </div>
  )
}
