// ═══════════════════════════════════════════════════════════════════
// Business-based access control.
// Staff see only records belonging to their assigned business(es);
// CEO/Super Admin (and staff with no assignment) see everything.
// Every operational query pushes this filter into the database
// request via .in('business_id', ids) — records from other
// businesses are never fetched, not merely hidden.
// ═══════════════════════════════════════════════════════════════════

export function allowedBusinessIds(user) {
  if (!user || ['ceo', 'super_admin'].includes(user.role)) return null // unrestricted
  // business_ids UUID[] exists in the base schema: "businesses this
  // staff can access" — ticked by the CEO in Staff Management
  const list = Array.isArray(user.business_ids)
    ? user.business_ids.filter(Boolean) : []
  if (list.length > 0) return list
  // Legacy single-business assignment from the staff form
  if (user.business_id) return [user.business_id]
  return null // no assignment recorded = unrestricted (backwards compatible)
}

// Apply the filter to a PostgREST query builder
export function scopeToBusinesses(query, user, column = 'business_id') {
  const ids = allowedBusinessIds(user)
  return ids ? query.in(column, ids) : query
}

// Client-side guard for single records fetched by id (order detail etc.)
export function businessAllowed(user, businessId) {
  const ids = allowedBusinessIds(user)
  return !ids || !businessId || ids.includes(businessId)
}
