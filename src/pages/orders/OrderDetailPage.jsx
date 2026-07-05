import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Phone, MessageCircle, Copy, FileText, Plus, Pencil, Calendar } from 'lucide-react'
import { useOrder, useUpdateOrderStatus } from '../../hooks/useOrders'
import { useAuthStore } from '../../stores/authStore'
import { TopBar } from '../../components/layout/TopBar'
import { StatusBadge } from '../../components/ui/Badge'
import { Modal, ConfirmModal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { Input, Select, Textarea } from '../../components/ui/Input'
import { formatCurrency, formatDate, formatDateTime, statusLabel } from '../../utils/format'
import { buildOrderMessage, openDialer, openWhatsApp } from '../../utils/whatsapp'
import { useAppStore } from '../../stores/appStore'
import { generateInvoice, generateDeliveryNote, generateReceipt, savePdf } from '../../lib/pdf'
import { supabase } from '../../lib/supabase'

const STATUS_TRANSITIONS = {
  ceo: ['awaiting_waybill', 'waybilled', 'received_at_warehouse', 'processing', 'delivered', 'partially_paid', 'paid', 'failed_delivery', 'cancelled', 'returned'],
  super_admin: ['awaiting_waybill', 'waybilled', 'received_at_warehouse', 'processing', 'delivered', 'partially_paid', 'paid', 'failed_delivery', 'cancelled', 'returned'],
  operations_manager: ['awaiting_waybill', 'waybilled', 'received_at_warehouse', 'processing', 'delivered', 'partially_paid', 'paid', 'failed_delivery', 'cancelled'],
  customer_support: ['cancelled'],
  fulfillment: ['processing', 'delivered', 'partially_paid', 'paid', 'failed_delivery'],
  waybill: ['awaiting_waybill', 'waybilled', 'received_at_warehouse'],
  inventory: ['received_at_warehouse'],
}

export function OrderDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { showToast } = useAppStore()
  const { data: order, isLoading, refetch } = useOrder(id)
  const updateStatus = useUpdateOrderStatus()

  const [showStatusModal, setShowStatusModal] = useState(false)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [showExpenseModal, setShowExpenseModal] = useState(false)
  const [showNoteModal, setShowNoteModal] = useState(false)
  const [paymentData, setPaymentData] = useState({ amount_paid: '', type: 'full', balance_due_date: '', balance_notes: '' })
  const [expense, setExpense] = useState({ delivery_fee: '', installation_fee: '', offloading_fee: '', misc: '', notes: '' })
  const [note, setNote] = useState('')
  const [failedReason, setFailedReason] = useState('')
  const [cancelReason, setCancelReason] = useState('')
  const [returnReason, setReturnReason] = useState('')
  const [pendingStatus, setPendingStatus] = useState(null)
  const [showReasonModal, setShowReasonModal] = useState(false)
  const [showProcessingModal, setShowProcessingModal] = useState(false)
  const [processingDate, setProcessingDate] = useState(new Date().toISOString().split('T')[0])

  if (isLoading) return (
    <div className="flex flex-col h-full">
      <TopBar title="Order Details" />
      <div className="flex-1 p-4 space-y-3">
        {[1,2,3].map(i => <div key={i} className="h-24 shimmer rounded-2xl" />)}
      </div>
    </div>
  )

  if (!order) return (
    <div className="flex flex-col h-full">
      <TopBar title="Order Not Found" />
      <div className="flex-1 flex items-center justify-center">
        <p className="text-gray-500">Order not found</p>
      </div>
    </div>
  )

  const roleTransitions = STATUS_TRANSITIONS[user?.role] || []
  const allowedTransitions = order.status === 'paid'
    ? roleTransitions.filter(s => s === 'returned')
    : roleTransitions
  const canChangeStatus = allowedTransitions.length > 0
  const canViewDocs = ['ceo', 'super_admin', 'operations_manager'].includes(user?.role)
  const canEdit = order.status === 'new' && (
    (['ceo', 'super_admin', 'operations_manager'].includes(user?.role)) ||
    (user?.role === 'customer_support' && order.created_by === user?.id)
  )

  function handleCopyOrder() {
    const msg = buildOrderMessage(order)
    navigator.clipboard.writeText(msg).then(() => showToast('Order copied!', 'success'))
  }

  async function handleStatusChange(newStatus) {
    if (newStatus === 'cancelled' || newStatus === 'failed_delivery' || newStatus === 'returned') {
      setPendingStatus(newStatus)
      setShowReasonModal(true)
      setShowStatusModal(false)
      return
    }
    if (newStatus === 'paid' || newStatus === 'partially_paid') {
      setPendingStatus(newStatus)
      setPaymentData({ ...paymentData, amount_paid: newStatus === 'paid' ? order.total_amount : '' })
      setShowPaymentModal(true)
      setShowStatusModal(false)
      return
    }
    if (newStatus === 'processing') {
      setShowProcessingModal(true)
      setShowStatusModal(false)
      return
    }
    await updateStatus.mutateAsync({
      id: order.id,
      status: newStatus,
      timelineDesc: `Marked ${statusLabel(newStatus)} by ${user?.name}`
    })
    setShowStatusModal(false)
  }

  async function handleProcessingSubmit() {
    await updateStatus.mutateAsync({
      id: order.id,
      status: 'processing',
      extra: { planned_delivery_date: processingDate || null },
      timelineDesc: `Scheduled for delivery on ${processingDate} by ${user?.name}`
    })
    setShowProcessingModal(false)
  }

  async function handlePaymentSubmit() {
    const isPaid = pendingStatus === 'paid'
    const amtPaid = Number(paymentData.amount_paid)
    const balance = isPaid ? 0 : (Number(order.total_amount) - amtPaid)

    await updateStatus.mutateAsync({
      id: order.id,
      status: isPaid ? 'paid' : 'partially_paid',
      extra: {
        amount_paid: amtPaid,
        balance_amount: balance,
        balance_due_date: paymentData.balance_due_date || null,
        balance_notes: paymentData.balance_notes || null,
        paid_at: isPaid ? new Date().toISOString() : null,
      },
      timelineDesc: isPaid ? `Fully paid ₦${amtPaid.toLocaleString()} by ${user?.name}` : `Partial payment ₦${amtPaid.toLocaleString()} received, balance ₦${balance.toLocaleString()} by ${user?.name}`
    })
    setShowPaymentModal(false)
    setShowExpenseModal(true)
  }

  async function handleExpenseSubmit() {
    const entries = [
      { type: 'delivery', amount: expense.delivery_fee, label: 'Delivery fee' },
      { type: 'installation', amount: expense.installation_fee, label: 'Installation fee' },
      { type: 'offloading', amount: expense.offloading_fee, label: 'Offloading fee' },
      { type: 'misc', amount: expense.misc, label: 'Misc expense' },
    ].filter(e => Number(e.amount) > 0)

    for (const entry of entries) {
      await supabase.from('expenses').insert({
        business_id: order.business_id,
        expense_type: entry.type,
        category: 'operational',
        description: entry.label,
        amount: Number(entry.amount),
        order_id: order.id,
        staff_id: user?.id,
        notes: expense.notes,
      })
    }
    setShowExpenseModal(false)
    showToast('Expenses saved', 'success')
    refetch()
  }

  async function handleReasonSubmit() {
    let reason, extra
    if (pendingStatus === 'cancelled') {
      reason = cancelReason
      extra = { cancellation_reason: reason }
    } else if (pendingStatus === 'failed_delivery') {
      reason = failedReason
      extra = { failed_reason: reason }
    } else {
      reason = returnReason
      extra = { return_reason: reason }
    }
    await updateStatus.mutateAsync({
      id: order.id,
      status: pendingStatus,
      extra,
      timelineDesc: `${statusLabel(pendingStatus)}: ${reason} — by ${user?.name}`
    })
    setShowReasonModal(false)
    setCancelReason('')
    setFailedReason('')
    setReturnReason('')
  }

  async function handleAddNote() {
    if (!note.trim()) return
    await supabase.from('order_notes').insert({
      order_id: order.id,
      note,
      is_internal: true,
      staff_id: user?.id,
      staff_name: user?.name,
    })
    setNote('')
    setShowNoteModal(false)
    showToast('Note added', 'success')
    refetch()
  }

  function handleGeneratePdf(type) {
    const business = order.business
    let doc
    if (type === 'invoice') doc = generateInvoice(order, business)
    else if (type === 'receipt') doc = generateReceipt(order, business)
    else doc = generateDeliveryNote(order, business)
    savePdf(doc, `${type}-${order.order_number}.pdf`)
  }

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title={order.order_number}
        actions={
          <div className="flex gap-2">
            {canEdit && (
              <button
                onClick={() => navigate(`/orders/${order.id}/edit`)}
                className="p-2 bg-gray-100 text-gray-700 rounded-xl active:scale-95 transition-all"
              >
                <Pencil size={18} />
              </button>
            )}
            {canChangeStatus && (
              <Button size="sm" onClick={() => setShowStatusModal(true)}>
                Status
              </Button>
            )}
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-4 space-y-4 pb-8">

          {/* Status card */}
          <div className="bg-white rounded-2xl p-4 border border-gray-100">
            <div className="flex items-center justify-between mb-3">
              <StatusBadge status={order.status} />
              <span className="text-xs text-gray-400">{formatDateTime(order.updated_at)}</span>
            </div>
            {order.status === 'partially_paid' && (
              <div className="mt-2 p-3 bg-amber-50 rounded-xl">
                <p className="text-xs text-amber-700">
                  Paid: {formatCurrency(order.amount_paid)} · Balance: <strong>{formatCurrency(order.balance_amount)}</strong>
                  {order.balance_due_date && ` · Due: ${formatDate(order.balance_due_date)}`}
                </p>
              </div>
            )}
            {order.cancellation_reason && (
              <p className="text-xs text-red-700 bg-red-50 rounded-lg p-2 mt-2">Cancelled: {order.cancellation_reason}</p>
            )}
            {order.failed_reason && (
              <p className="text-xs text-red-700 bg-red-50 rounded-lg p-2 mt-2">Failed: {order.failed_reason}</p>
            )}
            {order.return_reason && (
              <p className="text-xs text-orange-700 bg-orange-50 rounded-lg p-2 mt-2">Returned: {order.return_reason}</p>
            )}
          </div>

          {/* Customer card */}
          <div className="bg-white rounded-2xl p-4 border border-gray-100">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Customer</h3>
            <p className="text-base font-semibold text-gray-900">{order.customer_name}</p>
            <p className="text-sm text-gray-600">{order.customer_phone}</p>
            {order.address && <p className="text-sm text-gray-600 mt-1">{order.address}</p>}
            <p className="text-sm text-gray-600">{[order.city, order.state].filter(Boolean).join(', ')}</p>
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => openDialer(order.customer_phone)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium text-green-700 bg-green-50 rounded-xl active:scale-95 transition-all"
              >
                <Phone size={16} /> Call
              </button>
              <button
                onClick={() => openWhatsApp(order.customer_phone)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium text-emerald-700 bg-emerald-50 rounded-xl active:scale-95 transition-all"
              >
                <MessageCircle size={16} /> WhatsApp
              </button>
            </div>
          </div>

          {/* Order Details */}
          <div className="bg-white rounded-2xl p-4 border border-gray-100 space-y-2">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Order Details</h3>
            <Row label="Business" value={order.business?.name} />

            {/* Multi-item display */}
            {order.items && order.items.length > 1 ? (
              <div className="space-y-2">
                <p className="text-xs text-gray-500">{order.items.length} products</p>
                {order.items.map((item, idx) => (
                  <div key={item.id} className="bg-gray-50 rounded-xl p-3 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold text-gray-900">{item.product_name}</p>
                      <p className="text-sm font-bold text-gray-900 shrink-0">{formatCurrency(item.total_amount)}</p>
                    </div>
                    <p className="text-xs text-gray-500">
                      {item.quantity} × {formatCurrency(item.unit_price)}
                      {item.color ? ` · ${item.color}` : ''}
                      {item.size ? ` · ${item.size}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <>
                <Row label="Product" value={order.product_name} />
                {order.color && <Row label="Color" value={order.color} />}
                {order.size && <Row label="Size" value={order.size} />}
                <Row label="Quantity" value={order.quantity} />
                <Row label="Unit Price" value={formatCurrency(order.unit_price)} />
              </>
            )}

            <div className="border-t border-gray-100 pt-2">
              <Row label="Total Amount" value={formatCurrency(order.total_amount)} highlight />
            </div>
            <Row label="Source" value={order.source} />
            {order.created_by_staff && (
              <Row label="Staff" value={`${order.created_by_staff.name} (${order.created_by_staff.staff_code})`} />
            )}
            {order.internal_note && (
              <div>
                <p className="text-xs text-gray-500 mb-1">Internal Note</p>
                <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-2">{order.internal_note}</p>
              </div>
            )}
            <Row label="Created" value={formatDateTime(order.created_at)} />
          </div>

          {/* Delivery */}
          <div className="bg-white rounded-2xl p-4 border border-gray-100 space-y-2">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Delivery</h3>
            {order.customer_requested_delivery_date && (
              <Row label="Requested Date" value={formatDate(order.customer_requested_delivery_date)} />
            )}
            {order.preferred_delivery_time && (
              <Row label="Preferred Time" value={order.preferred_delivery_time} />
            )}
            {order.planned_delivery_date && (
              <Row label="Planned Date" value={formatDate(order.planned_delivery_date)} />
            )}
            {order.delivery_note && (
              <div>
                <p className="text-xs text-gray-500 mb-1">Delivery Note</p>
                <p className="text-sm text-gray-900 bg-gray-50 rounded-lg p-2">{order.delivery_note}</p>
              </div>
            )}
          </div>

          {/* Quick Actions */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={handleCopyOrder}
              className="flex items-center justify-center gap-2 py-3 bg-white border border-gray-200 rounded-2xl text-sm font-medium text-gray-700 active:scale-95 transition-all"
            >
              <Copy size={16} /> Copy for WhatsApp
            </button>
            <button
              onClick={() => setShowNoteModal(true)}
              className="flex items-center justify-center gap-2 py-3 bg-white border border-gray-200 rounded-2xl text-sm font-medium text-gray-700 active:scale-95 transition-all"
            >
              <Plus size={16} /> Add Note
            </button>
          </div>

          {/* Documents */}
          {canViewDocs && (
            <div className="bg-white rounded-2xl p-4 border border-gray-100">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Documents</h3>
              <div className="grid grid-cols-3 gap-2">
                <button onClick={() => handleGeneratePdf('invoice')}
                  className="py-2.5 px-2 bg-blue-50 text-blue-700 rounded-xl text-xs font-medium flex flex-col items-center gap-1 active:scale-95 transition-all">
                  <FileText size={18} /> Invoice
                </button>
                <button
                  onClick={() => handleGeneratePdf('receipt')}
                  disabled={!['paid', 'partially_paid'].includes(order.status)}
                  className="py-2.5 px-2 bg-green-50 text-green-700 rounded-xl text-xs font-medium flex flex-col items-center gap-1 active:scale-95 transition-all disabled:opacity-40"
                >
                  <FileText size={18} /> Receipt
                </button>
                <button onClick={() => handleGeneratePdf('delivery')}
                  className="py-2.5 px-2 bg-purple-50 text-purple-700 rounded-xl text-xs font-medium flex flex-col items-center gap-1 active:scale-95 transition-all">
                  <FileText size={18} /> Delivery Note
                </button>
              </div>
            </div>
          )}

          {/* Expenses */}
          {order.expenses?.length > 0 && (
            <div className="bg-white rounded-2xl p-4 border border-gray-100">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Expenses</h3>
              {order.expenses.map(exp => (
                <div key={exp.id} className="flex justify-between items-center py-1.5 border-b border-gray-50 last:border-0">
                  <span className="text-sm text-gray-700 capitalize">{exp.expense_type}</span>
                  <span className="text-sm font-medium text-gray-900">{formatCurrency(exp.amount)}</span>
                </div>
              ))}
              <div className="flex justify-between items-center pt-2">
                <span className="text-sm font-semibold text-gray-900">Total Expenses</span>
                <span className="text-sm font-bold text-gray-900">
                  {formatCurrency(order.expenses.reduce((s, e) => s + Number(e.amount), 0))}
                </span>
              </div>
            </div>
          )}

          {/* Notes */}
          {order.notes?.length > 0 && (
            <div className="bg-white rounded-2xl p-4 border border-gray-100">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Notes</h3>
              {order.notes.map(n => (
                <div key={n.id} className="mb-3 last:mb-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-gray-700">{n.staff_name || n.staff?.name}</span>
                    <span className="text-xs text-gray-400">{formatDateTime(n.created_at)}</span>
                  </div>
                  <p className="text-sm text-gray-600 bg-gray-50 rounded-lg p-2">{n.note}</p>
                </div>
              ))}
            </div>
          )}

          {/* Timeline */}
          {order.timeline?.length > 0 && (
            <div className="bg-white rounded-2xl p-4 border border-gray-100">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Timeline</h3>
              <div className="space-y-3">
                {[...(order.timeline || [])].reverse().map(entry => (
                  <div key={entry.id} className="flex gap-3">
                    <div className="w-2 h-2 rounded-full bg-blue-400 mt-1.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-600">{entry.description}</p>
                      <p className="text-xs text-gray-400">{formatDateTime(entry.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Status Change Modal */}
      <Modal
        isOpen={showStatusModal}
        onClose={() => setShowStatusModal(false)}
        title="Update Order Status"
      >
        <div className="space-y-2">
          {allowedTransitions.map(status => (
            <button
              key={status}
              onClick={() => handleStatusChange(status)}
              disabled={order.status === status}
              className={`w-full py-3 px-4 rounded-xl text-sm font-medium text-left flex items-center justify-between active:scale-[0.98] transition-all ${
                order.status === status
                  ? 'bg-gray-50 text-gray-400 cursor-not-allowed'
                  : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
              }`}
            >
              <span>{statusLabel(status)}</span>
              {order.status === status && <span className="text-xs text-gray-400">Current</span>}
            </button>
          ))}
        </div>
      </Modal>

      {/* Payment Modal */}
      <Modal
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        title={pendingStatus === 'paid' ? 'Mark as Paid' : 'Mark as Partially Paid'}
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowPaymentModal(false)} className="flex-1">Cancel</Button>
            <Button onClick={handlePaymentSubmit} loading={updateStatus.isPending} className="flex-1">Confirm</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="bg-gray-50 rounded-xl p-3">
            <p className="text-xs text-gray-500">Order Total</p>
            <p className="text-xl font-bold text-gray-900">{formatCurrency(order.total_amount)}</p>
          </div>
          <Input
            label="Amount Paid (₦)"
            type="number"
            inputMode="decimal"
            value={paymentData.amount_paid}
            onChange={e => setPaymentData({ ...paymentData, amount_paid: e.target.value })}
            required
          />
          {pendingStatus === 'partially_paid' && (
            <>
              <div className="bg-amber-50 rounded-xl p-3">
                <p className="text-xs text-amber-700">Balance: {formatCurrency(Number(order.total_amount) - Number(paymentData.amount_paid || 0))}</p>
              </div>
              <Input
                label="Balance Due Date"
                type="date"
                value={paymentData.balance_due_date}
                onChange={e => setPaymentData({ ...paymentData, balance_due_date: e.target.value })}
              />
              <Textarea
                label="Balance Notes"
                placeholder="Notes about the balance..."
                value={paymentData.balance_notes}
                onChange={e => setPaymentData({ ...paymentData, balance_notes: e.target.value })}
                rows={2}
              />
            </>
          )}
        </div>
      </Modal>

      {/* Expense Modal */}
      <Modal
        isOpen={showExpenseModal}
        onClose={() => setShowExpenseModal(false)}
        title="Add Fulfillment Expenses"
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowExpenseModal(false)} className="flex-1">Skip</Button>
            <Button onClick={handleExpenseSubmit} className="flex-1">Save Expenses</Button>
          </div>
        }
      >
        <p className="text-xs text-gray-500 mb-4">Enter any fulfillment expenses for this order (leave blank to skip)</p>
        <div className="space-y-3">
          <Input label="Delivery Fee (₦)" type="number" inputMode="decimal" placeholder="0"
            value={expense.delivery_fee} onChange={e => setExpense({ ...expense, delivery_fee: e.target.value })} />
          <Input label="Installation Fee (₦)" type="number" inputMode="decimal" placeholder="0"
            value={expense.installation_fee} onChange={e => setExpense({ ...expense, installation_fee: e.target.value })} />
          <Input label="Offloading Fee (₦)" type="number" inputMode="decimal" placeholder="0"
            value={expense.offloading_fee} onChange={e => setExpense({ ...expense, offloading_fee: e.target.value })} />
          <Input label="Misc Expenses (₦)" type="number" inputMode="decimal" placeholder="0"
            value={expense.misc} onChange={e => setExpense({ ...expense, misc: e.target.value })} />
          <Textarea label="Notes" placeholder="Expense notes..." value={expense.notes}
            onChange={e => setExpense({ ...expense, notes: e.target.value })} rows={2} />
        </div>
      </Modal>

      {/* Reason Modal */}
      <Modal
        isOpen={showReasonModal}
        onClose={() => setShowReasonModal(false)}
        title={pendingStatus === 'cancelled' ? 'Cancel Order' : pendingStatus === 'failed_delivery' ? 'Mark Failed Delivery' : 'Mark as Returned'}
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowReasonModal(false)} className="flex-1">Back</Button>
            <Button
              variant="danger"
              onClick={handleReasonSubmit}
              loading={updateStatus.isPending}
              className="flex-1"
              disabled={!(pendingStatus === 'cancelled' ? cancelReason : pendingStatus === 'failed_delivery' ? failedReason : returnReason).trim()}
            >
              Confirm
            </Button>
          </div>
        }
      >
        <Textarea
          label={pendingStatus === 'cancelled' ? 'Reason for cancellation' : pendingStatus === 'failed_delivery' ? 'Reason for failed delivery' : 'Reason for return'}
          placeholder="Describe what happened..."
          value={pendingStatus === 'cancelled' ? cancelReason : pendingStatus === 'failed_delivery' ? failedReason : returnReason}
          onChange={e => {
            if (pendingStatus === 'cancelled') setCancelReason(e.target.value)
            else if (pendingStatus === 'failed_delivery') setFailedReason(e.target.value)
            else setReturnReason(e.target.value)
          }}
          rows={4}
          required
        />
      </Modal>

      {/* Note Modal */}
      <Modal
        isOpen={showNoteModal}
        onClose={() => setShowNoteModal(false)}
        title="Add Note"
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowNoteModal(false)} className="flex-1">Cancel</Button>
            <Button onClick={handleAddNote} disabled={!note.trim()} className="flex-1">Save</Button>
          </div>
        }
      >
        <Textarea
          placeholder="Add an internal note..."
          value={note}
          onChange={e => setNote(e.target.value)}
          rows={4}
        />
      </Modal>

      {/* Processing / Schedule Delivery Modal */}
      <Modal
        isOpen={showProcessingModal}
        onClose={() => setShowProcessingModal(false)}
        title="Schedule Delivery"
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowProcessingModal(false)} className="flex-1">Cancel</Button>
            <Button onClick={handleProcessingSubmit} loading={updateStatus.isPending} className="flex-1">
              Confirm
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-blue-600 mb-2">
            <Calendar size={18} />
            <p className="text-sm font-medium">Set the planned delivery date for this order</p>
          </div>
          <Input
            label="Planned Delivery Date"
            type="date"
            value={processingDate}
            onChange={e => setProcessingDate(e.target.value)}
            required
          />
          {order.customer_requested_delivery_date && (
            <p className="text-xs text-gray-500">
              Customer requested: <strong>{formatDate(order.customer_requested_delivery_date)}</strong>
            </p>
          )}
        </div>
      </Modal>
    </div>
  )
}

function Row({ label, value, highlight }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-xs text-gray-500 shrink-0">{label}</span>
      <span className={`text-xs text-right ${highlight ? 'font-bold text-blue-600 text-sm' : 'text-gray-900 font-medium'}`}>
        {value || '—'}
      </span>
    </div>
  )
}
