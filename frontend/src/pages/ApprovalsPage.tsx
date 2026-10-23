import { useState } from 'react'
import {
  useCases,
  usePlans,
  useApprovals,
  useActiveApproval,
  useCreateApproval,
  useRevokeApproval,
} from '@/hooks/api'
import { SkeletonCard } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { ShieldCheck, AlertCircle, AlertTriangle, CheckCircle2, History, RefreshCw } from 'lucide-react'
import { ApiClientError } from '@/lib/api'
import type { RecoveryPlan } from '@/types/api'

function PlanApprovalPanel({ plan, caseId }: { plan: RecoveryPlan; caseId: string }) {
  const { data: activeApproval } = useActiveApproval(caseId, plan.plan_id)
  const { data: approvalsData } = useApprovals(caseId, plan.plan_id)
  const { mutateAsync: approve, isPending: approving } = useCreateApproval()
  const { mutateAsync: revoke, isPending: revoking } = useRevokeApproval()

  const [maxCost, setMaxCost] = useState('')
  const currency = plan.currency
  const [expiresAt, setExpiresAt] = useState('')
  const [revokeReason, setRevokeReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)

  const handleApprove = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!confirmed) {
      setConfirmed(true)
      return
    }
    setError(null)
    try {
      await approve({
        caseId,
        planId: plan.plan_id,
        body: { max_total_cost: maxCost, currency, expires_at: new Date(expiresAt).toISOString() },
      })
      setConfirmed(false)
      setMaxCost('')
      setExpiresAt('')
    } catch (err) {
      setConfirmed(false)
      setError(err instanceof ApiClientError ? String(err.detail) : (err as Error).message)
    }
  }

  const handleRevoke = async (approvalId: string) => {
    if (!revokeReason.trim()) {
      setError('Revocation reason is required.')
      return
    }
    setError(null)
    try {
      await revoke({
        caseId,
        planId: plan.plan_id,
        approvalId,
        body: { revocation_reason: revokeReason },
      })
      setRevokeReason('')
    } catch (err) {
      setError(err instanceof ApiClientError ? String(err.detail) : (err as Error).message)
    }
  }

  return (
    <div className="card flex flex-col justify-between gap-5 p-5 bg-[#FFFFFF] border-[#E2E8F0] shadow-sm">
      <div className="flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="font-mono text-xs text-[#64748B]">{plan.plan_id}</span>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-xl font-bold tracking-tight text-[#0F172A]">
                {plan.currency} {Number(plan.total_cost).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
              <span className="text-[11px] text-[#64748B]">plan estimate</span>
            </div>
          </div>
          <StatusBadge variant={plan.status as 'proposed' | 'approved' | 'revoked' | 'expired'} />
        </div>

        {error && (
          <div
            role="alert"
            className="flex items-center gap-2.5 rounded-lg border border-[#FECACA] bg-[#FEE2E2] p-3 text-xs text-[#DC2626]"
          >
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Create Approval — Proposed plans without active approval */}
        {plan.status === 'proposed' && !activeApproval && (
          <form onSubmit={handleApprove} className="flex flex-col gap-3.5 border-t border-[#E2E8F0] pt-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#475569]">
                Authorize Plan Commitment
              </span>
              <span className="text-[11px] text-[#64748B] font-medium">Requires Approver Role</span>
            </div>

            {confirmed && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-[#FDE68A] bg-[#FEF3C7] p-3 text-xs text-[#D97706]"
              >
                <AlertTriangle className="h-4 w-4 text-[#D97706] flex-shrink-0 mt-0.5" />
                <span>
                  Confirm authorization for plan <strong>{plan.plan_id}</strong> up to ceiling{' '}
                  <strong>
                    {plan.currency} {maxCost}
                  </strong>
                  . Click &quot;Confirm Approval&quot; to execute signing.
                </span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-[#64748B] font-semibold">Max Authorized Cost ({plan.currency})</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  placeholder="0.00"
                  value={maxCost}
                  onChange={e => {
                    setMaxCost(e.target.value)
                    setConfirmed(false)
                  }}
                  className="input-field text-xs py-1.5 tabular-nums"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-[#64748B] font-semibold">Expiry Timestamp</label>
                <input
                  type="datetime-local"
                  required
                  value={expiresAt}
                  onChange={e => {
                    setExpiresAt(e.target.value)
                    setConfirmed(false)
                  }}
                  className="input-field text-xs py-1.5"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={approving || !maxCost || !expiresAt}
              className="btn-primary self-start mt-1"
            >
              {approving ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Authorizing…
                </span>
              ) : confirmed ? (
                'Confirm Approval'
              ) : (
                'Approve Plan'
              )}
            </button>
          </form>
        )}

        {/* Active Approval Panel */}
        {activeApproval && (
          <div className="flex flex-col gap-3 rounded-xl border border-[#BBF7D0] bg-[#DCFCE7]/60 p-4 border-t">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-[#16A34A]" />
              <span className="text-xs font-semibold text-[#16A34A]">
                Active Authorization: {activeApproval.approval_id}
              </span>
            </div>
            <p className="text-xs text-[#475569]">
              Signed by <strong className="text-[#0F172A] font-semibold">{activeApproval.approved_by}</strong> ·
              Ceiling: {activeApproval.currency} {activeApproval.max_total_cost} · Expires{' '}
              {new Date(activeApproval.expires_at).toLocaleString()}
            </p>

            <div className="mt-1 flex gap-2">
              <input
                placeholder="Reason for revoking authorization…"
                value={revokeReason}
                onChange={e => setRevokeReason(e.target.value)}
                className="input-field flex-1 text-xs py-1.5"
              />
              <button
                type="button"
                onClick={() => handleRevoke(activeApproval.approval_id)}
                disabled={revoking}
                className="rounded-lg border border-[#DC2626]/30 bg-[#FEE2E2] px-3.5 py-1.5 text-xs font-semibold text-[#DC2626] hover:bg-[#FECACA] transition-colors disabled:opacity-50"
              >
                {revoking ? 'Revoking…' : 'Revoke'}
              </button>
            </div>
          </div>
        )}

        {/* Approval History Audit Trail */}
        {(approvalsData?.items ?? []).length > 0 && (
          <div className="border-t border-[#E2E8F0] pt-3">
            <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold text-[#475569]">
              <History className="h-3.5 w-3.5 text-[#64748B]" />
              <span>Authorization Audit Trail</span>
            </div>
            <ul className="flex flex-col gap-1.5">
              {approvalsData!.items.map(a => (
                <li
                  key={a.approval_id}
                  className="flex flex-wrap items-center justify-between rounded bg-[#F8FAFC] px-2.5 py-1.5 text-[11px] border border-[#E2E8F0]"
                >
                  <div className="flex items-center gap-2">
                    <StatusBadge variant={a.revoked ? 'revoked' : 'approved'} showSymbol={false} />
                    <span className="font-mono text-[#0F172A] font-medium">{a.approval_id}</span>
                    <span className="text-[#64748B]">by {a.approved_by}</span>
                  </div>
                  {a.revoked_by && (
                    <span className="text-[#DC2626] text-[10px] font-semibold">
                      Revoked by {a.revoked_by}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

function CasePlanApprovals({ caseId }: { caseId: string }) {
  const { data } = usePlans(caseId)
  if (!data || data.items.length === 0) return null
  return (
    <>
      {data.items.map(plan => (
        <PlanApprovalPanel key={plan.plan_id} plan={plan} caseId={caseId} />
      ))}
    </>
  )
}

export function ApprovalsPage() {
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
      {/* Header & Strict Safety Banner */}
      <div className="flex flex-col gap-3">
        <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">
          Procurement Authorization & Governance
        </h1>

        <div className="flex items-start gap-2.5 rounded-xl border border-[#FDE68A] bg-[#FEF3C7] p-3.5 text-xs text-[#D97706] shadow-2xs">
          <AlertTriangle className="h-4 w-4 text-[#D97706] flex-shrink-0 mt-0.5" />
          <span>
            <strong>Human-in-the-Loop Safety Rule:</strong> Procurement remains strictly draft-only. No live financial orders will be placed. Approvals authorize simulated vendor allocations and require a verified operator identity with role <code>approver</code>.
          </span>
        </div>
      </div>

      {/* Disconnection Warning if offline */}
      {isError && (
        <div className="flex items-center justify-between rounded-xl border border-[#FDE68A] bg-[#FEF3C7] px-4 py-3 text-xs text-[#D97706] shadow-2xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-[#D97706] flex-shrink-0" />
            <span>
              <strong>Backend Disconnected:</strong> Live approval queues unavailable ({(error as Error)?.message || 'Failed to fetch'}). Showing standby approvals view.
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
          icon={ShieldCheck}
          title="No pending recovery approvals"
          description="Create disruption cases and generate recovery plans first to populate the approval queue."
        />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2">
          {cases.map(c => (
            <CasePlanApprovals key={c.case_id} caseId={c.case_id} />
          ))}
        </div>
      )}
    </div>
  )
}
