import { accessFor } from '../hooks/useStaff'

// ═══════════════════════════════════════════════════════════════════
// Who can see and do what in the Inventory module.
//
//   CEO / Super Admin ...... company-wide view (all warehouses, totals,
//                            ₦ inventory value) + every action
//   Inventory officer ...... all warehouses by default, or only the
//                            ones the CEO switched on for them; can
//                            record stock, transfer, adjust, count
//   Operations Manager ..... same warehouse scope, VIEW ONLY
//   Everyone else .......... no access to stock and inventory
//
// Warehouse scoping is pushed into every database request
// (.in('warehouse_id', …)) so other warehouses' rows are never fetched.
// Note: the app has no server-side Row Level Security yet, so this is
// enforced by the app, not by the database.
// ═══════════════════════════════════════════════════════════════════

export const INVENTORY_ROLES = ['ceo', 'super_admin', 'operations_manager', 'inventory']

export const isCompanyAdmin = (u) => ['ceo', 'super_admin'].includes(u?.role)

export function canOpenInventory(u) {
  return !!u && INVENTORY_ROLES.includes(u.role) && accessFor(u).includes('inventory')
}

// Record / transfer / adjust / damage / settle transit / count
export const canEditStock = (u) => ['ceo', 'super_admin', 'inventory'].includes(u?.role)

// null = every warehouse; otherwise the warehouses this person may see
export function allowedWarehouseIds(u) {
  if (!u || isCompanyAdmin(u)) return null
  const ids = Array.isArray(u.assigned_warehouse_ids) ? u.assigned_warehouse_ids.filter(Boolean) : []
  return ids.length > 0 ? ids : null
}

export function scopeToWarehouses(query, u, column = 'warehouse_id') {
  const ids = allowedWarehouseIds(u)
  return ids ? query.in(column, ids) : query
}

export function warehouseAllowed(u, warehouseId) {
  const ids = allowedWarehouseIds(u)
  return !ids || ids.includes(warehouseId)
}

// States of the warehouses this person may see (null = unrestricted).
// Used for records tied to a state rather than a warehouse (parks,
// goods heading to a state, damaged items found outside a warehouse).
export async function allowedWarehouseStates(u) {
  const ids = allowedWarehouseIds(u)
  if (!ids) return null
  const { supabase } = await import('./supabase')
  const { data } = await supabase.from('warehouses').select('state').in('id', ids)
  return [...new Set((data || []).map(w => w.state).filter(Boolean))]
}

// PostgREST list literal: ("Lagos","Akwa Ibom")
export const pgList = (values) => `(${values.map(v => `"${String(v).replace(/"/g, '\\"')}"`).join(',')})`
