import { useState, useEffect } from 'react'
import { RefreshCw } from 'lucide-react'

export function PWAUpdateBanner() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    let refreshing = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return
      refreshing = true
      setShow(true)
    })
  }, [])

  if (!show) return null

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] bg-blue-600 text-black px-4 py-3 flex items-center justify-between gap-3 shadow-lg">
      <p className="text-sm font-medium">New version available</p>
      <button
        onClick={() => window.location.reload()}
        className="flex items-center gap-1.5 text-sm font-semibold bg-white text-blue-600 px-3 py-1.5 rounded-lg active:scale-95 transition-all shrink-0"
      >
        <RefreshCw size={14} />
        Reload
      </button>
    </div>
  )
}
