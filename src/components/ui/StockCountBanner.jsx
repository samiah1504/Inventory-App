import { useNavigate } from 'react-router-dom'
import { ClipboardCheck } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useWeeklyCountStatus } from '../../hooks/useStockFlow'

// Monday stock-take reminder (counters) / approvals waiting (CEO)
export function StockCountBanner({ mode = 'count' }) {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const status = useWeeklyCountStatus()
  if (!status.ready) return null

  if (mode === 'approve') {
    if (!['ceo', 'super_admin'].includes(user?.role) || status.pendingApproval.length === 0) return null
    const n = status.pendingApproval.length
    return (
      <button onClick={() => navigate('/inventory?tab=count')}
        className="w-full text-left bg-amber-50 border border-amber-200 rounded-2xl p-4 flex gap-3 items-center active:scale-[0.99]">
        <ClipboardCheck size={20} className="text-amber-700 shrink-0" />
        <span className="text-sm text-amber-900">
          <span className="font-semibold">{n} stock count{n !== 1 ? 's' : ''} need your approval</span>
          <span className="block text-xs">Differences between the shelf count and the app — tap to review</span>
        </span>
      </button>
    )
  }

  if (status.doneThisWeek) return null
  const isMonday = new Date().getDay() === 1
  return (
    <button onClick={() => navigate('/inventory?tab=count')}
      className={`w-full text-left rounded-2xl p-4 flex gap-3 items-center active:scale-[0.99] border ${isMonday ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
      <ClipboardCheck size={20} className={isMonday ? 'text-red-700 shrink-0' : 'text-amber-700 shrink-0'} />
      <span className={`text-sm ${isMonday ? 'text-red-900' : 'text-amber-900'}`}>
        <span className="font-semibold">{isMonday ? "Today is stock count day" : "This week's stock count is still due"}</span>
        <span className="block text-xs">Count every warehouse and the goods at parks — tap to start</span>
      </span>
    </button>
  )
}
