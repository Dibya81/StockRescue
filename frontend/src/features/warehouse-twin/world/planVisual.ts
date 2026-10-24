import type {
  Approval,
  Disruption,
  InventoryLot,
  RecoveryAction,
  RecoveryOption,
  RecoveryPlan,
  Shipment,
} from '../data/schemas'

// How an AI recovery plan is drawn. Proposals stay ghosts until the
// inventory.updated event that executes them lands in the data; an
// animation finishing never turns a ghost solid.

export type ActionVisualState = 'proposed' | 'executing' | 'completed' | 'rejected'

export interface ActionView {
  action: RecoveryAction
  state: ActionVisualState
  /** Translucent hatched pallet at the destination */
  ghost: boolean
  /** Dashed arc from source to destination */
  arc: boolean
  /** Success pulse once landed */
  solid: boolean
}

/** The option whose actions are shown: the approved one, else the recommended one. */
export function shownOption(plan: RecoveryPlan, approvals: readonly Approval[]): RecoveryOption | null {
  const approved = [...approvals].reverse().find(a => a.planId === plan.id && a.decision === 'approved')
  const id = approved?.optionId ?? plan.recommendedOptionId
  return plan.options.find(o => o.id === id) ?? null
}

/** True once inventory data shows the action's result at its destination. */
export function actionLanded(action: RecoveryAction, lots: readonly InventoryLot[]): boolean {
  if (!action.toPositionId) return false
  return lots.some(l =>
    l.positionId === action.toPositionId &&
    l.sku === action.sku &&
    l.status !== 'incoming' &&
    l.qty > 0,
  )
}

export function actionViews(plan: RecoveryPlan, option: RecoveryOption | null, lots: readonly InventoryLot[]): ActionView[] {
  if (!option) return []
  return [...option.actions].sort((a, b) => a.seq - b.seq).map(action => {
    if (plan.status === 'rejected') return { action, state: 'rejected', ghost: false, arc: false, solid: false }
    const landed = actionLanded(action, lots)
    if (landed && plan.status === 'approved') return { action, state: 'completed', ghost: false, arc: false, solid: true }
    const state: ActionVisualState = plan.status === 'approved' ? 'executing' : 'proposed'
    return { action, state, ghost: true, arc: true, solid: false }
  })
}

/** Plan-level phase, using the existing approval states. */
export function planPhase(plan: RecoveryPlan, views: readonly ActionView[]): 'proposed' | 'awaiting_approval' | 'executing' | 'completed' | 'rejected' {
  if (plan.status === 'rejected') return 'rejected'
  if (plan.status === 'draft') return 'proposed'
  if (plan.status === 'awaiting_approval') return 'awaiting_approval'
  return views.length > 0 && views.every(v => v.state === 'completed') ? 'completed' : 'executing'
}

// ── Delays & shortages ───────────────────────────────────

export interface DelayInfo {
  shipment: Shipment
  reason: 'supplier_failed' | 'overdue'
  eta: string | null
  /** Hours late (overdue only), from ETA and the current time */
  hoursLate: number | null
}

/**
 * Inbound shipments that will not arrive as scheduled: from a supplier with
 * an open disruption, or past their ETA without reaching the dock.
 */
export function delayedShipments(shipments: readonly Shipment[], disruptions: readonly Disruption[], now: number): DelayInfo[] {
  const failed = new Set(disruptions.filter(d => d.status !== 'resolved').map(d => d.failedSupplier.id))
  const out: DelayInfo[] = []
  for (const s of shipments) {
    if (!s.dockId || (s.status !== 'scheduled' && s.status !== 'arriving')) continue
    if (failed.has(s.supplier.id)) {
      out.push({ shipment: s, reason: 'supplier_failed', eta: s.eta, hoursLate: null })
    } else if (s.eta && Date.parse(s.eta) < now) {
      out.push({ shipment: s, reason: 'overdue', eta: s.eta, hoursLate: Math.round((now - Date.parse(s.eta)) / 36e5) })
    }
  }
  return out
}

export interface ShortageMarker {
  positionId: string
  sku: string
  gapQty: number
  unit: string
}

/** One marker per understocked position of a SKU, carrying the SKU's gap from the disruption. */
export function shortageMarkers(disruptions: readonly Disruption[], lots: readonly InventoryLot[]): ShortageMarker[] {
  const out: ShortageMarker[] = []
  for (const d of disruptions) {
    if (d.status === 'resolved') continue
    for (const line of d.shortages) {
      if (line.gapQty <= 0) continue
      for (const l of lots) {
        if (l.sku !== line.sku || !l.positionId) continue
        if (l.status !== 'shortage' && l.status !== 'disruption_affected' && l.status !== 'low_stock') continue
        out.push({ positionId: l.positionId, sku: line.sku, gapQty: line.gapQty, unit: line.unit })
      }
    }
  }
  return out
}
