import { ArrowRight, Sliders, AlertTriangle, Bell } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { useProductMovements } from '../../hooks/useInventory'
import { formatDate } from '../../utils/format'
import { ProductThumb, SegmentBar, Legend, Tag, Btn, fmt, naira, pct, COLORS } from './ui'
import { movementLabel } from './movementLabels'
import { DAMAGED_STATUSES, DAMAGE_SOURCES } from '../../hooks/useStockFlow'

// Everything about one product's stock: where it is, its condition,
// what is on the road, and its movement history
export function ProductDetail({ product: p, model, canEdit, onClose, onAdjust, onDamage, onEditThreshold }) {
  const movementsQ = useProductMovements(p?.product_id)
  if (!p) return null
  const { warehouses, isAdmin } = model
  const lines = warehouses.map(w => ({ w, x: p.perWarehouse[w.id] })).filter(l => l.x)

  return (
    <Modal isOpen onClose={onClose} size="3xl" title="Product stock">
      <div className="space-y-5">
        <div className="flex items-start gap-3">
          <ProductThumb src={p.image_url} name={p.name} size={56} />
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-charcoal leading-snug">{p.name}</h3>
            <p className="text-xs text-faint">{[p.sku ? `SKU ${p.sku}` : 'No SKU', p.category, p.business].filter(Boolean).join(' · ')}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {p.isOut && <Tag tone="bad">Out of stock</Tag>}
              {p.isLow && <Tag tone="warn">Low stock</Tag>}
              {isAdmin && (p.cost != null
                ? <Tag>Cost {naira(p.cost)} / unit</Tag>
                : <Tag tone="warn">No cost price — value unknown</Tag>)}
            </div>
          </div>
        </div>

        <dl className="grid grid-cols-2 sm:grid-cols-5 gap-px bg-line border border-line rounded-lg overflow-hidden">
          {[
            { k: 'Good', v: fmt(p.good), dot: COLORS.good },
            { k: 'Inspection', v: fmt(p.inspection), dot: COLORS.inspection },
            { k: 'Damaged', v: fmt(p.damaged), dot: COLORS.bad },
            { k: 'In transit', v: fmt(p.transit), dot: COLORS.transit },
            isAdmin ? { k: 'Value at cost', v: p.value == null ? '—' : naira(p.value) } : { k: 'Total units', v: fmt(p.total) },
          ].map((c, i) => (
            <div key={c.k} className={`bg-white px-3 py-2.5 ${i === 4 ? 'col-span-2 sm:col-span-1' : ''}`}>
              <dt className="text-[11px] text-mute flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: c.dot || 'transparent' }} />{c.k}</dt>
              <dd className="text-[16px] font-semibold text-charcoal tnum">{c.v}</dd>
            </div>
          ))}
        </dl>
        <div>
          <SegmentBar height={8} parts={[
            { label: 'Good', value: p.good, color: COLORS.good },
            { label: 'Inspection', value: p.inspection, color: COLORS.inspection },
            { label: 'Damaged', value: p.damaged, color: COLORS.bad },
            { label: 'In transit', value: p.transit, color: COLORS.transit },
          ]} />
          <div className="mt-2"><Legend items={[
            { label: 'Good', color: COLORS.good }, { label: 'Inspection', color: COLORS.inspection },
            { label: 'Damaged', color: COLORS.bad }, { label: 'In transit', color: COLORS.transit },
          ]} /></div>
        </div>

        {/* By warehouse */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[11px] uppercase tracking-wide text-faint">Stock by warehouse</h4>
            {canEdit && p.product_id && p.tracked && (
              <Btn size="sm" variant="ghost" onClick={() => onEditThreshold(p)}><Bell size={13} />Alert level {fmt(p.minThreshold)}</Btn>
            )}
          </div>
          {lines.length === 0 ? <p className="text-xs text-faint">Not on any warehouse shelf.</p> : (
            <div className="border border-line rounded-lg overflow-x-auto">
              <table className="w-full text-[13px] min-w-[480px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-faint border-b border-line bg-[#FCFBF9]">
                    <th className="text-left font-medium px-3 py-2">Warehouse</th>
                    <th className="text-right font-medium px-3 py-2">Good</th>
                    <th className="text-right font-medium px-3 py-2">Inspection</th>
                    <th className="text-right font-medium px-3 py-2">Damaged</th>
                    {isAdmin && <th className="text-right font-medium px-3 py-2">Share</th>}
                    {canEdit && <th className="px-3 py-2" />}
                  </tr>
                </thead>
                <tbody>
                  {lines.map(({ w, x }) => (
                    <tr key={w.id} className="border-b border-line last:border-0">
                      <td className="px-3 py-2">
                        <p className="font-medium text-charcoal">{w.name}</p>
                        <p className="text-[11px] text-faint">{w.state} · alert at {fmt(x.threshold)}</p>
                      </td>
                      <td className={`px-3 py-2 text-right tnum font-semibold ${x.good <= 0 ? 'text-bad' : x.good <= x.threshold ? 'text-brand-ink' : 'text-good'}`}>{fmt(x.good)}</td>
                      <td className="px-3 py-2 text-right tnum text-mute">{fmt(x.inspection)}</td>
                      <td className="px-3 py-2 text-right tnum">{x.damaged ? <span className="text-bad">{fmt(x.damaged)}</span> : '0'}</td>
                      {isAdmin && <td className="px-3 py-2 text-right tnum text-mute">{p.good ? pct(x.good / p.good) : '—'}</td>}
                      {canEdit && (
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          {x.row && (
                            <>
                              <Btn size="sm" variant="ghost" onClick={() => onDamage(x.row)} title="Mark damaged"><AlertTriangle size={13} className="text-bad" />Damaged</Btn>
                              <Btn size="sm" variant="ghost" onClick={() => onAdjust(x.row)} title="Adjust stock"><Sliders size={13} />Adjust</Btn>
                            </>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {p.damagedElsewhere > 0 && <p className="mt-2 text-xs text-mute">{fmt(p.damagedElsewhere)} damaged unit(s) recorded outside a warehouse (transit, park or delivery).</p>}
        </section>

        {/* In transit */}
        {p.transitItems.length > 0 && (
          <section>
            <h4 className="text-[11px] uppercase tracking-wide text-faint mb-2">In transit</h4>
            <ul className="border border-line rounded-lg divide-y divide-line">
              {p.transitItems.map(t => (
                <li key={t.id} className="px-3 py-2 flex items-center gap-3 text-[13px]">
                  <span className="font-semibold tnum w-10 text-right">{fmt(t.quantity)}</span>
                  <span className="flex items-center gap-1.5 min-w-0 flex-1 text-charcoal">
                    <span className="truncate">{t.from}</span><ArrowRight size={12} className="text-brand shrink-0" /><span className="truncate">{t.to}</span>
                  </span>
                  <span className="text-[11px] text-faint shrink-0">{t.reference} · {t.dispatchedAt ? formatDate(t.dispatchedAt) : ''}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Damaged */}
        {p.damagedItems.length > 0 && (
          <section>
            <h4 className="text-[11px] uppercase tracking-wide text-faint mb-2">Damaged items</h4>
            <ul className="border border-line rounded-lg divide-y divide-line">
              {p.damagedItems.map(d => (
                <li key={d.id} className="px-3 py-2 text-[13px] flex items-start gap-3">
                  <span className="font-semibold tnum w-10 text-right text-bad">{fmt(d.quantity)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-charcoal">{d.reason || 'Damaged'}</p>
                    <p className="text-[11px] text-faint">{[DAMAGE_SOURCES[d.source] || d.source, d.warehouse?.name, d.order_number, formatDate(d.created_at)].filter(Boolean).join(' · ')}</p>
                  </div>
                  <Tag tone="bad">{DAMAGED_STATUSES[d.status]?.label || d.status}</Tag>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Movement history */}
        <section>
          <h4 className="text-[11px] uppercase tracking-wide text-faint mb-2">Recent movements</h4>
          {!p.product_id ? <p className="text-xs text-faint">Not linked to a catalogue product.</p>
            : movementsQ.isLoading ? <div className="h-16 shimmer" />
            : (movementsQ.data || []).length === 0 ? <p className="text-xs text-faint">No movements recorded yet.</p>
            : (
              <ul className="border border-line rounded-lg divide-y divide-line">
                {movementsQ.data.map(m => {
                  const q = Number(m.quantity) || 0
                  return (
                    <li key={m.id} className="px-3 py-2 flex gap-3 text-[13px]">
                      <span className={`w-10 shrink-0 text-right font-semibold tnum ${q > 0 ? 'text-good' : q < 0 ? 'text-bad' : 'text-faint'}`}>{q > 0 ? `+${fmt(q)}` : fmt(q)}</span>
                      <div className="min-w-0">
                        <p className="text-charcoal">{movementLabel(m.movement_type)}{m.warehouse?.name ? <span className="text-faint"> · {m.warehouse.name}</span> : null}</p>
                        {m.notes && <p className="text-[11px] text-mute truncate">{m.notes}</p>}
                        <p className="text-[11px] text-faint">{formatDate(m.created_at)}{m.staff?.name ? ` · ${m.staff.name}${m.staff.is_deleted ? ' (Former Staff)' : ''}` : ''}</p>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
        </section>
      </div>
    </Modal>
  )
}
