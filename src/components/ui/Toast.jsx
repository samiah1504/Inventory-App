import { useEffect } from 'react'
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'

export function Toast() {
  const { toast, clearToast } = useAppStore()

  if (!toast) return null

  const config = {
    success: { icon: <CheckCircle size={18} />, bg: 'bg-green-600' },
    error: { icon: <AlertCircle size={18} />, bg: 'bg-red-600' },
    info: { icon: <Info size={18} />, bg: 'bg-blue-600' },
    warning: { icon: <AlertCircle size={18} />, bg: 'bg-amber-500' },
  }

  const { icon, bg } = config[toast.type] || config.info

  return (
    <div className="fixed top-4 left-4 right-4 z-[100] flex justify-center animate-slide-up">
      <div className={`flex items-center gap-3 ${bg} text-white px-4 py-3 rounded-2xl shadow-lg max-w-sm w-full`}>
        {icon}
        <p className="text-sm font-medium flex-1">{toast.message}</p>
        <button onClick={clearToast} className="shrink-0">
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
