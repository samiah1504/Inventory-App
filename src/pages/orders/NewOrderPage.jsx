import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { Search, Plus, X } from 'lucide-react'
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

export function NewOrderPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user } = useAuthStore()
  const { showToast } = useAppStore()
  const createOrder = useCreateOrder()
  const { data: businesses } = useBusinesses()
  const { data: allProducts } = useProducts() // all products, no business filter

  const [productSearch, setProductSearch] = useState('')
  const [showProductSearch, setShowProductSearch] = useState(false)
  const [selectedProductLabel, setSelectedProductLabel] = useState('')
  const [customerHistory, setCustomerHistory] = useState(null)

  // Custom product modal state
  const [showCustomModal, setShowCustomModal] = useState(false)
  const [customForm, setCustomForm] = useState({ name: '', business_id: '', selling_price: '' })
  const [savingCustom, setSavingCustom] = useState(false)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors }
  } = useForm({
    defaultValues: {
      quantity: 1,
      source: 'WhatsApp',
      business_id: '',
      preferred_delivery_time: 'Anytime',
      customer_phone: searchParams.get('phone') || '',
      customer_name: searchParams.get('name') || '',
      address: searchParams.get('address') || '',
      city: searchParams.get('city') || '',
      state: searchParams.get('state') || '',
    }
  })

  const watchPhone = watch('customer_phone')
  const watchQuantity = watch('quantity')
  const watchUnitPrice = watch('unit_price')
  const watchBusinessId = watch('business_id')

  const total = (Number(watchQuantity) || 0) * (Number(watchUnitPrice) || 0)

  // Filter products by search text across all businesses
  const filteredProducts = (allProducts || []).filter(p =>
    p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
    p.business?.name?.toLowerCase().includes(productSearch.toLowerCase())
  )

  // Customer lookup
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
          const lastAddr = data.addresses?.[0]
          if (lastAddr) {
            setValue('address', lastAddr.address || '')
            setValue('city', lastAddr.city || '')
            setValue('state', lastAddr.state || '')
          }
        }
      } else {
        setCustomerHistory(null)
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [watchPhone, setValue])

  async function onSubmit(data) {
    if (!data.business_id) {
      showToast('Please select a product first — business is set automatically', 'error')
      return
    }
    const result = await createOrder.mutateAsync({
      ...data,
      total_amount: total,
      unit_price: Number(data.unit_price),
      quantity: Number(data.quantity),
    })
    if (result) navigate(`/orders/${result.id}`)
  }

  function selectProduct(product) {
    setValue('product_id', product.id)
    setValue('product_name', product.name)
    setValue('business_id', product.business_id)
    if (product.selling_price) setValue('unit_price', product.selling_price)
    const label = product.business?.name
      ? `${product.name} (${product.business.name})`
      : product.name
    setSelectedProductLabel(label)
    setProductSearch(product.name)
    setShowProductSearch(false)
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
      selectProduct(data)
      setShowCustomModal(false)
      setCustomForm({ name: '', business_id: '', selling_price: '' })
      showToast('Product added', 'success')
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

            <Input
              label="Phone Number"
              type="tel"
              placeholder="08012345678"
              inputMode="tel"
              required
              error={errors.customer_phone?.message}
              {...register('customer_phone', { required: 'Phone is required' })}
            />
            <Input
              label="Customer Name"
              placeholder="Full name"
              required
              error={errors.customer_name?.message}
              {...register('customer_name', { required: 'Name is required' })}
            />
            <Input
              label="Address"
              placeholder="Street address"
              {...register('address')}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="City / Area"
                placeholder="City"
                {...register('city')}
              />
              <Select
                label="State"
                required
                error={errors.state?.message}
                {...register('state', { required: 'State is required' })}
              >
                <option value="">State...</option>
                {NIGERIAN_STATES.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
            </div>
          </div>

          {/* Product */}
          <div className="bg-white rounded-2xl p-4 border border-gray-100 space-y-3">
            <h3 className="text-sm font-semibold text-gray-900">Product Details</h3>

            {/* Business pill — shown after product is selected */}
            {watchBusinessId && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Business:</span>
                <span className="text-xs font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">
                  {businesses?.find(b => b.id === watchBusinessId)?.name || '—'}
                </span>
              </div>
            )}

            {/* Product Search */}
            <div className="relative">
              <Input
                label="Product"
                placeholder="Search all products..."
                value={productSearch}
                onChange={(e) => {
                  setProductSearch(e.target.value)
                  setValue('product_name', e.target.value)
                  // Clear business/product if user clears the field
                  if (!e.target.value) {
                    setValue('business_id', '')
                    setValue('product_id', '')
                    setSelectedProductLabel('')
                  }
                  setShowProductSearch(true)
                }}
                onFocus={() => setShowProductSearch(true)}
                leftIcon={<Search size={16} />}
                required
                error={errors.product_name?.message}
              />
              <input type="hidden" {...register('product_name', { required: 'Product is required' })} />
              <input type="hidden" {...register('product_id')} />
              <input type="hidden" {...register('business_id')} />

              {showProductSearch && productSearch && (
                <div className="absolute z-30 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-52 overflow-y-auto">
                  {filteredProducts.length === 0 && (
                    <p className="px-4 py-3 text-xs text-gray-400">No products found</p>
                  )}
                  {filteredProducts.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => selectProduct(p)}
                      className="w-full px-4 py-2.5 text-left hover:bg-gray-50 flex items-center justify-between gap-3"
                    >
                      <div>
                        <p className="text-sm font-medium text-gray-900">{p.name}</p>
                        <p className="text-xs text-gray-400">
                          {p.business?.name}{p.category?.name ? ` · ${p.category.name}` : ''}
                        </p>
                      </div>
                      {p.selling_price && (
                        <span className="text-sm font-medium text-gray-700 shrink-0">
                          {formatCurrency(p.selling_price)}
                        </span>
                      )}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setShowCustomModal(true)
                      setShowProductSearch(false)
                      setCustomForm(f => ({ ...f, name: productSearch }))
                    }}
                    className="w-full px-4 py-2.5 text-left text-sm text-blue-600 font-medium flex items-center gap-2 border-t border-gray-100"
                  >
                    <Plus size={14} /> Add "{productSearch}" as new product
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input label="Color (optional)" placeholder="e.g. Brown" {...register('color')} />
              <Input label="Size (optional)" placeholder="e.g. 3x2" {...register('size')} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Quantity"
                type="number"
                min="1"
                inputMode="numeric"
                required
                error={errors.quantity?.message}
                {...register('quantity', { required: true, min: 1, valueAsNumber: true })}
              />
              <Input
                label="Unit Price (₦)"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                required
                error={errors.unit_price?.message}
                {...register('unit_price', { required: 'Price is required', min: 0, valueAsNumber: true })}
              />
            </div>

            {total > 0 && (
              <div className="bg-blue-50 rounded-xl p-3 flex justify-between items-center">
                <span className="text-sm font-medium text-blue-700">Total Amount</span>
                <span className="text-lg font-bold text-blue-700">{formatCurrency(total)}</span>
              </div>
            )}
            <input type="hidden" value={total} {...register('total_amount')} />
          </div>

          {/* Delivery Info */}
          <div className="bg-white rounded-2xl p-4 border border-gray-100 space-y-3">
            <h3 className="text-sm font-semibold text-gray-900">Delivery Details</h3>
            <Input
              label="Delivery Note"
              placeholder="Assembly instructions, floor, etc."
              {...register('delivery_note')}
            />
            <Input
              label="Customer Requested Delivery Date"
              type="date"
              {...register('customer_requested_delivery_date')}
            />
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
            <Textarea
              label="Internal Notes"
              placeholder="Any internal notes about this order..."
              rows={2}
              {...register('internal_note')}
            />
          </div>

          <Button
            type="submit"
            size="xl"
            loading={createOrder.isPending}
            className="w-full"
          >
            Create Order
          </Button>
        </form>
      </div>

      {/* Click outside to close product dropdown */}
      {showProductSearch && (
        <div className="fixed inset-0 z-20" onClick={() => setShowProductSearch(false)} />
      )}

      {/* Custom Product Modal */}
      <Modal
        isOpen={showCustomModal}
        onClose={() => setShowCustomModal(false)}
        title="Add New Product"
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowCustomModal(false)} className="flex-1">
              Cancel
            </Button>
            <Button
              onClick={saveCustomProduct}
              loading={savingCustom}
              className="flex-1"
              disabled={!customForm.name.trim() || !customForm.business_id}
            >
              Add Product
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input
            label="Product Name"
            required
            value={customForm.name}
            onChange={e => setCustomForm(f => ({ ...f, name: e.target.value }))}
          />
          <Select
            label="Business"
            required
            value={customForm.business_id}
            onChange={e => setCustomForm(f => ({ ...f, business_id: e.target.value }))}
          >
            <option value="">Select business...</option>
            {(businesses || []).map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </Select>
          <Input
            label="Selling Price (₦) — optional"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={customForm.selling_price}
            onChange={e => setCustomForm(f => ({ ...f, selling_price: e.target.value }))}
          />
          <p className="text-xs text-gray-400">
            This product will be saved for future orders and reviewed by an admin.
          </p>
        </div>
      </Modal>
    </div>
  )
}
