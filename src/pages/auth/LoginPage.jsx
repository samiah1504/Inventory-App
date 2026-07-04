import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { User, Lock, Eye, EyeOff } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'

export function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState({})
  const { login, loading, error } = useAuthStore()
  const navigate = useNavigate()
  const passwordRef = useRef(null)

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

        <div className="mt-6 p-4 bg-blue-50 rounded-xl">
          <p className="text-xs text-blue-700 font-medium">Demo credentials:</p>
          <p className="text-xs text-blue-600">Username: admin · Password: admin123</p>
        </div>
      </div>
    </div>
  )
}
