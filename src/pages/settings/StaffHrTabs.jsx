import { useState, useEffect } from 'react'
import { FileText, Download, CreditCard, Check, X } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Input, Select, Textarea } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { useBusinesses } from '../../hooks/useBusinesses'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { formatDateTime } from '../../utils/format'
import { generateContractPdf, generateStaffIdPdf } from '../../lib/staffPdf'
import { savePdf } from '../../lib/pdf'
import { EMPLOYMENT_TYPES } from './StaffFormModal'
import {
  useStaffProfileFor, useStaffContracts, useChangeRequests, useProfileAuditFor,
  useReviewProfile, useSaveEmployment, useSaveContract, useIssueContract,
  useReviewChangeRequest, useIssueStaffId,
  employmentStage, missingContractFields, profileCompletion, buildContractBody,
  PERSONAL_FIELDS,
} from '../../hooks/useStaffProfile'

// ─── Employment tab: official terms, CEO-owned ──────────────────────────────

const EMPLOYMENT_FIELDS = [
  ['position', 'Job Title', 'text'],
  ['department', 'Department', 'text'],
  ['work_location', 'Work Location', 'text'],
  ['salary', 'Salary (₦ / month)', 'number'],
  ['working_days', 'Working Days', 'text', 'e.g. Monday – Saturday'],
  ['working_hours', 'Working Hours', 'text', 'e.g. 8:00am – 5:00pm'],
  ['probation_period', 'Probation Period', 'text', 'e.g. 3 months'],
  ['leave_entitlement', 'Leave Entitlement', 'text', 'e.g. 15 working days per year'],
  ['contract_date', 'Contract Date', 'date'],
]

export function EmploymentTab({ staff }) {
  const { data: businesses } = useBusinesses()
  const saveEmployment = useSaveEmployment()
  const [form, setForm] = useState({})
  const [loaded, setLoaded] = useState(false)

  const staffListQ = useQuery({
    queryKey: ['staff_supervisors'],
    queryFn: async () => {
      const { data } = await supabase.from('staff_users')
        .select('id, name, position').eq('is_active', true).order('name')
      return (data || []).filter(s => s.id !== staff.id)
    },
    staleTime: 60000,
  })

  useEffect(() => {
    if (loaded || !staff) return
    const f = {}
    for (const [key] of EMPLOYMENT_FIELDS) f[key] = staff[key] ?? ''
    f.employment_type = staff.employment_type || 'full_time'
    f.date_joined = staff.date_joined || ''
    f.supervisor_id = staff.supervisor_id || ''
    f.special_conditions = staff.special_conditions || ''
    setForm(f)
    setLoaded(true)
  }, [staff, loaded])

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-4">
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Official Employment Information</p>
        <p className="text-[11px] text-gray-400 mt-0.5">
          CEO/Admin only. Staff code: <span className="font-mono font-semibold text-gray-600">{staff.staff_code}</span> ·
          the staff member sees these terms on their issued contract, never edits them.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Select label="Employment Type" value={form.employment_type || 'full_time'}
          onChange={e => setForm({ ...form, employment_type: e.target.value })}>
          {EMPLOYMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </Select>
        <Input label="Start Date" type="date" value={form.date_joined || ''}
          onChange={e => setForm({ ...form, date_joined: e.target.value })} />
      </div>

      {EMPLOYMENT_FIELDS.map(([key, label, type, ph]) => (
        <Input key={key} label={label} type={type} placeholder={ph}
          value={form[key] ?? ''} onChange={e => setForm({ ...form, [key]: e.target.value })} />
      ))}

      <Select label="Supervisor / Reports To" value={form.supervisor_id || ''}
        onChange={e => setForm({ ...form, supervisor_id: e.target.value })}>
        <option value="">None / CEO</option>
        {(staffListQ.data || []).map(s => (
          <option key={s.id} value={s.id}>{s.name}{s.position ? ` — ${s.position}` : ''}</option>
        ))}
      </Select>

      <Textarea label="Special Employment Conditions" rows={3}
        value={form.special_conditions || ''}
        onChange={e => setForm({ ...form, special_conditions: e.target.value })} />

      <Button className="w-full" loading={saveEmployment.isPending}
        onClick={() => {
          const fields = { ...form }
          fields.salary = fields.salary === '' ? null : Number(fields.salary)
          for (const k of ['date_joined', 'contract_date', 'supervisor_id']) {
            if (fields[k] === '') fields[k] = null
          }
          saveEmployment.mutate({ staffId: staff.id, fields })
        }}>
        Save Employment Details
      </Button>
      <p className="text-[11px] text-gray-400">
        Business assignment, role and status stay on the Profile tab.
      </p>
    </div>
  )
}

// ─── Contract tab: review → verify → contract → ID, plus audit ─────────────

export function ContractTab({ staff }) {
  const { data: businesses } = useBusinesses()

  const profileQ = useStaffProfileFor(staff.id)
  const contractsQ = useStaffContracts(staff.id)
  const requestsQ = useChangeRequests(staff.id, true)
  const auditQ = useProfileAuditFor(staff.id)
  const reviewProfile = useReviewProfile()
  const saveContract = useSaveContract()
  const issueContract = useIssueContract()
  const reviewChange = useReviewChangeRequest()
  const issueId = useIssueStaffId()

  const [showReturn, setShowReturn] = useState(false)
  const [returnNote, setReturnNote] = useState('')
  const [editContract, setEditContract] = useState(null) // { id?, body }
  const [showIdModal, setShowIdModal] = useState(false)
  const [idExpiry, setIdExpiry] = useState('')
  const [showAudit, setShowAudit] = useState(false)

  const profile = profileQ.data === false ? null : profileQ.data
  const migrationMissing = profileQ.data === null && !profileQ.isLoading
  const contracts = contractsQ.data || []
  const current = contracts.find(c => c.status !== 'superseded')
  const stage = employmentStage(profile, contracts)
  const missing = missingContractFields(profile, staff)
  const completion = profileCompletion(profile, staff)
  const businessName = businesses?.find(b => b.id === staff.business_id)?.name || businesses?.[0]?.name

  const supervisorQ = useQuery({
    queryKey: ['supervisor_name', staff.supervisor_id],
    enabled: !!staff.supervisor_id,
    queryFn: async () => {
      const { data } = await supabase.from('staff_users').select('name').eq('id', staff.supervisor_id).limit(1)
      return data?.[0]?.name || null
    },
  })

  if (migrationMissing) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800">
        <p className="font-semibold mb-1">Staff Profile tables not found</p>
        <p>Run the Staff Profile section of <span className="font-mono text-xs">supabase/migrations.sql</span> to enable onboarding and contracts.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Pipeline stage */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-gray-900">Onboarding Stage</p>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${stage.color}`}>
            {stage.label.toUpperCase()}
          </span>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mt-2">
          <div className="h-full bg-yellow-400 rounded-full" style={{ width: `${completion}%` }} />
        </div>
        <p className="text-[11px] text-gray-400 mt-1">Profile completion: {completion}%</p>
      </div>

      {/* Pending change requests */}
      {(requestsQ.data || []).length > 0 && (
        <div className="bg-white rounded-2xl border border-amber-200 p-4">
          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2">Change Requests Pending</p>
          <div className="space-y-2">
            {requestsQ.data.map(r => (
              <div key={r.id} className="bg-amber-50 rounded-xl p-3">
                <p className="text-xs font-semibold text-gray-800">{r.field.replace(/_/g, ' ')}</p>
                <p className="text-[11px] text-gray-600 mt-0.5">"{r.current_value || '—'}" → "{r.new_value}"</p>
                {r.reason && <p className="text-[11px] text-gray-500">Reason: {r.reason}</p>}
                {r.document_url && (
                  <a href={r.document_url} target="_blank" rel="noreferrer" className="text-[11px] text-blue-600 font-medium">Supporting document</a>
                )}
                <div className="flex gap-2 mt-2">
                  <Button size="sm" className="flex-1" loading={reviewChange.isPending}
                    onClick={() => reviewChange.mutate({ request: r, approve: true })}>
                    <span className="flex items-center justify-center gap-1"><Check size={13} /> Approve</span>
                  </Button>
                  <Button size="sm" variant="danger" className="flex-1" loading={reviewChange.isPending}
                    onClick={() => {
                      const note = window.prompt('Reason for rejection (optional)') ?? undefined
                      reviewChange.mutate({ request: r, approve: false, note })
                    }}>
                    <span className="flex items-center justify-center gap-1"><X size={13} /> Reject</span>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Personal profile review */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Personal Information (staff-completed)</p>
        {!profile ? (
          <p className="text-xs text-gray-400">
            {staff.name.split(' ')[0]} hasn't started their profile yet. They complete it under Settings → My Profile.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              {PERSONAL_FIELDS.map(([key, label, src]) => {
                const v = src === 'staff' ? staff[key] : profile[key]
                const isLink = /url$/.test(key) && v
                return (
                  <div key={key}>
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</p>
                    {isLink ? (
                      <a href={v} target="_blank" rel="noreferrer" className="text-xs font-semibold text-blue-600">Open link</a>
                    ) : (
                      <p className="text-xs font-semibold text-gray-800 break-words">{v || '—'}</p>
                    )}
                  </div>
                )
              })}
            </div>
            {profile.status === 'submitted' && (
              <div className="flex gap-2 mt-3">
                <Button size="sm" className="flex-1" loading={reviewProfile.isPending}
                  onClick={() => reviewProfile.mutate({ staffId: staff.id, approve: true })}>
                  Verify Profile
                </Button>
                <Button size="sm" variant="danger" className="flex-1"
                  onClick={() => { setReturnNote(''); setShowReturn(true) }}>
                  Return for Correction
                </Button>
              </div>
            )}
            {profile.status === 'verified' && (
              <p className="text-[11px] text-green-600 mt-2">
                Verified by {profile.verified_by} · {formatDateTime(profile.verified_at)} — sensitive fields are now locked for the staff member.
              </p>
            )}
            {profile.status === 'returned' && (
              <p className="text-[11px] text-red-600 mt-2">Returned for correction: {profile.return_note}</p>
            )}
          </>
        )}
      </div>

      {/* Contract */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Employment Contract</p>

        {missing.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
            <p className="text-xs font-semibold text-amber-800 mb-0.5">Missing before contract:</p>
            <p className="text-xs text-amber-800">{missing.join(', ')}</p>
          </div>
        )}
        {!staff.salary && (
          <p className="text-[11px] text-amber-600">Tip: set the salary and terms on the Employment tab first — they feed the contract.</p>
        )}

        {contracts.filter(c => c.status !== 'superseded').map(c => (
          <div key={c.id} className="bg-gray-50 rounded-xl p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-gray-900">Contract v{c.version}</p>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                c.status === 'accepted' ? 'bg-green-50 text-green-700'
                : c.status === 'issued' ? 'bg-blue-50 text-blue-700'
                : 'bg-purple-50 text-purple-700'
              }`}>{c.status.toUpperCase()}</span>
            </div>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {c.issued_at ? `Issued ${formatDateTime(c.issued_at)} by ${c.issued_by}` : 'Draft — not yet issued'}
              {c.accepted_at ? ` · accepted by ${c.accepted_name} ${formatDateTime(c.accepted_at)}` : ''}
            </p>
            <div className="flex gap-2 mt-2 flex-wrap">
              {c.status === 'draft' && (
                <>
                  <Button size="sm" variant="secondary" onClick={() => setEditContract({ id: c.id, body: c.body })}>
                    Preview / Edit
                  </Button>
                  <Button size="sm" loading={issueContract.isPending}
                    onClick={() => {
                      if (window.confirm('Issue this contract to the staff member? They will see it in My Employment Documents.')) {
                        issueContract.mutate({ contract: c })
                      }
                    }}>
                    Issue to Staff
                  </Button>
                </>
              )}
              <Button size="sm" variant="secondary"
                onClick={() => savePdf(generateContractPdf(c, staff, businessName), `contract-${staff.staff_code}-v${c.version}.pdf`)}>
                <span className="flex items-center gap-1"><Download size={13} /> PDF</span>
              </Button>
            </div>
          </div>
        ))}

        <Button variant={current ? 'secondary' : 'primary'} className="w-full"
          onClick={() => {
            if (missing.length > 0 &&
                !window.confirm(`Missing: ${missing.join(', ')}.\n\nGenerate the contract anyway (CEO override)?`)) return
            setEditContract({
              id: null,
              body: buildContractBody(staff, profile, businessName, supervisorQ.data),
            })
          }}>
          {current ? 'Generate New Version (replaces current)' : 'Generate Contract'}
        </Button>
      </div>

      {/* Digital staff ID */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CreditCard size={16} className="text-gray-500" />
            <div>
              <p className="text-sm font-semibold text-gray-900">Digital Staff ID</p>
              <p className="text-[11px] text-gray-400">
                {staff.id_card_issued_at
                  ? `Issued ${staff.id_card_issued_at}${staff.id_card_expiry ? ` · expires ${staff.id_card_expiry}` : ''}`
                  : 'Not issued yet'}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            {staff.id_card_issued_at && (
              <Button size="sm" variant="secondary"
                onClick={() => savePdf(generateStaffIdPdf(staff, profile, businessName), `staff-id-${staff.staff_code}.pdf`)}>
                <Download size={14} />
              </Button>
            )}
            <Button size="sm" onClick={() => { setIdExpiry(''); setShowIdModal(true) }}>
              {staff.id_card_issued_at ? 'Reissue' : 'Issue ID'}
            </Button>
          </div>
        </div>
      </div>

      {/* Audit history */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <button onClick={() => setShowAudit(v => !v)} className="w-full flex items-center justify-between">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">History</p>
          <FileText size={14} className="text-gray-400" />
        </button>
        {showAudit && (
          <div className="mt-2 space-y-2 max-h-72 overflow-y-auto">
            {(auditQ.data || []).length === 0 ? (
              <p className="text-xs text-gray-400">No history yet</p>
            ) : auditQ.data.map(a => (
              <div key={a.id}>
                <p className="text-xs text-gray-700">
                  <span className="font-semibold capitalize">{(a.action || '').replace(/_/g, ' ')}</span>
                  {a.details ? ` — ${a.details}` : ''}
                </p>
                <p className="text-[10px] text-gray-400">{[a.actor_name, formatDateTime(a.created_at)].filter(Boolean).join(' · ')}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Return-for-correction modal */}
      <Modal isOpen={showReturn} onClose={() => setShowReturn(false)} title="Return Profile for Correction"
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setShowReturn(false)}>Cancel</Button>
            <Button variant="danger" className="flex-1" disabled={!returnNote.trim()} loading={reviewProfile.isPending}
              onClick={async () => {
                await reviewProfile.mutateAsync({ staffId: staff.id, approve: false, note: returnNote.trim() })
                setShowReturn(false)
              }}>
              Return to Staff
            </Button>
          </div>
        }>
        <Textarea label="What should be corrected?" required rows={3}
          placeholder="e.g. Please update your residential address and upload a clearer identification document."
          value={returnNote} onChange={e => setReturnNote(e.target.value)} />
        <p className="text-[11px] text-gray-400 mt-2">
          The staff member sees this note at the top of their My Profile page.
        </p>
      </Modal>

      {/* Contract preview / edit */}
      <Modal isOpen={!!editContract} onClose={() => setEditContract(null)}
        title={editContract?.id ? 'Edit Contract Draft' : 'New Contract — Preview & Edit'}
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setEditContract(null)}>Cancel</Button>
            <Button className="flex-1" loading={saveContract.isPending}
              onClick={async () => {
                await saveContract.mutateAsync({ staffId: staff.id, contractId: editContract.id, body: editContract.body })
                setEditContract(null)
              }}>
              Save as Draft
            </Button>
          </div>
        }>
        <p className="text-[11px] text-gray-400 mb-2">
          Generated from the staff member's profile and the official employment terms. Edit the wording freely before issuing.
        </p>
        <Textarea rows={16} value={editContract?.body || ''}
          onChange={e => setEditContract({ ...editContract, body: e.target.value })} />
      </Modal>

      {/* Issue ID modal */}
      <Modal isOpen={showIdModal} onClose={() => setShowIdModal(false)} title="Issue Digital Staff ID"
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setShowIdModal(false)}>Cancel</Button>
            <Button className="flex-1" loading={issueId.isPending}
              onClick={async () => {
                await issueId.mutateAsync({ staffId: staff.id, expiry: idExpiry || null })
                setShowIdModal(false)
              }}>
              Issue ID
            </Button>
          </div>
        }>
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            The ID combines {staff.name.split(' ')[0]}'s profile (name, photo) with the official employment
            details (staff code, job title, department, work location, status). Issue date is today.
          </p>
          <Input label="Expiry Date (optional)" type="date" value={idExpiry} onChange={e => setIdExpiry(e.target.value)} />
        </div>
      </Modal>
    </div>
  )
}
