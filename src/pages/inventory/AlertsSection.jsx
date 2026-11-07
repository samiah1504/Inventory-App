import { useMemo, useState } from 'react'
import { BellRing, Truck, MapPin } from 'lucide-react'
import { Panel, ProductThumb, Tag, ToolSelect, EmptyNote, Btn, fmt } from './ui'
import { formatDate } from '../../utils/format'

const ageDays = (d) => d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : 0

// What needs attention: low / out-of-stock lines (each warehouse line
// against its own alert level), goods stuck in transit or at a park
export function AlertsSection({ model, search, canEdit, onOpenProduct, onEditThreshold, onGo }) {
  const [kind, setKind] = useState('')
  const lines = useMemo(() => {
    const out = []
    for (const p of model.products) {
      for (const w of model.warehouses) {
        const x = p.perWarehouse[w.id]
        if (!x?.row) continue
        if (x.good <= 0) out.push({ p, w, x, kind: 'out' })
        else if (x.good <= x.threshold) out.push({ p, w, x, kind: 'low' })
      }
    }
    return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'out' ? -1 : 1) || a.x.good - b.x.good || a.p.name.localeCompare(b.p.name))
  }, [model.products, model.warehouses])

  let list = kind ? lines.filter(l => l.kind === kind) : lines
  if (search) {
    const q = search.toLowerCase()
    list = list.filter(l => l.p.name.toLowerCase().includes(q) || (l.p.sku && String(l.p.sku).toLowerCase().includes(q)))
  }
  const stuck = model.transit.filter(t => ageDays(t.dispatchedAt) > 7)
  const oldPark = model.park.filter(h => ageDays(h.created_at) > 14)

  return (
    <div className="grid gap-4 xl:grid-cols-[8fr_4fr] items-start">
      <Panel title="Low and out of stock" bodyClass=""
        subtitle={`${fmt(lines.filter(l => l.kind === 'out').length)} out of stock · ${fmt(lines.filter(l => l.kind === 'low').length)} low · each warehouse line against its own alert level`}
        action={<ToolSelect label="Alert type" value={kind} onChange={setKind}>
          <option value="">All alerts</option><option value="out">Out of stock</option><option value="low">Low stock</option>
        </ToolSelect>}>
        {list.length === 0 ? (
          <EmptyNote icon={<BellRing size={18} />} title="No stock alerts">Every warehouse line is above its low-stock level.</EmptyNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] min-w-[560px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-faint border-b border-line">
                  <th className="text-left font-medium pl-4 pr-3 py-2.5">Product</th>
                  <th className="text-left font-medium px-3 py-2.5">Warehouse</th>
                  <th className="text-right font-medium px-3 py-2.5">Good stock</th>
                  <th className="text-right font-medium px-3 py-2.5">Alert level</th>
                  <th className="text-left font-medium px-3 py-2.5">Status</th>
                  {canEdit && <th className="pr-4" />}
                </tr>
              </thead>
              <tbody>
                {list.map(l => (
                  <tr key={`${l.p.key}-${l.w.id}`} className="border-b border-line last:border-0 hover:bg-ivory">
                    <td className="pl-4 pr-3 py-2.5 cursor-pointer" onClick={() => onOpenProduct(l.p)}>
                      <div className="flex items-center gap-3 min-w-0">
                        <ProductThumb src={l.p.image_url} name={l.p.name} size={32} />
                        <div className="min-w-0">
                          <p className="font-semibold text-charcoal truncate max-w-[240px]">{l.p.name}</p>
                          <p className="text-[11px] text-faint">{l.p.sku ? `SKU ${l.p.sku}` : '—'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-mute">{l.w.name}</td>
                    <td className="px-3 py-2.5 text-right tnum font-semibold">{fmt(l.x.good)}</td>
                    <td className="px-3 py-2.5 text-right tnum text-mute">{fmt(l.x.threshold)}</td>
                    <td className="px-3 py-2.5">{l.kind === 'out' ? <Tag tone="bad">Out of stock</Tag> : <Tag tone="warn">Low</Tag>}</td>
                    {canEdit && (
                      <td className="pr-4 py-2.5 text-right">
                        <Btn size="sm" variant="ghost" onClick={() => onEditThreshold(l.p)}>Alert level</Btn>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="space-y-4">
        <Panel title="In transit over 7 days" subtitle="Shipments that may be stuck" bodyClass="">
          {stuck.length === 0 ? <EmptyNote icon={<Truck size={18} />} title="Nothing overdue" /> : (
            <ul className="divide-y divide-line">
              {stuck.slice(0, 8).map(t => (
                <li key={t.id}>
                  <button onClick={() => onGo('transit')} className="w-full text-left px-4 py-2.5 hover:bg-ivory">
                    <p className="text-[13px] font-semibold text-charcoal truncate">{fmt(t.quantity)} × {t.name}</p>
                    <p className="text-[11px] text-faint truncate">{t.from} → {t.to} · {ageDays(t.dispatchedAt)} days</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="At a park over 14 days" subtitle="Goods at park waiting for a decision" bodyClass="">
          {oldPark.length === 0 ? <EmptyNote icon={<MapPin size={18} />} title="Nothing waiting long" /> : (
            <ul className="divide-y divide-line">
              {oldPark.slice(0, 8).map(h => (
                <li key={h.id}>
                  <button onClick={() => onGo('transit', 'park')} className="w-full text-left px-4 py-2.5 hover:bg-ivory">
                    <p className="text-[13px] font-semibold text-charcoal truncate">{fmt(h.quantity)} × {h.product_name}</p>
                    <p className="text-[11px] text-faint truncate">{[h.park_name, h.state].filter(Boolean).join(', ')} · since {formatDate(h.created_at)}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  )
}
