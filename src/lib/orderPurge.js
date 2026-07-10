import { supabase } from './supabase'
import { resolveOrderStock } from './stockOps'
import { verifyStaffPassword } from './passwords'

// ═══════════════════════════════════════════════════════════════════
// CEO-only permanent order deletion.
// Reverses inventory effects, removes every record that belongs
// exclusively to the order, protects records that entered other
// workflows (holding queue), and leaves a deletion audit row.
// ═══════════════════════════════════════════════════════════════════

export const DELETE_REASONS = [
  { value: 'test_order',   label: 'Test order' },
  { value: 'duplicate',    label: 'Duplicate order' },
  { value: 'mistake',      label: 'Created by mistake' },
  { value: 'corrupted',    label: 'Corrupted / invalid record' },
  { value: 'other',        label: 'Other' },
]

// Re-authentication against the staff record (hashed or legacy plain)
export async function verifyPassword(user, password) {
  if (!user?.id || !password) return false
  try {
    const { data, error } = await supabase.from('staff_users')
      .select('*').eq('id', user.id).eq('is_active', true).limit(1)
    if (error || !data?.[0]) return false
    return await verifyStaffPassword(data[0], password)
  } catch { return false }
}

// What the deletion will touch — shown on the review step
export async function collectDeletionReview(orders) {
  const ids = orders.map(o => o.id)
  const out = { movements: 0, holding: [], customers: [] }
  try {
    const { count } = await supabase.from('inventory_movements')
      .select('*', { count: 'exact', head: true }).in('reference_id', ids)
    out.movements = count || 0
  } catch { /* ignore */ }
  try {
    const { data } = await supabase.from('holding_queue')
      .select('id, product_name, quantity, state, status, source_order_id, source_order_number')
      .in('source_order_id', ids)
    out.holding = data || []
  } catch { /* table may not exist */ }
  // Which customers would be left with no other orders
  const phones = [...new Set(orders.map(o => o.customer_phone).filter(Boolean))]
  for (const phone of phones) {
    try {
      const { count } = await supabase.from('orders')
        .select('*', { count: 'exact', head: true })
        .eq('customer_phone', phone)
        .not('id', 'in', `(${ids.join(',')})`)
      out.customers.push({
        phone,
        name: orders.find(o => o.customer_phone === phone)?.customer_name,
        remainingOrders: count || 0,
      })
    } catch { /* ignore */ }
  }
  return out
}

// Undo the order's inventory effects before its records disappear:
// 1) release any outstanding reservation (idempotent netting engine)
// 2) put sold stock back (paid orders deducted physical via 'sale')
// Stock that physically left with the order (reserve_out — parks,
// transfers, holding) is NOT re-added; those are real-world moves.
async function reverseInventoryEffects(order, staffId) {
  const warnings = []
  let movements = []
  try {
    const { data } = await supabase.from('inventory_movements')
      .select('*').eq('reference_id', order.id)
    movements = data || []
  } catch { return warnings }

  try { await resolveOrderStock(order, 'release', staffId) } catch { /* best-effort */ }

  const soldByKey = {}
  for (const m of movements) {
    if (m.movement_type === 'sale' && m.product_id && m.warehouse_id) {
      const key = `${m.product_id}|${m.warehouse_id}`
      soldByKey[key] = (soldByKey[key] || 0) + Math.abs(Number(m.quantity) || 0)
    }
  }
  for (const [key, qty] of Object.entries(soldByKey)) {
    if (!qty) continue
    const [product_id, warehouse_id] = key.split('|')
    try {
      const { data: rows } = await supabase.from('inventory').select('*')
        .eq('product_id', product_id).eq('warehouse_id', warehouse_id).limit(1)
      const inv = rows?.[0]
      if (inv) {
        await supabase.from('inventory').update({
          quantity_physical: (inv.quantity_physical || 0) + qty,
          quantity_available: (inv.quantity_available || 0) + qty,
        }).eq('id', inv.id)
      }
    } catch { warnings.push(`Could not restore ${qty} sold unit(s) for a product in ${order.order_number}`) }
  }

  if (movements.some(m => m.movement_type === 'reserve_out')) {
    warnings.push(`${order.order_number}: some stock physically left with this order (park/transfer/holding) and was not re-added to any warehouse.`)
  }
  return warnings
}

// Permanently delete one order and everything exclusively linked to it.
export async function purgeOrder(order, { reason, notes, deleteCustomer }, user) {
  const warnings = []

  // Holding Queue protection: records live on, detached from the order
  try {
    const { data: holds } = await supabase.from('holding_queue')
      .select('id, product_name, status').eq('source_order_id', order.id)
    if (holds && holds.length > 0) {
      await supabase.from('holding_queue')
        .update({ source_order_id: null }).eq('source_order_id', order.id)
      warnings.push(`${order.order_number}: ${holds.length} Product Holding Queue record(s) kept — the product is in another logistics process and needs separate handling.`)
    }
  } catch { /* table may not exist */ }

  const invWarnings = await reverseInventoryEffects(order, user?.id)
  warnings.push(...invWarnings)

  // Unlink references that must survive the delete
  await supabase.from('products').update({ first_order_id: null }).eq('first_order_id', order.id)

  // Returns linked only to this order (records + their timelines)
  try {
    const { data: rets } = await supabase.from('returns').select('id').eq('order_id', order.id)
    const retIds = (rets || []).map(r => r.id)
    if (retIds.length > 0) {
      await supabase.from('return_timeline').delete().in('return_id', retIds)
      await supabase.from('inventory_movements').delete().in('reference_id', retIds)
      await supabase.from('returns').delete().eq('order_id', order.id)
    }
  } catch { /* tables may not exist */ }

  // Order-exclusive records
  await supabase.from('inventory_movements').delete().eq('reference_id', order.id)
  await supabase.from('waybill_batch_orders').delete().eq('order_id', order.id)
  await supabase.from('expenses').delete().eq('order_id', order.id)
  await supabase.from('order_notes').delete().eq('order_id', order.id)
  await supabase.from('order_timeline').delete().eq('order_id', order.id)
  await supabase.from('order_items').delete().eq('order_id', order.id)

  // Audit before the order row disappears (best-effort pre-migration)
  let auditId = null
  try {
    const { data: auditRow } = await supabase.from('deleted_order_audit').insert({
      order_number: order.order_number,
      customer_name: order.customer_name,
      customer_phone: order.customer_phone,
      business_name: order.business?.name || null,
      total_amount: order.total_amount,
      previous_status: order.status,
      reason, notes: notes || null,
      customer_deleted: false,
      deleted_by_id: user?.id || null,
      deleted_by_name: user?.name || null,
    }).select('id').single()
    auditId = auditRow?.id || null
  } catch { warnings.push('Audit table missing — run the Deleted Order Audit migration.') }

  const { error } = await supabase.from('orders').delete().eq('id', order.id)
  if (error) throw new Error(`${order.order_number}: ${error.message}`)

  // Trust nothing: confirm the row is actually gone
  const { data: still } = await supabase.from('orders').select('id').eq('id', order.id).limit(1)
  if (still && still.length > 0) {
    throw new Error(`${order.order_number}: the database blocked the delete. Most likely Row Level Security on the orders table has no DELETE policy for the app — run the RLS fix in supabase/migrations.sql.`)
  }

  // Optional customer profile removal — only when nothing else references them
  let customerDeleted = false
  if (deleteCustomer && order.customer_phone) {
    try {
      const { count } = await supabase.from('orders')
        .select('*', { count: 'exact', head: true })
        .eq('customer_phone', order.customer_phone)
      if ((count || 0) === 0) {
        const { data: cust } = await supabase.from('customers')
          .select('id').eq('phone', order.customer_phone).limit(1)
        const custId = cust?.[0]?.id
        if (custId) {
          await supabase.from('customer_addresses').delete().eq('customer_id', custId)
          const { error: cErr } = await supabase.from('customers').delete().eq('id', custId)
          if (!cErr) {
            customerDeleted = true
            if (auditId) {
              await supabase.from('deleted_order_audit')
                .update({ customer_deleted: true }).eq('id', auditId)
            }
          } else {
            warnings.push(`${order.customer_name}: customer kept — still referenced by other records.`)
          }
        }
      } else {
        warnings.push(`${order.customer_name}: customer kept — they have ${count} other order(s).`)
      }
    } catch { /* keep customer on any doubt */ }
  }

  return { warnings, customerDeleted }
}
