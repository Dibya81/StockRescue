import type { InventoryLot, InventoryStatus, WarehouseLayout } from '../data/schemas'
import { indexLotsByPosition } from '../data/layoutGeometry'
import { positionStatus } from '../data/statusMapping'
import { BEAM } from './rackParts'
import { layoutToWorld } from './layoutToWorld'
import { PALLET } from './constants'

// Turns inventory lots into renderable instances at their real positions.
// Nothing is drawn for positions without a lot ("empty renders empty").

export type LoadKind = 'carton' | 'tote' | 'reel' | 'steel' | 'drum'
export const LOAD_KINDS: LoadKind[] = ['carton', 'tote', 'reel', 'steel', 'drum']

/** Statuses that get a billboard icon above the position. */
export const FLAGGED_STATUSES: InventoryStatus[] = [
  'low_stock', 'shortage', 'disruption_affected', 'reserved', 'incoming', 'quarantine',
]

const PALLET_HEIGHT = PALLET.height
/** Clearance kept under the beam above a load */
const HEADROOM = 0.18
export const MAX_LOAD_HEIGHT = 1.2

/** How a lot is packed, from its unit and SKU family. */
export function lotLoadKind(lot: Pick<InventoryLot, 'unit' | 'sku'>): LoadKind {
  const unit = lot.unit.toLowerCase()
  if (unit === 'reel' || unit === 'coil') return 'reel'
  if (unit === 'pail' || unit === 'drum') return 'drum'
  // Plate, beams and tubes are banded steel; welded assemblies ship in crates
  if (unit === 'sheet' || (lot.sku.startsWith('STL-') && !lot.sku.startsWith('STL-ASM'))) return 'steel'
  if (unit === 'box') return 'tote'
  return 'carton'
}

/**
 * Stack fill as a fraction of the available height. Shape follows status,
 * not quantity, so it never implies an invented number.
 */
export function stackFill(status: InventoryStatus): number {
  switch (status) {
    case 'low_stock': return 0.42
    case 'shortage': return 0.2
    case 'incoming':
    case 'empty': return 0
    default: return 1
  }
}

export interface PalletInstance {
  positionId: string
  x: number
  y: number
  z: number
  rotationY: number
  width: number
  depth: number
  plastic: boolean
}

export interface LoadInstance extends PalletInstance {
  lotIds: string[]
  sku: string
  kind: LoadKind
  status: InventoryStatus
  /** Load height above the pallet deck */
  height: number
}

export interface FlagInstance {
  positionId: string
  status: InventoryStatus
  x: number
  y: number
  z: number
}

export interface InventoryScene {
  pallets: PalletInstance[]
  loads: Record<LoadKind, LoadInstance[]>
  /** Positions reserved for inbound stock: drawn as ghost frames, no load */
  incoming: PalletInstance[]
  flags: FlagInstance[]
  /** Every position that renders something, for lookups by id */
  byPosition: Map<string, LoadInstance | PalletInstance>
  /** Lots whose position id is not in the layout: listed, never drawn */
  unplaced: InventoryLot[]
}

export function buildInventoryScene(layout: WarehouseLayout, lots: readonly InventoryLot[]): InventoryScene {
  const scene: InventoryScene = {
    pallets: [],
    loads: { carton: [], tote: [], reel: [], steel: [], drum: [] },
    incoming: [],
    flags: [],
    byPosition: new Map(),
    unplaced: [],
  }
  const racks = new Map(layout.racks.map(r => [r.id, r]))
  const { byPosition, unassigned } = indexLotsByPosition(lots)
  scene.unplaced.push(...unassigned)

  for (const [positionId, posLots] of [...byPosition.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const t = layoutToWorld(layout, positionId)
    const rack = racks.get(positionId.slice(0, 7))
    if (!t || !rack) {
      scene.unplaced.push(...posLots)
      continue
    }
    const status = positionStatus(posLots)
    // The lot with the largest quantity decides the packaging
    const primary = posLots.reduce((a, b) => (b.qty > a.qty ? b : a))
    const kind = lotLoadKind(primary)
    const width = Math.min(0.8, t.size[0] - 0.1)
    const depth = Math.max(PALLET.depth, Math.min(1.2, rack.depth + 0.1))
    const [x, y, z] = t.position
    const base: PalletInstance = { positionId, x, y, z, rotationY: t.rotationY, width, depth, plastic: kind === 'tote' }

    if (status === 'incoming') {
      scene.incoming.push(base)
      scene.byPosition.set(positionId, base)
    } else {
      const room = Math.min(MAX_LOAD_HEIGHT, rack.levelHeight - PALLET_HEIGHT - HEADROOM - BEAM.h)
      const height = Math.max(0.12, room * stackFill(status))
      const load: LoadInstance = { ...base, lotIds: posLots.map(l => l.lotId), sku: primary.sku, kind, status, height }
      scene.pallets.push(base)
      scene.loads[kind].push(load)
      scene.byPosition.set(positionId, load)
    }

    if (FLAGGED_STATUSES.includes(status)) {
      const top = status === 'incoming' ? 0.6 : (scene.byPosition.get(positionId) as LoadInstance).height + PALLET_HEIGHT
      scene.flags.push({ positionId, status, x, y: y + top + 0.35, z })
    }
  }
  return scene
}

/** instanceId → positionId lookup for a list of instances. */
export function instancePositionIds(list: readonly { positionId: string }[]): string[] {
  return list.map(i => i.positionId)
}
