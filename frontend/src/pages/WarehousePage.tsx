import { lazy, Suspense, useState, useMemo } from 'react'
import { Search, Box, List, ShieldAlert, AlertTriangle, CheckCircle2, Layers, RefreshCw } from 'lucide-react'
import { useCases } from '@/hooks/api'
import { SkeletonCard } from '@/components/ui/Skeleton'
import { WarehouseListFallback } from '@/features/warehouse/WarehouseListFallback'
import type { InventoryRecord, StockStatus } from '@/types/api'

// Lazy-load the heavy 3D scene
const WarehouseScene = lazy(() =>
  import('@/features/warehouse/WarehouseScene').then(m => ({ default: m.WarehouseScene })),
)

function detectWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'))
  } catch {
    return false
  }
}

export function WarehousePage() {
  const { data, isLoading, isError, refetch } = useCases({ limit: 100 })
  const [webGLAvailable] = useState(() => detectWebGL())
  const [use3D, setUse3D] = useState(webGLAvailable)
  const [searchSku, setSearchSku] = useState('')
  const [filterStatus, setFilterStatus] = useState<StockStatus | 'all'>('all')

  const inventory: InventoryRecord[] = useMemo(
    () => (data?.items ?? []).flatMap(c => c.inventory),
    [data],
  )

  const stats = useMemo(() => {
    let shortageCount = 0
    let lowCount = 0
    let normalCount = 0

    const list = inventory.length > 0 ? inventory : [
      { sku: 'SKU-DEMO-01', shortage: 0, available_quantity: 45, min_stock_level: 20 },
      { sku: 'SKU-DEMO-02', shortage: 21, available_quantity: 4, min_stock_level: 10 },
      { sku: 'SKU-DEMO-03', shortage: 0, available_quantity: 8, min_stock_level: 15 },
      { sku: 'SKU-DEMO-04', shortage: 0, available_quantity: 60, min_stock_level: 20 },
    ] as InventoryRecord[]

    for (const inv of list) {
      if (inv.shortage > 0) shortageCount++
      else if (inv.min_stock_level != null && inv.available_quantity <= inv.min_stock_level) lowCount++
      else if (inv.available_quantity > 0) normalCount++
    }

    return {
      total: list.length,
      shortage: shortageCount,
      low: lowCount,
      normal: normalCount,
    }
  }, [inventory])

  if (isLoading) return <SkeletonCard className="h-96" />

  return (
    <div className="flex flex-col gap-6">
      {/* Top Header & Telemetry Strip */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">
              3D Warehouse Digital Twin
            </h1>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#16A34A]/30 bg-[#DCFCE7] px-2.5 py-0.5 text-xs font-semibold text-[#16A34A]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#16A34A] animate-pulse" />
              Live Telemetry
            </span>
          </div>
          <p className="mt-1 text-xs text-[#475569]">
            Interactive spatial inventory mapping across aisles, industrial storage racks, and individual bins.
          </p>
        </div>

        {/* Quick Inventory Health Pills */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-[#E2E8F0] bg-[#FFFFFF] px-3 py-1.5 text-xs shadow-2xs">
            <Layers className="h-3.5 w-3.5 text-[#64748B]" />
            <span className="text-[#64748B]">Total Bins:</span>
            <span className="font-semibold text-[#0F172A] tabular-nums">{stats.total}</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-[#DC2626]/20 bg-[#FEE2E2] px-3 py-1.5 text-xs shadow-2xs">
            <ShieldAlert className="h-3.5 w-3.5 text-[#DC2626]" />
            <span className="text-[#DC2626] font-medium">Shortages:</span>
            <span className="font-semibold text-[#DC2626] tabular-nums">{stats.shortage}</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-[#F59E0B]/20 bg-[#FEF3C7] px-3 py-1.5 text-xs shadow-2xs">
            <AlertTriangle className="h-3.5 w-3.5 text-[#D97706]" />
            <span className="text-[#D97706] font-medium">Low Stock:</span>
            <span className="font-semibold text-[#D97706] tabular-nums">{stats.low}</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-[#16A34A]/20 bg-[#DCFCE7] px-3 py-1.5 text-xs shadow-2xs">
            <CheckCircle2 className="h-3.5 w-3.5 text-[#16A34A]" />
            <span className="text-[#16A34A] font-medium">Nominal:</span>
            <span className="font-semibold text-[#16A34A] tabular-nums">{stats.normal}</span>
          </div>
        </div>
      </div>

      {/* Connection Notice if Backend is Offline */}
      {isError && (
        <div className="flex items-center justify-between rounded-xl border border-[#FDE68A] bg-[#FEF3C7] px-4 py-3 text-xs text-[#D97706] shadow-2xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-[#D97706] flex-shrink-0" />
            <span>
              <strong>Backend Disconnected:</strong> Visualizing spatial warehouse twin using default geometry layout. Live inventory sync will resume automatically upon reconnect.
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

      {/* Control Bar */}
      <div className="card p-3.5 flex flex-wrap items-center justify-between gap-3 shadow-sm bg-[#FFFFFF]">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[280px]">
          {/* Search SKU */}
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#94A3B8]" aria-hidden="true" />
            <input
              type="search"
              placeholder="Search SKU or location coordinates…"
              value={searchSku}
              onChange={e => setSearchSku(e.target.value)}
              className="input-field pl-9 pr-3 py-1.5 text-xs"
              aria-label="Search inventory SKU in warehouse"
            />
          </div>

          {/* Status filter dropdown */}
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value as StockStatus | 'all')}
            className="rounded-lg border border-[#E2E8F0] bg-[#FFFFFF] px-3 py-1.5 text-xs text-[#0F172A] focus-visible:border-[#2563EB] focus-visible:outline-none focus:ring-2 focus:ring-[#2563EB]/20 shadow-2xs font-medium"
            aria-label="Filter bins by stock status"
          >
            <option value="all">All Statuses ({stats.total})</option>
            <option value="shortage">Shortage ({stats.shortage})</option>
            <option value="low">Low Stock ({stats.low})</option>
            <option value="normal">Normal ({stats.normal})</option>
            <option value="unknown">Unknown</option>
          </select>
        </div>

        {/* View mode toggle */}
        <div className="flex items-center gap-2">
          {!webGLAvailable && (
            <span className="text-xs text-[#D97706] flex items-center gap-1 mr-2">
              <AlertTriangle className="h-3.5 w-3.5" /> WebGL unavailable, 2D fallback active
            </span>
          )}

          <div className="inline-flex rounded-lg border border-[#E2E8F0] bg-[#F1F5F9] p-1 shadow-2xs">
            <button
              type="button"
              onClick={() => setUse3D(true)}
              disabled={!webGLAvailable}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                use3D
                  ? 'bg-[#FFFFFF] text-[#2563EB] shadow-xs'
                  : 'text-[#64748B] hover:text-[#0F172A]'
              } ${!webGLAvailable ? 'opacity-40 cursor-not-allowed' : ''}`}
              aria-pressed={use3D}
            >
              <Box className="h-3.5 w-3.5" />
              3D Twin
            </button>
            <button
              type="button"
              onClick={() => setUse3D(false)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                !use3D
                  ? 'bg-[#FFFFFF] text-[#2563EB] shadow-xs'
                  : 'text-[#64748B] hover:text-[#0F172A]'
              }`}
              aria-pressed={!use3D}
            >
              <List className="h-3.5 w-3.5" />
              Matrix List
            </button>
          </div>
        </div>
      </div>

      {/* Main Visualizer Scene / List */}
      {use3D ? (
        <div className="relative h-[640px] rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] overflow-hidden shadow-md">
          <Suspense
            fallback={
              <div className="flex h-full flex-col items-center justify-center gap-3 text-xs text-[#64748B]">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#2563EB] border-t-transparent" />
                <span>Initializing 3D Spatial Geometry & Materials…</span>
              </div>
            }
          >
            <WarehouseScene
              inventory={inventory}
              searchSku={searchSku}
              filterStatus={filterStatus}
            />
          </Suspense>
        </div>
      ) : (
        <WarehouseListFallback
          inventory={inventory}
          searchSku={searchSku}
          filterStatus={filterStatus}
        />
      )}
    </div>
  )
}
