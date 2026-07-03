import { ArrowLeft, Wifi, WifiOff } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../../stores/appStore'

export function TopBar({ title, back, actions, subtitle }) {
  const navigate = useNavigate()
  const { isOnline, offlineQueueCount } = useAppStore()

  return (
    <header className="sticky top-0 z-30 bg-white border-b border-gray-100 safe-area-top">
      <div className="flex items-center px-4 py-3 gap-3 max-w-lg mx-auto">
        {back !== false && (
          <button
            onClick={() => navigate(-1)}
            className="p-1.5 -ml-1.5 rounded-xl text-gray-600 hover:bg-gray-100 active:scale-95 transition-all"
          >
            <ArrowLeft size={20} />
          </button>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold text-gray-900 leading-tight">{title}</h1>
          {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
        </div>
        {!isOnline && (
          <div className="flex items-center gap-1 text-amber-600 bg-amber-50 px-2 py-1 rounded-full">
            <WifiOff size={12} />
            <span className="text-xs font-medium">{offlineQueueCount > 0 ? `${offlineQueueCount} queued` : 'Offline'}</span>
          </div>
        )}
        {actions && <div className="flex items-center gap-1 shrink-0">{actions}</div>}
      </div>
    </header>
  )
}

export function PageHeader({ title, subtitle, action }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div>
        <h2 className="text-lg font-bold text-gray-900">{title}</h2>
        {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}
