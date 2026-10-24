import { POSITION_ID_PATTERN, type Dock, type Rack, type WarehouseLayout } from '../data/schemas'
import { DOCK_DOOR, LEVEL_BASE_Y } from './constants'

export type Vec3 = [number, number, number]
export type LayoutKind = 'zone' | 'aisle' | 'rack' | 'level' | 'position' | 'dock'

/**
 * A layout element placed in world space.
 * - `position`: for racks, levels and positions this is the centre of the
 *   element's footprint at its load surface (y = the beam top it rests on);
 *   for zones and aisles the floor centre; for docks the door sill centre.
 * - `rotationY`: rotation about +Y. In the element's local frame +X runs
 *   along the rack bay (P01 → Pn) and +Z points out of the face (toward
 *   the aisle for racks, out of the building for docks).
 * - `size`: [local X, Y, local Z] extent in metres.
 */
export interface WorldTransform {
  kind: LayoutKind
  id: string
  position: Vec3
  rotationY: number
  size: Vec3
}

const AISLE_ID = /^A\d{2}$/
const RACK_ID = /^A\d{2}-R\d{2}$/
const LEVEL_ID = /^A\d{2}-R\d{2}-L\d{2}$/

export function rackHeight(rack: Rack): number {
  return LEVEL_BASE_Y + rack.levels * rack.levelHeight
}

export function levelY(rack: Rack, level: number): number {
  return LEVEL_BASE_Y + (level - 1) * rack.levelHeight
}

/** Rotates a local (x, z) offset by rotationY into world space. */
export function rotateXZ(x: number, z: number, rotationY: number): [number, number] {
  const c = Math.cos(rotationY)
  const s = Math.sin(rotationY)
  return [x * c + z * s, -x * s + z * c]
}

/** Rotation that turns local +Z into the outward/aisle-facing direction. */
function faceRotation(dx: number, dz: number): number {
  return Math.atan2(dx, dz)
}

export function rackRotation(layout: WarehouseLayout, rack: Rack): number {
  const aisle = layout.aisles.find(a => a.id === rack.aisleId)
  if (!aisle) return 0
  if (aisle.orientation === 'z') return faceRotation(Math.sign(aisle.x - rack.x) || 1, 0)
  return faceRotation(0, Math.sign(aisle.z - rack.z) || 1)
}

function dockRotation(dock: Dock): number {
  switch (dock.side) {
    case 'south': return faceRotation(0, 1)
    case 'north': return faceRotation(0, -1)
    case 'east': return faceRotation(1, 0)
    case 'west': return faceRotation(-1, 0)
  }
}

function rackTransform(layout: WarehouseLayout, rack: Rack): WorldTransform {
  return {
    kind: 'rack',
    id: rack.id,
    position: [rack.x, 0, rack.z],
    rotationY: rackRotation(layout, rack),
    size: [rack.width, rackHeight(rack), rack.depth],
  }
}

function levelTransform(layout: WarehouseLayout, rack: Rack, level: number, id: string): WorldTransform | null {
  if (level < 1 || level > rack.levels) return null
  return {
    kind: 'level',
    id,
    position: [rack.x, levelY(rack, level), rack.z],
    rotationY: rackRotation(layout, rack),
    size: [rack.width, rack.levelHeight, rack.depth],
  }
}

function positionTransform(layout: WarehouseLayout, rack: Rack, level: number, slot: number, id: string): WorldTransform | null {
  if (level < 1 || level > rack.levels || slot < 1 || slot > rack.positionsPerLevel) return null
  const rotationY = rackRotation(layout, rack)
  const slotWidth = rack.width / rack.positionsPerLevel
  const localX = -rack.width / 2 + (slot - 0.5) * slotWidth
  const [dx, dz] = rotateXZ(localX, 0, rotationY)
  return {
    kind: 'position',
    id,
    position: [rack.x + dx, levelY(rack, level), rack.z + dz],
    rotationY,
    size: [slotWidth, rack.levelHeight, rack.depth],
  }
}

/**
 * Maps a layout id to its world transform, or null if the id is not in the
 * layout. Accepts zone and dock ids as they appear in the layout, aisle ids
 * (A04), rack ids (A04-R16), level ids (A04-R16-L02) and position ids
 * (A04-R16-L02-P03).
 */
export function layoutToWorld(layout: WarehouseLayout, id: string): WorldTransform | null {
  const zone = layout.zones.find(z => z.id === id)
  if (zone) {
    const { x, z, width, depth } = zone.bounds
    return { kind: 'zone', id, position: [x + width / 2, 0, z + depth / 2], rotationY: 0, size: [width, 0, depth] }
  }

  const dock = layout.docks.find(d => d.id === id)
  if (dock) {
    return {
      kind: 'dock',
      id,
      position: [dock.x, 0, dock.z],
      rotationY: dockRotation(dock),
      size: [DOCK_DOOR.width, DOCK_DOOR.height, 0],
    }
  }

  if (AISLE_ID.test(id)) {
    const aisle = layout.aisles.find(a => a.id === id)
    if (!aisle) return null
    return {
      kind: 'aisle',
      id,
      position: [aisle.x, 0, aisle.z],
      rotationY: aisle.orientation === 'z' ? 0 : Math.PI / 2,
      size: [aisle.width, 0, aisle.length],
    }
  }

  const [aisleId, r, l, p] = id.split('-')
  const rack = RACK_ID.test(`${aisleId}-${r}`) ? layout.racks.find(x => x.id === `${aisleId}-${r}`) : undefined
  if (!rack) return null

  if (RACK_ID.test(id)) return rackTransform(layout, rack)
  if (LEVEL_ID.test(id)) return levelTransform(layout, rack, Number(l.slice(1)), id)
  if (POSITION_ID_PATTERN.test(id)) return positionTransform(layout, rack, Number(l.slice(1)), Number(p.slice(1)), id)
  return null
}

/** World-space axis-aligned bounds of a rack (for collision and picking). */
export function rackWorldBounds(layout: WarehouseLayout, rack: Rack): { minX: number; maxX: number; minZ: number; maxZ: number; maxY: number } {
  const rot = rackRotation(layout, rack)
  const [ax, az] = rotateXZ(rack.width / 2, 0, rot)
  const [bx, bz] = rotateXZ(0, rack.depth / 2, rot)
  const hx = Math.abs(ax) + Math.abs(bx)
  const hz = Math.abs(az) + Math.abs(bz)
  return { minX: rack.x - hx, maxX: rack.x + hx, minZ: rack.z - hz, maxZ: rack.z + hz, maxY: rackHeight(rack) }
}
