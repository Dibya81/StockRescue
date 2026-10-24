import { clsx } from 'clsx'
import { X } from 'lucide-react'
import { formatPositionId } from '../data/layoutGeometry'
import { positionStatus, STATUS_STYLES } from '../data/statusMapping'
import type { InventoryLot, Rack } from '../data/schemas'
import { StatusIcon } from './StatusGlyph'

interface RackElevationProps {
  rack: Rack
  lotsByPosition: Map<string, InventoryLot[]>
  selectedLevel: number | null
  selectedPositionId: string | null
  highlightSku: string | null
  onSelectLevel: (level: number | null) => void
  onSelectPosition: (positionId: string) => void
  onClose: () => void
}

/** Front elevation of one rack: levels top to bottom, positions left to right. */
export function RackElevation({
  rack,
  lotsByPosition,
  selectedLevel,
  selectedPositionId,
  highlightSku,
  onSelectLevel,
  onSelectPosition,
  onClose,
}: RackElevationProps) {
  const levels = Array.from({ length: rack.levels }, (_, i) => rack.levels - i)
  const positions = Array.from({ length: rack.positionsPerLevel }, (_, i) => i + 1)

  return (
    <div className="animate-fade-in">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#64748B]">Rack elevation</p>
          <p className="font-mono text-base font-semibold text-[#0F172A]">{rack.id}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-[#64748B] transition-colors hover:bg-[#F1F5F9] hover:text-[#0F172A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F4FD8]"
          aria-label="Close rack elevation"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="rounded-lg border border-[#CBD5E1] bg-[#F8FAFC] p-2" role="grid" aria-label={`Rack ${rack.id} positions`}>
        {levels.map(level => {
          const levelSelected = selectedLevel === level
          return (
            <div
              key={level}
              role="row"
              className={clsx(
                'flex items-stretch gap-1.5 border-b-[3px] border-[#F97316] py-1.5 transition-colors last:border-b-[3px]',
                levelSelected && 'bg-[#EFF6FF]',
              )}
            >
              <button
                type="button"
                role="rowheader"
                onClick={() => onSelectLevel(levelSelected ? null : level)}
                aria-pressed={levelSelected}
                className={clsx(
                  'w-10 flex-shrink-0 rounded-md text-[11px] font-bold transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F4FD8]',
                  levelSelected ? 'bg-[#1F4FD8] text-white' : 'text-[#475569] hover:bg-white',
                )}
              >
                L{String(level).padStart(2, '0')}
              </button>
              {positions.map(p => {
                const pid = formatPositionId(rack.id, level, p)
                const lots = lotsByPosition.get(pid)
                const status = positionStatus(lots)
                const s = STATUS_STYLES[status]
                const selected = pid === selectedPositionId
                const primary = lots?.[0]
                const totalQty = lots?.reduce((n, l) => n + l.qty, 0) ?? 0
                const lit = !!highlightSku && !!lots?.some(l => l.sku === highlightSku)
                return (
                  <button
                    key={pid}
                    type="button"
                    role="gridcell"
                    onClick={() => onSelectPosition(pid)}
                    aria-selected={selected}
                    aria-label={`${pid}: ${primary ? `${primary.sku}, ${totalQty} ${primary.unit}` : 'empty'}, ${s.label}`}
                    className={clsx(
                      'group flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-md border px-2 py-1.5 text-left transition-all duration-200',
                      'hover:-translate-y-px hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F4FD8]',
                      selected ? 'border-[#1F4FD8] ring-2 ring-[#1F4FD8]/30' : lit ? 'border-[#1F4FD8]' : 'border-transparent',
                    )}
                    style={{ background: s.bg }}
                  >
                    <span className="flex w-full items-center gap-1">
                      <StatusIcon status={status} className="h-3 w-3" />
                      <span className="font-mono text-[10px] text-[#64748B]">P{String(p).padStart(2, '0')}</span>
                    </span>
                    <span className="w-full truncate-text font-mono text-[11px] font-semibold" style={{ color: s.text }}>
                      {primary ? primary.sku : 'Empty'}
                    </span>
                    <span className="text-[10px] tabular-nums" style={{ color: s.text }}>
                      {primary ? `${totalQty} ${primary.unit}${lots && lots.length > 1 ? ` · ${lots.length} lots` : ''}` : '—'}
                    </span>
                  </button>
                )
              })}
            </div>
          )
        })}
        <div className="mt-1 h-1.5 rounded-sm bg-[#CBD5E1]" aria-hidden="true" />
      </div>
    </div>
  )
}
