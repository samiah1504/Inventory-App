import { useState, useMemo } from 'react'
import { ChevronDown, ChevronUp, ExternalLink, Settings2 } from 'lucide-react'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { Input } from '../ui/Input'
import { Badge } from '../ui/Badge'
import { useAuthStore } from '../../stores/authStore'
import { formatCurrency, formatDate, formatDateTime } from '../../utils/format'
import {
  DISC_STATUS, categoryLabel, sanctionLabel, deductionState, monthLabel,
  CAN_APPROVE, useDisciplinaryActions, useDisciplinaryAudit,
  useApproveDisciplinary, useRejectDisciplinary, useWithdrawDisciplinary,
  useSetDisciplinaryStatus, useDeleteDraft,
  useDisciplinarySettings, useSaveDisciplinarySettings,
} from '../../hooks/useDisciplinary'

function AuditTrail({ actionId }) {
  const auditQ = useDisciplinaryAudit(actionId)
  const rows = auditQ.data || []
  if (rows.length === 0) return null
  return (
    <div className="bg-gray-50 rounded-xl p-3 mt-2">
      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Audit Log</p>
      <div className="space-y-1.5">
        {rows.map(l => (
          <div key={l.id}>
            <p className="text-xs text-gray-700 font-medium capitalize">{(l.action || '').replace(/_/g, ' ')}</p>
            {l.new_value && <p className="text-[11px] text-gray-500">{l.new_value}</p>}
            <p className="text-[10px] text-gray-400">
              {[l.performed_by_name, formatDateTime(l.created_at)].filter(Boolean).join(' · ')}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

// Admin view of one employee's full disciplinary record: stats, timeline
// and per-record management actions
export function DisciplinaryHistory({ staff }) {
  const { user } = useAuthStore()
  const actionsQ = useDisciplinaryActions(staff?.id)
  const approve = useApproveDisciplinary()
  const reject = useRejectDisciplinary()
  const withdraw = useWithdrawDisciplinary()
  const setStatus = useSetDisciplinaryStatus()
  const deleteDraft = useDeleteDraft()

  const [expanded, setExpanded] = useState(null)
  const isApprover = CAN_APPROVE.includes(user?.role)
  const actions = actionsQ.data

  const stats = useMemo(() => {
    const list = actions || []
    const issuedLike = list.filter(a => !['draft', 'pending_approval', 'rejected'].includes(a.status))
    const active = issuedLike.filter(a => ['issued', 'escalated'].includes(a.status))
    const sanctions = issuedLike.filter(a => a.sanction_type)
    const deductions = issuedLike.filter(a => a.deduction && a.deduction.payroll_status !== 'reversed')
    const totalDeducted = deductions.reduce((s, a) => s + Number(a.deduction.calculated_deduction_amount || 0), 0)
    const catCounts = {}
    issuedLike.forEach(a => {
      const c = categoryLabel(a)
      if (c && c !== '—') catCounts[c] = (catCounts[c] || 0) + 1
    })
    const repeated = Object.entries(catCounts).filter(([, n]) => n > 1).sort(([, a], [, b]) => b - a)
    // Warning frequency: actions in the last 90 days
    const cutoff = new Date(Date.now() - 90 * 86400000).toISOString()
    const recent90 = issuedLike.filter(a => a.created_at >= cutoff).length
    return {
      total: issuedLike.length,
      active: active.length,
      resolved: issuedLike.filter(a => a.status === 'resolved').length,
      sanctions: sanctions.length,
      totalDeducted,
      recent90,
      mostRecent: issuedLike[0] || null,
      repeated,
    }
  }, [actions])

  if (actions === null) return null // migration not run — parent shows the notice

  return (
    <div className="space-y-3">
      {/* ── Disciplinary History stats ── */}
      {stats.total > 0 && (
        <div className="bg-white rounded-2xl p-4 border border-gray-100">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Disciplinary History</p>
          <div className="grid grid-cols-3 gap-2">
            {[
              ['Total', stats.total], ['Active', stats.active], ['Resolved', stats.resolved],
              ['Sanctions', stats.sanctions],
              ['Deducted', formatCurrency(stats.totalDeducted)],
              ['Last 90 days', stats.recent90],
            ].map(([k, v]) => (
              <div key={k} className="bg-gray-50 rounded-xl px-2 py-2">
                <p className="text-[10px] text-gray-500 truncate">{k}</p>
                <p className="text-sm font-bold text-gray-900 truncate">{v}</p>
              </div>
            ))}
          </div>
          {stats.mostRecent && (
            <p className="text-[11px] text-gray-500 mt-2">
              Most recent: {stats.mostRecent.incident_title || categoryLabel(stats.mostRecent)} · {formatDate(stats.mostRecent.created_at)}
            </p>
          )}
          {stats.repeated.length > 0 && (
            <p className="text-[11px] text-amber-700 mt-0.5">
              Repeated issues: {stats.repeated.map(([c, n]) => `${c} (×${n})`).join(', ')}
            </p>
          )}
        </div>
      )}

      {/* ── Records timeline ── */}
      {(actions || []).length === 0 && (
        <p className="text-sm text-gray-400 text-center py-4">No disciplinary actions on record</p>
      )}
      {(actions || []).map(a => {
        const st = DISC_STATUS[a.status] || { label: a.status, color: 'gray' }
        const open = expanded === a.id
        const d = a.deduction
        return (
          <div key={a.id} className="bg-white rounded-2xl p-4 border border-gray-100">
            <button className="w-full text-left" onClick={() => setExpanded(open ? null : a.id)}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{a.incident_title || categoryLabel(a)}</p>
                  <Badge color={st.color}>{st.label}</Badge>
                </div>
                {open ? <ChevronUp size={16} className="text-gray-400 shrink-0" /> : <ChevronDown size={16} className="text-gray-400 shrink-0" />}
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                {[categoryLabel(a), a.sanction_type ? sanctionLabel(a.sanction_type) : null, formatDate(a.created_at)].filter(Boolean).join(' · ')}
              </p>
              {d && (
                <p className="text-xs text-red-600 mt-0.5">
                  {d.deduction_type === 'percent' ? `${Number(d.percentage)}%` : formatCurrency(d.fixed_amount)} deduction
                  {' '}· {monthLabel(d.salary_month)} · {formatCurrency(d.calculated_deduction_amount)} · {deductionState(d)}
                </p>
              )}
            </button>

            {open && (
              <div className="mt-3 pt-3 border-t border-gray-50 space-y-2">
                {a.incident_description && <P k="Description" v={a.incident_description} />}
                {a.incident_date && <P k="Incident date" v={formatDate(a.incident_date)} />}
                {a.previous_discussions && <P k="Previous discussions" v={a.previous_discussions} />}
                {a.business_impact && <P k="Business impact" v={a.business_impact} />}
                {a.expected_improvement && <P k="Expected improvement" v={a.expected_improvement} />}
                {a.sanction_details && <P k="Sanction details" v={a.sanction_details} />}
                {a.management_note && <P k="Management note" v={a.management_note} />}
                {d && (
                  <div className="bg-red-50 rounded-xl p-3 text-xs text-red-800 space-y-0.5">
                    <p>Base salary snapshot: {formatCurrency(d.base_salary_snapshot)}</p>
                    <p>Deduction: {d.deduction_type === 'percent' ? `${Number(d.percentage)}%` : 'fixed'} = {formatCurrency(d.calculated_deduction_amount)}</p>
                    <p>Expected net for {monthLabel(d.salary_month)}: {formatCurrency(d.expected_net_salary)}</p>
                    <p>Payroll status: {deductionState(d)}</p>
                  </div>
                )}
                {a.review_date && <P k="Review date" v={formatDate(a.review_date)} />}
                {(a.attachments || []).length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {a.attachments.map(att => (
                      <a key={att.id} href={att.file_url} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-blue-700 font-medium">
                        <ExternalLink size={12} /> {att.file_name || att.file_type || 'attachment'}
                      </a>
                    ))}
                  </div>
                )}
                <div className="text-[11px] text-gray-400 space-y-0.5">
                  <p>Issued by {a.issued_by_name || '—'}{a.issued_at ? ` · ${formatDateTime(a.issued_at)}` : ''}</p>
                  {a.approved_by_name && <p>Approved by {a.approved_by_name} · {formatDateTime(a.approved_at)}</p>}
                  {a.employee_opened_at && <p>Opened by employee · {formatDateTime(a.employee_opened_at)}</p>}
                  {a.employee_acknowledged_at && <p>Acknowledged · {formatDateTime(a.employee_acknowledged_at)}</p>}
                  {a.employee_response && <p className="text-gray-600">Employee response: {a.employee_response}</p>}
                  {a.employee_attachment_url && (
                    <a href={a.employee_attachment_url} target="_blank" rel="noreferrer" className="text-blue-700">Employee evidence</a>
                  )}
                  {a.review_requested && <p className="text-amber-700 font-medium">Employee requested a management review</p>}
                  {a.withdrawal_reason && <p>Withdrawn by {a.withdrawn_by_name}: {a.withdrawal_reason}</p>}
                  {a.rejected_reason && <p>Rejected: {a.rejected_reason}</p>}
                </div>

                {/* Admin actions */}
                <div className="flex flex-wrap gap-2 pt-1">
                  {a.status === 'pending_approval' && isApprover && a.issued_by !== user?.id && (
                    <>
                      <Button size="sm" loading={approve.isPending}
                        onClick={() => approve.mutate({ action: a })}>Approve & Issue</Button>
                      <Button size="sm" variant="danger" loading={reject.isPending}
                        onClick={() => {
                          const reason = window.prompt('Reason for rejection?')
                          if (reason !== null) reject.mutate({ action: a, reason })
                        }}>Reject</Button>
                    </>
                  )}
                  {a.status === 'pending_approval' && a.issued_by === user?.id && (
                    <p className="text-[11px] text-amber-700">Awaiting approval — you cannot approve your own request.</p>
                  )}
                  {['draft', 'pending_approval', 'rejected'].includes(a.status) && (
                    <Button size="sm" variant="secondary" loading={deleteDraft.isPending}
                      onClick={() => window.confirm('Delete this draft?') && deleteDraft.mutate({ action: a })}>
                      Delete Draft
                    </Button>
                  )}
                  {['issued', 'escalated'].includes(a.status) && isApprover && (
                    <>
                      <Button size="sm" variant="secondary" loading={setStatus.isPending}
                        onClick={() => setStatus.mutate({ action: a, status: 'resolved' })}>Mark Resolved</Button>
                      {a.status !== 'escalated' && (
                        <Button size="sm" variant="secondary" loading={setStatus.isPending}
                          onClick={() => setStatus.mutate({ action: a, status: 'escalated' })}>Escalate</Button>
                      )}
                      <Button size="sm" variant="danger" loading={withdraw.isPending}
                        onClick={() => {
                          const reason = window.prompt('Withdrawal reason (required — the employee will see it):')
                          if (reason?.trim()) withdraw.mutate({ action: a, reason })
                        }}>Withdraw</Button>
                    </>
                  )}
                </div>
                <AuditTrail actionId={a.id} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function P({ k, v }) {
  return (
    <p className="text-xs text-gray-700 whitespace-pre-wrap">
      <span className="text-gray-400">{k}: </span>{v}
    </p>
  )
}

// CEO-only configuration modal
export function DisciplinarySettingsModal({ isOpen, onClose }) {
  const settingsQ = useDisciplinarySettings()
  const save = useSaveDisciplinarySettings()
  const s = settingsQ.data || {}
  const [form, setForm] = useState(null)
  const f = form || {
    max_deduction_percent: s.max_deduction_percent ?? 20,
    deductions_require_approval: s.deductions_require_approval ?? true,
    employees_can_appeal: s.employees_can_appeal ?? true,
    appeal_days: s.appeal_days ?? 7,
    default_review_days: s.default_review_days ?? 30,
  }
  const set = (patch) => setForm({ ...f, ...patch })
  return (
    <Modal isOpen={isOpen} onClose={() => { setForm(null); onClose() }} title="Disciplinary Settings"
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => { setForm(null); onClose() }}>Cancel</Button>
          <Button className="flex-1" loading={save.isPending}
            onClick={async () => { await save.mutateAsync(f); setForm(null); onClose() }}>
            Save Settings
          </Button>
        </div>
      }>
      <div className="space-y-4">
        <Input label="Maximum permitted deduction (%)" type="number" inputMode="decimal"
          value={f.max_deduction_percent}
          onChange={e => set({ max_deduction_percent: e.target.value })} />
        {[
          ['deductions_require_approval', 'Salary deductions by managers require CEO approval'],
          ['employees_can_appeal', 'Employees can request a management review (appeal)'],
        ].map(([key, label]) => (
          <label key={key} className="flex items-start gap-2.5 bg-gray-50 rounded-xl p-3 cursor-pointer">
            <input type="checkbox" checked={!!f[key]}
              onChange={e => set({ [key]: e.target.checked })}
              className="mt-0.5 w-4 h-4 accent-yellow-400 shrink-0" />
            <span className="text-xs text-gray-700">{label}</span>
          </label>
        ))}
        <div className="grid grid-cols-2 gap-3">
          <Input label="Appeal window (days)" type="number" inputMode="numeric"
            value={f.appeal_days} onChange={e => set({ appeal_days: e.target.value })} />
          <Input label="Default review period (days)" type="number" inputMode="numeric"
            value={f.default_review_days} onChange={e => set({ default_review_days: e.target.value })} />
        </div>
        <p className="text-[11px] text-gray-400">
          Settings apply to all future disciplinary actions. Run the Disciplinary migration first if saving fails.
        </p>
      </div>
    </Modal>
  )
}

export { Settings2 as DisciplinarySettingsIcon }
