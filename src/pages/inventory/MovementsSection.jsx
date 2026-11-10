import { useState } from 'react'
import { History, Trash2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useStockMovements } from '../../hooks/useInventory'
import { supabase } from '../../lib/supabase'
import { variantLabel } from '../../lib/inventoryCore'
import { Panel, ToolSelect, ProductThumb, EmptyNote, Tag, fmt } from './ui'
import { DeleteStockModal } from './DeleteStockModal'
import { MOVEMENT_GROUPS, movementLabel } from './movementLabels'

const when = (d) => new Date(d).toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

// Read-only log of every stock change
export function MovementsSection({ model, search }) {
  const [warehouseId, setWarehouseId] = useState('')
  const [group, setGroup] = useState('')
  const [days, setDays] = useState(30)
  const types = MOVEMENT_GROUPS.find(g => g.value === group)?.types || null
  const { data, isLoading, error } = useStockMovements({ warehouseId, types, days })
  const isCeo = model.isAdmin
  const [undo, setUndo] = useState(null)
  // Deliveries the CEO has already deleted
  const undoneQ = useQuery({
    queryKey: ['inventory_movements', 'undone'],
    enabled: isCeo,
    queryFn: async () => {
      const { data } = await supabase.from('inventory_movements').select('reference_id')
        .eq('reference_type', 'movement_undo').limit(2000)
      return new Set((data || []).map(r => r.reference_id))
    },
  })
  const undone = undoneQ.data || new Set()
  const deleteCell = (m) => {
    if (!isCeo || m.movement_type !== 'purchase') return null
    if (undone.has(m.id)) return <Tag tone="bad">Deleted</Tag>
    return (
      <button onClick={() => setUndo(m)} className="inline-flex items-center gap-1 text-xs font-semibold text-bad hover:underline">
        <Trash2 size={13} />Delete
      </button>
    )
  }

  let list = data || []
  if (search) {
    const q = search.toLowerCase()
    list = list.filter(m => (m.product?.name || '').toLowerCase().includes(q) || (m.notes || '').toLowerCase().includes(q) ||
      (m.product?.sku && String(m.product.sku).toLowerCase().includes(q)))
  }

  return (
    <Panel title="Stock movements" subtitle={`Every recorded change to stock · ${fmt(list.length)} shown${list.length >= 400 ? ' (latest 400)' : ''}`} bodyClass="">
      <div className="flex flex-wrap gap-2 px-4 py-3 border-b border-line bg-[#FCFBF9]">
        <ToolSelect label="Warehouse" value={warehouseId} onChange={setWarehouseId} className="flex-1 sm:flex-none">
          <option value="">All warehouses</option>
          {model.warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </ToolSelect>
        <ToolSelect label="Movement type" value={group} onChange={setGroup} className="flex-1 sm:flex-none">
          {MOVEMENT_GROUPS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
        </ToolSelect>
        <ToolSelect label="Period" value={String(days)} onChange={v => setDays(Number(v))} className="flex-1 sm:flex-none">
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="365">Last 12 months</option>
        </ToolSelect>
      </div>
      {isLoading ? <div className="p-4 space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-10 shimmer" />)}</div>
        : error ? <EmptyNote title="Could not load movements">{error.message}</EmptyNote>
        : list.length === 0 ? <EmptyNote icon={<History size={18} />} title="No movements in this period" />
        : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-faint border-b border-line">
                    <th className="text-left font-medium pl-4 pr-3 py-2.5 whitespace-nowrap">Date</th>
                    <th className="text-left font-medium px-3 py-2.5">Product</th>
                    <th className="text-left font-medium px-3 py-2.5">Warehouse</th>
                    <th className="text-left font-medium px-3 py-2.5">Movement</th>
                    <th className="text-right font-medium px-3 py-2.5">Qty</th>
                    <th className="text-left font-medium px-3 py-2.5">Details</th>
                    <th className="text-left font-medium pl-3 pr-4 py-2.5">By</th>
                    {isCeo && <th className="pr-4" />}
                  </tr>
                </thead>
                <tbody>
                  {list.map(m => {
                    const q = Number(m.quantity) || 0
                    return (
                      <tr key={m.id} className="border-b border-line last:border-0 align-top">
                        <td className="pl-4 pr-3 py-2.5 whitespace-nowrap text-mute">{when(m.created_at)}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2 min-w-0">
                            <ProductThumb src={m.product?.image_url} name={m.product?.name} size={26} />
                            <span className="font-medium text-charcoal truncate max-w-[200px]">{m.product?.name || 'Unknown'}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-mute whitespace-nowrap">{m.warehouse?.name || '—'}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-charcoal">{movementLabel(m.movement_type)}
                          {(m.color || m.size) && <span className="block text-[11px] text-mute">{variantLabel(m.color, m.size)}</span>}</td>
                        <td className={`px-3 py-2.5 text-right tnum font-semibold ${q > 0 ? 'text-good' : q < 0 ? 'text-bad' : 'text-faint'}`}>{q > 0 ? `+${fmt(q)}` : fmt(q)}</td>
                        <td className="px-3 py-2.5 text-xs text-mute max-w-[320px]">{m.notes || '—'}</td>
                        <td className="pl-3 pr-4 py-2.5 text-xs text-mute whitespace-nowrap">{m.staff?.name ? `${m.staff.name}${m.staff.is_deleted ? ' (Former)' : ''}` : '—'}</td>
                        {isCeo && <td className="pr-4 py-2.5 text-right whitespace-nowrap">{deleteCell(m)}</td>}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <ul className="md:hidden divide-y divide-line">
              {list.map(m => {
                const q = Number(m.quantity) || 0
                return (
                  <li key={m.id} className="px-4 py-3 flex gap-3">
                    <span className={`w-12 shrink-0 text-right text-[13px] font-semibold tnum ${q > 0 ? 'text-good' : q < 0 ? 'text-bad' : 'text-faint'}`}>{q > 0 ? `+${fmt(q)}` : fmt(q)}</span>
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-charcoal truncate">{m.product?.name || 'Unknown'}</p>
                      <p className="text-xs text-charcoal">{movementLabel(m.movement_type)}{(m.color || m.size) ? ` · ${variantLabel(m.color, m.size)}` : ''}{m.warehouse?.name ? ` · ${m.warehouse.name}` : ''}</p>
                      {isCeo && m.movement_type === 'purchase' && <div className="mt-1">{deleteCell(m)}</div>}
                      {m.notes && <p className="text-[11px] text-mute line-clamp-2">{m.notes}</p>}
                      <p className="text-[11px] text-faint">{when(m.created_at)}{m.staff?.name ? ` · ${m.staff.name}` : ''}</p>
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      {undo && <DeleteStockModal movement={undo} onClose={() => setUndo(null)} />}
    </Panel>
  )
}
