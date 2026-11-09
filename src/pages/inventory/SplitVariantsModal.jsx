import { useState } from 'react'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { useMoveVariant } from '../../hooks/useInventory'
import { useAppStore } from '../../stores/appStore'
import { variantLabel } from '../../lib/inventoryCore'
import { Segmented, fmt } from './ui'
import { VariantRows, variantRowsValid } from './VariantFields'

// Give stock its colours / sizes without changing the warehouse total:
//  • Split — stock with no colour/size recorded → named variations
//  • Move  — correct a variation (e.g. 2 recorded as Black are Brown)
export function SplitVariantsModal({ product, warehouse, slot, onClose }) {
  const { showToast } = useAppStore()
  const move = useMoveVariant()
  const [mode, setMode] = useState(slot.unassigned > 0 ? 'split' : 'move')
  const [rows, setRows] = useState([{ color: '', size: '', quantity: '' }])
  const [fromKey, setFromKey] = useState(slot.variants[0]?.key || '__none')
  const [to, setTo] = useState({ color: '', size: '', quantity: '' })

  const known = slot.variants.map(v => ({ color: v.color, size: v.size }))
  const splitTotal = rows.reduce((a, r) => a + (Number(r.quantity) || 0), 0)
  const fromVariant = slot.variants.find(v => v.key === fromKey)
  const fromQty = fromKey === '__none' ? slot.unassigned : (fromVariant?.quantity || 0)

  async function save() {
    let moves
    if (mode === 'split') {
      const problem = variantRowsValid(rows)
      if (problem) { showToast(problem, 'error'); return }
      if (splitTotal > slot.unassigned) { showToast(`Only ${slot.unassigned} unit(s) have no colour/size recorded`, 'error'); return }
      moves = rows.map(r => ({ qty: Number(r.quantity), from: {}, to: { color: r.color.trim(), size: r.size.trim() } }))
    } else {
      const qty = Number(to.quantity)
      if (!qty || qty <= 0) { showToast('Enter how many to move', 'error'); return }
      if (qty > fromQty) { showToast(`Only ${fromQty} unit(s) to move`, 'error'); return }
      moves = [{
        qty,
        from: fromKey === '__none' ? {} : { color: fromVariant?.color, size: fromVariant?.size },
        to: { color: to.color.trim(), size: to.size.trim() },
      }]
    }
    try { await move.mutateAsync({ product_id: product.product_id, warehouse_id: warehouse.id, moves }); onClose() } catch { /* toast */ }
  }

  return (
    <Modal isOpen onClose={onClose} size="lg" title={`Colours & sizes — ${warehouse.name}`}
      footer={<div className="flex gap-3">
        <Button variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
        <Button onClick={save} loading={move.isPending} className="flex-1">Save</Button>
      </div>}>
      <div className="space-y-4">
        <div className="rounded-lg border border-line bg-ivory px-3 py-2.5 text-sm">
          <p className="font-semibold text-charcoal">{product.name}</p>
          <p className="text-xs text-mute mt-0.5">
            {fmt(slot.good)} good units here
            {slot.variants.length > 0 && <> · {slot.variants.map(v => `${variantLabel(v.color, v.size)} ${fmt(v.quantity)}`).join(' · ')}</>}
            {' · '}<span className={slot.unassigned ? 'font-semibold text-charcoal' : ''}>{fmt(slot.unassigned)} with no colour/size</span>
          </p>
        </div>
        <Segmented value={mode} onChange={setMode} options={[
          { value: 'split', label: 'Split unrecorded stock' },
          { value: 'move', label: 'Move between colours' },
        ]} />
        {mode === 'split' ? (
          slot.unassigned === 0 ? (
            <p className="text-sm text-mute">Every unit here already has a colour/size.</p>
          ) : (
            <>
              <p className="text-xs text-mute">Say what colour/size the {fmt(slot.unassigned)} unrecorded unit(s) are. The total stays the same.</p>
              <VariantRows rows={rows} onChange={setRows} known={known} idPrefix="split" />
              {splitTotal > slot.unassigned && <p className="text-xs text-bad">That is more than the {fmt(slot.unassigned)} unrecorded unit(s).</p>}
            </>
          )
        ) : (
          <div className="space-y-3">
            <label className="block">
              <span className="block text-sm font-medium text-gray-700 mb-1.5">Move from</span>
              <select value={fromKey} onChange={e => setFromKey(e.target.value)}
                className="w-full px-4 py-3 text-base bg-white border border-gray-200 rounded-xl">
                {slot.variants.map(v => <option key={v.key} value={v.key}>{variantLabel(v.color, v.size)} — {fmt(v.quantity)}</option>)}
                <option value="__none">No colour/size recorded — {fmt(slot.unassigned)}</option>
              </select>
            </label>
            <p className="text-sm font-medium text-gray-700 -mb-1">To</p>
            <VariantRows rows={[to]} onChange={(r) => setTo(r[0] || { color: '', size: '', quantity: '' })} known={known} idPrefix="mv" single />
            <p className="text-xs text-mute">Leave colour and size empty to move units back to "no colour/size recorded".</p>
          </div>
        )}
      </div>
    </Modal>
  )
}
