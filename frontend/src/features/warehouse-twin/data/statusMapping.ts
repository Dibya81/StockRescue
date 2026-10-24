import type { InventoryLot, InventoryStatus } from './schemas'

/**
 * Presentation for each inventory status. Status values always come from
 * the data provider; this module only decides how they look. Every status
 * has a glyph and a fill pattern so it never relies on colour alone.
 */
export type StatusGlyph = 'check' | 'trend-down' | 'alert' | 'zap' | 'lock' | 'arrow-in' | 'ban' | 'circle'
export type StatusPattern = 'solid' | 'diagonal' | 'cross' | 'dots' | 'horizontal' | 'vertical' | 'grid' | 'none'

export interface StatusStyle {
  status: InventoryStatus
  label: string
  description: string
  /** Fill colour for 2D/3D markers */
  color: string
  /** Light background for chips */
  bg: string
  /** Text colour on `bg`, AA contrast */
  text: string
  glyph: StatusGlyph
  pattern: StatusPattern
  /** Higher wins when several positions roll up into one rack */
  severity: number
}

export const STATUS_STYLES: Record<InventoryStatus, StatusStyle> = {
  disruption_affected: {
    status: 'disruption_affected', label: 'Disruption-affected', description: 'Stock tied to an open supplier disruption',
    color: '#7C3AED', bg: '#F3E8FF', text: '#5B21B6', glyph: 'zap', pattern: 'cross', severity: 8,
  },
  shortage: {
    status: 'shortage', label: 'Shortage', description: 'On hand below committed demand',
    color: '#DC2626', bg: '#FEE2E2', text: '#991B1B', glyph: 'alert', pattern: 'diagonal', severity: 7,
  },
  quarantine: {
    status: 'quarantine', label: 'Quarantine', description: 'Held for quality inspection, not usable',
    color: '#C2410C', bg: '#FFEDD5', text: '#9A3412', glyph: 'ban', pattern: 'grid', severity: 6,
  },
  low_stock: {
    status: 'low_stock', label: 'Low stock', description: 'At or below the reorder point',
    color: '#D97706', bg: '#FEF3C7', text: '#92400E', glyph: 'trend-down', pattern: 'horizontal', severity: 5,
  },
  incoming: {
    status: 'incoming', label: 'Incoming', description: 'Reserved for an inbound shipment',
    color: '#0891B2', bg: '#CFFAFE', text: '#155E75', glyph: 'arrow-in', pattern: 'dots', severity: 4,
  },
  reserved: {
    status: 'reserved', label: 'Reserved / Allocated', description: 'Allocated to a job or recovery plan',
    color: '#1F4FD8', bg: '#DBEAFE', text: '#1E3A8A', glyph: 'lock', pattern: 'vertical', severity: 3,
  },
  in_stock: {
    status: 'in_stock', label: 'In stock', description: 'Available for picking',
    color: '#16A34A', bg: '#DCFCE7', text: '#166534', glyph: 'check', pattern: 'solid', severity: 2,
  },
  empty: {
    status: 'empty', label: 'Empty', description: 'No inventory recorded at this position',
    color: '#CBD5E1', bg: '#F1F5F9', text: '#475569', glyph: 'circle', pattern: 'none', severity: 1,
  },
}

/** Legend order, as required by the spec. */
export const LEGEND_ORDER: InventoryStatus[] = [
  'in_stock', 'low_stock', 'shortage', 'disruption_affected', 'reserved', 'incoming', 'quarantine', 'empty',
]

/** DOM id of the SVG fill pattern for a status (see StatusPatternDefs). */
export const patternId = (status: InventoryStatus) => `twin-pattern-${status}`

export function statusStyle(status: InventoryStatus): StatusStyle {
  return STATUS_STYLES[status]
}

/** The most severe status among a set of lots; 'empty' when there are none. */
export function rollupStatus(statuses: Iterable<InventoryStatus>): InventoryStatus {
  let worst: InventoryStatus = 'empty'
  for (const s of statuses) {
    if (STATUS_STYLES[s].severity > STATUS_STYLES[worst].severity) worst = s
  }
  return worst
}

/** Status of a single position: from its lots, or 'empty' if no lot is recorded there. */
export function positionStatus(lots: readonly InventoryLot[] | undefined): InventoryStatus {
  return lots && lots.length > 0 ? rollupStatus(lots.map(l => l.status)) : 'empty'
}

export function countByStatus(lots: readonly InventoryLot[]): Record<InventoryStatus, number> {
  const counts = Object.fromEntries(LEGEND_ORDER.map(s => [s, 0])) as Record<InventoryStatus, number>
  for (const lot of lots) counts[lot.status] += 1
  return counts
}
