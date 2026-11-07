import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Truck, Warehouse, Store } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Select } from '../ui/Input'
import { useWarehouses } from '../../hooks/useBusinesses'
import { transitForOrder, bestStateWarehouse, getOrderItems } from '../../lib/stockOps'

// Asked when an order is marked Delivered: where did the goods come from?
//   Our warehouse   → deducted from that warehouse when the order is paid
//   Supplier direct → stock is never touched
// Waybilled orders already know: their goods are in Goods in Transit.
export function StockSourceModal({ order, isOpen, onClose, onConfirm, loading }) {
  const { data: warehouses } = useWarehouses()
  const [source, setSource] = useState('')
  const [warehouseId, setWarehouseId] = useState('')

  const infoQ = useQuery({
    queryKey: ['stock_source_info', order?.id],
    enabled: isOpen && !!order,
    queryFn: async () => {
      const transit = (await transitForOrder(order.id)) || []
      const open = transit.filter(t => t.status === 'in_transit')
      const items = await getOrderItems(order)
      const best = await bestStateWarehouse(order, items)
      return { open, best }
    },
    staleTime: 0,
  })

  // Sensible defaults once we know where the stock is
  useEffect(() => {
    if (!isOpen || !infoQ.data) return
    if (order.stock_source === 'supplier_direct') {
      setSource('supplier_direct')
    } else {
      setSource('warehouse')
    }
    setWarehouseId(order.stock_warehouse_id || infoQ.data.best?.id || '')
  }, [isOpen, infoQ.data, order?.stock_source, order?.stock_warehouse_id])

  if (!order) return null
  const open = infoQ.data?.open || []
  const fromTransit = open.length > 0
  const stateWhs = (warehouses || []).filter(w => w.state === order.state)
  const otherWhs = (warehouses || []).filter(w => w.state !== order.state)
  const chosen = (warehouses || []).find(w => w.id === warehouseId)
  const canSave = fromTransit || source === 'supplier_direct' || (source === 'warehouse' && warehouseId)

  function confirm() {
    if (fromTransit) return onConfirm({ fromTransit: true, label: 'Goods in Transit' })
    if (source === 'supplier_direct') return onConfirm({ stock_source: 'supplier_direct', stock_warehouse_id: null, label: 'Supplier direct' })
    onConfirm({ stock_source: 'warehouse', stock_warehouse_id: warehouseId, label: chosen?.name || 'our warehouse' })
  }

  const Option = ({ value, icon, title, desc }) => (
    <button type="button" onClick={() => setSource(value)}
      className={`w-full text-left p-3 rounded-xl border-2 flex gap-3 items-start ${source === value ? 'border-blue-600 bg-blue-50' : 'border-gray-200 bg-white'}`}>
      <span className="mt-0.5 text-gray-600">{icon}</span>
      <span>
        <span className="block text-sm font-semibold text-gray-900">{title}</span>
        <span className="block text-xs text-gray-500">{desc}</span>
      </span>
    </button>
  )

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Mark as Delivered — Stock Source"
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
          <Button onClick={confirm} loading={loading} disabled={!canSave || infoQ.isLoading} className="flex-1">Mark Delivered</Button>
        </div>
      }>
      {infoQ.isLoading ? (
        <div className="h-24 shimmer rounded-xl" />
      ) : fromTransit ? (
        <div className="bg-purple-50 border border-purple-100 rounded-xl p-3 text-sm text-purple-800 flex gap-2">
          <Truck size={18} className="shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Waybilled goods — from Goods in Transit</p>
            <p className="text-xs mt-1">
              {open.map(t => `${t.quantity} × ${t.product_name}`).join(', ')} already left the warehouse.
              They are closed off as sold when this order is paid.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">Where did the goods for this order come from?</p>
          <Option value="warehouse" icon={<Warehouse size={18} />} title="Our warehouse"
            desc="Deducted from the warehouse below when the order is paid" />
          {source === 'warehouse' && (
            <Select label="Warehouse" value={warehouseId} onChange={e => setWarehouseId(e.target.value)}>
              <option value="">Choose warehouse…</option>
              {stateWhs.length > 0 && (
                <optgroup label={`In ${order.state}`}>
                  {stateWhs.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </optgroup>
              )}
              <optgroup label="Other states">
                {otherWhs.map(w => <option key={w.id} value={w.id}>{w.name} ({w.state})</option>)}
              </optgroup>
            </Select>
          )}
          {source === 'warehouse' && !infoQ.data?.best && (
            <p className="text-xs text-amber-700 bg-amber-50 rounded-lg p-2">
              No warehouse in {order.state} shows this stock. If it really came from a warehouse, pick it — otherwise choose Supplier direct.
            </p>
          )}
          <Option value="supplier_direct" icon={<Store size={18} />} title="Supplier direct"
            desc="Bought from the supplier and sent straight to the customer — stock is not touched" />
        </div>
      )}
    </Modal>
  )
}
