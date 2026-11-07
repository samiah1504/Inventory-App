import { MapPin } from 'lucide-react'
import { WarehouseDistribution } from './OverviewSection'
import { ProductsTable } from './ProductsTable'
import { Panel, SegmentBar, Legend, fmt, naira, pct, COLORS } from './ui'

// Warehouses: the distribution on the left, the chosen warehouse's own
// figures and products on the right
export function WarehousesSection({ model, search, selectedId, onSelect, onOpenProduct }) {
  const { warehouses, isAdmin } = model
  const selected = warehouses.find(w => w.id === selectedId) || warehouses[0] || null

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(340px,5fr)_7fr] items-start">
      <div className="xl:sticky xl:top-0">
        <WarehouseDistribution model={model} onOpenWarehouse={(id) => id && onSelect(id)} />
      </div>

      {selected && (
        <div className="space-y-4 min-w-0">
          <Panel bodyClass="p-0">
            <div className="px-4 pt-4 pb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wide text-faint">Warehouse</p>
                <h2 className="text-lg font-semibold text-charcoal leading-tight truncate">{selected.name}</h2>
                <p className="text-xs text-mute flex items-center gap-1 mt-0.5">
                  <MapPin size={12} />{[selected.address, selected.city, selected.state].filter(Boolean).join(', ') || selected.state}
                </p>
                {(selected.contact_person || selected.contact_phone) && (
                  <p className="text-[11px] text-faint mt-0.5">{[selected.contact_person, selected.contact_phone].filter(Boolean).join(' · ')}</p>
                )}
              </div>
              {warehouses.length > 1 && (
                <select value={selected.id} onChange={e => onSelect(e.target.value)} aria-label="Choose warehouse"
                  className="h-9 rounded-md border border-line-strong bg-white px-2 text-[13px] max-w-[45%]">
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              )}
            </div>
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-line border-t border-line">
              {[
                { k: 'Good stock', v: fmt(selected.good), dot: COLORS.good },
                { k: 'Damaged', v: fmt(selected.damaged), dot: COLORS.bad },
                { k: 'Awaiting inspection', v: fmt(selected.inspection) },
                isAdmin
                  ? { k: 'Value at cost', v: naira(selected.value), sub: `${pct(selected.share)} of company good stock` }
                  : { k: 'Products on shelf', v: fmt(selected.products) },
              ].map(c => (
                <div key={c.k} className="bg-white px-4 py-3">
                  <dt className="text-[11px] text-mute flex items-center gap-1.5">
                    {c.dot && <span className="w-2 h-2 rounded-full" style={{ background: c.dot }} />}{c.k}
                  </dt>
                  <dd className="text-[17px] font-semibold text-charcoal tnum mt-0.5">{c.v}</dd>
                  {c.sub && <dd className="text-[11px] text-faint">{c.sub}</dd>}
                </div>
              ))}
            </dl>
            <div className="px-4 py-3 border-t border-line">
              <SegmentBar height={8} parts={[
                { label: 'Good', value: selected.good, color: COLORS.good },
                { label: 'Awaiting inspection', value: selected.inspection, color: COLORS.inspection },
                { label: 'Damaged', value: selected.damaged, color: COLORS.bad },
              ]} />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <Legend items={[
                  { label: 'Good', color: COLORS.good },
                  { label: 'Inspection', color: COLORS.inspection },
                  { label: 'Damaged', color: COLORS.bad },
                ]} />
                <p className="text-[11px] text-faint">
                  {selected.outLines ? <span className="text-bad font-semibold">{selected.outLines} out of stock</span> : '0 out of stock'}
                  {' · '}{selected.lowLines ? <span className="text-brand-ink font-semibold">{selected.lowLines} low</span> : '0 low'}
                </p>
              </div>
            </div>
          </Panel>

          <ProductsTable key={selected.id} model={model} search={search} onOpen={onOpenProduct}
            initialWarehouse={selected.id} defaultView="summary"
            title={`Products in ${selected.name}`} />
        </div>
      )}
    </div>
  )
}
