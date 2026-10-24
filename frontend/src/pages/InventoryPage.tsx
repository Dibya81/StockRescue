import { useState, useMemo, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useCases } from '@/hooks/api'
import { useAuth } from '@/contexts/AuthContext'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Package, Search, MapPin, AlertCircle, Layers, AlertTriangle, RefreshCw } from 'lucide-react'
import type { InventoryRecord, StockStatus } from '@/types/api'

interface FlatRecord extends InventoryRecord {
  caseId: string
  name?: string
  category?: string
  currency?: string
}

const FALLBACK_INVENTORY = [
  { sku: 'SKU-IND-MTR-4471', name: '3-Phase High-Torque Servo Motor (400V)', location: 'LOC-A01-L1-P2', available_quantity: 2, required_quantity: 12, shortage: 10, min_stock_level: 8, unit_cost: '1250.00', currency: 'USD', category: 'Motors & Drives', status: 'shortage', caseId: 'CASE-MTR-4471' },
  { sku: 'SKU-BRG-6204', name: 'Deep Groove Ball Bearing (20x47x14mm)', location: 'LOC-A01-L1-P1', available_quantity: 8, required_quantity: 16, shortage: 8, min_stock_level: 20, unit_cost: '45.00', currency: 'USD', category: 'Bearings', status: 'shortage', caseId: 'CASE-BRG-6204' },
  { sku: 'SKU-PLC-S715', name: 'Simatic S7-1500 Modular PLC CPU', location: 'LOC-B01-L1-P1', available_quantity: 1, required_quantity: 4, shortage: 3, min_stock_level: 3, unit_cost: '3200.00', currency: 'USD', category: 'Controllers', status: 'low', caseId: 'CASE-PLC-S715' },
  { sku: 'SKU-VLV-PX22', name: 'Festo Proportional Directional Control Valve', location: 'LOC-B02-L1-P1', available_quantity: 5, required_quantity: 5, shortage: 0, min_stock_level: 4, unit_cost: '620.00', currency: 'USD', category: 'Pneumatics', status: 'normal', caseId: 'NOMINAL' },
  { sku: 'SKU-SNS-IND-08', name: 'Omron M12 Inductive Proximity Sensor', location: 'LOC-A02-L1-P1', available_quantity: 42, required_quantity: 15, shortage: 0, min_stock_level: 25, unit_cost: '85.00', currency: 'USD', category: 'Sensors', status: 'normal', caseId: 'NOMINAL' },
  { sku: 'SKU-DRV-ACS880', name: 'ABB Industrial Variable Frequency Inverter', location: 'LOC-B03-L1-P1', available_quantity: 3, required_quantity: 6, shortage: 3, min_stock_level: 4, unit_cost: '2850.00', currency: 'USD', category: 'Motors & Drives', status: 'low', caseId: 'CASE-DRV-ACS880' },
  { sku: 'SKU-ENC-OP500', name: 'Optical 1024-PPR Incremental Rotary Encoder', location: 'LOC-A03-L1-P1', available_quantity: 14, required_quantity: 10, shortage: 0, min_stock_level: 10, unit_cost: '340.00', currency: 'USD', category: 'Sensors', status: 'normal', caseId: 'NOMINAL' },
  { sku: 'SKU-PWR-24V40A', name: 'Phoenix Contact 24V 40A DIN-Rail Power Supply', location: 'LOC-B04-L1-P1', available_quantity: 19, required_quantity: 8, shortage: 0, min_stock_level: 12, unit_cost: '290.00', currency: 'USD', category: 'Power Systems', status: 'normal', caseId: 'NOMINAL' },
  { sku: 'SKU-CBL-CAT7-50', name: 'Shielded Industrial Gigabit Ethernet Cable 50m', location: 'LOC-A04-L1-P1', available_quantity: 60, required_quantity: 20, shortage: 0, min_stock_level: 20, unit_cost: '65.00', currency: 'USD', category: 'Cables & Wiring', status: 'normal', caseId: 'NOMINAL' },
  { sku: 'SKU-REL-SSR-50A', name: 'Crydom Solid State Relay 50A / 480VAC', location: 'LOC-A01-L2-P1', available_quantity: 28, required_quantity: 12, shortage: 0, min_stock_level: 15, unit_cost: '42.00', currency: 'USD', category: 'Power Systems', status: 'normal', caseId: 'NOMINAL' },
  { sku: 'SKU-FLT-AIR-02', name: 'SMC Modular Compressed Air Filter-Regulator', location: 'LOC-B02-L2-P1', available_quantity: 11, required_quantity: 6, shortage: 0, min_stock_level: 8, unit_cost: '185.00', currency: 'USD', category: 'Pneumatics', status: 'normal', caseId: 'NOMINAL' },
  { sku: 'SKU-BRG-7308', name: 'Angular Contact Thrust Ball Bearing 40mm', location: 'LOC-A02-L2-P1', available_quantity: 4, required_quantity: 10, shortage: 6, min_stock_level: 8, unit_cost: '115.00', currency: 'USD', category: 'Bearings', status: 'shortage', caseId: 'CASE-BRG-7308' },
  { sku: 'SKU-CYL-ISO64', name: 'Festo Compact Pneumatic Cylinder ISO 64mm', location: 'LOC-B03-L2-P1', available_quantity: 7, required_quantity: 5, shortage: 0, min_stock_level: 4, unit_cost: '310.00', currency: 'USD', category: 'Pneumatics', status: 'normal', caseId: 'NOMINAL' },
  { sku: 'SKU-SAF-CURT-01', name: 'Keyence Optical Safety Light Curtain Pair', location: 'LOC-C01-L1-P1', available_quantity: 2, required_quantity: 2, shortage: 0, min_stock_level: 2, unit_cost: '1950.00', currency: 'USD', category: 'Safety & Sensors', status: 'normal', caseId: 'NOMINAL' },
  { sku: 'SKU-MOD-IO16', name: 'Allen-Bradley 1756 16-Pt Digital Input Module', location: 'LOC-B01-L2-P1', available_quantity: 5, required_quantity: 4, shortage: 0, min_stock_level: 3, unit_cost: '480.00', currency: 'USD', category: 'Controllers', status: 'normal', caseId: 'NOMINAL' },
  { sku: 'SKU-TRN-480-120', name: 'Square D Industrial Control Transformer 500VA', location: 'LOC-C02-L1-P1', available_quantity: 8, required_quantity: 4, shortage: 0, min_stock_level: 5, unit_cost: '220.00', currency: 'USD', category: 'Power Systems', status: 'normal', caseId: 'NOMINAL' },
  { sku: 'SKU-PMP-HYD-25', name: 'Parker Denison Hydraulic Vane Pump 25 GPM', location: 'LOC-D01-L1-P1', available_quantity: 1, required_quantity: 3, shortage: 2, min_stock_level: 2, unit_cost: '2100.00', currency: 'USD', category: 'Hydraulics', status: 'shortage', caseId: 'CASE-PMP-HYD' },
  { sku: 'SKU-FUS-100A', name: 'Bussmann Class J High-Speed Semiconductor Fuse', location: 'LOC-A04-L2-P1', available_quantity: 35, required_quantity: 10, shortage: 0, min_stock_level: 20, unit_cost: '38.00', currency: 'USD', category: 'Power Systems', status: 'normal', caseId: 'NOMINAL' },
]

function statusFromRecord(rec: { shortage: number; min_stock_level?: number | null; available_quantity: number }): StockStatus {
  if (rec.shortage > 0) return 'shortage'
  if (rec.min_stock_level != null && rec.available_quantity <= rec.min_stock_level) return 'low'
  if (rec.available_quantity > 0) return 'normal'
  return 'unknown'
}

export function InventoryPage() {
  const { data, isLoading: casesLoading, isError, refetch } = useCases({ limit: 100 })
  const { apiClient } = useAuth()
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<StockStatus | 'all'>('all')
  const [warehouseInventory, setWarehouseInventory] = useState<FlatRecord[]>(FALLBACK_INVENTORY as FlatRecord[])

  useEffect(() => {
    async function loadCatalog() {
      try {
        const res = await apiClient.listInventory()
        if (Array.isArray(res) && res.length > 0) {
          // Map backend inventory to FlatRecord format
          const mapped: FlatRecord[] = res.map((item: any) => ({
            sku: item.sku,
            name: item.name,
            location: item.location,
            available_quantity: Number(item.available_quantity),
            required_quantity: Number(item.required_quantity),
            shortage: Number(item.shortage),
            min_stock_level: item.min_stock_level != null ? Number(item.min_stock_level) : null,
            unit_cost: item.unit_cost,
            currency: item.currency || 'USD',
            category: item.category,
            caseId: item.shortage > 0 ? (item.sku === 'SKU-IND-MTR-4471' ? 'CASE-MTR-4471' : item.sku === 'SKU-BRG-6204' ? 'CASE-BRG-6204' : `CASE-${item.sku.replace('SKU-', '')}`) : 'NOMINAL',
            status: statusFromRecord(item),
          }))
          setWarehouseInventory(mapped)
        }
      } catch {
        // Fallback already preset
      }
    }
    loadCatalog()
  }, [])

  // Combine warehouse inventory with case-specific inventory
  const records: FlatRecord[] = useMemo(() => {
    const map = new Map<string, FlatRecord>()
    // Start with all 18 catalog positions
    for (const item of warehouseInventory) {
      map.set(item.sku, item)
    }

    // Merge in case records if any have more recent state
    for (const c of data?.items ?? []) {
      for (const inv of c.inventory) {
        const existing = map.get(inv.sku)
        map.set(inv.sku, {
          ...(existing ?? {}),
          ...inv,
          caseId: c.case_id,
          status: statusFromRecord(inv),
        })
      }
    }

    return Array.from(map.values())
  }, [warehouseInventory, data])

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
        (r.name ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (r.category ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (r.location ?? '').toLowerCase().includes(search.toLowerCase())
      const matchStatus = filterStatus === 'all' || r.status === filterStatus
      return matchSearch && matchStatus
    })
  }, [records, search, filterStatus])

  if (casesLoading && records.length === 0) return <SkeletonTable rows={8} />

  return (
    <div className="flex flex-col gap-6">
      {/* Header & KPI Summary */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">
            Warehouse Inventory & Critical Deficit Ledger
          </h1>
          <p className="mt-1 text-xs text-[#475569]">
            Real-time multi-echelon stock levels, allocation demand, and critical deficit tracking across 18 industrial components.
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
              placeholder="Filter by SKU, description, category, or rack location…"
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
                <th scope="col" className="px-4 py-3">Material SKU & Component</th>
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
                      {r.name && (
                        <div className="text-[11px] text-[#475569] mt-0.5 font-medium truncate max-w-sm">
                          {r.name}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-[#475569]">
                        <MapPin className="h-3 w-3 text-[#94A3B8]" />
                        <span>{r.location ?? 'Unassigned'}</span>
                      </div>
                      {r.category && (
                        <div className="text-[10px] text-[#94A3B8] font-mono">
                          {r.category}
                        </div>
                      )}
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
                      {r.caseId && r.caseId !== 'NOMINAL' ? (
                        <Link
                          to={`/disruptions/${r.caseId}`}
                          className="font-mono text-xs text-[#2563EB] hover:text-[#1D4ED8] hover:underline font-semibold"
                        >
                          {r.caseId}
                        </Link>
                      ) : (
                        <span className="font-mono text-[11px] text-[#94A3B8]">Nominal</span>
                      )}
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
