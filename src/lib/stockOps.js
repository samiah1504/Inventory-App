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

    // Re-shipped returned stock isn't held for a customer — it lands available
    const asAvailable = order.return_decision === 'send_another_state'

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
          ...(asAvailable
            ? { quantity_available: (destRow.quantity_available || 0) + qty }
            : { quantity_reserved: (destRow.quantity_reserved || 0) + qty }),
        }).eq('id', destRow.id)
      } else {
        await supabase.from('inventory').insert({
          product_id: item.product_id,
          warehouse_id: dest.id,
          business_id: order.business_id || null,
          quantity_physical: qty,
          quantity_reserved: asAvailable ? 0 : qty,
          quantity_available: asAvailable ? qty : 0,
        })
      }
      await supabase.from('inventory_movements').insert({
        product_id: item.product_id, warehouse_id: dest.id, business_id: order.business_id || null,
        movement_type: asAvailable ? 'return' : 'reserve',
        quantity: qty,
        reference_id: order.id, reference_type: 'order',
        notes: asAvailable
          ? `Returned stock received at ${dest.name} — available (${order.order_number})`
          : `Received at ${dest.name} — held for ${order.order_number}`,
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
  // Probe the returns table first — if the migration hasn't run, use the
  // legacy direct restock. Checked up-front so a mid-loop failure later can
  // never trigger a second, duplicate stock update.
  const { error: probeErr } = await supabase.from('returns').select('id').limit(1)
  if (probeErr) {
    console.warn('Returns table unavailable, falling back to direct restock:', probeErr)
    await resolveOrderStock(order, 'returned', staff?.id)
    return false
  }

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
    console.warn('Return process failed:', e)
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

    // Did the goods enter the inspection bucket when the return started?
    // ret.warehouse_id is only set when an outstanding reservation was moved
    // into inspection — in that case the units are still inside
    // quantity_physical. Otherwise (order already paid/sold, or product was
    // never reserved) the units are coming back from OUTSIDE inventory, so
    // outcomes must add them back rather than deduct a second time.
    const inInspection = !!ret.warehouse_id
    const hasInspection = 'quantity_inspection' in row
    const upd = { quantity_returned: (row.quantity_returned || 0) + qty }
    if (inInspection && hasInspection) {
      upd.quantity_inspection = Math.max(0, (row.quantity_inspection || 0) - qty)
    }

    let type = 'return_other', moveQty = 0, desc = 'Return closed'
    if (outcome === 'restocked') {
      upd.quantity_available = (row.quantity_available || 0) + qty
      if (!inInspection) upd.quantity_physical = (row.quantity_physical || 0) + qty
      type = 'return'; moveQty = qty; desc = 'Returned to available stock'
    } else if (outcome === 'repair') {
      if ('quantity_repair' in row) upd.quantity_repair = (row.quantity_repair || 0) + qty
      if (!inInspection) upd.quantity_physical = (row.quantity_physical || 0) + qty
      type = 'repair'; moveQty = qty; desc = 'Sent for repair'
    } else if (outcome === 'damaged') {
      upd.quantity_damaged = (row.quantity_damaged || 0) + qty
      if (inInspection) upd.quantity_physical = Math.max(0, (row.quantity_physical || 0) - qty)
      type = 'damage'; moveQty = -qty; desc = 'Marked damaged'
    } else if (outcome === 'written_off') {
      if (inInspection) upd.quantity_physical = Math.max(0, (row.quantity_physical || 0) - qty)
      type = 'write_off'; moveQty = -qty; desc = 'Written off'
    } else if (outcome === 'supplier_return') {
      if (inInspection) upd.quantity_physical = Math.max(0, (row.quantity_physical || 0) - qty)
      type = 'supplier_return'; moveQty = -qty; desc = 'Returned to supplier'
    } else if (outcome === 'display_item') {
      if (inInspection) upd.quantity_physical = Math.max(0, (row.quantity_physical || 0) - qty)
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

// ─── Failed delivery dispositions ────────────────────────────────────────────

// Net outstanding reservation per product+warehouse for an order
async function getOutstandingReservations(orderId) {
  const { data: moves } = await supabase
    .from('inventory_movements')
    .select('*')
    .eq('reference_id', orderId)
    .eq('reference_type', 'order')
  const all = moves || []
  const key = m => `${m.product_id}|${m.warehouse_id}`
  const net = {}
  all.filter(m => m.movement_type === 'reserve')
    .forEach(m => { net[key(m)] = (net[key(m)] || 0) + Math.abs(m.quantity) })
  all.filter(m => ['sale', 'release', 'return', 'damage', 'missing', 'return_inspection', 'reserve_out'].includes(m.movement_type))
    .forEach(m => { net[key(m)] = (net[key(m)] || 0) - Math.abs(m.quantity) })
  return Object.entries(net)
    .filter(([, q]) => q > 0)
    .map(([k, qty]) => {
      const [product_id, warehouse_id] = k.split('|')
      return { product_id, warehouse_id, qty }
    })
}

const TRANSFER_REASON_LABELS = {
  customer_relocated: 'Customer relocated',
  another_order: 'Another customer order',
  stock_balancing: 'Stock balancing',
  management_instruction: 'Management instruction',
  other: 'Other',
}

// Where is the stock now, after a failed delivery?
// outcome: legacy string ('returned'|'damaged'|'missing') or
// { disposition: 'returned_warehouse'|'left_at_park'|'transferred_state'|'damaged',
//   destinationState?, transferReason? }
export async function resolveFailedDeliveryStock(order, outcome, staff) {
  try {
    if (!outcome) return
    if (typeof outcome === 'string') return resolveOrderStock(order, outcome, staff?.id)
    const { disposition, destinationState, transferReason } = outcome

    if (disposition === 'damaged') return resolveOrderStock(order, 'damaged', staff?.id)

    const reservations = await getOutstandingReservations(order.id)
    const movement = (fields) => supabase.from('inventory_movements').insert({
      business_id: order.business_id || null,
      reference_id: order.id,
      reference_type: 'order',
      staff_id: staff?.id || null,
      ...fields,
    })

    // ── Left at State Park: goods wait at the park, still held for review ──
    if (disposition === 'left_at_park') {
      const targets = reservations.length > 0
        ? reservations
        : (order.product_id ? [{ product_id: order.product_id, warehouse_id: null, qty: Number(order.quantity) || 1 }] : [])
      for (const r of targets) {
        await movement({
          product_id: r.product_id,
          warehouse_id: r.warehouse_id,
          movement_type: 'left_at_park',
          quantity: 0,
          notes: `Left at ${order.state} State Park after failed delivery — ${order.order_number}`,
        })
      }
      return
    }

    // ── Returned to the current state's warehouse: available again ──
    if (disposition === 'returned_warehouse') {
      const { data: destRows } = await supabase
        .from('warehouses').select('*').eq('state', order.state).eq('is_active', true)
      const dest = (destRows || [])[0] || null

      for (const r of reservations) {
        if (!dest || r.warehouse_id === dest.id) {
          // Release where it's reserved
          const { data: row } = await supabase.from('inventory').select('*')
            .eq('product_id', r.product_id).eq('warehouse_id', r.warehouse_id).single()
          if (!row) continue
          await supabase.from('inventory').update({
            quantity_reserved: Math.max(0, (row.quantity_reserved || 0) - r.qty),
            quantity_available: (row.quantity_available || 0) + r.qty,
            quantity_returned: (row.quantity_returned || 0) + r.qty,
          }).eq('id', row.id)
          await movement({
            product_id: r.product_id, warehouse_id: r.warehouse_id,
            movement_type: 'return', quantity: r.qty,
            notes: `Returned to warehouse after failed delivery — ${order.order_number}`,
          })
        } else {
          // Move from the source into this state's warehouse as available
          const { data: src } = await supabase.from('inventory').select('*')
            .eq('product_id', r.product_id).eq('warehouse_id', r.warehouse_id).single()
          if (src) {
            await supabase.from('inventory').update({
              quantity_reserved: Math.max(0, (src.quantity_reserved || 0) - r.qty),
              quantity_physical: Math.max(0, (src.quantity_physical || 0) - r.qty),
            }).eq('id', src.id)
            await movement({
              product_id: r.product_id, warehouse_id: r.warehouse_id,
              movement_type: 'reserve_out', quantity: -r.qty,
              notes: `Moved to ${dest.name} after failed delivery — ${order.order_number}`,
            })
          }
          const { data: destRow } = await supabase.from('inventory').select('*')
            .eq('product_id', r.product_id).eq('warehouse_id', dest.id).single()
          if (destRow) {
            await supabase.from('inventory').update({
              quantity_physical: (destRow.quantity_physical || 0) + r.qty,
              quantity_available: (destRow.quantity_available || 0) + r.qty,
              quantity_returned: (destRow.quantity_returned || 0) + r.qty,
            }).eq('id', destRow.id)
          } else {
            await supabase.from('inventory').insert({
              product_id: r.product_id, warehouse_id: dest.id,
              business_id: order.business_id || null,
              quantity_physical: r.qty, quantity_available: r.qty,
              quantity_returned: r.qty,
            })
          }
          await movement({
            product_id: r.product_id, warehouse_id: dest.id,
            movement_type: 'return', quantity: r.qty,
            notes: `Returned to ${dest.name} after failed delivery — ${order.order_number}`,
          })
        }
      }
      return
    }

    // ── Transferred to another state: in transit + incoming transfer record ──
    if (disposition === 'transferred_state') {
      if (!destinationState) return
      const { data: destRows } = await supabase
        .from('warehouses').select('*').eq('state', destinationState).eq('is_active', true)
      const destWh = (destRows || [])[0] || null

      const items = await getOrderItems(order)
      const nameOf = (pid) => items.find(i => i.product_id === pid)?.product_name || order.product_name || 'Unknown'
      const targets = reservations.length > 0
        ? reservations
        : items.filter(i => i.product_id).map(i => ({ product_id: i.product_id, warehouse_id: null, qty: i.quantity }))

      const year = new Date().getFullYear()
      for (let i = 0; i < targets.length; i++) {
        const r = targets[i]
        // Stock leaves the current state
        if (r.warehouse_id) {
          const { data: src } = await supabase.from('inventory').select('*')
            .eq('product_id', r.product_id).eq('warehouse_id', r.warehouse_id).single()
          if (src) {
            await supabase.from('inventory').update({
              quantity_reserved: Math.max(0, (src.quantity_reserved || 0) - r.qty),
              quantity_physical: Math.max(0, (src.quantity_physical || 0) - r.qty),
            }).eq('id', src.id)
            await movement({
              product_id: r.product_id, warehouse_id: r.warehouse_id,
              movement_type: 'reserve_out', quantity: -r.qty,
              notes: `In transit to ${destinationState} after failed delivery — ${order.order_number}`,
            })
          }
        }
        // Incoming transfer for the destination state
        await supabase.from('warehouse_transfers').insert({
          transfer_number: `TRF-${year}-${Date.now().toString().slice(-6)}${i > 0 ? `-${i + 1}` : ''}`,
          product_id: r.product_id,
          product_name: nameOf(r.product_id),
          quantity: r.qty,
          from_warehouse_id: r.warehouse_id,
          to_warehouse_id: destWh?.id || null,
          date_transferred: new Date().toISOString().split('T')[0],
          status: 'in_transit',
          notes: `Failed delivery transfer from ${order.state || 'origin'} — ${TRANSFER_REASON_LABELS[transferReason] || transferReason || 'no reason given'} (${order.order_number})`,
          created_by: staff?.id || null,
        })
      }
      return
    }
  } catch (e) {
    console.warn('Failed delivery stock resolution failed:', e)
  }
}

// ─── Returned order decision workflow ────────────────────────────────────────
// The decision itself happens on WhatsApp; the app records the outcome and
// applies the matching stock action to the order's awaiting-inspection
// return records.

const RETURN_DECISION_OUTCOMES = {
  returned_warehouse: 'restocked',
  returned_supplier:  'supplier_return',
  damaged:            'damaged',
  repair:             'repair',
  other:              'other',
}

export async function recordReturnDecision(order, decision, notes, staff) {
  try {
    const { data: rows, error } = await supabase
      .from('returns')
      .select('*')
      .eq('order_id', order.id)
      .eq('status', 'awaiting_inspection')
    if (error) return // returns table missing — timeline still records the decision
    const returnRows = rows || []

    const outcome = RETURN_DECISION_OUTCOMES[decision]
    for (const ret of returnRows) {
      if (outcome) {
        // Terminal stock outcome — complete the return record and move stock
        await supabase.from('returns').update({
          outcome,
          outcome_note: notes || null,
          customer_resolution: ret.customer_resolution || 'no_refund',
          status: 'completed',
          processed_by: staff?.id || null,
          processed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', ret.id)
        await addReturnTimeline(ret.id, 'decision', `Operations decision: ${decision.replace(/_/g, ' ')}${notes ? ` — ${notes}` : ''}`, staff)
        await applyReturnOutcome(ret, outcome, staff)
      } else if (decision === 'customer_refunded' || decision === 'product_exchanged') {
        // Customer resolution recorded; stock stays in inspection until the
        // physical product's location is finalised from Inventory > Returns
        await supabase.from('returns').update({
          customer_resolution: decision === 'customer_refunded' ? 'full_refund' : 'exchanged',
          updated_at: new Date().toISOString(),
        }).eq('id', ret.id)
        await addReturnTimeline(ret.id, 'decision', `Operations decision: ${decision.replace(/_/g, ' ')}${notes ? ` — ${notes}` : ''}`, staff)
      } else if (decision === 'send_another_state') {
        await addReturnTimeline(ret.id, 'decision', `Operations decision: send to another state${notes ? ` — ${notes}` : ''}`, staff)
      }
    }
  } catch (e) {
    console.warn('Return decision recording failed:', e)
  }
}

// Returned product leaves for another state (via the State Park). Takes the
// goods out of the source inspection bucket; they re-enter inventory when the
// destination confirms Received at Warehouse on the order.
export async function sendReturnToAnotherState(order, destinationState, staff) {
  try {
    const { data: rows } = await supabase
      .from('returns')
      .select('*')
      .eq('order_id', order.id)
      .in('status', ['awaiting_inspection', 'completed'])
    for (const ret of (rows || [])) {
      if (!ret.product_id || !ret.warehouse_id) continue
      const { data: inv } = await supabase.from('inventory').select('*')
        .eq('product_id', ret.product_id).eq('warehouse_id', ret.warehouse_id).single()
      if (!inv) continue
      const qty = Number(ret.quantity) || 1
      const upd = { quantity_physical: Math.max(0, (inv.quantity_physical || 0) - qty) }
      if ('quantity_inspection' in inv) upd.quantity_inspection = Math.max(0, (inv.quantity_inspection || 0) - qty)
      await supabase.from('inventory').update(upd).eq('id', inv.id)
      await supabase.from('inventory_movements').insert({
        product_id: ret.product_id,
        warehouse_id: ret.warehouse_id,
        business_id: inv.business_id,
        movement_type: 'reserve_out',
        quantity: -qty,
        reference_id: order.id,
        reference_type: 'order',
        notes: `Returned stock sent to ${destinationState} — ${order.order_number}`,
        staff_id: staff?.id || null,
      })
      await supabase.from('returns').update({
        outcome: 'other',
        outcome_note: `Sent to ${destinationState}`,
        status: 'completed',
        processed_by: staff?.id || null,
        processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', ret.id)
      await addReturnTimeline(ret.id, 'sent_to_park', `Sent to ${destinationState} via State Park`, staff)
    }
  } catch (e) {
    console.warn('Send-to-state stock update failed:', e)
  }
}
