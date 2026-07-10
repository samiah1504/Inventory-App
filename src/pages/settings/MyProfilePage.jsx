import { useState, useEffect } from 'react'
import { UserCircle, Lock, FileText, Download, CreditCard } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { TopBar } from '../../components/layout/TopBar'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { Input, Select, Textarea } from '../../components/ui/Input'
import { useAuthStore } from '../../stores/authStore'
import { useAppStore } from '../../stores/appStore'
import { formatDateTime, NIGERIAN_STATES } from '../../utils/format'
import { generateContractPdf, generateStaffIdPdf } from '../../lib/staffPdf'
import { savePdf } from '../../lib/pdf'
import {
  useStaffProfileFor, useSaveMyProfile, useSubmitProfile,
  useStaffContracts, useAcknowledgeContract, useAcceptContract,
  useChangeRequests, useSubmitChangeRequest,
  profileCompletion, SENSITIVE_FIELDS, ID_TYPES, PROFILE_DOC_CATEGORIES, profileAudit,
} from '../../hooks/useStaffProfile'

const GENDERS = ['Female', 'Male']
const MARITAL = ['Single', 'Married', 'Divorced', 'Widowed']

const SENSITIVE_LABELS = {
  name: 'Full Name', dob: 'Date of Birth', bank_name: 'Bank Name',
  bank_account_name: 'Account Name', bank_account_number: 'Account Number',
  id_type: 'Identification Type', id_number: 'Identification Number',
}

export function MyProfilePage() {
  const { user } = useAuthStore()
  const { showToast } = useAppStore()

  const profileQ = useStaffProfileFor(user?.id)
  const contractsQ = useStaffContracts(user?.id)
  const requestsQ = useChangeRequests(user?.id)
  const saveProfile = useSaveMyProfile()
  const submitProfile = useSubmitProfile()
  const acknowledge = useAcknowledgeContract()
  const accept = useAcceptContract()
  const submitChange = useSubmitChangeRequest()

  // Fresh staff row (store copy may be stale)
  const meQ = useQuery({
    queryKey: ['staff_member', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase.from('staff_users').select('*').eq('id', user.id).limit(1)
      return data?.[0] || user
    },
    staleTime: 15000,
  })
  const me = meQ.data || user

  const profile = profileQ.data === false ? null : profileQ.data
  const migrationMissing = profileQ.data === null && !profileQ.isLoading
  const verified = ['verified'].includes(profile?.status)
  const locked = (key) => verified && SENSITIVE_FIELDS.includes(key)

  const [form, setForm] = useState({})
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [viewContract, setViewContract] = useState(null)
  const [signName, setSignName] = useState('')
  const [changeField, setChangeField] = useState(null)
  const [changeForm, setChangeForm] = useState({ new_value: '', reason: '', document_url: '' })
  const [docForm, setDocForm] = useState({ category: 'passport_photo', title: '', file_url: '' })
  const [showDocModal, setShowDocModal] = useState(false)

  useEffect(() => {
    if (loaded || profileQ.isLoading || meQ.isLoading) return
    const p = profile || {}
    setForm({
      dob: p.dob || '', gender: p.gender || '', personal_email: p.personal_email || '',
      residential_address: p.residential_address || '', state_of_residence: p.state_of_residence || '',
      photo_url: p.photo_url || '',
      emergency_name: p.emergency_name || '', emergency_phone: p.emergency_phone || '',
      emergency_relationship: p.emergency_relationship || '',
      nok_name: p.nok_name || '', nok_phone: p.nok_phone || '', nok_relationship: p.nok_relationship || '',
      bank_name: p.bank_name || '', bank_account_name: p.bank_account_name || '',
      bank_account_number: p.bank_account_number || '',
      id_type: p.id_type || '', id_number: p.id_number || '', id_document_url: p.id_document_url || '',
      marital_status: p.marital_status || '', education: p.education || '', work_experience: p.work_experience || '',
    })
    setName(me?.name || '')
    setPhone(me?.phone || '')
    setLoaded(true)
  }, [profileQ.isLoading, meQ.isLoading, profile, me, loaded])

  // My uploaded documents (link-based, stored in staff_documents)
  const docsQ = useQuery({
    queryKey: ['staff_documents', user?.id, 'mine'],
    enabled: !!user?.id,
    queryFn: async () => {
      try {
        const { data } = await supabase.from('staff_documents')
          .select('*').eq('staff_id', user.id).order('created_at', { ascending: false })
        return data || []
      } catch { return [] }
    },
    staleTime: 15000,
  })

  const completion = profileCompletion(
    { ...profile, ...form },
    { ...me, name, phone })

  const contracts = (contractsQ.data || []).filter(c => c.status !== 'superseded' && c.status !== 'draft')
  const canEdit = !profile || ['draft', 'returned', 'submitted'].includes(profile?.status) || verified

  async function handleSave() {
    const staffFields = {}
    if (!locked('name') && name.trim() && name !== me?.name) staffFields.name = name.trim()
    if (phone !== me?.phone) staffFields.phone = phone
    const fields = { ...form }
    // Locked fields never leave the form silently
    for (const k of SENSITIVE_FIELDS) {
      if (locked(k) && k in fields) delete fields[k]
    }
    await saveProfile.mutateAsync({ staffId: user.id, fields, staffFields })
  }

  async function addDocument() {
    if (!docForm.file_url.trim()) { showToast('Paste the document link', 'error'); return }
    try {
      await supabase.from('staff_documents').insert({
        staff_id: user.id,
        category: docForm.category,
        title: docForm.title || PROFILE_DOC_CATEGORIES.find(c => c.value === docForm.category)?.label,
        file_url: docForm.file_url.trim(),
        uploaded_by: user.id,
        uploaded_by_name: user.name,
      })
      await profileAudit(user.id, 'document_uploaded', docForm.title || docForm.category, user)
      docsQ.refetch()
      setShowDocModal(false)
      setDocForm({ category: 'passport_photo', title: '', file_url: '' })
      showToast('Document added', 'success')
    } catch (e) { showToast(e.message, 'error') }
  }

  const inputProps = (key) => ({
    value: form[key] ?? '',
    onChange: (e) => setForm({ ...form, [key]: e.target.value }),
    disabled: locked(key),
  })

  const lockNote = (key) => locked(key) && (
    <button onClick={() => { setChangeField(key); setChangeForm({ new_value: '', reason: '', document_url: '' }) }}
      className="text-[11px] text-blue-600 font-medium flex items-center gap-1 -mt-2">
      <Lock size={10} /> Locked after verification — request a change
    </button>
  )

  if (migrationMissing) {
    return (
      <div className="flex flex-col h-full overflow-x-hidden w-full">
        <TopBar title="My Profile" />
        <div className="px-4 py-4">
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800">
            <p className="font-semibold mb-1">Profile module not set up yet</p>
            <p>Ask the CEO to run the Staff Profile section of <span className="font-mono text-xs">supabase/migrations.sql</span>.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-x-hidden w-full">
      <TopBar title="My Profile" />
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-4 pb-10">

        {/* Status + completion */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <UserCircle size={18} className="text-gray-500" />
              <p className="text-sm font-semibold text-gray-900">Profile Completion: {completion}%</p>
            </div>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
              verified ? 'bg-green-50 text-green-700'
              : profile?.status === 'submitted' ? 'bg-amber-50 text-amber-700'
              : profile?.status === 'returned' ? 'bg-red-50 text-red-700'
              : 'bg-gray-100 text-gray-500'
            }`}>
              {(profile?.status || 'not started').replace(/_/g, ' ').toUpperCase()}
            </span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${completion === 100 ? 'bg-green-500' : 'bg-yellow-400'}`}
              style={{ width: `${completion}%` }} />
          </div>
          {profile?.status === 'returned' && profile?.return_note && (
            <div className="mt-3 bg-red-50 border border-red-200 rounded-xl p-3">
              <p className="text-xs font-semibold text-red-800 mb-0.5">Your profile has been returned for correction:</p>
              <p className="text-xs text-red-800">{profile.return_note}</p>
            </div>
          )}
          {verified && (
            <p className="text-[11px] text-gray-400 mt-2">
              Verified by {profile.verified_by} — sensitive fields are locked; use change requests to update them.
            </p>
          )}
        </div>

        {/* Personal details */}
        {canEdit && (
          <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Personal Information</p>
            <Input label="Full Name" value={name} disabled={locked('name')} onChange={e => setName(e.target.value)} />
            {lockNote('name')}
            <div className="grid grid-cols-2 gap-3">
              <Input label="Date of Birth" type="date" {...inputProps('dob')} />
              <Select label="Gender" {...inputProps('gender')}>
                <option value="">Select...</option>
                {GENDERS.map(g => <option key={g} value={g}>{g}</option>)}
              </Select>
            </div>
            {lockNote('dob')}
            <div className="grid grid-cols-2 gap-3">
              <Input label="Phone Number" type="tel" value={phone} onChange={e => setPhone(e.target.value)} />
              <Input label="Personal Email" type="email" {...inputProps('personal_email')} />
            </div>
            <Textarea label="Residential Address" rows={2} {...inputProps('residential_address')} />
            <div className="grid grid-cols-2 gap-3">
              <Select label="State of Residence" {...inputProps('state_of_residence')}>
                <option value="">Select...</option>
                {NIGERIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </Select>
              <Select label="Marital Status" {...inputProps('marital_status')}>
                <option value="">Select...</option>
                {MARITAL.map(m => <option key={m} value={m}>{m}</option>)}
              </Select>
            </div>
            <Input label="Passport Photograph Link" type="url" placeholder="https:// — link to your photo" {...inputProps('photo_url')} />

            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide pt-2">Emergency Contact</p>
            <Input label="Name" {...inputProps('emergency_name')} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Phone" type="tel" {...inputProps('emergency_phone')} />
              <Input label="Relationship" placeholder="e.g. Sister" {...inputProps('emergency_relationship')} />
            </div>

            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide pt-2">Next of Kin</p>
            <Input label="Name" {...inputProps('nok_name')} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Phone" type="tel" {...inputProps('nok_phone')} />
              <Input label="Relationship" {...inputProps('nok_relationship')} />
            </div>

            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide pt-2">Bank Details</p>
            <Input label="Bank Name" {...inputProps('bank_name')} />
            {lockNote('bank_name')}
            <div className="grid grid-cols-2 gap-3">
              <Input label="Account Name" {...inputProps('bank_account_name')} />
              <Input label="Account Number" inputMode="numeric" {...inputProps('bank_account_number')} />
            </div>
            {lockNote('bank_account_number')}

            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide pt-2">Identification</p>
            <Select label="Identification Type" {...inputProps('id_type')}>
              <option value="">Select...</option>
              {ID_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </Select>
            <Input label="Identification Number" {...inputProps('id_number')} />
            {lockNote('id_number')}
            <Input label="Identification Document Link" type="url" placeholder="https:// — photo/scan of the ID" {...inputProps('id_document_url')} />

            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide pt-2">Background</p>
            <Textarea label="Educational Qualification" rows={2} {...inputProps('education')} />
            <Textarea label="Relevant Work Experience" rows={2} {...inputProps('work_experience')} />

            <div className="flex gap-2 pt-1">
              <Button variant="secondary" className="flex-1" loading={saveProfile.isPending} onClick={handleSave}>
                Save Draft
              </Button>
              {profile && ['draft', 'returned'].includes(profile.status) && (
                <Button className="flex-1" loading={submitProfile.isPending}
                  onClick={async () => { await handleSave(); await submitProfile.mutateAsync({ staffId: user.id }) }}>
                  Submit for Review
                </Button>
              )}
              {!profile && (
                <Button className="flex-1" loading={saveProfile.isPending || submitProfile.isPending}
                  onClick={async () => { await handleSave(); await submitProfile.mutateAsync({ staffId: user.id }) }}>
                  Save &amp; Submit
                </Button>
              )}
            </div>
            {profile?.status === 'submitted' && (
              <p className="text-[11px] text-amber-600">Submitted — awaiting review. You can still correct details until it is verified.</p>
            )}
          </div>
        )}

        {/* Documents */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">My Documents</p>
            <Button size="sm" variant="secondary" onClick={() => setShowDocModal(true)}>Add Document</Button>
          </div>
          {(docsQ.data || []).length === 0 ? (
            <p className="text-xs text-gray-400">No documents yet — add your passport photo, ID, certificates and guarantor form as links.</p>
          ) : (
            <div className="space-y-2">
              {(docsQ.data || []).map(d => (
                <div key={d.id} className="flex items-center justify-between gap-2 bg-gray-50 rounded-xl px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-gray-800 truncate">{d.title}</p>
                    <p className="text-[10px] text-gray-400 capitalize">{(d.category || '').replace(/_/g, ' ')}</p>
                  </div>
                  {d.file_url && (
                    <a href={d.file_url} target="_blank" rel="noreferrer"
                      className="text-xs text-blue-600 font-medium shrink-0">Open</a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* My Employment Documents */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">My Employment Documents</p>
          {contracts.length === 0 ? (
            <p className="text-xs text-gray-400">Your employment contract will appear here once it is issued.</p>
          ) : contracts.map(c => (
            <div key={c.id} className="bg-gray-50 rounded-xl p-3 mb-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-gray-900">Employment Contract v{c.version}</p>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  c.status === 'accepted' ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-700'
                }`}>
                  {c.status.toUpperCase()}
                </span>
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Issued {c.issued_at ? formatDateTime(c.issued_at) : '—'}
                {c.accepted_at ? ` · accepted ${formatDateTime(c.accepted_at)}` : ''}
              </p>
              <div className="flex gap-2 mt-2">
                <Button size="sm" variant="secondary" className="flex-1"
                  onClick={async () => {
                    setViewContract(c); setSignName(user?.name || '')
                    if (!c.acknowledged_at) acknowledge.mutate({ contract: c })
                  }}>
                  <span className="flex items-center justify-center gap-1.5"><FileText size={13} /> Read</span>
                </Button>
                <Button size="sm" variant="secondary" className="flex-1"
                  onClick={() => savePdf(generateContractPdf(c, me, me?.business_name), `contract-${me?.staff_code || 'me'}-v${c.version}.pdf`)}>
                  <span className="flex items-center justify-center gap-1.5"><Download size={13} /> Download</span>
                </Button>
              </div>
            </div>
          ))}

          {/* Digital staff ID */}
          {me?.id_card_issued_at && (
            <div className="bg-gray-900 rounded-xl p-3 mt-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CreditCard size={16} className="text-yellow-400" />
                  <div>
                    <p className="text-sm font-semibold text-white">Digital Staff ID</p>
                    <p className="text-[11px] text-gray-400">
                      Issued {me.id_card_issued_at}{me.id_card_expiry ? ` · expires ${me.id_card_expiry}` : ''}
                    </p>
                  </div>
                </div>
                <Button size="sm" variant="secondary"
                  onClick={() => savePdf(generateStaffIdPdf(me, profile, me?.business_name), `staff-id-${me?.staff_code || 'me'}.pdf`)}>
                  Download
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* My change requests */}
        {(requestsQ.data || []).length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">My Change Requests</p>
            <div className="space-y-2">
              {requestsQ.data.map(r => (
                <div key={r.id} className="bg-gray-50 rounded-xl p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-gray-800">{SENSITIVE_LABELS[r.field] || r.field}</p>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      r.status === 'approved' ? 'bg-green-50 text-green-700'
                      : r.status === 'rejected' ? 'bg-red-50 text-red-700'
                      : 'bg-amber-50 text-amber-700'
                    }`}>{r.status.toUpperCase()}</span>
                  </div>
                  <p className="text-[11px] text-gray-500 mt-0.5">"{r.current_value || '—'}" → "{r.new_value}"</p>
                  {r.review_note && <p className="text-[11px] text-gray-400">Note: {r.review_note}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Read + accept contract */}
      <Modal isOpen={!!viewContract} onClose={() => setViewContract(null)}
        title={`Employment Contract v${viewContract?.version || ''}`}
        footer={viewContract?.status === 'issued' ? (
          <div className="space-y-2 w-full">
            <Input label="Type your full name to sign" value={signName} onChange={e => setSignName(e.target.value)} />
            <Button className="w-full" loading={accept.isPending} disabled={!signName.trim()}
              onClick={async () => { await accept.mutateAsync({ contract: viewContract, signedName: signName.trim() }); setViewContract(null) }}>
              Accept &amp; Sign Contract
            </Button>
          </div>
        ) : (
          <Button className="w-full" variant="secondary" onClick={() => setViewContract(null)}>Close</Button>
        )}>
        <pre className="text-xs text-gray-800 whitespace-pre-wrap font-sans max-h-[50vh] overflow-y-auto">
          {viewContract?.body}
        </pre>
      </Modal>

      {/* Change request */}
      <Modal isOpen={!!changeField} onClose={() => setChangeField(null)}
        title={`Request Change — ${SENSITIVE_LABELS[changeField] || changeField}`}
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setChangeField(null)}>Cancel</Button>
            <Button className="flex-1" loading={submitChange.isPending}
              disabled={!changeForm.new_value.trim() || !changeForm.reason.trim()}
              onClick={async () => {
                const current = changeField === 'name' ? me?.name : (profile?.[changeField] ?? form[changeField])
                await submitChange.mutateAsync({
                  staffId: user.id, field: changeField,
                  current_value: current ? String(current) : '',
                  new_value: changeForm.new_value.trim(),
                  reason: changeForm.reason.trim(),
                  document_url: changeForm.document_url.trim() || null,
                })
                setChangeField(null)
              }}>
              Submit Request
            </Button>
          </div>
        }>
        <div className="space-y-4">
          <div className="bg-gray-50 rounded-xl p-3">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide">Current Information</p>
            <p className="text-sm font-semibold text-gray-800">
              {String((changeField === 'name' ? me?.name : (profile?.[changeField] ?? form[changeField])) || '—')}
            </p>
          </div>
          <Input label="New Information" required value={changeForm.new_value}
            onChange={e => setChangeForm({ ...changeForm, new_value: e.target.value })} />
          <Textarea label="Reason for Change" required rows={2} value={changeForm.reason}
            onChange={e => setChangeForm({ ...changeForm, reason: e.target.value })} />
          <Input label="Supporting Document Link (optional)" type="url" value={changeForm.document_url}
            onChange={e => setChangeForm({ ...changeForm, document_url: e.target.value })} />
        </div>
      </Modal>

      {/* Add document */}
      <Modal isOpen={showDocModal} onClose={() => setShowDocModal(false)} title="Add Document"
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setShowDocModal(false)}>Cancel</Button>
            <Button className="flex-1" onClick={addDocument} disabled={!docForm.file_url.trim()}>Add</Button>
          </div>
        }>
        <div className="space-y-4">
          <Select label="Document Type" value={docForm.category}
            onChange={e => setDocForm({ ...docForm, category: e.target.value })}>
            {PROFILE_DOC_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
          <Input label="Title (optional)" value={docForm.title}
            onChange={e => setDocForm({ ...docForm, title: e.target.value })} />
          <Input label="Document Link" type="url" required placeholder="https:// — Drive/photo link"
            value={docForm.file_url} onChange={e => setDocForm({ ...docForm, file_url: e.target.value })} />
          <p className="text-[11px] text-gray-400">
            Upload the file to Google Drive or similar and paste the share link here.
          </p>
        </div>
      </Modal>
    </div>
  )
}
