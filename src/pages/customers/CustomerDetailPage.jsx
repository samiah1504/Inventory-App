import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Phone, MessageCircle, ShoppingCart, AlertTriangle, MapPin, Plus, Edit, Trash2 } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { TopBar } from '../../components/layout/TopBar'
import { StatusBadge } from '../../components/ui/Badge'
import { Modal, ConfirmModal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { Input, Select } from '../../components/ui/Input'
import { formatCurrency, formatDate, NIGERIAN_STATES } from '../../utils/format'
import { openDialer, openWhatsApp } from '../../utils/whatsapp'
import { useAuthStore } from '../../stores/authStore'
import { useAppStore } from '../../stores/appStore'

export function CustomerDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { showToast } = useAppStore()
  const queryClient = useQueryClient()

  const canEdit = ['ceo', 'super_admin', 'operations_manager', 'customer_support'].includes(user?.role)
  const canCreateOrder = ['ceo', 'super_admin', 'customer_support', 'operations_manager'].includes(user?.role)

  const [showEditModal, setShowEditModal] = useState(false)
  const [showAddrModal, setShowAddrModal] = useState(false)
  const [editingAddr, setEditingAddr] = useState(null)
  const [deleteAddrId, setDeleteAddrId] = useState(null)
  const [editForm, setEditForm] = useState({ name: '', phone: '' })
  const [addrForm, setAddrForm] = useState({ address: '', city: '', state: '', is_primary: false })

  const { data: customer, isLoading } = useQuery({
    queryKey: ['customer', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('*, orders(id, order_number, status, product_name, total_amount, created_at, state, balance_amount), addresses:customer_addresses(*)')
        .eq('id', id)
        .single()
      if (error) throw error
      return data
    },
    enabled: !!id,
  })

  const updateCustomer = useMutation({
    mutationFn: async (data) => {
      const { error } = await supabase.from('customers').update(data).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer', id] })
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      showToast('Customer updated', 'success')
      setShowEditModal(false)
    },
    onError: (err) => showToast(err.message, 'error'),
  })

  const saveAddress = useMutation({
    mutationFn: async (data) => {
      if (editingAddr) {
        const { error } = await supabase.from('customer_addresses').update(data).eq('id', editingAddr.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('customer_addresses').insert({ ...data, customer_id: id })
        if (error) throw error
      }
      if (data.is_primary) {
        const targetId = editingAddr?.id
        // Clear other primaries (best-effort, ignore errors)
        await supabase.from('customer_addresses')
          .update({ is_primary: false })
          .eq('customer_id', id)
          .neq('id', targetId || '00000000-0000-0000-0000-000000000000')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer', id] })
      showToast(editingAddr ? 'Address updated' : 'Address added', 'success')
      setShowAddrModal(false)
      setEditingAddr(null)
      setAddrForm({ address: '', city: '', state: '', is_primary: false })
    },
    onError: (err) => showToast(err.message, 'error'),
  })

  const deleteAddress = useMutation({
    mutationFn: async (addrId) => {
      const { error } = await supabase.from('customer_addresses').delete().eq('id', addrId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer', id] })
      showToast('Address removed', 'success')
      setDeleteAddrId(null)
    },
    onError: (err) => showToast(err.message, 'error'),
  })

  function openEditCustomer() {
    setEditForm({ name: customer.name || '', phone: customer.phone || '' })
    setShowEditModal(true)
  }

  function openAddAddress() {
    setEditingAddr(null)
    setAddrForm({ address: '', city: '', state: '', is_primary: false })
    setShowAddrModal(true)
  }

  function openEditAddress(addr) {
    setEditingAddr(addr)
    setAddrForm({ address: addr.address || '', city: addr.city || '', state: addr.state || '', is_primary: addr.is_primary || false })
    setShowAddrModal(true)
  }

  if (isLoading) return (
    <div className="flex flex-col h-full overflow-x-hidden w-full">
      <TopBar title="Customer" />
      <div className="p-4 space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 shimmer rounded-2xl" />)}</div>
    </div>
  )
  if (!customer) return null

  const orders = customer.orders || []
  const addresses = customer.addresses || []
  const primaryAddr = addresses.find(a => a.is_primary) || addresses[0]
  const successRate = customer.total_orders > 0
    ? Math.round((customer.successful_orders / customer.total_orders) * 100) : 0
  const outstandingBalance = orders
    .filter(o => o.status === 'partially_paid')
    .reduce((s, o) => s + Number(o.balance_amount || 0), 0)

  function handleNewOrder() {
    const params = new URLSearchParams({ phone: customer.phone || '', name: customer.name || '' })
    if (primaryAddr) {
      if (primaryAddr.address) params.set('address', primaryAddr.address)
      if (primaryAddr.city) params.set('city', primaryAddr.city)
      if (primaryAddr.state) params.set('state', primaryAddr.state)
    }
    navigate(`/orders/new?${params.toString()}`)
  }

  return (
    <div className="flex flex-col h-full overflow-x-hidden w-full">
      <TopBar
        title={customer.name}
        actions={canEdit && (
          <button onClick={openEditCustomer} className="p-2 bg-gray-100 rounded-xl active:scale-95">
            <Edit size={18} className="text-gray-600" />
          </button>
        )}
      />
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-4 pb-8">

        {/* Profile */}
        <div className="bg-white rounded-2xl p-4 border border-gray-100">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h2 className="text-lg font-bold text-gray-900">{customer.name}</h2>
              <p className="text-sm text-gray-500">{customer.phone}</p>
              {customer.failed_orders > 1 && (
                <div className="flex items-center gap-1 text-red-500 mt-1">
                  <AlertTriangle size={14} />
                  <span className="text-xs font-medium">{customer.failed_orders} failed deliveries — handle with care</span>
                </div>
              )}
            </div>
          </div>
          {primaryAddr && (
            <div className="flex items-start gap-1.5 text-xs text-gray-500 mb-3">
              <MapPin size={13} className="mt-0.5 shrink-0 text-gray-400" />
              <span>{[primaryAddr.address, primaryAddr.city, primaryAddr.state].filter(Boolean).join(', ')}</span>
            </div>
          )}
          <div className="flex gap-2 mb-4">
            <button onClick={() => openDialer(customer.phone)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-green-50 text-green-700 rounded-xl text-sm font-medium active:scale-95 transition-all">
              <Phone size={15} /> Call
            </button>
            <button onClick={() => openWhatsApp(customer.phone)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-emerald-50 text-emerald-700 rounded-xl text-sm font-medium active:scale-95 transition-all">
              <MessageCircle size={15} /> WhatsApp
            </button>
            {canCreateOrder && (
              <button onClick={handleNewOrder}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-blue-600 text-black rounded-xl text-sm font-medium active:scale-95 transition-all">
                <ShoppingCart size={15} /> Order
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="text-center bg-gray-50 rounded-xl p-2">
              <p className="text-xl font-bold text-gray-900">{customer.total_orders}</p>
              <p className="text-xs text-gray-500">Orders</p>
            </div>
            <div className="text-center bg-gray-50 rounded-xl p-2">
              <p className="text-lg font-bold text-green-600">{formatCurrency(customer.total_spent)}</p>
              <p className="text-xs text-gray-500">Spent</p>
            </div>
            <div className="text-center bg-gray-50 rounded-xl p-2">
              <p className="text-xl font-bold text-gray-900">{successRate}%</p>
              <p className="text-xs text-gray-500">Success</p>
            </div>
            {outstandingBalance > 0 ? (
              <div className="text-center bg-amber-50 rounded-xl p-2">
                <p className="text-lg font-bold text-amber-600">{formatCurrency(outstandingBalance)}</p>
                <p className="text-xs text-amber-700">Outstanding</p>
              </div>
            ) : (
              <div className="text-center bg-gray-50 rounded-xl p-2">
                <p className="text-xl font-bold text-gray-900">{customer.failed_orders || 0}</p>
                <p className="text-xs text-gray-500">Failed</p>
              </div>
            )}
          </div>
        </div>

        {/* Addresses */}
        <div className="bg-white rounded-2xl border border-gray-100">
          <div className="px-4 pt-4 pb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Addresses</h3>
            {canEdit && (
              <button onClick={openAddAddress} className="flex items-center gap-1 text-xs text-blue-600 font-medium">
                <Plus size={14} /> Add
              </button>
            )}
          </div>
          {addresses.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4 pb-5">No addresses saved</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {addresses.map(addr => (
                <div key={addr.id} className="px-4 py-3 flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <MapPin size={12} className="text-gray-400 shrink-0" />
                      {addr.is_primary && <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">Primary</span>}
                    </div>
                    <p className="text-sm text-gray-700">{[addr.address, addr.city, addr.state].filter(Boolean).join(', ')}</p>
                  </div>
                  {canEdit && (
                    <div className="flex gap-1.5 shrink-0">
                      <button onClick={() => openEditAddress(addr)} className="p-1.5 bg-gray-100 rounded-lg active:scale-95">
                        <Edit size={13} className="text-gray-600" />
                      </button>
                      <button onClick={() => setDeleteAddrId(addr.id)} className="p-1.5 bg-red-50 rounded-lg active:scale-95">
                        <Trash2 size={13} className="text-red-500" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Orders */}
        <div className="bg-white rounded-2xl border border-gray-100">
          <div className="px-4 pt-4 pb-2">
            <h3 className="text-sm font-semibold text-gray-900">Order History</h3>
          </div>
          {orders.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No orders</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {orders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).map(order => (
                <button
                  key={order.id}
                  onClick={() => navigate(`/orders/${order.id}`)}
                  className="w-full px-4 py-3 text-left hover:bg-gray-50 active:bg-gray-100 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-mono text-gray-400">{order.order_number}</span>
                        <StatusBadge status={order.status} />
                      </div>
                      <p className="text-sm text-gray-700">{order.product_name}</p>
                      <p className="text-xs text-gray-400">{order.state}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-gray-900">{formatCurrency(order.total_amount)}</p>
                      <p className="text-xs text-gray-400">{formatDate(order.created_at)}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Edit customer modal */}
      <Modal isOpen={showEditModal} onClose={() => setShowEditModal(false)} title="Edit Customer"
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowEditModal(false)} className="flex-1">Cancel</Button>
            <Button onClick={() => updateCustomer.mutate(editForm)} loading={updateCustomer.isPending} className="flex-1"
              disabled={!editForm.name.trim()}>Save</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input label="Name" required value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
          <Input label="Phone" type="tel" value={editForm.phone} onChange={e => setEditForm({ ...editForm, phone: e.target.value })} />
        </div>
      </Modal>

      {/* Address modal */}
      <Modal isOpen={showAddrModal} onClose={() => setShowAddrModal(false)} title={editingAddr ? 'Edit Address' : 'Add Address'}
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowAddrModal(false)} className="flex-1">Cancel</Button>
            <Button onClick={() => saveAddress.mutate(addrForm)} loading={saveAddress.isPending} className="flex-1">Save</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input label="Street Address" value={addrForm.address} onChange={e => setAddrForm({ ...addrForm, address: e.target.value })} />
          <Input label="City / LGA" value={addrForm.city} onChange={e => setAddrForm({ ...addrForm, city: e.target.value })} />
          <Select label="State" value={addrForm.state} onChange={e => setAddrForm({ ...addrForm, state: e.target.value })}>
            <option value="">Select state...</option>
            {NIGERIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </Select>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={addrForm.is_primary} onChange={e => setAddrForm({ ...addrForm, is_primary: e.target.checked })}
              className="w-4 h-4 rounded border-gray-300 text-blue-600" />
            <span className="text-sm text-gray-700">Set as primary address</span>
          </label>
        </div>
      </Modal>

      {/* Delete address confirm */}
      <ConfirmModal
        isOpen={!!deleteAddrId}
        onClose={() => setDeleteAddrId(null)}
        onConfirm={() => deleteAddress.mutate(deleteAddrId)}
        title="Remove Address"
        message="Remove this address from the customer's profile?"
        confirmLabel="Remove"
        danger
      />
    </div>
  )
}
