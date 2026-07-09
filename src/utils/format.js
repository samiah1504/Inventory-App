export function formatCurrency(amount) {
  if (amount === null || amount === undefined || isNaN(amount)) return '₦0.00'
  return `₦${Number(amount).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function formatDateTime(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleString('en-NG', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true
  })
}

export function formatRelative(dateStr) {
  if (!dateStr) return ''
  const now = new Date()
  const d = new Date(dateStr)
  const diffMs = now - d
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return formatDate(dateStr)
}

export function formatPhone(phone) {
  if (!phone) return ''
  const clean = phone.replace(/\D/g, '')
  if (clean.length === 11 && clean.startsWith('0')) {
    return `${clean.slice(0, 4)} ${clean.slice(4, 7)} ${clean.slice(7)}`
  }
  return phone
}

export function generateOrderNumber(lastNum = 0) {
  const year = new Date().getFullYear()
  const num = String(lastNum + 1).padStart(5, '0')
  return `ORD-${year}-${num}`
}

export function statusLabel(status) {
  const labels = {
    new: 'New Order',
    awaiting_waybill: 'Awaiting Waybill',
    waybilled: 'Waybilled',
    arrived_at_park: 'At State Park',
    picked_up_from_park: 'Picked Up from Park',
    received_at_warehouse: 'At Warehouse',
    processing: 'Processing',
    delivered: 'Delivered',
    paid: 'Paid',
    partially_paid: 'Partially Paid',
    failed_delivery: 'Failed Delivery',
    cancelled: 'Cancelled',
    returned: 'Returned',
    sent_to_park: 'Sent to State Park'
  }
  return labels[status] || status
}

export const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa',
  'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti',
  'Enugu', 'FCT - Abuja', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano',
  'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger',
  'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto',
  'Taraba', 'Yobe', 'Zamfara'
]

export const ORDER_SOURCES = [
  'WhatsApp', 'Instagram', 'Phone Call', 'Website', 'Facebook',
  'Walk-in', 'Referral', 'Other'
]

export const DELIVERY_WINDOWS = [
  'Morning', 'Afternoon', 'Evening', 'Anytime',
  'Before 12pm', 'After 5pm', 'Custom note'
]

export const ORDER_STATUSES = [
  'new', 'awaiting_waybill', 'waybilled', 'arrived_at_park',
  'picked_up_from_park', 'received_at_warehouse',
  'processing', 'delivered', 'partially_paid', 'paid',
  'failed_delivery', 'cancelled', 'returned', 'sent_to_park'
]
