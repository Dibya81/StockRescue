import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Shield, AlertCircle, Key, Lock, ArrowRight } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

export function SignInPage() {
  const { signIn, session } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: Location })?.from?.pathname ?? '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (session) {
      navigate(from, { replace: true })
    }
  }, [session, navigate, from])

  if (session) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pending) return
    setError(null)
    setPending(true)
    const { error: err } = await signIn(email, password)
    setPending(false)
    if (err) {
      setError(err)
    } else {
      navigate(from, { replace: true })
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] px-4 relative overflow-hidden">
      {/* Subtle industrial background grid overlay */}
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, #CBD5E1 1px, transparent 0)`,
          backgroundSize: '24px 24px',
        }}
      />

      <div className="w-full max-w-md relative z-10 animate-page-enter">
        {/* Brand Header */}
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#EFF6FF] border border-[#2563EB]/25 shadow-md mb-4 transition-transform hover:scale-105">
            <Shield className="h-7 w-7 text-[#2563EB]" aria-hidden="true" />
          </div>
          <span className="text-[11px] font-mono uppercase tracking-widest text-[#2563EB] font-bold">
            StockRescue // Industrial Command
          </span>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-[#0F172A]">
            Operator Sign-In
          </h1>
          <p className="mt-1.5 text-xs text-[#475569]">
            Authenticate with verified operator credentials to access supply recovery orchestration.
          </p>
        </div>

        {/* Authentication Card */}
        <form
          onSubmit={handleSubmit}
          noValidate
          className="card p-7 shadow-xl border border-[#E2E8F0] bg-[#FFFFFF] flex flex-col gap-5 rounded-2xl"
        >
          {error && (
            <div
              role="alert"
              aria-live="assertive"
              className="flex items-start gap-2.5 rounded-lg border border-[#FECACA] bg-[#FEE2E2] p-3.5 text-xs text-[#DC2626]"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-xs font-semibold text-[#475569]">
              Operator Email Address
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={pending}
              placeholder="operator@stockrescue.internal"
              className="input-field"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="password" className="text-xs font-semibold text-[#475569]">
                Access Token / Password
              </label>
            </div>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={pending}
              placeholder="••••••••••••"
              className="input-field"
            />
          </div>

          <button
            type="submit"
            disabled={pending || !email || !password}
            className="btn-primary mt-1 w-full justify-center py-2.5"
            aria-describedby={error ? 'sign-in-error' : undefined}
          >
            {pending ? (
              <span className="inline-flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Verifying Credentials…
              </span>
            ) : (
              <span className="inline-flex items-center gap-2">
                Authorize Session
                <ArrowRight className="h-4 w-4" />
              </span>
            )}
          </button>

          <div className="relative my-1">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-[#E2E8F0]" />
            </div>
            <div className="relative flex justify-center text-[10px] uppercase">
              <span className="bg-[#FFFFFF] px-2 text-[#64748B] font-semibold tracking-wider">Demo Fast Track</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setEmail('operator@stockrescue.internal')
              setPassword('operator-pass-123')
            }}
            className="btn-clay w-full text-xs py-2.5 font-medium text-[#0F172A]"
          >
            <Key className="h-3.5 w-3.5 text-[#2563EB]" />
            Auto-fill Certified Approver Credentials
          </button>
        </form>

        {/* Security Notice */}
        <div className="mt-6 flex items-center justify-center gap-2 text-center text-xs text-[#64748B]">
          <Lock className="h-3.5 w-3.5 text-[#64748B]" />
          <span>Restricted Industrial Environment · Purchasing Disabled</span>
        </div>
      </div>
    </div>
  )
}
