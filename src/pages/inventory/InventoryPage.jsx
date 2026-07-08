import { useState, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, Package, Sliders, ChevronDown, ChevronUp, ArrowLeftRight, Bell } from 'lucide-react'
import {
  useInventory, useAddStock, useAdjustStock, useSetMinStock,
  useWarehouseTransfers, useTransferStock, useReceiveTransfer, useProductMovements,
  useReturns,
} from '../../hooks/useInventory'
import { ReturnsTab } from './ReturnsTab'
import { useBusinesses, useProducts, useWarehouses } from '../../hooks/useBusinesses'
import { TopBar } from '../../components/layout/TopBar'
import { SearchBar } from '../../components/ui/SearchBar'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { Input, Select, Textarea } from '../../components/ui/Input'
import { SkeletonList } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'
import { useAuthStore } from '../../stores/authStore'
import { useAppStore } from '../../stores/appStore'
import { formatDate } from '../../utils/format'

const STATUS_FILTERS = [
  { key: '',         label: 'All Stock' },
  { key: 'low',      label: 'Low Stock' },
  { key: 'out',      label: 'Out of Stock' },
  { key: 'reserved', label: 'Reserved' },
  { key: 'damaged',  label: 'Damaged' },
  { key: 'returned', label: 'Returned' },
]

const MOVEMENT_LABELS = {
  purchase:          { label: 'Stock received',      color: 'text-blue-600' },
  sale:              { label: 'Sold',                color: 'text-green-600' },
  reserve:           { label: 'Reserved',            color: 'text-amber-600' },
  release:           { label: 'Released',            color: 'text-gray-600' },
  return:            { label: 'Returned to stock',   color: 'text-orange-500' },
  return_inspection: { label: 'Awaiting inspection', color: 'text-amber-600' },
  repair:            { label: 'Sent for repair',     color: 'text-purple-600' },
  write_off:         { label: 'Written off',         color: 'text-red-600' },
  supplier_return:   { label: 'Returned to supplier', color: 'text-red-500' },
  display_item:      { label: 'Kept as display',     color: 'text-gray-600' },
  return_other:      { label: 'Return closed',       color: 'text-gray-600' },
  damage:            { label: 'Damaged',             color: 'text-red-600' },
  missing:           { label: 'Missing',             color: 'text-red-600' },
  transfer_in:       { label: 'Transfer in',         color: 'text-blue-600' },
  transfer_out:      { label: 'Transfer out',        color: 'text-purple-600' },
  adjustment_in:     { label: 'Adjustment (+)',      color: 'text-gray-600' },
  adjustment_out:    { label: 'Adjustment (−)',      color: 'text-gray-600' },
}

export function InventoryPage() {
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState('stock')
  const [statusFilter, setStatusFilter] = useState(searchParams.get('filter') === 'low_stock' ? 'low' : '')
  const [search, setSearch] = useState('')
  const [selectedWarehouse, setSelectedWarehouse] = useState('')
  const [selectedBusiness, setSelectedBusiness] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  const [expandedProduct, setExpandedProduct] = useState(null)
  const [expandedWarehouse, setExpandedWarehouse] = useState(null)

  const [showAddModal, setShowAddModal] = useState(false)
  const [showAdjustModal, setShowAdjustModal] = useState(false)
  const [showTransferModal, setShowTransferModal] = useState(false)
  const [showMinModal, setShowMinModal] = useState(false)
  const [adjustingItem, setAdjustingItem] = useState(null)
  const [minStockGroup, setMinStockGroup] = useState(null)

  const { user } = useAuthStore()
  const { showToast } = useAppStore()
  const { data: businesses } = useBusinesses()
  const { data: warehouses } = useWarehouses()
  const { data: products } = useProducts()

  const { data: allInventory, isLoading } = useInventory({})
  const { data: transfers } = useWarehouseTransfers()
  const { data: returnsList } = useReturns()
  const addStock = useAddStock()
  const adjustStock = useAdjustStock()
  const setMinStock = useSetMinStock()
  const transferStock = useTransferStock()
  const receiveTransfer = useReceiveTransfer()
  const movementsQ = useProductMovements(expandedProduct)

  const [adjustForm, setAdjustForm] = useState({ adjustment: '', reason: '' })
  const [minForm, setMinForm] = useState('')
  const [stockForm, setStockForm] = useState({
    product_id: '', warehouse_id: '', business_id: '',
    quantity: '', unit_cost: '', supplier: '', notes: '',
    date: new Date().toISOString().split('T')[0],
  })
  const [transferForm, setTransferForm] = useState({
    product_id: '', from_warehouse_id: '', to_warehouse_id: '',
    quantity: '', notes: '', date: new Date().toISOString().split('T')[0],
  })

  const canManage = ['ceo', 'super_admin', 'operations_manager', 'inventory'].includes(user?.role)

  // ── Group inventory rows by product ───────────────────────────────────────

  const productGroups = useMemo(() => {
    const m = {}
    ;(allInventory || []).forEach(r => {
      const key = r.product_id || r.product?.name || r.id
      if (!m[key]) {
        m[key] = {
          key, product_id: r.product_id,
          name: r.product?.name || 'Unknown product',
          business: r.business?.name || null,
          business_id: r.business_id,
          category: r.product?.category?.name || null,
          rows: [],
          available: 0, physical: 0, reserved: 0, sold: 0, returned: 0, damaged: 0,
          inspection: 0, repair: 0,
        }
      }
      const g = m[key]
      g.rows.push(r)
      g.available  += Number(r.quantity_available || 0)
      g.physical   += Number(r.quantity_physical || 0)
      g.reserved   += Number(r.quantity_reserved || 0)
      g.sold       += Number(r.quantity_sold || 0)
      g.returned   += Number(r.quantity_returned || 0)
      g.damaged    += Number(r.quantity_damaged || 0)
      g.inspection += Number(r.quantity_inspection || 0)
      g.repair     += Number(r.quantity_repair || 0)
    })
    return Object.values(m).map(g => ({
      ...g,
      minThreshold: Math.max(...g.rows.map(r => r.low_stock_threshold ?? 5)),
      isLow: g.available > 0 && g.available <= Math.max(...g.rows.map(r => r.low_stock_threshold ?? 5)),
      isOut: g.available <= 0,
    })).sort((a, b) => a.name.localeCompare(b.name))
  }, [allInventory])

  const categories = useMemo(() =>
    Array.from(new Set(productGroups.map(g => g.category).filter(Boolean))).sort()
  , [productGroups])

  const filteredGroups = useMemo(() => {
    let list = productGroups
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(g =>
        g.name.toLowerCase().includes(q) ||
        (g.rows[0]?.product?.sku && String(g.rows[0].product.sku).toLowerCase().includes(q)) ||
        (g.rows[0]?.product?.barcode && String(g.rows[0].product.barcode).toLowerCase().includes(q)))
    }
    if (selectedBusiness)  list = list.filter(g => g.business_id === selectedBusiness)
    if (selectedCategory)  list = list.filter(g => g.category === selectedCategory)
    if (selectedWarehouse) list = list.filter(g => g.rows.some(r => r.warehouse_id === selectedWarehouse && r.quantity_physical > 0))
    if (statusFilter === 'low')      list = list.filter(g => g.isLow)
    if (statusFilter === 'out')      list = list.filter(g => g.isOut)
    if (statusFilter === 'reserved') list = list.filter(g => g.reserved > 0)
    if (statusFilter === 'damaged')  list = list.filter(g => g.damaged > 0)
    if (statusFilter === 'returned') list = list.filter(g => g.returned > 0)
    return list
  }, [productGroups, search, selectedBusiness, selectedCategory, selectedWarehouse, statusFilter])

  // ── Group inventory rows by warehouse ─────────────────────────────────────

  const warehouseGroups = useMemo(() => {
    const m = {}
    ;(allInventory || []).forEach(r => {
      if (selectedBusiness && r.business_id !== selectedBusiness) return
      if (search && !(r.product?.name || '').toLowerCase().includes(search.toLowerCase())) return
      const key = r.warehouse_id || 'unknown'
      if (!m[key]) {
        m[key] = {
          key,
          name: r.warehouse?.name || 'Unknown warehouse',
          state: r.warehouse?.state || null,
          rows: [],
          available: 0, physical: 0, reserved: 0,
        }
      }
      const g = m[key]
      g.rows.push(r)
      g.available += Number(r.quantity_available || 0)
      g.physical  += Number(r.quantity_physical || 0)
      g.reserved  += Number(r.quantity_reserved || 0)
    })
    return Object.values(m)
      .map(g => ({
        ...g,
        rows: [...g.rows].sort((a, b) => (a.product?.name || '').localeCompare(b.product?.name || '')),
        productCount: g.rows.filter(r => r.quantity_physical > 0).length,
      }))
      .sort((a, b) => b.physical - a.physical || a.name.localeCompare(b.name))
  }, [allInventory, selectedBusiness, search])

  // ── Health / summary metrics (unfiltered) ─────────────────────────────────

  const health = useMemo(() => {
    const rows = allInventory || []
    const stockedWarehouses = new Set(rows.filter(r => r.quantity_physical > 0).map(r => r.warehouse_id))
    const inTransit = (transfers || [])
      .filter(t => t.status === 'in_transit')
      .reduce((s, t) => s + Number(t.quantity || 0), 0)
    return {
      available: rows.reduce((s, r) => s + Number(r.quantity_available || 0), 0),
      reserved:  rows.reduce((s, r) => s + Number(r.quantity_reserved || 0), 0),
      lowCount:  productGroups.filter(g => g.isLow).length,
      outCount:  productGroups.filter(g => g.isOut).length,
      emptyWarehouses: Math.max(0, (warehouses || []).length - stockedWarehouses.size),
      inTransit,
      totalProducts: productGroups.length,
      totalUnits: rows.reduce((s, r) => s + Number(r.quantity_physical || 0), 0),
      damaged:  rows.reduce((s, r) => s + Number(r.quantity_damaged || 0), 0),
      returned: rows.reduce((s, r) => s + Number(r.quantity_returned || 0), 0),
      inspection: rows.reduce((s, r) => s + Number(r.quantity_inspection || 0), 0),
      repair:     rows.reduce((s, r) => s + Number(r.quantity_repair || 0), 0),
    }
  }, [allInventory, productGroups, warehouses, transfers])

  const awaitingReturns = (returnsList || []).filter(r => r.status === 'awaiting_inspection').length

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleAddStock() {
    if (!stockForm.product_id || !stockForm.warehouse_id || !stockForm.quantity) {
      showToast('Fill in required fields', 'error'); return
    }
    await addStock.mutateAsync({
      ...stockForm,
      quantity: Number(stockForm.quantity),
      unit_cost: Number(stockForm.unit_cost) || 0,
    })
    setShowAddModal(false)
    setStockForm({ product_id: '', warehouse_id: '', business_id: '', quantity: '', unit_cost: '', supplier: '', notes: '', date: new Date().toISOString().split('T')[0] })
  }

  async function handleAdjust() {
    const adj = Number(adjustForm.adjustment)
    if (!adj || !adjustForm.reason.trim()) {
      showToast('Enter adjustment amount and reason', 'error'); return
    }
    await adjustStock.mutateAsync({
      inventory_id: adjustingItem.id,
      product_id: adjustingItem.product_id,
      warehouse_id: adjustingItem.warehouse_id,
      business_id: adjustingItem.business_id,
      adjustment: adj,
      reason: adjustForm.reason,
    })
    setShowAdjustModal(false)
    setAdjustingItem(null)
    setAdjustForm({ adjustment: '', reason: '' })
  }

  async function handleTransfer() {
    if (!transferForm.product_id || !transferForm.from_warehouse_id || !transferForm.to_warehouse_id || !transferForm.quantity) {
      showToast('Fill in required fields', 'error'); return
    }
    const prod = (products || []).find(p => p.id === transferForm.product_id)
    await transferStock.mutateAsync({
      ...transferForm,
      product_name: prod?.name || 'Unknown',
      quantity: Number(transferForm.quantity),
    })
    setShowTransferModal(false)
    setTransferForm({ product_id: '', from_warehouse_id: '', to_warehouse_id: '', quantity: '', notes: '', date: new Date().toISOString().split('T')[0] })
  }

  async function handleSetMin() {
    const threshold = Number(minForm)
    if (!minStockGroup || isNaN(threshold) || threshold < 0) {
      showToast('Enter a valid minimum stock level', 'error'); return
    }
    await setMinStock.mutateAsync({ product_id: minStockGroup.product_id, threshold })
    setShowMinModal(false)
    setMinStockGroup(null)
    setMinForm('')
  }

  const inTransitTransfers = (transfers || []).filter(t => t.status === 'in_transit')

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-x-hidden w-full">
      <TopBar
        title="Inventory"
        back={false}
        actions={canManage && (
          <div className="flex gap-1.5">
            <button onClick={() => setShowTransferModal(true)}
              className="p-2 bg-gray-100 text-gray-700 rounded-xl active:scale-95 transition-all" title="Transfer stock">
              <ArrowLeftRight size={20} />
            </button>
            <button onClick={() => setShowAddModal(true)}
              className="p-2 bg-blue-600 text-black rounded-xl active:scale-95 transition-all" title="Receive stock">
              <Plus size={20} />
            </button>
          </div>
        )}
      />

      <div className="bg-white border-b border-gray-100 sticky top-[57px] z-20 px-4 pt-3 pb-2 space-y-2 w-full overflow-x-hidden">
        <SearchBar value={search} onChange={setSearch} placeholder="Search product, SKU, barcode..." />

        {/* Main tabs */}
        <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {[
            { key: 'stock',      label: 'Stock' },
            { key: 'warehouses', label: 'By Warehouse' },
            { key: 'transfers',  label: `Transfers${inTransitTransfers.length > 0 ? ` (${inTransitTransfers.length})` : ''}` },
            { key: 'returns',    label: `Returns${awaitingReturns > 0 ? ` (${awaitingReturns})` : ''}` },
          ].map(({ key, label }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium ${tab === key ? 'bg-blue-600 text-black' : 'bg-gray-100 text-gray-600'}`}
            >{label}</button>
          ))}
        </div>

        {tab === 'stock' && (
          <>
            {/* Status filter pills */}
            <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
              {STATUS_FILTERS.map(({ key, label }) => (
                <button key={key} onClick={() => setStatusFilter(key)}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium ${statusFilter === key ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}
                >{label}</button>
              ))}
            </div>

            {/* Business / warehouse / category filters */}
            <div className="grid grid-cols-2 gap-2">
              {businesses && businesses.length > 1 && (
                <Select value={selectedBusiness} onChange={e => setSelectedBusiness(e.target.value)}>
                  <option value="">All Businesses</option>
                  {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Select>
              )}
              <Select value={selectedWarehouse} onChange={e => setSelectedWarehouse(e.target.value)}>
                <option value="">All Warehouses</option>
                {(warehouses || []).map(w => <option key={w.id} value={w.id}>{w.name} ({w.state})</option>)}
              </Select>
              {categories.length > 0 && (
                <Select value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)}>
                  <option value="">All Categories</option>
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </Select>
              )}
            </div>
          </>
        )}

        {tab === 'warehouses' && businesses && businesses.length > 1 && (
          <Select value={selectedBusiness} onChange={e => setSelectedBusiness(e.target.value)}>
            <option value="">All Businesses</option>
            {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        )}
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4">
        {tab === 'stock' && (
          isLoading ? <SkeletonList count={5} /> : (
            <div className="space-y-4">

              {/* ── Inventory health dashboard ── */}
              <div className="bg-gray-900 rounded-2xl p-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Inventory Health</p>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { icon: '🟢', label: 'Available Units',    value: health.available,       color: 'text-green-400' },
                    { icon: '🟡', label: 'Reserved Units',     value: health.reserved,        color: 'text-yellow-400' },
                    { icon: '🔴', label: 'Low Stock Products', value: health.lowCount,        color: 'text-red-400' },
                    { icon: '📦', label: 'Empty Warehouses',   value: health.emptyWarehouses, color: 'text-gray-300' },
                    { icon: '🚚', label: 'Units in Transit',   value: health.inTransit,       color: 'text-blue-400' },
                  ].map(({ icon, label, value, color }) => (
                    <div key={label}>
                      <p className="text-xs text-gray-400 mb-0.5">{icon} {label}</p>
                      <p className={`text-xl font-bold ${color}`}>{value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Summary cards ── */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Products',     value: health.totalProducts, color: 'text-gray-900' },
                  { label: 'Units',        value: health.totalUnits,    color: 'text-gray-900' },
                  { label: 'Low Stock',    value: health.lowCount,      color: 'text-amber-600' },
                  { label: 'Out of Stock', value: health.outCount,      color: 'text-red-600' },
                  { label: 'Damaged',      value: health.damaged,       color: 'text-red-500' },
                  { label: 'Returned',     value: health.returned,      color: 'text-orange-500' },
                  { label: 'Inspection',   value: health.inspection,    color: 'text-amber-600' },
                  { label: 'In Repair',    value: health.repair,        color: 'text-purple-600' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="bg-white rounded-2xl border border-gray-100 px-3 py-2.5">
                    <p className="text-xs text-gray-500 mb-0.5 truncate">{label}</p>
                    <p className={`text-lg font-bold ${color}`}>{value}</p>
                  </div>
                ))}
              </div>

              {/* ── Product list ── */}
              {filteredGroups.length === 0 ? (
                <EmptyState
                  icon={<Package size={28} />}
                  title={statusFilter ? 'Nothing matches this filter' : 'No inventory records'}
                  description="Receive stock to start tracking inventory"
                  action={canManage ? () => setShowAddModal(true) : undefined}
                  actionLabel={canManage ? 'Receive Stock' : undefined}
                />
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-gray-500">{filteredGroups.length} product{filteredGroups.length !== 1 ? 's' : ''}</p>
                  {filteredGroups.map(g => {
                    const isOpen = expandedProduct === g.product_id
                    return (
                      <div key={g.key} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                        <button
                          onClick={() => setExpandedProduct(isOpen ? null : g.product_id)}
                          className="w-full text-left p-4 active:bg-gray-50 transition-colors"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-gray-900 leading-tight">{g.name}</p>
                              <p className="text-xs text-gray-500 mt-0.5 truncate">
                                {[g.business, g.category].filter(Boolean).join(' · ') || '—'}
                              </p>
                              <p className="text-xs mt-1">
                                <span className={`text-base font-bold ${g.isOut ? 'text-red-600' : g.isLow ? 'text-amber-600' : 'text-green-600'}`}>
                                  {g.available}
                                </span>
                                <span className="text-gray-400"> available</span>
                                {g.reserved > 0 && <span className="text-amber-600 font-medium"> · {g.reserved} reserved</span>}
                                {g.isLow && <span className="ml-1 text-[10px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-full">LOW</span>}
                                {g.isOut && <span className="ml-1 text-[10px] font-semibold text-red-700 bg-red-50 px-1.5 py-0.5 rounded-full">OUT</span>}
                              </p>
                            </div>
                            {isOpen
                              ? <ChevronUp size={18} className="text-gray-400 shrink-0" />
                              : <ChevronDown size={18} className="text-gray-400 shrink-0" />}
                          </div>
                        </button>

                        {isOpen && (
                          <div className="px-4 pb-4 space-y-3">
                            {/* Stock summary */}
                            <div className="grid grid-cols-3 gap-2">
                              {[
                                { label: 'Available', value: g.available, color: g.isOut ? 'text-red-600' : g.isLow ? 'text-amber-600' : 'text-green-600' },
                                { label: 'Reserved',  value: g.reserved,  color: 'text-amber-600' },
                                { label: 'Physical',  value: g.physical },
                                { label: 'Sold',      value: g.sold },
                                { label: 'Returned',  value: g.returned,  color: 'text-orange-500' },
                                { label: 'Damaged',   value: g.damaged,   color: 'text-red-500' },
                                ...(g.inspection > 0 ? [{ label: 'Inspection', value: g.inspection, color: 'text-amber-600' }] : []),
                                ...(g.repair > 0 ? [{ label: 'In Repair', value: g.repair, color: 'text-purple-600' }] : []),
                              ].map(({ label, value, color }) => (
                                <div key={label} className="bg-gray-50 rounded-xl px-2.5 py-2">
                                  <p className="text-xs text-gray-400 mb-0.5">{label}</p>
                                  <p className={`text-base font-bold ${color || 'text-gray-900'}`}>{value}</p>
                                </div>
                              ))}
                            </div>

                            {/* Min stock level */}
                            <div className="bg-gray-50 rounded-xl px-3 py-2.5 flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <Bell size={14} className="text-gray-400 shrink-0" />
                                <p className="text-xs text-gray-600 truncate">
                                  Low stock alert below <span className="font-bold text-gray-900">{g.minThreshold}</span> units
                                </p>
                              </div>
                              {canManage && (
                                <button
                                  onClick={() => { setMinStockGroup(g); setMinForm(String(g.minThreshold)); setShowMinModal(true) }}
                                  className="text-xs font-semibold text-blue-700 shrink-0 active:scale-95">
                                  Edit
                                </button>
                              )}
                            </div>

                            {/* Warehouse distribution */}
                            <div className="bg-gray-50 rounded-xl p-3">
                              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Warehouse Distribution</p>
                              <div className="space-y-2">
                                {g.rows.map(r => (
                                  <div key={r.id} className="flex items-center gap-2">
                                    <span className={`text-sm font-bold w-8 shrink-0 ${r.quantity_available <= 0 ? 'text-red-600' : r.quantity_available <= (r.low_stock_threshold ?? 5) ? 'text-amber-600' : 'text-green-600'}`}>
                                      {r.quantity_available}
                                    </span>
                                    <span className="text-sm text-gray-700 flex-1 min-w-0 truncate">
                                      {r.warehouse?.name}{r.warehouse?.state ? ` · ${r.warehouse.state}` : ''}
                                    </span>
                                    {canManage && (
                                      <button
                                        onClick={() => { setAdjustingItem(r); setAdjustForm({ adjustment: '', reason: '' }); setShowAdjustModal(true) }}
                                        className="p-1.5 bg-white rounded-lg border border-gray-200 active:scale-95 transition-all shrink-0"
                                        title="Adjust stock">
                                        <Sliders size={13} className="text-gray-600" />
                                      </button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>

                            {/* Movement timeline */}
                            <div className="bg-gray-50 rounded-xl p-3">
                              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Stock Movements</p>
                              {movementsQ.isLoading ? (
                                <p className="text-xs text-gray-400 py-2">Loading movements…</p>
                              ) : (movementsQ.data || []).length === 0 ? (
                                <p className="text-xs text-gray-400 py-2">No movements recorded yet</p>
                              ) : (
                                <div className="space-y-2.5">
                                  {(movementsQ.data || []).map(m => {
                                    const mv = MOVEMENT_LABELS[m.movement_type] || { label: m.movement_type, color: 'text-gray-600' }
                                    return (
                                      <div key={m.id} className="flex gap-2">
                                        <span className={`text-sm font-bold w-10 shrink-0 text-right ${Number(m.quantity) >= 0 ? 'text-blue-600' : 'text-red-500'}`}>
                                          {Number(m.quantity) > 0 ? `+${m.quantity}` : m.quantity}
                                        </span>
                                        <div className="flex-1 min-w-0">
                                          <p className={`text-xs font-semibold ${mv.color}`}>{mv.label}</p>
                                          {m.notes && <p className="text-xs text-gray-600 truncate">{m.notes}</p>}
                                          <p className="text-[11px] text-gray-400">
                                            {formatDate(m.created_at)}
                                            {m.warehouse?.name ? ` · ${m.warehouse.name}` : ''}
                                            {m.staff?.name ? ` · ${m.staff.name}` : ''}
                                          </p>
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        )}

        {/* ── By Warehouse tab ── */}
        {tab === 'warehouses' && (
          isLoading ? <SkeletonList count={5} /> : (
            warehouseGroups.length === 0 ? (
              <EmptyState
                icon={<Package size={28} />}
                title="No warehouse stock"
                description={search ? 'No products match your search' : 'Receive stock to see it distributed by warehouse'}
              />
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-gray-500">{warehouseGroups.length} warehouse{warehouseGroups.length !== 1 ? 's' : ''} with stock records</p>
                {warehouseGroups.map(w => {
                  const isOpen = expandedWarehouse === w.key
                  return (
                    <div key={w.key} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                      <button
                        onClick={() => setExpandedWarehouse(isOpen ? null : w.key)}
                        className="w-full text-left p-4 active:bg-gray-50 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-gray-900 leading-tight">
                              {w.name}{w.state ? ` · ${w.state}` : ''}
                            </p>
                            <p className="text-xs mt-1">
                              <span className={`text-base font-bold ${w.available <= 0 ? 'text-red-600' : 'text-green-600'}`}>{w.available}</span>
                              <span className="text-gray-400"> available · </span>
                              <span className="text-gray-600 font-medium">{w.productCount} product{w.productCount !== 1 ? 's' : ''}</span>
                              {w.reserved > 0 && <span className="text-amber-600 font-medium"> · {w.reserved} reserved</span>}
                            </p>
                          </div>
                          {isOpen
                            ? <ChevronUp size={18} className="text-gray-400 shrink-0" />
                            : <ChevronDown size={18} className="text-gray-400 shrink-0" />}
                        </div>
                      </button>

                      {isOpen && (
                        <div className="px-4 pb-4">
                          <div className="bg-gray-50 rounded-xl p-3">
                            <div className="flex items-center gap-2 pb-2 border-b border-gray-200 mb-1">
                              <span className="text-[11px] font-semibold text-gray-400 uppercase w-8 shrink-0">Qty</span>
                              <span className="text-[11px] font-semibold text-gray-400 uppercase flex-1">Product</span>
                            </div>
                            <div className="divide-y divide-gray-100">
                              {w.rows.map(r => (
                                <div key={r.id} className="flex items-center gap-2 py-2">
                                  <span className={`text-sm font-bold w-8 shrink-0 ${r.quantity_available <= 0 ? 'text-red-600' : r.quantity_available <= (r.low_stock_threshold ?? 5) ? 'text-amber-600' : 'text-green-600'}`}>
                                    {r.quantity_available}
                                  </span>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm text-gray-800 truncate">{r.product?.name || 'Unknown product'}</p>
                                    {r.quantity_reserved > 0 && (
                                      <p className="text-[11px] text-amber-600">{r.quantity_reserved} reserved</p>
                                    )}
                                  </div>
                                  {canManage && (
                                    <button
                                      onClick={() => { setAdjustingItem(r); setAdjustForm({ adjustment: '', reason: '' }); setShowAdjustModal(true) }}
                                      className="p-1.5 bg-white rounded-lg border border-gray-200 active:scale-95 transition-all shrink-0"
                                      title="Adjust stock">
                                      <Sliders size={13} className="text-gray-600" />
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          )
        )}

        {/* ── Returns tab ── */}
        {tab === 'returns' && <ReturnsTab canManage={canManage} />}

        {/* ── Transfers tab ── */}
        {tab === 'transfers' && (
          <div className="space-y-3">
            {canManage && (
              <Button onClick={() => setShowTransferModal(true)} className="w-full" variant="secondary">
                <ArrowLeftRight size={16} className="mr-1" /> New Transfer
              </Button>
            )}
            {(transfers || []).length === 0 ? (
              <EmptyState
                icon={<ArrowLeftRight size={28} />}
                title="No transfers yet"
                description="Move stock between warehouses to see transfers here"
              />
            ) : (transfers || []).map(t => (
              <div key={t.id} className="bg-white rounded-2xl border border-gray-100 p-4">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p className="text-xs font-mono text-gray-400">{t.transfer_number}</p>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                    t.status === 'in_transit' ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'
                  }`}>
                    {t.status === 'in_transit' ? 'IN TRANSIT' : 'RECEIVED'}
                  </span>
                </div>
                <p className="text-sm font-semibold text-gray-900">{t.product?.name || t.product_name}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  <span className="font-bold text-gray-900">{t.quantity}</span> units ·{' '}
                  {t.from_warehouse?.name || '—'} → {t.to_warehouse?.name || '—'}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">{t.date_transferred || formatDate(t.created_at)}</p>
                {t.notes && <p className="text-xs text-gray-500 mt-1">{t.notes}</p>}
                {t.status === 'in_transit' && canManage && (
                  <Button
                    onClick={() => receiveTransfer.mutateAsync(t)}
                    loading={receiveTransfer.isPending}
                    className="w-full mt-3" size="sm">
                    Mark Received at {t.to_warehouse?.name || 'destination'}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Adjust modal ── */}
      <Modal
        isOpen={showAdjustModal}
        onClose={() => { setShowAdjustModal(false); setAdjustingItem(null) }}
        title={adjustingItem ? `Adjust Stock — ${adjustingItem.product?.name}` : 'Adjust Stock'}
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => { setShowAdjustModal(false); setAdjustingItem(null) }} className="flex-1">Cancel</Button>
            <Button onClick={handleAdjust} loading={adjustStock.isPending} className="flex-1">Save Adjustment</Button>
          </div>
        }
      >
        {adjustingItem && (
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-xl p-3 text-sm">
              <p className="text-gray-500 text-xs">Current available stock</p>
              <p className="text-2xl font-bold text-gray-900">{adjustingItem.quantity_available}</p>
              <p className="text-xs text-gray-400">{adjustingItem.warehouse?.name} · {adjustingItem.warehouse?.state}</p>
            </div>
            <Input
              label="Adjustment"
              type="number"
              inputMode="numeric"
              placeholder="e.g. +10 or -3"
              value={adjustForm.adjustment}
              onChange={e => setAdjustForm({ ...adjustForm, adjustment: e.target.value })}
              hint={adjustForm.adjustment && !isNaN(Number(adjustForm.adjustment))
                ? `New quantity: ${adjustingItem.quantity_available + Number(adjustForm.adjustment)}`
                : 'Positive to add, negative to remove'}
            />
            <Input
              label="Reason"
              required
              placeholder="e.g. Damaged goods, stocktake correction"
              value={adjustForm.reason}
              onChange={e => setAdjustForm({ ...adjustForm, reason: e.target.value })}
            />
          </div>
        )}
      </Modal>

      {/* ── Receive stock modal ── */}
      <Modal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Receive Stock"
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowAddModal(false)} className="flex-1">Cancel</Button>
            <Button onClick={handleAddStock} loading={addStock.isPending} className="flex-1">Receive Stock</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Select label="Business" required value={stockForm.business_id}
            onChange={e => setStockForm({ ...stockForm, business_id: e.target.value })}>
            <option value="">Select business...</option>
            {(businesses || []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
          <Select label="Product" required value={stockForm.product_id}
            onChange={e => setStockForm({ ...stockForm, product_id: e.target.value })}>
            <option value="">Select product...</option>
            {(products || []).filter(p => !stockForm.business_id || p.business_id === stockForm.business_id).map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
          <Select label="Warehouse" required value={stockForm.warehouse_id}
            onChange={e => setStockForm({ ...stockForm, warehouse_id: e.target.value })}>
            <option value="">Select warehouse...</option>
            {(warehouses || []).map(w => <option key={w.id} value={w.id}>{w.name} ({w.state})</option>)}
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Quantity" type="number" inputMode="numeric" required
              value={stockForm.quantity} onChange={e => setStockForm({ ...stockForm, quantity: e.target.value })} />
            <Input label="Unit Cost (₦)" type="number" inputMode="decimal"
              value={stockForm.unit_cost} onChange={e => setStockForm({ ...stockForm, unit_cost: e.target.value })} />
          </div>
          <Input label="Date Received" type="date"
            value={stockForm.date} onChange={e => setStockForm({ ...stockForm, date: e.target.value })} />
          <Input label="Supplier" placeholder="Supplier name"
            value={stockForm.supplier} onChange={e => setStockForm({ ...stockForm, supplier: e.target.value })} />
          <Textarea label="Notes" rows={2}
            value={stockForm.notes} onChange={e => setStockForm({ ...stockForm, notes: e.target.value })} />
        </div>
      </Modal>

      {/* ── Transfer modal ── */}
      <Modal
        isOpen={showTransferModal}
        onClose={() => setShowTransferModal(false)}
        title="Transfer Stock"
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowTransferModal(false)} className="flex-1">Cancel</Button>
            <Button onClick={handleTransfer} loading={transferStock.isPending} className="flex-1">Start Transfer</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Select label="Product" required value={transferForm.product_id}
            onChange={e => setTransferForm({ ...transferForm, product_id: e.target.value })}>
            <option value="">Select product...</option>
            {(products || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Select label="From Warehouse" required value={transferForm.from_warehouse_id}
            onChange={e => setTransferForm({ ...transferForm, from_warehouse_id: e.target.value })}>
            <option value="">Select source...</option>
            {(warehouses || []).map(w => <option key={w.id} value={w.id}>{w.name} ({w.state})</option>)}
          </Select>
          <Select label="To Warehouse" required value={transferForm.to_warehouse_id}
            onChange={e => setTransferForm({ ...transferForm, to_warehouse_id: e.target.value })}>
            <option value="">Select destination...</option>
            {(warehouses || []).filter(w => w.id !== transferForm.from_warehouse_id).map(w => (
              <option key={w.id} value={w.id}>{w.name} ({w.state})</option>
            ))}
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Quantity" type="number" inputMode="numeric" required
              value={transferForm.quantity} onChange={e => setTransferForm({ ...transferForm, quantity: e.target.value })} />
            <Input label="Date" type="date"
              value={transferForm.date} onChange={e => setTransferForm({ ...transferForm, date: e.target.value })} />
          </div>
          <Textarea label="Notes" rows={2} placeholder="Courier, waybill number, etc."
            value={transferForm.notes} onChange={e => setTransferForm({ ...transferForm, notes: e.target.value })} />
          <p className="text-xs text-gray-400">
            Stock leaves the source warehouse immediately and shows as in transit until marked received at the destination.
          </p>
        </div>
      </Modal>

      {/* ── Min stock modal ── */}
      <Modal
        isOpen={showMinModal}
        onClose={() => { setShowMinModal(false); setMinStockGroup(null) }}
        title={minStockGroup ? `Low Stock Alert — ${minStockGroup.name}` : 'Low Stock Alert'}
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => { setShowMinModal(false); setMinStockGroup(null) }} className="flex-1">Cancel</Button>
            <Button onClick={handleSetMin} loading={setMinStock.isPending} className="flex-1">Save</Button>
          </div>
        }
      >
        <Input
          label="Minimum stock level"
          type="number"
          inputMode="numeric"
          required
          value={minForm}
          onChange={e => setMinForm(e.target.value)}
          hint="You'll see a LOW badge when available stock falls to or below this number"
        />
      </Modal>
    </div>
  )
}
