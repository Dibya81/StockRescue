import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useCases } from '@/hooks/api'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Truck, CheckCircle2, AlertCircle, Info, Calendar, Clock, AlertTriangle, RefreshCw } from 'lucide-react'
import type { CompatibilityVerdict } from '@/types/api'

export function SuppliersPage() {
  const { data, isLoading, isError, error, refetch } = useCases({ limit: 100 })

  const offers = useMemo(() => {
    return (data?.items ?? []).flatMap(c =>
      c.offers.map(o => ({
        ...o,
        caseId: c.case_id,
        compatibility: c.compatibility.find(
          comp => comp.supplier_id === o.supplier_id && comp.candidate_sku === o.sku,
        ),
      })),
    )
  }, [data])

  const stats = useMemo(() => {
    let compatibleCount = 0
    let incompatibleCount = 0
    for (const o of offers) {
      if (o.compatibility?.verdict === 'compatible') compatibleCount++
      else if (o.compatibility?.verdict === 'incompatible') incompatibleCount++
    }
    return {
      total: offers.length,
      compatible: compatibleCount,
      incompatible: incompatibleCount,
    }
  }, [offers])

  const verdictVariant = (v: CompatibilityVerdict | undefined): 'normal' | 'shortage' | 'unknown' => {
    if (v === 'compatible') return 'normal'
    if (v === 'incompatible') return 'shortage'
    return 'unknown'
  }

  if (isLoading) return <SkeletonTable rows={6} />

  return (
    <div className="flex flex-col gap-6">
      {/* Header & KPI Summary */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">
            Supplier Discovery & Compatibility
          </h1>
          <p className="mt-1 text-xs text-[#475569]">
            Sourced substitute quotes and automated fit-form-function compatibility verifications.
          </p>
        </div>

        {/* Quick summary stats */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-[#E2E8F0] bg-[#FFFFFF] px-3 py-1.5 text-xs shadow-2xs">
            <Truck className="h-3.5 w-3.5 text-[#64748B]" />
            <span className="text-[#64748B]">Discovered Quotes:</span>
            <span className="font-semibold text-[#0F172A] tabular-nums">{stats.total}</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-[#16A34A]/20 bg-[#DCFCE7] px-3 py-1.5 text-xs shadow-2xs">
            <CheckCircle2 className="h-3.5 w-3.5 text-[#16A34A]" />
            <span className="text-[#16A34A] font-medium">Compatible:</span>
            <span className="font-semibold text-[#16A34A] tabular-nums">{stats.compatible}</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-[#DC2626]/20 bg-[#FEE2E2] px-3 py-1.5 text-xs shadow-2xs">
            <AlertCircle className="h-3.5 w-3.5 text-[#DC2626]" />
            <span className="text-[#DC2626] font-medium">Incompatible:</span>
            <span className="font-semibold text-[#DC2626] tabular-nums">{stats.incompatible}</span>
          </div>
        </div>
      </div>

      {/* Disconnection Warning if offline */}
      {isError && (
        <div className="flex items-center justify-between rounded-xl border border-[#FDE68A] bg-[#FEF3C7] px-4 py-3 text-xs text-[#D97706] shadow-2xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-[#D97706] flex-shrink-0" />
            <span>
              <strong>Backend Disconnected:</strong> Live candidate supplier quotes unavailable ({(error as Error)?.message || 'Failed to fetch'}). Showing standby catalog view.
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

      {/* Operational Provenance Notice */}
      <div className="flex items-start gap-2.5 rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] p-3.5 text-xs text-[#475569] shadow-2xs">
        <Info className="h-4 w-4 text-[#2563EB] flex-shrink-0 mt-0.5" />
        <span>
          Supplier offers and lead times are ingested from active disruption cases. Compatibility evaluations are performed by backend reasoning specialists to guarantee engineering tolerances.
        </span>
      </div>

      {/* Offers Table / Empty State */}
      {offers.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="No candidate supplier offers found"
          description="Supplier quotes and substitute part proposals will appear here once disruption cases are triaged."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] shadow-sm">
          <table className="w-full text-xs text-left" aria-label="Supplier offers">
            <thead>
              <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[#64748B] font-semibold uppercase tracking-wider text-[10px]">
                <th scope="col" className="px-4 py-3">Supplier Identifier</th>
                <th scope="col" className="px-4 py-3">Candidate Part SKU</th>
                <th scope="col" className="px-4 py-3 text-right">Quoted Unit Price</th>
                <th scope="col" className="px-4 py-3 text-right">Lead Time</th>
                <th scope="col" className="px-4 py-3">Quote Expiration</th>
                <th scope="col" className="px-4 py-3">Compatibility Analysis</th>
                <th scope="col" className="px-4 py-3">Linked Case</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {offers.map((o, i) => (
                <tr key={i} className="hover:bg-[#F8FAFC] transition-colors">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-[#0F172A]">
                    {o.supplier_id}
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs font-semibold text-[#0F172A] bg-[#F1F5F9] px-2 py-0.5 rounded border border-[#E2E8F0]">
                      {o.sku}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold text-[#0F172A]">
                    {o.currency} {Number(o.unit_price).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-[#475569]">
                    {o.lead_time_days != null ? (
                      <span className="inline-flex items-center gap-1 font-medium text-[#0F172A]">
                        <Clock className="h-3 w-3 text-[#64748B]" />
                        {o.lead_time_days} days
                      </span>
                    ) : (
                      <span className="text-[#64748B]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-[#475569]">
                    {o.quote_expires_at ? (
                      <div className="flex items-center gap-1.5 text-[#475569]">
                        <Calendar className="h-3 w-3 text-[#64748B]" />
                        <span>{new Date(o.quote_expires_at).toLocaleDateString()}</span>
                      </div>
                    ) : (
                      <span className="text-[#64748B]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <StatusBadge variant={verdictVariant(o.compatibility?.verdict)} />
                      {o.compatibility?.explanation && (
                        <span
                          className="cursor-help rounded bg-[#F1F5F9] px-1.5 py-0.5 text-[10px] text-[#64748B] border border-[#E2E8F0] font-medium"
                          title={o.compatibility.explanation}
                        >
                          Details
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      to={`/disruptions/${o.caseId}`}
                      className="font-mono text-xs text-[#2563EB] hover:text-[#1D4ED8] hover:underline font-semibold"
                    >
                      {o.caseId}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
