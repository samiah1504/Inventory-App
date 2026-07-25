import { useNavigate } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { useMyDisciplinaryUnread } from '../../hooks/useDisciplinary'

// In-app notification for the affected employee: shown on their
// dashboard whenever an unread disciplinary notice exists. WhatsApp
// remains the company's communication channel — this is the in-app
// notice the employee cannot miss.
export function DisciplinaryBanner() {
  const navigate = useNavigate()
  const unreadQ = useMyDisciplinaryUnread()
  const unread = unreadQ.data || 0
  if (unread === 0) return null
  return (
    <button
      onClick={() => navigate('/my-warnings')}
      className="w-full bg-red-50 border border-red-200 rounded-2xl p-4 text-left active:scale-[0.99] transition-all"
    >
      <div className="flex items-start gap-3">
        <span className="p-2 bg-red-100 text-red-600 rounded-xl shrink-0"><ShieldAlert size={18} /></span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-red-800">
            New Disciplinary Notice{unread > 1 ? `s (${unread})` : ''}
          </p>
          <p className="text-xs text-red-700 mt-0.5">
            A disciplinary notice has been issued to you by management. Tap to review the reason,
            expected improvement and any sanction applied.
          </p>
        </div>
      </div>
    </button>
  )
}
