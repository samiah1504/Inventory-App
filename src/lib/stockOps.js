import { supabase } from './supabase'
import {
  applyStock, isTracked, warehousesInState, mainWarehouse, stockWarning,
} from './inventoryCore'

// ═══════════════════════════════════════════════════════════════════
// Stock side-effects of the order lifecycle (Inventory v2).
//
//   Order created ............ nothing — orders never reserve stock
//   Waybilled (batch) ........ goods leave the source warehouse (Lagos)
//                              → Goods in Transit for that order
//   Received at warehouse .... in-transit goods join that state
//                              warehouse's stock
//   Delivered ................ staff record the Stock Source:
//                              our warehouse / supplier direct
//   Paid / part-paid ......... goods are deducted (from transit, or from
//                              the chosen warehouse; supplier direct = none)
//   Failed delivery .......... goods go to a park, a warehouse, another
//                              state, or the Damaged list
//
// Every function returns a list of warnings (never throws), so an order
// update is never blocked by stock — but nothing is hidden either: each
// warning is written on the order timeline and shown as a toast.
// ═══════════════════════════════════════════════════════════════════

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`

// Product lines on an order (only lines linked to a catalogue product)
export async function getOrderItems(order) {
  if (Array.isArray(order.items_data) && order.items_data.length > 0) {
    const withIds = order.items_data.filter(i => i.product_id)
    if (withIds.length > 0) {
      return withIds.map(i => ({
        product_id: i.product_id,
        product_name: i.product_name || i.name || order.product_name || 'Unknown',
        quantity: Number(i.quantity) || 1,
        color: i.color || null,
        size: i.size || null,
      }))
    }
  }
  try {
    const { data } = await supabase
      .from('order_items')
      .select('product_id, product_name, quantity, color, size')
      .eq('order_id', order.id)
    const rows = (data || []).filter(i => i.product_id)
    if (rows.length > 0) {
      return rows.map(i => ({
        product_id: i.product_id,
        product_name: i.product_name || 'Unknown',
        quantity: Number(i.quantity) || 1,
        color: i.color || null,
        size: i.size || null,
      }))
    }
  } catch { /* table may not exist */ }
  return order.product_id
    ? [{
        product_id: order.product_id, product_name: order.product_name || 'Unknown',
        quantity: Number(order.quantity) || 1, color: order.color || null, size: order.size || null,
      }]
    : []
}

// Every line on an order, including typed-in products with no catalogue id
// (synchronous — used by the stock badges on order cards too)
export function orderLines(order) {
  if (Array.isArray(order?.items_data) && order.items_data.length > 0) {
    return order.items_data.map(i => ({
      product_id: i.product_id || null,
      product_name: i.product_name || i.name || order.product_name || 'Unknown',
      quantity: Number(i.quantity) || 1,
      color: i.color || null,
      size: i.size || null,
    }))
  }
  if (!order) return []
  return [{
    product_id: order.product_id || null,
    product_name: order.product_name || 'Unknown',
    quantity: Number(order.quantity) || 1,
    color: order.color || null,
    size: order.size || null,
  }]
}

// Goods-in-transit rows for an order (null = table not migrated yet)
export async function transitForOrder(orderId) {
  if (!orderId) return []
  const { data, error } = await supabase.from('stock_in_transit')
    .select('*').eq('order_id', orderId).order('created_at')
  if (error) return null
  return data || []
}

// The warehouse in the order's state holding the most of its products
// (null when the state has no warehouse or none of the stock)
export async function bestStateWarehouse(order, items) {
  const whs = await warehousesInState(order.state, order.business_id)
  if (whs.length === 0) return null
  const pids = (items || []).map(i => i.product_id).filter(Boolean)
  if (pids.length === 0) return null
  const { data } = await supabase.from('inventory')
    .select('warehouse_id, product_id, quantity_available')
    .in('warehouse_id', whs.map(w => w.id))
    .in('product_id', pids)
  const score = {}
  for (const r of data || []) score[r.warehouse_id] = (score[r.warehouse_id] || 0) + Math.max(0, Number(r.quantity_available) || 0)
  const best = whs.filter(w => score[w.id] > 0).sort((a, b) => score[b.id] - score[a.id])[0]
  return best || null
}

async function setOrderStock(orderId, fields) {
  try { await supabase.from('orders').update(fields).eq('id', orderId) } catch { /* pre-migration */ }
}

async function closeTransit(ids, status, note, staff, extra = {}) {
  if (!ids.length) return
  const { error } = await supabase.from('stock_in_transit').update({
    status,
    closed_note: note || null,
    closed_at: new Date().toISOString(),
    closed_by_name: staff?.name || null,
    updated_at: new Date().toISOString(),
    ...extra,
  }).in('id', ids)
  if (error) throw new Error(error.message)
}

async function createTransit(fields, staff) {
  const { data, error } = await supabase.from('stock_in_transit').insert({
    created_by: staff?.id || null,
    created_by_name: staff?.name || null,
    status: 'in_transit',
    ...fields,
  }).select().single()
  if (error) throw new Error(error.message)
  return data
}

// Anything tagged damaged lands in the Damaged list
export async function recordDamaged(fields, staff) {
  const { error } = await supabase.from('damaged_goods').insert({
    status: 'damaged',
    recorded_by: staff?.id || null,
    recorded_by_name: staff?.name || null,
    ...fields,
  })
  if (error) throw new Error(error.message)
}

// Run one stock step; turn any failure into a visible warning
async function attempt(warnings, order, staff, label, fn) {
  try {
    return await fn()
  } catch (e) {
    warnings.push(await stockWarning(order, `${label} — ${e.message}`, staff))
    return null
  }
}

// ─── Waybill dispatch ─────────────────────────────────────────────────
// The batch is marked Waybilled: each order's goods leave the source
// warehouse now and become Goods in Transit for that order.
// source: { warehouseId?, label?, batchId?, fromHolding? }
export async function dispatchOrderStock(order, source, staff) {
  const warnings = []
  const existing = await transitForOrder(order.id)
  if (existing === null) {
    warnings.push(await stockWarning(order, 'Goods in Transit is not set up — run the Inventory v2 migration', staff))
    return warnings
  }
  if (existing.some(t => t.status === 'in_transit')) return warnings // already dispatched

  let wh = null
  if (!source?.fromHolding) {
    wh = source?.warehouseId
      ? (await supabase.from('warehouses').select('*').eq('id', source.warehouseId).single()).data
      : await mainWarehouse(order.business_id)
  }

  for (const line of orderLines(order)) {
    let deducted = 0
    if (wh && line.product_id && await isTracked(line.product_id)) {
      const res = await attempt(warnings, order, staff, `Could not take ${line.product_name} out of ${wh.name}`, () =>
        applyStock({
          productId: line.product_id, warehouseId: wh.id, businessId: order.business_id,
          qty: -line.quantity, clamp: true,
          type: 'waybill_out', refId: order.id, refType: 'order', staffId: staff?.id,
          notes: `Waybilled to ${order.state || 'customer'} — in transit for ${order.order_number}`,
        }))
      deducted = res ? -res.applied : 0
      if (res && deducted < line.quantity) {
        warnings.push(await stockWarning(order,
          `Only ${deducted} of ${line.quantity} ${line.product_name} were in ${wh.name} — ${line.quantity - deducted} not deducted. Check the stock or record it as supplier direct.`, staff))
      }
    }
    await attempt(warnings, order, staff, `Could not record ${line.product_name} as in transit`, () =>
      createTransit({
        product_id: line.product_id, product_name: line.product_name, quantity: line.quantity,
        deducted_qty: deducted, color: line.color, size: line.size,
        order_id: order.id, order_number: order.order_number, business_id: order.business_id || null,
        from_warehouse_id: wh?.id || null,
        from_label: wh ? wh.name : (source?.label || null),
        waybill_batch_id: source?.batchId || null,
        destination_state: order.state || null,
        destination_type: 'customer',
      }, staff))
  }
  if (!order.stock_source) await setOrderStock(order.id, { stock_source: 'warehouse' })
  return warnings
}

// ─── Received at the state warehouse ──────────────────────────────────
// In-transit goods join that warehouse's normal stock; the order is then
// sold from that warehouse when paid.
export async function receiveOrderStockAtWarehouse(order, staff) {
  const warnings = []
  const transit = await transitForOrder(order.id)
  if (transit === null) return warnings
  const open = transit.filter(t => t.status === 'in_transit')

  const whs = await warehousesInState(order.state, order.business_id)
  const dest = whs[0]
  if (!dest) {
    if (open.length) {
      warnings.push(await stockWarning(order,
        `No active warehouse in ${order.state || 'this state'} — goods stay in Goods in Transit until received manually`, staff))
    }
    return warnings
  }

  let lines = open
  // Nothing was waybilled from our stock (supplier goods, or older orders)
  // but the goods are now physically in our warehouse — count them in
  const freshArrival = open.length === 0 && order.stock_source !== 'warehouse' &&
    !order.stock_deducted_at && !transit.some(t => t.status === 'at_warehouse')
  if (freshArrival) lines = orderLines(order)

  for (const line of lines) {
    if (line.product_id) {
      await attempt(warnings, order, staff, `Could not add ${line.product_name} to ${dest.name}`, () =>
        applyStock({
          productId: line.product_id, warehouseId: dest.id, businessId: order.business_id,
          qty: line.quantity, type: 'transit_in', refId: order.id, refType: 'order', staffId: staff?.id,
          notes: `Received at ${dest.name} for ${order.order_number}`,
        }))
    }
  }
  if (open.length) {
    await attempt(warnings, order, staff, 'Could not close the in-transit record', () =>
      closeTransit(open.map(t => t.id), 'at_warehouse', `Received at ${dest.name}`, staff,
        { destination_warehouse_id: dest.id }))
  }
  if (open.length || freshArrival) {
    await setOrderStock(order.id, { stock_source: 'warehouse', stock_warehouse_id: dest.id })
  }
  return warnings
}

// ─── Paid / part-paid: the sale ───────────────────────────────────────
export async function deductSoldStock(order, staff) {
  const warnings = []
  if (order.stock_deducted_at) return warnings
  const { data: prior } = await supabase.from('inventory_movements').select('id')
    .eq('reference_id', order.id).eq('reference_type', 'order').in('movement_type', ['sale', 'sale_transit']).limit(1)
  if ((prior || []).length > 0) {
    await setOrderStock(order.id, { stock_deducted_at: new Date().toISOString() })
    return warnings
  }

  const transit = (await transitForOrder(order.id)) || []
  const shipped = transit.filter(t => ['in_transit', 'delivered'].includes(t.status))

  // Waybilled goods: already out of the warehouse — close them as delivered
  if (shipped.length > 0) {
    const open = shipped.filter(t => t.status === 'in_transit')
    await attempt(warnings, order, staff, 'Could not close Goods in Transit', () =>
      closeTransit(open.map(t => t.id), 'delivered', `Delivered & paid — ${order.order_number}`, staff))
    for (const t of shipped) {
      if (!t.product_id || !t.from_warehouse_id || !(t.deducted_qty > 0)) continue
      await attempt(warnings, order, staff, `Could not record the sale of ${t.product_name}`, () =>
        applyStock({
          productId: t.product_id, warehouseId: t.from_warehouse_id, businessId: order.business_id,
          sold: t.deducted_qty, type: 'sale_transit', movementQty: 0,
          refId: order.id, refType: 'order', staffId: staff?.id,
          notes: `Sold from Goods in Transit — ${order.order_number}`,
        }))
    }
    await setOrderStock(order.id, { stock_deducted_at: new Date().toISOString() })
    return warnings
  }

  if (order.stock_source === 'supplier_direct') return warnings

  const items = await getOrderItems(order)
  const tracked = []
  for (const i of items) if (await isTracked(i.product_id)) tracked.push(i)
  if (tracked.length === 0) return warnings

  let whId = order.stock_warehouse_id
  if (!whId) whId = (await bestStateWarehouse(order, tracked))?.id
  if (!whId) {
    warnings.push(await stockWarning(order,
      `Not deducted — no warehouse in ${order.state || 'this state'} holds this stock. If it came from a supplier, nothing to do; otherwise adjust the stock in Inventory.`, staff))
    return warnings
  }

  for (const i of tracked) {
    const res = await attempt(warnings, order, staff, `Could not deduct ${i.product_name}`, () =>
      applyStock({
        productId: i.product_id, warehouseId: whId, businessId: order.business_id,
        qty: -i.quantity, sold: i.quantity, clamp: true,
        type: 'sale', refId: order.id, refType: 'order', staffId: staff?.id,
        notes: `Sold — ${order.order_number}`,
      }))
    if (res && -res.applied < i.quantity) {
      warnings.push(await stockWarning(order,
        `Only ${-res.applied} of ${i.quantity} ${i.product_name} were in stock — ${i.quantity + res.applied} not deducted. Check the warehouse count.`, staff))
    }
  }
  await setOrderStock(order.id, {
    stock_deducted_at: new Date().toISOString(),
    stock_warehouse_id: whId,
    ...(order.stock_source ? {} : { stock_source: 'warehouse' }),
  })
  return warnings
}

// Cancelling never touches warehouse stock (nothing was reserved), but
// goods already on the road must be settled by hand
export async function cancelOrderStock(order, staff) {
  const warnings = []
  const open = ((await transitForOrder(order.id)) || []).filter(t => t.status === 'in_transit')
  if (open.length) {
    warnings.push(await stockWarning(order,
      `${plural(open.length, 'item')} still in transit for this cancelled order — settle ${open.length === 1 ? 'it' : 'them'} in Inventory → Goods in Transit`, staff))
  }
  return warnings
}

// Where are this order's goods right now?
async function goodsLocation(order) {
  const transit = (await transitForOrder(order.id)) || []
  const open = transit.filter(t => t.status === 'in_transit')
  if (open.length) return { kind: 'transit', rows: open }
  if (order.stock_deducted_at) return { kind: 'sold' }
  if (order.stock_source === 'supplier_direct') return { kind: 'supplier' }
  if (order.stock_warehouse_id) return { kind: 'warehouse', warehouseId: order.stock_warehouse_id }
  const items = await getOrderItems(order)
  const best = await bestStateWarehouse(order, items)
  return best ? { kind: 'warehouse', warehouseId: best.id } : { kind: 'supplier' }
}

// ─── Failed delivery: where did the goods end up? ─────────────────────
// outcome: legacy 'returned' | 'damaged' | 'missing', or
// { disposition: 'returned_warehouse' | 'left_at_park' | 'transferred_state' | 'damaged',
//   destinationState?, transferReason?, parkName?, parkLocation?, contact… }
const TRANSFER_REASON_LABELS = {
  customer_relocated: 'Customer relocated',
  another_order: 'Another customer order',
  stock_balancing: 'Stock balancing',
  management_instruction: 'Management instruction',
  other: 'Other',
}

export async function resolveFailedDeliveryStock(order, outcome, staff) {
  const warnings = []
  if (!outcome) return warnings
  const o = typeof outcome === 'string'
    ? { disposition: { returned: 'returned_warehouse', damaged: 'damaged', missing: 'missing' }[outcome] || outcome }
    : outcome
  const loc = await goodsLocation(order)
  if (loc.kind === 'sold') return warnings

  // Lines as they physically are: in-transit rows, or the order's lines
  const lines = loc.kind === 'transit'
    ? loc.rows.map(t => ({ ...t, transitId: t.id }))
    : orderLines(order)
  const transitIds = loc.kind === 'transit' ? loc.rows.map(t => t.id) : []
  const takeOut = (line, type, notes, extra = {}) => applyStock({
    productId: line.product_id, warehouseId: loc.warehouseId, businessId: order.business_id,
    qty: -line.quantity, clamp: true, type, refId: order.id, refType: 'order', staffId: staff?.id, notes, ...extra,
  })

  if (o.disposition === 'returned_warehouse') {
    const dest = (await warehousesInState(order.state, order.business_id))[0]
    if (!dest) {
      warnings.push(await stockWarning(order, `No active warehouse in ${order.state || 'this state'} — goods not added to any stock`, staff))
      return warnings
    }
    for (const line of lines) {
      if (!line.product_id) continue
      if (loc.kind === 'warehouse') {
        if (loc.warehouseId === dest.id) continue // never left the count
        await attempt(warnings, order, staff, `Could not move ${line.product_name}`, () =>
          takeOut(line, 'transfer_out', `Failed delivery — goods now at ${dest.name} (${order.order_number})`))
      }
      await attempt(warnings, order, staff, `Could not add ${line.product_name} to ${dest.name}`, () =>
        applyStock({
          productId: line.product_id, warehouseId: dest.id, businessId: order.business_id,
          qty: line.quantity, returned: line.quantity, type: 'return', refId: order.id, refType: 'order',
          staffId: staff?.id, notes: `Returned to ${dest.name} after failed delivery — ${order.order_number}`,
        }))
    }
    await attempt(warnings, order, staff, 'Could not close Goods in Transit', () =>
      closeTransit(transitIds, 'at_warehouse', `Failed delivery — returned to ${dest.name}`, staff, { destination_warehouse_id: dest.id }))
    return warnings
  }

  if (o.disposition === 'left_at_park') {
    for (const line of lines) {
      if (loc.kind === 'warehouse' && line.product_id) {
        await attempt(warnings, order, staff, `Could not take ${line.product_name} out of stock`, () =>
          takeOut(line, 'left_at_park', `Left at ${order.state} State Park after failed delivery — ${order.order_number}`))
      }
      await attempt(warnings, order, staff, `Could not add ${line.product_name} to Goods at Park`, () =>
        addToPark(order, line, o, staff))
    }
    await attempt(warnings, order, staff, 'Could not close Goods in Transit', () =>
      closeTransit(transitIds, 'at_park', `Failed delivery — left at ${o.parkName || `${order.state} State Park`}`, staff))
    return warnings
  }

  if (o.disposition === 'transferred_state') {
    if (!o.destinationState) return warnings
    const why = TRANSFER_REASON_LABELS[o.transferReason] || o.transferReason || 'no reason given'
    const toCustomer = ['customer_relocated', 'another_order'].includes(o.transferReason)
    if (loc.kind === 'transit') {
      const { error } = await supabase.from('stock_in_transit').update({
        destination_state: o.destinationState,
        destination_type: toCustomer ? 'customer' : 'warehouse',
        closed_note: `Re-routed to ${o.destinationState} after failed delivery — ${why}`,
        updated_at: new Date().toISOString(),
      }).in('id', transitIds)
      if (error) warnings.push(await stockWarning(order, `Could not re-route Goods in Transit — ${error.message}`, staff))
      return warnings
    }
    for (const line of lines) {
      let deducted = 0
      if (loc.kind === 'warehouse' && line.product_id) {
        const res = await attempt(warnings, order, staff, `Could not take ${line.product_name} out of stock`, () =>
          takeOut(line, 'transfer_out', `In transit to ${o.destinationState} after failed delivery — ${order.order_number}`))
        deducted = res ? -res.applied : 0
      }
      await attempt(warnings, order, staff, `Could not record ${line.product_name} as in transit`, () =>
        createTransit({
          product_id: line.product_id, product_name: line.product_name, quantity: line.quantity,
          deducted_qty: deducted, color: line.color, size: line.size,
          order_id: order.id, order_number: order.order_number, business_id: order.business_id || null,
          from_warehouse_id: loc.kind === 'warehouse' && deducted > 0 ? loc.warehouseId : null,
          from_label: `${order.state || ''} (failed delivery)`.trim(),
          destination_state: o.destinationState,
          destination_type: toCustomer ? 'customer' : 'warehouse',
          closed_note: `Failed delivery transfer — ${why}`,
        }, staff))
    }
    return warnings
  }

  if (o.disposition === 'damaged' || o.disposition === 'missing') {
    const missing = o.disposition === 'missing'
    for (const line of lines) {
      if (loc.kind === 'warehouse' && line.product_id) {
        await attempt(warnings, order, staff, `Could not take ${line.product_name} out of stock`, () =>
          takeOut(line, missing ? 'missing' : 'damage',
            `${missing ? 'Missing' : 'Damaged'} after failed delivery — ${order.order_number}`,
            missing ? {} : { damaged: line.quantity }))
      }
      if (!missing) {
        await attempt(warnings, order, staff, `Could not add ${line.product_name} to Damaged goods`, () =>
          recordDamaged({
            product_id: line.product_id, product_name: line.product_name, quantity: line.quantity,
            business_id: order.business_id || null,
            source: loc.kind === 'transit' ? 'in_transit' : 'delivery',
            warehouse_id: loc.kind === 'warehouse' ? loc.warehouseId : null,
            state: order.state || null,
            order_id: order.id, order_number: order.order_number,
            reference_id: line.transitId || null,
            reason: o.reason || 'Damaged — failed delivery',
          }, staff))
      }
    }
    await attempt(warnings, order, staff, 'Could not close Goods in Transit', () =>
      closeTransit(transitIds, missing ? 'missing' : 'damaged', `Failed delivery — ${missing ? 'missing' : 'damaged'}`, staff))
    return warnings
  }
  return warnings
}

// A product enters Goods at Park (the holding queue)
async function addToPark(order, line, o, staff) {
  const { data: holdRow, error } = await supabase.from('holding_queue').insert({
    product_id: line.product_id || null,
    product_name: line.product_name,
    quantity: line.quantity,
    state: order.state,
    city: order.city || null,
    park_name: o.parkName || null,
    park_location: o.parkLocation || null,
    contact_name: o.contactName || null,
    contact_phone: o.contactPhone || null,
    contact_role: o.contactRole || null,
    custodian_id: staff?.id || null,
    custodian_name: staff?.name || null,
    source_order_id: order.id,
    source_order_number: order.order_number,
    business_id: order.business_id || null,
    status: 'holding',
  }).select('id').single()
  if (error) throw new Error(error.message)
  await supabase.from('holding_queue')
    .update({ color: line.color || null, size: line.size || null }).eq('id', holdRow.id)
  await supabase.from('holding_history').insert({
    holding_id: holdRow.id,
    action: 'entered_queue',
    details: `Left at ${o.parkName || `${order.state} State Park`} after failed delivery of ${order.order_number}`,
    staff_id: staff?.id || null,
    staff_name: staff?.name || null,
  })
}

// ─── Returned goods ───────────────────────────────────────────────────
// A returned order never restocks automatically: a return record is
// created per product line and the inspection outcome decides.

async function addReturnTimeline(returnId, action, description, staff) {
  try {
    await supabase.from('return_timeline').insert({
      return_id: returnId,
      action,
      description,
      staff_id: staff?.id || null,
      staff_name: staff?.name || null,
    })
  } catch (e) { console.warn('Return timeline insert failed:', e) }
}
export { addReturnTimeline }

export async function startReturnProcess(order, staff) {
  const warnings = []
  const { error: probeErr } = await supabase.from('returns').select('id').limit(1)
  if (probeErr) {
    warnings.push(await stockWarning(order, 'Returns are not set up — run the returns migration; stock not changed', staff))
    return warnings
  }

  const transit = (await transitForOrder(order.id)) || []
  const open = transit.filter(t => t.status === 'in_transit')
  if (open.length) {
    await attempt(warnings, order, staff, 'Could not close Goods in Transit', () =>
      closeTransit(open.map(t => t.id), 'returned', `Returned — ${order.order_number}`, staff))
  }
  // Goods never left our count (sold from the shelf, not yet paid):
  // they move into the inspection bucket of that warehouse
  const stillCounted = !order.stock_deducted_at && order.stock_source === 'warehouse' &&
    order.stock_warehouse_id && !transit.some(t => ['in_transit', 'delivered'].includes(t.status))

  const items = orderLines(order)
  const year = new Date().getFullYear()
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    let warehouse_id = null
    if (stillCounted && item.product_id) {
      const res = await attempt(warnings, order, staff, `Could not move ${item.product_name} into inspection`, () =>
        applyStock({
          productId: item.product_id, warehouseId: order.stock_warehouse_id, businessId: order.business_id,
          inspection: item.quantity, type: 'return_inspection', movementQty: item.quantity,
          refId: order.id, refType: 'order', staffId: staff?.id,
          notes: `Awaiting inspection — ${order.order_number}`,
        }))
      if (res) warehouse_id = order.stock_warehouse_id
    }
    const { data: ret, error } = await supabase.from('returns').insert({
      return_number: `RET-${year}-${Date.now().toString().slice(-6)}${i > 0 ? `-${i + 1}` : ''}`,
      order_id: order.id,
      order_number: order.order_number,
      customer_name: order.customer_name,
      business_id: order.business_id,
      product_id: item.product_id || null,
      product_name: item.product_name,
      quantity: item.quantity,
      warehouse_id,
      status: 'awaiting_inspection',
      created_by: staff?.id || null,
    }).select().single()
    if (error) {
      warnings.push(await stockWarning(order, `Could not create the return record for ${item.product_name} — ${error.message}`, staff))
      continue
    }
    await addReturnTimeline(ret.id, 'return_requested', `Return requested for ${order.order_number}`, staff)
    if (warehouse_id) await addReturnTimeline(ret.id, 'received_inspection', 'Product received — awaiting inspection', staff)
  }
  return warnings
}

// Warehouse a returned product comes back into
async function returnWarehouseId(ret) {
  if (ret.warehouse_id) return ret.warehouse_id
  const { data: order } = await supabase.from('orders').select('*').eq('id', ret.order_id).maybeSingle()
  if (order?.stock_warehouse_id) return order.stock_warehouse_id
  if (order?.state) {
    const whs = await warehousesInState(order.state, order.business_id)
    if (whs[0]) return whs[0].id
  }
  return (await mainWarehouse(ret.business_id))?.id || null
}

// Apply the assessed outcome of a return to inventory.
// outcome: restocked | repair | damaged | written_off | supplier_return | display_item | other
export async function applyReturnOutcome(ret, outcome, staff) {
  const warnings = []
  const qty = Number(ret.quantity) || 1
  // Units already inside a warehouse's inspection bucket?
  const inInspection = !!ret.warehouse_id
  const whId = await returnWarehouseId(ret)
  const order = ret.order_id ? { id: ret.order_id } : null
  const base = {
    productId: ret.product_id, warehouseId: whId, businessId: ret.business_id,
    refId: ret.id, refType: 'return', staffId: staff?.id,
  }
  const out = (type, notes, extra = {}) => inInspection
    ? applyStock({ ...base, qty: -qty, inspection: -qty, type, notes, ...extra })
    : null
  const step = async (label, fn) => attempt(warnings, order, staff, `${label} (${ret.return_number})`, fn)

  if (outcome === 'damaged' || outcome === 'repair') {
    if (ret.product_id && whId) await step('Could not take the item out of stock', () =>
      out('damage', `${outcome === 'repair' ? 'Sent for repair' : 'Damaged'} — ${ret.return_number}`, { damaged: qty }))
    await step('Could not add the item to Damaged goods', () => recordDamaged({
      product_id: ret.product_id || null, product_name: ret.product_name, quantity: qty,
      business_id: ret.business_id || null, source: 'return', warehouse_id: whId,
      order_id: ret.order_id || null, order_number: ret.order_number || null, reference_id: ret.id,
      reason: ret.reason_note || ret.reason || (outcome === 'repair' ? 'Needs repair' : 'Damaged on return'),
      status: outcome === 'repair' ? 'repair' : 'damaged',
    }, staff))
    await addReturnTimeline(ret.id, 'inventory_updated', outcome === 'repair' ? 'Moved to Damaged goods — for repair' : 'Moved to Damaged goods', staff)
    return warnings
  }

  if (!ret.product_id || !whId) {
    await addReturnTimeline(ret.id, 'inventory_skipped', 'No product or warehouse on record — stock not updated', staff)
    return warnings
  }

  let desc = 'Return closed'
  if (outcome === 'restocked') {
    await step('Could not restock', () => applyStock({
      ...base, ...(inInspection ? { inspection: -qty } : { qty }), returned: qty,
      type: 'return', movementQty: qty, notes: `Returned to available stock — ${ret.return_number}`,
    }))
    desc = 'Returned to available stock'
  } else if (outcome === 'written_off') {
    await step('Could not write off', () => out('write_off', `Written off — ${ret.return_number}`))
    desc = 'Written off'
  } else if (outcome === 'supplier_return') {
    await step('Could not record the supplier return', () => out('supplier_return', `Returned to supplier — ${ret.return_number}`))
    desc = 'Returned to supplier'
  } else if (outcome === 'display_item') {
    await step('Could not record the display item', () => out('display_item', `Kept as display item — ${ret.return_number}`))
    desc = 'Kept as display item'
  }
  await addReturnTimeline(ret.id, 'inventory_updated', `${desc} (${plural(qty, 'unit')})`, staff)
  return warnings
}

const RETURN_DECISION_OUTCOMES = {
  returned_warehouse: 'restocked',
  returned_supplier:  'supplier_return',
  damaged:            'damaged',
  repair:             'repair',
  other:              'other',
}

// The decision happens on WhatsApp; the app records it and applies the
// matching stock action to the order's awaiting-inspection return records.
export async function recordReturnDecision(order, decision, notes, staff) {
  const warnings = []
  const { data: rows, error } = await supabase
    .from('returns').select('*')
    .eq('order_id', order.id).eq('status', 'awaiting_inspection')
  if (error) return warnings
  const outcome = RETURN_DECISION_OUTCOMES[decision]
  for (const ret of rows || []) {
    const label = `Operations decision: ${decision.replace(/_/g, ' ')}${notes ? ` — ${notes}` : ''}`
    if (outcome) {
      await supabase.from('returns').update({
        outcome,
        outcome_note: notes || null,
        customer_resolution: ret.customer_resolution || 'no_refund',
        status: 'completed',
        processed_by: staff?.id || null,
        processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', ret.id)
      await addReturnTimeline(ret.id, 'decision', label, staff)
      warnings.push(...await applyReturnOutcome(ret, outcome, staff))
    } else if (decision === 'customer_refunded' || decision === 'product_exchanged') {
      await supabase.from('returns').update({
        customer_resolution: decision === 'customer_refunded' ? 'full_refund' : 'exchanged',
        updated_at: new Date().toISOString(),
      }).eq('id', ret.id)
      await addReturnTimeline(ret.id, 'decision', label, staff)
    } else if (decision === 'send_another_state') {
      await addReturnTimeline(ret.id, 'decision', label, staff)
    }
  }
  return warnings
}

// Returned product leaves for another state: it becomes Goods in Transit
// for the order and joins that state's warehouse on Received at Warehouse
export async function sendReturnToAnotherState(order, destinationState, staff) {
  const warnings = []
  const { data: rows } = await supabase
    .from('returns').select('*')
    .eq('order_id', order.id)
    .in('status', ['awaiting_inspection', 'completed'])
  for (let ret of rows || []) {
    const qty = Number(ret.quantity) || 1
    let deducted = 0
    if (ret.product_id && ret.warehouse_id && ret.status === 'awaiting_inspection') {
      const res = await attempt(warnings, order, staff, `Could not take ${ret.product_name} out of inspection`, () =>
        applyStock({
          productId: ret.product_id, warehouseId: ret.warehouse_id, businessId: ret.business_id,
          qty: -qty, inspection: -qty, type: 'waybill_out', refId: order.id, refType: 'order', staffId: staff?.id,
          notes: `Returned stock sent to ${destinationState} — ${order.order_number}`,
        }))
      if (res) deducted = qty
    } else if (ret.product_id && ret.status === 'completed' && ret.outcome === 'restocked') {
      // Already back on the shelf — it leaves that warehouse again
      const whId = await returnWarehouseId(ret)
      const res = whId && await attempt(warnings, order, staff, `Could not take ${ret.product_name} out of stock`, () =>
        applyStock({
          productId: ret.product_id, warehouseId: whId, businessId: ret.business_id,
          qty: -qty, clamp: true, type: 'waybill_out', refId: order.id, refType: 'order', staffId: staff?.id,
          notes: `Returned stock sent to ${destinationState} — ${order.order_number}`,
        }))
      if (res) { deducted = -res.applied; ret = { ...ret, warehouse_id: whId } }
    }
    await attempt(warnings, order, staff, `Could not record ${ret.product_name} as in transit`, () =>
      createTransit({
        product_id: ret.product_id || null, product_name: ret.product_name, quantity: qty,
        deducted_qty: deducted, order_id: order.id, order_number: order.order_number,
        business_id: ret.business_id || order.business_id || null,
        from_warehouse_id: deducted ? ret.warehouse_id : null,
        from_label: deducted ? null : 'Returned goods',
        destination_state: destinationState, destination_type: 'warehouse',
      }, staff))
    if (ret.status === 'awaiting_inspection') {
      await supabase.from('returns').update({
        outcome: 'other',
        outcome_note: `Sent to ${destinationState}`,
        status: 'completed',
        processed_by: staff?.id || null,
        processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', ret.id)
    }
    await addReturnTimeline(ret.id, 'sent_to_park', `Sent to ${destinationState} via State Park`, staff)
  }
  return warnings
}
