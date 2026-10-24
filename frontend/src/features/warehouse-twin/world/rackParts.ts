import * as THREE from 'three'
import type { Rack, WarehouseLayout } from '../data/schemas'
import { levelY, rackHeight, rackRotation, rotateXZ } from './layoutToWorld'

// Instance transforms for the parts of every selective pallet rack.
// Geometry is unit-sized in the component; these matrices carry the
// position, rotation and scale. Pure, so counts and bounds are testable.

export const UPRIGHT = { w: 0.09, d: 0.07 } as const
export const BEAM = { h: 0.12, d: 0.05 } as const
export const BRACE = 0.03
export const BRACE_PANEL = 1.2
/** Uprights stand this far above the top beam */
export const UPRIGHT_OVERRUN = 0.25

export type RackPartKind = 'upright' | 'beam' | 'brace' | 'basePlate' | 'endGuard'

const Y_AXIS = new THREE.Vector3(0, 1, 0)
const X_AXIS = new THREE.Vector3(1, 0, 0)

function place(rack: Rack, rot: number, lx: number, y: number, lz: number, scale: THREE.Vector3, tiltX = 0): THREE.Matrix4 {
  const [dx, dz] = rotateXZ(lx, lz, rot)
  const q = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, rot)
  if (tiltX) q.multiply(new THREE.Quaternion().setFromAxisAngle(X_AXIS, tiltX))
  return new THREE.Matrix4().compose(new THREE.Vector3(rack.x + dx, y, rack.z + dz), q, scale)
}

export function rackPartMatrices(layout: WarehouseLayout): Record<RackPartKind, THREE.Matrix4[]> {
  const out: Record<RackPartKind, THREE.Matrix4[]> = { upright: [], beam: [], brace: [], basePlate: [], endGuard: [] }

  for (const rack of layout.racks) {
    const rot = rackRotation(layout, rack)
    const H = rackHeight(rack) + UPRIGHT_OVERRUN
    const hx = rack.width / 2 - UPRIGHT.w / 2
    const hz = rack.depth / 2 - UPRIGHT.d / 2

    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        out.upright.push(place(rack, rot, sx * hx, H / 2, sz * hz, new THREE.Vector3(1, H, 1)))
        out.basePlate.push(place(rack, rot, sx * hx, 0.005, sz * hz, new THREE.Vector3(1, 1, 1)))
      }
    }

    // Two beams (front and back) per load level; beam top is the load surface
    for (let l = 1; l <= rack.levels; l++) {
      const y = levelY(rack, l) - BEAM.h / 2
      for (const sz of [-1, 1]) {
        out.beam.push(place(rack, rot, 0, y, sz * (rack.depth / 2 - BEAM.d / 2), new THREE.Vector3(rack.width - UPRIGHT.w, 1, 1)))
      }
    }

    // Zig-zag bracing in both end frames
    const span = rack.depth - UPRIGHT.d * 2
    const panels = Math.max(1, Math.floor((H - 0.2) / BRACE_PANEL))
    const len = Math.hypot(span, BRACE_PANEL)
    const angle = Math.atan2(span, BRACE_PANEL)
    for (const sx of [-1, 1]) {
      for (let i = 0; i < panels; i++) {
        const yMid = 0.15 + BRACE_PANEL * (i + 0.5)
        out.brace.push(place(rack, rot, sx * hx, yMid, 0, new THREE.Vector3(1, len, 1), i % 2 === 0 ? angle : -angle))
        // Horizontal tie at the bottom of each panel
        out.brace.push(place(rack, rot, sx * hx, 0.15 + BRACE_PANEL * i, 0, new THREE.Vector3(1, span, 1), Math.PI / 2))
      }
    }
  }

  // Row-end guards at the open (cross-aisle) end of each rack run
  const runs = new Map<string, Rack[]>()
  for (const rack of layout.racks) {
    const key = `${rack.aisleId}:${rack.side}`
    const list = runs.get(key)
    if (list) list.push(rack)
    else runs.set(key, [rack])
  }
  for (const [, racks] of runs) {
    const aisle = layout.aisles.find(a => a.id === racks[0].aisleId)
    if (!aisle) continue
    const frontOf = (r: Rack) => (aisle.orientation === 'z' ? r.z : r.x)
    const front = racks.reduce((a, b) => (frontOf(b) > frontOf(a) ? b : a))
    const rot = rackRotation(layout, front)
    // The end of the bay (local ±x) nearest the front of the aisle
    const [ax, az] = rotateXZ(1, 0, rot)
    const sign = (aisle.orientation === 'z' ? az : ax) >= 0 ? 1 : -1
    out.endGuard.push(place(front, rot, sign * (front.width / 2 + 0.22), 0.3, 0, new THREE.Vector3(1, 1, 1)))
  }

  return out
}
