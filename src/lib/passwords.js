import { supabase } from './supabase'

// ═══════════════════════════════════════════════════════════════════
// Password handling: salted SHA-256 hashes stored in staff_users
// (password_hash + password_salt), replacing plain-text passwords.
// Legacy rows still holding a plain password keep working and are
// upgraded to a hash on their next successful login.
// ═══════════════════════════════════════════════════════════════════

export async function hashPassword(password, salt) {
  const data = new TextEncoder().encode(`${salt}::${password}`)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export function newSalt() {
  return crypto.randomUUID()
}

// Check an input against a staff row — hashed first, legacy fallback
export async function verifyStaffPassword(row, input) {
  if (!row || !input) return false
  if (row.password_hash && row.password_salt) {
    return (await hashPassword(input, row.password_salt)) === row.password_hash
  }
  return !!row.password && row.password === input
}

// An unguessable placeholder for the legacy plain-text column — it
// is NOT NULL in the live database, so it can never be set to null.
// Once a hash exists it takes priority, making this value inert.
export function scrambledPassword() {
  return `#locked-${crypto.randomUUID()}`
}

// Build the update payload that stores a new password as a hash and
// makes the plain-text copy unusable (without violating NOT NULL)
export async function passwordUpdatePayload(newPassword, extra = {}) {
  const salt = newSalt()
  return {
    password_hash: await hashPassword(newPassword, salt),
    password_salt: salt,
    password: scrambledPassword(),
    ...extra,
  }
}

// Store a hash for a password that was just written in plain text
// (used to upgrade rows pre-/post-migration without breaking either)
export async function tryUpgradeToHash(staffId, plainPassword) {
  try {
    const payload = await passwordUpdatePayload(plainPassword)
    await supabase.from('staff_users').update(payload).eq('id', staffId)
  } catch { /* hash columns not migrated yet — plain text stays until then */ }
}

// Readable temporary password for staff resets, e.g. "kzy-84210"
export function generateTempPassword() {
  return `kzy-${Math.floor(10000 + Math.random() * 90000)}`
}
