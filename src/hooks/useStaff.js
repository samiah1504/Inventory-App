import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/authStore'
import { useAppStore } from '../stores/appStore'

export const LEAVE_TYPES = [
  { value: 'annual',    label: 'Annual Leave' },
  { value: 'sick',      label: 'Sick Leave' },
  { value: 'maternity', label: 'Maternity Leave' },
  { value: 'emergency', label: 'Emergency Leave' },
  { value: 'unpaid',    label: 'Unpaid Leave' },
  { value: 'other',     label: 'Other' },
]

export const WARNING_TYPES = [
  { value: 'verbal',             label: 'Verbal Warning' },
  { value: 'first_written',      label: 'First Written Warning' },
  { value: 'final_written',      label: 'Final Written Warning' },
  { value: 'performance',        label: 'Performance Warning' },
  { value: 'attendance',         label: 'Attendance Warning' },
  { value: 'misconduct',         label: 'Misconduct Warning' },
  { value: 'policy_violation',   label: 'Policy Violation' },
  { value: 'customer_complaint', label: 'Customer Complaint' },
  { value: 'other',              label: 'Other' },
]

export const DOCUMENT_CATEGORIES = [
  { value: 'employment_agreement', label: 'Employment Agreement' },
  { value: 'offer_letter',         label: 'Offer Letter' },
  { value: 'job_description',      label: 'Job Description' },
  { value: 'salary_increment',     label: 'Salary Increment Letter' },
  { value: 'warning_letter',       label: 'Warning Letter' },
  { value: 'suspension_letter',    label: 'Suspension Letter' },
  { value: 'leave_approval',       label: 'Leave Approval' },
  { value: 'promotion_letter',     label: 'Promotion Letter' },
  { value: 'performance_review',   label: 'Performance Review' },
  { value: 'other',                label: 'Other' },
]

export const STAFF_STATUSES = [
  { value: 'active',    label: 'Active' },
  { value: 'on_leave',  label: 'On Leave' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'inactive',  label: 'Inactive' },
]

export const labelOf = (list, value) => list.find(o => o.value === value)?.label || value || '—'

// ─── Staff member with HR records ────────────────────────────────────────────

export function useStaffMember(id) {
  return useQuery({
    queryKey: ['staff_member', id],
    enabled: !!id,
    queryFn: async () => {
      // business relation only exists after the HR migration adds business_id —
      // fall back to a plain select so profiles always open
      const withBiz = await supabase
        .from('staff_users')
        .select('*, business:businesses(name)')
        .eq('id', id)
        .single()
      if (!withBiz.error) return withBiz.data

      const plain = await supabase
        .from('staff_users')
        .select('*')
        .eq('id', id)
        .single()
      if (plain.error) throw plain.error
      return plain.data
    },
  })
}

// HR tables may not exist until the migration runs — each returns [] on error
function hrQuery(key, id, table) {
  return {
    queryKey: [key, id],
    enabled: !!id,
    retry: false,
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from(table)
          .select('*')
          .eq('staff_id', id)
          .order('created_at', { ascending: false })
        if (error) throw error
        return data || []
      } catch { return null } // null = table missing
    },
  }
}

export function useStaffLeave(id)     { return useQuery(hrQuery('staff_leave', id, 'staff_leave')) }
export function useStaffWarnings(id)  { return useQuery(hrQuery('staff_warnings', id, 'staff_warnings')) }
export function useStaffDocuments(id) { return useQuery(hrQuery('staff_documents', id, 'staff_documents')) }
export function useStaffNotes(id)     { return useQuery(hrQuery('staff_notes', id, 'staff_notes')) }

// Own leave (self-service)
export function useMyLeave() {
  const { user } = useAuthStore()
  return useQuery(hrQuery('staff_leave', user?.id, 'staff_leave'))
}

// ─── Performance from existing audit trails ─────────────────────────────────

export function useStaffPerformance(id) {
  return useQuery({
    queryKey: ['staff_performance', id],
    enabled: !!id,
    queryFn: async () => {
      const monthStart = new Date()
      monthStart.setDate(1)
      const monthISO = monthStart.toISOString().split('T')[0]

      const count = async (builder) => {
        try {
          const { count: c, error } = await builder
          if (error) throw error
          return c || 0
        } catch { return 0 }
      }

      const timelineCount = (action, since) => {
        let q = supabase.from('order_timeline')
          .select('id', { count: 'exact', head: true })
          .eq('staff_id', id)
          .eq('action', action)
        if (since) q = q.gte('created_at', `${since}T00:00:00`)
        return count(q)
      }
      const movementCount = (types, since) => {
        let q = supabase.from('inventory_movements')
          .select('id', { count: 'exact', head: true })
          .eq('staff_id', id)
          .in('movement_type', types)
        if (since) q = q.gte('created_at', `${since}T00:00:00`)
        return count(q)
      }

      const [
        created, createdM, cancelled, cancelledM,
        delivered, deliveredM, paid, paidM, failed, failedM,
        batches, batchesM, received, receivedM, adjustments, adjustmentsM,
      ] = await Promise.all([
        timelineCount('created'), timelineCount('created', monthISO),
        timelineCount('cancelled'), timelineCount('cancelled', monthISO),
        timelineCount('delivered'), timelineCount('delivered', monthISO),
        timelineCount('paid'), timelineCount('paid', monthISO),
        timelineCount('failed_delivery'), timelineCount('failed_delivery', monthISO),
        count(supabase.from('waybill_batches').select('id', { count: 'exact', head: true }).eq('created_by', id)),
        count(supabase.from('waybill_batches').select('id', { count: 'exact', head: true }).eq('created_by', id).gte('created_at', `${monthISO}T00:00:00`)),
        movementCount(['purchase', 'transfer_in']), movementCount(['purchase', 'transfer_in'], monthISO),
        movementCount(['adjustment_in', 'adjustment_out']), movementCount(['adjustment_in', 'adjustment_out'], monthISO),
      ])

      return {
        orders:      { created: [createdM, created], cancelled: [cancelledM, cancelled] },
        fulfillment: { delivered: [deliveredM, delivered], paid: [paidM, paid], failed: [failedM, failed] },
        waybill:     { batches: [batchesM, batches] },
        inventory:   { received: [receivedM, received], adjustments: [adjustmentsM, adjustments] },
      }
    },
    staleTime: 60000,
  })
}

// ─── Mutations ───────────────────────────────────────────────────────────────

function useHrMutation(fn, invalidate, successMsg) {
  const queryClient = useQueryClient()
  const { showToast } = useAppStore()
  const { user } = useAuthStore()
  return useMutation({
    mutationFn: (args) => fn(args, user),
    onSuccess: () => {
      invalidate.forEach(k => queryClient.invalidateQueries({ queryKey: [k] }))
      if (successMsg) showToast(successMsg, 'success')
    },
    onError: (err) => showToast(err.message, 'error'),
  })
}

export function useResetPassword() {
  return useHrMutation(async ({ staff_id, password }) => {
    // Store as a salted hash and force a change at next login; falls
    // back to a plain write until the password migration is run
    const { passwordUpdatePayload } = await import('../lib/passwords')
    const payload = await passwordUpdatePayload(password, {
      must_change_password: true,
      updated_at: new Date().toISOString(),
    })
    let { error } = await supabase.from('staff_users').update(payload).eq('id', staff_id)
    if (error && /column/i.test(error.message || '')) {
      const retry = await supabase.from('staff_users')
        .update({ password, updated_at: new Date().toISOString() })
        .eq('id', staff_id)
      error = retry.error
    }
    if (error) throw error
  }, ['staff', 'staff_member'], 'Temporary password set — staff must change it at next login')
}

export function useSetStaffStatus() {
  return useHrMutation(async ({ staff_id, status }) => {
    const { error } = await supabase.from('staff_users')
      .update({ status, is_active: status !== 'inactive', updated_at: new Date().toISOString() })
      .eq('id', staff_id)
    if (error) throw error
  }, ['staff', 'staff_member'], 'Status updated')
}

export function useApplyLeave() {
  return useHrMutation(async (form, user) => {
    const { error } = await supabase.from('staff_leave').insert({
      staff_id: form.staff_id || user?.id,
      leave_type: form.leave_type,
      start_date: form.start_date,
      end_date: form.end_date,
      reason: form.reason || null,
      attachment_url: form.attachment_url || null,
      status: 'pending',
    })
    if (error) throw error
  }, ['staff_leave'], 'Leave request submitted')
}

export function useReviewLeave() {
  return useHrMutation(async ({ leave, decision, note }, user) => {
    const { error } = await supabase.from('staff_leave')
      .update({
        status: decision, // approved / rejected
        reviewed_by: user?.id || null,
        reviewed_by_name: user?.name || null,
        reviewed_at: new Date().toISOString(),
        review_note: note || null,
      })
      .eq('id', leave.id)
      .eq('status', 'pending')
    if (error) throw error
    // Approved leave flips profile status automatically
    if (decision === 'approved') {
      await supabase.from('staff_users').update({ status: 'on_leave' }).eq('id', leave.staff_id).eq('status', 'active')
    }
  }, ['staff_leave', 'staff', 'staff_member'], 'Leave request updated')
}

export function useCancelLeave() {
  return useHrMutation(async ({ leave }) => {
    const { error } = await supabase.from('staff_leave')
      .update({ status: 'cancelled' })
      .eq('id', leave.id)
      .in('status', ['pending', 'approved'])
    if (error) throw error
  }, ['staff_leave'], 'Leave request cancelled')
}

export function useIssueWarning() {
  return useHrMutation(async (form, user) => {
    const { data: warning, error } = await supabase.from('staff_warnings').insert({
      staff_id: form.staff_id,
      warning_type: form.warning_type,
      category: form.category || null,
      incident_details: form.incident_details || null,
      corrective_action: form.corrective_action || null,
      review_date: form.review_date || null,
      consequence: form.consequence || null,
      issued_by: user?.id || null,
      issued_by_name: user?.name || null,
      date_issued: form.date_issued || new Date().toISOString().split('T')[0],
    }).select().single()
    if (error) throw error

    // File the warning letter under Staff Documents (regenerated as PDF on demand)
    await supabase.from('staff_documents').insert({
      staff_id: form.staff_id,
      category: 'warning_letter',
      title: `Warning Letter — ${form.date_issued || new Date().toISOString().split('T')[0]}`,
      source: 'generated',
      reference_id: warning.id,
      uploaded_by: user?.id || null,
      uploaded_by_name: user?.name || null,
    })
    return warning
  }, ['staff_warnings', 'staff_documents'], 'Warning issued')
}

export function useSaveDocument() {
  return useHrMutation(async (form, user) => {
    if (form.id) {
      const { error } = await supabase.from('staff_documents')
        .update({
          category: form.category, title: form.title,
          file_url: form.file_url || null, body: form.body || null,
          notes: form.notes || null, updated_at: new Date().toISOString(),
        })
        .eq('id', form.id)
      if (error) throw error
    } else {
      const { error } = await supabase.from('staff_documents').insert({
        staff_id: form.staff_id,
        category: form.category,
        title: form.title,
        file_url: form.file_url || null,
        source: form.body ? 'generated' : 'manual',
        body: form.body || null,
        notes: form.notes || null,
        uploaded_by: user?.id || null,
        uploaded_by_name: user?.name || null,
      })
      if (error) throw error
    }
  }, ['staff_documents'], 'Document saved')
}

export function useDeleteDocument() {
  return useHrMutation(async ({ id }) => {
    const { error } = await supabase.from('staff_documents').delete().eq('id', id)
    if (error) throw error
  }, ['staff_documents'], 'Document deleted')
}

export function useAddStaffNote() {
  return useHrMutation(async ({ staff_id, note }, user) => {
    const { error } = await supabase.from('staff_notes').insert({
      staff_id, note,
      created_by: user?.id || null,
      created_by_name: user?.name || null,
    })
    if (error) throw error
  }, ['staff_notes'], 'Note added')
}

export function useDeleteStaffNote() {
  return useHrMutation(async ({ id }) => {
    const { error } = await supabase.from('staff_notes').delete().eq('id', id)
    if (error) throw error
  }, ['staff_notes'], 'Note deleted')
}

// ─── Access control & deletion ───────────────────────────────────────────────

export const ACCESS_AREAS = [
  { key: 'orders',      label: 'View Orders' },
  { key: 'new_order',   label: 'Create Orders' },
  { key: 'fulfillment', label: 'Fulfillment' },
  { key: 'waybill',     label: 'Waybill' },
  { key: 'inventory',   label: 'Inventory' },
  { key: 'customers',   label: 'Customers' },
  { key: 'reports',     label: 'Reports' },
  { key: 'accounting',  label: 'Accounting / Expenses' },
  { key: 'documents',   label: 'Documents' },
  { key: 'analytics',   label: 'Sales Analytics' },
]

export const ROLE_DEFAULT_ACCESS = {
  ceo:                ACCESS_AREAS.map(a => a.key),
  super_admin:        ACCESS_AREAS.map(a => a.key),
  // No 'accounting': ops managers record their own expenses on
  // /my-expenses; company-wide financials stay CEO-only unless the
  // CEO explicitly ticks accounting access
  operations_manager: ['orders', 'new_order', 'fulfillment', 'waybill', 'inventory', 'customers', 'reports', 'documents'],
  customer_support:   ['orders', 'new_order', 'customers'],
  fulfillment:        ['fulfillment', 'orders'],
  waybill:            ['waybill', 'orders'],
  inventory:          ['inventory', 'customers'],
  accountant:         ['accounting', 'reports'],
}

// Effective access for a staff row: explicit ticks when set, else role defaults
export function accessFor(staff) {
  if (!staff) return []
  if (['ceo', 'super_admin'].includes(staff.role)) return ACCESS_AREAS.map(a => a.key)
  const explicit = Array.isArray(staff.extra_permissions) ? staff.extra_permissions.filter(p => typeof p === 'string') : []
  return explicit.length > 0 ? explicit : (ROLE_DEFAULT_ACCESS[staff.role] || [])
}

export function useSetStaffAccess() {
  return useHrMutation(async ({ staff_id, access }) => {
    const { error } = await supabase.from('staff_users')
      .update({ extra_permissions: access, updated_at: new Date().toISOString() })
      .eq('id', staff_id)
    if (error) throw error
  }, ['staff', 'staff_member'], 'Access updated — applies at their next login')
}

// Hard delete when possible; staff referenced by orders/expenses/etc. can't be
// removed without losing history, so they're deactivated instead.
// Staff deletion lives in Settings → Advanced → Delete Staff. The row
// is kept (marked is_deleted) so historical records keep the name.
export function formerName(staff) {
  if (!staff?.name) return ''
  return staff.is_deleted ? `${staff.name} (Former Staff)` : staff.name
}

// States a fulfillment officer covers (36 states + FCT)
export function useSetAssignedStates() {
  return useHrMutation(async ({ staff_id, states }) => {
    const { error } = await supabase.from('staff_users')
      .update({ assigned_states: states, updated_at: new Date().toISOString() })
      .eq('id', staff_id)
    if (error) throw error
  }, ['staff', 'staff_member'], 'Assigned states updated — applies at their next login')
}
