import { useState } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { CalendarDays, ExternalLink, ChevronRight } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { TopBar } from '../../components/layout/TopBar'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { SkeletonList } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'
import { useAuthStore } from '../../stores/authStore'
import { formatDate } from '../../utils/format'
import { useReviewLeave, LEAVE_TYPES, labelOf } from '../../hooks/useStaff'

const STATUS_COLORS = { pending: 'amber', approved: 'green', rejected: 'red', cancelled: 'gray' }

const days = (l) => Math.max(1, Math.round((new Date(l.end_date) - new Date(l.start_date)) / 86400000) + 1)

// Management view of every staff leave request — tapping a request shows
// the exact staff member's full detail, with approve/reject right here
export function LeaveRequestsPage() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const reviewLeave = useReviewLeave()
  const [tab, setTab] = useState('pending')

  const isManager = ['ceo', 'super_admin', 'operations_manager'].includes(user?.role)

  // staff_leave links to staff_users twice (staff_id and reviewed_by), so an
  // embedded join is ambiguous — the rows and the staff list are fetched
  // separately and matched here.
  const leaveQ = useQuery({
    queryKey: ['all_leave_requests'],
    enabled: isManager,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.from('staff_leave')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) {
        // Only a genuinely missing table means "not migrated yet"
        if (/does not exist|schema cache/i.test(error.message || '')) return null
        throw error
      }
      const rows = data || []
      const ids = Array.from(new Set(rows.map(l => l.staff_id).filter(Boolean)))
      let byId = new Map()
      if (ids.length > 0) {
        const { data: staff } = await supabase.from('staff_users')
          .select('id, name, staff_code, role, department').in('id', ids)
        byId = new Map((staff || []).map(s => [s.id, s]))
      }
      return rows.map(l => ({ ...l, staff: byId.get(l.staff_id) || null }))
    },
    staleTime: 30000,
  })

  if (!isManager) return <Navigate to="/settings" replace />

  const all = leaveQ.data || []
  const list = tab === 'pending' ? all.filter(l => l.status === 'pending') : all
  const pendingCount = all.filter(l => l.status === 'pending').length

  return (
    <div className="flex flex-col h-full overflow-x-hidden w-full">
      <TopBar title="Leave Requests" />

      <div className="px-4 pt-3 pb-2 bg-white border-b border-gray-100 sticky top-[57px] z-20 flex gap-2">
        {[
          { key: 'pending', label: `Pending${pendingCount ? ` (${pendingCount})` : ''}` },
          { key: 'all', label: 'All Requests' },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium rounded-xl transition-all ${tab === key ? 'bg-blue-600 text-black' : 'bg-gray-100 text-gray-600'}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-3">
        {leaveQ.isLoading ? <SkeletonList count={4} /> :
         leaveQ.isError ? (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
            <p className="text-sm font-semibold text-red-800 mb-1">Could not load leave requests</p>
            <p className="text-xs text-red-700">{leaveQ.error?.message || 'Unknown error'}</p>
          </div>
        ) : leaveQ.data === null ? (
          <p className="text-sm text-gray-400 text-center py-8">
            Leave tables not found — run the Staff Management migration first.
          </p>
        ) : list.length === 0 ? (
          <EmptyState icon={<CalendarDays size={28} />}
            title={tab === 'pending' ? 'No pending leave requests' : 'No leave requests yet'}
            description={tab === 'pending' ? 'Every request has been reviewed' : 'Requests appear here as staff apply'} />
        ) : list.map(l => (
          <div key={l.id} className="bg-white rounded-2xl p-4 border border-gray-100">
            {/* Tapping the request opens the exact staff member's page on their Leave tab */}
            <button className="w-full text-left"
              onClick={() => l.staff?.id && navigate(`/settings/staff/${l.staff.id}?tab=leave`)}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{l.staff?.name || 'Unknown staff'}</p>
                  <Badge color={STATUS_COLORS[l.status] || 'gray'}>{l.status}</Badge>
                </div>
                <ChevronRight size={16} className="text-gray-300 shrink-0" />
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                {[l.staff?.staff_code, (l.staff?.role || '').replace(/_/g, ' '), l.staff?.department].filter(Boolean).join(' · ')}
              </p>
              <p className="text-sm text-gray-800 mt-2">
                <span className="font-medium">{labelOf(LEAVE_TYPES, l.leave_type)}</span>
                {' '}· {formatDate(l.start_date)} → {formatDate(l.end_date)}
                {' '}<span className="text-gray-500">({days(l)} day{days(l) !== 1 ? 's' : ''})</span>
              </p>
              {l.reason && <p className="text-xs text-gray-600 mt-1">{l.reason}</p>}
              {l.review_note && <p className="text-xs text-gray-400 mt-0.5">Review note: {l.review_note}</p>}
              {l.reviewed_by_name && (
                <p className="text-[11px] text-gray-400 mt-0.5">
                  Reviewed by {l.reviewed_by_name}{l.reviewed_at ? ` · ${formatDate(l.reviewed_at)}` : ''}
                </p>
              )}
              <p className="text-[11px] text-gray-400 mt-0.5">Requested {formatDate(l.created_at)}</p>
            </button>
            {l.attachment_url && (
              <a href={l.attachment_url} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-blue-700 font-medium mt-1">
                <ExternalLink size={12} /> Attachment
              </a>
            )}
            {l.status === 'pending' && (
              <div className="flex gap-2 mt-3">
                <Button size="sm" className="flex-1" loading={reviewLeave.isPending}
                  onClick={() => reviewLeave.mutate({ leave: l, decision: 'approved' })}>
                  Approve
                </Button>
                <Button size="sm" variant="danger" className="flex-1" loading={reviewLeave.isPending}
                  onClick={() => {
                    const note = window.prompt('Reason for rejection (optional)')
                    if (note !== null) reviewLeave.mutate({ leave: l, decision: 'rejected', note })
                  }}>
                  Reject
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
