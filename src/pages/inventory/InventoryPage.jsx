import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, AlertTriangle, Package, Sliders } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useInventory, useAddStock, useAdjustStock } from '../../hooks/useInventory'
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
import { formatCurrency } from '../../utils/format'

const TABS = [
  { key: 'all', label: 'All Stock' },
  { key: 'low', label: 'Low Stock' },
  { key: 'by_warehouse', label: 'By Warehouse' },
]

export function InventoryPage() {
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState(searchParams.get('filter') === 'low_stock' ? 'low' : 'all')
  const [search, setSearch] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [selectedWarehouse, setSelectedWarehouse] = useState('')
  const [selectedBusiness, setSelectedBusiness] = useState('')
  const { user } = useAuthStore()
  const { showToast } = useAppStore()
  const { data: businesses } = useBusinesses()
  const { data: warehouses } = useWarehouses()
  const addStock = useAddStock()

  const { data: allInventory, isLoading } = useInventory({
    low_stock: tab === 'low',
    business_id: selectedBusiness || undefined,
  })
  const { data: products } = useProducts()
  const adjustStock = useAdjustStock()

  const [showAdjustModal, setShowAdjustModal] = useState(false)
  const [adjustingItem, setAdjustingItem] = useState(null)
  const [adjustForm, setAdjustForm] = useState({ adjustment: '', reason: '' })

  const [stockForm, setStockForm] = useState({
    product_id: '', warehouse_id: '', business_id: '',
    quantity: '', unit_cost: '', supplier: '', notes: ''
  })

  const filteredInventory = (allInventory || []).filter(item => {
    const matchSearch = !search ||
      item.product?.name?.toLowerCase().includes(search.toLowerCase())
    const matchWarehouse = !selectedWarehouse || item.warehouse_id === selectedWarehouse
    return matchSearch && matchWarehouse
  })

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
    setStockForm({ product_id: '', warehouse_id: '', business_id: '', quantity: '', unit_cost: '', supplier: '', notes: '' })
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

  function getStockColor(item) {
    if (item.quantity_available <= 0) return 'text-red-600'
    if (item.quantity_available <= 5) return 'text-amber-600'
    return 'text-green-600'
  }

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Inventory"
        back={false}
        actions={
          <button onClick={() => setShowAddModal(true)}
            className="p-2 bg-blue-600 text-white rounded-xl active:scale-95 transition-all">
            <Plus size={20} />
          </button>
        }
      />

      <div className="bg-white border-b border-gray-100 sticky top-[57px] z-20 px-4 pt-3 pb-2 space-y-2">
        <SearchBar value={search} onChange={setSearch} placeholder="Search products..." />
        {businesses && businesses.length > 1 && (
          <Select value={selectedBusiness} onChange={e => setSelectedBusiness(e.target.value)}>
            <option value="">All Businesses</option>
            {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        )}
        <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {TABS.map(({ key, label }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium ${tab === key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}
            >{label}</button>
          ))}
        </div>
        {tab === 'by_warehouse' && (
          <Select value={selectedWarehouse} onChange={e => setSelectedWarehouse(e.target.value)}>
            <option value="">All Warehouses</option>
            {(warehouses || []).map(w => <option key={w.id} value={w.id}>{w.name} ({w.state})</option>)}
          </Select>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {isLoading ? <SkeletonList count={5} /> :
         filteredInventory.length === 0 ? (
           <EmptyState
             icon={<Package size={28} />}
             title={tab === 'low' ? 'No low stock items' : 'No inventory records'}
             description="Add received stock to track inventory"
             action={() => setShowAddModal(true)}
             actionLabel="Add Stock"
           />
         ) : (
           <div className="space-y-3">
             <p className="text-xs text-gray-500">{filteredInventory.length} item{filteredInventory.length !== 1 ? 's' : ''}</p>
             {filteredInventory.map(item => (
               <div key={item.id} className="bg-white rounded-2xl p-4 border border-gray-100">
                 <div className="flex items-start justify-between gap-2 mb-2">
                   <div className="flex-1 min-w-0">
                     <p className="text-sm font-semibold text-gray-900 leading-tight">{item.product?.name}</p>
                     <p className="text-xs text-gray-500">{item.warehouse?.name} · {item.warehouse?.state}</p>
                   </div>
                   <div className="flex items-center gap-2 shrink-0">
                     {item.quantity_available <= 5 && (
                       <AlertTriangle size={16} className="text-amber-500" />
                     )}
                     <button
                       onClick={() => { setAdjustingItem(item); setAdjustForm({ adjustment: '', reason: '' }); setShowAdjustModal(true) }}
                       className="p-1.5 bg-gray-100 rounded-lg active:scale-95 transition-all"
                       title="Adjust stock"
                     >
                       <Sliders size={14} className="text-gray-600" />
                     </button>
                   </div>
                 </div>
                 <div className="grid grid-cols-4 gap-2">
                   {[
                     { label: 'Available', value: item.quantity_available, className: getStockColor(item) },
                     { label: 'Physical', value: item.quantity_physical },
                     { label: 'Reserved', value: item.quantity_reserved },
                     { label: 'Sold', value: item.quantity_sold },
                   ].map(({ label, value, className }) => (
                     <div key={label} className="text-center">
                       <p className={`text-lg font-bold ${className || 'text-gray-900'}`}>{value}</p>
                       <p className="text-xs text-gray-400">{label}</p>
                     </div>
                   ))}
                 </div>
               </div>
             ))}
           </div>
         )
        }
      </div>

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

      <Modal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Add Received Stock"
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowAddModal(false)} className="flex-1">Cancel</Button>
            <Button onClick={handleAddStock} loading={addStock.isPending} className="flex-1">Add Stock</Button>
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
          <Input label="Supplier" placeholder="Supplier name"
            value={stockForm.supplier} onChange={e => setStockForm({ ...stockForm, supplier: e.target.value })} />
          <Textarea label="Notes" rows={2}
            value={stockForm.notes} onChange={e => setStockForm({ ...stockForm, notes: e.target.value })} />
        </div>
      </Modal>
    </div>
  )
}
