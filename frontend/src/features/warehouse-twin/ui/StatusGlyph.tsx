import { clsx } from 'clsx'
import {
  AlertOctagon,
  ArrowDownToLine,
  Ban,
  CheckCircle2,
  Circle,
  Lock,
  TrendingDown,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { LEGEND_ORDER, patternId, STATUS_STYLES, type StatusGlyph as GlyphName } from '../data/statusMapping'
import type { InventoryStatus } from '../data/schemas'

const GLYPHS: Record<GlyphName, LucideIcon> = {
  check: CheckCircle2,
  'trend-down': TrendingDown,
  alert: AlertOctagon,
  zap: Zap,
  lock: Lock,
  'arrow-in': ArrowDownToLine,
  ban: Ban,
  circle: Circle,
}

export function StatusIcon({ status, className }: { status: InventoryStatus; className?: string }) {
  const s = STATUS_STYLES[status]
  const Icon = GLYPHS[s.glyph]
  return <Icon className={clsx('h-3.5 w-3.5 flex-shrink-0', className)} style={{ color: s.color }} aria-hidden="true" />
}

export function StatusChip({ status, className }: { status: InventoryStatus; className?: string }) {
  const s = STATUS_STYLES[status]
  return (
    <span
      className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', className)}
      style={{ background: s.bg, color: s.text }}
    >
      <StatusIcon status={status} className="h-3 w-3" />
      {s.label}
    </span>
  )
}

/** SVG <pattern> overlays so status reads without colour. Render once per SVG. */
export function StatusPatternDefs() {
  return (
    <defs>
      {LEGEND_ORDER.map(status => {
        const { pattern } = STATUS_STYLES[status]
        const stroke = 'rgba(255,255,255,0.75)'
        return (
          <pattern key={status} id={patternId(status)} width="6" height="6" patternUnits="userSpaceOnUse">
            {pattern === 'diagonal' && <path d="M-1 7 L7 -1" stroke={stroke} strokeWidth="1.4" />}
            {pattern === 'cross' && <path d="M0 0 L6 6 M6 0 L0 6" stroke={stroke} strokeWidth="1" />}
            {pattern === 'dots' && <circle cx="3" cy="3" r="1.2" fill={stroke} />}
            {pattern === 'horizontal' && <path d="M0 3 H6" stroke={stroke} strokeWidth="1.3" />}
            {pattern === 'vertical' && <path d="M3 0 V6" stroke={stroke} strokeWidth="1.3" />}
            {pattern === 'grid' && <path d="M0 3 H6 M3 0 V6" stroke={stroke} strokeWidth="0.9" />}
            {pattern === 'none' && <path d="M0 0 L6 6" stroke="rgba(100,116,139,0.35)" strokeWidth="0.8" strokeDasharray="1.5 1.5" />}
          </pattern>
        )
      })}
    </defs>
  )
}

/** A small patterned swatch used in the legend and lists. */
export function StatusSwatch({ status, size = 14 }: { status: InventoryStatus; size?: number }) {
  const s = STATUS_STYLES[status]
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true" className="flex-shrink-0">
      <StatusPatternDefs />
      <rect x="0.5" y="0.5" width="13" height="13" rx="3" fill={s.color} stroke="rgba(15,23,42,0.15)" />
      <rect x="0.5" y="0.5" width="13" height="13" rx="3" fill={`url(#${patternId(status)})`} />
    </svg>
  )
}
