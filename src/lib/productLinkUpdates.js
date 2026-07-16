import { supabase } from './supabase'

// When an unverified product (typed by Customer Support during intake) is
// verified or merged, past orders that reference it must adopt the official
// product record: corrected name, real product_id, and — where no confirmed
// historical cost exists — the verified unit cost. Documents (invoice,
// receipt, delivery note, packing PDF) and every report render from the
// order rows themselves, so once the rows are corrected everything follows.

const norm = (s) => (s || '').trim().toLowerCase()
// Escape PostgREST ilike wildcards so a literal name never over-matches
const escLike = (s) => (s || '').replace(/([%_\\])/g, '\\$1')

function itemMatches(entry, product) {
  if (!entry) return false
  if (entry.product_id && entry.product_id === product.id) return true
  return !entry.product_id && norm(entry.product_name || entry.name) === norm(product.name)
}

// Multi-product orders label the order row "First Product + 2 more" —
// rename the base while keeping the suffix intact
function renameOrderLabel(label, product, newName) {
  const m = (label || '').match(/^(.*?)(\s*\+\s*\d+\s*more\s*)$/i)
  const base = (m ? m[1] : label || '').trim()
  if (norm(base) !== norm(product.name)) return null
  return m ? `${newName}${m[2]}` : newName
}

// Every order that references this product: directly by product_id, by the
// typed name on the order row, inside items_data JSONB, or via order_items.
export async function findLinkedOrders(product) {
  const byId = new Map()
  const add = (rows) => (rows || []).forEach(o => { if (o?.id) byId.set(o.id, o) })
  const cols = 'id, order_number, product_id, product_name, items_data, quantity, status'

  const r1 = await supabase.from('orders').select(cols).eq('product_id', product.id)
  add(r1.data)
  const r2 = await supabase.from('orders').select(cols)
    .is('product_id', null).ilike('product_name', escLike(product.name))
  add(r2.data)
  const r3 = await supabase.from('orders').select(cols)
    .is('product_id', null).ilike('product_name', `${escLike(product.name)} + %more`)
  add(r3.data)
  // items_data JSONB containment — exact-value matches only, best-effort
  try {
    const r4 = await supabase.from('orders').select(cols)
      .contains('items_data', JSON.stringify([{ product_id: product.id }]))
    add(r4.data)
  } catch { /* older PostgREST — covered by the queries above */ }
  try {
    const r5 = await supabase.from('orders').select(cols)
      .contains('items_data', JSON.stringify([{ product_name: product.name }]))
    add(r5.data)
  } catch { /* ignore */ }
  // order_items table (used by waybill packing)
  try {
    const [a, b] = await Promise.all([
      supabase.from('order_items').select('order_id').eq('product_id', product.id),
      supabase.from('order_items').select('order_id')
        .is('product_id', null).ilike('product_name', escLike(product.name)),
    ])
    const ids = Array.from(new Set([...(a.data || []), ...(b.data || [])]
      .map(r => r.order_id).filter(id => id && !byId.has(id))))
    if (ids.length > 0) {
      const r6 = await supabase.from('orders').select(cols).in('id', ids)
      add(r6.data)
    }
  } catch { /* order_items may not exist yet */ }

  return Array.from(byId.values())
}

// Rewrite the linked orders so they reference the official product.
//   target:    { id, name, cost_price } — the verified (or merge-target) product
//   applyCost: stamp target.cost_price as the confirmed historical cost on
//              lines that have none. Lines with an existing confirmed cost
//              are NEVER overwritten — product costs change over time and
//              past orders keep the cost that was true for them.
// Returns the number of orders updated.
export async function applyProductToOrders({ product, target, applyCost, user, linkedOrders = null }) {
  const orders = linkedOrders || await findLinkedOrders(product)
  if (orders.length === 0) return 0
  const cost = Number(target.cost_price) || 0
  const stampCost = applyCost && cost > 0

  // order_items rows: confirmed cost first (while the old product_id still
  // identifies the lines), then the rename/repoint
  try {
    if (stampCost) {
      await supabase.from('order_items').update({ cost_price: cost })
        .eq('product_id', product.id).is('cost_price', null)
      await supabase.from('order_items').update({ cost_price: cost })
        .is('product_id', null).ilike('product_name', escLike(product.name)).is('cost_price', null)
    }
  } catch { /* cost_price column arrives with the migration — items_data still carries it */ }
  try {
    await supabase.from('order_items')
      .update({ product_id: target.id, product_name: target.name })
      .eq('product_id', product.id)
    await supabase.from('order_items')
      .update({ product_id: target.id, product_name: target.name })
      .is('product_id', null).ilike('product_name', escLike(product.name))
  } catch { /* order_items may not exist yet */ }

  let updated = 0
  for (const o of orders) {
    const patch = {}

    // Order-level product fields (single-product orders and the list label)
    if (o.product_id === product.id || (!o.product_id && norm(o.product_name) === norm(product.name))) {
      patch.product_id = target.id
      patch.product_name = target.name
    } else {
      // Multi-product label like "Pink Tricycle + 2 more"
      const relabel = renameOrderLabel(o.product_name, product, target.name)
      if (relabel) patch.product_name = relabel
    }

    // items_data JSONB — the primary line-item storage
    if (Array.isArray(o.items_data) && o.items_data.length > 0) {
      let changed = false
      const items = o.items_data.map(e => {
        if (!itemMatches(e, product)) return e
        changed = true
        const hasCost = Number(e.cost_price) > 0
        return {
          ...e,
          product_id: target.id,
          product_name: target.name,
          cost_price: hasCost ? e.cost_price : (stampCost ? cost : (e.cost_price ?? null)),
        }
      })
      if (changed) patch.items_data = items
    }

    if (Object.keys(patch).length === 0) continue
    patch.updated_at = new Date().toISOString()
    const { error } = await supabase.from('orders').update(patch).eq('id', o.id)
    if (error) continue
    updated++

    await supabase.from('order_timeline').insert({
      order_id: o.id,
      action: 'product_verified',
      description: `Product updated: "${product.name}" → "${target.name}"${stampCost ? ` · unit cost ₦${cost.toLocaleString()} applied` : ''} (product verification) — by ${user?.name}`,
      staff_id: user?.id || null,
      staff_name: user?.name || null,
    })
  }
  return updated
}
