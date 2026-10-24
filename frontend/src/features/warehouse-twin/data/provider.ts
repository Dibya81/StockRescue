import type {
  AuditEvent,
  CreateDisruptionInput,
  DecisionInput,
  Disruption,
  Equipment,
  InventoryLot,
  RecoveryBundle,
  Shipment,
  TwinEvent,
  WarehouseLayout,
} from './schemas'
import type { TwinRole } from './roles'

export type DataMode = 'live' | 'simulation'

/** State of the event stream connection, shown in the twin header. */
export type ConnectionState = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'unavailable'

export type ProviderErrorKind =
  | 'network'      // backend unreachable
  | 'unavailable'  // endpoint not implemented on this backend (404/405/501)
  | 'unauthorized' // 401
  | 'forbidden'    // 403, or role check failed in simulation
  | 'invalid'      // payload failed schema validation
  | 'server'       // any other non-2xx

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind
  readonly status: number | null
  readonly endpoint: string

  constructor(kind: ProviderErrorKind, message: string, endpoint: string, status: number | null = null) {
    super(message)
    this.name = 'ProviderError'
    this.kind = kind
    this.endpoint = endpoint
    this.status = status
  }
}

export interface Actor {
  id: string
  role: TwinRole
}

/**
 * The only way UI code reads or mutates twin data. LIVE and SIMULATION
 * implement the same interface so every panel runs one code path.
 */
export interface TwinDataProvider {
  readonly mode: DataMode

  getLayout(): Promise<WarehouseLayout>
  getInventory(): Promise<InventoryLot[]>
  searchInventory(sku: string): Promise<InventoryLot[]>
  getDisruptions(): Promise<Disruption[]>
  getRecovery(disruptionId: string): Promise<RecoveryBundle>
  getShipments(): Promise<Shipment[]>
  getEquipment(): Promise<Equipment[]>
  getAudit(): Promise<AuditEvent[]>

  createDisruption(input: CreateDisruptionInput, actor: Actor): Promise<Disruption>
  analyzeRecovery(disruptionId: string, actor: Actor): Promise<void>
  approveRecovery(disruptionId: string, input: DecisionInput, actor: Actor): Promise<void>
  rejectRecovery(disruptionId: string, input: DecisionInput, actor: Actor): Promise<void>

  /** Validated events, in order. Returns an unsubscribe function. */
  subscribe(listener: (event: TwinEvent) => void): () => void
  subscribeConnection(listener: (state: ConnectionState) => void): () => void
  getConnectionState(): ConnectionState
}

export function describeProviderError(err: unknown): { title: string; detail: string } {
  if (err instanceof ProviderError) {
    switch (err.kind) {
      case 'unavailable':
        return {
          title: 'Not available on this backend',
          detail: `${err.endpoint} is not implemented by the connected StockRescue backend.`,
        }
      case 'network':
        return { title: 'Backend unreachable', detail: err.message }
      case 'unauthorized':
        return { title: 'Session expired', detail: 'Sign in again to load live warehouse data.' }
      case 'forbidden':
        return { title: 'Not permitted', detail: err.message }
      case 'invalid':
        return { title: 'Unexpected data from backend', detail: err.message }
      case 'server':
        return { title: 'Backend error', detail: err.message }
    }
  }
  return { title: 'Something went wrong', detail: err instanceof Error ? err.message : String(err) }
}
