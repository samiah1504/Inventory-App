import { useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { TopBar } from '../../components/layout/TopBar'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { Input, Select, Textarea } from '../../components/ui/Input'
import { Badge } from '../../components/ui/Badge'
import { EmptyState } from '../../components/ui/EmptyState'
import { formatDate } from '../../utils/format'
import { useMyLeave, useApplyLeave, useCancelLeave, LEAVE_TYPES, labelOf } from '../../hooks/useStaff'

const leaveColors = { pending: 'amber', approved: 'green', rejected: 'red', cancelled: 'gray' }

export function MyLeavePage() {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ leave_type: 'annual', start_date: '', end_date: '', reason: '', attachment_url: '' })

  const leaveQ = useMyLeave()
  const applyLeave = useApplyLeave()
  const cancelLeave = useCancelLeave()

  return (
    <div className="flex flex-col h-full overflow-x-hidden w-full">
      <TopBar title="My Leave" />

      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-3">
        {leaveQ.data === null ? (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800">
            Leave management isn't set up yet — ask your admin to run the latest database migration.
          </div>
        ) : (
          <>
            <Button className="w-full" onClick={() => setShowForm(true)}>
              Apply for Leave
            </Button>

            {(leaveQ.data || []).length === 0 ? (
              <EmptyState
                icon={<CalendarDays size={28} />}
                title="No leave requests yet"
                description="Apply for leave and track its approval here"
              />
            ) : (leaveQ.data || []).map(l => (
              <div key={l.id} className="bg-white rounded-2xl p-4 border border-gray-100">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p className="text-sm font-semibold text-gray-900">{labelOf(LEAVE_TYPES, l.leave_type)}</p>
                  <Badge color={leaveColors[l.status]}>{l.status}</Badge>
                </div>
                <p className="text-xs text-gray-600">{formatDate(l.start_date)} → {formatDate(l.end_date)}</p>
                {l.reason && <p className="text-xs text-gray-500 mt-1">{l.reason}</p>}
                {l.reviewed_by_name && (
                  <p className="text-[11px] text-gray-400 mt-1">
                    {l.status} by {l.reviewed_by_name}{l.review_note ? ` — ${l.review_note}` : ''}
                  </p>
                )}
                {l.status === 'pending' && (
                  <Button size="sm" variant="secondary" className="w-full mt-3"
                    loading={cancelLeave.isPending}
                    onClick={() => cancelLeave.mutate({ leave: l })}>
                    Cancel Request
                  </Button>
                )}
              </div>
            ))}
          </>
        )}
      </div>

      <Modal isOpen={showForm} onClose={() => setShowForm(false)} title="Apply for Leave"
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowForm(false)} className="flex-1">Cancel</Button>
            <Button className="flex-1" loading={applyLeave.isPending}
              disabled={!form.start_date || !form.end_date}
              onClick={async () => {
                await applyLeave.mutateAsync(form)
                setShowForm(false)
                setForm({ leave_type: 'annual', start_date: '', end_date: '', reason: '', attachment_url: '' })
              }}>
              Submit Request
            </Button>
          </div>
        }>
        <div className="space-y-4">
          <Select label="Leave Type" value={form.leave_type} onChange={e => setForm({ ...form, leave_type: e.target.value })}>
            {LEAVE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Start Date" type="date" required value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} />
            <Input label="End Date" type="date" required value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} />
          </div>
          <Textarea label="Reason" rows={3} placeholder="Why do you need this leave?"
            value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} />
          <Input label="Attachment link (optional)" placeholder="https://... (e.g. medical report)"
            value={form.attachment_url} onChange={e => setForm({ ...form, attachment_url: e.target.value })} />
        </div>
      </Modal>
    </div>
  )
}
