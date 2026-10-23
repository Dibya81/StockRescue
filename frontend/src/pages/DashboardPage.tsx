import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  Briefcase,
  ShieldCheck,
  Plus,
  Warehouse,
  Boxes,
  Clock,
  ArrowRight,
  TrendingDown,
  Layers,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react'
import { useCases } from '@/hooks/api'
import { SkeletonCard } from '@/components/ui/Skeleton'
import { StatusBadge } from '@/components/ui/StatusBadge'

interface MetricCardProps {
  label: string
  value: React.ReactNode
  icon: React.ElementType
  description?: string
  statusType?: 'normal' | 'low' | 'shortage' | 'info'
  to?: string
}

function MetricCard({
  label,
  value,
  icon: Icon,
  description,
  statusType = 'info',
  to,
}: MetricCardProps) {
  const content = (
    <div className="card group relative flex flex-col justify-between overflow-hidden border-[#E2E8F0] bg-[#FFFFFF] p-5 transition-all duration-200 hover:border-[#CBD5E1] hover:shadow-md hover:-translate-y-0.5">
      <div className="flex items-start justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-[#64748B]">
          {label}
        </span>
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-lg border ${
            statusType === 'shortage'
              ? 'border-[#FECACA] bg-[#FEE2E2] text-[#DC2626]'
              : statusType === 'low'
              ? 'border-[#FDE68A] bg-[#FEF3C7] text-[#D97706]'
              : statusType === 'normal'
              ? 'border-[#BBF7D0] bg-[#DCFCE7] text-[#16A34A]'
              : 'border-[#BFDBFE] bg-[#EFF6FF] text-[#2563EB]'
          }`}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
        </div>
      </div>

      <div className="mt-4 flex items-baseline gap-2">
        <p className="text-3xl font-extrabold tracking-tight text-[#0F172A] tabular-nums" aria-label={`${label}: ${value}`}>
          {value}
        </p>
      </div>

      {description && (
        <p className="mt-2 text-xs text-[#64748B] flex items-center justify-between">
          <span>{description}</span>
          {to && (
            <ArrowRight className="h-3 w-3 text-[#94A3B8] transition-transform group-hover:translate-x-0.5 group-hover:text-[#2563EB]" />
          )}
        </p>
      )}
    </div>
  )

  if (to) {
    return (
      <Link to={to} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] rounded-xl">
        {content}
      </Link>
    )
  }

  return content
}

export function DashboardPage() {
  const { data, isLoading, isError, error, refetch } = useCases({ limit: 100 })

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <div className="h-8 w-64 animate-pulse rounded bg-[#E2E8F0]" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    )
  }

  const cases = data?.items ?? []

  // Compute real metrics from actual backend returned data
  const totalShortages = cases.reduce(
    (sum, c) =>
      sum + c.inventory.reduce((s, inv) => s + Math.max(inv.shortage, 0), 0),
    0,
  )

  const totalJobs = cases.reduce((sum, c) => sum + c.jobs.length, 0)
  const totalInventoryRecords = cases.reduce((sum, c) => sum + c.inventory.length, 0)

  const atRiskDeadlines = cases
    .flatMap(c => c.jobs)
    .filter(j => j.deadline)
    .sort((a, b) => (a.deadline! < b.deadline! ? -1 : 1))
    .slice(0, 6)

  const operationalRisk =
    totalShortages > 0 ? 'Elevated Shortage Risk' : cases.length > 0 ? 'Active Monitoring' : 'Nominal'

  return (
    <div className="flex flex-col gap-8">
      {/* Top Command Banner */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-[#E2E8F0] pb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-[#0F172A]">
              Operations Command Center
            </h1>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#2563EB]/25 bg-[#EFF6FF] px-2.5 py-0.5 text-xs font-semibold text-[#2563EB] shadow-2xs">
              <span className="h-1.5 w-1.5 rounded-full bg-[#2563EB] animate-pulse" />
              Real-time
            </span>
          </div>
          <p className="mt-1 text-sm text-[#475569]">
            Multi-agent supply disruption response, material feasibility & human-approved recovery.
          </p>
        </div>

        {/* Quick Action Cluster */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <Link
            to="/warehouse"
            className="btn-secondary text-xs sm:text-sm"
          >
            <Warehouse className="h-4 w-4 text-[#2563EB]" />
            3D Warehouse
          </Link>
          <Link
            to="/disruptions/new"
            className="btn-primary text-xs sm:text-sm shadow-sm"
          >
            <Plus className="h-4 w-4" />
            Intake New Case
          </Link>
        </div>
      </div>

      {/* Backend Disconnection Banner if offline */}
      {isError && (
        <div className="flex items-center justify-between rounded-xl border border-[#FDE68A] bg-[#FEF3C7] px-4 py-3 text-xs text-[#D97706] shadow-2xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-[#D97706] flex-shrink-0" />
            <span>
              <strong>Backend Disconnected (http://localhost:8000):</strong> {(error as Error).message}. Displaying standby dashboard telemetry. Start the FastAPI backend to synchronize live incident data.
            </span>
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            className="btn-clay text-xs py-1 px-3 ml-3 flex items-center gap-1.5 whitespace-nowrap"
          >
            <RefreshCw className="h-3 w-3 text-[#2563EB]" />
            Retry
          </button>
        </div>
      )}

      {/* Operational KPI Section — 6 Key Metrics */}
      <section aria-labelledby="metrics-heading">
        <h2 id="metrics-heading" className="sr-only">Operational KPIs</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <MetricCard
            label="Open Disruptions"
            value={cases.length}
            icon={AlertTriangle}
            statusType={cases.length > 0 ? 'shortage' : 'normal'}
            description={cases.length === 0 ? 'All clear' : `${cases.length} active incident(s)`}
            to="/disruptions"
          />
          <MetricCard
            label="Material Shortages"
            value={totalShortages}
            icon={TrendingDown}
            statusType={totalShortages > 0 ? 'shortage' : 'normal'}
            description="Short-stock units"
            to="/inventory"
          />
          <MetricCard
            label="Affected Jobs"
            value={totalJobs}
            icon={Briefcase}
            statusType={totalJobs > 0 ? 'low' : 'normal'}
            description="Production jobs blocked"
            to="/disruptions"
          />
          <MetricCard
            label="Catalog SKUs"
            value={totalInventoryRecords}
            icon={Boxes}
            statusType="info"
            description="Tracked item bins"
            to="/inventory"
          />
          <MetricCard
            label="Approval Queue"
            value={cases.length > 0 ? cases.length : 0}
            icon={ShieldCheck}
            statusType="info"
            description="Human review required"
            to="/approvals"
          />
          <MetricCard
            label="System Risk State"
            value={totalShortages > 0 ? 'ELEVATED' : 'NOMINAL'}
            icon={Layers}
            statusType={totalShortages > 0 ? 'low' : 'normal'}
            description={operationalRisk}
            to="/settings"
          />
        </div>
      </section>

      {/* Main Command Center Grid: Left 2 Cols, Right 1 Col */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column: Disruption Incidents Table */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          <section className="card flex flex-col gap-4 border-[#E2E8F0] bg-[#FFFFFF]" aria-labelledby="cases-heading">
            <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-[#D97706]" />
                <h2 id="cases-heading" className="text-base font-semibold text-[#0F172A]">
                  Active Disruption Incidents
                </h2>
              </div>
              <Link
                to="/disruptions"
                className="text-xs font-semibold text-[#2563EB] hover:text-[#1D4ED8] flex items-center gap-1 transition-colors"
              >
                View all cases <ArrowRight className="h-3 w-3" />
              </Link>
            </div>

            {cases.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#DCFCE7] text-[#16A34A] mb-3 border border-[#BBF7D0]">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
                <p className="font-semibold text-sm text-[#0F172A]">No Active Disruptions</p>
                <p className="text-xs text-[#64748B] mt-1 max-w-xs">
                  All recorded inventory quantities currently satisfy BOM demands.
                </p>
                <Link to="/disruptions/new" className="btn-secondary text-xs mt-4">
                  <Plus className="h-3.5 w-3.5" /> Log Disruption Case
                </Link>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-[#E2E8F0]">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-xs font-medium text-[#64748B]">
                      <th className="px-4 py-3">Case ID</th>
                      <th className="px-4 py-3">Affected SKU</th>
                      <th className="px-4 py-3">Failed Supplier</th>
                      <th className="px-4 py-3 text-center">Jobs</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Budget</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E8F0]">
                    {cases.map(c => {
                      const shortage = c.inventory.reduce(
                        (s, inv) => s + Math.max(inv.shortage, 0),
                        0,
                      )
                      return (
                        <tr
                          key={c.case_id}
                          className="transition-colors hover:bg-[#F8FAFC]"
                        >
                          <td className="px-4 py-3">
                            <Link
                              to={`/disruptions/${c.case_id}`}
                              className="font-mono text-xs font-semibold text-[#2563EB] hover:underline"
                            >
                              {c.case_id}
                            </Link>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-[#0F172A] font-medium">
                            {c.affected_sku}
                          </td>
                          <td className="px-4 py-3 text-xs text-[#475569]">
                            {c.failed_supplier_id}
                          </td>
                          <td className="px-4 py-3 text-center text-xs font-semibold text-[#0F172A] tabular-nums">
                            {c.jobs.length}
                          </td>
                          <td className="px-4 py-3">
                            {shortage > 0 ? (
                              <StatusBadge variant="shortage" />
                            ) : (
                              <StatusBadge variant="normal" />
                            )}
                          </td>
                          <td className="px-4 py-3 text-right text-xs text-[#475569] font-mono tabular-nums">
                            {c.budget ? `${c.currency} ${c.budget}` : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Interactive 3D Warehouse Preview Callout */}
          <div className="card flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-[#E2E8F0] bg-gradient-to-r from-[#FFFFFF] via-[#EFF6FF] to-[#FFFFFF] p-5 shadow-sm">
            <div className="flex items-center gap-3.5">
              <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-[#EFF6FF] border border-[#2563EB]/25 text-[#2563EB] shadow-xs">
                <Warehouse className="h-6 w-6" />
              </div>
              <div>
                <h3 className="font-semibold text-sm text-[#0F172A]">
                  Interactive 3D Digital Twin Warehouse
                </h3>
                <p className="text-xs text-[#64748B] mt-0.5">
                  Visual bin inspector, aisle navigation, shortage locator and live storage levels.
                </p>
              </div>
            </div>
            <Link
              to="/warehouse"
              className="btn-primary text-xs whitespace-nowrap shadow-sm"
            >
              Open 3D Scene <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        {/* Right Column: Deadlines, Approvals & Workflow Status */}
        <div className="flex flex-col gap-6">
          {/* Urgent Job Deadlines */}
          <section className="card flex flex-col gap-3.5 border-[#E2E8F0] bg-[#FFFFFF]" aria-labelledby="atrisk-heading">
            <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-[#D97706]" />
                <h2 id="atrisk-heading" className="text-sm font-semibold text-[#0F172A]">
                  Critical Job Deadlines
                </h2>
              </div>
              <span className="text-[10px] text-[#64748B] uppercase tracking-wider font-semibold">
                Upcoming
              </span>
            </div>

            {atRiskDeadlines.length === 0 ? (
              <p className="text-xs text-[#64748B] py-4 text-center">
                No immediate deadline constraints recorded in active cases.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {atRiskDeadlines.map((job, idx) => (
                  <div
                    key={`${job.job_id}-${job.sku}-${idx}`}
                    className="flex items-center justify-between rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3.5 py-2.5 transition-colors hover:border-[#CBD5E1]"
                  >
                    <div className="flex flex-col">
                      <span className="font-mono text-xs font-semibold text-[#0F172A]">
                        {job.job_id}
                      </span>
                      <span className="text-[11px] text-[#64748B] font-mono">
                        {job.sku} • Qty: {job.required_quantity}
                      </span>
                    </div>
                    <span className="text-xs font-semibold text-[#D97706] bg-[#FEF3C7] border border-[#FDE68A] px-2 py-0.5 rounded shadow-2xs">
                      {new Date(job.deadline!).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Human-in-the-Loop Procurement Notice */}
          <div className="card flex flex-col gap-3 border-[#E2E8F0] bg-[#FFFFFF] p-4 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#2563EB]">
              <ShieldCheck className="h-4 w-4" />
              Human Authorization Protocol
            </div>
            <p className="text-xs text-[#475569] leading-relaxed">
              Automated purchasing and external communication triggers are strictly disabled. All recovery actions require verified cryptographic operator authorization.
            </p>
            <div className="mt-1 flex items-center justify-between text-xs border-t border-[#E2E8F0] pt-2.5">
              <span className="text-[#64748B]">Purchasing: <strong className="text-[#16A34A] font-semibold">Disabled</strong></span>
              <Link to="/approvals" className="text-[#2563EB] hover:underline font-semibold">
                Review Approvals →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
