import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Phone, Lock, Eye, EyeOff } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'

export function LoginPage() {
  const [phone, setPhone] = useState('')
  const [pin, setPin] = useState('')
  const [showPin, setShowPin] = useState(false)
  const [errors, setErrors] = useState({})
  const { login, loading, error } = useAuthStore()
  const navigate = useNavigate()
  const pinRef = useRef(null)

  useEffect(() => {
    // Demo: prefill for easy testing
    setPhone('08000000000')
    setPin('1234')
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    const errs = {}
    if (!phone.trim()) errs.phone = 'Phone number is required'
    if (!pin.trim()) errs.pin = 'PIN is required'
    if (Object.keys(errs).length) { setErrors(errs); return }

    const result = await login(phone.trim(), pin.trim())
    if (result.success) navigate('/')
  }

  function handlePinKey(e) {
    if (e.key === 'Enter') handleSubmit(e)
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
        <p className="text-sm text-gray-500 mb-6">Sign in with your phone number and PIN</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Phone Number"
            type="tel"
            placeholder="e.g. 08012345678"
            value={phone}
            onChange={(e) => { setPhone(e.target.value); setErrors({}) }}
            error={errors.phone}
            leftIcon={<Phone size={16} />}
            inputMode="tel"
            autoComplete="tel"
            required
          />
          <Input
            ref={pinRef}
            label="PIN"
            type={showPin ? 'text' : 'password'}
            placeholder="Enter your PIN"
            value={pin}
            onChange={(e) => { setPin(e.target.value); setErrors({}) }}
            onKeyDown={handlePinKey}
            error={errors.pin}
            leftIcon={<Lock size={16} />}
            rightIcon={
              <button type="button" onClick={() => setShowPin(!showPin)} className="text-gray-400">
                {showPin ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            }
            inputMode="numeric"
            maxLength={6}
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
          <p className="text-xs text-blue-600">Phone: 08000000000 · PIN: 1234</p>
        </div>
      </div>
    </div>
  )
}
