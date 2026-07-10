import { useState, useMemo } from 'react'
import { Navigate } from 'react-router-dom'
import { UserX, AlertTriangle, Check } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { TopBar } from '../../components/layout/TopBar'
import { SearchBar } from '../../components/ui/SearchBar'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { Input, Select, Textarea } from '../../components/ui/Input'
import { SkeletonList } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'
import { useAuthStore } from '../../stores/authStore'
import { useAppStore } from '../../stores/appStore'
import { formatDate, formatDateTime } from '../../utils/format'
import { verifyPassword } from '../../lib/orderPurge'
import { ROLES } from './StaffFormModal'

const STAFF_DELETE_REASONS = [
  { value: 'left_company',   label: 'Left the company' },
  { value: 'contract_ended', label: 'Contract ended' },
  { value: 'terminated',     label: 'Employment terminated' },
  { value: 'duplicate',      label: 'Duplicate account' },
  { value: 'other',          label: 'Other' },
]

const roleLabel = (r) => ROLES.find(x => x.value === r)?.label || r

export function DeleteStaffPage() {
  const { user, realUser } = useAuthStore()
  const { showToast } = useAppStore()
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState([])
  const [showConfirm, setShowConfirm] = useState(false)
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [password, setPassword] = useState('')
  const [phrase, setPhrase] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)

  const isCeo = ['ceo', 'super_admin'].includes(user?.role) && !user?._preview && !realUser

  // Without the is_deleted column, deletion can only deactivate accounts
  const migrationQ = useQuery({
    queryKey: ['staff_delete_migration_check'],
    enabled: isCeo,
    retry: false,
    queryFn: async () => {
      const { error } = await supabase.from('staff_users').select('is_deleted').limit(1)
      return !error
    },
    staleTime: 30000,
  })
  const migrated = migrationQ.data !== false

  const staffQ = useQuery({
    queryKey: ['delete_staff_list'],
    enabled: isCeo,
    queryFn: async () => {
      const { data, error } = await supabase.from('staff_users').select('*').order('name')
      if (error) throw error
      // Own account can't be deleted; already-deleted accounts are done
      return (data || []).filter(s => !s.is_deleted && s.id !== user.id)
    },
    staleTime: 15000,
  })

  const list = useMemo(() => {
    let l = staffQ.data || []
    if (search) {
      const q = search.toLowerCase()
      l = l.filter(s =>
        (s.name || '').toLowerCase().includes(q) ||
        (s.staff_code || '').toLowerCase().includes(q) ||
        (s.phone || '').includes(search) ||
        (s.department || '').toLowerCase().includes(q) ||
        roleLabel(s.role).toLowerCase().includes(q))
    }
    return l
  }, [staffQ.data, search])

  if (!isCeo) return <Navigate to="/settings" replace />

  // Deletion targets come from the RAW staff data, never the
  // search-filtered list — browser autofill once wrote "admin" into
  // the search box and silently emptied the selection
  const selectedStaff = (staffQ.data || []).filter(s => selected.includes(s.id))
  const requiredPhrase = selected.length === 1 ? 'DELETE STAFF' : `DELETE ${selected.length} STAFF`
  const canDelete = reason && phrase.trim() === requiredPhrase && password && !running

  const toggle = (id) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])

  async function executeDelete() {
    setRunning(true)
    try {
      const ok = await verifyPassword(realUser || user, password)
      if (!ok) {
        showToast('Password incorrect — deletion blocked', 'error')
        setRunning(false)
        return
      }
      // Verify the selected IDs against the database first — the DB
      // rows are the deletion targets, not client state
      console.log('[delete-debug] selected staff ids:', selected)
      const { data: dbStaff, error: verifyErr } = await supabase
        .from('staff_users').select('*').in('id', selected)
      console.log('[delete-debug] identifier: staff_users.id (UUID) · db matches:',
        dbStaff?.length ?? 0, '· verify error:', verifyErr?.message || null)

      if (verifyErr || !dbStaff || dbStaff.length === 0) {
        setResult({
          deleted: 0,
          errors: [verifyErr
            ? `Could not verify the selection: ${verifyErr.message}`
            : 'Deletion failed. No selected staff records were found.'],
        })
        setRunning(false)
        return
      }

      const { scrambledPassword } = await import('../../lib/passwords')
      const errors = []
      let deleted = 0
      for (const s of dbStaff) {
        // Targeted UPDATE by id — never an insert/upsert, and only the
        // fields below change. The password column is NOT NULL in the
        // database, so credentials are scrambled, not nulled.
        const { error } = await supabase.from('staff_users').update({
          is_deleted: true,
          is_active: false,
          status: 'former_staff',
          password: scrambledPassword(),
          password_hash: null,
          password_salt: null,
          extra_permissions: null,
          assigned_states: null,
          recovery_email: null,
          deleted_at: new Date().toISOString(),
          deleted_by: user?.name || null,
          delete_reason: reason,
          delete_notes: notes || null,
          updated_at: new Date().toISOString(),
        }).eq('id', s.id)
        if (error) {
          // Deletion columns may predate the migration — still kill access
          const fallback = await supabase.from('staff_users').update({
            is_active: false, status: 'inactive', password: scrambledPassword(),
            updated_at: new Date().toISOString(),
          }).eq('id', s.id)
          if (fallback.error) {
            errors.push(`${s.name}: ${fallback.error.message}`)
            continue
          }
        }
        // Trust nothing: confirm the change actually stuck — RLS can
        // block writes silently (0 rows affected, no error)
        const { data: checkRows } = await supabase.from('staff_users')
          .select('*').eq('id', s.id).limit(1)
        const after = checkRows?.[0]
        if (after?.is_deleted) {
          deleted++
        } else if (after && after.is_active === false) {
          errors.push(`${s.name}: access removed, but run the staff deletion migration to finish the delete.`)
        } else {
          errors.push(`${s.name}: the database silently blocked the update — Row Level Security on staff_users is denying writes for the app. Run the RLS fix in supabase/migrations.sql.`)
        }
        console.log('[delete-debug] staff', s.name, '→', errors[errors.length - 1] || 'deleted')
      }
      console.log('[delete-debug] staff deleted count:', deleted, 'of', dbStaff.length)
      queryClient.invalidateQueries()
      setSelected([])
      setResult({ deleted, errors })
      showToast(
        deleted > 0
          ? `${deleted} staff account${deleted !== 1 ? 's' : ''} deleted successfully`
          : 'Deletion failed — no staff accounts were deleted',
        deleted > 0 ? 'success' : 'error')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-x-hidden w-full">
      <TopBar title="Delete Staff" />

      <div className="bg-white border-b border-gray-100 sticky top-[57px] z-20 px-4 pt-3 pb-2 w-full overflow-x-hidden">
        <SearchBar value={search} onChange={setSearch} placeholder="Name, staff ID, phone, department, role..." />
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-3 pb-24">
        {!migrated && (
          <div className="bg-amber-50 border border-amber-300 rounded-2xl p-3">
            <p className="text-xs font-semibold text-amber-900 mb-1">⚠ Migration required before deleting</p>
            <p className="text-xs text-amber-800">
              The staff-deletion columns don't exist in your database yet, so deletions here can
              only deactivate accounts — they will stay visible in Staff Management. Run
              <span className="font-mono"> supabase/migrations.sql</span> in the Supabase SQL editor
              (it's safe to run the whole file), then delete again.
            </p>
          </div>
        )}
        <div className="bg-red-50 border border-red-200 rounded-2xl p-3 flex items-start gap-2">
          <AlertTriangle size={15} className="text-red-600 shrink-0 mt-0.5" />
          <p className="text-xs text-red-800">
            Deleting a staff account permanently removes their access and profile from daily
            operations. Everything they ever did — orders, timelines, expenses, stock movements —
            stays in the system under their name, shown as (Former Staff).
          </p>
        </div>

        {staffQ.isLoading ? <SkeletonList count={5} /> :
         list.length === 0 ? (
          <EmptyState icon={<UserX size={28} />} title="No staff match" description="Adjust the search" />
        ) : list.map(s => {
          const on = selected.includes(s.id)
          return (
            <button key={s.id} onClick={() => toggle(s.id)}
              className={`w-full text-left bg-white rounded-2xl p-4 border transition-all ${on ? 'border-red-400 bg-red-50/40' : 'border-gray-100'}`}>
              <div className="flex items-start gap-3">
                <span className={`w-5 h-5 rounded flex items-center justify-center shrink-0 mt-0.5 ${on ? 'bg-red-500 text-white' : 'bg-gray-100 text-transparent'}`}>
                  <Check size={13} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-gray-900 truncate">{s.name}</p>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                      s.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {(s.status || (s.is_active ? 'active' : 'inactive')).toUpperCase()}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 truncate">
                    {[s.staff_code, roleLabel(s.role), s.position, s.department].filter(Boolean).join(' · ')}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {s.date_joined ? `Joined ${formatDate(s.date_joined)}` : s.phone || ''}
                  </p>
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {selected.length > 0 && (
        <div className="fixed bottom-20 left-0 right-0 px-4 z-30">
          <button onClick={() => { setReason(''); setNotes(''); setPassword(''); setPhrase(''); setResult(null); setShowConfirm(true) }}
            className="w-full py-3.5 bg-red-600 text-white rounded-2xl font-semibold text-sm active:scale-95 transition-all flex items-center justify-center gap-2 shadow-lg">
            <UserX size={16} /> Delete {selected.length} Staff Account{selected.length !== 1 ? 's' : ''}
          </button>
        </div>
      )}

      <Modal isOpen={showConfirm} onClose={() => !running && setShowConfirm(false)}
        title={result ? (result.deleted > 0 ? 'Deletion Complete' : 'Deletion Failed') : 'Confirm Staff Deletion'}
        footer={result ? (
          <Button className="w-full" onClick={() => { setShowConfirm(false); setResult(null) }}>Done</Button>
        ) : (
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" disabled={running} onClick={() => setShowConfirm(false)}>Back</Button>
            <Button variant="danger" className="flex-1" disabled={!canDelete} loading={running} onClick={executeDelete}>
              Permanently Delete
            </Button>
          </div>
        )}>
        {result ? (
          <div className="space-y-3">
            {result.deleted > 0 ? (
              <p className="text-sm text-gray-800">
                <span className="font-bold">{result.deleted}</span> staff account{result.deleted !== 1 ? 's' : ''} deleted successfully.
                Their history remains under their name, marked (Former Staff).
              </p>
            ) : (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                <p className="text-sm text-red-800">No staff accounts were deleted.</p>
              </div>
            )}
            {result.errors.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1">
                {result.errors.map((e, i) => <p key={i} className="text-xs text-amber-800">• {e}</p>)}
              </div>
            )}
          </div>
        ) : (
        <div className="space-y-4">
          <div className="bg-gray-50 rounded-xl p-3">
            <p className="text-xs font-semibold text-gray-700 mb-1.5">
              Deleting {selectedStaff.length} staff account{selectedStaff.length !== 1 ? 's' : ''}:
            </p>
            <div className="space-y-1.5 mb-2">
              {selectedStaff.map(s => (
                <div key={s.id} className="bg-white rounded-lg px-2.5 py-1.5">
                  <p className="text-xs font-semibold text-gray-900">{s.name}</p>
                  <p className="text-[11px] text-gray-500">
                    {[roleLabel(s.role), s.email, s.staff_code].filter(Boolean).join(' · ')}
                  </p>
                </div>
              ))}
            </div>
            <ul className="text-xs text-gray-600 space-y-1">
              <li>• The account{selectedStaff.length !== 1 ? 's' : ''} will be permanently removed and can no longer log in.</li>
              <li>• They disappear from Staff Management, permissions, assignments and all dropdowns.</li>
              <li>• Every record they created stays intact and keeps showing their name.</li>
              <li>• This action cannot be undone.</li>
            </ul>
          </div>

          <Select label="Deletion Reason" required value={reason} onChange={e => setReason(e.target.value)}>
            <option value="">Select reason...</option>
            {STAFF_DELETE_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </Select>
          <Textarea label="Notes (optional)" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
          <Input label="Your Password" type="password" required autoComplete="new-password"
            value={password} onChange={e => setPassword(e.target.value)}
            placeholder="Re-enter your password to authorise" />
          <Input label={`Type ${requiredPhrase} to confirm`} required
            value={phrase} onChange={e => setPhrase(e.target.value)} placeholder={requiredPhrase} />
        </div>
        )}
      </Modal>
    </div>
  )
}
