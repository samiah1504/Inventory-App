import { useState, useMemo } from 'react'
import { Search } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Input, Select, Textarea } from '../ui/Input'
import { useAuthStore } from '../../stores/authStore'
import { formatCurrency, formatDate } from '../../utils/format'
import {
  ACTION_TYPES, WARNING_CATEGORIES, SANCTION_TYPES, DEDUCTION_SANCTIONS, DURATION_TYPES,
  CAN_APPROVE, computeDeduction, monthISO, monthLabel, addMonths,
  useCreateDisciplinary, useDisciplinarySettings, SUGGESTED_TEMPLATE,
} from '../../hooks/useDisciplinary'

const STEPS = ['Incident', 'Category', 'Sanction', 'Improvement', 'Review']

const EMPTY = {
  action_type: 'warning_only',
  warning_category: '', custom_category: '',
  incident_title: '', incident_description: '', incident_date: '',
  business_impact: '', previous_discussions: '',
  expected_improvement: '',
  sanction_type: '', sanction_details: '',
  deduction_type: 'percent', percentage: '', fixed_amount: '',
  salary_month: monthISO(), duration_type: 'one_month', number_of_months: '2',
  effective_date: new Date().toISOString().split('T')[0],
  review_date: '', management_note: '',
  attachment_urls: [{ url: '', name: '', type: 'screenshot' }],
}

// 5-step Warning & Disciplinary Action wizard (expands the old one-shot
// Issue Warning modal; legacy warnings are untouched)
export function DisciplinaryModal({ staff, isOpen, onClose }) {
  const { user } = useAuthStore()
  const settingsQ = useDisciplinarySettings()
  const settings = settingsQ.data
  const create = useCreateDisciplinary()

  const [step, setStep] = useState(0)
  const [form, setForm] = useState(EMPTY)
  const [catSearch, setCatSearch] = useState('')
  const set = (patch) => setForm(f => ({ ...f, ...patch }))

  const hasSanction = form.action_type !== 'warning_only'
  const hasDeduction = hasSanction && DEDUCTION_SANCTIONS.includes(form.sanction_type)
  const isApprover = CAN_APPROVE.includes(user?.role)
  const salary = Number(staff?.salary) || 0
  const calc = computeDeduction(salary, form.deduction_type, form.percentage, form.fixed_amount)
  const maxPct = Number(settings?.max_deduction_percent) || 20

  const filteredCats = useMemo(() => {
    const q = catSearch.toLowerCase()
    return WARNING_CATEGORIES.filter(c => !q || c.label.toLowerCase().includes(q))
  }, [catSearch])
  const catGroups = useMemo(() => {
    const g = {}
    filteredCats.forEach(c => { (g[c.group] = g[c.group] || []).push(c) })
    return g
  }, [filteredCats])

  const todayISO = new Date().toISOString().split('T')[0]

  // Per-step validation
  const stepValid = [
    /* Incident */ !!form.incident_title.trim() && !!form.incident_description.trim()
      && (!form.incident_date || form.incident_date <= todayISO),
    /* Category */ form.action_type === 'sanction_only'
      || (!!form.warning_category && (form.warning_category !== 'custom' || !!form.custom_category.trim())),
    /* Sanction */ !hasSanction || (!!form.sanction_type && (!hasDeduction || (
      salary > 0 && !!form.salary_month
      && (form.deduction_type === 'percent'
        ? Number(form.percentage) > 0 && Number(form.percentage) <= maxPct
        : Number(form.fixed_amount) > 0 && Number(form.fixed_amount) <= salary)
      && (form.duration_type !== 'multi_month' || Number(form.number_of_months) > 1)
    ))),
    /* Improvement */ !!form.expected_improvement.trim(),
    /* Review */ true,
  ]

  const lastAffectedMonth = form.duration_type === 'one_month' ? form.salary_month
    : form.duration_type === 'multi_month' ? addMonths(form.salary_month || monthISO(), Math.max(1, Number(form.number_of_months) || 1) - 1)
    : null

  const confirmSentence = hasDeduction
    ? `This action will deduct ${form.deduction_type === 'percent' ? `${form.percentage}%` : formatCurrency(Number(form.fixed_amount))} from ${staff?.name}'s salary for ${monthLabel(form.salary_month)}${form.duration_type === 'one_month'
        ? ' only. Their salary will return to the normal amount from the following month.'
        : form.duration_type === 'multi_month'
        ? ` through ${monthLabel(lastAffectedMonth)} (${form.number_of_months} months).`
        : ', recurring every month until manually stopped.'}`
    : null

  async function submit() {
    if (hasDeduction && !window.confirm(`${confirmSentence}\n\nIssue this disciplinary action?`)) return
    await create.mutateAsync({ form, employee: staff, settings })
    setForm(EMPTY); setStep(0)
    onClose()
  }

  function close() { setForm(EMPTY); setStep(0); setCatSearch(''); onClose() }

  return (
    <Modal isOpen={isOpen} onClose={close} title={`Warning & Disciplinary Action — ${staff?.name || ''}`}
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1"
            onClick={() => step === 0 ? close() : setStep(step - 1)}>
            {step === 0 ? 'Cancel' : 'Back'}
          </Button>
          {step < STEPS.length - 1 ? (
            <Button className="flex-1" disabled={!stepValid[step]} onClick={() => setStep(step + 1)}>
              Next
            </Button>
          ) : (
            <Button variant="danger" className="flex-1" loading={create.isPending}
              disabled={!stepValid.every(Boolean)} onClick={submit}>
              {hasDeduction && !isApprover && (settings?.deductions_require_approval ?? true)
                ? 'Submit for Approval' : 'Issue Action'}
            </Button>
          )}
        </div>
      }>
      <div className="space-y-4">
        {/* Step indicator */}
        <div className="flex items-center gap-1">
          {STEPS.map((s, i) => (
            <div key={s} className="flex-1">
              <div className={`h-1 rounded-full ${i <= step ? 'bg-yellow-400' : 'bg-gray-200'}`} />
              <p className={`text-[10px] mt-1 text-center ${i === step ? 'font-semibold text-gray-900' : 'text-gray-400'}`}>{s}</p>
            </div>
          ))}
        </div>

        {/* ── Step 1: Employee & incident ── */}
        {step === 0 && (
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-sm font-semibold text-gray-900">{staff?.name}</p>
              <p className="text-xs text-gray-500">
                {[staff?.staff_code, staff?.department, staff?.position || staff?.role].filter(Boolean).join(' · ')}
              </p>
            </div>
            <Select label="Action Type" required value={form.action_type}
              onChange={e => set({ action_type: e.target.value })}>
              {ACTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
            <Input label="Incident Title" required placeholder="e.g. Repeated Failure to Verify Stock Availability"
              value={form.incident_title} onChange={e => set({ incident_title: e.target.value })} />
            <div>
              <Textarea label="Detailed Description" required rows={5}
                value={form.incident_description} onChange={e => set({ incident_description: e.target.value })} />
              <button type="button"
                className="text-xs text-blue-700 underline mt-1"
                onClick={() => set({
                  incident_title: form.incident_title || SUGGESTED_TEMPLATE.incident_title,
                  incident_description: SUGGESTED_TEMPLATE.incident_description,
                  expected_improvement: form.expected_improvement || SUGGESTED_TEMPLATE.expected_improvement,
                })}>
                Use suggested template (editable)
              </button>
            </div>
            <Input label="Incident Date" type="date" max={todayISO}
              value={form.incident_date} onChange={e => set({ incident_date: e.target.value })} />
            <Textarea label="Previous Verbal Discussions or Warnings" rows={2}
              placeholder="Any earlier conversations about this issue"
              value={form.previous_discussions} onChange={e => set({ previous_discussions: e.target.value })} />
            <Textarea label="Impact on the Business" rows={2}
              value={form.business_impact} onChange={e => set({ business_impact: e.target.value })} />
          </div>
        )}

        {/* ── Step 2: Warning category (searchable, grouped) ── */}
        {step === 1 && (
          <div className="space-y-3">
            {form.action_type === 'sanction_only' && (
              <p className="text-xs text-gray-500">Sanction only — a category is optional but recommended.</p>
            )}
            <Input placeholder="Search categories..." leftIcon={<Search size={14} />}
              value={catSearch} onChange={e => setCatSearch(e.target.value)} />
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {Object.entries(catGroups).map(([group, cats]) => (
                <div key={group}>
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{group}</p>
                  <div className="space-y-1.5">
                    {cats.map(c => (
                      <button key={c.value} type="button"
                        onClick={() => set({ warning_category: c.value })}
                        className={`w-full text-left px-3 py-2 rounded-xl border text-sm transition-all ${
                          form.warning_category === c.value ? 'border-yellow-400 bg-yellow-50 font-semibold' : 'border-gray-200 bg-white'
                        }`}>
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {form.warning_category === 'custom' && (
              <Input label="Custom Category Name" required
                value={form.custom_category} onChange={e => set({ custom_category: e.target.value })} />
            )}
          </div>
        )}

        {/* ── Step 3: Sanction ── */}
        {step === 2 && (
          !hasSanction ? (
            <p className="text-sm text-gray-500 py-6 text-center">
              Warning only — no sanction. Tap Next to continue.
            </p>
          ) : (
            <div className="space-y-4">
              <Select label="Sanction Type" required value={form.sanction_type}
                onChange={e => set({ sanction_type: e.target.value })}>
                <option value="">Select sanction...</option>
                {SANCTION_TYPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </Select>
              {form.sanction_type && !hasDeduction && (
                <Textarea label="Sanction Details" rows={3} required
                  placeholder="Describe the sanction — dates, scope, conditions"
                  value={form.sanction_details} onChange={e => set({ sanction_details: e.target.value })} />
              )}
              {hasDeduction && (
                <>
                  {salary <= 0 && (
                    <p className="text-xs text-red-700 bg-red-50 rounded-xl p-3">
                      {staff?.name} has no salary on record. Set it on the Employment tab before applying a
                      salary deduction.
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    {form.sanction_type === 'percent_deduction' ? (
                      <Input label={`Deduction % (max ${maxPct}%)`} type="number" inputMode="decimal" required
                        value={form.percentage}
                        onChange={e => set({ percentage: e.target.value, deduction_type: 'percent' })} />
                    ) : (
                      <Input label="Deduction Amount (₦)" type="number" inputMode="decimal" required
                        value={form.fixed_amount}
                        onChange={e => set({ fixed_amount: e.target.value, deduction_type: 'fixed' })} />
                    )}
                    <Input label="Salary Month Affected" type="month" required
                      value={form.salary_month} onChange={e => set({ salary_month: e.target.value })} />
                  </div>
                  <Select label="Deduction Duration" required value={form.duration_type}
                    onChange={e => set({ duration_type: e.target.value })}>
                    {DURATION_TYPES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                  </Select>
                  {form.duration_type === 'multi_month' && (
                    <Input label="Number of Months" type="number" inputMode="numeric" min="2" required
                      value={form.number_of_months} onChange={e => set({ number_of_months: e.target.value })} />
                  )}
                  {/* Live calculation */}
                  <div className="bg-gray-50 rounded-xl p-3 space-y-1">
                    <Row k="Current monthly salary" v={formatCurrency(salary)} />
                    <Row k="Deduction" v={form.deduction_type === 'percent' ? `${form.percentage || 0}%` : formatCurrency(Number(form.fixed_amount) || 0)} />
                    <Row k="Deduction amount" v={formatCurrency(calc.amount)} red />
                    <Row k={`Salary for ${monthLabel(form.salary_month)}`} v={formatCurrency(calc.net)} bold />
                    {form.duration_type === 'one_month' && (
                      <p className="text-[11px] text-gray-500 pt-1">
                        One-time — the base salary record is not changed; the normal amount returns from {monthLabel(addMonths(form.salary_month || monthISO(), 1))}.
                      </p>
                    )}
                  </div>
                  {calc.amount > salary * 0.3 && salary > 0 && (
                    <p className="text-xs text-amber-700 bg-amber-50 rounded-xl p-3">
                      Warning: this deduction is more than 30% of the monthly salary. Confirm this is intended.
                    </p>
                  )}
                  {form.deduction_type === 'percent' && Number(form.percentage) > maxPct && (
                    <p className="text-xs text-red-700 bg-red-50 rounded-xl p-3">
                      Exceeds the company maximum of {maxPct}% (change it under Disciplinary Settings).
                    </p>
                  )}
                  <Textarea label="Reason for Deduction" rows={2}
                    value={form.sanction_details} onChange={e => set({ sanction_details: e.target.value })} />
                </>
              )}
              <Input label="Effective Date" type="date" required
                value={form.effective_date} onChange={e => set({ effective_date: e.target.value })} />
            </div>
          )
        )}

        {/* ── Step 4: Expected improvement ── */}
        {step === 3 && (
          <div className="space-y-4">
            <Textarea label="Expected Improvement" required rows={4}
              placeholder="What the employee is expected to do differently"
              value={form.expected_improvement} onChange={e => set({ expected_improvement: e.target.value })} />
            <Input label="Review Date" type="date"
              value={form.review_date} onChange={e => set({ review_date: e.target.value })} />
            <Textarea label="Management Note (internal)" rows={2}
              value={form.management_note} onChange={e => set({ management_note: e.target.value })} />
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-700">Supporting Evidence (links)</p>
              {form.attachment_urls.map((a, i) => (
                <div key={i} className="grid grid-cols-[1fr_auto] gap-2">
                  <Input placeholder="https:// — screenshot, image, PDF, document or voice note"
                    value={a.url}
                    onChange={e => set({ attachment_urls: form.attachment_urls.map((x, j) => j === i ? { ...x, url: e.target.value } : x) })} />
                  <select value={a.type}
                    onChange={e => set({ attachment_urls: form.attachment_urls.map((x, j) => j === i ? { ...x, type: e.target.value } : x) })}
                    className="px-2 py-2 text-xs bg-gray-50 border border-gray-200 rounded-xl">
                    {['screenshot', 'image', 'pdf', 'document', 'voice_note', 'other'].map(t =>
                      <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
                  </select>
                </div>
              ))}
              <button type="button" className="text-xs text-blue-700 underline"
                onClick={() => set({ attachment_urls: [...form.attachment_urls, { url: '', name: '', type: 'other' }] })}>
                + Add another attachment
              </button>
            </div>
          </div>
        )}

        {/* ── Step 5: Review & confirm ── */}
        {step === 4 && (
          <div className="space-y-3">
            <div className="bg-gray-50 rounded-xl p-3 space-y-1">
              <Row k="Employee" v={`${staff?.name} (${staff?.staff_code || '—'})`} />
              <Row k="Action type" v={ACTION_TYPES.find(t => t.value === form.action_type)?.label} />
              {form.warning_category && (
                <Row k="Category" v={form.warning_category === 'custom' ? form.custom_category
                  : WARNING_CATEGORIES.find(c => c.value === form.warning_category)?.label} />
              )}
              <Row k="Incident" v={form.incident_title} />
              {form.incident_date && <Row k="Incident date" v={formatDate(form.incident_date)} />}
              {hasSanction && form.sanction_type && (
                <Row k="Sanction" v={SANCTION_TYPES.find(s => s.value === form.sanction_type)?.label} />
              )}
              {hasDeduction && (
                <>
                  <Row k="Deduction" v={form.deduction_type === 'percent' ? `${form.percentage}%` : formatCurrency(Number(form.fixed_amount))} red />
                  <Row k="Amount" v={formatCurrency(calc.amount)} red />
                  <Row k="Salary month" v={monthLabel(form.salary_month)} />
                  <Row k="Salary after deduction" v={formatCurrency(calc.net)} bold />
                </>
              )}
              {form.review_date && <Row k="Review date" v={formatDate(form.review_date)} />}
              <Row k="Issued by" v={user?.name} />
            </div>
            {confirmSentence && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                <p className="text-xs text-amber-800">{confirmSentence}</p>
              </div>
            )}
            <p className="text-[11px] text-gray-400">
              {hasDeduction && !isApprover && (settings?.deductions_require_approval ?? true)
                ? 'A salary deduction needs CEO approval — the employee is only notified once it is approved.'
                : 'On issue, the employee immediately sees this notice in their app under My Warnings & Disciplinary Actions and on their dashboard.'}
            </p>
          </div>
        )}
      </div>
    </Modal>
  )
}

function Row({ k, v, red, bold }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-xs text-gray-500 shrink-0">{k}</span>
      <span className={`text-xs text-right ${red ? 'text-red-600 font-semibold' : bold ? 'font-bold text-gray-900' : 'text-gray-900 font-medium'}`}>{v || '—'}</span>
    </div>
  )
}
