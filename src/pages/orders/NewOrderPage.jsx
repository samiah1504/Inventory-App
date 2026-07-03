import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm, Controller } from 'react-hook-form'
import { Search, Plus } from 'lucide-react'
import { TopBar } from '../../components/layout/TopBar'
import { Input, Select, Textarea } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { useCreateOrder } from '../../hooks/useOrders'
import { useBusinesses, useProducts } from '../../hooks/useBusinesses'
import { useAuthStore } from '../../stores/authStore'
import { NIGERIAN_STATES, ORDER_SOURCES, DELIVERY_WINDOWS, formatCurrency } from '../../utils/format'
import { supabase } from '../../lib/supabase'

export function NewOrderPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const createOrder = useCreateOrder()
  const { data: businesses } = useBusinesses()
  const [selectedBusiness, setSelectedBusiness] = useState('')
  const [productSearch, setProductSearch] = useState('')
  const [showProductSearch, setShowProductSearch] = useState(false)
  const [customerHistory, setCustomerHistory] = useState(null)
  const [showNewProduct, setShowNewProduct] = useState(false)

  const { data: products } = useProducts(selectedBusiness || undefined)
  const filteredProducts = (products || []).filter(p =>
    p.name.toLowerCase().includes(productSearch.toLowerCase())
  )

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
    }
  })

  const watchPhone = watch('customer_phone')
  const watchProduct = watch('product_name')
  const watchQuantity = watch('quantity')
  const watchUnitPrice = watch('unit_price')
  const watchBusinessId = watch('business_id')

  // Compute total
  const total = (Number(watchQuantity) || 0) * (Number(watchUnitPrice) || 0)

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
          // Prefill last address
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

  // Update selected business for product filter
  useEffect(() => {
    setSelectedBusiness(watchBusinessId)
  }, [watchBusinessId])

  async function onSubmit(data) {
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
    if (product.selling_price) setValue('unit_price', product.selling_price)
    if (product.business_id && !watchBusinessId) setValue('business_id', product.business_id)
    setProductSearch(product.name)
    setShowProductSearch(false)
  }

  return (
    <div className="flex flex-col h-full">
      <TopBar title="New Order" />
      <div className="flex-1 overflow-y-auto">
        <form onSubmit={handleSubmit(onSubmit)} className="px-4 py-4 space-y-4 pb-8">

          {/* Business */}
          <Select
            label="Business"
            required
            error={errors.business_id?.message}
            {...register('business_id', { required: 'Select a business' })}
          >
            <option value="">Select business...</option>
            {(businesses || []).map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </Select>

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

            {/* Product Search */}
            <div className="relative">
              <Input
                label="Product"
                placeholder="Search or type product..."
                value={productSearch}
                onChange={(e) => {
                  setProductSearch(e.target.value)
                  setShowProductSearch(true)
                  setValue('product_name', e.target.value)
                }}
                onFocus={() => setShowProductSearch(true)}
                leftIcon={<Search size={16} />}
                required
                error={errors.product_name?.message}
              />
              <input type="hidden" {...register('product_name', { required: 'Product is required' })} />
              <input type="hidden" {...register('product_id')} />

              {showProductSearch && productSearch && (
                <div className="absolute z-30 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                  {filteredProducts.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => selectProduct(p)}
                      className="w-full px-4 py-2.5 text-left hover:bg-gray-50 flex items-center justify-between gap-3"
                    >
                      <div>
                        <p className="text-sm font-medium text-gray-900">{p.name}</p>
                        <p className="text-xs text-gray-500">{p.category?.name}</p>
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
                    onClick={() => { setShowNewProduct(true); setShowProductSearch(false) }}
                    className="w-full px-4 py-2.5 text-left text-sm text-blue-600 font-medium flex items-center gap-2 border-t border-gray-50"
                  >
                    <Plus size={14} /> Add custom product
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Color (optional)"
                placeholder="e.g. Brown"
                {...register('color')}
              />
              <Input
                label="Size (optional)"
                placeholder="e.g. 3x2"
                {...register('size')}
              />
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
            <Select
              label="Preferred Delivery Time"
              {...register('preferred_delivery_time')}
            >
              {DELIVERY_WINDOWS.map(w => <option key={w} value={w}>{w}</option>)}
            </Select>
          </div>

          {/* Order Source */}
          <div className="bg-white rounded-2xl p-4 border border-gray-100 space-y-3">
            <h3 className="text-sm font-semibold text-gray-900">Order Source</h3>
            <Select
              label="Order came from"
              {...register('source')}
            >
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
    </div>
  )
}
