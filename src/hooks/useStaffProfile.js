import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/authStore'
import { useAppStore } from '../stores/appStore'

// ═══════════════════════════════════════════════════════════════════
// Staff Profile & Employment Contract pipeline.
// Personal info lives in staff_profiles (staff-owned);
// official terms live on staff_users (CEO-owned);
// contracts merge both. Every step writes an audit row.
// ═══════════════════════════════════════════════════════════════════

// Personal fields counted for completion (name/phone live on staff_users)
export const PERSONAL_FIELDS = [
  ['name', 'Full Name', 'staff'],
  ['phone', 'Phone Number', 'staff'],
  ['dob', 'Date of Birth'],
  ['gender', 'Gender'],
  ['personal_email', 'Personal Email'],
  ['residential_address', 'Residential Address'],
  ['state_of_residence', 'State of Residence'],
  ['photo_url', 'Passport Photograph'],
  ['emergency_name', 'Emergency Contact Name'],
  ['emergency_phone', 'Emergency Contact Phone'],
  ['emergency_relationship', 'Emergency Contact Relationship'],
  ['nok_name', 'Next of Kin Name'],
  ['nok_phone', 'Next of Kin Phone'],
  ['nok_relationship', 'Next of Kin Relationship'],
  ['bank_name', 'Bank Name'],
  ['bank_account_name', 'Account Name'],
  ['bank_account_number', 'Account Number'],
  ['id_type', 'Identification Type'],
  ['id_number', 'Identification Number'],
  ['id_document_url', 'Identification Document'],
  ['marital_status', 'Marital Status'],
  ['education', 'Educational Qualification'],
  ['work_experience', 'Work Experience'],
]

// Locked after verification — changes go through a change request
export const SENSITIVE_FIELDS = ['name', 'dob', 'bank_name', 'bank_account_name', 'bank_account_number', 'id_type', 'id_number']

// Must be present before a contract can be generated (CEO can override)
export const CONTRACT_REQUIRED = [
  ['name', 'Full Name'], ['residential_address', 'Address'], ['phone', 'Phone Number'],
  ['photo_url', 'Passport Photograph'], ['id_type', 'Identification Type'],
  ['id_number', 'Identification Number'], ['emergency_name', 'Emergency Contact'],
  ['emergency_phone', 'Emergency Contact Phone'],
]

export const ID_TYPES = ['National ID (NIN)', "Driver's Licence", "Voter's Card", 'International Passport', 'Other']

export const PROFILE_DOC_CATEGORIES = [
  { value: 'passport_photo',  label: 'Passport Photograph' },
  { value: 'national_id',     label: 'National ID' },
  { value: 'drivers_licence', label: "Driver's Licence" },
  { value: 'voters_card',     label: "Voter's Card" },
  { value: 'intl_passport',   label: 'International Passport' },
  { value: 'certificate',     label: 'Certificate' },
  { value: 'guarantor_form',  label: 'Guarantor Form' },
  { value: 'other',           label: 'Other Document' },
]

const fieldValue = (key, source, profile, staff) =>
  source === 'staff' ? staff?.[key] : profile?.[key]

export function profileCompletion(profile, staff) {
  const filled = PERSONAL_FIELDS.filter(([key, , src]) => {
    const v = fieldValue(key, src, profile, staff)
    return v !== null && v !== undefined && String(v).trim() !== ''
  }).length
  return Math.round((filled / PERSONAL_FIELDS.length) * 100)
}

export function missingContractFields(profile, staff) {
  return CONTRACT_REQUIRED
    .filter(([key]) => {
      const src = ['name', 'phone'].includes(key) ? 'staff' : 'profile'
      const v = fieldValue(key, src, profile, staff)
      return !v || String(v).trim() === ''
    })
    .map(([, label]) => label)
}

// Pipeline stage derived from profile + contracts — nothing extra stored
export function employmentStage(profile, contracts) {
  const current = (contracts || []).find(c => c.status !== 'superseded')
  if (current?.status === 'accepted') return { key: 'contract_accepted', label: 'Contract Accepted', color: 'bg-green-50 text-green-700' }
  if (current?.status === 'issued')   return { key: 'contract_issued', label: 'Contract Issued', color: 'bg-blue-50 text-blue-700' }
  if (current?.status === 'draft')    return { key: 'contract_drafted', label: 'Contract Drafted', color: 'bg-purple-50 text-purple-700' }
  if (profile?.status === 'verified') return { key: 'ready', label: 'Ready for Contract', color: 'bg-green-50 text-green-700' }
  if (profile?.status === 'submitted') return { key: 'submitted', label: 'Profile Submitted', color: 'bg-amber-50 text-amber-700' }
  if (profile?.status === 'returned') return { key: 'returned', label: 'Returned for Correction', color: 'bg-red-50 text-red-700' }
  if (profile)                        return { key: 'incomplete', label: 'Profile Incomplete', color: 'bg-gray-100 text-gray-600' }
  return { key: 'not_started', label: 'Profile Not Started', color: 'bg-gray-100 text-gray-500' }
}

export async function profileAudit(staff_id, action, details, actor) {
  try {
    await supabase.from('staff_profile_audit').insert({
      staff_id, action, details: details || null,
      actor_id: actor?.id || null, actor_name: actor?.name || null,
    })
  } catch { /* audit table may predate migration */ }
}

// ─── Queries ─────────────────────────────────────────────────────────────────

// null = table missing (migration not run)
export function useStaffProfileFor(staffId) {
  return useQuery({
    queryKey: ['staff_profile', staffId],
    enabled: !!staffId,
    retry: false,
    queryFn: async () => {
      try {
        const { data, error } = await supabase.from('staff_profiles')
          .select('*').eq('staff_id', staffId).limit(1)
        if (error) throw error
        return data?.[0] || false   // false = no profile row yet
      } catch { return null }
    },
    staleTime: 15000,
  })
}

export function useStaffContracts(staffId) {
  return useQuery({
    queryKey: ['staff_contracts', staffId],
    enabled: !!staffId,
    retry: false,
    queryFn: async () => {
      try {
        const { data, error } = await supabase.from('staff_contracts')
          .select('*').eq('staff_id', staffId)
          .order('version', { ascending: false })
        if (error) throw error
        return data || []
      } catch { return null }
    },
    staleTime: 15000,
  })
}

export function useChangeRequests(staffId, onlyPending = false) {
  return useQuery({
    queryKey: ['staff_change_requests', staffId, onlyPending],
    enabled: !!staffId,
    retry: false,
    queryFn: async () => {
      try {
        let q = supabase.from('staff_change_requests')
          .select('*').eq('staff_id', staffId)
          .order('created_at', { ascending: false })
        if (onlyPending) q = q.eq('status', 'pending')
        const { data, error } = await q
        if (error) throw error
        return data || []
      } catch { return [] }
    },
    staleTime: 15000,
  })
}

export function useProfileAuditFor(staffId) {
  return useQuery({
    queryKey: ['staff_profile_audit', staffId],
    enabled: !!staffId,
    retry: false,
    queryFn: async () => {
      try {
        const { data } = await supabase.from('staff_profile_audit')
          .select('*').eq('staff_id', staffId)
          .order('created_at', { ascending: false }).limit(50)
        return data || []
      } catch { return [] }
    },
    staleTime: 15000,
  })
}

// ─── Mutations ───────────────────────────────────────────────────────────────

function useProfileMutation(fn, successMsg) {
  const queryClient = useQueryClient()
  const { showToast } = useAppStore()
  const { user } = useAuthStore()
  return useMutation({
    mutationFn: (args) => fn(args, user),
    onSuccess: () => {
      ;['staff_profile', 'staff_contracts', 'staff_change_requests', 'staff_profile_audit', 'staff', 'staff_member']
        .forEach(k => queryClient.invalidateQueries({ queryKey: [k] }))
      if (successMsg) showToast(successMsg, 'success')
    },
    onError: (err) => showToast(err.message, 'error'),
  })
}

// Staff saving their own personal profile (draft or corrections)
export function useSaveMyProfile() {
  return useProfileMutation(async ({ staffId, fields, staffFields }, user) => {
    // name/phone live on staff_users
    if (staffFields && Object.keys(staffFields).length > 0) {
      await supabase.from('staff_users')
        .update({ ...staffFields, updated_at: new Date().toISOString() }).eq('id', staffId)
    }
    const { data: existing, error: exErr } = await supabase.from('staff_profiles')
      .select('id, status').eq('staff_id', staffId).limit(1)
    if (exErr) throw new Error('Run the Staff Profile migration first')
    const payload = { ...fields, updated_at: new Date().toISOString() }
    // A returned profile goes back to draft when corrections start
    if (existing?.[0]?.status === 'returned') payload.status = 'draft'
    if (existing?.[0]) {
      const { error } = await supabase.from('staff_profiles').update(payload).eq('id', existing[0].id)
      if (error) throw error
    } else {
      const { error } = await supabase.from('staff_profiles')
        .insert({ staff_id: staffId, ...payload, status: 'draft' })
      if (error) throw error
      await profileAudit(staffId, 'profile_created', 'Profile started', user)
    }
    await profileAudit(staffId, 'profile_saved', 'Personal information updated', user)
  }, 'Profile saved')
}

export function useSubmitProfile() {
  return useProfileMutation(async ({ staffId }, user) => {
    const { error } = await supabase.from('staff_profiles')
      .update({ status: 'submitted', submitted_at: new Date().toISOString(), return_note: null, updated_at: new Date().toISOString() })
      .eq('staff_id', staffId)
    if (error) throw error
    await profileAudit(staffId, 'profile_submitted', 'Profile submitted for review', user)
  }, 'Profile submitted for review')
}

export function useReviewProfile() {
  return useProfileMutation(async ({ staffId, approve, note }, user) => {
    const payload = approve
      ? { status: 'verified', verified_by: user?.name || null, verified_at: new Date().toISOString(), return_note: null }
      : { status: 'returned', return_note: note || null }
    const { error } = await supabase.from('staff_profiles')
      .update({ ...payload, updated_at: new Date().toISOString() }).eq('staff_id', staffId)
    if (error) throw error
    await profileAudit(staffId, approve ? 'profile_verified' : 'profile_returned',
      approve ? `Verified by ${user?.name}` : `Returned: ${note || 'no note'}`, user)
  })
}

// CEO saving official employment terms on staff_users
export function useSaveEmployment() {
  return useProfileMutation(async ({ staffId, fields }, user) => {
    const { error } = await supabase.from('staff_users')
      .update({ ...fields, updated_at: new Date().toISOString() }).eq('id', staffId)
    if (error) throw new Error(/column/i.test(error.message || '') ? 'Run the Staff Profile migration first' : error.message)
    await profileAudit(staffId, 'employment_updated', 'Official employment terms updated', user)
  }, 'Employment details saved')
}

export function useSubmitChangeRequest() {
  return useProfileMutation(async ({ staffId, field, current_value, new_value, reason, document_url }, user) => {
    const { error } = await supabase.from('staff_change_requests').insert({
      staff_id: staffId, field, current_value: current_value || null,
      new_value, reason: reason || null, document_url: document_url || null,
    })
    if (error) throw new Error('Run the Staff Profile migration first')
    await profileAudit(staffId, 'change_requested', `${field}: "${current_value || '—'}" → "${new_value}"`, user)
  }, 'Change request submitted for approval')
}

export function useReviewChangeRequest() {
  return useProfileMutation(async ({ request, approve, note }, user) => {
    const { error } = await supabase.from('staff_change_requests').update({
      status: approve ? 'approved' : 'rejected',
      reviewed_by: user?.name || null,
      reviewed_at: new Date().toISOString(),
      review_note: note || null,
    }).eq('id', request.id)
    if (error) throw error
    if (approve) {
      // Apply the change to the right table
      if (request.field === 'name' || request.field === 'phone') {
        await supabase.from('staff_users').update({ [request.field]: request.new_value }).eq('id', request.staff_id)
      } else {
        await supabase.from('staff_profiles').update({ [request.field]: request.new_value }).eq('staff_id', request.staff_id)
      }
    }
    await profileAudit(request.staff_id, approve ? 'change_approved' : 'change_rejected',
      `${request.field} → "${request.new_value}"${note ? ` (${note})` : ''}`, user)
  })
}

// ─── Contracts ───────────────────────────────────────────────────────────────

export function buildContractBody(staff, profile, businessName, supervisorName) {
  const money = (n) => n ? `NGN ${Number(n).toLocaleString('en-NG')}` : '—'
  const line = (label, v) => `${label}: ${v || '—'}`
  return [
    `EMPLOYMENT CONTRACT`,
    ``,
    `This Employment Contract is made on ${staff?.contract_date || new Date().toISOString().split('T')[0]} between:`,
    ``,
    `EMPLOYER: ${businessName || 'The Company'}`,
    `and`,
    `EMPLOYEE: ${staff?.name || ''} (${staff?.staff_code || ''})`,
    `Address: ${profile?.residential_address || '—'}`,
    ``,
    `1. POSITION & PLACEMENT`,
    line('Job Title', staff?.position),
    line('Department', staff?.department),
    line('Work Location', staff?.work_location),
    line('Supervisor', supervisorName),
    line('Employment Type', (staff?.employment_type || '').replace(/_/g, ' ')),
    line('Start Date', staff?.date_joined),
    ``,
    `2. REMUNERATION`,
    line('Salary', money(staff?.salary)),
    ``,
    `3. WORKING TIME`,
    line('Working Days', staff?.working_days),
    line('Working Hours', staff?.working_hours),
    ``,
    `4. PROBATION`,
    line('Probation Period', staff?.probation_period),
    ``,
    `5. LEAVE`,
    line('Leave Entitlement', staff?.leave_entitlement),
    ``,
    `6. SPECIAL CONDITIONS`,
    staff?.special_conditions || 'None.',
    ``,
    `7. GENERAL`,
    `The Employee agrees to perform their duties faithfully and to follow the company's policies and procedures. Either party may terminate this contract in line with company policy and applicable law.`,
    ``,
    `Signed for the Employer: ______________________`,
    ``,
    `Signed by the Employee: ______________________`,
  ].join('\n')
}

export function useSaveContract() {
  return useProfileMutation(async ({ staffId, contractId, body }, user) => {
    if (contractId) {
      const { error } = await supabase.from('staff_contracts')
        .update({ body }).eq('id', contractId).eq('status', 'draft')
      if (error) throw error
      await profileAudit(staffId, 'contract_updated', 'Draft contract wording edited', user)
    } else {
      const { data: existing } = await supabase.from('staff_contracts')
        .select('version').eq('staff_id', staffId).order('version', { ascending: false }).limit(1)
      const version = (existing?.[0]?.version || 0) + 1
      // A new version supersedes whatever came before
      await supabase.from('staff_contracts')
        .update({ status: 'superseded' }).eq('staff_id', staffId).neq('status', 'superseded')
      const { error } = await supabase.from('staff_contracts')
        .insert({ staff_id: staffId, version, body, status: 'draft' })
      if (error) throw new Error('Run the Staff Profile migration first')
      await profileAudit(staffId, 'contract_generated', `Contract v${version} generated`, user)
    }
  }, 'Contract draft saved')
}

export function useIssueContract() {
  return useProfileMutation(async ({ contract }, user) => {
    const { error } = await supabase.from('staff_contracts').update({
      status: 'issued', issued_by: user?.name || null, issued_at: new Date().toISOString(),
    }).eq('id', contract.id)
    if (error) throw error
    await profileAudit(contract.staff_id, 'contract_issued', `Contract v${contract.version} issued by ${user?.name}`, user)
  }, 'Contract issued to staff')
}

export function useAcknowledgeContract() {
  return useProfileMutation(async ({ contract }, user) => {
    await supabase.from('staff_contracts')
      .update({ acknowledged_at: new Date().toISOString() })
      .eq('id', contract.id).is('acknowledged_at', null)
    await profileAudit(contract.staff_id, 'contract_acknowledged', `Receipt acknowledged by ${user?.name}`, user)
  }, 'Receipt acknowledged')
}

export function useAcceptContract() {
  return useProfileMutation(async ({ contract, signedName }, user) => {
    const { error } = await supabase.from('staff_contracts').update({
      status: 'accepted',
      accepted_at: new Date().toISOString(),
      accepted_name: signedName || user?.name || null,
      acknowledged_at: contract.acknowledged_at || new Date().toISOString(),
    }).eq('id', contract.id)
    if (error) throw error
    await profileAudit(contract.staff_id, 'contract_accepted', `Accepted and signed by ${signedName || user?.name}`, user)
  }, 'Contract accepted')
}

// CEO issues / renews the digital staff ID
export function useIssueStaffId() {
  return useProfileMutation(async ({ staffId, expiry }, user) => {
    const { error } = await supabase.from('staff_users').update({
      id_card_issued_at: new Date().toISOString().split('T')[0],
      id_card_expiry: expiry || null,
      updated_at: new Date().toISOString(),
    }).eq('id', staffId)
    if (error) throw new Error('Run the Staff Profile migration first')
    await profileAudit(staffId, 'id_card_issued', `Digital staff ID issued by ${user?.name}`, user)
  }, 'Digital staff ID issued')
}
