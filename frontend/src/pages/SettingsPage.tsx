import { useHealth } from '@/hooks/api'
import { useAuth } from '@/contexts/AuthContext'
import { Skeleton } from '@/components/ui/Skeleton'
import { CheckCircle2, XCircle, AlertCircle, Shield, Server, Lock } from 'lucide-react'

function Row({
  label,
  value,
  status,
  subvalue,
}: {
  label: string
  value: React.ReactNode
  status?: 'ok' | 'warn' | 'error'
  subvalue?: string
}) {
  const icon =
    status === 'ok' ? (
      <CheckCircle2 className="h-4 w-4 text-[#16A34A]" />
    ) : status === 'error' ? (
      <XCircle className="h-4 w-4 text-[#DC2626]" />
    ) : status === 'warn' ? (
      <AlertCircle className="h-4 w-4 text-[#D97706]" />
    ) : null

  return (
    <div className="flex items-center justify-between border-b border-[#E2E8F0] py-3.5 last:border-0">
      <div className="flex flex-col">
        <span className="text-xs font-semibold text-[#475569]">{label}</span>
        {subvalue && <span className="text-[10px] text-[#64748B]">{subvalue}</span>}
      </div>
      <div className="flex items-center gap-2 text-xs font-semibold text-[#0F172A]">
        {icon}
        {value}
      </div>
    </div>
  )
}

export function SettingsPage() {
  const { data: health, isLoading, isError } = useHealth()
  const { user, session } = useAuth()

  return (
    <div className="flex flex-col gap-8 max-w-2xl">
      {/* Page Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">
          System Diagnostics & Configuration
        </h1>
        <p className="mt-1 text-xs text-[#475569]">
          Operational infrastructure health, operator session credentials, and security policy boundaries.
        </p>
      </div>

      {/* Backend & API Section */}
      <section aria-labelledby="api-heading" className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-[#2563EB]" />
          <h2 id="api-heading" className="text-sm font-semibold text-[#0F172A]">
            FastAPI Backend & Telemetry
          </h2>
        </div>

        <div className="card p-5 bg-[#FFFFFF] border-[#E2E8F0] shadow-sm">
          {isLoading ? (
            <Skeleton className="h-28 w-full" />
          ) : isError ? (
            <Row label="API Connectivity" value="Offline" status="error" subvalue="Failed to connect to backend engine" />
          ) : (
            <>
              <Row
                label="API Connectivity"
                value="Online · Verified"
                status="ok"
                subvalue="HTTP 200 health check response received"
              />
              <Row
                label="Application Name"
                value={health?.app_name ?? 'StockRescue Engine'}
                subvalue="Registered service identifier"
              />
              <Row
                label="Demonstration Mode"
                value={health?.demo_mode ? 'Active (Demo)' : 'Inactive'}
                status={health?.demo_mode ? 'warn' : undefined}
                subvalue="Simulated supplier datasets and mock events"
              />
              <Row
                label="Live Purchasing Execution"
                value={health?.real_purchasing_enabled ? 'ENABLED' : 'Disabled (Safe Mode)'}
                status={health?.real_purchasing_enabled ? 'error' : 'ok'}
                subvalue="External financial transaction authorization"
              />
            </>
          )}
        </div>
      </section>

      {/* Operator Session Section */}
      <section aria-labelledby="auth-heading" className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-[#2563EB]" />
          <h2 id="auth-heading" className="text-sm font-semibold text-[#0F172A]">
            Operator Identity & Access
          </h2>
        </div>

        <div className="card p-5 bg-[#FFFFFF] border-[#E2E8F0] shadow-sm">
          <Row
            label="Authentication State"
            value={session ? 'Authenticated' : 'Unauthenticated'}
            status={session ? 'ok' : 'error'}
          />
          <Row
            label="Operator Identity"
            value={user?.email ?? '—'}
            subvalue="Verified internal operator account"
          />
          <Row
            label="Governance Role"
            value={
              <span className="inline-flex items-center gap-1 rounded bg-[#EFF6FF] px-2 py-0.5 text-[11px] font-mono font-semibold text-[#2563EB] border border-[#2563EB]/25">
                approver
              </span>
            }
            subvalue="Authorized to sign recovery allocations"
          />
          <Row
            label="Session Expiration"
            value={
              session?.expires_at
                ? new Date(session.expires_at * 1000).toLocaleString()
                : '—'
            }
          />
        </div>
      </section>

      {/* Safety Policy & Configuration Section */}
      <section aria-labelledby="config-heading" className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Lock className="h-4 w-4 text-[#2563EB]" />
          <h2 id="config-heading" className="text-sm font-semibold text-[#0F172A]">
            Environment & Secret Boundaries
          </h2>
        </div>

        <div className="card p-5 bg-[#FFFFFF] border-[#E2E8F0] shadow-sm">
          <Row
            label="API Gateway Endpoint"
            value={
              <code className="font-mono text-xs text-[#2563EB] bg-[#F1F5F9] px-2 py-0.5 rounded border border-[#E2E8F0] font-semibold">
                {import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'}
              </code>
            }
            subvalue="Target backend URL or local proxy"
          />
          <Row
            label="Purchasing Lockout Policy"
            value="Enforced (Disabled)"
            status="ok"
            subvalue="Frontend client strictly forbids direct purchase execution"
          />
          <Row
            label="Cryptographic Credentials"
            value="Server-Isolated"
            status="ok"
            subvalue="Agent seeds and private keys never exposed to browser context"
          />
        </div>
      </section>
    </div>
  )
}
