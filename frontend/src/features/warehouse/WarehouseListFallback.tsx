import type { InventoryRecord } from '@/types/api'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Info } from 'lucide-react'

interface WarehouseListFallbackProps {
  inventory: InventoryRecord[]
  searchSku: string
  filterStatus: string
}

function getStatus(inv: InventoryRecord): 'normal' | 'low' | 'shortage' | 'unknown' {
  if (inv.shortage > 0) return 'shortage'
  if (inv.min_stock_level != null && inv.available_quantity <= inv.min_stock_level) return 'low'
  if (inv.available_quantity > 0) return 'normal'
  return 'unknown'
}

export function WarehouseListFallback({
  inventory,
  searchSku,
  filterStatus,
}: WarehouseListFallbackProps) {
  const filtered = inventory.filter(inv => {
    const status = getStatus(inv)
    const matchSearch =
      !searchSku || inv.sku.toLowerCase().includes(searchSku.toLowerCase())
    const matchFilter = filterStatus === 'all' || status === filterStatus
    return matchSearch && matchFilter
  })

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] px-4 py-2.5 text-xs text-[#475569] shadow-2xs">
        <Info className="h-4 w-4 text-[#2563EB] flex-shrink-0" />
        <span>2D Accessible Table View — listing all recorded warehouse bins and stock statuses.</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] shadow-sm">
        <table className="w-full text-left text-sm" aria-label="Inventory list — warehouse fallback">
          <thead>
            <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-xs font-semibold text-[#64748B]">
              <th className="px-4 py-3.5">SKU ID</th>
              <th className="px-4 py-3.5">Storage Location</th>
              <th className="px-4 py-3.5 text-right">Available Qty</th>
              <th className="px-4 py-3.5 text-right">Required Qty</th>
              <th className="px-4 py-3.5 text-right">Shortage</th>
              <th className="px-4 py-3.5 text-center">Stock State</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E2E8F0]">
            {filtered.map((inv, i) => (
              <tr
                key={i}
                className="transition-colors hover:bg-[#F8FAFC]"
              >
                <td className="px-4 py-3 font-mono text-xs font-semibold text-[#2563EB]">
                  {inv.sku}
                </td>
                <td className="px-4 py-3 text-xs text-[#475569] font-mono">
                  {inv.location ?? '—'}
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs text-[#0F172A] tabular-nums font-medium">
                  {inv.available_quantity}
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs text-[#475569] tabular-nums">
                  {inv.required_quantity}
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                  {inv.shortage > 0 ? (
                    <span className="font-bold text-[#DC2626]">-{inv.shortage}</span>
                  ) : (
                    <span className="text-[#16A34A] font-medium">0</span>
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  <StatusBadge variant={getStatus(inv)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="py-12 text-center text-xs text-[#64748B]">
            No inventory records match current filter criteria.
          </div>
        )}
      </div>
    </div>
  )
}
