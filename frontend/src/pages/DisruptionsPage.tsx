import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Plus, Search, Calendar, Briefcase, ArrowUpRight, RefreshCw } from 'lucide-react'
import { useCases } from '@/hooks/api'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'

export function DisruptionsPage() {
  const { data, isLoading, isError, refetch } = useCases({ limit: 100 })
  const [search, setSearch] = useState('')

  const rawCases = useMemo(() => data?.items ?? [], [data])

  const cases = useMemo(() => {
    return rawCases.filter(
      c =>
        !search ||
        c.case_id.toLowerCase().includes(search.toLowerCase()) ||
        c.affected_sku.toLowerCase().includes(search.toLowerCase()) ||
        c.failed_supplier_id.toLowerCase().includes(search.toLowerCase()),
    )
  }, [rawCases, search])

  const stats = useMemo(() => {
    let totalJobs = 0
    let totalShortage = 0
    for (const c of rawCases) {
      totalJobs += c.jobs.length
      totalShortage += c.inventory.reduce((acc, i) => acc + (i.shortage || 0), 0)
    }
    return {
      totalCases: rawCases.length,
      impactedJobs: totalJobs,
      totalShortage,
    }
  }, [rawCases])

  if (isLoading) return <SkeletonTable rows={6} />

  return (
    <div className="flex flex-col gap-6">
      {/* Header & KPI Summary */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">
              Disruption Incident Center
            </h1>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#D97706]/20 bg-[#FEF3C7] px-2.5 py-0.5 text-xs font-semibold text-[#D97706]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#D97706] animate-pulse" />
              Triage Mode
            </span>
          </div>
          <p className="mt-1 text-xs text-[#475569]">
            Track, triage, and orchestrate automated recovery plans for supply failures and component shortages.
          </p>
        </div>

        {/* Quick summary metrics */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-[#E2E8F0] bg-[#FFFFFF] px-3 py-1.5 text-xs shadow-2xs">
            <AlertTriangle className="h-3.5 w-3.5 text-[#D97706]" />
            <span className="text-[#64748B]">Active Cases:</span>
            <span className="font-semibold text-[#0F172A] tabular-nums">{stats.totalCases}</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-[#E2E8F0] bg-[#FFFFFF] px-3 py-1.5 text-xs shadow-2xs">
            <Briefcase className="h-3.5 w-3.5 text-[#2563EB]" />
            <span className="text-[#64748B]">Impacted Jobs:</span>
            <span className="font-semibold text-[#0F172A] tabular-nums">{stats.impactedJobs}</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-[#DC2626]/20 bg-[#FEE2E2] px-3 py-1.5 text-xs shadow-2xs">
            <span className="text-[#DC2626] font-medium">Total Deficit:</span>
            <span className="font-semibold text-[#DC2626] tabular-nums">{stats.totalShortage} units</span>
          </div>
        </div>
      </div>

      {/* Disconnection Warning if offline */}
      {isError && (
        <div className="flex items-center justify-between rounded-xl border border-[#FDE68A] bg-[#FEF3C7] px-4 py-3 text-xs text-[#D97706] shadow-2xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-[#D97706] flex-shrink-0" />
            <span>
              <strong>Backend Disconnected:</strong> Live case stream unavailable. Start the backend API to synchronize active incidents.
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

      {/* Action Toolbar */}
      <div className="card p-3.5 flex flex-wrap items-center justify-between gap-3 bg-[#FFFFFF]">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#94A3B8]" aria-hidden="true" />
          <input
            type="search"
            placeholder="Search by Case ID, SKU, or Failed Supplier…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input-field pl-9 pr-3 py-1.5 text-xs"
            aria-label="Search disruption cases"
          />
        </div>

        <Link
          to="/disruptions/new"
          className="btn-primary"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New Disruption Case
        </Link>
      </div>

      {/* Incidents Table / Empty State */}
      {cases.length === 0 ? (
        <EmptyState
          icon={AlertTriangle}
          title="No active disruption cases"
          description={
            search
              ? 'No disruption incidents match your search query.'
              : 'All manufacturing schedules and supply lines are operating nominally. Initiate a new disruption case to begin recovery orchestration.'
          }
          action={
            <Link to="/disruptions/new" className="btn-primary mt-2">
              <Plus className="h-4 w-4" />
              Initiate First Case
            </Link>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] shadow-sm">
          <table className="w-full text-xs text-left" aria-label="Disruption cases">
            <thead>
              <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[#64748B] font-semibold uppercase tracking-wider text-[10px]">
                <th scope="col" className="px-4 py-3">Incident Case ID</th>
                <th scope="col" className="px-4 py-3">Critical Affected SKU</th>
                <th scope="col" className="px-4 py-3">Failed Supplier</th>
                <th scope="col" className="px-4 py-3 text-right">Impacted Jobs</th>
                <th scope="col" className="px-4 py-3 text-right">Allocated Budget</th>
                <th scope="col" className="px-4 py-3">Delay Deadline</th>
                <th scope="col" className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {cases.map(c => (
                <tr key={c.case_id} className="hover:bg-[#F8FAFC] transition-colors">
                  <td className="px-4 py-3">
                    <Link
                      to={`/disruptions/${c.case_id}`}
                      className="font-mono text-xs font-semibold text-[#2563EB] hover:text-[#1D4ED8] hover:underline"
                    >
                      {c.case_id}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs font-semibold text-[#0F172A] bg-[#F1F5F9] px-2 py-0.5 rounded border border-[#E2E8F0]">
                      {c.affected_sku}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[#475569] font-mono text-xs">{c.failed_supplier_id}</span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    <span className="inline-flex items-center gap-1 rounded bg-[#F1F5F9] px-2 py-0.5 font-medium text-[#0F172A]">
                      <Briefcase className="h-3 w-3 text-[#64748B]" />
                      {c.jobs.length}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-[#475569]">
                    {c.budget ? (
                      <span className="font-semibold text-[#0F172A]">
                        {c.currency} {Number(c.budget).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                    ) : (
                      <span className="text-[#64748B]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-[#475569]">
                    {c.delayed_until ? (
                      <div className="flex items-center gap-1.5 text-[#475569]">
                        <Calendar className="h-3 w-3 text-[#D97706]" />
                        <span>{new Date(c.delayed_until).toLocaleDateString()}</span>
                      </div>
                    ) : (
                      <span className="text-[#64748B]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to={`/disruptions/${c.case_id}`}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[#2563EB] hover:text-[#1D4ED8]"
                    >
                      Inspect Case
                      <ArrowUpRight className="h-3.5 w-3.5" />
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
