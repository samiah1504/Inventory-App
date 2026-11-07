import { useMemo, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { ConditionPanel } from './OverviewSection'
import { DamagedTab } from './DamagedTab'
import { ReturnsTab } from './ReturnsTab'
import { Panel, Segmented, ProductThumb, SegmentBar, ToolSelect, EmptyNote, SortTh, fmt, pct, COLORS } from './ui'

// Stock condition: good vs damaged per product and per warehouse, plus
// the damaged-items register and customer returns
export function ConditionSection({ model, search, canEdit, onOpenProduct, initialView = 'summary' }) {
  const [view, setView] = useState(initialView)
  return (
    <div className="space-y-4">
      <Segmented value={view} onChange={setView} options={[
        { value: 'summary', label: 'Good vs damaged' },
        { value: 'damaged', label: 'Damaged items' },
        { value: 'returns', label: 'Returns' },
      ]} />
      {view === 'summary' && (
        <div className="grid gap-4 xl:grid-cols-[minmax(320px,4fr)_8fr] items-start">
          <ConditionPanel model={model} />
          <ProductCondition model={model} search={search} onOpenProduct={onOpenProduct} />
        </div>
      )}
      {view === 'damaged' && (
        <Panel title="Damaged items" subtitle="Every damaged item, wherever it was found — never counted as saleable stock">
          <DamagedTab canManage={canEdit} />
        </Panel>
      )}
      {view === 'returns' && (
        <Panel title="Customer returns" subtitle="Returned goods awaiting inspection and their outcomes">
          <ReturnsTab canManage={canEdit} />
        </Panel>
      )}
    </div>
  )
}

function ProductCondition({ model, search, onOpenProduct }) {
  const [warehouseId, setWarehouseId] = useState('')
  const [only, setOnly] = useState('damaged')
  const [sort, setSort] = useState({ key: 'damaged', dir: 'desc' })

  const rows = useMemo(() => {
    let l = model.products.map(p => {
      const x = warehouseId ? (p.perWarehouse[warehouseId] || { good: 0, inspection: 0, damaged: 0 }) : p
      const total = x.good + x.inspection + x.damaged
      return { p, good: x.good, inspection: x.inspection, damaged: x.damaged, total, rate: total ? x.damaged / total : 0 }
    }).filter(r => r.total > 0)
    if (only === 'damaged') l = l.filter(r => r.damaged > 0)
    if (search) {
      const q = search.toLowerCase()
      l = l.filter(r => r.p.name.toLowerCase().includes(q) || (r.p.sku && String(r.p.sku).toLowerCase().includes(q)))
    }
    const dir = sort.dir === 'asc' ? 1 : -1
    return l.sort((a, b) => {
      const x = sort.key === 'name' ? a.p.name.toLowerCase() : a[sort.key]
      const y = sort.key === 'name' ? b.p.name.toLowerCase() : b[sort.key]
      return x < y ? -dir : x > y ? dir : a.p.name.localeCompare(b.p.name)
    })
  }, [model.products, warehouseId, only, search, sort])

  return (
    <Panel title="Condition by product" subtitle="Good, awaiting inspection and damaged units for each product" bodyClass=""
      action={
        <div className="flex gap-2">
          <ToolSelect label="Warehouse" value={warehouseId} onChange={setWarehouseId}>
            <option value="">All warehouses</option>
            {model.warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </ToolSelect>
          <ToolSelect label="Show" value={only} onChange={setOnly}>
            <option value="damaged">With damaged units</option>
            <option value="all">All products</option>
          </ToolSelect>
        </div>
      }>
      {rows.length === 0 ? (
        <EmptyNote icon={<ShieldCheck size={18} />} title={only === 'damaged' ? 'No damaged stock here' : 'No stock recorded'}>
          {only === 'damaged' ? 'Every unit in this view is in good condition.' : ''}
        </EmptyNote>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] min-w-[560px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-faint border-b border-line">
                <SortTh label="Product" k="name" sort={sort} setSort={setSort} align="left" className="pl-4" />
                <SortTh label="Good" k="good" sort={sort} setSort={setSort} />
                <SortTh label="Inspection" k="inspection" sort={sort} setSort={setSort} />
                <SortTh label="Damaged" k="damaged" sort={sort} setSort={setSort} />
                <SortTh label="Total" k="total" sort={sort} setSort={setSort} />
                <th className="px-3 pr-4 py-2.5 font-medium text-left w-[160px]">Condition</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.p.key} onClick={() => onOpenProduct(r.p)} className="border-b border-line last:border-0 hover:bg-ivory cursor-pointer">
                  <td className="pl-4 pr-3 py-2.5">
                    <div className="flex items-center gap-3 min-w-0">
                      <ProductThumb src={r.p.image_url} name={r.p.name} size={32} />
                      <div className="min-w-0">
                        <p className="font-semibold text-charcoal truncate max-w-[260px]">{r.p.name}</p>
                        <p className="text-[11px] text-faint">{r.p.sku ? `SKU ${r.p.sku}` : '—'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right tnum text-good font-semibold">{fmt(r.good)}</td>
                  <td className="px-3 py-2.5 text-right tnum text-mute">{fmt(r.inspection)}</td>
                  <td className="px-3 py-2.5 text-right tnum">{r.damaged ? <span className="text-bad font-semibold">{fmt(r.damaged)}</span> : '0'}</td>
                  <td className="px-3 py-2.5 text-right tnum font-semibold">{fmt(r.total)}</td>
                  <td className="px-3 pr-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="flex-1"><SegmentBar height={6} parts={[
                        { label: 'Good', value: r.good, color: COLORS.good },
                        { label: 'Inspection', value: r.inspection, color: COLORS.inspection },
                        { label: 'Damaged', value: r.damaged, color: COLORS.bad },
                      ]} /></div>
                      <span className="text-[11px] text-mute tnum w-9 text-right">{pct(r.rate)}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-2 text-[11px] text-faint border-t border-line">Percentage = share of the product's units that are damaged.</p>
        </div>
      )}
    </Panel>
  )
}
