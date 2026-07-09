import { useNavigate } from 'react-router-dom'
import { Eye } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'

const ROLE_LABELS = {
  operations_manager: 'Operations Manager',
  customer_support: 'Customer Support',
  fulfillment: 'Fulfillment Officer',
  waybill: 'Waybill Officer',
  inventory: 'Inventory / Warehouse Staff',
  accountant: 'Accountant',
}

// Shown while the CEO is previewing another role — sits just above the
// bottom nav so it never collides with sticky page headers.
export function RolePreviewBanner() {
  const { user, endPreview } = useAuthStore()
  const navigate = useNavigate()

  if (!user?._preview) return null

  return (
    <div className="fixed left-0 right-0 bottom-[76px] z-40 px-3 pointer-events-none">
      <div className="max-w-lg mx-auto pointer-events-auto bg-gray-900 text-white rounded-2xl px-4 py-2.5 flex items-center justify-between gap-2 shadow-lg">
        <div className="flex items-center gap-2 min-w-0">
          <Eye size={15} className="text-yellow-400 shrink-0" />
          <p className="text-xs font-medium truncate">
            Viewing as {ROLE_LABELS[user.role] || user.role}
          </p>
        </div>
        <button
          onClick={() => { endPreview(); navigate('/') }}
          className="text-xs font-bold text-yellow-400 shrink-0 active:opacity-70"
        >
          Back to CEO View
        </button>
      </div>
    </div>
  )
}
