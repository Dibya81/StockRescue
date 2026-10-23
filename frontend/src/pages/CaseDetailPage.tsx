import { useParams, Link } from 'react-router-dom'
import { useCase, usePlans, useCreatePlan } from '@/hooks/api'
import { SkeletonCard, SkeletonLines } from '@/components/ui/Skeleton'
import { ErrorState } from '@/components/ui/ErrorState'
import { StatusBadge } from '@/components/ui/StatusBadge'
import {
  AlertCircle,
  ChevronRight,
  FileText,
  Briefcase,
  Layers,
  ArrowRight,
  ShieldAlert,
  Clock,
  Sparkles,
} from 'lucide-react'
import type { RecoveryPlanStatus } from '@/types/api'

export function CaseDetailPage() {
  const { caseId } = useParams<{ caseId: string }>()
  const { data: caseData, isLoading: caseLoading, isError: caseError, error: caseErr, refetch } = useCase(caseId)
  const { data: plansData, isLoading: plansLoading } = usePlans(caseId)
  const { mutateAsync: createPlan, isPending: planPending, error: planError } = useCreatePlan()

  if (caseLoading) {
    return (
      <div className="flex flex-col gap-6">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    )
  }
  if (caseError) return <ErrorState message={(caseErr as Error).message} onRetry={() => refetch()} />
  if (!caseData) return null

  const c = caseData
  const plans = plansData?.items ?? []

  return (
    <div className="flex flex-col gap-8">
      {/* Breadcrumb & Header */}
      <div className="flex flex-col gap-3">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-[#64748B]">
          <Link to="/disruptions" className="hover:text-[#2563EB] transition-colors font-medium">
            Disruptions
          </Link>
          <ChevronRight className="h-3.5 w-3.5 text-[#94A3B8]" />
          <span className="font-mono text-[#475569]">{c.case_id}</span>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-[#0F172A]">
                {c.affected_sku}
              </h1>
              <span className="rounded-md border border-[#E2E8F0] bg-[#FFFFFF] px-2.5 py-0.5 font-mono text-xs font-semibold text-[#475569] shadow-2xs">
                Case: {c.case_id}
              </span>
            </div>
            <p className="mt-1 text-xs text-[#475569]">
              Failed Supplier: <span className="font-mono text-[#0F172A] font-semibold">{c.failed_supplier_id}</span>
              {' · '}Created: {new Date(c.created_at).toLocaleString()}
            </p>
          </div>

          <button
            type="button"
            onClick={() => createPlan(c.case_id)}
            disabled={planPending}
            className="btn-primary"
          >
            {planPending ? (
              <span className="inline-flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Orchestrating Plan…
              </span>
            ) : (
              <span className="inline-flex items-center gap-2">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                Generate Recovery Plan
              </span>
            )}
          </button>
        </div>
      </div>

      {planError && (
        <div
          role="alert"
          className="flex items-center gap-2.5 rounded-xl border border-[#FECACA] bg-[#FEE2E2] p-4 text-xs text-[#DC2626]"
        >
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>{(planError as Error).message}</span>
        </div>
      )}

      {/* Grid: Case Details & Job Requirements */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Case Metadata */}
        <div className="card flex flex-col gap-4 bg-[#FFFFFF] border-[#E2E8F0] shadow-sm">
          <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
            <h2 className="text-sm font-semibold text-[#0F172A] flex items-center gap-2">
              <FileText className="h-4 w-4 text-[#2563EB]" />
              Case Parameters
            </h2>
            <span className="text-xs text-[#64748B] font-mono">Specs</span>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5 text-xs">
            <div className="flex flex-col gap-1">
              <dt className="text-[#64748B]">Incident Case ID</dt>
              <dd className="font-mono font-medium text-[#0F172A]">{c.case_id}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-[#64748B]">Critical SKU</dt>
              <dd className="font-mono text-[#0F172A] font-semibold">{c.affected_sku}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-[#64748B]">Failed Supplier</dt>
              <dd className="font-mono text-[#475569]">{c.failed_supplier_id}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-[#64748B]">Allocated Budget</dt>
              <dd className="text-[#0F172A] font-semibold">
                {c.budget ? `${c.currency} ${Number(c.budget).toLocaleString()}` : '—'}
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-[#64748B]">Delayed Until</dt>
              <dd className="text-[#0F172A] flex items-center gap-1.5 font-medium">
                <Clock className="h-3.5 w-3.5 text-[#D97706]" />
                {c.delayed_until ? new Date(c.delayed_until).toLocaleString() : '—'}
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-[#64748B]">Currency Standard</dt>
              <dd className="font-mono text-[#0F172A] font-medium">{c.currency}</dd>
            </div>
          </dl>
        </div>

        {/* Impacted Jobs */}
        <div className="card flex flex-col gap-4 bg-[#FFFFFF] border-[#E2E8F0] shadow-sm">
          <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
            <h2 className="text-sm font-semibold text-[#0F172A] flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-[#2563EB]" />
              Impacted Job Schedules ({c.jobs.length})
            </h2>
          </div>

          {c.jobs.length === 0 ? (
            <p className="text-xs text-[#64748B] py-4 text-center">No manufacturing jobs linked to this case.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left" aria-label="Job requirements">
                <thead>
                  <tr className="border-b border-[#E2E8F0] text-[#64748B] uppercase tracking-wider text-[10px] font-semibold">
                    <th className="py-2 pr-3">Job ID</th>
                    <th className="py-2 pr-3">Required SKU</th>
                    <th className="py-2 pr-3 text-right">Target Qty</th>
                    <th className="py-2">Deadline</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0]">
                  {c.jobs.map(j => (
                    <tr key={`${j.job_id}-${j.sku}`} className="hover:bg-[#F8FAFC]">
                      <td className="py-2 pr-3 font-mono font-semibold text-[#0F172A]">{j.job_id}</td>
                      <td className="py-2 pr-3 font-mono text-[#475569]">{j.sku}</td>
                      <td className="py-2 pr-3 text-right tabular-nums font-semibold text-[#0F172A]">
                        {j.required_quantity}
                      </td>
                      <td className="py-2 text-[#475569]">
                        {j.deadline ? new Date(j.deadline).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Local Warehouse Inventory Deficits */}
        <div className="card flex flex-col gap-4 lg:col-span-2 bg-[#FFFFFF] border-[#E2E8F0] shadow-sm">
          <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
            <h2 className="text-sm font-semibold text-[#0F172A] flex items-center gap-2">
              <Layers className="h-4 w-4 text-[#2563EB]" />
              Warehouse Stock Status & Deficits ({c.inventory.length})
            </h2>
          </div>

          {c.inventory.length === 0 ? (
            <p className="text-xs text-[#64748B] py-4 text-center">No inventory records logged for this case.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left" aria-label="Inventory records">
                <thead>
                  <tr className="border-b border-[#E2E8F0] text-[#64748B] uppercase tracking-wider text-[10px] font-semibold">
                    <th className="py-2 pr-3">SKU</th>
                    <th className="py-2 pr-3">Storage Location</th>
                    <th className="py-2 pr-3 text-right">Available Stock</th>
                    <th className="py-2 pr-3 text-right">Required Target</th>
                    <th className="py-2 pr-3 text-right">Shortage</th>
                    <th className="py-2">Health State</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0]">
                  {c.inventory.map((inv, i) => {
                    const isDeficit = inv.shortage > 0
                    return (
                      <tr key={i} className={`hover:bg-[#F8FAFC] ${isDeficit ? 'bg-[#FEF2F2]/60' : ''}`}>
                        <td className="py-2 pr-3 font-mono font-semibold text-[#0F172A]">{inv.sku}</td>
                        <td className="py-2 pr-3 font-mono text-[#475569]">{inv.location ?? '—'}</td>
                        <td className="py-2 pr-3 text-right tabular-nums font-semibold text-[#0F172A]">
                          {inv.available_quantity}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-[#475569]">
                          {inv.required_quantity}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums font-bold">
                          {isDeficit ? (
                            <span className="text-[#DC2626]">-{inv.shortage}</span>
                          ) : (
                            <span className="text-[#64748B]">0</span>
                          )}
                        </td>
                        <td className="py-2">
                          <StatusBadge variant={isDeficit ? 'shortage' : 'normal'} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Generated Recovery Plans Section */}
      <section aria-labelledby="plans-heading" className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 id="plans-heading" className="text-base font-bold tracking-tight text-[#0F172A]">
              Generated Recovery Plans ({plansLoading ? '…' : plans.length})
            </h2>
            <p className="text-xs text-[#475569]">
              Algorithmic supplier rerouting and substitution options calculated by backend recovery specialists.
            </p>
          </div>
        </div>

        {plansLoading ? (
          <SkeletonLines lines={3} />
        ) : plans.length === 0 ? (
          <div className="card flex flex-col items-center justify-center p-8 text-center bg-[#FFFFFF]">
            <FileText className="h-8 w-8 text-[#94A3B8] mb-2" />
            <p className="text-xs text-[#475569]">No recovery plans generated yet.</p>
            <p className="text-[11px] text-[#64748B] mt-1">
              Click &quot;Generate Recovery Plan&quot; above to initiate AI supplier discovery and cost calculation.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {plans.map(plan => (
              <div
                key={plan.plan_id}
                className="card flex flex-col justify-between gap-4 p-5 hover:border-[#2563EB]/40 hover:shadow-md transition-all bg-[#FFFFFF]"
              >
                <div className="flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="font-mono text-xs text-[#64748B]">{plan.plan_id}</span>
                      <h3 className="mt-1 text-lg font-bold text-[#0F172A]">
                        {plan.currency} {Number(plan.total_cost).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </h3>
                    </div>
                    <StatusBadge variant={plan.status as RecoveryPlanStatus} />
                  </div>

                  {/* Risks findings */}
                  {plan.risk_findings && plan.risk_findings.length > 0 && (
                    <div className="rounded-lg bg-[#FEF2F2] border border-[#FECACA] p-2.5">
                      <p className="text-[10px] font-semibold text-[#DC2626] uppercase tracking-wider mb-1 flex items-center gap-1">
                        <ShieldAlert className="h-3 w-3 text-[#DC2626]" />
                        Identified Risks ({plan.risk_findings.length})
                      </p>
                      <ul className="flex flex-col gap-1 text-[11px] text-[#DC2626]">
                        {plan.risk_findings.map((r, idx) => (
                          <li key={idx} className="line-clamp-1">• {r}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between border-t border-[#E2E8F0] pt-3">
                  <span className="text-[11px] text-[#64748B]">
                    Created: {new Date(plan.created_at).toLocaleDateString()}
                  </span>
                  <Link
                    to={`/approvals`}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2563EB] hover:text-[#1D4ED8]"
                  >
                    Review in Approvals
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
