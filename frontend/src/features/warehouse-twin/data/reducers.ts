import type {
  AgentRun,
  Approval,
  Disruption,
  Equipment,
  InventoryLot,
  RecoveryBundle,
  RecoveryPlan,
  Shipment,
  TwinEvent,
  WarehouseLayout,
} from './schemas'

// Pure reducers that fold stream events into cached collections. The
// simulation provider and the LIVE query cache both use these, so both
// modes evolve state identically.

function upsert<T>(list: readonly T[], item: T, key: (t: T) => string): T[] {
  const id = key(item)
  const idx = list.findIndex(x => key(x) === id)
  if (idx === -1) return [...list, item]
  const next = list.slice()
  next[idx] = item
  return next
}

export function applyToInventory(lots: readonly InventoryLot[], event: TwinEvent): InventoryLot[] | null {
  if (event.type !== 'inventory.updated') return null
  return upsert(lots, event.lot, l => l.lotId)
}

export function applyToDisruptions(list: readonly Disruption[], event: TwinEvent): Disruption[] | null {
  if (event.type !== 'disruption.created') return null
  return upsert(list, event.disruption, d => d.id)
}

export function applyToShipments(list: readonly Shipment[], event: TwinEvent): Shipment[] | null {
  if (event.type !== 'shipment.status') return null
  return upsert(list, event.shipment, s => s.id)
}

export function applyToEquipment(list: readonly Equipment[], event: TwinEvent): Equipment[] | null {
  if (event.type !== 'equipment.task') return null
  return upsert(list, event.equipment, e => e.id)
}

export function applyToLayout(layout: WarehouseLayout, event: TwinEvent): WarehouseLayout | null {
  if (event.type !== 'dock.status') return null
  if (!layout.docks.some(d => d.id === event.dockId)) return null
  return {
    ...layout,
    docks: layout.docks.map(d => (d.id === event.dockId ? { ...d, status: event.status } : d)),
  }
}

export function emptyRecoveryBundle(disruptionId: string): RecoveryBundle {
  return { disruptionId, plan: null, agentRuns: [], approvals: [] }
}

/** The disruption a recovery-scoped event belongs to, if any. */
export function recoveryEventDisruptionId(event: TwinEvent, plans: readonly RecoveryPlan[]): string | null {
  switch (event.type) {
    case 'recovery.updated':
      return event.plan.disruptionId
    case 'agent.step':
      return event.run.disruptionId
    case 'approval.changed':
      return plans.find(p => p.id === event.approval.planId)?.disruptionId ?? null
    default:
      return null
  }
}

export function applyToRecovery(bundle: RecoveryBundle, event: TwinEvent): RecoveryBundle | null {
  switch (event.type) {
    case 'recovery.updated':
      if (event.plan.disruptionId !== bundle.disruptionId) return null
      return { ...bundle, plan: event.plan }
    case 'agent.step':
      if (event.run.disruptionId !== bundle.disruptionId) return null
      return { ...bundle, agentRuns: upsert<AgentRun>(bundle.agentRuns, event.run, r => r.id) }
    case 'approval.changed':
      if (!bundle.plan || event.approval.planId !== bundle.plan.id) return null
      return { ...bundle, approvals: upsert<Approval>(bundle.approvals, event.approval, a => a.id) }
    default:
      return null
  }
}
