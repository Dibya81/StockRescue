import type { TwinEvent } from '../data/schemas'

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)
  } catch {
    return `${amount.toLocaleString()} ${currency}`
  }
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function relativeTime(iso: string, now = Date.now()): string {
  const diff = Math.round((now - Date.parse(iso)) / 1000)
  const abs = Math.abs(diff)
  const suffix = diff >= 0 ? 'ago' : 'from now'
  if (abs < 45) return diff >= 0 ? 'just now' : 'in a moment'
  if (abs < 3600) return `${Math.round(abs / 60)} min ${suffix}`
  if (abs < 86_400) return `${Math.round(abs / 3600)} h ${suffix}`
  return `${Math.round(abs / 86_400)} d ${suffix}`
}

export const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

/** One-line, human description of a stream event for the feed. */
export function describeEvent(event: TwinEvent): string {
  switch (event.type) {
    case 'inventory.updated':
      return `${event.lot.sku} at ${event.lot.positionId ?? 'unassigned'}: ${event.lot.qty} ${event.lot.unit}, ${titleCase(event.lot.status).toLowerCase()}`
    case 'disruption.created':
      return `${event.disruption.id} ${titleCase(event.disruption.status).toLowerCase()}: ${event.disruption.sku} from ${event.disruption.failedSupplier.name}`
    case 'recovery.updated':
      return `Plan ${event.plan.id} ${titleCase(event.plan.status).toLowerCase()} (${event.plan.options.length} options)`
    case 'agent.step':
      return `${event.run.agent}: ${event.run.step} (${event.run.status})`
    case 'approval.changed':
      return `${event.approval.decision === 'approved' ? 'Approved' : 'Rejected'} ${event.approval.optionId ?? 'plan'} by ${event.approval.approver}`
    case 'shipment.status':
      return `${event.shipment.id} from ${event.shipment.supplier.name}: ${titleCase(event.shipment.status).toLowerCase()}`
    case 'equipment.task':
      return event.equipment.currentTask
        ? `${event.equipment.label}: ${event.equipment.currentTask.description}`
        : `${event.equipment.label} ${event.equipment.status === 'idle' ? 'parked' : event.equipment.status}`
    case 'dock.status':
      return `${event.dockId} ${event.status}`
  }
}
