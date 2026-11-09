import { useMemo, useState } from 'react'
import { Package } from 'lucide-react'
import {
  Panel, ProductThumb, ToolSelect, Segmented, SortTh, Tag, Dot, EmptyNote, LinkButton,
  fmt, naira, COLORS,
} from './ui'
import { VariantSummary } from './VariantFields'

// Colours/sizes to show for a row (one warehouse, or every warehouse)
const variantsFor = (p, warehouseId) => warehouseId
  ? { variants: p.perWarehouse[warehouseId]?.variants || [], unassigned: p.perWarehouse[warehouseId]?.unassigned || 0 }
  : { variants: p.variants, unassigned: p.unassigned }

// Figures for a product, optionally limited to one warehouse
function figuresFor(p, warehouseId) {
  if (!warehouseId) return { good: p.good, inspection: p.inspection, damaged: p.damaged, transit: p.transit, total: p.total, value: p.value }
  const x = p.perWarehouse[warehouseId] || { good: 0, inspection: 0, damaged: 0 }
  const transit = p.transitItems
    .filter(t => t.raw?.from_warehouse_id === warehouseId || t.raw?.to_warehouse_id === warehouseId || t.raw?.destination_warehouse_id === warehouseId)
    .reduce((a, t) => a + t.quantity, 0)
  return {
    good: x.good, inspection: x.inspection, damaged: x.damaged, transit,
    total: x.good + x.inspection + x.damaged + transit,
    value: p.cost != null ? x.good * p.cost : null,
  }
}

const STATUS_FILTERS = [
  { value: '', label: 'All stock' },
  { value: 'low', label: 'Low stock' },
  { value: 'out', label: 'Out of stock' },
  { value: 'damaged', label: 'Has damaged' },
  { value: 'transit', label: 'In transit' },
]

export function ProductsTable({
  model, search, onOpen, limit, title = 'Product stock', subtitle, onViewAll,
  initialWarehouse = '', initialStatus = '', defaultView = 'warehouses',
}) {
  const { products, warehouses, isAdmin } = model
  const [warehouseId, setWarehouseId] = useState(initialWarehouse)
  const [business, setBusiness] = useState('')
  const [category, setCategory] = useState('')
  const [status, setStatus] = useState(initialStatus)
  const [view, setView] = useState(defaultView)
  const [sort, setSort] = useState({ key: isAdmin ? 'value' : 'total', dir: 'desc' })
  // The overview shows fewer rows on phones so the page stays short
  const isPhone = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 767px)').matches
  const [shown, setShown] = useState(limit ? (isPhone ? Math.min(limit, 5) : limit) : 50)

  const businesses = useMemo(() =>
    [...new Map(products.filter(p => p.business_id).map(p => [p.business_id, p.business || 'Business'])).entries()]
  , [products])
  const categories = useMemo(() => [...new Set(products.map(p => p.category).filter(Boolean))].sort(), [products])
  // Warehouse columns: those holding any stock, biggest first
  const whCols = useMemo(() => warehouses.filter(w => w.good + w.damaged + w.inspection > 0 || warehouses.length <= 6), [warehouses])

  const rows = useMemo(() => {
    let l = products.map(p => ({ p, f: figuresFor(p, warehouseId) }))
    if (search) {
      const q = search.toLowerCase()
      l = l.filter(({ p }) => p.name.toLowerCase().includes(q) || (p.sku && String(p.sku).toLowerCase().includes(q)) ||
        (p.rows[0]?.product?.barcode && String(p.rows[0].product.barcode).toLowerCase().includes(q)))
    }
    if (warehouseId) l = l.filter(({ f }) => f.total > 0 || f.good > 0)
    if (business) l = l.filter(({ p }) => p.business_id === business)
    if (category) l = l.filter(({ p }) => p.category === category)
    if (status === 'low') l = l.filter(({ p, f }) => warehouseId
      ? (p.perWarehouse[warehouseId]?.row && f.good > 0 && f.good <= p.perWarehouse[warehouseId].threshold) : p.isLow)
    if (status === 'out') l = l.filter(({ p, f }) => warehouseId ? (p.perWarehouse[warehouseId]?.row && f.good <= 0) : p.isOut)
    if (status === 'damaged') l = l.filter(({ f }) => f.damaged > 0)
    if (status === 'transit') l = l.filter(({ f }) => f.transit > 0)
    const dir = sort.dir === 'asc' ? 1 : -1
    const val = ({ p, f }) => {
      if (sort.key === 'name') return p.name.toLowerCase()
      if (sort.key.startsWith('wh:')) return p.perWarehouse[sort.key.slice(3)]?.good || 0
      if (sort.key === 'value') return f.value ?? -1
      return f[sort.key] || 0
    }
    return [...l].sort((a, b) => {
      const x = val(a), y = val(b)
      if (x < y) return -dir
      if (x > y) return dir
      return a.p.name.localeCompare(b.p.name)
    })
  }, [products, search, warehouseId, business, category, status, sort])

  const visible = rows.slice(0, shown)
  const byWarehouse = view === 'warehouses' && !warehouseId && whCols.length > 0
  const th = 'text-[11px] uppercase tracking-wide text-faint'

  const toolbar = (
    <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 px-4 py-3 border-b border-line bg-[#FCFBF9]">
      <ToolSelect label="Warehouse" value={warehouseId} onChange={setWarehouseId} className="col-span-2 sm:w-auto">
        <option value="">All warehouses</option>
        {warehouses.map(w => <option key={w.id} value={w.id}>{w.name} · {w.state}</option>)}
      </ToolSelect>
      {businesses.length > 1 && (
        <ToolSelect label="Business" value={business} onChange={setBusiness} className="flex-1 sm:flex-none">
          <option value="">All businesses</option>
          {businesses.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </ToolSelect>
      )}
      {categories.length > 0 && (
        <ToolSelect label="Category" value={category} onChange={setCategory} className="flex-1 sm:flex-none">
          <option value="">All categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </ToolSelect>
      )}
      <ToolSelect label="Stock status" value={status} onChange={setStatus} className="flex-1 sm:flex-none">
        {STATUS_FILTERS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </ToolSelect>
      <div className="md:hidden">
        <ToolSelect label="Sort" value={`${sort.key}|${sort.dir}`} className="w-full"
          onChange={v => { const [key, dir] = v.split('|'); setSort({ key, dir }) }}>
          <option value="name|asc">Name A–Z</option>
          <option value="total|desc">Most units</option>
          <option value="good|desc">Most good stock</option>
          <option value="damaged|desc">Most damaged</option>
          {isAdmin && <option value="value|desc">Highest value</option>}
        </ToolSelect>
      </div>
      <div className="hidden md:block ml-auto">
        <Segmented value={view} onChange={setView} size="sm" options={[
          { value: 'warehouses', label: 'By warehouse' },
          { value: 'summary', label: 'Condition & value' },
        ]} />
      </div>
    </div>
  )

  return (
    <Panel title={title} subtitle={subtitle || `${fmt(rows.length)} product${rows.length === 1 ? '' : 's'}${warehouseId ? ` in ${warehouses.find(w => w.id === warehouseId)?.name || 'warehouse'}` : ''}`}
      action={onViewAll && <LinkButton onClick={onViewAll}>All products</LinkButton>} bodyClass="">
      {toolbar}
      {rows.length === 0 ? (
        <EmptyNote icon={<Package size={18} />} title={search || status || warehouseId || category ? 'No products match' : 'No stock recorded yet'}>
          {search || status || warehouseId || category ? 'Try clearing a filter or the search.' : 'Use Record Stock to add the first delivery from a supplier.'}
        </EmptyNote>
      ) : (
        <>
          {/* Desktop / tablet table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-[13px] border-collapse">
              <thead className="bg-white sticky top-0 z-10">
                <tr className={`${th} border-b border-line`}>
                  <SortTh label="Product" k="name" sort={sort} setSort={setSort} align="left" className="pl-4 min-w-[240px]" />
                  {byWarehouse ? (
                    <>
                      {whCols.map(w => <SortTh key={w.id} label={w.name} k={`wh:${w.id}`} sort={sort} setSort={setSort} className="whitespace-nowrap" />)}
                      <SortTh label="In transit" k="transit" sort={sort} setSort={setSort} className="whitespace-nowrap" />
                      <SortTh label="Damaged" k="damaged" sort={sort} setSort={setSort} />
                    </>
                  ) : (
                    <>
                      <SortTh label="Good" k="good" sort={sort} setSort={setSort} />
                      <SortTh label="Damaged" k="damaged" sort={sort} setSort={setSort} />
                      <SortTh label="In transit" k="transit" sort={sort} setSort={setSort} className="whitespace-nowrap" />
                    </>
                  )}
                  <SortTh label="Total" k="total" sort={sort} setSort={setSort} />
                  {isAdmin && <SortTh label="Value" k="value" sort={sort} setSort={setSort} className="pr-4" />}
                </tr>
              </thead>
              <tbody>
                {visible.map(({ p, f }) => (
                  <tr key={p.key} onClick={() => onOpen(p)}
                    className="border-b border-line last:border-0 hover:bg-ivory cursor-pointer">
                    <td className="pl-4 pr-3 py-2.5">
                      <div className="flex items-center gap-3 min-w-0">
                        <ProductThumb src={p.image_url} name={p.name} />
                        <div className="min-w-0">
                          <p className="font-semibold text-charcoal truncate max-w-[320px]">{p.name}</p>
                          <p className="text-[11px] text-faint truncate">
                            {[p.sku ? `SKU ${p.sku}` : null, p.category].filter(Boolean).join(' · ') || '—'}
                          </p>
                          <VariantSummary {...variantsFor(p, warehouseId)} className="truncate max-w-[320px]" />
                        </div>
                        {p.isOut && <Tag tone="bad">Out</Tag>}
                        {p.isLow && <Tag tone="warn">Low</Tag>}
                      </div>
                    </td>
                    {byWarehouse ? (
                      <>
                        {whCols.map(w => {
                          const x = p.perWarehouse[w.id]
                          return (
                            <td key={w.id} className="px-3 py-2.5 text-right tnum">
                              {x?.row ? (
                                <span className={x.good <= 0 ? 'text-bad font-semibold' : x.good <= x.threshold ? 'text-brand-ink font-semibold' : 'text-charcoal'}>{fmt(x.good)}</span>
                              ) : <span className="text-[#CFC7BD]">—</span>}
                            </td>
                          )
                        })}
                        <td className="px-3 py-2.5 text-right tnum">{f.transit ? fmt(f.transit) : <span className="text-[#CFC7BD]">—</span>}</td>
                        <td className="px-3 py-2.5 text-right tnum">{f.damaged ? <span className="text-bad">{fmt(f.damaged)}</span> : <span className="text-[#CFC7BD]">—</span>}</td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2.5 text-right tnum font-semibold text-good">{fmt(f.good)}
                          {f.inspection > 0 && <span className="block text-[10px] font-normal text-faint">+{fmt(f.inspection)} inspection</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right tnum">{f.damaged ? <span className="text-bad">{fmt(f.damaged)}</span> : <span className="text-[#CFC7BD]">0</span>}</td>
                        <td className="px-3 py-2.5 text-right tnum">{f.transit ? fmt(f.transit) : <span className="text-[#CFC7BD]">0</span>}</td>
                      </>
                    )}
                    <td className="px-3 py-2.5 text-right tnum font-semibold text-charcoal">{fmt(f.total)}</td>
                    {isAdmin && (
                      <td className="pl-3 pr-4 py-2.5 text-right tnum whitespace-nowrap">
                        {f.value == null ? <span className="text-[11px] text-faint">No cost price</span> : naira(f.value)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: compact product rows */}
          <ul className="md:hidden divide-y divide-line">
            {visible.map(({ p, f }) => (
              <li key={p.key}>
                <button onClick={() => onOpen(p)} className="w-full text-left px-4 py-3 flex gap-3 active:bg-ivory">
                  <ProductThumb src={p.image_url} name={p.name} size={44} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[13px] font-semibold text-charcoal leading-snug line-clamp-2">{p.name}</p>
                      <div className="text-right shrink-0">
                        <p className="text-[15px] font-semibold text-charcoal tnum leading-none">{fmt(f.total)}</p>
                        <p className="text-[10px] text-faint mt-0.5">total</p>
                      </div>
                    </div>
                    <p className="text-[11px] text-faint truncate">{[p.sku ? `SKU ${p.sku}` : null, p.category].filter(Boolean).join(' · ') || '—'}</p>
                    <VariantSummary {...variantsFor(p, warehouseId)} limit={3} className="truncate" />
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-mute">
                      <span className="inline-flex items-center gap-1"><Dot color={COLORS.good} />Good <b className="text-charcoal tnum">{fmt(f.good)}</b></span>
                      {f.damaged > 0 && <span className="inline-flex items-center gap-1"><Dot color={COLORS.bad} />Damaged <b className="text-charcoal tnum">{fmt(f.damaged)}</b></span>}
                      {f.transit > 0 && <span className="inline-flex items-center gap-1"><Dot color={COLORS.transit} />Transit <b className="text-charcoal tnum">{fmt(f.transit)}</b></span>}
                      {p.isOut && <Tag tone="bad">Out</Tag>}
                      {p.isLow && <Tag tone="warn">Low</Tag>}
                    </div>
                    {!warehouseId && view === 'warehouses' && (
                      <p className="mt-1 text-[11px] text-faint truncate">
                        {whCols.filter(w => p.perWarehouse[w.id]?.good > 0).map(w => `${w.name} ${fmt(p.perWarehouse[w.id].good)}`).join(' · ') || 'Not on any shelf'}
                      </p>
                    )}
                    {isAdmin && f.value != null && <p className="mt-0.5 text-[11px] text-mute tnum">{naira(f.value)}</p>}
                  </div>
                </button>
              </li>
            ))}
          </ul>

          {rows.length > shown && (
            <div className="border-t border-line px-4 py-2.5 flex items-center justify-between">
              <p className="text-xs text-mute">Showing {fmt(shown)} of {fmt(rows.length)}</p>
              {onViewAll && limit
                ? <LinkButton onClick={onViewAll}>View all products</LinkButton>
                : <button onClick={() => setShown(s => s + 50)} className="text-xs font-semibold text-brand-ink">Show 50 more</button>}
            </div>
          )}
        </>
      )}
    </Panel>
  )
}
