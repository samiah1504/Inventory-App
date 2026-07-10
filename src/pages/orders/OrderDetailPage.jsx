import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Phone, MessageCircle, Copy, FileText, Plus, Pencil, Calendar } from 'lucide-react'
import { useOrder, useUpdateOrderStatus } from '../../hooks/useOrders'
import { useAuthStore } from '../../stores/authStore'
import { TopBar } from '../../components/layout/TopBar'
import { StatusBadge } from '../../components/ui/Badge'
import { Modal, ConfirmModal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { Input, Select, Textarea } from '../../components/ui/Input'
import { formatCurrency, formatDate, formatDateTime, statusLabel, NIGERIAN_STATES } from '../../utils/format'
import { buildOrderMessage, openDialer, openWhatsApp } from '../../utils/whatsapp'
import { useAppStore } from '../../stores/appStore'
import { generateInvoice, generateDeliveryNote, generateReceipt, savePdf } from '../../lib/pdf'
import { supabase } from '../../lib/supabase'
import { recordReturnDecision, sendReturnToAnotherState } from '../../lib/stockOps'

const STATUS_TRANSITIONS = {
  ceo: ['awaiting_waybill', 'waybilled', 'arrived_at_park', 'picked_up_from_park', 'received_at_warehouse', 'processing', 'delivered', 'partially_paid', 'paid', 'failed_delivery', 'cancelled', 'returned'],
  super_admin: ['awaiting_waybill', 'waybilled', 'arrived_at_park', 'picked_up_from_park', 'received_at_warehouse', 'processing', 'delivered', 'partially_paid', 'paid', 'failed_delivery', 'cancelled', 'returned'],
  operations_manager: ['awaiting_waybill', 'waybilled', 'arrived_at_park', 'picked_up_from_park', 'received_at_warehouse', 'processing', 'delivered', 'partially_paid', 'paid', 'failed_delivery', 'cancelled'],
  customer_support: ['cancelled'],
  fulfillment: ['awaiting_waybill', 'arrived_at_park', 'picked_up_from_park', 'received_at_warehouse', 'processing', 'delivered', 'partially_paid', 'paid', 'failed_delivery'],
  waybill: ['awaiting_waybill', 'waybilled', 'arrived_at_park'],
  inventory: ['received_at_warehouse'],
}

// The real route an order can take from each status. Enforces the workflow:
// new → review (processing if stock in destination / awaiting waybill),
// every Lagos shipment arrives at the State Park first, and from the park
// fulfillment either picks up for direct delivery or moves to the warehouse.
const NEXT_STATUSES = {
  new: ['processing', 'awaiting_waybill', 'cancelled'],
  awaiting_waybill: ['waybilled', 'processing', 'cancelled'],
  waybilled: ['arrived_at_park', 'cancelled'],
  arrived_at_park: ['picked_up_from_park', 'received_at_warehouse', 'cancelled'],
  picked_up_from_park: ['processing', 'delivered', 'failed_delivery'],
  received_at_warehouse: ['processing', 'cancelled'],
  processing: ['delivered', 'failed_delivery', 'cancelled'],
  delivered: ['paid', 'partially_paid', 'returned', 'failed_delivery'],
  partially_paid: ['paid', 'returned'],
  paid: ['returned'],
  failed_delivery: ['processing', 'returned', 'cancelled'],
  cancelled: [],
  returned: [],   // decision is recorded via the Return Decision card
  sent_to_park: ['waybilled', 'arrived_at_park', 'cancelled'],
}

const RETURN_DECISIONS = [
  { value: 'returned_warehouse', label: 'Returned to Warehouse' },
  { value: 'send_another_state', label: 'Send to Another State' },
  { value: 'returned_supplier',  label: 'Returned to Supplier' },
  { value: 'damaged',            label: 'Marked as Damaged' },
  { value: 'repair',             label: 'Sent for Repair' },
  { value: 'customer_refunded',  label: 'Customer Refunded' },
  { value: 'product_exchanged',  label: 'Product Exchanged' },
  { value: 'other',              label: 'Other' },
]

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
  const [showFailedModal, setShowFailedModal] = useState(false)
  const [failedForm, setFailedForm] = useState({
    reason: '', custom: '', disposition: '', destinationState: '', transferReason: 'customer_relocated',
    parkName: '', parkLocation: '', contactName: '', contactPhone: '', contactRole: 'driver',
  })
  const [cancelReason, setCancelReason] = useState('')
  const [cancelNotes, setCancelNotes] = useState('')
  const [returnReason, setReturnReason] = useState('')
  const [returnExtra, setReturnExtra] = useState({ condition: 'good', photos: '' })
  const [showDecisionModal, setShowDecisionModal] = useState(false)
  const [decisionForm, setDecisionForm] = useState({ decision: '', notes: '' })
  const [showParkSendModal, setShowParkSendModal] = useState(false)
  const [parkSendForm, setParkSendForm] = useState({ park_name: '', date_sent: '', time_sent: '', person: '', destination: '', notes: '' })
  const [pendingStatus, setPendingStatus] = useState(null)
  const [showReasonModal, setShowReasonModal] = useState(false)
  const [showProcessingModal, setShowProcessingModal] = useState(false)
  const [processingDate, setProcessingDate] = useState(new Date().toISOString().split('T')[0])
  const [showParkPickupModal, setShowParkPickupModal] = useState(false)
  const [parkForm, setParkForm] = useState({ rider_phone: '', pickup_time: '', notes: '' })
  const [showWhReceiptModal, setShowWhReceiptModal] = useState(false)
  const [whForm, setWhForm] = useState({ qty: '', time: '', condition: 'good', notes: '' })

  // Destination-state stock check for the procurement review (new orders)
  const destStock = useQuery({
    queryKey: ['dest_stock', id, order?.state],
    enabled: !!order && order.status === 'new' && showStatusModal,
    queryFn: async () => {
      try {
        const { data: whs } = await supabase.from('warehouses').select('id, name').eq('state', order.state)
        if (!whs || whs.length === 0) return { hasWarehouse: false, available: 0 }
        const items = Array.isArray(order.items_data) && order.items_data.length > 0
          ? order.items_data.filter(i => i.product_id)
          : (order.product_id ? [{ product_id: order.product_id }] : [])
        if (items.length === 0) return { hasWarehouse: true, available: null }
        const { data: inv } = await supabase.from('inventory')
          .select('quantity_available, product_id, warehouse_id')
          .in('warehouse_id', whs.map(w => w.id))
          .in('product_id', items.map(i => i.product_id))
        const available = (inv || []).reduce((s, r) => s + Number(r.quantity_available || 0), 0)
        return { hasWarehouse: true, available }
      } catch { return null }
    },
  })

  // Fulfillment officer(s) responsible for this order's state — shown
  // read-only so support can tell the customer who is handling delivery
  const orderOfficersQ = useQuery({
    queryKey: ['order_officers', order?.state],
    enabled: !!order?.state,
    queryFn: async () => {
      try {
        const { data, error } = await supabase.from('staff_users')
          .select('id, name, assigned_states')
          .eq('role', 'fulfillment').eq('is_active', true)
        if (error) throw error
        return (data || []).filter(o =>
          Array.isArray(o.assigned_states) && o.assigned_states.includes(order.state))
      } catch { return [] }
    },
    staleTime: 60000,
  })

  if (isLoading) return (
    <div className="flex flex-col h-full overflow-x-hidden w-full">
      <TopBar title="Order Details" />
      <div className="flex-1 p-4 space-y-3">
        {[1,2,3].map(i => <div key={i} className="h-24 shimmer rounded-2xl" />)}
      </div>
    </div>
  )

  if (!order) return (
    <div className="flex flex-col h-full overflow-x-hidden w-full">
      <TopBar title="Order Not Found" />
      <div className="flex-1 flex items-center justify-center">
        <p className="text-gray-500">Order not found</p>
      </div>
    </div>
  )

  const roleTransitions = STATUS_TRANSITIONS[user?.role] || []
  const nextStatuses = NEXT_STATUSES[order.status] ?? Object.keys(NEXT_STATUSES)
  const allowedTransitions = roleTransitions.filter(s => nextStatuses.includes(s))
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
    if (newStatus === 'failed_delivery') {
      setFailedForm({
        reason: '', custom: '', disposition: '', destinationState: '', transferReason: 'customer_relocated',
        parkName: '', parkLocation: '', contactName: '', contactPhone: '', contactRole: 'driver',
      })
      setShowFailedModal(true)
      setShowStatusModal(false)
      return
    }
    if (newStatus === 'cancelled' || newStatus === 'returned') {
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
    if (newStatus === 'picked_up_from_park') {
      setParkForm({ rider_phone: '', pickup_time: new Date().toISOString().slice(0, 16), notes: '' })
      setShowParkPickupModal(true)
      setShowStatusModal(false)
      return
    }
    if (newStatus === 'received_at_warehouse' && order.status === 'arrived_at_park') {
      setWhForm({ qty: String(order.quantity || 1), time: new Date().toISOString().slice(0, 16), condition: 'good', notes: '' })
      setShowWhReceiptModal(true)
      setShowStatusModal(false)
      return
    }

    let timelineDesc = `Marked ${statusLabel(newStatus)} by ${user?.name}`
    if (newStatus === 'awaiting_waybill' && order.status === 'new') {
      timelineDesc = `Order marked Awaiting Waybill because stock is not available in destination warehouse — by ${user?.name}`
    } else if (newStatus === 'arrived_at_park') {
      timelineDesc = `Arrived at ${order.state} State Park — confirmed by ${user?.name}`
    }
    await updateStatus.mutateAsync({
      id: order.id,
      status: newStatus,
      timelineDesc,
    })
    setShowStatusModal(false)
  }

  async function handleParkPickupSubmit() {
    if (!parkForm.rider_phone.trim()) {
      showToast("Enter the rider's phone number", 'error')
      return
    }
    await updateStatus.mutateAsync({
      id: order.id,
      status: 'picked_up_from_park',
      extraSafe: {
        rider_phone: parkForm.rider_phone.trim(),
        park_pickup_time: parkForm.pickup_time ? new Date(parkForm.pickup_time).toISOString() : new Date().toISOString(),
      },
      timelineDesc: `Order picked up from ${order.state} State Park for direct delivery — rider ${parkForm.rider_phone.trim()}${parkForm.notes ? ` · ${parkForm.notes}` : ''} — by ${user?.name}`,
    })
    setShowParkPickupModal(false)
  }

  async function handleWhReceiptSubmit() {
    if (!whForm.qty || Number(whForm.qty) <= 0) {
      showToast('Enter the quantity received', 'error')
      return
    }
    const condLabel = { good: 'Good condition', minor_damage: 'Minor damage', damaged: 'Damaged', incomplete: 'Incomplete' }[whForm.condition] || whForm.condition
    await updateStatus.mutateAsync({
      id: order.id,
      status: 'received_at_warehouse',
      extraSafe: {
        warehouse_received_qty: Number(whForm.qty),
        warehouse_received_time: whForm.time ? new Date(whForm.time).toISOString() : new Date().toISOString(),
        warehouse_received_condition: whForm.condition,
      },
      timelineDesc: `Order transferred from ${order.state} State Park to warehouse — by ${user?.name}`,
      extraTimeline: {
        action: 'received_at_warehouse',
        description: `Order received at warehouse — ${whForm.qty} unit${Number(whForm.qty) !== 1 ? 's' : ''}, ${condLabel}${whForm.notes ? ` · ${whForm.notes}` : ''} — by ${user?.name}`,
      },
    })
    setShowWhReceiptModal(false)
  }

  async function handleProcessingSubmit() {
    const timelineDesc = order.status === 'new'
      ? `Order marked Processing because stock is already available in destination warehouse. Scheduled for delivery on ${processingDate} — by ${user?.name}`
      : `Scheduled for delivery on ${processingDate} by ${user?.name}`
    await updateStatus.mutateAsync({
      id: order.id,
      status: 'processing',
      extra: { planned_delivery_date: processingDate || null },
      timelineDesc,
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
    // Delivery fee recorded — clear the pending flag automatically
    if (Number(expense.delivery_fee) > 0 && order.delivery_fee_pending) {
      try {
        await supabase.from('orders').update({ delivery_fee_pending: false }).eq('id', order.id)
        await supabase.from('order_timeline').insert({
          order_id: order.id,
          action: 'delivery_fee_recorded',
          description: `Delivery fee ₦${Number(expense.delivery_fee).toLocaleString()} recorded by ${user?.name}`,
          staff_id: user?.id,
          staff_name: user?.name,
        })
      } catch { /* flag column missing — ignore */ }
    }
    setShowExpenseModal(false)
    showToast('Expenses saved', 'success')
    refetch()
  }

  async function handleFeePending() {
    const { error } = await supabase
      .from('orders')
      .update({ delivery_fee_pending: true, updated_at: new Date().toISOString() })
      .eq('id', order.id)
    if (error) {
      showToast('Could not mark pending — run the latest migration', 'error')
      return
    }
    await supabase.from('order_timeline').insert({
      order_id: order.id,
      action: 'delivery_fee_pending',
      description: `Delivery fee pending — awaiting warehouse (${user?.name})`,
      staff_id: user?.id,
      staff_name: user?.name,
    })
    setShowExpenseModal(false)
    showToast('Marked as Delivery Fee Pending', 'success')
    refetch()
  }

  async function handleReasonSubmit() {
    let reason, extra
    if (pendingStatus === 'cancelled') {
      reason = cancelReason
      extra = { cancellation_reason: reason }
    } else {
      reason = returnReason
      extra = { return_reason: reason }
    }
    const cancelNote = pendingStatus === 'cancelled' && cancelNotes.trim() ? ` · ${cancelNotes.trim()}` : ''
    await updateStatus.mutateAsync({
      id: order.id,
      status: pendingStatus,
      extra,
      extraSafe: pendingStatus === 'returned' ? {
        return_condition: returnExtra.condition,
        return_photos: returnExtra.photos.trim() || null,
      } : undefined,
      timelineDesc: `${statusLabel(pendingStatus)}: ${reason}${cancelNote}${pendingStatus === 'returned' ? ` · condition: ${returnExtra.condition.replace(/_/g, ' ')}` : ''} — by ${user?.name} (${user?.role})`,
    })
    setShowReasonModal(false)
    setCancelReason('')
    setReturnReason('')
    setReturnExtra({ condition: 'good', photos: '' })
  }

  const canDecide = ['fulfillment', 'operations_manager', 'ceo', 'super_admin'].includes(user?.role)

  async function handleDecisionSubmit() {
    const d = decisionForm
    if (!d.decision) return
    if (d.decision === 'other' && !d.notes.trim()) {
      showToast('Add notes when choosing Other', 'error')
      return
    }
    const label = RETURN_DECISIONS.find(x => x.value === d.decision)?.label || d.decision
    // Decision columns are best-effort (migration may not be run); the timeline is the record
    await supabase.from('orders').update({
      return_decision: d.decision,
      return_decision_notes: d.notes.trim() || null,
      return_decision_at: new Date().toISOString(),
    }).eq('id', order.id)
    await supabase.from('order_timeline').insert({
      order_id: order.id,
      action: 'return_decision',
      description: `Return decision recorded: ${label}${d.notes.trim() ? ` — ${d.notes.trim()}` : ''} — by ${user?.name} (${user?.role})`,
      staff_id: user?.id,
      staff_name: user?.name,
    })
    await recordReturnDecision(order, d.decision, d.notes.trim(), user)
    setShowDecisionModal(false)
    showToast('Decision recorded', 'success')
    if (d.decision === 'send_another_state') {
      const now = new Date()
      setParkSendForm({
        park_name: '', notes: '', destination: '',
        date_sent: now.toISOString().split('T')[0],
        time_sent: now.toTimeString().slice(0, 5),
        person: user?.name || '',
      })
      setShowParkSendModal(true)
    }
    refetch()
  }

  async function handleParkSendSubmit() {
    const f = parkSendForm
    if (!f.park_name.trim() || !f.date_sent || !f.time_sent || !f.person.trim() || !f.destination) {
      showToast('Fill in all required fields', 'error')
      return
    }
    await updateStatus.mutateAsync({
      id: order.id,
      status: 'sent_to_park',
      extra: { state: f.destination },
      extraSafe: {
        park_sent_name: f.park_name.trim(),
        park_sent_at: new Date(`${f.date_sent}T${f.time_sent}`).toISOString(),
        park_sent_by: f.person.trim(),
        park_origin_state: order.state,
        return_decision: 'send_another_state',
      },
      timelineDesc: `Sent to State Park (${f.park_name.trim()}) — ${order.state} → ${f.destination} · sent by ${f.person.trim()}${f.notes.trim() ? ` · ${f.notes.trim()}` : ''} — by ${user?.name} (${user?.role})`,
    })
    await sendReturnToAnotherState(order, f.destination, user)
    setShowParkSendModal(false)
  }

  const FAILED_REASONS = [
    { value: 'customer_absent',      label: 'Customer absent' },
    { value: 'customer_unreachable', label: 'Customer unreachable' },
    { value: 'customer_refused',     label: 'Customer refused order' },
    { value: 'reschedule_requested', label: 'Customer requested reschedule' },
    { value: 'wrong_address',        label: 'Wrong address' },
    { value: 'other',                label: 'Other' },
  ]

  const STOCK_DISPOSITIONS = [
    { value: 'returned_warehouse', label: 'Returned to State Warehouse',
      desc: 'Back in the warehouse and available for future orders' },
    { value: 'left_at_park', label: 'Left at State Park',
      desc: 'At the transport park, awaiting further instruction' },
    { value: 'transferred_state', label: 'Transferred to Another State',
      desc: 'Sent to another state — creates an incoming transfer' },
    { value: 'damaged', label: 'Damaged',
      desc: 'Can no longer be sold — written off as damaged' },
  ]

  const TRANSFER_REASONS = [
    { value: 'customer_relocated',     label: 'Customer relocated' },
    { value: 'another_order',          label: 'Another customer order' },
    { value: 'stock_balancing',        label: 'Stock balancing' },
    { value: 'management_instruction', label: 'Management instruction' },
    { value: 'other',                  label: 'Other' },
  ]

  const failedValid = failedForm.reason &&
    (failedForm.reason !== 'other' || failedForm.custom.trim()) &&
    failedForm.disposition &&
    (failedForm.disposition !== 'transferred_state' || failedForm.destinationState) &&
    (failedForm.disposition !== 'left_at_park' ||
      (failedForm.parkName.trim() && failedForm.contactName.trim() && failedForm.contactPhone.trim()))

  async function handleFailedSubmit() {
    if (!failedValid) return
    const reasonLabel = FAILED_REASONS.find(r => r.value === failedForm.reason)?.label || failedForm.reason
    const reasonText = failedForm.reason === 'other'
      ? failedForm.custom.trim()
      : `${reasonLabel}${failedForm.custom.trim() ? ` — ${failedForm.custom.trim()}` : ''}`
    const dispLabel = STOCK_DISPOSITIONS.find(d => d.value === failedForm.disposition)?.label || ''
    const stockText = failedForm.disposition === 'transferred_state'
      ? `${dispLabel} (${failedForm.destinationState} — ${TRANSFER_REASONS.find(t => t.value === failedForm.transferReason)?.label || ''})`
      : dispLabel

    await updateStatus.mutateAsync({
      id: order.id,
      status: 'failed_delivery',
      extra: { failed_reason: reasonText },
      stockOutcome: {
        disposition: failedForm.disposition,
        destinationState: failedForm.destinationState || undefined,
        transferReason: failedForm.transferReason || undefined,
        parkName: failedForm.parkName.trim() || undefined,
        parkLocation: failedForm.parkLocation.trim() || undefined,
        contactName: failedForm.contactName.trim() || undefined,
        contactPhone: failedForm.contactPhone.trim() || undefined,
        contactRole: failedForm.contactRole || undefined,
      },
      timelineDesc: `Failed Delivery: ${reasonText} — stock: ${stockText} — by ${user?.name}`,
    })
    setShowFailedModal(false)
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
    <div className="flex flex-col h-full overflow-x-hidden w-full">
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
              user?.role === 'customer_support' ? (
                // Support's only operational action: cancel with a reason.
                // Every other status change belongs to waybill/fulfillment.
                <Button size="sm" variant="danger" onClick={() => {
                  setCancelReason(''); setCancelNotes('')
                  setPendingStatus('cancelled'); setShowReasonModal(true)
                }}>
                  Cancel Order
                </Button>
              ) : (
                <Button size="sm" onClick={() => setShowStatusModal(true)}>
                  Status
                </Button>
              )
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
            {(orderOfficersQ.data || []).length > 0 && (
              <p className="text-[11px] text-gray-400 mb-2 -mt-1">
                Fulfillment officer{orderOfficersQ.data.length !== 1 ? 's' : ''} ({order.state}):{' '}
                {orderOfficersQ.data.map(o => o.name).join(', ')}
              </p>
            )}
            {order.status === 'partially_paid' && (
              <div className="mt-2 p-3 bg-amber-50 rounded-xl">
                <p className="text-xs text-amber-700">
                  Paid: {formatCurrency(order.amount_paid)} · Balance: <strong>{formatCurrency(order.balance_amount)}</strong>
                  {order.balance_due_date && ` · Due: ${formatDate(order.balance_due_date)}`}
                </p>
              </div>
            )}
            {order.delivery_fee_pending && (
              <div className="mt-2 p-3 bg-orange-50 rounded-xl flex items-center justify-between gap-2">
                <p className="text-xs text-orange-700 font-medium flex-1 min-w-0">Delivery Fee Pending — awaiting warehouse</p>
                <button
                  onClick={() => setShowExpenseModal(true)}
                  className="text-xs font-semibold text-orange-800 underline shrink-0 active:opacity-70"
                >
                  Enter fee
                </button>
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

          {/* Return decision (recorded after the WhatsApp discussion) */}
          {(order.status === 'returned' || order.status === 'sent_to_park' || order.return_decision) && (
            <div className="bg-white rounded-2xl p-4 border border-gray-100">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Return Decision</h3>
              {order.return_decision ? (
                <>
                  <p className="text-sm font-semibold text-gray-900">
                    {RETURN_DECISIONS.find(d => d.value === order.return_decision)?.label || order.return_decision}
                  </p>
                  {order.return_decision_notes && (
                    <p className="text-xs text-gray-500 mt-0.5">{order.return_decision_notes}</p>
                  )}
                  {order.park_sent_name && (
                    <p className="text-xs text-gray-500 mt-1">
                      Park: {order.park_sent_name} · Sent by {order.park_sent_by}
                      {order.park_sent_at ? ` · ${formatDateTime(order.park_sent_at)}` : ''}
                      {order.park_origin_state ? ` · ${order.park_origin_state} → ${order.state}` : ''}
                    </p>
                  )}
                  {order.return_decision === 'send_another_state' && order.status === 'returned' && canDecide && (
                    <Button size="sm" className="w-full mt-3" onClick={() => {
                      const now = new Date()
                      setParkSendForm({
                        park_name: '', notes: '', destination: '',
                        date_sent: now.toISOString().split('T')[0],
                        time_sent: now.toTimeString().slice(0, 5),
                        person: user?.name || '',
                      })
                      setShowParkSendModal(true)
                    }}>
                      Sent to State Park
                    </Button>
                  )}
                </>
              ) : canDecide ? (
                <>
                  <p className="text-xs text-gray-500 mb-2">
                    Discuss the return with the Operations Manager on WhatsApp, then record the final decision here.
                  </p>
                  <Button size="sm" className="w-full" onClick={() => { setDecisionForm({ decision: '', notes: '' }); setShowDecisionModal(true) }}>
                    Record Decision
                  </Button>
                </>
              ) : (
                <p className="text-xs text-gray-400">Awaiting decision from the operations discussion</p>
              )}
              {order.return_condition && (
                <p className="text-xs text-gray-400 mt-2 capitalize">Condition on return: {order.return_condition.replace(/_/g, ' ')}</p>
              )}
              {order.return_photos && (
                <a href={order.return_photos} target="_blank" rel="noreferrer" className="text-xs text-blue-600 font-medium mt-1 inline-block">
                  View photos →
                </a>
              )}
            </div>
          )}

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

            {/* Items display — uses items array when available, falls back to order summary */}
            {order.items && order.items.length > 0 ? (
              <div className="space-y-2">
                {order.items.length > 1 && (
                  <p className="text-xs text-gray-500">{order.items.length} products</p>
                )}
                {order.items.map((item, idx) => (
                  <div key={item.id || idx} className="bg-gray-50 rounded-xl p-3 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold text-gray-900">{item.product_name}</p>
                      <p className="text-sm font-bold text-gray-900 shrink-0">
                        {formatCurrency(item.total_amount || (Number(item.quantity) * Number(item.unit_price)))}
                      </p>
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
        {/* Procurement review: does the destination state already hold the stock? */}
        {order.status === 'new' && (
          <div className={`rounded-xl p-3 mb-3 text-xs ${
            destStock.data?.available > 0 ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'
          }`}>
            {destStock.isLoading ? (
              <p>Checking {order.state} warehouse stock…</p>
            ) : destStock.data?.hasWarehouse === false ? (
              <p className="font-medium">No warehouse in {order.state} — this order will need a waybill.</p>
            ) : destStock.data?.available > 0 ? (
              <p className="font-medium">{destStock.data.available} unit{destStock.data.available !== 1 ? 's' : ''} available in the {order.state} warehouse — you can mark Processing directly.</p>
            ) : (
              <p className="font-medium">No stock of this product in the {order.state} warehouse — choose Awaiting Waybill to ship it.</p>
            )}
            <p className="mt-1 text-[11px] opacity-80">
              Processing = stock already at destination · Awaiting Waybill = ship from Lagos
            </p>
            <button
              onClick={() => navigate('/my-stock')}
              className="mt-2 w-full py-2 bg-white/70 rounded-lg text-[11px] font-semibold text-gray-700 active:scale-95 transition-all">
              Open My Warehouse Stock
            </button>
          </div>
        )}
        {order.status === 'arrived_at_park' && (
          <div className="rounded-xl p-3 mb-3 text-xs bg-cyan-50 text-cyan-900">
            <p className="font-medium">The shipment is at the {order.state} State Park.</p>
            <p className="mt-1 text-[11px] opacity-80">
              Picked Up from Park = deliver straight to the customer · At Warehouse = move it to the state warehouse first
            </p>
          </div>
        )}
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

      {/* Park Pickup Modal — direct delivery from State Park */}
      <Modal
        isOpen={showParkPickupModal}
        onClose={() => setShowParkPickupModal(false)}
        title={`Picked Up from ${order.state} State Park`}
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowParkPickupModal(false)} className="flex-1">Cancel</Button>
            <Button onClick={handleParkPickupSubmit} loading={updateStatus.isPending} className="flex-1"
              disabled={!parkForm.rider_phone.trim()}>
              Confirm Pickup
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-xs text-gray-500">The product goes straight from the State Park to the customer.</p>
          <Input label="Rider's Phone Number" type="tel" inputMode="tel" required placeholder="08012345678"
            value={parkForm.rider_phone} onChange={e => setParkForm({ ...parkForm, rider_phone: e.target.value })} />
          <Input label="Pick-up Time" type="datetime-local" required
            value={parkForm.pickup_time} onChange={e => setParkForm({ ...parkForm, pickup_time: e.target.value })} />
          <Textarea label="Notes (optional)" rows={2} placeholder="Vehicle, landmark, instructions..."
            value={parkForm.notes} onChange={e => setParkForm({ ...parkForm, notes: e.target.value })} />
        </div>
      </Modal>

      {/* Warehouse Receipt Modal — park → state warehouse */}
      <Modal
        isOpen={showWhReceiptModal}
        onClose={() => setShowWhReceiptModal(false)}
        title={`Received at ${order.state} Warehouse`}
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowWhReceiptModal(false)} className="flex-1">Cancel</Button>
            <Button onClick={handleWhReceiptSubmit} loading={updateStatus.isPending} className="flex-1"
              disabled={!whForm.qty || Number(whForm.qty) <= 0}>
              Confirm Receipt
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-xs text-gray-500">The product moves from the State Park into the state warehouse.</p>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Quantity Received" type="number" inputMode="numeric" required min="1"
              value={whForm.qty} onChange={e => setWhForm({ ...whForm, qty: e.target.value })} />
            <Input label="Time Received" type="datetime-local" required
              value={whForm.time} onChange={e => setWhForm({ ...whForm, time: e.target.value })} />
          </div>
          <Select label="Condition" required value={whForm.condition}
            onChange={e => setWhForm({ ...whForm, condition: e.target.value })}>
            <option value="good">Good condition</option>
            <option value="minor_damage">Minor damage</option>
            <option value="damaged">Damaged</option>
            <option value="incomplete">Incomplete / missing parts</option>
          </Select>
          <Textarea label="Notes (optional)" rows={2}
            value={whForm.notes} onChange={e => setWhForm({ ...whForm, notes: e.target.value })} />
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
          <Button onClick={handleExpenseSubmit} className="w-full">Save Expenses</Button>
        }
      >
        <p className="text-xs text-gray-500 mb-4">Enter any fulfillment expenses for this order (leave blank if none)</p>
        <div className="space-y-3">
          <Input label="Delivery Fee (₦)" type="number" inputMode="decimal" placeholder="0"
            value={expense.delivery_fee} onChange={e => setExpense({ ...expense, delivery_fee: e.target.value })} />
          {!order.delivery_fee_pending && !Number(expense.delivery_fee) && (
            <button
              type="button"
              onClick={handleFeePending}
              className="w-full py-2.5 text-sm font-medium text-orange-700 bg-orange-50 border border-orange-200 rounded-xl active:scale-[0.98] transition-all"
            >
              Delivery Fee Pending — warehouse hasn't sent it yet
            </button>
          )}
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
        title={pendingStatus === 'cancelled' ? 'Cancel Order' : 'Mark as Returned'}
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowReasonModal(false)} className="flex-1">Back</Button>
            <Button
              variant="danger"
              onClick={handleReasonSubmit}
              loading={updateStatus.isPending}
              className="flex-1"
              disabled={!(pendingStatus === 'cancelled' ? cancelReason : returnReason).trim()}
            >
              Confirm
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Textarea
            label={pendingStatus === 'cancelled' ? 'Reason for cancellation' : 'Reason for return'}
            placeholder="Describe what happened..."
            value={pendingStatus === 'cancelled' ? cancelReason : returnReason}
            onChange={e => {
              if (pendingStatus === 'cancelled') setCancelReason(e.target.value)
              else setReturnReason(e.target.value)
            }}
            rows={4}
            required
          />
          {pendingStatus === 'cancelled' && (
            <Textarea
              label="Notes (optional)"
              placeholder="Anything else worth recording..."
              value={cancelNotes}
              onChange={e => setCancelNotes(e.target.value)}
              rows={2}
            />
          )}
          {pendingStatus === 'returned' && (
            <>
              <Select label="Condition of Product" required value={returnExtra.condition}
                onChange={e => setReturnExtra({ ...returnExtra, condition: e.target.value })}>
                <option value="good">Good condition</option>
                <option value="minor_damage">Minor damage</option>
                <option value="damaged">Damaged</option>
                <option value="incomplete">Incomplete / missing parts</option>
              </Select>
              <Input label="Photo link (optional)" placeholder="https://... (photos of the product)"
                value={returnExtra.photos}
                onChange={e => setReturnExtra({ ...returnExtra, photos: e.target.value })} />
              <p className="text-[11px] text-gray-400">
                After saving, discuss with the Operations Manager on WhatsApp, then record the decision on this order.
              </p>
            </>
          )}
        </div>
      </Modal>

      {/* Return decision modal */}
      <Modal
        isOpen={showDecisionModal}
        onClose={() => setShowDecisionModal(false)}
        title="Record Return Decision"
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowDecisionModal(false)} className="flex-1">Cancel</Button>
            <Button onClick={handleDecisionSubmit} loading={updateStatus.isPending}
              className="flex-1"
              disabled={!decisionForm.decision || (decisionForm.decision === 'other' && !decisionForm.notes.trim())}>
              Record Decision
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-xs text-gray-500">
            Record the decision agreed with the Operations Manager in the WhatsApp group.
          </p>
          <div className="space-y-2">
            {RETURN_DECISIONS.map(d => (
              <button key={d.value} type="button"
                onClick={() => setDecisionForm({ ...decisionForm, decision: d.value })}
                className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all ${
                  decisionForm.decision === d.value ? 'border-yellow-400 bg-yellow-50' : 'border-gray-200 bg-white'
                }`}>
                <p className="text-sm font-medium text-gray-900">{d.label}</p>
              </button>
            ))}
          </div>
          <Textarea
            label={decisionForm.decision === 'other' ? 'Notes (required)' : 'Notes (optional)'}
            rows={2}
            value={decisionForm.notes}
            onChange={e => setDecisionForm({ ...decisionForm, notes: e.target.value })}
          />
        </div>
      </Modal>

      {/* Sent to State Park modal (send to another state) */}
      <Modal
        isOpen={showParkSendModal}
        onClose={() => setShowParkSendModal(false)}
        title="Sent to State Park"
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowParkSendModal(false)} className="flex-1">Cancel</Button>
            <Button onClick={handleParkSendSubmit} loading={updateStatus.isPending}
              className="flex-1"
              disabled={!parkSendForm.park_name.trim() || !parkSendForm.date_sent || !parkSendForm.time_sent || !parkSendForm.person.trim() || !parkSendForm.destination}>
              Confirm
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input label="State Park Name" required placeholder="e.g. GUO Transport Park, Jibowu"
            value={parkSendForm.park_name}
            onChange={e => setParkSendForm({ ...parkSendForm, park_name: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Date Sent" type="date" required
              value={parkSendForm.date_sent}
              onChange={e => setParkSendForm({ ...parkSendForm, date_sent: e.target.value })} />
            <Input label="Time Sent" type="time" required
              value={parkSendForm.time_sent}
              onChange={e => setParkSendForm({ ...parkSendForm, time_sent: e.target.value })} />
          </div>
          <Input label="Person Sending" required
            value={parkSendForm.person}
            onChange={e => setParkSendForm({ ...parkSendForm, person: e.target.value })} />
          <Select label="Destination State" required value={parkSendForm.destination}
            onChange={e => setParkSendForm({ ...parkSendForm, destination: e.target.value })}>
            <option value="">Select state...</option>
            {NIGERIAN_STATES.filter(s => s !== order.state).map(s => <option key={s} value={s}>{s}</option>)}
          </Select>
          <Textarea label="Notes (optional)" rows={2}
            value={parkSendForm.notes}
            onChange={e => setParkSendForm({ ...parkSendForm, notes: e.target.value })} />
          <p className="text-[11px] text-gray-400">
            The order becomes "Sent to State Park" and the Waybill Officer takes over — it will appear in their list for a new waybill to {parkSendForm.destination || 'the destination'}.
          </p>
        </div>
      </Modal>

      {/* Failed Delivery Modal — reason + where the stock is now */}
      <Modal
        isOpen={showFailedModal}
        onClose={() => setShowFailedModal(false)}
        title="Mark Failed Delivery"
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowFailedModal(false)} className="flex-1">Back</Button>
            <Button variant="danger" onClick={handleFailedSubmit} loading={updateStatus.isPending}
              className="flex-1" disabled={!failedValid}>
              Confirm
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Select label="Reason for Failed Delivery" required value={failedForm.reason}
            onChange={e => setFailedForm({ ...failedForm, reason: e.target.value })}>
            <option value="">Select reason...</option>
            {FAILED_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </Select>
          <Textarea
            label={failedForm.reason === 'other' ? 'Describe the reason (required)' : 'Additional details (optional)'}
            placeholder="What happened?"
            rows={2}
            value={failedForm.custom}
            onChange={e => setFailedForm({ ...failedForm, custom: e.target.value })}
          />

          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">Where is the stock now?</p>
            <div className="space-y-2">
              {STOCK_DISPOSITIONS.map(o => (
                <button key={o.value} type="button"
                  onClick={() => setFailedForm({ ...failedForm, disposition: o.value })}
                  className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all ${
                    failedForm.disposition === o.value
                      ? 'border-yellow-400 bg-yellow-50'
                      : 'border-gray-200 bg-white'
                  }`}>
                  <p className="text-sm font-medium text-gray-900">{o.label}</p>
                  <p className="text-xs text-gray-500">{o.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {failedForm.disposition === 'left_at_park' && (
            <div className="bg-cyan-50 rounded-xl p-3 space-y-3">
              <p className="text-xs font-semibold text-cyan-800 uppercase tracking-wide">Holding Details</p>
              <p className="text-[11px] text-cyan-900">
                The order closes as Failed Delivery; the product enters the Holding Queue and stays traceable until its next move.
              </p>
              <Input label="State Park Name" required placeholder="e.g. Uselu Motor Park, Benin"
                value={failedForm.parkName} onChange={e => setFailedForm({ ...failedForm, parkName: e.target.value })} />
              <Input label="Exact Park Location (optional)" placeholder="Shed 4, beside loading bay"
                value={failedForm.parkLocation} onChange={e => setFailedForm({ ...failedForm, parkLocation: e.target.value })} />
              <div className="grid grid-cols-2 gap-3">
                <Input label="Contact Name" required
                  value={failedForm.contactName} onChange={e => setFailedForm({ ...failedForm, contactName: e.target.value })} />
                <Input label="Contact Phone" type="tel" inputMode="tel" required
                  value={failedForm.contactPhone} onChange={e => setFailedForm({ ...failedForm, contactPhone: e.target.value })} />
              </div>
              <Select label="Contact Role" value={failedForm.contactRole}
                onChange={e => setFailedForm({ ...failedForm, contactRole: e.target.value })}>
                <option value="driver">Driver</option>
                <option value="park_manager">Park Manager</option>
                <option value="stockkeeper">Stockkeeper</option>
                <option value="other">Other</option>
              </Select>
            </div>
          )}

          {failedForm.disposition === 'transferred_state' && (
            <div className="bg-blue-50 rounded-xl p-3 space-y-3">
              <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Transfer Details</p>
              <Select label="Destination State" required value={failedForm.destinationState}
                onChange={e => setFailedForm({ ...failedForm, destinationState: e.target.value })}>
                <option value="">Select state...</option>
                {NIGERIAN_STATES.filter(s => s !== order.state).map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
              <Select label="Reason for Transfer" value={failedForm.transferReason}
                onChange={e => setFailedForm({ ...failedForm, transferReason: e.target.value })}>
                {TRANSFER_REASONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
              <p className="text-[11px] text-blue-800">
                Stock goes In Transit and the {failedForm.destinationState || 'destination'} fulfillment officer gets an incoming transfer to receive.
              </p>
            </div>
          )}
        </div>
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
