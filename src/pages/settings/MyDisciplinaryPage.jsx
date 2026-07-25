import { useState } from 'react'
import { ShieldAlert, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import { TopBar } from '../../components/layout/TopBar'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Input, Textarea } from '../../components/ui/Input'
import { SkeletonList } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'
import { formatCurrency, formatDate, formatDateTime } from '../../utils/format'
import {
  categoryLabel, sanctionLabel, employeeStatus, deductionState, monthLabel, addMonths,
  useMyDisciplinary, useMarkOpened, useAcknowledge, useEmployeeRespond, useDisciplinarySettings,
} from '../../hooks/useDisciplinary'

const STATUS_COLORS = {
  'Unread': 'bg-red-100 text-red-700',
  'Read': 'bg-blue-50 text-blue-700',
  'Under review': 'bg-amber-50 text-amber-700',
  'Improvement period active': 'bg-purple-50 text-purple-700',
  'Resolved': 'bg-green-50 text-green-700',
  'Escalated': 'bg-red-50 text-red-700',
  'Withdrawn': 'bg-gray-100 text-gray-600',
}

// The employee's own disciplinary record. Read-only — the employee can
// acknowledge, explain and request a review, never edit or delete.
export function MyDisciplinaryPage() {
  const listQ = useMyDisciplinary()
  const settingsQ = useDisciplinarySettings()
  const markOpened = useMarkOpened()
  const acknowledge = useAcknowledge()
  const respond = useEmployeeRespond()

  const [expanded, setExpanded] = useState(null)
  const [respondFor, setRespondFor] = useState(null)
  const [respForm, setRespForm] = useState({ text: '', url: '', review: false })

  const list = listQ.data
  const canAppeal = settingsQ.data?.employees_can_appeal ?? true

  function toggle(a) {
    const opening = expanded !== a.id
    setExpanded(opening ? a.id : null)
    // Opening the notice records the read — exactly once
    if (opening && !a.employee_opened_at) markOpened.mutate({ action: a })
  }

  return (
    <div className="flex flex-col h-full overflow-x-hidden w-full">
      <TopBar title="My Warnings & Disciplinary Actions" />
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-3">
        <p className="text-xs text-gray-500">
          Notices issued to you by management. Acknowledging a notice only confirms you have seen
          it — it does not mean you agree with the allegation.
        </p>

        {listQ.isLoading ? <SkeletonList count={3} /> :
         list === null ? (
          <p className="text-sm text-gray-400 text-center py-8">Not available yet — ask the administrator to run the latest migration.</p>
        ) : list.length === 0 ? (
          <EmptyState icon={<ShieldAlert size={28} />} title="No disciplinary notices"
            description="You have no warnings or disciplinary actions on record" />
        ) : list.map(a => {
          const st = employeeStatus(a)
          const open = expanded === a.id
          const d = a.deduction && a.deduction.payroll_status !== 'pending' ? a.deduction : null
          return (
            <div key={a.id} className="bg-white rounded-2xl p-4 border border-gray-100">
              <button className="w-full text-left" onClick={() => toggle(a)}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{a.incident_title || categoryLabel(a)}</p>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[st] || 'bg-gray-100 text-gray-600'}`}>
                      {st.toUpperCase()}
                    </span>
                  </div>
                  {open ? <ChevronUp size={16} className="text-gray-400 shrink-0" /> : <ChevronDown size={16} className="text-gray-400 shrink-0" />}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  {[categoryLabel(a), `Issued ${formatDate(a.issued_at || a.created_at)}`].join(' · ')}
                </p>
                {d && (
                  <p className="text-xs text-red-600 mt-0.5">
                    {d.deduction_type === 'percent' ? `${Number(d.percentage)}%` : formatCurrency(d.fixed_amount)} salary deduction · {monthLabel(d.salary_month)}
                  </p>
                )}
              </button>

              {open && (
                <div className="mt-3 pt-3 border-t border-gray-50 space-y-3">
                  {a.status === 'withdrawn' && (
                    <div className="bg-gray-50 rounded-xl p-3">
                      <p className="text-xs text-gray-600">
                        <span className="font-semibold">This notice was withdrawn by management</span>
                        {a.withdrawal_reason ? ` — ${a.withdrawal_reason}` : ''}. Any salary deduction attached
                        to it has been reversed.
                      </p>
                    </div>
                  )}
                  {a.incident_description && (
                    <div>
                      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Reason</p>
                      <p className="text-sm text-gray-700 whitespace-pre-wrap">{a.incident_description}</p>
                    </div>
                  )}
                  {a.incident_date && <Line k="Incident date" v={formatDate(a.incident_date)} />}
                  {a.expected_improvement && (
                    <div>
                      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Expected Improvement</p>
                      <p className="text-sm text-gray-700 whitespace-pre-wrap">{a.expected_improvement}</p>
                    </div>
                  )}
                  {a.sanction_type && (
                    <Line k="Sanction" v={`${sanctionLabel(a.sanction_type)}${a.sanction_details ? ` — ${a.sanction_details}` : ''}`} />
                  )}
                  {d && (
                    <div className="bg-red-50 rounded-xl p-3 space-y-0.5">
                      <p className="text-xs text-red-800 font-semibold">Salary Deduction</p>
                      <p className="text-xs text-red-800">
                        A {d.duration_type === 'one_month' ? 'one-time ' : ''}
                        {d.deduction_type === 'percent' ? `${Number(d.percentage)}%` : formatCurrency(d.fixed_amount)} salary
                        deduction ({formatCurrency(d.calculated_deduction_amount)}) has been applied to your{' '}
                        {monthLabel(d.salary_month)} salary.
                        {d.duration_type === 'one_month' && (
                          <> This deduction applies only to {monthLabel(d.salary_month)} and will not change your
                          salary from {monthLabel(addMonths(d.salary_month, 1))} onward.</>
                        )}
                      </p>
                      <p className="text-[11px] text-red-700">Status: {deductionState(d)}</p>
                    </div>
                  )}
                  {a.effective_date && <Line k="Effective date" v={formatDate(a.effective_date)} />}
                  {a.review_date && <Line k="Review date" v={formatDate(a.review_date)} />}
                  <Line k="Issued by" v={a.issued_by_name || 'Management'} />
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

                  {/* My response so far */}
                  {(a.employee_response || a.review_requested || a.employee_attachment_url) && (
                    <div className="bg-gray-50 rounded-xl p-3 space-y-0.5">
                      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">My Response</p>
                      {a.employee_response && <p className="text-xs text-gray-700 whitespace-pre-wrap">{a.employee_response}</p>}
                      {a.employee_attachment_url && (
                        <a href={a.employee_attachment_url} target="_blank" rel="noreferrer"
                          className="text-xs text-blue-700 inline-flex items-center gap-1">
                          <ExternalLink size={12} /> My evidence
                        </a>
                      )}
                      {a.review_requested && <p className="text-xs text-amber-700 font-medium">Management review requested</p>}
                      {a.employee_response_at && <p className="text-[10px] text-gray-400">{formatDateTime(a.employee_response_at)}</p>}
                    </div>
                  )}

                  {/* Actions */}
                  {!['withdrawn', 'resolved'].includes(a.status) && (
                    <div className="flex flex-wrap gap-2">
                      {!a.employee_acknowledged_at && (
                        <Button size="sm" loading={acknowledge.isPending}
                          onClick={() => acknowledge.mutate({ action: a })}>
                          I have read this notice
                        </Button>
                      )}
                      <Button size="sm" variant="secondary"
                        onClick={() => {
                          setRespForm({ text: a.employee_response || '', url: a.employee_attachment_url || '', review: false })
                          setRespondFor(a)
                        }}>
                        Submit an explanation
                      </Button>
                      {canAppeal && !a.review_requested && (
                        <Button size="sm" variant="secondary"
                          onClick={() => {
                            setRespForm({ text: a.employee_response || '', url: a.employee_attachment_url || '', review: true })
                            setRespondFor(a)
                          }}>
                          Request review
                        </Button>
                      )}
                    </div>
                  )}
                  {a.employee_acknowledged_at && (
                    <p className="text-[11px] text-gray-400">
                      Acknowledged {formatDateTime(a.employee_acknowledged_at)} — this confirms you saw the
                      notice, not that you agree with it.
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Explanation / review request modal */}
      <Modal isOpen={!!respondFor} onClose={() => setRespondFor(null)}
        title={respForm.review ? 'Request Management Review' : 'Submit an Explanation'}
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setRespondFor(null)}>Cancel</Button>
            <Button className="flex-1" loading={respond.isPending}
              disabled={respForm.review ? false : !respForm.text.trim()}
              onClick={async () => {
                await respond.mutateAsync({
                  action: respondFor,
                  response: respForm.text,
                  attachmentUrl: respForm.url,
                  requestReview: respForm.review,
                })
                setRespondFor(null)
              }}>
              {respForm.review ? 'Request Review' : 'Submit'}
            </Button>
          </div>
        }>
        <div className="space-y-4">
          {respForm.review && (
            <p className="text-xs text-gray-500 bg-gray-50 rounded-xl p-3">
              Your explanation and evidence go to management for review. You&apos;ll see the outcome here.
            </p>
          )}
          <Textarea label={respForm.review ? 'Why should this be reviewed?' : 'Your explanation'}
            rows={4} required={!respForm.review}
            value={respForm.text} onChange={e => setRespForm({ ...respForm, text: e.target.value })} />
          <Input label="Supporting evidence link (optional)" type="url"
            placeholder="https:// — screenshot, document or voice note"
            value={respForm.url} onChange={e => setRespForm({ ...respForm, url: e.target.value })} />
        </div>
      </Modal>
    </div>
  )
}

function Line({ k, v }) {
  return (
    <p className="text-xs text-gray-700">
      <span className="text-gray-400">{k}: </span>{v}
    </p>
  )
}
