import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useCases } from '@/hooks/api'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Package, Search, MapPin, AlertCircle, Layers, AlertTriangle, RefreshCw } from 'lucide-react'
import type { InventoryRecord, StockStatus } from '@/types/api'

interface FlatRecord extends InventoryRecord {
  caseId: string
  affectedSku: string
}

function statusFromRecord(rec: InventoryRecord): StockStatus {
  if (rec.shortage > 0) return 'shortage'
  if (rec.min_stock_level != null && rec.available_quantity <= rec.min_stock_level) return 'low'
  if (rec.available_quantity > 0) return 'normal'
  return 'unknown'
}

export function InventoryPage() {
  const { data, isLoading, isError, refetch } = useCases({ limit: 100 })
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<StockStatus | 'all'>('all')

  // Aggregate all inventory records across cases
  const records: FlatRecord[] = useMemo(
    () =>
      (data?.items ?? []).flatMap(c =>
        c.inventory.map(inv => ({
          ...inv,
          caseId: c.case_id,
          affectedSku: c.affected_sku,
          status: statusFromRecord(inv),
        })),
      ),
    [data],
  )

  const stats = useMemo(() => {
    let shortageCount = 0
    let lowCount = 0
    let normalCount = 0
    const uniqueLocations = new Set<string>()

    for (const r of records) {
      if (r.location) uniqueLocations.add(r.location)
      if (r.status === 'shortage') shortageCount++
      else if (r.status === 'low') lowCount++
      else if (r.status === 'normal') normalCount++
    }

    return {
      total: records.length,
      locations: uniqueLocations.size,
      shortage: shortageCount,
      low: lowCount,
      normal: normalCount,
    }
  }, [records])

  const filtered = useMemo(() => {
    return records.filter(r => {
      const matchSearch =
        !search ||
        r.sku.toLowerCase().includes(search.toLowerCase()) ||
        (r.location ?? '').toLowerCase().includes(search.toLowerCase())
      const matchStatus = filterStatus === 'all' || r.status === filterStatus
      return matchSearch && matchStatus
    })
  }, [records, search, filterStatus])

  if (isLoading) return <SkeletonTable rows={8} />

  return (
    <div className="flex flex-col gap-6">
      {/* Header & KPI Summary */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">
            Inventory Management
          </h1>
          <p className="mt-1 text-xs text-[#475569]">
            Real-time multi-echelon stock levels, allocation demand, and critical deficit tracking.
          </p>
        </div>

        {/* Quick summary stats */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-[#E2E8F0] bg-[#FFFFFF] px-3 py-1.5 text-xs shadow-2xs">
            <Layers className="h-3.5 w-3.5 text-[#64748B]" />
            <span className="text-[#64748B]">Tracked SKUs:</span>
            <span className="font-semibold text-[#0F172A] tabular-nums">{stats.total}</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-[#2563EB]/25 bg-[#EFF6FF] px-3 py-1.5 text-xs shadow-2xs">
            <MapPin className="h-3.5 w-3.5 text-[#2563EB]" />
            <span className="text-[#2563EB] font-medium">Active Bins:</span>
            <span className="font-semibold text-[#2563EB] tabular-nums">{stats.locations}</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-[#DC2626]/20 bg-[#FEE2E2] px-3 py-1.5 text-xs shadow-2xs">
            <AlertCircle className="h-3.5 w-3.5 text-[#DC2626]" />
            <span className="text-[#DC2626] font-medium">Deficits:</span>
            <span className="font-semibold text-[#DC2626] tabular-nums">{stats.shortage}</span>
          </div>
        </div>
      </div>

      {/* Disconnection Warning if offline */}
      {isError && (
        <div className="flex items-center justify-between rounded-xl border border-[#FDE68A] bg-[#FEF3C7] px-4 py-3 text-xs text-[#D97706] shadow-2xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-[#D97706] flex-shrink-0" />
            <span>
              <strong>Backend Disconnected:</strong> Live catalog queries unavailable. Showing standby inventory view.
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

      {/* Filter and Search Bar */}
      <div className="card p-3.5 flex flex-wrap items-center justify-between gap-3 bg-[#FFFFFF]">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[280px]">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#94A3B8]" aria-hidden="true" />
            <input
              type="search"
              placeholder="Filter by SKU or rack location…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="input-field pl-9 pr-3 py-1.5 text-xs"
              aria-label="Search inventory by SKU or location"
            />
          </div>

          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value as StockStatus | 'all')}
            className="rounded-lg border border-[#E2E8F0] bg-[#FFFFFF] px-3 py-1.5 text-xs text-[#0F172A] focus-visible:border-[#2563EB] focus-visible:outline-none focus:ring-2 focus:ring-[#2563EB]/20 shadow-2xs font-medium"
            aria-label="Filter by stock status"
          >
            <option value="all">All statuses ({records.length})</option>
            <option value="shortage">Shortage ({stats.shortage})</option>
            <option value="low">Low Stock ({stats.low})</option>
            <option value="normal">Normal ({stats.normal})</option>
            <option value="unknown">Unknown</option>
          </select>
        </div>

        <span className="text-xs text-[#64748B]" aria-live="polite">
          Showing <strong className="text-[#0F172A] font-semibold">{filtered.length}</strong> of {records.length} records
        </span>
      </div>

      {/* Main Table or Empty State */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No inventory records found"
          description={
            search || filterStatus !== 'all'
              ? 'No inventory positions match your filter criteria.'
              : 'Warehouse stock records will automatically populate when disruption cases are processed.'
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] shadow-sm">
          <table className="w-full text-xs text-left" aria-label="Inventory records">
            <thead>
              <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[#64748B] font-semibold uppercase tracking-wider text-[10px]">
                <th scope="col" className="px-4 py-3">Material SKU</th>
                <th scope="col" className="px-4 py-3">Warehouse Location</th>
                <th scope="col" className="px-4 py-3 text-right">Available Stock</th>
                <th scope="col" className="px-4 py-3 text-right">Required Target</th>
                <th scope="col" className="px-4 py-3 text-right">Variance / Deficit</th>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="px-4 py-3">Linked Case</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {filtered.map((r, i) => {
                const isShortage = r.shortage > 0
                return (
                  <tr
                    key={`${r.caseId}-${r.sku}-${i}`}
                    className={`transition-colors ${
                      isShortage ? 'bg-[#FEF2F2]/60 hover:bg-[#FEE2E2]' : 'hover:bg-[#F8FAFC]'
                    }`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-[#0F172A] bg-[#F1F5F9] px-2 py-0.5 rounded border border-[#E2E8F0]">
                          {r.sku}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-[#475569]">
                        <MapPin className="h-3 w-3 text-[#94A3B8]" />
                        <span>{r.location ?? 'Unassigned'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-[#0F172A]">
                      {r.available_quantity}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[#475569]">
                      {r.required_quantity}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-bold">
                      {isShortage ? (
                        <span className="inline-flex items-center gap-1 font-bold text-[#DC2626]">
                          -{r.shortage}
                        </span>
                      ) : (
                        <span className="text-[#64748B]">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge variant={r.status} />
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        to={`/disruptions/${r.caseId}`}
                        className="font-mono text-xs text-[#2563EB] hover:text-[#1D4ED8] hover:underline font-semibold"
                      >
                        {r.caseId}
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
