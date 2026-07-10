import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { supabase } from '../lib/supabase'
import { verifyStaffPassword, tryUpgradeToHash } from '../lib/passwords'

export const useAuthStore = create(
  persist(
    (set, get) => ({
      user: null,
      profile: null,
      loading: false,
      error: null,

      login: async (username, password) => {
        set({ loading: true, error: null })
        try {
          const { data: rows, error } = await supabase
            .from('staff_users')
            .select('*')
            .eq('username', username)
            .eq('is_active', true)
            .limit(1)

          const row = rows?.[0]
          const ok = !error && row && await verifyStaffPassword(row, password)
          if (!ok) throw new Error('Invalid username or password')

          // Legacy plain-text rows get upgraded to a salted hash here
          if (!row.password_hash && row.password) await tryUpgradeToHash(row.id, password)

          await supabase
            .from('staff_users')
            .update({ last_login: new Date().toISOString() })
            .eq('id', row.id)

          // Never keep password material in the persisted session
          const { password: _p, password_hash: _h, password_salt: _s, ...safeUser } = row
          set({ user: safeUser, profile: safeUser, loading: false, error: null })
          return { success: true }
        } catch (err) {
          set({ loading: false, error: err.message })
          return { success: false, error: err.message }
        }
      },

      // Patch the in-memory user (e.g. after a forced password change)
      updateUser: (patch) => {
        const { user, profile } = get()
        if (user) set({ user: { ...user, ...patch }, profile: profile ? { ...profile, ...patch } : profile })
      },

      logout: () => {
        set({ user: null, profile: null, realUser: null, error: null })
      },

      // ── Role preview (CEO/Super Admin only) ─────────────────────────────
      // Simulates another role app-wide without touching real permissions:
      // the stored user temporarily wears the previewed role; identity
      // (id, name, staff_code) stays the CEO's. realUser holds the original.
      realUser: null,

      startPreview: (role) => {
        const { user, realUser } = get()
        const base = realUser || user
        if (!base || !['ceo', 'super_admin'].includes(base.role)) return
        if (['ceo', 'super_admin'].includes(role)) {
          set({ user: base, realUser: null })
          return
        }
        set({ realUser: base, user: { ...base, role, _preview: true } })
      },

      endPreview: () => {
        const { realUser } = get()
        if (realUser) set({ user: realUser, realUser: null })
      },

      hasPermission: (permission) => {
        const { user } = get()
        if (!user) return false
        const role = user.role
        if (role === 'ceo' || role === 'super_admin') return true
        const permissions = user.roles?.permissions || []
        return permissions.includes(permission) || permissions.includes('*')
      },

      hasRole: (roles) => {
        const { user } = get()
        if (!user) return false
        const r = Array.isArray(roles) ? roles : [roles]
        return r.includes(user.role)
      }
    }),
    {
      name: 'kanziy-auth',
      partialize: (state) => ({ user: state.user, profile: state.profile, realUser: state.realUser })
    }
  )
)
