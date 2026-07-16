import { useState, useEffect } from 'react'
import { useQueryClient, useMutation } from '@tanstack/react-query'
import { Plus, Trash2, Search } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Input, Textarea } from '../ui/Input'
import { useProducts } from '../../hooks/useBusinesses'
import { useAuthStore } from '../../stores/authStore'
import { useAppStore } from '../../stores/appStore'
import { formatCurrency } from '../../utils/format'
import { currentOrderLines, checkStockAvailability, correctOrderProducts } from '../../lib/orderProductCorrection'

// CEO-only: correct the product line(s) on an existing order at any status.
// A data-entry fix, not an operational workflow — inventory, money, reports
// and documents all follow the corrected lines automatically.
export function ProductCorrectionModal({ order, isOpen, onClose }) {
  const { user } = useAuthStore()
  const { showToast } = useAppStore()
  const queryClient = useQueryClient()
  const { data: allProducts } = useProducts()

  const [lines, setLines] = useState([])
  const [reason, setReason] = useState('')
  const [searchIdx, setSearchIdx] = useState(null) // which line's picker is open
  const [searchText, setSearchText] = useState('')

  useEffect(() => {
    if (isOpen && order) {
      setLines(currentOrderLines(order).map(l => ({ ...l })))
      setReason('')
      setSearchIdx(null)
      setSearchText('')
    }
  }, [isOpen, order])

  const updateLine = (idx, patch) => setLines(ls => ls.map((l, i) => i === idx ? { ...l, ...patch } : l))
  const removeLine = (idx) => setLines(ls => ls.filter((_, i) => i !== idx))
  const addLine = () => setLines(ls => [...ls, { product_id: null, product_name: '', quantity: 1, unit_price: 0, color: '', size: '', cost_price: null }])

  const newTotal = lines.reduce((s, l) => s + (Number(l.quantity) || 1) * (Number(l.unit_price) || 0), 0)
  const oldTotal = Number(order?.total_amount) || 0
  const valid = lines.length > 0
    && lines.every(l => l.product_name.trim() && Number(l.quantity) > 0)
    && reason.trim()

  const pickResults = (allProducts || []) // active catalogue products (from the hook)
    .filter(p => !searchText
      || p.name.toLowerCase().includes(searchText.toLowerCase())
      || p.business?.name?.toLowerCase().includes(searchText.toLowerCase()))
    .slice(0, 20)

  const mutation = useMutation({
    mutationFn: async () => {
      // Negative-stock warning before anything is written
      const warnings = await checkStockAvailability(order, lines)
      const warnText = warnings.length > 0 ? `\n\nStock warning:\n${warnings.join('\n')}` : ''
      const ok = window.confirm(
        `This correction will update inventory, financial records, reports and order documents. `
        + `This feature should only be used to correct data-entry mistakes.${warnText}\n\nApply the correction to ${order.order_number}?`
      )
      if (!ok) return null
      return correctOrderProducts({ order, newLines: lines, reason, user })
    },
    onSuccess: (res) => {
      if (!res) return // CEO cancelled at the confirm step
      // Inventory, totals, reports, dashboards — everything recalculates
      queryClient.invalidateQueries()
      const note = res.stockNotes.length > 0 ? ` (${res.stockNotes[0]})` : ''
      showToast(`Product corrected — new total ${formatCurrency(res.newTotal)}${note}`, 'success')
      onClose()
    },
    onError: (err) => showToast(err.message, 'error'),
  })

  if (!order) return null

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Correct Product — CEO"
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button variant="danger" className="flex-1" disabled={!valid} loading={mutation.isPending}
            onClick={() => mutation.mutate()}>
            Apply Correction
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
          <p className="text-xs text-amber-800">
            <span className="font-semibold">Warning:</span> This correction will update inventory,
            financial records, reports, and order documents. Use it only to correct data-entry
            mistakes — not to change what the customer actually purchased.
          </p>
        </div>

        {/* Line editor */}
        <div className="space-y-3">
          {lines.map((l, idx) => (
            <div key={idx} className="bg-gray-50 rounded-xl p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="relative flex-1 min-w-0">
                  <Input label={`Product ${lines.length > 1 ? idx + 1 : ''}`} required
                    placeholder="Search catalogue..."
                    leftIcon={<Search size={14} />}
                    value={searchIdx === idx ? searchText : l.product_name}
                    onFocus={() => { setSearchIdx(idx); setSearchText(l.product_name) }}
                    onChange={e => { setSearchIdx(idx); setSearchText(e.target.value) }} />
                  {searchIdx === idx && (
                    <div className="absolute z-30 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-44 overflow-y-auto">
                      {pickResults.map(p => (
                        <button key={p.id} type="button"
                          onClick={() => {
                            updateLine(idx, {
                              product_id: p.id,
                              product_name: p.name,
                              unit_price: p.selling_price != null ? Number(p.selling_price) : l.unit_price,
                              cost_price: p.cost_price != null ? Number(p.cost_price) : null,
                            })
                            setSearchIdx(null); setSearchText('')
                          }}
                          className="w-full px-3 py-2 text-left hover:bg-gray-50">
                          <p className="text-sm font-medium text-gray-900">{p.name}</p>
                          <p className="text-[11px] text-gray-400">
                            {p.business?.name}{p.selling_price ? ` · ${formatCurrency(p.selling_price)}` : ''}
                          </p>
                        </button>
                      ))}
                      {pickResults.length === 0 && (
                        <p className="px-3 py-2 text-xs text-gray-400">No catalogue products match</p>
                      )}
                    </div>
                  )}
                </div>
                {lines.length > 1 && (
                  <button onClick={() => removeLine(idx)}
                    className="p-2 mt-6 bg-red-50 text-red-500 rounded-xl active:scale-95 shrink-0">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input label="Colour" value={l.color || ''}
                  onChange={e => updateLine(idx, { color: e.target.value })} />
                <Input label="Size / Variant" value={l.size || ''}
                  onChange={e => updateLine(idx, { size: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input label="Quantity" type="number" inputMode="numeric" min="1" required
                  value={l.quantity}
                  onChange={e => updateLine(idx, { quantity: e.target.value })} />
                <Input label="Unit Price (₦)" type="number" inputMode="decimal" required
                  value={l.unit_price}
                  onChange={e => updateLine(idx, { unit_price: e.target.value })} />
              </div>
              <p className="text-xs text-gray-500 text-right">
                Line total: <span className="font-semibold text-gray-900">
                  {formatCurrency((Number(l.quantity) || 1) * (Number(l.unit_price) || 0))}
                </span>
              </p>
            </div>
          ))}
          <button onClick={addLine}
            className="w-full py-2 text-xs font-medium text-gray-600 bg-gray-100 rounded-xl flex items-center justify-center gap-1 active:scale-95">
            <Plus size={13} /> Add Product Line
          </button>
        </div>

        {/* Money summary */}
        <div className="bg-gray-50 rounded-xl p-3 flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500">Order Total</p>
            <p className="text-sm">
              <span className={oldTotal !== newTotal ? 'line-through text-gray-400 mr-2' : 'font-bold text-gray-900'}>
                {formatCurrency(oldTotal)}
              </span>
              {oldTotal !== newTotal && <span className="font-bold text-gray-900">{formatCurrency(newTotal)}</span>}
            </p>
          </div>
          {Number(order.amount_paid) > 0 && (
            <div className="text-right">
              <p className="text-xs text-gray-500">Paid (unchanged)</p>
              <p className="text-sm font-semibold text-green-700">{formatCurrency(order.amount_paid)}</p>
            </div>
          )}
        </div>

        <Textarea label="Reason for Correction" required rows={2}
          placeholder="e.g. Customer Support selected the wrong product during order entry"
          value={reason} onChange={e => setReason(e.target.value)} />

        <p className="text-[11px] text-gray-400">
          Inventory is adjusted automatically (reservation or recorded sale moves to the corrected
          product), COGS and profit recalculate, and invoices, receipts, delivery notes and packing
          lists generated afterwards show the corrected product. The change is recorded permanently
          in the order timeline.
        </p>
      </div>
    </Modal>
  )
}
