import { Navigate } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { TopBar } from '../../components/layout/TopBar'
import { SkeletonList } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'
import { useAuthStore } from '../../stores/authStore'
import { formatCurrency, formatDateTime, statusLabel } from '../../utils/format'
import { DELETE_REASONS } from '../../lib/orderPurge'

export function DeletedOrderAuditPage() {
  const { user, realUser } = useAuthStore()
  const isCeo = ['ceo', 'super_admin'].includes(user?.role) && !user?._preview && !realUser

  const auditQ = useQuery({
    queryKey: ['deleted_order_audit'],
    enabled: isCeo,
    retry: false,
    queryFn: async () => {
      try {
        const { data, error } = await supabase.from('deleted_order_audit')
          .select('*').order('created_at', { ascending: false }).limit(200)
        if (error) throw error
        return data || []
      } catch { return null }
    },
    staleTime: 30000,
  })

  if (!isCeo) return <Navigate to="/settings" replace />

  const rows = auditQ.data

  return (
    <div className="flex flex-col h-full overflow-x-hidden w-full">
      <TopBar title="Deleted Order Audit" />
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-3">
        <p className="text-xs text-gray-500">
          CEO-only record of permanently deleted orders. The orders themselves no longer exist anywhere else.
        </p>

        {auditQ.isLoading ? <SkeletonList count={4} /> :
         rows === null ? (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800">
            <p className="font-semibold mb-1">Audit table not set up yet</p>
            <p>Run the deleted_order_audit section of <span className="font-mono text-xs">supabase/migrations.sql</span> in the Supabase SQL editor.</p>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<ShieldAlert size={28} />} title="No deletions recorded"
            description="Permanent deletions will be logged here" />
        ) : rows.map(r => (
          <div key={r.id} className="bg-white rounded-2xl p-4 border border-gray-100">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-mono text-gray-500">{r.order_number}</span>
              <span className="text-xs text-gray-400 shrink-0">{formatDateTime(r.created_at)}</span>
            </div>
            <p className="text-sm font-semibold text-gray-900 mt-0.5">{r.customer_name}</p>
            <p className="text-xs text-gray-500">
              {[r.business_name, r.total_amount != null ? formatCurrency(r.total_amount) : null,
                r.previous_status ? `was ${statusLabel(r.previous_status)}` : null].filter(Boolean).join(' · ')}
            </p>
            <p className="text-xs text-gray-600 mt-1">
              <span className="text-gray-400">Reason: </span>
              {DELETE_REASONS.find(x => x.value === r.reason)?.label || r.reason || '—'}
              {r.notes ? ` — ${r.notes}` : ''}
            </p>
            <div className="flex items-center justify-between mt-1">
              <p className="text-[11px] text-gray-400">Deleted by {r.deleted_by_name || '—'}</p>
              {r.customer_deleted && (
                <span className="text-[10px] font-semibold bg-red-50 text-red-700 px-1.5 py-0.5 rounded">CUSTOMER PROFILE DELETED</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
