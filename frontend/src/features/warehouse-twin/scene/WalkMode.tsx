import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { PointerLockControls } from '@react-three/drei'
import * as THREE from 'three'
import type { WarehouseLayout } from '../data/schemas'
import { EYE_HEIGHT, GROUND_Y, WALL_THICKNESS } from '../world/constants'
import { rackWorldBounds } from '../world/layoutToWorld'
import { rectsOverlap, type Rect, type SitePlan } from '../world/sitePlan'
import { buildZoneProps, PROP_SIZE } from '../world/zoneProps'
import { useTwinStore } from '../store/twinStore'

const RADIUS = 0.3

/** Wall strips with gaps at doors, plus racks, columns and floor furniture. */
function walkObstacles(layout: WarehouseLayout, plan: SitePlan, bays: { x: number; z: number }[]): Rect[] {
  const fp = plan.footprint
  const t = WALL_THICKNESS / 2
  const out: Rect[] = layout.racks.map(r => rackWorldBounds(layout, r))
  out.push(...plan.columns.map(c => ({ minX: c.x - 0.38, maxX: c.x + 0.38, minZ: c.z - 0.38, maxZ: c.z + 0.38 })))
  for (const p of buildZoneProps(layout, plan, bays)) {
    if (!PROP_SIZE[p.kind]) continue
    out.push({ minX: p.x - p.w / 2, maxX: p.x + p.w / 2, minZ: p.z - p.d / 2, maxZ: p.z + p.d / 2 })
  }
  const sides: [string, number, number, (a: number, b: number) => Rect][] = [
    ['south', fp.minX, fp.maxX, (a, b) => ({ minX: a, maxX: b, minZ: fp.maxZ - t, maxZ: fp.maxZ + t })],
    ['north', fp.minX, fp.maxX, (a, b) => ({ minX: a, maxX: b, minZ: fp.minZ - t, maxZ: fp.minZ + t })],
    ['east', fp.minZ, fp.maxZ, (a, b) => ({ minX: fp.maxX - t, maxX: fp.maxX + t, minZ: a, maxZ: b })],
    ['west', fp.minZ, fp.maxZ, (a, b) => ({ minX: fp.minX - t, maxX: fp.minX + t, minZ: a, maxZ: b })],
  ]
  for (const [side, lo, hi, make] of sides) {
    // Only the personnel entrance and exits are walkable openings (docks are 1.2 m drops)
    const gaps = plan.openings.filter(o => o.side === side && o.kind !== 'dock').map(o => [o.along - o.width / 2, o.along + o.width / 2]).sort((a, b) => a[0] - b[0])
    let start = lo
    for (const [a, b] of gaps) {
      out.push(make(start, a))
      start = b
    }
    out.push(make(start, hi))
  }
  return out
}

export function WalkMode({ layout, plan, bays }: { layout: WarehouseLayout; plan: SitePlan; bays: { x: number; z: number }[] }) {
  const camera = useThree(s => s.camera)
  const setWalk = useTwinStore(s => s.setWalk)
  const keys = useRef(new Set<string>())
  const obstacles = useMemo(() => walkObstacles(layout, plan, bays), [layout, plan, bays])
  const fp = plan.footprint

  useEffect(() => {
    // Start just inside the personnel entrance, looking down the hall
    const door = plan.openings.find(o => o.kind === 'personnel')
    camera.position.set(door ? door.along : 0, EYE_HEIGHT, fp.maxZ - 2.5)
    camera.lookAt(door ? door.along : 0, EYE_HEIGHT, fp.minZ)
    const down = (e: KeyboardEvent) => keys.current.add(e.code)
    const up = (e: KeyboardEvent) => keys.current.delete(e.code)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [camera, plan, fp])

  const blocked = (x: number, z: number) => {
    const box = { minX: x - RADIUS, maxX: x + RADIUS, minZ: z - RADIUS, maxZ: z + RADIUS }
    return obstacles.some(o => rectsOverlap(o, box))
  }

  const fwd = useMemo(() => new THREE.Vector3(), [])
  const right = useMemo(() => new THREE.Vector3(), [])
  useFrame((_, dt) => {
    const k = keys.current
    const speed = (k.has('ShiftLeft') || k.has('ShiftRight') ? 5.5 : 2.8) * Math.min(dt, 0.05)
    camera.getWorldDirection(fwd)
    fwd.y = 0
    fwd.normalize()
    right.crossVectors(fwd, camera.up).normalize()
    let dx = 0
    let dz = 0
    if (k.has('KeyW') || k.has('ArrowUp')) { dx += fwd.x; dz += fwd.z }
    if (k.has('KeyS') || k.has('ArrowDown')) { dx -= fwd.x; dz -= fwd.z }
    if (k.has('KeyD') || k.has('ArrowRight')) { dx += right.x; dz += right.z }
    if (k.has('KeyA') || k.has('ArrowLeft')) { dx -= right.x; dz -= right.z }
    const len = Math.hypot(dx, dz)
    if (len > 0) {
      dx = (dx / len) * speed
      dz = (dz / len) * speed
      const { x, z } = camera.position
      // Slide along obstacles one axis at a time
      if (!blocked(x + dx, z)) camera.position.x += dx
      if (!blocked(camera.position.x, z + dz)) camera.position.z += dz
    }
    const inside = camera.position.x > fp.minX && camera.position.x < fp.maxX && camera.position.z > fp.minZ && camera.position.z < fp.maxZ
    camera.position.y = (inside ? 0 : GROUND_Y) + EYE_HEIGHT
  })

  return <PointerLockControls makeDefault onUnlock={() => setWalk(false)} ref={c => { c?.lock() }} />
}
