import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { useDeleteStock } from '../../hooks/useInventory'
import { variantLabel } from '../../lib/inventoryCore'
import { Segmented, fmt } from './ui'
import { VariantSelect, variantFromKey } from './VariantFields'

// CEO-only. Every delete needs a reason and is kept in the stock history.
//   movement → undo that recorded delivery
//   row/slot → remove units, or the whole product line, from a warehouse
export function DeleteStockModal({ movement, row, slot, productName, warehouseName, onClose }) {
  const del = useDeleteStock()
  const [mode, setMode] = useState(movement ? 'undo' : 'units')
  const [reason, setReason] = useState('')
  const [quantity, setQuantity] = useState('')
  const [variant, setVariant] = useState('')
  const [confirmLine, setConfirmLine] = useState(false)

  const hasVariants = !!slot?.variants?.length
  const canSubmit = reason.trim() && (
    mode === 'undo' ||
    (mode === 'units' && Number(quantity) > 0 && (!hasVariants || variant)) ||
    (mode === 'line' && confirmLine))

  async function submit() {
    try {
      await del.mutateAsync({
        mode, reason, movement, row, quantity: Number(quantity),
        ...(mode === 'units' ? variantFromKey(slot, variant) : {}),
        product_name: productName, warehouse_name: warehouseName,
      })
      onClose()
    } catch { /* toast shown */ }
  }

  const title = mode === 'undo' ? 'Delete delivery' : mode === 'line' ? 'Remove product from warehouse' : 'Delete stock'
  return (
    <Modal isOpen onClose={onClose} title={title}
      footer={<div className="flex gap-3">
        <Button variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
        <Button variant="danger" onClick={submit} loading={del.isPending} disabled={!canSubmit} className="flex-1">
          {mode === 'undo' ? 'Delete delivery' : mode === 'line' ? 'Remove completely' : 'Delete units'}
        </Button>
      </div>}>
      <div className="space-y-4">
        {mode === 'undo' ? (
          <div className="rounded-lg border border-line bg-ivory p-3 text-sm">
            <p className="font-semibold text-charcoal">
              {fmt(Math.abs(Number(movement.quantity) || 0))} × {movement.product?.name || productName || 'Product'}
              {(movement.color || movement.size) && <span className="font-normal text-mute"> · {variantLabel(movement.color, movement.size)}</span>}
            </p>
            <p className="text-xs text-mute mt-0.5">
              Received into {movement.warehouse?.name || warehouseName || 'warehouse'} on {new Date(movement.created_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}
              {movement.supplier ? ` from ${movement.supplier}` : ''}{movement.staff?.name ? ` · recorded by ${movement.staff.name}` : ''}
            </p>
            <p className="text-xs text-mute mt-2">This takes exactly these units back off the stock. If some have already been sold or moved, it will refuse — use Remove units instead.</p>
          </div>
        ) : (
          <>
            <div className="rounded-lg border border-line bg-ivory p-3 text-sm">
              <p className="font-semibold text-charcoal">{productName}</p>
              <p className="text-xs text-mute mt-0.5">
                {warehouseName} · {fmt(slot?.good || 0)} good
                {slot?.inspection ? ` · ${fmt(slot.inspection)} awaiting inspection` : ''}
                {hasVariants && <> · {slot.variants.map(v => `${variantLabel(v.color, v.size)} ${fmt(v.quantity)}`).join(' · ')}{slot.unassigned ? ` · no colour ${fmt(slot.unassigned)}` : ''}</>}
              </p>
            </div>
            <Segmented value={mode} onChange={setMode} options={[
              { value: 'units', label: 'Remove units' },
              { value: 'line', label: 'Remove whole line' },
            ]} />
            {mode === 'units' ? (
              <>
                <VariantSelect slot={slot} value={variant} onChange={setVariant} required />
                <Input label="How many units to delete?" type="number" inputMode="numeric" required
                  value={quantity} onChange={e => setQuantity(e.target.value)} />
              </>
            ) : (
              <label className="flex items-start gap-2.5 rounded-lg border border-[#F0C9C1] bg-bad-wash px-3 py-2.5 text-sm text-walnut cursor-pointer">
                <input type="checkbox" className="mt-0.5 accent-[#C2341F]" checked={confirmLine} onChange={e => setConfirmLine(e.target.checked)} />
                <span>
                  Remove <b>all {fmt((slot?.good || 0) + (slot?.inspection || 0))} units</b> of {productName} from {warehouseName}
                  {hasVariants ? ', every colour/size,' : ''} and take this product off the warehouse list.
                </span>
              </label>
            )}
          </>
        )}
        <Input label="Reason" required placeholder="e.g. Entered twice by mistake" value={reason} onChange={e => setReason(e.target.value)} />
        <p className="text-xs text-mute flex gap-1.5"><AlertTriangle size={14} className="shrink-0 text-bad" />
          Only the CEO can do this. It is recorded in Stock Movements as "Deleted by CEO" with your reason.</p>
      </div>
    </Modal>
  )
}
