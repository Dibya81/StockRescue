import { useCases, usePlans } from '@/hooks/api'
import { Link } from 'react-router-dom'
import { SkeletonCard } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { FileText, ShieldAlert, HelpCircle, ArrowRight, ShieldCheck, AlertTriangle, RefreshCw } from 'lucide-react'
import type { RecoveryPlanStatus } from '@/types/api'

function PlanRow({
  caseId,
  planId,
  total,
  currency,
  status,
  risks,
  uncertainties,
}: {
  caseId: string
  planId: string
  total: string
  currency: string
  status: RecoveryPlanStatus
  risks: string[]
  uncertainties: string[]
}) {
  return (
    <div className="card flex flex-col justify-between gap-5 p-5 bg-[#FFFFFF] border-[#E2E8F0] shadow-sm hover:border-[#2563EB]/40 hover:shadow-md transition-all">
      <div className="flex flex-col gap-4">
        {/* Top Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="font-mono text-xs text-[#64748B]">{planId}</span>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-xl font-bold tracking-tight text-[#0F172A]">
                {currency} {Number(total).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
              <span className="text-[11px] text-[#64748B]">authoritative total</span>
            </div>
          </div>
          <StatusBadge variant={status} />
        </div>

        {/* Risk Findings */}
        {risks.length > 0 && (
          <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[#DC2626] uppercase tracking-wider text-[10px]">
              <ShieldAlert className="h-3.5 w-3.5 text-[#DC2626]" />
              Identified Operational Risks ({risks.length})
            </p>
            <ul className="flex flex-col gap-1">
              {risks.map((r, i) => (
                <li key={i} className="text-xs text-[#DC2626]/90 leading-relaxed font-medium">
                  • {r}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Uncertainties */}
        {uncertainties.length > 0 && (
          <div className="rounded-xl border border-[#FDE68A] bg-[#FEF3C7] p-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[#D97706] uppercase tracking-wider text-[10px]">
              <HelpCircle className="h-3.5 w-3.5 text-[#D97706]" />
              Outstanding Uncertainties ({uncertainties.length})
            </p>
            <ul className="flex flex-col gap-1">
              {uncertainties.map((u, i) => (
                <li key={i} className="text-xs text-[#D97706]/90 leading-relaxed font-medium">
                  • {u}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Footer navigation */}
      <div className="flex items-center justify-between border-t border-[#E2E8F0] pt-3 text-xs">
        <Link
          to={`/disruptions/${caseId}`}
          className="font-mono text-[#64748B] hover:text-[#0F172A] transition-colors"
        >
          Case: {caseId}
        </Link>
        <Link
          to="/approvals"
          className="inline-flex items-center gap-1.5 font-semibold text-[#2563EB] hover:text-[#1D4ED8] transition-colors"
        >
          Proceed to Approvals
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  )
}

function CasePlans({ caseId }: { caseId: string }) {
  const { data, isLoading } = usePlans(caseId)
  if (isLoading) return <SkeletonCard />
  if (!data || data.items.length === 0) return null

  return (
    <>
      {data.items.map(p => (
        <PlanRow
          key={p.plan_id}
          caseId={caseId}
          planId={p.plan_id}
          total={p.total_cost}
          currency={p.currency}
          status={p.status as RecoveryPlanStatus}
          risks={p.risk_findings}
          uncertainties={p.outstanding_uncertainties}
        />
      ))}
    </>
  )
}

export function RecoveryPage() {
  const { data, isLoading, isError, error, refetch } = useCases({ limit: 100 })

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    )
  }

  const cases = data?.items ?? []

  return (
    <div className="flex flex-col gap-6">
      {/* Header & Authoritative Governance Notice */}
      <div className="flex flex-col gap-3">
        <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">
          Recovery Strategy Portfolio
        </h1>
        <div className="flex items-start gap-2.5 rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] p-3.5 text-xs text-[#475569] shadow-2xs">
          <ShieldCheck className="h-4 w-4 text-[#2563EB] flex-shrink-0 mt-0.5" />
          <span>
            Recovery plan totals and feasibility criteria are calculated authoritatively by the backend Quote Risk specialist. Financial estimates and delivery constraints shown are backend-produced only.
          </span>
        </div>
      </div>

      {/* Disconnection Warning if offline */}
      {isError && (
        <div className="flex items-center justify-between rounded-xl border border-[#FDE68A] bg-[#FEF3C7] px-4 py-3 text-xs text-[#D97706] shadow-2xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-[#D97706] flex-shrink-0" />
            <span>
              <strong>Backend Disconnected:</strong> Live recovery strategy portfolios unavailable ({(error as Error)?.message || 'Failed to fetch'}). Showing standby plans view.
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

      {cases.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No recovery plans generated"
          description="Recovery plans will appear here once disruption cases are created and algorithmic recovery is triggered."
        />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2">
          {cases.map(c => (
            <CasePlans key={c.case_id} caseId={c.case_id} />
          ))}
        </div>
      )}
    </div>
  )
}
