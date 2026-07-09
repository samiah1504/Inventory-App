import { Phone, MessageCircle, Copy, MapPin, Calendar, Package } from 'lucide-react'
import { StatusBadge } from '../../components/ui/Badge'
import { formatCurrency, formatDate } from '../../utils/format'
import { openDialer, openWhatsApp, buildOrderMessage } from '../../utils/whatsapp'
import { useAppStore } from '../../stores/appStore'

export function OrderCard({ order, onClick, showActions = true }) {
  const { showToast } = useAppStore()

  function handleCopy(e) {
    e.stopPropagation()
    const msg = buildOrderMessage(order)
    navigator.clipboard.writeText(msg).then(() => {
      showToast('Order copied to clipboard', 'success')
    })
  }

  function handleCall(e) {
    e.stopPropagation()
    openDialer(order.customer_phone)
  }

  function handleWhatsApp(e) {
    e.stopPropagation()
    openWhatsApp(order.customer_phone)
  }

  return (
    <div
      onClick={onClick}
      className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden cursor-pointer active:scale-[0.99] transition-transform"
    >
      {/* Header */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-xs font-mono text-gray-400">{order.order_number}</span>
              <StatusBadge status={order.status} />
              {order.delivery_fee_pending && order.status === 'paid' && (
                <span className="text-[10px] font-semibold bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full">
                  FEE PENDING
                </span>
              )}
              {order.business?.short_code && (
                <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-medium">
                  {order.business.short_code}
                </span>
              )}
            </div>
            <h3 className="text-sm font-semibold text-gray-900">{order.customer_name}</h3>
            <p className="text-xs text-gray-500">{order.customer_phone}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-base font-bold text-gray-900">{formatCurrency(order.total_amount)}</p>
            <p className="text-xs text-gray-400">{formatDate(order.created_at)}</p>
          </div>
        </div>
      </div>

      {/* Product & Location */}
      <div className="px-4 pb-2 flex flex-wrap gap-3">
        <div className="flex items-center gap-1.5 text-xs text-gray-600">
          <Package size={12} className="text-gray-400" />
          <span>{order.product_name}</span>
          {order.quantity > 1 && <span className="text-gray-400">×{order.quantity}</span>}
          {order.color && <span className="text-gray-400">· {order.color}</span>}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-gray-600">
          <MapPin size={12} className="text-gray-400" />
          <span>{order.state}</span>
          {order.city && <span className="text-gray-400">, {order.city}</span>}
        </div>
        {order.planned_delivery_date && (
          <div className="flex items-center gap-1.5 text-xs text-blue-600 font-medium">
            <Calendar size={12} />
            <span>Delivery: {formatDate(order.planned_delivery_date)}</span>
          </div>
        )}
        {!order.planned_delivery_date && order.customer_requested_delivery_date && (
          <div className="flex items-center gap-1.5 text-xs text-gray-600">
            <Calendar size={12} className="text-gray-400" />
            <span>Req: {formatDate(order.customer_requested_delivery_date)}</span>
          </div>
        )}
      </div>

      {/* Payment status if partial */}
      {order.status === 'partially_paid' && order.balance_amount && (
        <div className="mx-4 mb-2 px-3 py-1.5 bg-amber-50 rounded-lg">
          <p className="text-xs text-amber-700">
            Paid: {formatCurrency(order.amount_paid)} · Balance: <span className="font-semibold">{formatCurrency(order.balance_amount)}</span>
          </p>
        </div>
      )}

      {/* Actions */}
      {showActions && (
        <div className="border-t border-gray-50 px-4 py-2 flex gap-2">
          <button
            onClick={handleCall}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium text-green-700 bg-green-50 rounded-lg active:scale-95 transition-all"
          >
            <Phone size={14} /> Call
          </button>
          <button
            onClick={handleWhatsApp}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 rounded-lg active:scale-95 transition-all"
          >
            <MessageCircle size={14} /> WhatsApp
          </button>
          <button
            onClick={handleCopy}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 rounded-lg active:scale-95 transition-all"
          >
            <Copy size={14} /> Copy
          </button>
        </div>
      )}
    </div>
  )
}
