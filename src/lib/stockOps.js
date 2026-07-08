import { supabase } from './supabase'

// Stock side-effects for the order lifecycle. All best-effort: an order update
// must never fail because an inventory row is missing, so everything is
// wrapped and logged instead of thrown.
//
// Movement quantity sign convention (matches schema): positive = in, negative = out.
// Types used here: reserve (-), release (+), sale (-), return (+), damage (-), missing (-)

// Items on an order as [{ product_id, quantity }] — items_data JSONB first,
// then order_items table, then the order's own product_id as last resort.
export async function getOrderItems(order) {
  if (Array.isArray(order.items_data) && order.items_data.length > 0) {
    const withIds = order.items_data.filter(i => i.product_id)
    if (withIds.length > 0) {
      return withIds.map(i => ({ product_id: i.product_id, quantity: Number(i.quantity) || 1 }))
    }
  }
  try {
    const { data } = await supabase
      .from('order_items')
      .select('product_id, quantity')
      .eq('order_id', order.id)
    const rows = (data || []).filter(i => i.product_id)
    if (rows.length > 0) {
      return rows.map(i => ({ product_id: i.product_id, quantity: Number(i.quantity) || 1 }))
    }
  } catch { /* table may not exist */ }
  return order.product_id
    ? [{ product_id: order.product_id, quantity: Number(order.quantity) || 1 }]
    : []
}

// Reserve stock when an order is created. Picks the warehouse holding the most
// available stock for each product. Products not tracked in inventory are skipped.
export async function reserveStockForOrder(order, staffId) {
  try {
    const items = await getOrderItems(order)
    for (const item of items) {
      const { data: rows } = await supabase
        .from('inventory')
        .select('*')
        .eq('product_id', item.product_id)
        .order('quantity_available', { ascending: false })
      const row = (rows || [])[0]
      if (!row) continue

      await supabase.from('inventory').update({
        quantity_reserved: (row.quantity_reserved || 0) + item.quantity,
        quantity_available: (row.quantity_available || 0) - item.quantity,
      }).eq('id', row.id)

      await supabase.from('inventory_movements').insert({
        product_id: item.product_id,
        warehouse_id: row.warehouse_id,
        business_id: row.business_id,
        movement_type: 'reserve',
        quantity: -item.quantity,
        reference_id: order.id,
        reference_type: 'order',
        notes: `Reserved for ${order.order_number}`,
        staff_id: staffId,
      })
    }
  } catch (e) {
    console.warn('Stock reservation failed:', e)
  }
}

// Resolve an order's outstanding reservation when it reaches a terminal state.
// outcome: 'sold' (paid) | 'release' (cancelled) | 'returned' | 'damaged' | 'missing'
// Uses the order's own 'reserve' movements to know exactly which warehouse rows
// were reserved, and nets out already-resolved movements so it's idempotent.
export async function resolveOrderStock(order, outcome, staffId) {
  try {
    const { data: moves } = await supabase
      .from('inventory_movements')
      .select('*')
      .eq('reference_id', order.id)
      .eq('reference_type', 'order')
    const all = moves || []
    const reserves = all.filter(m => m.movement_type === 'reserve')
    if (reserves.length === 0) return
    const resolved = all.filter(m => ['sale', 'release', 'return', 'damage', 'missing'].includes(m.movement_type))

    // Net outstanding reservation per product+warehouse
    const key = m => `${m.product_id}|${m.warehouse_id}`
    const net = {}
    reserves.forEach(m => { net[key(m)] = (net[key(m)] || 0) + Math.abs(m.quantity) })
    resolved.forEach(m => { net[key(m)] = (net[key(m)] || 0) - Math.abs(m.quantity) })

    for (const [k, qty] of Object.entries(net)) {
      if (qty <= 0) continue
      const [product_id, warehouse_id] = k.split('|')
      const { data: row } = await supabase
        .from('inventory')
        .select('*')
        .eq('product_id', product_id)
        .eq('warehouse_id', warehouse_id)
        .single()
      if (!row) continue

      const upd = { quantity_reserved: Math.max(0, (row.quantity_reserved || 0) - qty) }
      let type, moveQty
      if (outcome === 'sold') {
        upd.quantity_sold     = (row.quantity_sold || 0) + qty
        upd.quantity_physical = Math.max(0, (row.quantity_physical || 0) - qty)
        type = 'sale'; moveQty = -qty
      } else if (outcome === 'returned') {
        upd.quantity_available = (row.quantity_available || 0) + qty
        upd.quantity_returned  = (row.quantity_returned || 0) + qty
        type = 'return'; moveQty = qty
      } else if (outcome === 'damaged') {
        upd.quantity_damaged  = (row.quantity_damaged || 0) + qty
        upd.quantity_physical = Math.max(0, (row.quantity_physical || 0) - qty)
        type = 'damage'; moveQty = -qty
      } else if (outcome === 'missing') {
        upd.quantity_physical = Math.max(0, (row.quantity_physical || 0) - qty)
        type = 'missing'; moveQty = -qty
      } else {
        // release — reservation returns to available stock
        upd.quantity_available = (row.quantity_available || 0) + qty
        type = 'release'; moveQty = qty
      }

      await supabase.from('inventory').update(upd).eq('id', row.id)
      await supabase.from('inventory_movements').insert({
        product_id,
        warehouse_id,
        business_id: row.business_id,
        movement_type: type,
        quantity: moveQty,
        reference_id: order.id,
        reference_type: 'order',
        notes: `${type === 'sale' ? 'Sold' : type === 'return' ? 'Returned to warehouse' : type === 'damage' ? 'Marked damaged' : type === 'missing' ? 'Marked missing' : 'Reservation released'} — ${order.order_number}`,
        staff_id: staffId,
      })
    }
  } catch (e) {
    console.warn('Stock resolution failed:', e)
  }
}
