import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { supabase } from '../lib/supabase'

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
          const { data, error } = await supabase
            .from('staff_users')
            .select('*, roles(name, permissions)')
            .eq('username', username)
            .eq('password', password)
            .eq('is_active', true)
            .single()

          if (error || !data) throw new Error('Invalid username or password')

          await supabase
            .from('staff_users')
            .update({ last_login: new Date().toISOString() })
            .eq('id', data.id)

          set({ user: data, profile: data, loading: false, error: null })
          return { success: true }
        } catch (err) {
          set({ loading: false, error: err.message })
          return { success: false, error: err.message }
        }
      },

      logout: () => {
        set({ user: null, profile: null, error: null })
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
      partialize: (state) => ({ user: state.user, profile: state.profile })
    }
  )
)
