import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // CEO password-recovery links land on /reset-password with the
    // session in the URL hash; implicit flow works across devices
    detectSessionInUrl: true,
    flowType: 'implicit'
  }
})
