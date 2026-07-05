export function buildOrderMessage(order) {
  const lines = [
    `*ORDER: ${order.order_number}*`,
    `Customer: ${order.customer_name}`,
    `Phone: ${order.customer_phone}`,
    `Address: ${[order.address, order.city, order.state].filter(Boolean).join(', ')}`,
  ]

  if (order.items && order.items.length > 0) {
    lines.push(`Products:`)
    for (const item of order.items) {
      const detail = [
        item.color ? `(${item.color})` : '',
        item.size ? `Size: ${item.size}` : '',
      ].filter(Boolean).join(' ')
      lines.push(`  • ${item.product_name}${detail ? ' ' + detail : ''} × ${item.quantity} — ₦${Number(item.unit_price).toLocaleString()}`)
    }
  } else {
    lines.push(`Product: ${order.product_name}${order.color ? ` (${order.color})` : ''}${order.size ? ` - ${order.size}` : ''}`)
    lines.push(`Qty: ${order.quantity}`)
  }

  lines.push(`Total: ₦${Number(order.total_amount).toLocaleString()}`)
  if (order.customer_requested_delivery_date) lines.push(`Requested Delivery: ${order.customer_requested_delivery_date}`)
  if (order.preferred_delivery_time) lines.push(`Preferred Time: ${order.preferred_delivery_time}`)
  if (order.delivery_note) lines.push(`Note: ${order.delivery_note}`)
  if (order.business?.name) lines.push(`Business: ${order.business.name}`)
  return lines.join('\n')
}

export function openWhatsApp(phone, message = '') {
  const clean = phone.replace(/\D/g, '')
  const intl = clean.startsWith('0') ? `234${clean.slice(1)}` : clean
  const url = `https://wa.me/${intl}${message ? `?text=${encodeURIComponent(message)}` : ''}`
  window.open(url, '_blank')
}

export function openDialer(phone) {
  window.location.href = `tel:${phone}`
}
