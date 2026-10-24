import type { Dock, Rack, WarehouseLayout } from '../data/schemas'
import { layoutToWorld, levelY, rackHeight, rackRotation, rotateXZ, type Vec3 } from './layoutToWorld'
import type { CameraPose, SitePlan } from './sitePlan'

// Camera poses that frame layout elements. Interior poses stay inside the
// footprint, below the roof and in the aisle, so nothing blocks the view.

export interface FramedPose extends CameraPose {
  /** The roof must be cut away for this pose to see its target */
  cutaway: boolean
}

function aisleOffset(layout: WarehouseLayout, rack: Rack): number {
  const aisle = layout.aisles.find(a => a.id === rack.aisleId)
  return (aisle ? aisle.width / 2 : 1.6) + rack.depth / 2
}

/** +1/-1: which way along the bay points toward the middle of the aisle (stays inside the building). */
function alongSign(layout: WarehouseLayout, rack: Rack, ax: number, az: number): number {
  const aisle = layout.aisles.find(a => a.id === rack.aisleId)
  if (!aisle) return 1
  return (aisle.x - rack.x) * ax + (aisle.z - rack.z) * az >= 0 ? 1 : -1
}

/** Stand in the aisle the rack faces, a few bays along, looking at it obliquely. */
export function frameRack(layout: WarehouseLayout, rack: Rack): FramedPose {
  const rot = rackRotation(layout, rack)
  const [nx, nz] = rotateXZ(0, 1, rot)
  const [ax, az] = rotateXZ(1, 0, rot)
  const H = rackHeight(rack)
  const out = aisleOffset(layout, rack)
  const along = (rack.width / 2 + 6.5) * alongSign(layout, rack, ax, az)
  return {
    position: [rack.x + nx * out + ax * along, H * 0.95, rack.z + nz * out + az * along],
    target: [rack.x, H * 0.45, rack.z],
    cutaway: false,
  }
}

export function frameLevel(layout: WarehouseLayout, rack: Rack, level: number): FramedPose {
  const pose = frameRack(layout, rack)
  const y = levelY(rack, Math.min(Math.max(level, 1), rack.levels))
  return { ...pose, position: [pose.position[0], y + 1.5, pose.position[2]], target: [rack.x, y + 0.5, rack.z] }
}

/** Close-up of a single pallet position from the aisle. */
export function framePosition(layout: WarehouseLayout, positionId: string): FramedPose | null {
  const t = layoutToWorld(layout, positionId)
  const rack = layout.racks.find(r => r.id === positionId.slice(0, 7))
  if (!t || !rack) return null
  const [nx, nz] = rotateXZ(0, 1, t.rotationY)
  const [ax, az] = rotateXZ(1, 0, t.rotationY)
  const out = aisleOffset(layout, rack)
  const along = 3.4 * alongSign(layout, rack, ax, az)
  const [x, y, z] = t.position
  return {
    position: [x + nx * out + ax * along, y + 2.0, z + nz * out + az * along],
    target: [x, y + 0.55, z],
    cutaway: false,
  }
}

/**
 * Frames a set of world points (e.g. every location holding a SKU). One
 * point → close-up; several → an aerial view over the cut-away roof.
 */
export function framePoints(points: readonly Vec3[], plan: SitePlan): FramedPose | null {
  if (points.length === 0) return null
  const xs = points.map(p => p[0])
  const zs = points.map(p => p[2])
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs), 10)
  const fp = plan.footprint
  const inside = cx > fp.minX && cx < fp.maxX && cz > fp.minZ && cz < fp.maxZ
  const height = Math.max(plan.heights.roof + 6, span * 0.85 + 8)
  return {
    position: [cx + span * 0.12, height, cz + span * 0.55 + 6],
    target: [cx, 1, cz],
    cutaway: inside && height > plan.heights.roof,
  }
}

/** Outside the building, facing the dock door. */
export function frameDock(layout: WarehouseLayout, dock: Dock): FramedPose | null {
  const t = layoutToWorld(layout, dock.id)
  if (!t) return null
  const [nx, nz] = rotateXZ(0, 1, t.rotationY)
  const [ax, az] = rotateXZ(1, 0, t.rotationY)
  const [x, , z] = t.position
  return {
    position: [x + nx * 16 + ax * 5, 7, z + nz * 16 + az * 5],
    target: [x, 1.6, z + nz * 1],
    cutaway: false,
  }
}

/** A floor point (e.g. an equipment bay), seen from inside the building when it is inside. */
export function frameFloorPoint(x: number, z: number, plan: SitePlan): FramedPose {
  const fp = plan.footprint
  const inside = x > fp.minX && x < fp.maxX && z > fp.minZ && z < fp.maxZ
  if (!inside) return { position: [x + 8, 6, z + 10], target: [x, 0.8, z], cutaway: false }
  const clampX = (v: number) => Math.min(fp.maxX - 1, Math.max(fp.minX + 1, v))
  const clampZ = (v: number) => Math.min(fp.maxZ - 1, Math.max(fp.minZ + 1, v))
  return {
    position: [clampX(x - 6), Math.min(plan.heights.clear - 2.5, 6.5), clampZ(z + 8)],
    target: [x, 0.8, z],
    cutaway: false,
  }
}
