import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound, CheckCircle, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { passwordUpdatePayload } from '../../lib/passwords'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'

// Landing page for the CEO recovery email link. The link carries a
// short-lived Supabase session; we use its verified email to find the
// staff account whose recovery email matches, then store the new
// password as a salted hash.
export function ResetPasswordPage() {
  const navigate = useNavigate()
  const [state, setState] = useState('checking') // checking | ready | invalid | done
  const [email, setEmail] = useState(null)
  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    // Expired/invalid links come back with an error in the URL hash
    if (/error_code=|error=/.test(window.location.hash)) {
      setState('invalid')
      return
    }
    let tries = 0
    const check = async () => {
      const { data } = await supabase.auth.getSession()
      const sessEmail = data?.session?.user?.email
      if (sessEmail) {
        setEmail(sessEmail)
        setState('ready')
        return
      }
      if (++tries < 10) setTimeout(check, 400)
      else setState('invalid')
    }
    check()
  }, [])

  async function submit() {
    setError('')
    if (pw1.length < 6) { setError('Password must be at least 6 characters'); return }
    if (pw1 !== pw2) { setError('Passwords do not match'); return }
    setSaving(true)
    try {
      const { data: rows } = await supabase.from('staff_users')
        .select('id, role').eq('recovery_email', email)
        .in('role', ['ceo', 'super_admin']).eq('is_active', true).limit(1)
      const staff = rows?.[0]
      if (!staff) {
        setError('This link is not connected to an account. Request a new one from the login page.')
        setSaving(false)
        return
      }
      const payload = await passwordUpdatePayload(pw1, { must_change_password: false })
      const { error: uErr } = await supabase.from('staff_users').update(payload).eq('id', staff.id)
      if (uErr) throw uErr
      await supabase.auth.signOut()
      setState('done')
    } catch (err) {
      setError(err.message || 'Could not save the new password')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-gray-100 p-6">
        {state === 'checking' && (
          <div className="text-center py-8">
            <div className="w-8 h-8 border-2 border-gray-200 border-t-gray-900 rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-gray-500">Verifying reset link…</p>
          </div>
        )}

        {state === 'invalid' && (
          <div className="text-center py-4">
            <AlertTriangle size={32} className="text-amber-500 mx-auto mb-3" />
            <h1 className="text-base font-bold text-gray-900 mb-1">Link invalid or expired</h1>
            <p className="text-sm text-gray-500 mb-5">
              Reset links only work for a short time. Go back to the login page and use
              Forgot Password to request a new one.
            </p>
            <Button className="w-full" onClick={() => navigate('/login')}>Back to Login</Button>
          </div>
        )}

        {state === 'ready' && (
          <>
            <div className="flex items-center gap-2 mb-1">
              <KeyRound size={18} className="text-gray-700" />
              <h1 className="text-lg font-bold text-gray-900">Create New Password</h1>
            </div>
            <p className="text-xs text-gray-500 mb-5">Setting a new password for the account recovered via {email}</p>
            <div className="space-y-4">
              <Input label="New Password" type="password" required autoComplete="new-password"
                value={pw1} onChange={e => setPw1(e.target.value)} />
              <Input label="Confirm New Password" type="password" required autoComplete="new-password"
                value={pw2} onChange={e => setPw2(e.target.value)} />
              {error && <p className="text-xs text-red-600">{error}</p>}
              <Button className="w-full" loading={saving} disabled={!pw1 || !pw2} onClick={submit}>
                Save New Password
              </Button>
            </div>
          </>
        )}

        {state === 'done' && (
          <div className="text-center py-4">
            <CheckCircle size={32} className="text-green-500 mx-auto mb-3" />
            <h1 className="text-base font-bold text-gray-900 mb-1">Password updated</h1>
            <p className="text-sm text-gray-500 mb-5">Sign in with your username and your new password.</p>
            <Button className="w-full" onClick={() => navigate('/login')}>Go to Login</Button>
          </div>
        )}
      </div>
    </div>
  )
}
