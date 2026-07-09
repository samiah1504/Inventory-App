import { supabase } from './supabase'

// Stock side-effects for the order lifecycle. All best-effort: an order update
// must never fail because an inventory row is missing, so everything is
// wrapped and logged instead of thrown.
//
// Movement quantity sign convention (matches schema): positive = in, negative = out.
// Types used here: reserve (-), release (+), sale (-), return (+), damage (-), missing (-)

// Items on an order as [{ product_id, product_name, quantity }] — items_data
// JSONB first, then order_items table, then the order's own fields as last resort.
export async function getOrderItems(order) {
  if (Array.isArray(order.items_data) && order.items_data.length > 0) {
    const withIds = order.items_data.filter(i => i.product_id)
    if (withIds.length > 0) {
      return withIds.map(i => ({
        product_id: i.product_id,
        product_name: i.product_name || i.name || order.product_name || 'Unknown',
        quantity: Number(i.quantity) || 1,
      }))
    }
  }
  try {
    const { data } = await supabase
      .from('order_items')
      .select('product_id, product_name, quantity')
      .eq('order_id', order.id)
    const rows = (data || []).filter(i => i.product_id)
    if (rows.length > 0) {
      return rows.map(i => ({
        product_id: i.product_id,
        product_name: i.product_name || 'Unknown',
        quantity: Number(i.quantity) || 1,
      }))
    }
  } catch { /* table may not exist */ }
  return order.product_id
    ? [{ product_id: order.product_id, product_name: order.product_name || 'Unknown', quantity: Number(order.quantity) || 1 }]
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

// When an order is marked received at the destination warehouse, the goods are
// physically there — stock (still reserved for the order) moves to a warehouse
// in the order's state automatically, without a manual transfer. Products not
// tracked in inventory get a stock record created at the destination.
export async function receiveOrderStockAtWarehouse(order, staff) {
  try {
    if (!order.state) return
    const { data: destRows } = await supabase
      .from('warehouses')
      .select('*')
      .eq('state', order.state)
      .eq('is_active', true)
    const dest = (destRows || [])[0]
    if (!dest) return

    const { data: moves } = await supabase
      .from('inventory_movements')
      .select('*')
      .eq('reference_id', order.id)
      .eq('reference_type', 'order')
    const all = moves || []

    // Where is each product's outstanding reservation right now?
    const key = m => `${m.product_id}|${m.warehouse_id}`
    const net = {}
    all.filter(m => m.movement_type === 'reserve')
      .forEach(m => { net[key(m)] = (net[key(m)] || 0) + Math.abs(m.quantity) })
    all.filter(m => ['sale', 'release', 'return', 'damage', 'missing', 'return_inspection', 'reserve_out'].includes(m.movement_type))
      .forEach(m => { net[key(m)] = (net[key(m)] || 0) - Math.abs(m.quantity) })
    const reservedAt = {}
    Object.entries(net).forEach(([k, qty]) => {
      if (qty <= 0) return
      const [product_id, warehouse_id] = k.split('|')
      reservedAt[product_id] = { warehouse_id, qty }
    })

    const items = await getOrderItems(order)
    for (const item of items) {
      if (!item.product_id) continue
      const existing = reservedAt[item.product_id]

      // Already reserved at the destination — nothing to move
      if (existing && existing.warehouse_id === dest.id) continue

      const qty = existing ? Math.min(existing.qty, item.quantity) : item.quantity

      // Take the reserved goods out of the source warehouse
      if (existing) {
        const { data: src } = await supabase
          .from('inventory')
          .select('*')
          .eq('product_id', item.product_id)
          .eq('warehouse_id', existing.warehouse_id)
          .single()
        if (src) {
          await supabase.from('inventory').update({
            quantity_reserved: Math.max(0, (src.quantity_reserved || 0) - qty),
            quantity_physical: Math.max(0, (src.quantity_physical || 0) - qty),
          }).eq('id', src.id)
          await supabase.from('inventory_movements').insert({
            product_id: item.product_id, warehouse_id: src.warehouse_id, business_id: src.business_id,
            movement_type: 'reserve_out',
            quantity: -qty,
            reference_id: order.id, reference_type: 'order',
            notes: `Moved to ${dest.name} with ${order.order_number}`,
            staff_id: staff?.id || null,
          })
        }
      }

      // Put the goods (still reserved for this order) into the destination
      const { data: destRow } = await supabase
        .from('inventory')
        .select('*')
        .eq('product_id', item.product_id)
        .eq('warehouse_id', dest.id)
        .single()
      if (destRow) {
        await supabase.from('inventory').update({
          quantity_physical: (destRow.quantity_physical || 0) + qty,
          quantity_reserved: (destRow.quantity_reserved || 0) + qty,
        }).eq('id', destRow.id)
      } else {
        await supabase.from('inventory').insert({
          product_id: item.product_id,
          warehouse_id: dest.id,
          business_id: order.business_id || null,
          quantity_physical: qty,
          quantity_reserved: qty,
          quantity_available: 0,
        })
      }
      await supabase.from('inventory_movements').insert({
        product_id: item.product_id, warehouse_id: dest.id, business_id: order.business_id || null,
        movement_type: 'reserve',
        quantity: qty,
        reference_id: order.id, reference_type: 'order',
        notes: `Received at ${dest.name} — held for ${order.order_number}`,
        staff_id: staff?.id || null,
      })
    }
  } catch (e) {
    console.warn('Receive-at-warehouse stock update failed:', e)
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
    const resolved = all.filter(m => ['sale', 'release', 'return', 'damage', 'missing', 'reserve_out'].includes(m.movement_type))

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

// ─── Returned goods management ───────────────────────────────────────────────
//
// A returned order never restocks automatically. Stock moves into an
// "awaiting inspection" bucket and a return-assessment record is created;
// only processing the assessment (reason + outcome + customer resolution)
// moves the stock to its final destination.

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

// Called when an order is marked "returned". Creates one return record per
// product line, moves any outstanding reservation into the inspection bucket.
// Falls back to the legacy direct-restock if the returns table doesn't exist.
export async function startReturnProcess(order, staff) {
  try {
    // Outstanding reservations per product+warehouse (same netting as resolveOrderStock)
    const { data: moves } = await supabase
      .from('inventory_movements')
      .select('*')
      .eq('reference_id', order.id)
      .eq('reference_type', 'order')
    const all = moves || []
    const reserves = all.filter(m => m.movement_type === 'reserve')
    const resolved = all.filter(m => ['sale', 'release', 'return', 'damage', 'missing', 'return_inspection', 'reserve_out'].includes(m.movement_type))
    const key = m => `${m.product_id}|${m.warehouse_id}`
    const net = {}
    reserves.forEach(m => { net[key(m)] = (net[key(m)] || 0) + Math.abs(m.quantity) })
    resolved.forEach(m => { net[key(m)] = (net[key(m)] || 0) - Math.abs(m.quantity) })
    const reservedByProduct = {}
    Object.entries(net).forEach(([k, qty]) => {
      if (qty <= 0) return
      const [product_id, warehouse_id] = k.split('|')
      reservedByProduct[product_id] = { warehouse_id, qty }
    })

    const items = await getOrderItems(order)
    const year = new Date().getFullYear()
    let created = 0

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const reservation = item.product_id ? reservedByProduct[item.product_id] : null
      const warehouse_id = reservation?.warehouse_id || null

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

      if (error) throw error
      created++

      await addReturnTimeline(ret.id, 'return_requested', `Return requested for ${order.order_number}`, staff)

      // Move the outstanding reservation into the inspection bucket
      if (reservation) {
        const qty = Math.min(reservation.qty, item.quantity)
        const { data: row } = await supabase
          .from('inventory')
          .select('*')
          .eq('product_id', item.product_id)
          .eq('warehouse_id', warehouse_id)
          .single()
        if (row) {
          const upd = { quantity_reserved: Math.max(0, (row.quantity_reserved || 0) - qty) }
          if ('quantity_inspection' in row) upd.quantity_inspection = (row.quantity_inspection || 0) + qty
          await supabase.from('inventory').update(upd).eq('id', row.id)
          await supabase.from('inventory_movements').insert({
            product_id: item.product_id, warehouse_id, business_id: row.business_id,
            movement_type: 'return_inspection',
            quantity: qty,
            reference_id: order.id,
            reference_type: 'order',
            notes: `Awaiting inspection — ${order.order_number}`,
            staff_id: staff?.id || null,
          })
          await addReturnTimeline(ret.id, 'received_inspection', 'Product received — awaiting inspection', staff)
        }
      }
    }
    return created > 0
  } catch (e) {
    // returns table probably missing — fall back to the legacy direct restock
    console.warn('Return process unavailable, falling back to direct restock:', e)
    await resolveOrderStock(order, 'returned', staff?.id)
    return false
  }
}

// Apply the assessed outcome of a return to inventory.
// outcome: restocked | repair | damaged | written_off | supplier_return | display_item | other
export async function applyReturnOutcome(ret, outcome, staff) {
  try {
    let row = null
    if (ret.product_id) {
      if (ret.warehouse_id) {
        const { data } = await supabase.from('inventory').select('*')
          .eq('product_id', ret.product_id).eq('warehouse_id', ret.warehouse_id).single()
        row = data
      } else {
        const { data } = await supabase.from('inventory').select('*')
          .eq('product_id', ret.product_id)
          .order('quantity_available', { ascending: false })
        row = (data || [])[0] || null
      }
    }
    if (!row) {
      await addReturnTimeline(ret.id, 'inventory_skipped', 'No inventory record for this product — stock not updated', staff)
      return
    }

    const qty = Number(ret.quantity) || 1
    const hasInspection = 'quantity_inspection' in row
    const upd = { quantity_returned: (row.quantity_returned || 0) + qty }
    if (hasInspection) upd.quantity_inspection = Math.max(0, (row.quantity_inspection || 0) - qty)

    let type = 'return_other', moveQty = 0, desc = 'Return closed'
    if (outcome === 'restocked') {
      upd.quantity_available = (row.quantity_available || 0) + qty
      type = 'return'; moveQty = qty; desc = 'Returned to available stock'
    } else if (outcome === 'repair') {
      if ('quantity_repair' in row) upd.quantity_repair = (row.quantity_repair || 0) + qty
      type = 'repair'; moveQty = qty; desc = 'Sent for repair'
    } else if (outcome === 'damaged') {
      upd.quantity_damaged  = (row.quantity_damaged || 0) + qty
      upd.quantity_physical = Math.max(0, (row.quantity_physical || 0) - qty)
      type = 'damage'; moveQty = -qty; desc = 'Marked damaged'
    } else if (outcome === 'written_off') {
      upd.quantity_physical = Math.max(0, (row.quantity_physical || 0) - qty)
      type = 'write_off'; moveQty = -qty; desc = 'Written off'
    } else if (outcome === 'supplier_return') {
      upd.quantity_physical = Math.max(0, (row.quantity_physical || 0) - qty)
      type = 'supplier_return'; moveQty = -qty; desc = 'Returned to supplier'
    } else if (outcome === 'display_item') {
      type = 'display_item'; moveQty = 0; desc = 'Kept as display item'
    }

    await supabase.from('inventory').update(upd).eq('id', row.id)
    await supabase.from('inventory_movements').insert({
      product_id: ret.product_id,
      warehouse_id: row.warehouse_id,
      business_id: row.business_id,
      movement_type: type,
      quantity: moveQty,
      reference_id: ret.id,
      reference_type: 'return',
      notes: `${desc} — ${ret.return_number}`,
      staff_id: staff?.id || null,
    })
    await addReturnTimeline(ret.id, 'inventory_updated', `${desc} (${qty} unit${qty !== 1 ? 's' : ''} at ${row.warehouse_id === ret.warehouse_id ? 'return warehouse' : 'best-stocked warehouse'})`, staff)
  } catch (e) {
    console.warn('Return outcome inventory update failed:', e)
  }
}

export { addReturnTimeline }
