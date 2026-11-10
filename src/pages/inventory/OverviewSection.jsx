import { ArrowRight, Truck, AlertTriangle, Warehouse } from 'lucide-react'
import { ProductsTable } from './ProductsTable'
import {
  Panel, Bar, SegmentBar, Legend, Dot, Tag, LinkButton, EmptyNote, ProductThumb,
  fmt, naira, nairaCompact, pct, COLORS,
} from './ui'
import { formatDate } from '../../utils/format'

// ── Summary strip: six figures in one panel, divided by hairlines ──
export function SummaryStrip({ model }) {
  const { totals } = model
  const cells = [
    {
      label: 'Total units',
      value: fmt(totals.total),
      note: 'Good, damaged, in transit & inspection',
    },
    {
      label: 'Good stock',
      dot: COLORS.good,
      value: fmt(totals.good),
      note: totals.total ? `${pct(totals.good / totals.total)} of all units · saleable` : 'Saleable, on the shelf',
    },
    {
      label: 'Inventory value',
      value: nairaCompact(totals.value),
      title: naira(totals.value),
      note: totals.missingCost
        ? `Good stock at cost · ${totals.missingCost} product${totals.missingCost === 1 ? '' : 's'} without cost price`
        : 'Good stock at cost price',
    },
    {
      label: 'In transit',
      dot: COLORS.transit,
      value: fmt(totals.transit),
      note: `${fmt(model.transit.length)} shipment line${model.transit.length === 1 ? '' : 's'} on the move`,
    },
    {
      label: 'Damaged',
      dot: COLORS.bad,
      value: fmt(totals.damaged),
      note: totals.good + totals.damaged
        ? `${pct(totals.damaged / (totals.good + totals.damaged))} of good + damaged · not saleable`
        : 'Not saleable',
    },
    {
      label: 'Warehouses',
      value: fmt(totals.warehouses),
      note: `${fmt(totals.products)} products tracked`,
    },
  ]
  return (
    <section aria-label="Inventory summary"
      className="bg-line border border-line rounded-lg grid gap-px grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 overflow-hidden shadow-[0_1px_2px_rgba(43,29,24,0.04)]">
      {cells.map((c) => (
        <div key={c.label} title={c.title} className="bg-white px-4 py-3.5">
          <p className="text-xs text-mute flex items-center gap-1.5">{c.dot && <Dot color={c.dot} />}{c.label}</p>
          <p className="mt-1 text-[22px] leading-7 font-semibold text-charcoal tracking-tight">{c.value}</p>
          <p className="text-[11px] text-faint mt-0.5 leading-snug">{c.note}</p>
        </div>
      ))}
    </section>
  )
}

// ── Warehouse distribution: one bar per warehouse (good units) ──
export function WarehouseDistribution({ model, onOpenWarehouse, compact }) {
  const { warehouses, isAdmin } = model
  const max = Math.max(1, ...warehouses.map(w => w.good))
  const list = compact ? warehouses.slice(0, 8) : warehouses
  return (
    <Panel title="Warehouse distribution"
      subtitle={isAdmin ? 'Good (saleable) units held in each warehouse, with its share of company stock' : 'Good (saleable) units in your warehouses'}
      action={compact && onOpenWarehouse && <LinkButton onClick={() => onOpenWarehouse(null)}>All warehouses</LinkButton>}
      bodyClass="py-1">
      {list.length === 0 ? (
        <EmptyNote icon={<Warehouse size={18} />} title="No warehouses yet">Add warehouses in Settings → Warehouses.</EmptyNote>
      ) : (
        <ul className="divide-y divide-line">
          {list.map((w, i) => (
            <li key={w.id} className={compact && i >= 5 ? 'max-md:hidden' : ''}>
              <button onClick={() => onOpenWarehouse?.(w.id)}
                className="w-full text-left px-4 py-3 hover:bg-ivory grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(150px,1.1fr)_minmax(0,2fr)_auto] items-center gap-x-4 gap-y-1.5">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-charcoal truncate">{w.name}</p>
                  <p className="text-[11px] text-faint">{w.state}{w.products ? ` · ${w.products} product${w.products === 1 ? '' : 's'}` : ''}</p>
                </div>
                <div className="order-3 md:order-none col-span-2 md:col-span-1 flex items-center gap-3">
                  <div className="flex-1"><Bar value={w.good} max={max} /></div>
                  {isAdmin && <span className="w-10 text-right text-xs font-semibold text-charcoal tnum">{pct(w.share)}</span>}
                </div>
                <div className="text-right">
                  <p className="text-[13px] font-semibold text-charcoal tnum">{fmt(w.good)} <span className="text-[11px] font-normal text-faint">good</span></p>
                  <p className="text-[11px] text-faint tnum">
                    {w.damaged > 0 ? <span className="text-bad">{fmt(w.damaged)} damaged</span> : '0 damaged'}
                    {isAdmin && <> · {nairaCompact(w.value)}</>}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

// ── Stock condition: good vs damaged (inspection shown apart) ──
export function ConditionPanel({ model, showWarehouses = true, compact = false }) {
  const { totals, warehouses, isAdmin, products } = model
  const base = totals.good + totals.damaged
  const elsewhere = products.reduce((a, p) => a + p.damagedElsewhere, 0)
  return (
    <Panel title="Stock condition" subtitle="Saleable stock and damaged stock are counted separately">
      {isAdmin && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-mute flex items-center gap-1.5"><Dot color={COLORS.good} />Good</p>
              <p className="text-[22px] leading-7 font-semibold text-charcoal">{fmt(totals.good)}</p>
              <p className="text-[11px] text-faint">{base ? pct(totals.good / base) : '—'} of good + damaged</p>
            </div>
            <div>
              <p className="text-xs text-mute flex items-center gap-1.5"><Dot color={COLORS.bad} />Damaged</p>
              <p className="text-[22px] leading-7 font-semibold text-charcoal">{fmt(totals.damaged)}</p>
              <p className="text-[11px] text-faint">{base ? pct(totals.damaged / base) : '—'} of good + damaged</p>
            </div>
          </div>
          <div className="mt-3">
            <SegmentBar height={10} parts={[
              { label: 'Good', value: totals.good, color: COLORS.good },
              { label: 'Awaiting inspection', value: totals.inspection, color: COLORS.inspection },
              { label: 'Damaged', value: totals.damaged, color: COLORS.bad },
            ]} />
          </div>
          <div className="mt-2">
            <Legend items={[
              { label: 'Good', color: COLORS.good },
              ...(totals.inspection ? [{ label: 'Awaiting inspection', color: COLORS.inspection, value: fmt(totals.inspection) }] : []),
              { label: 'Damaged', color: COLORS.bad },
            ]} />
          </div>
        </>
      )}
      {showWarehouses && (
        <div className={`${isAdmin ? 'mt-4 pt-3 border-t border-line' : ''} ${compact && isAdmin ? 'hidden lg:block' : ''}`}>
          <p className="text-[11px] uppercase tracking-wide text-faint mb-2">By warehouse</p>
          <ul className="space-y-2.5">
            {warehouses.filter(w => w.good + w.damaged + w.inspection > 0).map(w => (
              <li key={w.id}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-charcoal font-medium truncate">{w.name}</span>
                  <span className="text-mute tnum shrink-0"><span className="text-good font-semibold">{fmt(w.good)}</span> good · <span className={w.damaged ? 'text-bad font-semibold' : ''}>{fmt(w.damaged)}</span> damaged</span>
                </div>
                <SegmentBar height={6} parts={[
                  { label: 'Good', value: w.good, color: COLORS.good },
                  { label: 'Awaiting inspection', value: w.inspection, color: COLORS.inspection },
                  { label: 'Damaged', value: w.damaged, color: COLORS.bad },
                ]} />
              </li>
            ))}
            {elsewhere > 0 && (
              <li className="text-xs text-mute flex justify-between">
                <span>Damaged outside a warehouse (transit, park, delivery)</span>
                <span className="text-bad font-semibold tnum">{fmt(elsewhere)}</span>
              </li>
            )}
            {warehouses.every(w => w.good + w.damaged + w.inspection === 0) && elsewhere === 0 && (
              <li className="text-xs text-faint">No stock recorded yet.</li>
            )}
          </ul>
        </div>
      )}
    </Panel>
  )
}

// One shipment line: product + origin → destination
export function TransitLine({ t, onClick }) {
  return (
    <button onClick={onClick} className="w-full text-left px-4 py-3 hover:bg-ivory flex items-center gap-3">
      <ProductThumb src={t.image_url} name={t.name} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] font-semibold text-charcoal truncate">{t.name}</p>
          <p className="text-[13px] font-semibold text-charcoal tnum shrink-0">{fmt(t.quantity)} <span className="text-[11px] font-normal text-faint">units</span></p>
        </div>
        <p className="mt-0.5 text-xs text-mute flex items-center gap-1.5 min-w-0">
          <span className="truncate">{t.from}</span>
          <ArrowRight size={12} className="text-brand shrink-0" />
          <span className="truncate">{t.to}</span>
        </p>
        <p className="text-[11px] text-faint truncate">
          {[t.variant, t.sku ? `SKU ${t.sku}` : null, t.reference, t.dispatchedAt ? `Sent ${formatDate(t.dispatchedAt)}` : null].filter(Boolean).join(' · ')}
        </p>
      </div>
    </button>
  )
}

export function OverviewSection({ model, search, onOpenProduct, onGo }) {
  const { isAdmin, transit, products, warehouses } = model
  const alerts = []
  for (const p of products) {
    for (const w of warehouses) {
      const x = p.perWarehouse[w.id]
      if (!x?.row) continue
      if (x.good <= 0) alerts.push({ p, w, x, kind: 'out' })
      else if (x.good <= x.threshold) alerts.push({ p, w, x, kind: 'low' })
    }
  }
  alerts.sort((a, b) => (a.kind === 'out' ? -1 : 1) - (b.kind === 'out' ? -1 : 1) || a.x.good - b.x.good)

  return (
    <div className="space-y-4">
      {isAdmin && <SummaryStrip model={model} />}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <WarehouseDistribution model={model} compact onOpenWarehouse={(id) => onGo('warehouses', id)} />
        </div>
        <ConditionPanel model={model} compact />
      </div>

      <ProductsTable model={model} search={search} onOpen={onOpenProduct} limit={12}
        title="Product stock" onViewAll={() => onGo('products')} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Currently in transit" subtitle="Products on the road and where they are going"
          action={<LinkButton onClick={() => onGo('transit')}>All transit</LinkButton>} bodyClass="">
          {transit.length === 0 ? (
            <EmptyNote icon={<Truck size={18} />} title="Nothing in transit" />
          ) : (
            <ul className="divide-y divide-line">
              {transit.slice(0, 5).map((t, i) => <li key={t.id} className={i >= 3 ? 'max-md:hidden' : ''}><TransitLine t={t} onClick={() => onGo('transit')} /></li>)}
            </ul>
          )}
        </Panel>
        <Panel title="Stock alerts" subtitle="Warehouse lines at or below their low-stock level"
          action={<LinkButton onClick={() => onGo('alerts')}>All alerts</LinkButton>} bodyClass="">
          {alerts.length === 0 ? (
            <EmptyNote icon={<AlertTriangle size={18} />} title="No stock alerts">Every product is above its low-stock level.</EmptyNote>
          ) : (
            <ul className="divide-y divide-line">
              {alerts.slice(0, 5).map((a, i) => (
                <li key={`${a.p.key}-${a.w.id}`} className={i >= 3 ? 'max-md:hidden' : ''}>
                  <button onClick={() => onOpenProduct(a.p)} className="w-full text-left px-4 py-3 hover:bg-ivory flex items-center gap-3">
                    <ProductThumb src={a.p.image_url} name={a.p.name} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-charcoal truncate">{a.p.name}</p>
                      <p className="text-[11px] text-faint">{a.w.name} · alert level {fmt(a.x.threshold)}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[13px] font-semibold tnum text-charcoal">{fmt(a.x.good)}</p>
                      {a.kind === 'out' ? <Tag tone="bad">Out of stock</Tag> : <Tag tone="warn">Low</Tag>}
                    </div>
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
