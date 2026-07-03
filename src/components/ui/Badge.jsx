import { statusLabel } from '../../utils/format'

export function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium status-${status}`}>
      {statusLabel(status)}
    </span>
  )
}

export function Badge({ children, color = 'gray', className = '' }) {
  const colors = {
    gray: 'bg-gray-100 text-gray-700',
    blue: 'bg-blue-100 text-blue-700',
    green: 'bg-green-100 text-green-700',
    red: 'bg-red-100 text-red-700',
    amber: 'bg-amber-100 text-amber-700',
    purple: 'bg-purple-100 text-purple-700',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors[color]} ${className}`}>
      {children}
    </span>
  )
}
