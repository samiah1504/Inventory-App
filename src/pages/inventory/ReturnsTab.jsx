import { useState } from 'react'
import { RotateCcw, ChevronDown, ChevronUp } from 'lucide-react'
import { useReturns, useProcessReturn } from '../../hooks/useInventory'
import { useProducts } from '../../hooks/useBusinesses'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { Input, Select, Textarea } from '../../components/ui/Input'
import { EmptyState } from '../../components/ui/EmptyState'
import { SkeletonList } from '../../components/ui/Skeleton'
import { formatDate, formatCurrency } from '../../utils/format'

const REASONS = [
  { key: 'changed_mind',         label: 'Customer changed mind' },
  { key: 'rejected_on_delivery', label: 'Customer rejected on delivery' },
  { key: 'wrong_product',        label: 'Wrong product delivered' },
  { key: 'wrong_colour',         label: 'Wrong colour' },
  { key: 'wrong_size',           label: 'Wrong size' },
  { key: 'damaged_delivery',     label: 'Damaged during delivery' },
  { key: 'factory_defect',       label: 'Factory defect' },
  { key: 'missing_parts',        label: 'Missing parts' },
  { key: 'complaint',            label: 'Customer complaint' },
  { key: 'exchange',             label: 'Exchange request' },
  { key: 'other',                label: 'Other' },
]

const OUTCOMES = [
  { key: 'restocked',       label: 'Returned to available warehouse stock' },
  { key: 'inspection',      label: 'Keep in inspection (decide later)' },
  { key: 'repair',          label: 'Sent for repair' },
  { key: 'damaged',         label: 'Marked as damaged' },
  { key: 'written_off',     label: 'Written off' },
  { key: 'supplier_return', label: 'Returned to supplier' },
  { key: 'display_item',    label: 'Kept as display item' },
  { key: 'other',           label: 'Other' },
]

const RESOLUTIONS = [
  { key: 'no_refund',        label: 'No refund' },
  { key: 'full_refund',      label: 'Full refund' },
  { key: 'partial_refund',   label: 'Partial refund' },
  { key: 'exchanged',        label: 'Product exchanged' },
  { key: 'store_credit',     label: 'Store credit' },
  { key: 'replacement_sent', label: 'Replacement sent' },
]

const labelOf = (list, key) => list.find(o => o.key === key)?.label || key || '—'

const emptyForm = {
  return_date: '', reason: '', reason_note: '', outcome: '', outcome_note: '',
  customer_resolution: '', refund_amount: '',
  replacement_product_id: '', replacement_product_name: '',
  replacement_quantity: '', replacement_order_number: '', difference_paid: '',
}

export function ReturnsTab({ canManage }) {
  const [statusFilter, setStatusFilter] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [processing, setProcessing] = useState(null)
  const [form, setForm] = useState(emptyForm)

  const { data: returns, isLoading, isError } = useReturns()
  const { data: products } = useProducts()
  const processReturn = useProcessReturn()

  if (isError) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800">
        <p className="font-semibold mb-1">Returns table not found</p>
        <p>Run the latest migration in <span className="font-mono text-xs">supabase/migrations.sql</span> (Returned Goods Management section) in your Supabase SQL editor to enable return tracking.</p>
      </div>
    )
  }

  if (isLoading) return <SkeletonList count={4} />

  const list = (returns || []).filter(r => !statusFilter || r.status === statusFilter)
  const awaiting = (returns || []).filter(r => r.status === 'awaiting_inspection').length

  function openProcess(ret) {
    setProcessing(ret)
    setForm({
      ...emptyForm,
      return_date: ret.return_date || new Date().toISOString().split('T')[0],
      reason: ret.reason || '',
      customer_resolution: '',
    })
  }

  async function handleSubmit() {
    if (!form.reason || !form.outcome || !form.customer_resolution) return
    // Attach replacement product name from the catalog when an id is picked
    const repl = (products || []).find(p => p.id === form.replacement_product_id)
    await processReturn.mutateAsync({
      ret: processing,
      form: { ...form, replacement_product_name: repl?.name || form.replacement_product_name || null },
    })
    setProcessing(null)
    setForm(emptyForm)
  }

  const needsRefundAmount = ['full_refund', 'partial_refund', 'store_credit'].includes(form.customer_resolution)
  const isExchange = ['exchanged', 'replacement_sent'].includes(form.customer_resolution)
  const formValid = form.reason && form.outcome && form.customer_resolution &&
    (form.reason !== 'other' || form.reason_note.trim())

  return (
    <div className="space-y-3">
      {/* Status pills */}
      <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {[
          { key: '',                    label: 'All' },
          { key: 'awaiting_inspection', label: `Awaiting Inspection${awaiting > 0 ? ` (${awaiting})` : ''}` },
          { key: 'completed',           label: 'Completed' },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => setStatusFilter(key)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium ${statusFilter === key ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}
          >{label}</button>
        ))}
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon={<RotateCcw size={28} />}
          title="No returns"
          description="When an order is marked returned, it appears here for inspection and assessment"
        />
      ) : list.map(r => {
        const isOpen = expanded === r.id
        return (
          <div key={r.id} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <button
              onClick={() => setExpanded(isOpen ? null : r.id)}
              className="w-full text-left p-4 active:bg-gray-50 transition-colors"
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <p className="text-xs font-mono text-gray-400 truncate">{r.return_number}</p>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                  r.status === 'awaiting_inspection' ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'
                }`}>
                  {r.status === 'awaiting_inspection' ? 'AWAITING INSPECTION' : 'COMPLETED'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 leading-tight">{r.product_name}</p>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">
                    ×{r.quantity} · {r.order_number || 'No order'} · {r.customer_name || '—'}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{formatDate(r.return_date || r.created_at)}</p>
                </div>
                {isOpen
                  ? <ChevronUp size={18} className="text-gray-400 shrink-0" />
                  : <ChevronDown size={18} className="text-gray-400 shrink-0" />}
              </div>
            </button>

            {isOpen && (
              <div className="px-4 pb-4 space-y-3">
                {/* Assessment summary (completed) */}
                {r.status === 'completed' && (
                  <div className="bg-gray-50 rounded-xl p-3 space-y-1">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Assessment</p>
                    <p className="text-xs text-gray-600"><span className="text-gray-400">Reason: </span>{labelOf(REASONS, r.reason)}{r.reason_note ? ` — ${r.reason_note}` : ''}</p>
                    <p className="text-xs text-gray-600"><span className="text-gray-400">Outcome: </span>{labelOf(OUTCOMES, r.outcome)}{r.outcome_note ? ` — ${r.outcome_note}` : ''}</p>
                    <p className="text-xs text-gray-600"><span className="text-gray-400">Resolution: </span>{labelOf(RESOLUTIONS, r.customer_resolution)}{Number(r.refund_amount) > 0 ? ` — ${formatCurrency(r.refund_amount)}` : ''}</p>
                    {r.replacement_product_name && (
                      <p className="text-xs text-gray-600">
                        <span className="text-gray-400">Replacement: </span>
                        {r.replacement_product_name} ×{r.replacement_quantity || 1}
                        {r.replacement_order_number ? ` · ${r.replacement_order_number}` : ''}
                        {Number(r.difference_paid) > 0 ? ` · diff paid ${formatCurrency(r.difference_paid)}` : ''}
                      </p>
                    )}
                  </div>
                )}

                {/* Location */}
                {r.warehouse?.name && (
                  <p className="text-xs text-gray-500 px-1">
                    Warehouse: <span className="font-medium text-gray-700">{r.warehouse.name}{r.warehouse.state ? ` · ${r.warehouse.state}` : ''}</span>
                  </p>
                )}

                {/* Timeline */}
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Return Timeline</p>
                  {(r.timeline || []).length === 0 ? (
                    <p className="text-xs text-gray-400">No timeline entries</p>
                  ) : (
                    <div className="space-y-2">
                      {r.timeline.map(t => (
                        <div key={t.id} className="flex gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 mt-1.5 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-gray-700">{t.description || t.action}</p>
                            <p className="text-[11px] text-gray-400">
                              {new Date(t.created_at).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                              {t.staff_name ? ` · ${t.staff_name}` : ''}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {r.status === 'awaiting_inspection' && canManage && (
                  <Button onClick={() => openProcess(r)} className="w-full">
                    Process Return
                  </Button>
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* ── Assessment form modal ── */}
      <Modal
        isOpen={!!processing}
        onClose={() => setProcessing(null)}
        title={processing ? `Return Assessment — ${processing.return_number}` : 'Return Assessment'}
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setProcessing(null)} className="flex-1">Cancel</Button>
            <Button onClick={handleSubmit} loading={processReturn.isPending} className="flex-1" disabled={!formValid}>
              Complete Return
            </Button>
          </div>
        }
      >
        {processing && (
          <div className="space-y-4">
            {/* Return info */}
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-sm font-semibold text-gray-900">{processing.product_name} ×{processing.quantity}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {processing.order_number || 'No order'} · {processing.customer_name || '—'}
              </p>
            </div>

            <Input label="Return Date" type="date" value={form.return_date}
              onChange={e => setForm({ ...form, return_date: e.target.value })} />

            <Select label="Reason for Return" required value={form.reason}
              onChange={e => setForm({ ...form, reason: e.target.value })}>
              <option value="">Select reason...</option>
              {REASONS.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
            </Select>
            <Textarea label={form.reason === 'other' ? 'Describe the reason (required)' : 'Additional comments'}
              rows={2} placeholder="Notes about this return..."
              value={form.reason_note} onChange={e => setForm({ ...form, reason_note: e.target.value })} />

            <Select label="Return Outcome — what happens to the product?" required value={form.outcome}
              onChange={e => setForm({ ...form, outcome: e.target.value })}>
              <option value="">Select outcome...</option>
              {OUTCOMES.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </Select>
            {form.outcome === 'other' && (
              <Input label="Describe the outcome" value={form.outcome_note}
                onChange={e => setForm({ ...form, outcome_note: e.target.value })} />
            )}

            <Select label="Customer Resolution" required value={form.customer_resolution}
              onChange={e => setForm({ ...form, customer_resolution: e.target.value })}>
              <option value="">Select resolution...</option>
              {RESOLUTIONS.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
            </Select>

            {needsRefundAmount && (
              <Input label={form.customer_resolution === 'store_credit' ? 'Store Credit Amount (₦)' : 'Refund Amount (₦)'}
                type="number" inputMode="decimal"
                value={form.refund_amount} onChange={e => setForm({ ...form, refund_amount: e.target.value })} />
            )}

            {isExchange && (
              <div className="bg-blue-50 rounded-xl p-3 space-y-3">
                <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Exchange Details</p>
                <Select label="Replacement Product" value={form.replacement_product_id}
                  onChange={e => setForm({ ...form, replacement_product_id: e.target.value })}>
                  <option value="">Select product...</option>
                  {(products || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Quantity" type="number" inputMode="numeric"
                    value={form.replacement_quantity} onChange={e => setForm({ ...form, replacement_quantity: e.target.value })} />
                  <Input label="New Order #" placeholder="ORD-..."
                    value={form.replacement_order_number} onChange={e => setForm({ ...form, replacement_order_number: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Difference Paid (₦)" type="number" inputMode="decimal"
                    value={form.difference_paid} onChange={e => setForm({ ...form, difference_paid: e.target.value })} />
                  <Input label="Refund Given (₦)" type="number" inputMode="decimal"
                    value={form.refund_amount} onChange={e => setForm({ ...form, refund_amount: e.target.value })} />
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
