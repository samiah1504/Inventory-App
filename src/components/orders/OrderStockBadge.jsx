import { useStockAvailability, orderStockBadge } from '../../hooks/useStockFlow'

const TONES = {
  green: 'bg-green-100 text-green-800',
  amber: 'bg-amber-100 text-amber-800',
  gray: 'bg-gray-100 text-gray-600',
}

// "Stock available in Abuja" / "Stock not in Abuja — waybill needed"
// for orders that haven't been dispatched yet
export function OrderStockBadge({ order, className = '' }) {
  const { data } = useStockAvailability()
  const badge = orderStockBadge(order, data)
  if (!badge) return null
  return (
    <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${TONES[badge.tone]} ${className}`}>
      {badge.text}
    </span>
  )
}
