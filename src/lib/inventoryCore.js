import { supabase } from './supabase'

// ═══════════════════════════════════════════════════════════════════
// The ONE way to change stock.
//
// applyStock() calls the inventory_apply() database function, which
// locks the stock row, refuses to go below zero and writes the
// movement log in a single transaction — so two staff acting on the
// same product at the same moment can never overwrite each other.
//
// It THROWS on failure. Callers that must not block the user (an order
// status change, a waybill dispatch) catch it and surface it with
// stockWarning() instead of hiding it in the console.
// ═══════════════════════════════════════════════════════════════════

let rpcMissing = false

function isMissingFunction(error) {
  const msg = `${error?.message || ''} ${error?.details || ''}`
  return error?.code === 'PGRST202' || error?.code === '42883' ||
    /inventory_apply/i.test(msg) && /(could not find|does not exist)/i.test(msg)
}

/**
 * @param {object} p
 * @param {string} p.productId
 * @param {string} p.warehouseId
 * @param {string} [p.businessId]
 * @param {number} [p.qty]         + into stock / - out of stock (physical & sellable)
 * @param {number} [p.sold]        counter only
 * @param {number} [p.damaged]     counter only
 * @param {number} [p.returned]    counter only
 * @param {number} [p.inspection]  + moves sellable units into inspection, - out of it
 * @param {string} [p.type]        movement type for the log (omit = no log entry)
 * @param {number} [p.movementQty] quantity written on the log (defaults to applied qty)
 * @param {boolean} [p.clamp]      take only what is there instead of failing
 * @returns {Promise<{applied:number, requested:number, physical:number, available:number}>}
 */
export async function applyStock(p) {
  const args = {
    p_product_id: p.productId,
    p_warehouse_id: p.warehouseId,
    p_business_id: p.businessId || null,
    p_qty: Math.trunc(Number(p.qty) || 0),
    p_sold: Math.trunc(Number(p.sold) || 0),
    p_damaged: Math.trunc(Number(p.damaged) || 0),
    p_returned: Math.trunc(Number(p.returned) || 0),
    p_inspection: Math.trunc(Number(p.inspection) || 0),
    p_movement_type: p.type || null,
    p_movement_qty: p.movementQty == null ? null : Math.trunc(Number(p.movementQty)),
    p_reference_id: p.refId || null,
    p_reference_type: p.refType || null,
    p_notes: p.notes || null,
    p_staff_id: p.staffId || null,
    p_unit_cost: p.unitCost == null || p.unitCost === '' ? null : Number(p.unitCost),
    p_supplier: p.supplier || null,
    p_movement_at: p.movementAt || null,
    p_clamp: !!p.clamp,
  }

  if (!rpcMissing) {
    const { data, error } = await supabase.rpc('inventory_apply', args)
    if (!error) return data
    if (!isMissingFunction(error)) throw new Error(error.message)
    rpcMissing = true
    console.warn('inventory_apply() not found — run the Inventory v2 section of supabase/migrations.sql. Using the slower fallback.')
  }
  return legacyApply(args)
}

// Pre-migration fallback: same rules, but not safe against two people
// changing the same row at the same instant. Removed once the SQL runs.
async function legacyApply(a) {
  const { data: rows, error } = await supabase.from('inventory').select('*')
    .eq('product_id', a.p_product_id).eq('warehouse_id', a.p_warehouse_id).limit(1)
  if (error) throw new Error(error.message)
  let row = rows?.[0]
  let qty = a.p_qty
  const insp = a.p_inspection
  if (!row) {
    if (qty < 0 || insp !== 0) {
      if (a.p_clamp) return { applied: 0, requested: a.p_qty, physical: 0, available: 0 }
      throw new Error('No stock of this product in this warehouse')
    }
    const { data: created, error: insErr } = await supabase.from('inventory').insert({
      product_id: a.p_product_id, warehouse_id: a.p_warehouse_id, business_id: a.p_business_id,
      quantity_physical: 0, quantity_available: 0,
    }).select().single()
    if (insErr) throw new Error(insErr.message)
    row = created
  }
  const avail = Number(row.quantity_available) || 0
  if (avail + qty - insp < 0) {
    if (a.p_clamp && insp === 0) qty = -Math.max(avail, 0)
    else throw new Error(`Not enough stock: only ${Math.max(avail, 0)} available`)
  }
  const upd = {
    quantity_physical: (Number(row.quantity_physical) || 0) + qty,
    quantity_available: avail + qty - insp,
    quantity_sold: (Number(row.quantity_sold) || 0) + a.p_sold,
    quantity_damaged: (Number(row.quantity_damaged) || 0) + a.p_damaged,
    quantity_returned: (Number(row.quantity_returned) || 0) + a.p_returned,
  }
  if (insp !== 0) upd.quantity_inspection = Math.max(0, (Number(row.quantity_inspection) || 0) + insp)
  const { error: updErr } = await supabase.from('inventory').update(upd).eq('id', row.id)
  if (updErr) throw new Error(updErr.message)
  if (a.p_movement_type) {
    const mv = {
      product_id: a.p_product_id, warehouse_id: a.p_warehouse_id,
      business_id: row.business_id || a.p_business_id,
      movement_type: a.p_movement_type,
      quantity: a.p_movement_qty ?? qty,
      reference_id: a.p_reference_id, reference_type: a.p_reference_type,
      unit_cost: a.p_unit_cost, total_cost: a.p_unit_cost == null ? null : a.p_unit_cost * Math.abs(qty),
      supplier: a.p_supplier, notes: a.p_notes, staff_id: a.p_staff_id,
    }
    if (a.p_movement_at) mv.created_at = a.p_movement_at
    const { error: mvErr } = await supabase.from('inventory_movements').insert(mv)
    if (mvErr) throw new Error(mvErr.message)
  }
  return { applied: qty, requested: a.p_qty, physical: upd.quantity_physical, available: upd.quantity_available }
}

// A product is "tracked" once it has a stock row in any warehouse.
// Untracked products (never stocked — e.g. always supplier-direct)
// are skipped silently, as before.
export async function isTracked(productId) {
  if (!productId) return false
  const { data } = await supabase.from('inventory').select('id').eq('product_id', productId).limit(1)
  return (data || []).length > 0
}

// Active warehouses in a state (optionally preferring the business's own)
export async function warehousesInState(state, businessId) {
  if (!state) return []
  const { data } = await supabase.from('warehouses').select('*')
    .eq('state', state).eq('is_active', true)
  const list = data || []
  return businessId
    ? [...list.filter(w => w.business_id === businessId), ...list.filter(w => w.business_id !== businessId)]
    : list
}

// The main warehouse goods are normally waybilled from (Lagos)
export async function mainWarehouse(businessId) {
  const { data } = await supabase.from('warehouses').select('*').eq('is_active', true)
  const list = data || []
  const lagos = list.filter(w => /lagos/i.test(w.state || ''))
  const pick = (l) => l.find(w => businessId && w.business_id === businessId) || l[0]
  return pick(lagos) || pick(list) || null
}

// Record a stock problem where people will see it: the order's timeline
// (when there is an order) — and the returned text goes into a toast.
export async function stockWarning(order, message, staff) {
  if (order?.id) {
    try {
      await supabase.from('order_timeline').insert({
        order_id: order.id,
        action: 'stock_warning',
        description: `⚠ Stock: ${message}`,
        staff_id: staff?.id || null,
        staff_name: staff?.name || null,
      })
    } catch { /* the toast still shows it */ }
  }
  return message
}

// Monday of the week containing `d` (YYYY-MM-DD, local time)
export function weekStart(d = new Date()) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const day = x.getDay() // 0 Sun … 6 Sat
  x.setDate(x.getDate() - ((day + 6) % 7))
  const mm = String(x.getMonth() + 1).padStart(2, '0')
  const dd = String(x.getDate()).padStart(2, '0')
  return `${x.getFullYear()}-${mm}-${dd}`
}
