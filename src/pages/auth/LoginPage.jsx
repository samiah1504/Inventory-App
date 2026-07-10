import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { User, Lock, Eye, EyeOff } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { supabase } from '../../lib/supabase'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'

export function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState({})
  const [showForgot, setShowForgot] = useState(false)
  const [forgotUsername, setForgotUsername] = useState('')
  const [forgotState, setForgotState] = useState('idle') // idle | sending | sent
  const { login, loading, error } = useAuthStore()
  const navigate = useNavigate()
  const passwordRef = useRef(null)

  // Recovery is CEO-only via a private recovery email. Whatever the
  // username, the response is identical — existence is never revealed.
  async function handleForgot() {
    setForgotState('sending')
    try {
      const { data } = await supabase.from('staff_users')
        .select('recovery_email, role')
        .eq('username', forgotUsername.trim().toLowerCase())
        .eq('is_active', true)
        .limit(1)
      const row = data?.[0]
      if (row?.recovery_email && ['ceo', 'super_admin'].includes(row.role)) {
        await supabase.auth.resetPasswordForEmail(row.recovery_email, {
          redirectTo: `${window.location.origin}/reset-password`,
        })
      }
    } catch { /* neutral response regardless */ }
    setForgotState('sent')
  }

  useEffect(() => {
    // Demo: prefill for easy testing
    setUsername('admin')
    setPassword('admin123')
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    const errs = {}
    if (!username.trim()) errs.username = 'Username is required'
    if (!password.trim()) errs.password = 'Password is required'
    if (Object.keys(errs).length) { setErrors(errs); return }

    const result = await login(username.trim(), password.trim())
    if (result.success) navigate('/')
  }

  return (
    <div className="min-h-svh flex flex-col bg-gradient-to-br from-blue-600 to-blue-800">
      {/* Header */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 pt-12 pb-6">
        <div className="w-20 h-20 bg-white/20 rounded-3xl flex items-center justify-center mb-6 backdrop-blur">
          <span className="text-4xl">📦</span>
        </div>
        <h1 className="text-3xl font-bold text-white mb-1">Kanziy Ops</h1>
        <p className="text-blue-200 text-sm">Internal Operations System</p>
      </div>

      {/* Form card */}
      <div className="bg-white rounded-t-3xl px-6 py-8 pb-10 shadow-xl">
        <h2 className="text-xl font-bold text-gray-900 mb-1">Staff Login</h2>
        <p className="text-sm text-gray-500 mb-6">Sign in with your username and password</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Username"
            type="text"
            placeholder="Enter your username"
            value={username}
            onChange={(e) => { setUsername(e.target.value); setErrors({}) }}
            error={errors.username}
            leftIcon={<User size={16} />}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="username"
            required
          />
          <Input
            ref={passwordRef}
            label="Password"
            type={showPassword ? 'text' : 'password'}
            placeholder="Enter your password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setErrors({}) }}
            error={errors.password}
            leftIcon={<Lock size={16} />}
            rightIcon={
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="text-gray-400">
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            }
            autoComplete="current-password"
            required
          />

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <Button
            type="submit"
            size="lg"
            loading={loading}
            className="w-full mt-2"
          >
            Sign In
          </Button>
        </form>

        <button
          type="button"
          onClick={() => { setForgotUsername(''); setForgotState('idle'); setShowForgot(true) }}
          className="w-full text-center text-xs text-gray-400 mt-4 py-1"
        >
          Forgot password?
        </button>

        <div className="mt-4 p-4 bg-blue-50 rounded-xl">
          <p className="text-xs text-blue-700 font-medium">Demo credentials:</p>
          <p className="text-xs text-blue-600">Username: admin · Password: admin123</p>
        </div>
      </div>

      {/* Forgot password — neutral response, recovery email never shown */}
      <Modal isOpen={showForgot} onClose={() => setShowForgot(false)} title="Forgot Password"
        footer={forgotState === 'sent' ? (
          <Button className="w-full" onClick={() => setShowForgot(false)}>Close</Button>
        ) : (
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setShowForgot(false)}>Cancel</Button>
            <Button className="flex-1" loading={forgotState === 'sending'}
              disabled={!forgotUsername.trim()} onClick={handleForgot}>
              Send Reset Link
            </Button>
          </div>
        )}>
        {forgotState === 'sent' ? (
          <p className="text-sm text-gray-700">
            If this username has a recovery method configured, reset instructions have been sent.
            Check the recovery inbox — the link expires after a short time.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-gray-500">
              Enter your username. If a recovery method is configured for the account,
              reset instructions will be sent to it. Staff without recovery should ask
              the CEO to reset their password from Staff Management.
            </p>
            <Input label="Username" autoCapitalize="none" autoCorrect="off"
              value={forgotUsername} onChange={e => setForgotUsername(e.target.value)}
              placeholder="Enter your username" />
          </div>
        )}
      </Modal>
    </div>
  )
}
