import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Pencil, KeyRound, FileText, Download, Trash2, ExternalLink, Plus, Check } from 'lucide-react'
import { TopBar } from '../../components/layout/TopBar'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { Input, Select, Textarea } from '../../components/ui/Input'
import { Badge } from '../../components/ui/Badge'
import { useAuthStore } from '../../stores/authStore'
import { useAppStore } from '../../stores/appStore'
import { formatDate } from '../../utils/format'
import { useBusinesses } from '../../hooks/useBusinesses'
import {
  useStaffMember, useStaffLeave, useStaffWarnings, useStaffDocuments, useStaffNotes,
  useStaffPerformance, useResetPassword, useApplyLeave, useReviewLeave, useCancelLeave,
  useIssueWarning, useSaveDocument, useDeleteDocument, useAddStaffNote, useDeleteStaffNote,
  LEAVE_TYPES, WARNING_TYPES, DOCUMENT_CATEGORIES, STAFF_STATUSES, labelOf,
} from '../../hooks/useStaff'
import { useSetStaffStatus, useSetStaffAccess, useSetAssignedStates, ACCESS_AREAS, accessFor } from '../../hooks/useStaff'
import { NIGERIAN_STATES } from '../../utils/format'
import { StaffFormModal, ROLES, EMPLOYMENT_TYPES } from './StaffFormModal'
import { generateWarningLetter, generateStaffLetter } from '../../lib/staffPdf'
import { savePdf } from '../../lib/pdf'
import { EmploymentTab, ContractTab } from './StaffHrTabs'

const TABS = [
  { key: 'profile',     label: 'Profile' },
  { key: 'employment',  label: 'Employment', ceoOnly: true },
  { key: 'contract',    label: 'Contract', ceoOnly: true },
  { key: 'leave',       label: 'Leave' },
  { key: 'discipline',  label: 'Discipline' },
  { key: 'documents',   label: 'Documents' },
  { key: 'performance', label: 'Performance' },
  { key: 'notes',       label: 'Notes' },
]

const statusColors = { active: 'green', on_leave: 'amber', suspended: 'red', inactive: 'gray' }
const leaveColors  = { pending: 'amber', approved: 'green', rejected: 'red', cancelled: 'gray' }

function MigrationNotice() {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800">
      <p className="font-semibold mb-1">HR tables not found</p>
      <p>Run the Staff Management section of <span className="font-mono text-xs">supabase/migrations.sql</span> in your Supabase SQL editor to enable this tab.</p>
    </div>
  )
}

export function StaffDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { showToast } = useAppStore()
  const { data: businesses } = useBusinesses()

  const [tab, setTab] = useState('profile')
  const [showEdit, setShowEdit] = useState(false)
  const [showReset, setShowReset] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [showLeaveForm, setShowLeaveForm] = useState(false)
  const [showWarningForm, setShowWarningForm] = useState(false)
  const [docModal, setDocModal] = useState(null) // { doc? } — null closed, {} new
  const [noteText, setNoteText] = useState('')

  const staffQ = useStaffMember(id)
  const leaveQ = useStaffLeave(id)
  const warningsQ = useStaffWarnings(id)
  const documentsQ = useStaffDocuments(id)
  const notesQ = useStaffNotes(id)
  const perfQ = useStaffPerformance(id)

  const resetPassword = useResetPassword()
  const setStatus = useSetStaffStatus()
  const applyLeave = useApplyLeave()
  const reviewLeave = useReviewLeave()
  const cancelLeave = useCancelLeave()
  const issueWarning = useIssueWarning()
  const saveDocument = useSaveDocument()
  const deleteDocument = useDeleteDocument()
  const addNote = useAddStaffNote()
  const deleteNote = useDeleteStaffNote()
  const setAccess = useSetStaffAccess()
  const setAssignedStates = useSetAssignedStates()
  const [accessDraft, setAccessDraft] = useState(null)
  const [statesDraft, setStatesDraft] = useState(null)

  const staff = staffQ.data
  const isCeo = ['ceo', 'super_admin'].includes(user?.role)
  const isManager = isCeo || user?.role === 'operations_manager'
  const businessName = businesses?.find(b => b.id === staff?.business_id)?.name || businesses?.[0]?.name

  const [leaveForm, setLeaveForm] = useState({ leave_type: 'annual', start_date: '', end_date: '', reason: '', attachment_url: '' })
  const [warningForm, setWarningForm] = useState({
    warning_type: 'verbal', category: '', incident_details: '',
    corrective_action: '', review_date: '', consequence: '',
    date_issued: new Date().toISOString().split('T')[0],
  })
  const [docForm, setDocForm] = useState({ category: 'other', title: '', file_url: '', body: '', notes: '' })

  if (staffQ.isLoading) {
    return (
      <div className="flex flex-col h-full overflow-x-hidden w-full">
        <TopBar title="Staff" />
        <div className="px-4 py-4 space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-20 shimmer rounded-2xl" />)}</div>
      </div>
    )
  }
  if (!staff) {
    return (
      <div className="flex flex-col h-full overflow-x-hidden w-full">
        <TopBar title="Staff" />
        <p className="text-sm text-gray-400 text-center py-10">Staff member not found</p>
      </div>
    )
  }

  const warningDoc = (w) => {
    const doc = generateWarningLetter(w, staff, businessName)
    savePdf(doc, `warning-${staff.staff_code}-${w.date_issued}.pdf`)
  }

  const openDocument = (d) => {
    if (d.source === 'generated') {
      if (d.reference_id) {
        const w = (warningsQ.data || []).find(x => x.id === d.reference_id)
        if (w) return warningDoc(w)
      }
      const doc = generateStaffLetter(d, staff, businessName)
      return savePdf(doc, `${d.title.replace(/\s+/g, '-').toLowerCase()}.pdf`)
    }
    if (d.file_url) window.open(d.file_url, '_blank', 'noopener')
    else showToast('No file attached to this document', 'error')
  }

  return (
    <div className="flex flex-col h-full overflow-x-hidden w-full">
      <TopBar
        title={staff.name}
        actions={isCeo && (
          <div className="flex gap-2">
            {/* Deletion is an advanced function: Settings → Advanced → Delete Staff */}
            <button onClick={() => setShowReset(true)} title="Reset password"
              className="p-2 bg-gray-100 text-gray-700 rounded-xl active:scale-95 transition-all">
              <KeyRound size={18} />
            </button>
            <button onClick={() => setShowEdit(true)} title="Edit profile"
              className="p-2 bg-blue-600 text-black rounded-xl active:scale-95 transition-all">
              <Pencil size={18} />
            </button>
          </div>
        )}
      />

      {/* Header card + tabs */}
      <div className="bg-white border-b border-gray-100 sticky top-[57px] z-20 px-4 pt-3 pb-2 space-y-2 w-full overflow-x-hidden">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 font-bold shrink-0">
            {staff.name?.[0]}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{staff.name} · {staff.staff_code}</p>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <Badge color="blue">{labelOf(ROLES, staff.role)}</Badge>
              <Badge color={statusColors[staff.status || 'active']}>{labelOf(STAFF_STATUSES, staff.status || 'active')}</Badge>
            </div>
          </div>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {TABS.filter(t => (t.key !== 'notes' || isManager) && (!t.ceoOnly || isCeo)).map(({ key, label }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium ${tab === key ? 'bg-blue-600 text-black' : 'bg-gray-100 text-gray-600'}`}
            >{label}</button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-3">

        {/* ── PROFILE ── */}
        {tab === 'profile' && (
          <>
            <div className="bg-white rounded-2xl p-4 border border-gray-100 space-y-2.5">
              {[
                ['Full Name', staff.name],
                ['Staff Code', staff.staff_code],
                ['Username', `@${staff.username}`],
                ['Phone', staff.phone],
                ['Email', staff.email],
                ['Address', staff.address],
                ['Department', staff.department],
                ['Position', staff.position],
                ['Role', labelOf(ROLES, staff.role)],
                ['Business', staff.business?.name || (staff.business_id ? '' : 'All businesses')],
                ['Employment Type', staff.employment_type ? labelOf(EMPLOYMENT_TYPES, staff.employment_type) : null],
                ['Date Joined', staff.date_joined ? formatDate(staff.date_joined) : null],
                ['Last Login', staff.last_login ? formatDate(staff.last_login) : null],
              ].filter(([, v]) => v).map(([label, value]) => (
                <div key={label}>
                  <p className="text-[11px] text-gray-400">{label}</p>
                  <p className="text-sm text-gray-800">{value}</p>
                </div>
              ))}
            </div>

            {/* Assigned states — which states this fulfillment officer covers */}
            {isManager && staff.role === 'fulfillment' && (() => {
              const current = statesDraft ?? (Array.isArray(staff.assigned_states) ? staff.assigned_states : [])
              const dirty = statesDraft !== null
              const toggle = (s) => setStatesDraft(
                current.includes(s) ? current.filter(x => x !== s) : [...current, s]
              )
              return (
                <div className="bg-white rounded-2xl p-4 border border-gray-100">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Assigned States</p>
                  <p className="text-[11px] text-gray-400 mb-3">
                    {staff.name.split(' ')[0]} only sees orders for the ticked states. No ticks = sees all states. Applies at their next login.
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {NIGERIAN_STATES.map(s => {
                      const on = current.includes(s)
                      return (
                        <button key={s} onClick={() => toggle(s)}
                          className={`flex items-center gap-2 px-2.5 py-2 rounded-xl border text-left transition-all active:scale-[0.99] ${
                            on ? 'border-yellow-400 bg-yellow-50' : 'border-gray-200 bg-white'
                          }`}>
                          <span className={`w-4 h-4 rounded flex items-center justify-center shrink-0 ${
                            on ? 'bg-yellow-400 text-gray-900' : 'bg-gray-100 text-transparent'
                          }`}>
                            <Check size={12} />
                          </span>
                          <span className="text-xs text-gray-800 truncate">{s}</span>
                        </button>
                      )
                    })}
                  </div>
                  {dirty && (
                    <Button className="w-full mt-3" size="sm" loading={setAssignedStates.isPending}
                      onClick={async () => {
                        await setAssignedStates.mutateAsync({ staff_id: staff.id, states: current })
                        setStatesDraft(null)
                      }}>
                      Save Assigned States
                    </Button>
                  )}
                </div>
              )
            })()}

            {/* App access — tick what this staff member can open */}
            {isCeo && !['ceo', 'super_admin'].includes(staff.role) && (() => {
              const current = accessDraft ?? accessFor(staff)
              const dirty = accessDraft !== null
              const toggle = (key) => setAccessDraft(
                current.includes(key) ? current.filter(k => k !== key) : [...current, key]
              )
              return (
                <div className="bg-white rounded-2xl p-4 border border-gray-100">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">App Access</p>
                  <p className="text-[11px] text-gray-400 mb-3">Tick what {staff.name.split(' ')[0]} can open. Changes apply the next time they log in.</p>
                  <div className="space-y-1.5">
                    {ACCESS_AREAS.map(a => {
                      const on = current.includes(a.key)
                      return (
                        <button key={a.key} onClick={() => toggle(a.key)}
                          className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-all active:scale-[0.99] ${
                            on ? 'border-yellow-400 bg-yellow-50' : 'border-gray-200 bg-white'
                          }`}>
                          <span className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${
                            on ? 'bg-yellow-400 text-gray-900' : 'bg-gray-100 text-transparent'
                          }`}>
                            <Check size={14} />
                          </span>
                          <span className="text-sm text-gray-800">{a.label}</span>
                        </button>
                      )
                    })}
                  </div>
                  {dirty && (
                    <Button className="w-full mt-3" size="sm" loading={setAccess.isPending}
                      onClick={async () => {
                        await setAccess.mutateAsync({ staff_id: staff.id, access: current })
                        setAccessDraft(null)
                      }}>
                      Save Access
                    </Button>
                  )}
                </div>
              )
            })()}

            {isCeo && (
              <div className="bg-white rounded-2xl p-4 border border-gray-100">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Staff Status</p>
                <div className="grid grid-cols-2 gap-2">
                  {STAFF_STATUSES.map(s => (
                    <button key={s.value}
                      onClick={() => setStatus.mutate({ staff_id: staff.id, status: s.value })}
                      className={`py-2.5 rounded-xl text-sm font-medium border transition-all active:scale-[0.98] ${
                        (staff.status || 'active') === s.value
                          ? 'border-yellow-400 bg-yellow-50 text-gray-900'
                          : 'border-gray-200 bg-white text-gray-600'
                      }`}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ── EMPLOYMENT (official terms, CEO only) ── */}
        {tab === 'employment' && isCeo && <EmploymentTab staff={staff} />}

        {/* ── CONTRACT (onboarding pipeline, CEO only) ── */}
        {tab === 'contract' && isCeo && <ContractTab staff={staff} />}

        {/* ── LEAVE ── */}
        {tab === 'leave' && (
          leaveQ.data === null ? <MigrationNotice /> : (
            <>
              {isManager && (
                <Button variant="secondary" className="w-full" onClick={() => setShowLeaveForm(true)}>
                  <Plus size={16} className="mr-1" /> Record Leave Request
                </Button>
              )}
              {(leaveQ.data || []).length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">No leave history</p>
              ) : (leaveQ.data || []).map(l => (
                <div key={l.id} className="bg-white rounded-2xl p-4 border border-gray-100">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-sm font-semibold text-gray-900">{labelOf(LEAVE_TYPES, l.leave_type)}</p>
                    <Badge color={leaveColors[l.status]}>{l.status}</Badge>
                  </div>
                  <p className="text-xs text-gray-600">{formatDate(l.start_date)} → {formatDate(l.end_date)}</p>
                  {l.reason && <p className="text-xs text-gray-500 mt-1">{l.reason}</p>}
                  {l.attachment_url && (
                    <a href={l.attachment_url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 font-medium mt-1 inline-block">
                      View attachment →
                    </a>
                  )}
                  {l.reviewed_by_name && (
                    <p className="text-[11px] text-gray-400 mt-1">
                      {l.status} by {l.reviewed_by_name}{l.review_note ? ` — ${l.review_note}` : ''}
                    </p>
                  )}
                  {l.status === 'pending' && isManager && (
                    <div className="flex gap-2 mt-3">
                      <Button size="sm" variant="success" className="flex-1"
                        loading={reviewLeave.isPending}
                        onClick={() => reviewLeave.mutate({ leave: l, decision: 'approved' })}>
                        Approve
                      </Button>
                      <Button size="sm" variant="danger" className="flex-1"
                        loading={reviewLeave.isPending}
                        onClick={() => {
                          const note = window.prompt('Reason for rejection (optional)') || ''
                          reviewLeave.mutate({ leave: l, decision: 'rejected', note })
                        }}>
                        Reject
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </>
          )
        )}

        {/* ── DISCIPLINE ── */}
        {tab === 'discipline' && (
          warningsQ.data === null ? <MigrationNotice /> : (
            <>
              {isManager && (
                <Button variant="secondary" className="w-full" onClick={() => setShowWarningForm(true)}>
                  <Plus size={16} className="mr-1" /> Issue Warning
                </Button>
              )}
              {(warningsQ.data || []).length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">No warnings on record</p>
              ) : (warningsQ.data || []).map(w => (
                <div key={w.id} className="bg-white rounded-2xl p-4 border border-gray-100">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-sm font-semibold text-red-700">{labelOf(WARNING_TYPES, w.warning_type)}</p>
                    <span className="text-xs text-gray-400 shrink-0">{formatDate(w.date_issued)}</span>
                  </div>
                  {w.category && <p className="text-xs text-gray-500">Category: {w.category}</p>}
                  {w.incident_details && <p className="text-sm text-gray-700 mt-1">{w.incident_details}</p>}
                  {w.corrective_action && (
                    <p className="text-xs text-gray-600 mt-1"><span className="text-gray-400">Corrective action: </span>{w.corrective_action}</p>
                  )}
                  {w.review_date && (
                    <p className="text-xs text-gray-600"><span className="text-gray-400">Review date: </span>{formatDate(w.review_date)}</p>
                  )}
                  {w.consequence && (
                    <p className="text-xs text-gray-600"><span className="text-gray-400">If not improved: </span>{w.consequence}</p>
                  )}
                  <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-gray-50">
                    <p className="text-[11px] text-gray-400">Issued by {w.issued_by_name || '—'}</p>
                    <button onClick={() => warningDoc(w)}
                      className="flex items-center gap-1 text-xs font-medium text-blue-700 active:scale-95">
                      <Download size={13} /> Letter PDF
                    </button>
                  </div>
                </div>
              ))}
            </>
          )
        )}

        {/* ── DOCUMENTS ── */}
        {tab === 'documents' && (
          documentsQ.data === null ? <MigrationNotice /> : (
            <>
              {isCeo && (
                <Button variant="secondary" className="w-full"
                  onClick={() => { setDocForm({ category: 'other', title: '', file_url: '', body: '', notes: '' }); setDocModal({}) }}>
                  <Plus size={16} className="mr-1" /> Add Document
                </Button>
              )}
              {(documentsQ.data || []).length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">No documents on file</p>
              ) : (documentsQ.data || []).map(d => (
                <div key={d.id} className="bg-white rounded-2xl p-4 border border-gray-100">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 leading-snug">{d.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {labelOf(DOCUMENT_CATEGORIES, d.category)} · {formatDate(d.created_at)}
                        {d.uploaded_by_name ? ` · ${d.uploaded_by_name}` : ''}
                      </p>
                      {d.notes && <p className="text-xs text-gray-400 mt-0.5">{d.notes}</p>}
                    </div>
                    <FileText size={18} className="text-gray-300 shrink-0" />
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => openDocument(d)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-blue-700 bg-blue-50 rounded-lg active:scale-95 transition-all">
                      {d.source === 'generated' ? <Download size={13} /> : <ExternalLink size={13} />}
                      {d.source === 'generated' ? 'Download PDF' : 'View'}
                    </button>
                    {isCeo && (
                      <button
                        onClick={() => { setDocForm({ id: d.id, category: d.category, title: d.title, file_url: d.file_url || '', body: d.body || '', notes: d.notes || '' }); setDocModal({ doc: d }) }}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-gray-700 bg-gray-100 rounded-lg active:scale-95 transition-all">
                        <Pencil size={13} /> Replace
                      </button>
                    )}
                    {isCeo && (
                      <button
                        onClick={() => { if (window.confirm('Delete this document?')) deleteDocument.mutate({ id: d.id }) }}
                        className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-red-600 bg-red-50 rounded-lg active:scale-95 transition-all">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </>
          )
        )}

        {/* ── PERFORMANCE ── */}
        {tab === 'performance' && (
          perfQ.isLoading ? (
            <div className="space-y-3">{[1, 2].map(i => <div key={i} className="h-24 shimmer rounded-2xl" />)}</div>
          ) : (() => {
            const p = perfQ.data
            if (!p) return <p className="text-sm text-gray-400 text-center py-8">No performance data</p>
            const sections = [
              { title: 'Orders (Customer Support)', roleMatch: 'customer_support', rows: [
                ['Orders created', p.orders.created], ['Orders cancelled', p.orders.cancelled]] },
              { title: 'Fulfillment', roleMatch: 'fulfillment', rows: [
                ['Orders delivered', p.fulfillment.delivered], ['Orders paid', p.fulfillment.paid], ['Failed deliveries', p.fulfillment.failed]] },
              { title: 'Waybill', roleMatch: 'waybill', rows: [
                ['Waybill batches created', p.waybill.batches]] },
              { title: 'Inventory', roleMatch: 'inventory', rows: [
                ['Stock received', p.inventory.received], ['Stock adjustments', p.inventory.adjustments]] },
            ]
            const visible = sections.filter(s =>
              s.roleMatch === staff.role || s.rows.some(([, v]) => v[1] > 0))
            if (visible.length === 0) return <p className="text-sm text-gray-400 text-center py-8">No recorded activity yet</p>
            return visible.map(s => (
              <div key={s.title} className="bg-white rounded-2xl p-4 border border-gray-100">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-gray-900">{s.title}</h3>
                  <span className="text-[10px] text-gray-400 uppercase">Month · Total</span>
                </div>
                <div className="divide-y divide-gray-50">
                  {s.rows.map(([label, [month, total]]) => (
                    <div key={label} className="flex items-center justify-between py-2">
                      <span className="text-sm text-gray-600">{label}</span>
                      <span className="text-sm shrink-0">
                        <span className="font-bold text-gray-900">{month}</span>
                        <span className="text-gray-400"> · {total}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          })()
        )}

        {/* ── NOTES (private) ── */}
        {tab === 'notes' && isManager && (
          notesQ.data === null ? <MigrationNotice /> : (
            <>
              <div className="bg-white rounded-2xl p-4 border border-gray-100 space-y-3">
                <Textarea label="Private management note" rows={2}
                  placeholder="e.g. Needs training, strong performer, salary review due..."
                  value={noteText} onChange={e => setNoteText(e.target.value)} />
                <Button className="w-full" size="sm" loading={addNote.isPending}
                  disabled={!noteText.trim()}
                  onClick={async () => { await addNote.mutateAsync({ staff_id: staff.id, note: noteText.trim() }); setNoteText('') }}>
                  Add Note
                </Button>
                <p className="text-[11px] text-gray-400">Only visible to management — staff cannot see these notes.</p>
              </div>
              {(notesQ.data || []).map(n => (
                <div key={n.id} className="bg-white rounded-2xl p-4 border border-gray-100">
                  <p className="text-sm text-gray-800">{n.note}</p>
                  <div className="flex items-center justify-between mt-2">
                    <p className="text-[11px] text-gray-400">{n.created_by_name || '—'} · {formatDate(n.created_at)}</p>
                    {isCeo && (
                      <button onClick={() => deleteNote.mutate({ id: n.id })}
                        className="text-gray-300 active:text-red-500"><Trash2 size={14} /></button>
                    )}
                  </div>
                </div>
              ))}
            </>
          )
        )}
      </div>

      {/* ── Modals ── */}
      <StaffFormModal isOpen={showEdit} onClose={() => setShowEdit(false)} staff={staff} />

      <Modal isOpen={showReset} onClose={() => { setShowReset(false); setNewPassword('') }} title={`Reset Password — ${staff.name}`}
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => { setShowReset(false); setNewPassword('') }} className="flex-1">Cancel</Button>
            <Button className="flex-1" disabled={newPassword.length < 4} loading={resetPassword.isPending}
              onClick={async () => { await resetPassword.mutateAsync({ staff_id: staff.id, password: newPassword }); setShowReset(false); setNewPassword('') }}>
              Reset Password
            </Button>
          </div>
        }>
        <div className="space-y-3">
          <Input label="Temporary Password" type="text" autoCapitalize="none" required
            placeholder="Enter or generate a temporary password"
            value={newPassword} onChange={e => setNewPassword(e.target.value)}
            hint="Share it with the staff member directly (WhatsApp/in person) — they must change it at their next login" />
          <Button variant="secondary" size="sm" className="w-full"
            onClick={async () => {
              const { generateTempPassword } = await import('../../lib/passwords')
              setNewPassword(generateTempPassword())
            }}>
            Generate Temporary Password
          </Button>
        </div>
      </Modal>

      <Modal isOpen={showLeaveForm} onClose={() => setShowLeaveForm(false)} title={`Leave Request — ${staff.name}`}
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowLeaveForm(false)} className="flex-1">Cancel</Button>
            <Button className="flex-1" loading={applyLeave.isPending}
              disabled={!leaveForm.start_date || !leaveForm.end_date}
              onClick={async () => {
                await applyLeave.mutateAsync({ ...leaveForm, staff_id: staff.id })
                setShowLeaveForm(false)
                setLeaveForm({ leave_type: 'annual', start_date: '', end_date: '', reason: '', attachment_url: '' })
              }}>
              Submit
            </Button>
          </div>
        }>
        <div className="space-y-4">
          <Select label="Leave Type" value={leaveForm.leave_type} onChange={e => setLeaveForm({ ...leaveForm, leave_type: e.target.value })}>
            {LEAVE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Start Date" type="date" required value={leaveForm.start_date} onChange={e => setLeaveForm({ ...leaveForm, start_date: e.target.value })} />
            <Input label="End Date" type="date" required value={leaveForm.end_date} onChange={e => setLeaveForm({ ...leaveForm, end_date: e.target.value })} />
          </div>
          <Textarea label="Reason" rows={2} value={leaveForm.reason} onChange={e => setLeaveForm({ ...leaveForm, reason: e.target.value })} />
          <Input label="Attachment link (optional)" placeholder="https://..." value={leaveForm.attachment_url} onChange={e => setLeaveForm({ ...leaveForm, attachment_url: e.target.value })} />
        </div>
      </Modal>

      <Modal isOpen={showWarningForm} onClose={() => setShowWarningForm(false)} title={`Issue Warning — ${staff.name}`}
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowWarningForm(false)} className="flex-1">Cancel</Button>
            <Button variant="danger" className="flex-1" loading={issueWarning.isPending}
              disabled={!warningForm.incident_details.trim()}
              onClick={async () => {
                const w = await issueWarning.mutateAsync({ ...warningForm, staff_id: staff.id })
                setShowWarningForm(false)
                if (w) warningDoc(w)
                setWarningForm({ warning_type: 'verbal', category: '', incident_details: '', corrective_action: '', review_date: '', consequence: '', date_issued: new Date().toISOString().split('T')[0] })
              }}>
              Issue Warning
            </Button>
          </div>
        }>
        <div className="space-y-4">
          <Select label="Warning Type" value={warningForm.warning_type} onChange={e => setWarningForm({ ...warningForm, warning_type: e.target.value })}>
            {WARNING_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
          <Input label="Category" placeholder="e.g. Lateness, Order handling" value={warningForm.category} onChange={e => setWarningForm({ ...warningForm, category: e.target.value })} />
          <Textarea label="Incident Details" rows={3} required value={warningForm.incident_details} onChange={e => setWarningForm({ ...warningForm, incident_details: e.target.value })} />
          <Textarea label="Corrective Action Required" rows={2} value={warningForm.corrective_action} onChange={e => setWarningForm({ ...warningForm, corrective_action: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Review Date" type="date" value={warningForm.review_date} onChange={e => setWarningForm({ ...warningForm, review_date: e.target.value })} />
            <Input label="Date Issued" type="date" value={warningForm.date_issued} onChange={e => setWarningForm({ ...warningForm, date_issued: e.target.value })} />
          </div>
          <Textarea label="Consequence if not improved" rows={2} value={warningForm.consequence} onChange={e => setWarningForm({ ...warningForm, consequence: e.target.value })} />
          <p className="text-[11px] text-gray-400">The warning letter PDF is generated automatically and filed under Documents.</p>
        </div>
      </Modal>

      <Modal isOpen={!!docModal} onClose={() => setDocModal(null)}
        title={docForm.id ? 'Replace Document' : 'Add Document'}
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setDocModal(null)} className="flex-1">Cancel</Button>
            <Button className="flex-1" loading={saveDocument.isPending}
              disabled={!docForm.title.trim()}
              onClick={async () => { await saveDocument.mutateAsync({ ...docForm, staff_id: staff.id }); setDocModal(null) }}>
              Save
            </Button>
          </div>
        }>
        <div className="space-y-4">
          <Select label="Category" value={docForm.category} onChange={e => setDocForm({ ...docForm, category: e.target.value })}>
            {DOCUMENT_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
          <Input label="Title" required placeholder="e.g. Offer Letter — Jan 2026" value={docForm.title} onChange={e => setDocForm({ ...docForm, title: e.target.value })} />
          <Input label="File link (optional)" placeholder="https://drive.google.com/..." value={docForm.file_url} onChange={e => setDocForm({ ...docForm, file_url: e.target.value })} />
          <Textarea label="Or write the letter here to generate a PDF" rows={4}
            placeholder="Letter body — leave empty if you attached a file link above"
            value={docForm.body} onChange={e => setDocForm({ ...docForm, body: e.target.value })} />
          <Textarea label="Notes (optional)" rows={2} value={docForm.notes} onChange={e => setDocForm({ ...docForm, notes: e.target.value })} />
        </div>
      </Modal>
    </div>
  )
}
