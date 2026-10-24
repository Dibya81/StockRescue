import { POSITION_ID_PATTERN, type InventoryLot, type Rack, type WarehouseLayout } from './schemas'

export interface ParsedPositionId {
  aisleId: string
  rackId: string
  level: number
  position: number
}

export function parsePositionId(id: string): ParsedPositionId | null {
  if (!POSITION_ID_PATTERN.test(id)) return null
  const [aisle, rack, level, position] = id.split('-')
  return {
    aisleId: aisle,
    rackId: `${aisle}-${rack}`,
    level: Number(level.slice(1)),
    position: Number(position.slice(1)),
  }
}

export function formatPositionId(rackId: string, level: number, position: number): string {
  return `${rackId}-L${String(level).padStart(2, '0')}-P${String(position).padStart(2, '0')}`
}

/** All position ids a rack exposes, level by level (L01 is the floor level). */
export function rackPositionIds(rack: Rack): string[] {
  const ids: string[] = []
  for (let l = 1; l <= rack.levels; l++) {
    for (let p = 1; p <= rack.positionsPerLevel; p++) ids.push(formatPositionId(rack.id, l, p))
  }
  return ids
}

export function totalPositions(layout: WarehouseLayout): number {
  return layout.racks.reduce((n, r) => n + r.levels * r.positionsPerLevel, 0)
}

/** Lots grouped by position id. Lots without a position are returned separately. */
export function indexLotsByPosition(lots: readonly InventoryLot[]): {
  byPosition: Map<string, InventoryLot[]>
  unassigned: InventoryLot[]
} {
  const byPosition = new Map<string, InventoryLot[]>()
  const unassigned: InventoryLot[] = []
  for (const lot of lots) {
    if (!lot.positionId) {
      unassigned.push(lot)
      continue
    }
    const list = byPosition.get(lot.positionId)
    if (list) list.push(lot)
    else byPosition.set(lot.positionId, [lot])
  }
  return { byPosition, unassigned }
}

/** Lots grouped by rack id, for rack-level roll-ups. */
export function indexLotsByRack(lots: readonly InventoryLot[]): Map<string, InventoryLot[]> {
  const byRack = new Map<string, InventoryLot[]>()
  for (const lot of lots) {
    const parsed = lot.positionId ? parsePositionId(lot.positionId) : null
    if (!parsed) continue
    const list = byRack.get(parsed.rackId)
    if (list) list.push(lot)
    else byRack.set(parsed.rackId, [lot])
  }
  return byRack
}

/** Plan-view footprint of a rack. Racks along a z-aisle are long in z. */
export function rackFootprint(rack: Rack, layout: WarehouseLayout): { x: number; z: number; w: number; d: number } {
  const aisle = layout.aisles.find(a => a.id === rack.aisleId)
  const alongZ = !aisle || aisle.orientation === 'z'
  return alongZ
    ? { x: rack.x - rack.depth / 2, z: rack.z - rack.width / 2, w: rack.depth, d: rack.width }
    : { x: rack.x - rack.width / 2, z: rack.z - rack.depth / 2, w: rack.width, d: rack.depth }
}
