import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

export function Modal({ isOpen, onClose, title, children, size = 'md', footer }) {
  const overlayRef = useRef(null)

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape' && isOpen) onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const sizes = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    full: 'max-w-full mx-4',
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 animate-fade-in"
      onClick={(e) => { if (e.target === overlayRef.current) onClose() }}
    >
      <div className={`w-full ${sizes[size]} bg-white rounded-t-3xl sm:rounded-2xl max-h-[90vh] flex flex-col animate-slide-up`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 active:scale-95 transition-all"
          >
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-4">
          {children}
        </div>
        {footer && (
          <div className="px-5 py-4 border-t border-gray-100 shrink-0 safe-area-bottom">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

export function ConfirmModal({ isOpen, onClose, onConfirm, title, message, confirmLabel = 'Confirm', danger = false, loading = false }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
      <p className="text-sm text-gray-600 mb-6">{message}</p>
      <div className="flex gap-3">
        <button
          onClick={onClose}
          className="flex-1 py-2.5 px-4 rounded-xl border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 active:scale-95 transition-all"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={loading}
          className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-medium text-white active:scale-95 transition-all disabled:opacity-50 ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}
        >
          {loading ? 'Loading...' : confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
