import { Plus, Trash2 } from 'lucide-react'
import { fmt } from './ui'
import { variantKey, variantLabel } from '../../lib/inventoryCore'

// ═══════════════════════════════════════════════════════════════════
// Colour / size controls for the stock forms
// ═══════════════════════════════════════════════════════════════════

const input = 'h-10 w-full rounded-md border border-line-strong bg-white px-2.5 text-[13px] focus:outline-none focus:border-brand'

// Rows of colour + size + quantity. The quantities add up to the total.
// rows: [{ color, size, quantity }]; known: [{ color, size }] suggestions
export function VariantRows({ rows, onChange, known = [], idPrefix = 'v', single = false }) {
  const colours = [...new Set(known.map(k => k.color).filter(Boolean))]
  const sizes = [...new Set(known.map(k => k.size).filter(Boolean))]
  const set = (i, patch) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const total = rows.reduce((a, r) => a + (Number(r.quantity) || 0), 0)
  const keys = rows.map(r => variantKey(r.color, r.size))
  const dupes = new Set(keys.filter((k, i) => keys.indexOf(k) !== i))

  return (
    <div className="rounded-lg border border-line">
      <datalist id={`${idPrefix}-colours`}>{colours.map(c => <option key={c} value={c} />)}</datalist>
      <datalist id={`${idPrefix}-sizes`}>{sizes.map(c => <option key={c} value={c} />)}</datalist>
      <div className="grid grid-cols-[1fr_1fr_84px_32px] gap-2 px-3 pt-2.5 pb-1 text-[11px] uppercase tracking-wide text-faint">
        <span>Colour</span><span>Size / other</span><span className="text-right">Qty</span><span />
      </div>
      <div className="space-y-2 px-3 pb-3">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_84px_32px] gap-2 items-center">
            <input className={input} list={`${idPrefix}-colours`} placeholder="e.g. Black" aria-label={`Colour ${i + 1}`}
              value={r.color} onChange={e => set(i, { color: e.target.value })} />
            <input className={input} list={`${idPrefix}-sizes`} placeholder="e.g. Large" aria-label={`Size ${i + 1}`}
              value={r.size} onChange={e => set(i, { size: e.target.value })} />
            <input className={`${input} text-right tnum`} inputMode="numeric" placeholder="0" aria-label={`Quantity ${i + 1}`}
              value={r.quantity} onChange={e => set(i, { quantity: e.target.value.replace(/[^0-9]/g, '') })} />
            {single ? <span /> : (
              <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label="Remove variation"
                className="h-10 w-8 flex items-center justify-center text-faint hover:text-bad"><Trash2 size={15} /></button>
            )}
          </div>
        ))}
        {[...dupes].length > 0 && <p className="text-xs text-bad">The same colour and size is listed twice — combine them into one row.</p>}
        {!single && <div className="flex items-center justify-between pt-1">
          <button type="button" onClick={() => onChange([...rows, { color: '', size: '', quantity: '' }])}
            className="inline-flex items-center gap-1 text-xs font-semibold text-brand-ink"><Plus size={14} />Add variation</button>
          <p className="text-xs text-mute">Total <span className="font-semibold text-charcoal tnum">{fmt(total)}</span></p>
        </div>}
      </div>
    </div>
  )
}

export const variantRowsValid = (rows) => {
  if (!rows.length) return 'Add at least one variation'
  if (rows.some(r => !(r.color || '').trim() && !(r.size || '').trim())) return 'Each variation needs a colour or a size'
  if (rows.some(r => !(Number(r.quantity) > 0))) return 'Each variation needs a quantity'
  const keys = rows.map(r => variantKey(r.color, r.size))
  if (new Set(keys).size !== keys.length) return 'The same colour and size is listed twice'
  return null
}

// Choose which variation a stock change applies to.
// slot = model product.perWarehouse[warehouseId]; value = variant key ('' = none)
export function VariantSelect({ slot, value, onChange, label = 'Colour / size', required }) {
  if (!slot || !slot.variants?.length) return null
  return (
    <label className="block">
      <span className="block text-sm font-medium text-gray-700 mb-1.5">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</span>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full px-4 py-3 text-base bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-blue-500">
        <option value="">Choose…</option>
        {slot.variants.map(v => <option key={v.key} value={v.key}>{variantLabel(v.color, v.size)} — {fmt(v.quantity)} in stock</option>)}
        <option value="__none">No colour/size recorded — {fmt(slot.unassigned)} in stock</option>
      </select>
    </label>
  )
}

// key → { color, size } for applyStock
export function variantFromKey(slot, key) {
  if (!key || key === '__none') return { color: null, size: null }
  const v = slot?.variants?.find(x => x.key === key)
  return v ? { color: v.color, size: v.size } : { color: null, size: null }
}

// Compact "Black 12 · Brown 4 · no colour 3" line
export function VariantSummary({ variants = [], unassigned = 0, limit = 4, className = '' }) {
  if (!variants.length) return null
  const shown = variants.slice(0, limit)
  const more = variants.length - shown.length
  return (
    <p className={`text-[11px] text-mute ${className}`}>
      {shown.map(v => `${variantLabel(v.color, v.size)} ${fmt(v.quantity)}`).join(' · ')}
      {more > 0 && ` · +${more} more`}
      {unassigned > 0 && <span className="text-faint"> · no colour {fmt(unassigned)}</span>}
    </p>
  )
}
