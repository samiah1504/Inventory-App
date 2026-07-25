import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/authStore'
import { useAppStore } from '../stores/appStore'

// Warning & Disciplinary Action module. The legacy staff_warnings feature
// stays untouched — these hooks power the expanded flow: sanctions,
// month-scoped salary deductions (base salary is NEVER edited), employee
// acknowledgement/response, approval workflow and an audit trail.

export const ACTION_TYPES = [
  { value: 'warning_only',          label: 'Warning only' },
  { value: 'warning_with_sanction', label: 'Warning with sanction' },
  { value: 'sanction_only',         label: 'Sanction only' },
]

export const WARNING_CATEGORIES = [
  // Existing categories (unchanged)
  { value: 'verbal',             label: 'Verbal Warning',              group: 'Warning level' },
  { value: 'first_written',      label: 'First Written Warning',       group: 'Warning level' },
  { value: 'final_written',      label: 'Final Written Warning',       group: 'Warning level' },
  { value: 'performance',        label: 'Performance Warning',         group: 'Conduct & performance' },
  { value: 'attendance',         label: 'Attendance Warning',          group: 'Conduct & performance' },
  { value: 'misconduct',         label: 'Misconduct Warning',          group: 'Conduct & performance' },
  { value: 'policy_violation',   label: 'Policy Violation',            group: 'Conduct & performance' },
  { value: 'customer_complaint', label: 'Customer Complaint',          group: 'Conduct & performance' },
  // New categories
  { value: 'negligence',            label: 'Negligence',                       group: 'Work quality' },
  { value: 'inaccurate_info',       label: 'Inaccurate Information',           group: 'Work quality' },
  { value: 'failed_instructions',   label: 'Failure to Follow Instructions',   group: 'Work quality' },
  { value: 'failed_verification',   label: 'Failure to Verify Information',    group: 'Work quality' },
  { value: 'data_entry_error',      label: 'Data Entry Error',                 group: 'Work quality' },
  { value: 'operational_error',     label: 'Operational Error',                group: 'Work quality' },
  { value: 'poor_attention',        label: 'Poor Attention to Detail',         group: 'Work quality' },
  { value: 'repeated_mistakes',     label: 'Repeated Avoidable Mistakes',      group: 'Work quality' },
  { value: 'other',                 label: 'Other',                            group: 'Other' },
  { value: 'custom',                label: 'Custom category (type your own)',  group: 'Other' },
]

export const SANCTION_TYPES = [
  { value: 'percent_deduction', label: 'One-time percentage salary deduction', desc: 'A percentage of one salary month — base salary is not changed' },
  { value: 'fixed_deduction',   label: 'One-time fixed salary deduction',      desc: 'A fixed amount from one salary month' },
  { value: 'suspension_unpaid', label: 'Suspension without pay' },
  { value: 'suspension_paid',   label: 'Suspension with pay' },
  { value: 'loss_bonus',        label: 'Loss of bonus' },
  { value: 'loss_commission',   label: 'Loss of commission' },
  { value: 'loss_allowance',    label: 'Loss of allowance' },
  { value: 'written_caution',   label: 'Written caution only' },
  { value: 'pip',               label: 'Performance improvement plan' },
  { value: 'duty_restriction',  label: 'Temporary restriction from certain duties' },
  { value: 'demotion',          label: 'Demotion' },
  { value: 'other',             label: 'Other custom sanction' },
]

export const DEDUCTION_SANCTIONS = ['percent_deduction', 'fixed_deduction']

export const DURATION_TYPES = [
  { value: 'one_month',     label: 'One salary month only (default)' },
  { value: 'multi_month',   label: 'Multiple salary months' },
  { value: 'until_stopped', label: 'Recurring until manually stopped' },
]

export const DISC_STATUS = {
  draft:            { label: 'Draft',            color: 'gray' },
  pending_approval: { label: 'Pending Approval', color: 'amber' },
  issued:           { label: 'Issued',           color: 'blue' },
  rejected:         { label: 'Rejected',         color: 'red' },
  withdrawn:        { label: 'Withdrawn',        color: 'gray' },
  resolved:         { label: 'Resolved',         color: 'green' },
  escalated:        { label: 'Escalated',        color: 'red' },
}

export const categoryLabel = (a) =>
  a.warning_category === 'custom'
    ? (a.custom_category || 'Custom')
    : (WARNING_CATEGORIES.find(c => c.value === a.warning_category)?.label || a.warning_category || '—')

export const sanctionLabel = (t) => SANCTION_TYPES.find(s => s.value === t)?.label || t || '—'

// What the employee sees as the record's state
export function employeeStatus(a) {
  if (a.status === 'withdrawn') return 'Withdrawn'
  if (a.status === 'resolved')  return 'Resolved'
  if (a.status === 'escalated') return 'Escalated'
  if (a.review_requested)       return 'Under review'
  if (a.employee_acknowledged_at) {
    if (a.review_date && a.review_date >= new Date().toISOString().split('T')[0]) return 'Improvement period active'
    return 'Read'
  }
  if (a.employee_opened_at) return 'Read'
  return 'Unread'
}

export const monthISO = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
export const monthLabel = (ym) => {
  if (!ym) return '—'
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleString('en', { month: 'long', year: 'numeric' })
}
export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return monthISO(d)
}

export function computeDeduction(salary, type, percentage, fixedAmount) {
  const base = Number(salary) || 0
  const amount = type === 'percent'
    ? Math.round(base * (Number(percentage) || 0)) / 100
    : Number(fixedAmount) || 0
  return { base, amount, net: Math.max(0, base - amount) }
}

// Derived payroll state: a scheduled deduction whose last affected month
// has passed is automatically completed — it can never touch another month
export function deductionState(d) {
  if (!d) return null
  if (d.payroll_status === 'reversed') return 'reversed'
  if (d.payroll_status === 'stopped')  return 'stopped'
  if (d.payroll_status === 'pending')  return 'pending approval'
  const now = monthISO()
  if (d.duration_type === 'until_stopped' && !d.end_month) return 'active'
  const last = d.end_month || d.salary_month
  return last < now ? 'completed' : 'scheduled'
}

// Insert-only audit trail (best-effort pre-migration)
export async function discAudit(actionId, action, prev, next, user) {
  try {
    await supabase.from('disciplinary_audit_logs').insert({
      disciplinary_action_id: actionId,
      performed_by: user?.id || null,
      performed_by_name: user?.name || null,
      action,
      previous_value: prev != null ? String(prev) : null,
      new_value: next != null ? String(next) : null,
    })
  } catch { /* audit table missing pre-migration */ }
}

// ─── Settings ────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  max_deduction_percent: 20, deductions_require_approval: true,
  employees_can_appeal: true, appeal_days: 7, default_review_days: 30,
  payslip_show_reason: false,
}

export function useDisciplinarySettings() {
  return useQuery({
    queryKey: ['disciplinary_settings'],
    retry: false,
    queryFn: async () => {
      try {
        const { data, error } = await supabase.from('disciplinary_settings').select('*').eq('id', 1).single()
        if (error) throw error
        return { ...DEFAULT_SETTINGS, ...data }
      } catch { return DEFAULT_SETTINGS }
    },
    staleTime: 60000,
  })
}

export function useSaveDisciplinarySettings() {
  const queryClient = useQueryClient()
  const { showToast } = useAppStore()
  const { user } = useAuthStore()
  return useMutation({
    mutationFn: async (fields) => {
      if (!['ceo', 'super_admin'].includes(user?.role)) throw new Error('Only the CEO can change disciplinary settings')
      const { error } = await supabase.from('disciplinary_settings')
        .update({ ...fields, updated_at: new Date().toISOString() }).eq('id', 1)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['disciplinary_settings'] })
      showToast('Disciplinary settings saved', 'success')
    },
    onError: (err) => showToast(err.message, 'error'),
  })
}

// ─── Queries ─────────────────────────────────────────────────────────────────

// Admin view: every record for one employee (null = migration not run)
export function useDisciplinaryActions(employeeId) {
  return useQuery({
    queryKey: ['disciplinary_actions', employeeId],
    enabled: !!employeeId,
    retry: false,
    queryFn: async () => {
      try {
        const { data, error } = await supabase.from('disciplinary_actions')
          .select('*, deduction:disciplinary_deductions(*), attachments:disciplinary_attachments(*)')
          .eq('employee_id', employeeId)
          .order('created_at', { ascending: false })
        if (error) throw error
        return (data || []).map(a => ({ ...a, deduction: a.deduction?.[0] || null }))
      } catch { return null }
    },
    staleTime: 30000,
  })
}

export function useDisciplinaryAudit(actionId) {
  return useQuery({
    queryKey: ['disciplinary_audit', actionId],
    enabled: !!actionId,
    retry: false,
    queryFn: async () => {
      try {
        const { data } = await supabase.from('disciplinary_audit_logs')
          .select('*').eq('disciplinary_action_id', actionId)
          .order('created_at', { ascending: true })
        return data || []
      } catch { return [] }
    },
    staleTime: 15000,
  })
}

// Employee view: ONLY their own records, and never drafts / pending /
// rejected — those are management-internal until issued
const EMPLOYEE_VISIBLE = ['issued', 'resolved', 'withdrawn', 'escalated']

export function useMyDisciplinary() {
  const { user } = useAuthStore()
  return useQuery({
    queryKey: ['my_disciplinary', user?.id],
    enabled: !!user?.id && !user?._preview,
    retry: false,
    queryFn: async () => {
      try {
        const { data, error } = await supabase.from('disciplinary_actions')
          .select('*, deduction:disciplinary_deductions(*), attachments:disciplinary_attachments(*)')
          .eq('employee_id', user.id)
          .in('status', EMPLOYEE_VISIBLE)
          .order('created_at', { ascending: false })
        if (error) throw error
        return (data || []).map(a => ({ ...a, deduction: a.deduction?.[0] || null }))
      } catch { return null }
    },
    staleTime: 30000,
  })
}

// Unread count for the badge / dashboard banner
export function useMyDisciplinaryUnread() {
  const { user } = useAuthStore()
  return useQuery({
    queryKey: ['my_disciplinary_unread', user?.id],
    enabled: !!user?.id && !user?._preview,
    retry: false,
    queryFn: async () => {
      try {
        const { count, error } = await supabase.from('disciplinary_actions')
          .select('*', { count: 'exact', head: true })
          .eq('employee_id', user.id)
          .in('status', EMPLOYEE_VISIBLE)
          .is('employee_opened_at', null)
        if (error) throw error
        return count || 0
      } catch { return 0 }
    },
    staleTime: 30000,
  })
}

// ─── Mutations ───────────────────────────────────────────────────────────────

function useDiscMutation(fn, successMsg) {
  const queryClient = useQueryClient()
  const { showToast } = useAppStore()
  const { user } = useAuthStore()
  return useMutation({
    mutationFn: (args) => fn(args, user),
    onSuccess: (res) => {
      ;['disciplinary_actions', 'my_disciplinary', 'my_disciplinary_unread', 'disciplinary_audit']
        .forEach(k => queryClient.invalidateQueries({ queryKey: [k] }))
      const msg = typeof res === 'object' && res?.toast ? res.toast : successMsg
      if (msg) showToast(msg, 'success')
    },
    onError: (err) => showToast(err.message, 'error'),
  })
}

export const CAN_ISSUE_WARNING = ['ceo', 'super_admin', 'operations_manager']
export const CAN_APPROVE = ['ceo', 'super_admin']

async function createDeductionRecord(action, form, salary, payrollStatus = 'scheduled') {
  const { amount, net } = computeDeduction(salary, form.deduction_type, form.percentage, form.fixed_amount)
  const months = form.duration_type === 'multi_month' ? Math.max(1, Number(form.number_of_months) || 1) : 1
  const endMonth = form.duration_type === 'one_month' ? form.salary_month
    : form.duration_type === 'multi_month' ? addMonths(form.salary_month, months - 1)
    : null
  const { error } = await supabase.from('disciplinary_deductions').insert({
    disciplinary_action_id: action.id,
    employee_id: action.employee_id,
    salary_month: form.salary_month,
    deduction_type: form.deduction_type,
    percentage: form.deduction_type === 'percent' ? Number(form.percentage) : null,
    fixed_amount: form.deduction_type === 'fixed' ? Number(form.fixed_amount) : null,
    base_salary_snapshot: Number(salary) || null,
    calculated_deduction_amount: amount,
    expected_net_salary: net,
    duration_type: form.duration_type,
    number_of_months: months,
    start_month: form.salary_month,
    end_month: endMonth,
    payroll_status: payrollStatus,
    reason: form.reason || null,
  })
  if (error) throw new Error(`Deduction could not be recorded: ${error.message}`)
}

// Create the action. Deduction sanctions by a non-approver (or when the
// settings require approval for everyone below CEO) go to
// pending_approval; everything else is issued immediately.
export function useCreateDisciplinary() {
  return useDiscMutation(async ({ form, employee, settings }, user) => {
    if (!CAN_ISSUE_WARNING.includes(user?.role) || user?._preview) {
      throw new Error('You are not authorised to issue disciplinary actions')
    }
    const hasSanction = form.action_type !== 'warning_only'
    const hasDeduction = hasSanction && DEDUCTION_SANCTIONS.includes(form.sanction_type)
    const isApprover = CAN_APPROVE.includes(user?.role)

    if (hasDeduction) {
      if (!(Number(employee?.salary) > 0)) {
        throw new Error(`${employee?.name || 'This employee'} has no salary on record — set it on the Employment tab first`)
      }
      if (form.deduction_type === 'percent') {
        const pct = Number(form.percentage)
        if (!(pct > 0)) throw new Error('Deduction percentage must be greater than 0')
        const max = Number(settings?.max_deduction_percent) || 20
        if (pct > max) throw new Error(`Deduction exceeds the company maximum of ${max}%`)
      } else {
        const amt = Number(form.fixed_amount)
        if (!(amt > 0)) throw new Error('Deduction amount must be greater than 0')
        if (amt > Number(employee.salary)) throw new Error('Deduction cannot exceed one month\'s salary')
      }
      if (!form.salary_month) throw new Error('Select the salary month affected')
      if (form.duration_type === 'multi_month' && !(Number(form.number_of_months) > 1)) {
        throw new Error('Enter how many months the deduction runs for')
      }
    }
    if (form.incident_date && form.incident_date > new Date().toISOString().split('T')[0]) {
      throw new Error('Incident date cannot be in the future')
    }

    const needsApproval = hasDeduction && !isApprover && (settings?.deductions_require_approval ?? true)
    const status = needsApproval ? 'pending_approval' : 'issued'

    const { data: action, error } = await supabase.from('disciplinary_actions').insert({
      employee_id: employee.id,
      action_type: form.action_type,
      warning_category: form.warning_category || null,
      custom_category: form.warning_category === 'custom' ? (form.custom_category || null) : null,
      incident_title: form.incident_title || null,
      incident_description: form.incident_description || null,
      incident_date: form.incident_date || null,
      business_impact: form.business_impact || null,
      previous_discussions: form.previous_discussions || null,
      expected_improvement: form.expected_improvement || null,
      sanction_type: hasSanction ? form.sanction_type : null,
      sanction_details: hasSanction ? (form.sanction_details || null) : null,
      management_note: form.management_note || null,
      status,
      review_date: form.review_date || null,
      effective_date: form.effective_date || null,
      issued_by: user?.id || null,
      issued_by_name: user?.name || null,
      issued_at: status === 'issued' ? new Date().toISOString() : null,
      approved_by: status === 'issued' && hasDeduction ? user?.id : null,
      approved_by_name: status === 'issued' && hasDeduction ? user?.name : null,
      approved_at: status === 'issued' && hasDeduction ? new Date().toISOString() : null,
    }).select().single()
    if (error) throw error

    for (const att of (form.attachment_urls || []).filter(a => a.url?.trim())) {
      await supabase.from('disciplinary_attachments').insert({
        disciplinary_action_id: action.id,
        uploaded_by: user?.id || null,
        uploaded_by_name: user?.name || null,
        file_url: att.url.trim(),
        file_name: att.name || null,
        file_type: att.type || 'other',
      })
    }

    // The deduction row is created NOW with a snapshot of the salary —
    // pending until approval when the flow requires it. Base salary on
    // the staff record is never modified.
    if (hasDeduction) {
      await createDeductionRecord(action, form, employee.salary, status === 'issued' ? 'scheduled' : 'pending')
    }

    await discAudit(action.id, 'created', null,
      `${form.action_type} · ${status}${hasDeduction ? ` · ${form.deduction_type === 'percent' ? `${form.percentage}%` : `₦${Number(form.fixed_amount).toLocaleString()}`} deduction for ${form.salary_month}` : ''}`,
      user)
    if (status === 'issued') await discAudit(action.id, 'issued', null, 'Notice visible to the employee', user)

    return {
      ...action,
      toast: status === 'pending_approval'
        ? 'Saved — awaiting CEO approval before the employee is notified'
        : 'Disciplinary notice issued — the employee sees it in their app',
    }
  })
}

export function useApproveDisciplinary() {
  return useDiscMutation(async ({ action }, user) => {
    if (!CAN_APPROVE.includes(user?.role)) throw new Error('Only the CEO can approve sanctions')
    if (action.issued_by === user?.id) throw new Error('You cannot approve a sanction you created yourself')
    if (action.status !== 'pending_approval') throw new Error('This record is not awaiting approval')

    const { error } = await supabase.from('disciplinary_actions').update({
      status: 'issued',
      approved_by: user?.id, approved_by_name: user?.name,
      approved_at: new Date().toISOString(),
      issued_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', action.id).eq('status', 'pending_approval')
    if (error) throw error

    // Activate the deduction that was recorded (as pending) at creation
    if (action.deduction) {
      await supabase.from('disciplinary_deductions').update({
        payroll_status: 'scheduled', updated_at: new Date().toISOString(),
      }).eq('id', action.deduction.id).eq('payroll_status', 'pending')
    }
    await discAudit(action.id, 'approved', 'pending_approval', 'issued', user)
    return { toast: 'Approved and issued — the employee sees it now' }
  })
}

export function useRejectDisciplinary() {
  return useDiscMutation(async ({ action, reason }, user) => {
    if (!CAN_APPROVE.includes(user?.role)) throw new Error('Only the CEO can reject sanctions')
    const { error } = await supabase.from('disciplinary_actions').update({
      status: 'rejected', rejected_reason: reason || null, updated_at: new Date().toISOString(),
    }).eq('id', action.id).eq('status', 'pending_approval')
    if (error) throw error
    // A never-issued deduction is removed with its rejected request
    if (action.deduction) {
      await supabase.from('disciplinary_deductions').delete()
        .eq('id', action.deduction.id).eq('payroll_status', 'pending')
    }
    await discAudit(action.id, 'rejected', 'pending_approval', reason || 'rejected', user)
  }, 'Request rejected')
}

// After issuance a record is never deleted — it is withdrawn with a
// reason. A deduction already recorded is reversed, not erased.
export function useWithdrawDisciplinary() {
  return useDiscMutation(async ({ action, reason }, user) => {
    if (!CAN_APPROVE.includes(user?.role)) throw new Error('Only the CEO can withdraw a disciplinary action')
    if (!reason?.trim()) throw new Error('A withdrawal reason is required')
    const { error } = await supabase.from('disciplinary_actions').update({
      status: 'withdrawn',
      withdrawn_by_name: user?.name || null,
      withdrawn_at: new Date().toISOString(),
      withdrawal_reason: reason.trim(),
      updated_at: new Date().toISOString(),
    }).eq('id', action.id)
    if (error) throw error
    if (action.deduction) {
      await supabase.from('disciplinary_deductions').update({
        payroll_status: 'reversed', updated_at: new Date().toISOString(),
      }).eq('id', action.deduction.id)
      await discAudit(action.id, 'deduction_reversed',
        `₦${Number(action.deduction.calculated_deduction_amount || 0).toLocaleString()} for ${action.deduction.salary_month}`,
        'reversed — payroll adjustment, record kept', user)
    }
    await discAudit(action.id, 'withdrawn', action.status, reason.trim(), user)
  }, 'Withdrawn — the employee sees the withdrawal and the audit trail remains')
}

export function useSetDisciplinaryStatus() {
  return useDiscMutation(async ({ action, status }, user) => {
    if (!CAN_APPROVE.includes(user?.role)) throw new Error('Only the CEO can change this status')
    const { error } = await supabase.from('disciplinary_actions').update({
      status, updated_at: new Date().toISOString(),
    }).eq('id', action.id)
    if (error) throw error
    await discAudit(action.id, 'status_changed', action.status, status, user)
  }, 'Status updated')
}

export function useDeleteDraft() {
  return useDiscMutation(async ({ action }, user) => {
    if (!['draft', 'pending_approval', 'rejected'].includes(action.status)) {
      throw new Error('Issued records cannot be deleted — withdraw instead')
    }
    if (action.issued_by !== user?.id && !CAN_APPROVE.includes(user?.role)) {
      throw new Error('Only the creator or the CEO can delete this draft')
    }
    const { error } = await supabase.from('disciplinary_actions').delete().eq('id', action.id)
    if (error) throw error
  }, 'Draft deleted')
}

// ─── Employee actions ────────────────────────────────────────────────────────

export function useMarkOpened() {
  return useDiscMutation(async ({ action }, user) => {
    if (action.employee_opened_at) return {}
    await supabase.from('disciplinary_actions').update({
      employee_opened_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', action.id).eq('employee_id', user.id).is('employee_opened_at', null)
    await discAudit(action.id, 'employee_opened', null, null, user)
    return {}
  })
}

export function useAcknowledge() {
  return useDiscMutation(async ({ action }, user) => {
    const { error } = await supabase.from('disciplinary_actions').update({
      employee_acknowledged_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', action.id).eq('employee_id', user.id)
    if (error) throw error
    await discAudit(action.id, 'employee_acknowledged', null, 'I have read this notice', user)
  }, 'Recorded — acknowledgement does not mean you agree with the allegation')
}

export function useEmployeeRespond() {
  return useDiscMutation(async ({ action, response, attachmentUrl, requestReview }, user) => {
    const { error } = await supabase.from('disciplinary_actions').update({
      employee_response: response?.trim() || action.employee_response || null,
      employee_response_at: new Date().toISOString(),
      employee_attachment_url: attachmentUrl?.trim() || action.employee_attachment_url || null,
      review_requested: requestReview ? true : action.review_requested,
      updated_at: new Date().toISOString(),
    }).eq('id', action.id).eq('employee_id', user.id)
    if (error) throw error
    if (response?.trim()) await discAudit(action.id, 'employee_response', null, response.trim(), user)
    if (requestReview) await discAudit(action.id, 'review_requested', null, 'Employee requested a management review', user)
    return { toast: requestReview ? 'Review requested — management has been notified' : 'Response submitted' }
  })
}

// Suggested prefilled structure management can edit (spec section 7)
export const SUGGESTED_TEMPLATE = {
  incident_title: 'Repeated Failure to Verify Information',
  incident_description:
    'The employee confirmed that a particular product was available in the warehouse without properly verifying the stock position. Based on this information, the company made a commitment to a customer, but the product was later found to be unavailable.\n\n'
    + 'The employee has also repeatedly entered information into the company application without properly understanding the required process, resulting in avoidable operational errors.\n\n'
    + 'Although the individual mistakes may appear minor, their repeated nature shows insufficient attention to detail and has affected customer service and internal operations.',
  expected_improvement:
    'The employee is expected to verify all information before communicating it, understand the correct procedure before entering information into the application, ask questions when unsure, and demonstrate greater attention, responsibility and intentionality while performing assigned duties.',
}
