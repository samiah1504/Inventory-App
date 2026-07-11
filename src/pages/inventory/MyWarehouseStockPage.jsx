import { useState, useMemo } from 'react'
import { Warehouse, ChevronDown, ChevronUp, Eye } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { TopBar } from '../../components/layout/TopBar'
import { SearchBar } from '../../components/ui/SearchBar'
import { Select } from '../../components/ui/Input'
import { SkeletonList } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'
import { useAuthStore } from '../../stores/authStore'
import { formatDate } from '../../utils/format'
import { scopeToBusinesses } from '../../lib/businessScope'

const STATUS = {
  out:       { label: 'Out of Stock', chip: 'bg-red-50 text-red-700' },
  low:       { label: 'Low Stock',    chip: 'bg-amber-50 text-amber-700' },
  available: { label: 'Available',    chip: 'bg-green-50 text-green-700' },
}

function stockStatus(row) {
  const avail = row.quantity_available || 0
  if (avail <= 0) return 'out'
  if (avail <= (row.low_stock_threshold ?? 5)) return 'low'
  return 'available'
}

export function MyWarehouseStockPage() {
  const { user } = useAuthStore()

  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [warehouseFilter, setWarehouseFilter] = useState('')
  const [expanded, setExpanded] = useState(null)

  // Officers with assigned states only see warehouses in those states;
  // CEO / managers (and officers without state ticks) see everything
  const myStates = user?.role === 'fulfillment'
    && Array.isArray(user?.assigned_states) && user.assigned_states.length > 0
    ? user.assigned_states : null

  const { data: inventory, isLoading } = useQuery({
    queryKey: ['my_warehouse_stock', myStates, user?.id],
    queryFn: async () => {
      let q = supabase
        .from('inventory')
        .select(`
          *,
          product:products(*, category:product_categories(name)),
          warehouse:warehouses(id, name, state)
        `)
        .order('quantity_available', { ascending: true })
      q = scopeToBusinesses(q, user)
      const { data, error } = await q
      if (error) throw error
      const rows = data || []
      return myStates
        ? rows.filter(r => r.warehouse?.state && myStates.includes(r.warehouse.state))
        : rows
    },
    staleTime: 30000,
  })

  const rows = inventory || []

  const myWarehouses = useMemo(() =>
    [...new Map(rows.filter(r => r.warehouse).map(r => [r.warehouse.id, r.warehouse])).values()]
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  , [rows])

  const categories = useMemo(() =>
    [...new Set(rows.map(r => r.product?.category?.name).filter(Boolean))].sort()
  , [rows])

  const list = useMemo(() => {
    let l = rows
    if (search) {
      const q = search.toLowerCase()
      l = l.filter(r =>
        (r.product?.name || '').toLowerCase().includes(q) ||
        (r.product?.sku ? String(r.product.sku).toLowerCase().includes(q) : false))
    }
    if (categoryFilter) l = l.filter(r => r.product?.category?.name === categoryFilter)
    if (statusFilter) l = l.filter(r => stockStatus(r) === statusFilter)
    if (warehouseFilter) l = l.filter(r => r.warehouse?.id === warehouseFilter)
    return l
  }, [rows, search, categoryFilter, statusFilter, warehouseFilter])

  return (
    <div className="flex flex-col h-full overflow-x-hidden w-full">
      <TopBar title="My Warehouse Stock" />

      <div className="bg-white border-b border-gray-100 sticky top-[57px] z-20 px-4 pt-3 pb-2 space-y-2 w-full overflow-x-hidden">
        <SearchBar value={search} onChange={setSearch} placeholder="Search product name or SKU..." />
        <div className="flex gap-2">
          <div className="flex-1 min-w-0">
            <Select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
              <option value="">All Categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </Select>
          </div>
          <div className="flex-1 min-w-0">
            <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">All Status</option>
              <option value="available">Available</option>
              <option value="low">Low Stock</option>
              <option value="out">Out of Stock</option>
            </Select>
          </div>
        </div>
        {myWarehouses.length > 1 && (
          <Select value={warehouseFilter} onChange={e => setWarehouseFilter(e.target.value)}>
            <option value="">All My Warehouses</option>
            {myWarehouses.map(w => <option key={w.id} value={w.id}>{w.name} ({w.state})</option>)}
          </Select>
        )}
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-3">
        <div className="flex items-start gap-2 bg-gray-50 rounded-xl p-3">
          <Eye size={14} className="text-gray-400 shrink-0 mt-0.5" />
          <p className="text-xs text-gray-500">
            View only — stock in the warehouse{myWarehouses.length !== 1 ? 's' : ''} serving
            {myStates ? ` ${myStates.join(', ')}` : ' all states'}. Use it to decide if an order
            can go straight to Processing or needs a waybill. Inventory changes are handled by
            warehouse staff.
          </p>
        </div>

        {isLoading ? <SkeletonList count={5} /> :
         list.length === 0 ? (
          <EmptyState
            icon={<Warehouse size={28} />}
            title="No stock records"
            description={myStates
              ? `No inventory found for warehouses in ${myStates.join(', ')}`
              : 'No inventory records match your filters'}
          />
        ) : list.map(row => {
          const st = stockStatus(row)
          const s = STATUS[st]
          const isOpen = expanded === row.id
          const p = row.product
          return (
            <div key={row.id} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <button onClick={() => setExpanded(isOpen ? null : row.id)}
                className="w-full text-left p-4 active:bg-gray-50 transition-colors">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${s.chip}`}>{s.label.toUpperCase()}</span>
                  <span className="text-[11px] text-gray-400 shrink-0">{row.warehouse?.name}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 leading-tight truncate">{p?.name || 'Unknown product'}</p>
                    <p className="text-xs text-gray-500 mt-0.5 truncate">
                      {[p?.sku ? `SKU ${p.sku}` : null, p?.category?.name].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-lg font-bold ${st === 'out' ? 'text-red-600' : st === 'low' ? 'text-amber-600' : 'text-green-600'}`}>
                      {row.quantity_available || 0}
                    </p>
                    <p className="text-[10px] text-gray-400">available</p>
                  </div>
                  {isOpen ? <ChevronUp size={18} className="text-gray-400 shrink-0" /> : <ChevronDown size={18} className="text-gray-400 shrink-0" />}
                </div>
              </button>

              {isOpen && (
                <div className="px-4 pb-4 space-y-3">
                  {p?.image_url && (
                    <img src={p.image_url} alt={p?.name}
                      className="w-full max-h-48 object-contain rounded-xl bg-gray-50" />
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: 'Available', value: row.quantity_available || 0 },
                      { label: 'Reserved',  value: row.quantity_reserved || 0 },
                      { label: 'Warehouse', value: row.warehouse?.name || '—' },
                      { label: 'State',     value: row.warehouse?.state || '—' },
                    ].map(({ label, value }) => (
                      <div key={label} className="bg-gray-50 rounded-xl p-2.5">
                        <p className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</p>
                        <p className="text-sm font-bold text-gray-900 truncate">{value}</p>
                      </div>
                    ))}
                  </div>
                  {p?.description && (
                    <p className="text-xs text-gray-600">{p.description}</p>
                  )}
                  <p className="text-[11px] text-gray-400">
                    Last stock update: {(row.updated_at || row.created_at) ? formatDate(row.updated_at || row.created_at) : '—'}
                  </p>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
