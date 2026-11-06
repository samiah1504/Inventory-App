import { supabase } from './supabase'
import { applyStock } from './inventoryCore'

// CEO-only correction of the product line(s) on an existing order — for
// fixing genuine data-entry mistakes without cancelling and recreating the
// order. Rewrites the order's line items, keeps money and stock consistent,
// and records everything in the timeline. Documents (invoice, receipt,
// delivery note, packing PDF, waybill packing lists) and all reports render
// from the order rows, so they pick up the corrected product automatically.

// The order's current lines with full detail (price/variant included)
export function currentOrderLines(order) {
  if (Array.isArray(order.items_data) && order.items_data.length > 0) {
    return order.items_data.map(i => ({
      product_id: i.product_id || null,
      product_name: i.product_name || i.name || '',
      quantity: Number(i.quantity) || 1,
      unit_price: Number(i.unit_price) || 0,
      color: i.color || '',
      size: i.size || '',
      cost_price: i.cost_price ?? null,
    }))
  }
  if (Array.isArray(order.items) && order.items.length > 0) {
    return order.items.map(i => ({
      product_id: i.product_id || null,
      product_name: i.product_name || '',
      quantity: Number(i.quantity) || 1,
      unit_price: Number(i.unit_price) || 0,
      color: i.color || '',
      size: i.size || '',
      cost_price: i.cost_price ?? null,
    }))
  }
  return [{
    product_id: order.product_id || null,
    product_name: order.product_name || '',
    quantity: Number(order.quantity) || 1,
    unit_price: Number(order.unit_price) || 0,
    color: order.color || '',
    size: order.size || '',
    cost_price: null,
  }]
}

// Where does this order's stock currently stand?
//   'sold'    — sale movements recorded (paid from a warehouse shelf)
//   'transit' — goods are out of the warehouse in Goods in Transit
//   'none'    — nothing deducted yet (orders never reserve stock)
async function getStockStage(order) {
  let moves = []
  try {
    const { data } = await supabase.from('inventory_movements')
      .select('*').eq('reference_id', order.id).eq('reference_type', 'order')
    moves = data || []
  } catch { moves = [] }

  const key = m => `${m.product_id}|${m.warehouse_id}`
  const soldByProduct = {}
  moves.filter(m => m.movement_type === 'sale')
    .forEach(m => { soldByProduct[key(m)] = (soldByProduct[key(m)] || 0) + Math.abs(m.quantity) })
  moves.filter(m => ['correction_in', 'sale_reversed'].includes(m.movement_type))
    .forEach(m => { soldByProduct[key(m)] = (soldByProduct[key(m)] || 0) - Math.abs(m.quantity) })

  if (Object.values(soldByProduct).some(q => q > 0)) return { stage: 'sold', soldByProduct }
  try {
    const { data: tr } = await supabase.from('stock_in_transit').select('id')
      .eq('order_id', order.id).in('status', ['in_transit', 'delivered']).limit(1)
    if (tr && tr.length > 0) return { stage: 'transit', soldByProduct }
  } catch { /* not migrated */ }
  return { stage: 'none', soldByProduct }
}

// Per-product quantity map from a list of lines
function qtyByProduct(lines) {
  const m = {}
  lines.forEach(l => {
    if (!l.product_id) return
    m[l.product_id] = (m[l.product_id] || 0) + (Number(l.quantity) || 1)
  })
  return m
}

// Availability check for the products being added — used for the
// negative-stock warning before the CEO confirms
export async function checkStockAvailability(order, newLines) {
  const oldQty = qtyByProduct(currentOrderLines(order))
  const newQty = qtyByProduct(newLines)
  const warnings = []
  for (const [pid, qty] of Object.entries(newQty)) {
    const delta = qty - (oldQty[pid] || 0)
    if (delta <= 0) continue
    try {
      const { data: rows } = await supabase.from('inventory')
        .select('quantity_available, product_id').eq('product_id', pid)
      if (!rows || rows.length === 0) continue // untracked product — no warning
      const available = rows.reduce((s, r) => s + (Number(r.quantity_available) || 0), 0)
      if (available < delta) {
        const line = newLines.find(l => l.product_id === pid)
        warnings.push(`${line?.product_name || 'Product'}: only ${available} available, correction needs ${delta} — only what is in stock will be deducted`)
      }
    } catch { /* inventory unavailable — skip the check */ }
  }
  return warnings
}

// Best-stocked inventory row for a product
async function bestRow(productId) {
  const { data: rows } = await supabase.from('inventory')
    .select('*').eq('product_id', productId)
    .order('quantity_available', { ascending: false })
  return (rows || [])[0] || null
}

// Apply the correction. newLines: [{ product_id, product_name, quantity,
// unit_price, color, size, cost_price }]. Returns a summary for the toast.
export async function correctOrderProducts({ order, newLines, reason, user }) {
  const oldLines = currentOrderLines(order)
  const { stage, soldByProduct } = await getStockStage(order)

  // ── Inventory: only a recorded sale is corrected (by the per-product
  // DELTA between old and new). Before payment nothing was deducted, so
  // the corrected lines are simply what gets deducted later. ──
  const oldQty = qtyByProduct(oldLines)
  const newQty = qtyByProduct(newLines)
  const productIds = Array.from(new Set([...Object.keys(oldQty), ...Object.keys(newQty)]))
  const stockNotes = []

  for (const pid of productIds) {
    const delta = (newQty[pid] || 0) - (oldQty[pid] || 0)
    if (delta === 0 || stage !== 'sold') continue
    const nameOf = [...newLines, ...oldLines].find(l => l.product_id === pid)?.product_name || 'product'

    try {
      if (delta < 0) {
        // Un-sell: the recorded sale was wrong, stock returns to the shelf
        let toReverse = -delta
        const slots = Object.entries(soldByProduct)
          .filter(([k, q]) => k.startsWith(`${pid}|`) && q > 0)
          .sort(([, a], [, b]) => b - a)
        for (const [k, q] of slots) {
          if (toReverse <= 0) break
          const whId = k.split('|')[1]
          const qty = Math.min(q, toReverse)
          await applyStock({
            productId: pid, warehouseId: whId, businessId: order.business_id,
            qty, sold: -qty, type: 'correction_in', refId: order.id, refType: 'order', staffId: user?.id,
            notes: `Product correction — recorded sale reversed (${order.order_number})`,
          })
          toReverse -= qty
        }
        if (toReverse > 0) stockNotes.push(`${nameOf}: ${toReverse} unit(s) had no recorded sale to reverse`)
      } else {
        const whId = order.stock_warehouse_id || (await bestRow(pid))?.warehouse_id
        if (!whId) { stockNotes.push(`${nameOf}: not tracked in inventory — no stock change`); continue }
        const res = await applyStock({
          productId: pid, warehouseId: whId, businessId: order.business_id,
          qty: -delta, sold: delta, clamp: true, type: 'sale', refId: order.id, refType: 'order', staffId: user?.id,
          notes: `Product correction — sold with ${order.order_number}`,
        })
        if (-res.applied < delta) stockNotes.push(`${nameOf}: only ${-res.applied} of ${delta} were in stock — the rest was not deducted`)
      }
    } catch (e) {
      stockNotes.push(`${nameOf}: stock not adjusted — ${e.message}`)
    }
  }
  if (stage === 'transit') {
    stockNotes.push('Goods for this order are in Goods in Transit — their product lines there were not changed; settle any difference in Inventory')
  } else if (stage === 'none') {
    stockNotes.push('No stock adjustment needed — stock is only deducted when the order is paid')
  }

  // ── The order row: line items, product fields, money ──
  const cleanLines = newLines.map(l => ({
    product_id: l.product_id || null,
    product_name: (l.product_name || '').trim(),
    quantity: Number(l.quantity) || 1,
    unit_price: Number(l.unit_price) || 0,
    total_amount: (Number(l.quantity) || 1) * (Number(l.unit_price) || 0),
    color: l.color || null,
    size: l.size || null,
    cost_price: l.cost_price != null && l.cost_price !== '' ? Number(l.cost_price) : null,
  }))
  const newTotal = cleanLines.reduce((s, l) => s + l.total_amount, 0)
  const first = cleanLines[0]
  const summaryName = cleanLines.length === 1
    ? first.product_name
    : `${first.product_name} +${cleanLines.length - 1} more`

  const patch = {
    product_id: first.product_id,
    product_name: summaryName,
    quantity: first.quantity,
    unit_price: first.unit_price,
    color: first.color,
    size: first.size,
    total_amount: newTotal,
    items_data: cleanLines,
    updated_at: new Date().toISOString(),
  }
  // A part-paid order's balance follows the corrected total; what the
  // customer actually paid is never touched
  if (order.amount_paid != null && Number(order.amount_paid) > 0 && order.status !== 'paid') {
    patch.balance_amount = Math.max(0, newTotal - Number(order.amount_paid))
  }
  const { error } = await supabase.from('orders').update(patch).eq('id', order.id)
  if (error) throw new Error(error.message)
  // Verify the write landed (a silently-blocked update must never pass)
  const { data: check } = await supabase.from('orders')
    .select('total_amount, product_name').eq('id', order.id).single()
  if (check?.product_name !== summaryName) {
    throw new Error('The database did not accept the correction. Nothing was changed on the order.')
  }

  // order_items table (used by packing lists) — rebuild to match
  try {
    await supabase.from('order_items').delete().eq('order_id', order.id)
    for (const l of cleanLines) {
      const { cost_price, ...core } = l
      const { data: created } = await supabase.from('order_items')
        .insert({ order_id: order.id, ...core }).select('id').single()
      if (created?.id && cost_price != null) {
        await supabase.from('order_items').update({ cost_price }).eq('id', created.id)
      }
    }
  } catch { /* order_items may not exist yet — items_data is authoritative */ }

  // ── Timeline: full before/after record ──
  const fmt = (ls) => ls.map(l =>
    `${l.product_name} × ${l.quantity}${l.color ? `, ${l.color}` : ''}${l.size ? `, ${l.size}` : ''} @ ₦${Number(l.unit_price).toLocaleString()}`
  ).join('; ')
  await supabase.from('order_timeline').insert({
    order_id: order.id,
    action: 'product_corrected',
    description: `CEO corrected product — Previous: ${fmt(oldLines)} → New: ${fmt(cleanLines)}`
      + (Number(order.total_amount) !== newTotal ? ` — Total ₦${Number(order.total_amount || 0).toLocaleString()} → ₦${newTotal.toLocaleString()}` : '')
      + ` — Reason: ${reason.trim()} — by ${user?.name} (${user?.role})`,
    staff_id: user?.id || null,
    staff_name: user?.name || null,
  })

  return { newTotal, stockNotes, stage }
}
