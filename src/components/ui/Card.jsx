export function Card({ children, className = '', onClick, ...props }) {
  return (
    <div
      className={`bg-white rounded-2xl shadow-sm border border-gray-100 ${onClick ? 'cursor-pointer active:scale-[0.98] transition-transform' : ''} ${className}`}
      onClick={onClick}
      {...props}
    >
      {children}
    </div>
  )
}

export function StatCard({ label, value, icon, color = 'blue', sub, onClick }) {
  const colors = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
    purple: 'bg-purple-50 text-purple-600',
    gray: 'bg-gray-50 text-gray-600',
  }
  return (
    <Card className={`p-4 ${onClick ? 'cursor-pointer active:scale-[0.98] transition-transform' : ''}`} onClick={onClick}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-gray-500 mb-1">{label}</p>
          <p className="text-2xl font-bold text-gray-900 leading-tight">{value}</p>
          {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
        </div>
        {icon && (
          <div className={`p-2 rounded-xl ${colors[color]} shrink-0`}>
            {icon}
          </div>
        )}
      </div>
    </Card>
  )
}
