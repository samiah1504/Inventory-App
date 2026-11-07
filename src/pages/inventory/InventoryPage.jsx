import { useState, useMemo, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, ArrowLeftRight, Search, WifiOff, Eye, X } from 'lucide-react'
import {
  useAddStock, useAdjustStock, useSetMinStock, useTransferStock,
} from '../../hooks/useInventory'
import { useMarkDamagedFromStock } from '../../hooks/useStockFlow'
import { useInventoryModel } from '../../hooks/useInventoryModel'
import { useBusinesses, useProducts } from '../../hooks/useBusinesses'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { Input, Select, Textarea } from '../../components/ui/Input'
import { useAppStore } from '../../stores/appStore'
import { OverviewSection } from './OverviewSection'
import { ProductsTable } from './ProductsTable'
import { WarehousesSection } from './WarehousesSection'
import { TransitSection } from './TransitSection'
import { ConditionSection } from './ConditionSection'
import { MovementsSection } from './MovementsSection'
import { AlertsSection } from './AlertsSection'
import { StockTakeTab } from './StockTakeTab'
import { ProductDetail } from './ProductDetail'
import { Btn, fmt } from './ui'

const SECTIONS = [
  { key: 'overview', label: 'Overview' },
  { key: 'products', label: 'Products' },
  { key: 'warehouses', label: 'Warehouses' },
  { key: 'transit', label: 'Transfers & In Transit' },
  { key: 'condition', label: 'Stock Condition' },
  { key: 'movements', label: 'Stock Movements' },
  { key: 'alerts', label: 'Stock Alerts' },
  { key: 'count', label: 'Stock Take' },
]

// Old links (?tab=stock, ?tab=damaged, ?filter=low_stock …) still land
// in the right place
function resolveTab(params) {
  const t = params.get('tab')
  if (params.get('filter') === 'low_stock') return { tab: 'alerts' }
  const legacy = {
    stock: { tab: 'overview' },
    transfers: { tab: 'transit', sub: 'transfers' },
    park: { tab: 'transit', sub: 'park' },
    damaged: { tab: 'condition', sub: 'damaged' },
    returns: { tab: 'condition', sub: 'returns' },
  }
  if (legacy[t]) return legacy[t]
  return { tab: SECTIONS.some(s => s.key === t) ? t : 'overview', sub: params.get('view') || undefined }
}

const today = () => new Date().toISOString().split('T')[0]
const emptyStock = () => ({ product_id: '', warehouse_id: '', business_id: '', quantity: '', unit_cost: '', supplier: '', notes: '', date: today() })
const emptyTransfer = () => ({ product_id: '', from_warehouse_id: '', to_warehouse_id: '', quantity: '', notes: '', date: today() })

export function InventoryPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initial = resolveTab(searchParams)
  const [tab, setTabState] = useState(initial.tab)
  const [sub, setSub] = useState(initial.sub)
  const [search, setSearch] = useState('')
  const [warehouseId, setWarehouseId] = useState(searchParams.get('warehouse') || '')
  const [openKey, setOpenKey] = useState(null)

  const { showToast, isOnline } = useAppStore()
  const model = useInventoryModel()
  const { canEdit, isAdmin, limited } = model
  const readOnly = !canEdit
  const { data: businesses } = useBusinesses()
  const { data: products } = useProducts()

  const addStock = useAddStock()
  const adjustStock = useAdjustStock()
  const setMinStock = useSetMinStock()
  const transferStock = useTransferStock()
  const markDamaged = useMarkDamagedFromStock()

  const [showAdd, setShowAdd] = useState(false)
  const [showTransfer, setShowTransfer] = useState(false)
  const [adjustRow, setAdjustRow] = useState(null)
  const [damageRow, setDamageRow] = useState(null)
  const [minProduct, setMinProduct] = useState(null)
  const [stockForm, setStockForm] = useState(emptyStock)
  const [transferForm, setTransferForm] = useState(emptyTransfer)
  const [adjustForm, setAdjustForm] = useState({ adjustment: '', reason: '' })
  const [damageForm, setDamageForm] = useState({ quantity: '', reason: '' })
  const [minForm, setMinForm] = useState('')

  function go(next, extra) {
    setTabState(next)
    setSub(next === 'transit' || next === 'condition' ? extra : undefined)
    if (next === 'warehouses' && extra) setWarehouseId(extra)
    const p = { tab: next }
    if (next === 'warehouses' && extra) p.warehouse = extra
    setSearchParams(p, { replace: true })
    document.getElementById('inv-scroll')?.scrollTo({ top: 0 })
  }
  // Normalise old dashboard links (?filter=low_stock, ?tab=stock) in the URL
  useEffect(() => {
    if (searchParams.get('tab') !== tab) setSearchParams({ tab }, { replace: true })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const openProduct = useMemo(() => model.products.find(p => p.key === openKey) || null, [model.products, openKey])
  const whOptions = model.warehouses

  // ── Handlers (same mutations as before the redesign) ──
  async function handleAddStock() {
    if (!stockForm.product_id || !stockForm.warehouse_id || !stockForm.quantity) {
      showToast('Fill in required fields', 'error'); return
    }
    try {
      await addStock.mutateAsync({ ...stockForm, quantity: Number(stockForm.quantity), unit_cost: Number(stockForm.unit_cost) || 0 })
      setShowAdd(false); setStockForm(emptyStock())
    } catch { /* toast shown */ }
  }
  async function handleAdjust() {
    const adj = Number(adjustForm.adjustment)
    if (!adj || !adjustForm.reason.trim()) { showToast('Enter adjustment amount and reason', 'error'); return }
    try {
      await adjustStock.mutateAsync({
        inventory_id: adjustRow.id, product_id: adjustRow.product_id, warehouse_id: adjustRow.warehouse_id,
        business_id: adjustRow.business_id, adjustment: adj, reason: adjustForm.reason,
      })
      setAdjustRow(null); setAdjustForm({ adjustment: '', reason: '' })
    } catch { /* toast shown */ }
  }
  async function handleTransfer() {
    if (!transferForm.product_id || !transferForm.from_warehouse_id || !transferForm.to_warehouse_id || !transferForm.quantity) {
      showToast('Fill in required fields', 'error'); return
    }
    const prod = (products || []).find(p => p.id === transferForm.product_id)
    try {
      await transferStock.mutateAsync({ ...transferForm, product_name: prod?.name || 'Unknown', quantity: Number(transferForm.quantity) })
      setShowTransfer(false); setTransferForm(emptyTransfer())
    } catch { /* toast shown */ }
  }
  async function handleMarkDamaged() {
    const qty = Number(damageForm.quantity)
    if (!qty || qty <= 0 || !damageForm.reason.trim()) { showToast('Enter how many are damaged and why', 'error'); return }
    try {
      await markDamaged.mutateAsync({ row: damageRow, quantity: qty, reason: damageForm.reason.trim() })
      setDamageRow(null); setDamageForm({ quantity: '', reason: '' })
    } catch { /* toast shown */ }
  }
  async function handleSetMin() {
    const threshold = Number(minForm)
    if (!minProduct || isNaN(threshold) || threshold < 0) { showToast('Enter a valid minimum stock level', 'error'); return }
    try {
      await setMinStock.mutateAsync({ product_id: minProduct.product_id, threshold })
      setMinProduct(null); setMinForm('')
    } catch { /* toast shown */ }
  }

  const onOpenProduct = (p) => setOpenKey(p.key)
  const onAdjust = (row) => { setAdjustRow(row); setAdjustForm({ adjustment: '', reason: '' }) }
  const onDamage = (row) => { setDamageRow(row); setDamageForm({ quantity: '', reason: '' }) }
  const onEditThreshold = (p) => { setMinProduct(p); setMinForm(String(p.minThreshold)) }
  const rowName = (row) => model.products.find(p => p.product_id === row?.product_id)?.name || row?.product?.name || 'Product'
  const rowWarehouse = (row) => model.warehouses.find(w => w.id === row?.warehouse_id)

  return (
    <div className="flex flex-col h-full w-full overflow-x-hidden bg-ivory text-charcoal">
      {/* ── Header ── */}
      <header className="bg-white border-b border-line safe-area-top">
        <div className="mx-auto max-w-[1440px] px-4 lg:px-8 pt-4 lg:pt-6 pb-3">
          <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
            <div className="min-w-0 flex-1 basis-64">
              <div className="flex items-center gap-2">
                <h1 className="text-xl lg:text-[22px] font-semibold tracking-tight text-charcoal">Inventory</h1>
                {readOnly && <span className="inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[11px] font-semibold text-mute"><Eye size={12} />View only</span>}
                {!isOnline && <span className="inline-flex items-center gap-1 rounded border border-[#F0DFAE] bg-brand-wash px-1.5 py-0.5 text-[11px] font-semibold text-brand-ink"><WifiOff size={12} />Offline</span>}
              </div>
              <p className="text-[13px] text-mute mt-0.5">
                Monitor stock levels, warehouse distribution and inventory condition.
                {limited && <> Showing your {fmt(model.warehouses.length)} assigned warehouse{model.warehouses.length === 1 ? '' : 's'}.</>}
              </p>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <label className="relative flex-1 sm:w-72">
                <span className="sr-only">Search inventory</span>
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search product, SKU or barcode"
                  className="h-9 w-full rounded-md border border-line-strong bg-white pl-9 pr-8 text-[13px] placeholder:text-faint focus:outline-none focus:border-brand" />
                {search && (
                  <button onClick={() => setSearch('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-faint hover:text-charcoal"><X size={14} /></button>
                )}
              </label>
              {canEdit && (
                <>
                  <Btn variant="secondary" onClick={() => setShowTransfer(true)} className="max-sm:px-2.5" title="Stock transfer" aria-label="Stock transfer">
                    <ArrowLeftRight size={15} /><span className="hidden sm:inline">Stock Transfer</span>
                  </Btn>
                  <Btn variant="primary" onClick={() => setShowAdd(true)} className="max-sm:px-2.5" title="Record stock" aria-label="Record stock">
                    <Plus size={15} /><span className="hidden sm:inline">Record Stock</span>
                  </Btn>
                </>
              )}
            </div>
          </div>
        </div>
        {/* Section navigation */}
        <nav aria-label="Inventory sections" className="mx-auto max-w-[1440px] px-2 lg:px-6 overflow-x-auto no-scrollbar">
          <ul className="flex gap-1 min-w-max">
            {SECTIONS.map(s => (
              <li key={s.key}>
                <button onClick={() => go(s.key)} aria-current={tab === s.key ? 'page' : undefined}
                  className={`relative px-2.5 py-2.5 text-[13px] font-medium whitespace-nowrap transition-colors ${
                    tab === s.key ? 'text-charcoal' : 'text-mute hover:text-charcoal'}`}>
                  {s.label}
                  {s.key === 'alerts' && model.totals.out + model.totals.low > 0 && (
                    <span className="ml-1.5 rounded bg-bad-wash px-1 text-[11px] font-semibold text-bad tnum">{model.totals.out + model.totals.low}</span>
                  )}
                  {s.key === 'transit' && model.transit.length > 0 && (
                    <span className="ml-1.5 rounded bg-brand-wash px-1 text-[11px] font-semibold text-brand-ink tnum">{model.transit.length}</span>
                  )}
                  <span className={`absolute left-2 right-2 bottom-0 h-[2px] rounded-full ${tab === s.key ? 'bg-brand' : 'bg-transparent'}`} />
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      {/* ── Content ── */}
      <div id="inv-scroll" className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="mx-auto max-w-[1440px] px-4 lg:px-8 py-4 lg:py-6">
          {model.isLoading ? (
            <div className="space-y-4">
              <div className="h-24 shimmer rounded-lg" />
              <div className="grid gap-4 lg:grid-cols-3"><div className="h-64 shimmer rounded-lg lg:col-span-2" /><div className="h-64 shimmer rounded-lg" /></div>
              <div className="h-80 shimmer rounded-lg" />
            </div>
          ) : (
            <>
              {tab === 'overview' && <OverviewSection model={model} search={search} onOpenProduct={onOpenProduct} onGo={go} />}
              {tab === 'products' && <ProductsTable model={model} search={search} onOpen={onOpenProduct} title="All products" />}
              {tab === 'warehouses' && (
                <WarehousesSection model={model} search={search} selectedId={warehouseId}
                  onSelect={(id) => { setWarehouseId(id); setSearchParams({ tab: 'warehouses', warehouse: id }, { replace: true }) }}
                  onOpenProduct={onOpenProduct} />
              )}
              {tab === 'transit' && <TransitSection key={sub || 'transit'} model={model} search={search} canEdit={canEdit} initialView={sub || 'transit'} />}
              {tab === 'condition' && <ConditionSection key={sub || 'summary'} model={model} search={search} canEdit={canEdit} onOpenProduct={onOpenProduct} initialView={sub || 'summary'} />}
              {tab === 'movements' && <MovementsSection model={model} search={search} />}
              {tab === 'alerts' && <AlertsSection model={model} search={search} canEdit={canEdit} onOpenProduct={onOpenProduct} onEditThreshold={onEditThreshold} onGo={go} />}
              {tab === 'count' && <div className="max-w-3xl"><StockTakeTab canCount={canEdit} /></div>}
            </>
          )}
          {!isAdmin && !model.isLoading && (
            <p className="mt-6 text-[11px] text-faint">Company-wide totals and inventory value are visible to the CEO only.</p>
          )}
        </div>
      </div>

      {openProduct && (
        <ProductDetail product={openProduct} model={model} canEdit={canEdit} onClose={() => setOpenKey(null)}
          onAdjust={onAdjust} onDamage={onDamage} onEditThreshold={onEditThreshold} />
      )}

      {/* ── Record stock ── */}
      <Modal isOpen={showAdd} onClose={() => setShowAdd(false)} title="Record Stock"
        footer={<div className="flex gap-3">
          <Button variant="secondary" onClick={() => setShowAdd(false)} className="flex-1">Cancel</Button>
          <Button onClick={handleAddStock} loading={addStock.isPending} className="flex-1">Record Stock</Button>
        </div>}>
        <div className="space-y-4">
          <Select label="Business" value={stockForm.business_id} onChange={e => setStockForm({ ...stockForm, business_id: e.target.value })}>
            <option value="">Select business...</option>
            {(businesses || []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
          <Select label="Product" required value={stockForm.product_id} onChange={e => setStockForm({ ...stockForm, product_id: e.target.value })}>
            <option value="">Select product...</option>
            {(products || []).filter(p => !stockForm.business_id || p.business_id === stockForm.business_id).map(p => (
              <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ''}</option>
            ))}
          </Select>
          <Select label="Warehouse" required value={stockForm.warehouse_id} onChange={e => setStockForm({ ...stockForm, warehouse_id: e.target.value })}>
            <option value="">Select warehouse...</option>
            {whOptions.map(w => <option key={w.id} value={w.id}>{w.name} ({w.state})</option>)}
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Quantity" type="number" inputMode="numeric" required value={stockForm.quantity} onChange={e => setStockForm({ ...stockForm, quantity: e.target.value })} />
            <Input label="Unit Cost (₦)" type="number" inputMode="decimal" value={stockForm.unit_cost} onChange={e => setStockForm({ ...stockForm, unit_cost: e.target.value })} />
          </div>
          <Input label="Date Received" type="date" value={stockForm.date} onChange={e => setStockForm({ ...stockForm, date: e.target.value })} />
          <Input label="Supplier" placeholder="Supplier name" value={stockForm.supplier} onChange={e => setStockForm({ ...stockForm, supplier: e.target.value })} />
          <Textarea label="Notes" rows={2} value={stockForm.notes} onChange={e => setStockForm({ ...stockForm, notes: e.target.value })} />
        </div>
      </Modal>

      {/* ── Stock transfer ── */}
      <Modal isOpen={showTransfer} onClose={() => setShowTransfer(false)} title="Stock Transfer"
        footer={<div className="flex gap-3">
          <Button variant="secondary" onClick={() => setShowTransfer(false)} className="flex-1">Cancel</Button>
          <Button onClick={handleTransfer} loading={transferStock.isPending} className="flex-1">Start Transfer</Button>
        </div>}>
        <div className="space-y-4">
          <Select label="Product" required value={transferForm.product_id} onChange={e => setTransferForm({ ...transferForm, product_id: e.target.value })}>
            <option value="">Select product...</option>
            {(products || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Select label="From Warehouse" required value={transferForm.from_warehouse_id} onChange={e => setTransferForm({ ...transferForm, from_warehouse_id: e.target.value })}>
            <option value="">Select source...</option>
            {whOptions.map(w => <option key={w.id} value={w.id}>{w.name} ({w.state})</option>)}
          </Select>
          {transferForm.product_id && transferForm.from_warehouse_id && (
            <p className="-mt-2 text-xs text-mute">
              {fmt(model.products.find(p => p.product_id === transferForm.product_id)?.perWarehouse[transferForm.from_warehouse_id]?.good || 0)} good units available there
            </p>
          )}
          <Select label="To Warehouse" required value={transferForm.to_warehouse_id} onChange={e => setTransferForm({ ...transferForm, to_warehouse_id: e.target.value })}>
            <option value="">Select destination...</option>
            {whOptions.filter(w => w.id !== transferForm.from_warehouse_id).map(w => <option key={w.id} value={w.id}>{w.name} ({w.state})</option>)}
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Quantity" type="number" inputMode="numeric" required value={transferForm.quantity} onChange={e => setTransferForm({ ...transferForm, quantity: e.target.value })} />
            <Input label="Date" type="date" value={transferForm.date} onChange={e => setTransferForm({ ...transferForm, date: e.target.value })} />
          </div>
          <Textarea label="Notes" rows={2} placeholder="Courier, waybill number, etc." value={transferForm.notes} onChange={e => setTransferForm({ ...transferForm, notes: e.target.value })} />
          <p className="text-xs text-mute">Stock leaves the source warehouse immediately and shows under Transfers & In Transit until it is received.</p>
        </div>
      </Modal>

      {/* ── Adjust ── */}
      <Modal isOpen={!!adjustRow} onClose={() => setAdjustRow(null)} title={adjustRow ? `Adjust Stock — ${rowName(adjustRow)}` : 'Adjust Stock'}
        footer={<div className="flex gap-3">
          <Button variant="secondary" onClick={() => setAdjustRow(null)} className="flex-1">Cancel</Button>
          <Button onClick={handleAdjust} loading={adjustStock.isPending} className="flex-1">Save Adjustment</Button>
        </div>}>
        {adjustRow && (
          <div className="space-y-4">
            <div className="rounded-lg border border-line bg-ivory p-3">
              <p className="text-xs text-mute">Good stock in {rowWarehouse(adjustRow)?.name}</p>
              <p className="text-2xl font-semibold tnum">{fmt(adjustRow.quantity_available)}</p>
            </div>
            <Input label="Adjustment" type="number" inputMode="numeric" placeholder="e.g. +10 or -3"
              value={adjustForm.adjustment} onChange={e => setAdjustForm({ ...adjustForm, adjustment: e.target.value })}
              hint={adjustForm.adjustment && !isNaN(Number(adjustForm.adjustment))
                ? `New quantity: ${Number(adjustRow.quantity_available) + Number(adjustForm.adjustment)}` : 'Positive to add, negative to remove'} />
            <Input label="Reason" required placeholder="e.g. Stocktake correction" value={adjustForm.reason} onChange={e => setAdjustForm({ ...adjustForm, reason: e.target.value })} />
          </div>
        )}
      </Modal>

      {/* ── Mark damaged ── */}
      <Modal isOpen={!!damageRow} onClose={() => setDamageRow(null)} title={damageRow ? `Mark Damaged — ${rowName(damageRow)}` : 'Mark Damaged'}
        footer={<div className="flex gap-3">
          <Button variant="secondary" onClick={() => setDamageRow(null)} className="flex-1">Cancel</Button>
          <Button variant="danger" onClick={handleMarkDamaged} loading={markDamaged.isPending} className="flex-1">Move to Damaged</Button>
        </div>}>
        {damageRow && (
          <div className="space-y-4">
            <div className="rounded-lg border border-line bg-ivory p-3">
              <p className="text-xs text-mute">Good stock in {rowWarehouse(damageRow)?.name}</p>
              <p className="text-2xl font-semibold tnum">{fmt(damageRow.quantity_available)}</p>
            </div>
            <Input label="How many are damaged?" type="number" inputMode="numeric" required value={damageForm.quantity} onChange={e => setDamageForm({ ...damageForm, quantity: e.target.value })} />
            <Input label="What happened?" required placeholder="e.g. Broken leg, water damage" value={damageForm.reason} onChange={e => setDamageForm({ ...damageForm, reason: e.target.value })} />
            <p className="text-xs text-mute">They leave good stock and appear under Stock Condition → Damaged items, where they can be repaired, written off or returned to the supplier.</p>
          </div>
        )}
      </Modal>

      {/* ── Low-stock alert level ── */}
      <Modal isOpen={!!minProduct} onClose={() => setMinProduct(null)} title={minProduct ? `Low Stock Alert — ${minProduct.name}` : 'Low Stock Alert'}
        footer={<div className="flex gap-3">
          <Button variant="secondary" onClick={() => setMinProduct(null)} className="flex-1">Cancel</Button>
          <Button onClick={handleSetMin} loading={setMinStock.isPending} className="flex-1">Save</Button>
        </div>}>
        <Input label="Minimum stock level" type="number" inputMode="numeric" required value={minForm} onChange={e => setMinForm(e.target.value)}
          hint="Applies to this product in every warehouse. A warehouse line shows Low when its good stock falls to or below this number." />
      </Modal>
    </div>
  )
}
