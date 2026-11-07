import { useMemo } from 'react'
import { useInventory, useWarehouseTransfers } from './useInventory'
import { useInTransit, useDamagedGoods } from './useStockFlow'
import { useHoldingQueue } from './useHolding'
import { useWarehouses, useProducts } from './useBusinesses'
import { useAuthStore } from '../stores/authStore'
import { allowedWarehouseIds, isCompanyAdmin, canEditStock } from '../lib/inventoryAccess'

// ═══════════════════════════════════════════════════════════════════
// The ONE place the Inventory screens get their numbers from.
// Every figure comes from existing tables — nothing is stored here.
//
//   Good stock ....... inventory.quantity_available (saleable, on the shelf)
//   Inspection ....... inventory.quantity_inspection (returned, not yet assessed)
//   Damaged .......... open damaged_goods records (damaged / awaiting repair)
//   In transit ....... open Goods in Transit + warehouse transfers on the way
//   Total ............ good + inspection + damaged + in transit
//   Value (₦) ........ good units × product cost price (same cost the app
//                      uses for cost of goods sold). Products with no cost
//                      price are counted separately, never guessed.
// ═══════════════════════════════════════════════════════════════════

const n = (v) => Number(v) || 0

export function useInventoryModel() {
  const { user } = useAuthStore()
  const inventoryQ = useInventory({})
  const transitQ = useInTransit(false)
  const transfersQ = useWarehouseTransfers()
  const damagedQ = useDamagedGoods(false)
  const parkQ = useHoldingQueue(false)
  const warehousesQ = useWarehouses()
  const productsQ = useProducts()

  const model = useMemo(() => {
    const allowed = allowedWarehouseIds(user)
    const warehouses = (warehousesQ.data || []).filter(w => !allowed || allowed.includes(w.id))
    const whById = Object.fromEntries(warehouses.map(w => [w.id, w]))
    const catalog = Object.fromEntries((productsQ.data || []).map(p => [p.id, p]))

    const products = {}
    const ensure = (pid, fallback = {}) => {
      const key = pid || `name:${fallback.name || 'Unknown'}`
      if (!products[key]) {
        const p = (pid && catalog[pid]) || fallback.product || {}
        products[key] = {
          key, product_id: pid || null,
          name: p.name || fallback.name || 'Unknown product',
          sku: p.sku || null,
          image_url: p.image_url || null,
          category: p.category?.name || null,
          business_id: p.business_id || fallback.business_id || null,
          business: p.business?.name || null,
          cost: p.cost_price != null && p.cost_price !== '' ? n(p.cost_price) : null,
          perWarehouse: {},           // whId → { good, inspection, damaged, threshold, row }
          good: 0, inspection: 0, damaged: 0, transit: 0,
          damagedElsewhere: 0,        // damaged outside a warehouse (transit/park/delivery)
          thresholds: [],
          rows: [],
          transitItems: [],
          damagedItems: [],
        }
      }
      return products[key]
    }
    const slot = (p, whId) => {
      if (!p.perWarehouse[whId]) p.perWarehouse[whId] = { good: 0, inspection: 0, damaged: 0, threshold: 5, row: null }
      return p.perWarehouse[whId]
    }

    // Shelf stock
    for (const r of inventoryQ.data || []) {
      if (!whById[r.warehouse_id]) continue
      const p = ensure(r.product_id, { product: r.product, business_id: r.business_id, name: r.product?.name })
      if (!p.image_url && r.product?.image_url) p.image_url = r.product.image_url
      if (!p.sku && r.product?.sku) p.sku = r.product.sku
      if (p.cost == null && r.product?.cost_price != null) p.cost = n(r.product.cost_price)
      if (!p.category && r.product?.category?.name) p.category = r.product.category.name
      if (!p.business && r.business?.name) p.business = r.business.name
      const s = slot(p, r.warehouse_id)
      s.good += n(r.quantity_available)
      s.inspection += n(r.quantity_inspection)
      s.threshold = r.low_stock_threshold ?? 5
      s.row = r
      p.good += n(r.quantity_available)
      p.inspection += n(r.quantity_inspection)
      p.thresholds.push(r.low_stock_threshold ?? 5)
      p.rows.push(r)
    }

    // Damaged goods (open records)
    for (const d of damagedQ.data || []) {
      const p = ensure(d.product_id, { name: d.product_name, business_id: d.business_id })
      p.damaged += n(d.quantity)
      p.damagedItems.push(d)
      if (d.warehouse_id && whById[d.warehouse_id]) slot(p, d.warehouse_id).damaged += n(d.quantity)
      else p.damagedElsewhere += n(d.quantity)
    }

    // Goods on the move: order goods in transit + warehouse transfers
    const transit = []
    for (const t of transitQ.data || []) {
      const cat = t.product_id ? catalog[t.product_id] : null
      transit.push({
        id: `t:${t.id}`, kind: 'order', raw: t,
        product_id: t.product_id, name: t.product_name,
        sku: cat?.sku || null, image_url: cat?.image_url || null,
        quantity: n(t.quantity),
        from: t.from_warehouse?.name || t.from_label || 'Unknown origin',
        fromState: t.from_warehouse?.state || null,
        to: t.destination_type === 'warehouse'
          ? (whById[t.destination_warehouse_id]?.name || `${t.destination_state || '—'} warehouse`)
          : `Customer · ${t.destination_state || '—'}`,
        toState: t.destination_state || null,
        dispatchedAt: t.created_at,
        status: 'in_transit',
        reference: t.order_number,
      })
    }
    for (const t of transfersQ.data || []) {
      if (!['in_transit', 'at_park'].includes(t.status)) continue
      transit.push({
        id: `w:${t.id}`, kind: 'transfer', raw: t,
        product_id: t.product_id, name: t.product?.name || t.product_name,
        sku: t.product?.sku || catalog[t.product_id]?.sku || null,
        image_url: t.product?.image_url || catalog[t.product_id]?.image_url || null,
        quantity: n(t.quantity),
        from: t.from_warehouse?.name || '—', fromState: t.from_warehouse?.state || null,
        to: t.to_warehouse?.name || '—', toState: t.to_warehouse?.state || null,
        dispatchedAt: t.date_transferred || t.created_at,
        status: t.status,
        reference: t.transfer_number,
      })
    }
    transit.sort((a, b) => String(b.dispatchedAt || '').localeCompare(String(a.dispatchedAt || '')))
    for (const t of transit) {
      const p = ensure(t.product_id, { name: t.name })
      p.transit += t.quantity
      p.transitItems.push(t)
    }

    // Finish each product
    const list = Object.values(products).map(p => {
      const minThreshold = p.thresholds.length ? Math.max(...p.thresholds) : 5
      const tracked = p.rows.length > 0
      return {
        ...p,
        total: p.good + p.inspection + p.damaged + p.transit,
        value: p.cost != null ? p.good * p.cost : null,
        minThreshold,
        tracked,
        isOut: tracked && p.good <= 0,
        isLow: tracked && p.good > 0 && p.good <= minThreshold,
      }
    }).sort((a, b) => a.name.localeCompare(b.name))

    // Warehouses
    const whStats = warehouses.map(w => {
      const s = { ...w, good: 0, inspection: 0, damaged: 0, value: 0, missingCost: 0, products: 0, lowLines: 0, outLines: 0 }
      for (const p of list) {
        const x = p.perWarehouse[w.id]
        if (!x) continue
        s.good += x.good
        s.inspection += x.inspection
        s.damaged += x.damaged
        if (x.good > 0) {
          s.products += 1
          if (p.cost != null) s.value += x.good * p.cost
          else s.missingCost += 1
        }
        if (x.row) {
          if (x.good <= 0) s.outLines += 1
          else if (x.good <= x.threshold) s.lowLines += 1
        }
      }
      return s
    })
    const goodAll = whStats.reduce((a, w) => a + w.good, 0)
    for (const w of whStats) w.share = goodAll > 0 ? w.good / goodAll : 0
    whStats.sort((a, b) => b.good - a.good || a.name.localeCompare(b.name))

    const totals = {
      good: list.reduce((a, p) => a + p.good, 0),
      inspection: list.reduce((a, p) => a + p.inspection, 0),
      damaged: list.reduce((a, p) => a + p.damaged, 0),
      transit: transit.reduce((a, t) => a + t.quantity, 0),
      atPark: (parkQ.data || []).reduce((a, h) => a + n(h.quantity), 0),
      value: list.reduce((a, p) => a + (p.value || 0), 0),
      missingCost: list.filter(p => p.cost == null && p.good > 0).length,
      warehouses: warehouses.length,
      products: list.filter(p => p.tracked).length,
      low: list.filter(p => p.isLow).length,
      out: list.filter(p => p.isOut).length,
    }
    totals.total = totals.good + totals.inspection + totals.damaged + totals.transit

    return { products: list, warehouses: whStats, transit, totals, park: parkQ.data || [] }
  }, [user, inventoryQ.data, transitQ.data, transfersQ.data, damagedQ.data, parkQ.data, warehousesQ.data, productsQ.data])

  return {
    ...model,
    isLoading: inventoryQ.isLoading || warehousesQ.isLoading,
    // Tables not migrated yet (null) — screens show a setup note
    transitReady: transitQ.data !== null,
    damagedReady: damagedQ.data !== null,
    isAdmin: isCompanyAdmin(user),
    canEdit: canEditStock(user),
    limited: !!allowedWarehouseIds(user),
  }
}
