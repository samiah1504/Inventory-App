import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { passwordUpdatePayload } from '../../lib/passwords'
import { useAuthStore } from '../../stores/authStore'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'

// Forced password change after a temporary password reset — the app
// stays locked behind this screen until a new password is saved.
export function ChangePasswordPage() {
  const navigate = useNavigate()
  const { user, updateUser, logout } = useAuthStore()
  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    setError('')
    if (pw1.length < 6) { setError('Password must be at least 6 characters'); return }
    if (pw1 !== pw2) { setError('Passwords do not match'); return }
    setSaving(true)
    try {
      const payload = await passwordUpdatePayload(pw1, { must_change_password: false })
      const { error: uErr } = await supabase.from('staff_users').update(payload).eq('id', user.id)
      if (uErr) throw uErr
      updateUser({ must_change_password: false })
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.message || 'Could not save the new password')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-gray-100 p-6">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck size={18} className="text-gray-700" />
          <h1 className="text-lg font-bold text-gray-900">Set Your New Password</h1>
        </div>
        <p className="text-xs text-gray-500 mb-5">
          {user?.name?.split(' ')[0]}, you signed in with a temporary password.
          Choose your own password to continue.
        </p>
        <div className="space-y-4">
          <Input label="New Password" type="password" required autoComplete="new-password"
            value={pw1} onChange={e => setPw1(e.target.value)} />
          <Input label="Confirm New Password" type="password" required autoComplete="new-password"
            value={pw2} onChange={e => setPw2(e.target.value)} />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <Button className="w-full" loading={saving} disabled={!pw1 || !pw2} onClick={submit}>
            Save and Continue
          </Button>
          <button onClick={() => { logout(); navigate('/login') }}
            className="w-full text-xs text-gray-400 py-1">
            Sign out instead
          </button>
        </div>
      </div>
    </div>
  )
}
