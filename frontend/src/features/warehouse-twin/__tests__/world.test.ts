import { beforeAll, describe, expect, it } from 'vitest'
import type { Shipment, WarehouseLayout } from '../data/schemas'
import { rackPositionIds } from '../data/layoutGeometry'
import { SCENARIOS } from '../scenarios'
import { LEVEL_BASE_Y } from '../world/constants'
import {
  layoutToWorld,
  rackHeight,
  rackRotation,
  rackWorldBounds,
  rotateXZ,
} from '../world/layoutToWorld'
import { buildSitePlan, isDockOpen, obstacleRects, rectsOverlap, type SitePlan } from '../world/sitePlan'
import { createRng, parseSceneParams } from '../world/sceneParams'

let layout: WarehouseLayout
let plan: SitePlan

beforeAll(async () => {
  layout = (await SCENARIOS[0].load()).initialState.layout
  plan = buildSitePlan(layout, 42)
})

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps

describe('layoutToWorld', () => {
  it('returns null for ids that are not in the layout', () => {
    expect(layoutToWorld(layout, 'A99')).toBeNull()
    expect(layoutToWorld(layout, 'A01-R99')).toBeNull()
    expect(layoutToWorld(layout, 'A01-R01-L09')).toBeNull()
    expect(layoutToWorld(layout, 'A01-R01-L01-P09')).toBeNull()
    expect(layoutToWorld(layout, 'nonsense')).toBeNull()
  })

  it('places zones at the centre of their bounds', () => {
    const zone = layout.zones[0]
    const t = layoutToWorld(layout, zone.id)
    expect(t?.kind).toBe('zone')
    expect(t?.position).toEqual([zone.bounds.x + zone.bounds.width / 2, 0, zone.bounds.z + zone.bounds.depth / 2])
    expect(t?.size).toEqual([zone.bounds.width, 0, zone.bounds.depth])
  })

  it('orients docks so local +Z points out of the building', () => {
    for (const dock of layout.docks) {
      const t = layoutToWorld(layout, dock.id)
      expect(t?.kind).toBe('dock')
      const [ox, oz] = rotateXZ(0, 1, t!.rotationY)
      if (dock.side === 'south') expect(close(oz, 1)).toBe(true)
      if (dock.side === 'north') expect(close(oz, -1)).toBe(true)
      expect(Math.abs(ox) < 1e-6 || dock.side === 'east' || dock.side === 'west').toBe(true)
    }
  })

  it('maps aisles with their length along their orientation', () => {
    const aisle = layout.aisles[0]
    const t = layoutToWorld(layout, aisle.id)
    expect(t?.position).toEqual([aisle.x, 0, aisle.z])
    expect(t?.size[2]).toBe(aisle.length)
  })

  it('turns every rack to face its aisle', () => {
    for (const rack of layout.racks) {
      const aisle = layout.aisles.find(a => a.id === rack.aisleId)!
      const [fx, fz] = rotateXZ(0, 1, rackRotation(layout, rack))
      const toAisle = aisle.orientation === 'z' ? [Math.sign(aisle.x - rack.x), 0] : [0, Math.sign(aisle.z - rack.z)]
      expect(close(fx, toAisle[0])).toBe(true)
      expect(close(fz, toAisle[1])).toBe(true)
    }
  })

  it('stacks levels from the base height in level-spacing steps', () => {
    const rack = layout.racks[0]
    for (let l = 1; l <= rack.levels; l++) {
      const t = layoutToWorld(layout, `${rack.id}-L${String(l).padStart(2, '0')}`)
      expect(t?.kind).toBe('level')
      expect(close(t!.position[1], LEVEL_BASE_Y + (l - 1) * rack.levelHeight)).toBe(true)
    }
    expect(layoutToWorld(layout, rack.id)?.size[1]).toBeCloseTo(rackHeight(rack))
  })

  it('places every position inside its rack footprint, distinct and in bay order', () => {
    for (const rack of layout.racks.slice(0, 20)) {
      const b = rackWorldBounds(layout, rack)
      const seen = new Set<string>()
      const ids = rackPositionIds(rack)
      for (const id of ids) {
        const t = layoutToWorld(layout, id)!
        expect(t.kind).toBe('position')
        const [x, y, z] = t.position
        expect(x).toBeGreaterThanOrEqual(b.minX - 1e-6)
        expect(x).toBeLessThanOrEqual(b.maxX + 1e-6)
        expect(z).toBeGreaterThanOrEqual(b.minZ - 1e-6)
        expect(z).toBeLessThanOrEqual(b.maxZ + 1e-6)
        expect(y).toBeLessThan(b.maxY)
        seen.add(t.position.map(v => v.toFixed(4)).join(','))
      }
      expect(seen.size).toBe(ids.length)
      // P01 → Pn runs along local +X
      const p1 = layoutToWorld(layout, `${rack.id}-L01-P01`)!
      const p2 = layoutToWorld(layout, `${rack.id}-L01-P02`)!
      const [lx, lz] = rotateXZ(1, 0, p1.rotationY)
      const along = (p2.position[0] - p1.position[0]) * lx + (p2.position[2] - p1.position[2]) * lz
      expect(along).toBeCloseTo(rack.width / rack.positionsPerLevel)
    }
  })

  it('is pure: same input, same output', () => {
    expect(layoutToWorld(layout, 'A04-R06-L02-P03')).toEqual(layoutToWorld(layout, 'A04-R06-L02-P03'))
  })
})

describe('site plan', () => {
  it('never puts an interior column in a rack, an aisle or a dock lane', () => {
    const obstacles = obstacleRects(layout)
    expect(plan.columns.length).toBeGreaterThan(0)
    for (const c of plan.columns) {
      const box = { minX: c.x - 0.25, maxX: c.x + 0.25, minZ: c.z - 0.25, maxZ: c.z + 0.25 }
      expect(obstacles.some(o => rectsOverlap(o, box))).toBe(false)
    }
  })

  it('keeps openings within their wall and docks away from each other', () => {
    const fp = plan.footprint
    for (const o of plan.openings) {
      const [lo, hi] = o.side === 'north' || o.side === 'south' ? [fp.minX, fp.maxX] : [fp.minZ, fp.maxZ]
      expect(o.along - o.width / 2).toBeGreaterThan(lo)
      expect(o.along + o.width / 2).toBeLessThan(hi)
    }
    const south = plan.openings.filter(o => o.side === 'south').sort((a, b) => a.along - b.along)
    for (let i = 1; i < south.length; i++) {
      expect(south[i].along - south[i].width / 2).toBeGreaterThan(south[i - 1].along + south[i - 1].width / 2)
    }
  })

  it('puts interior presets inside the footprint and below the roof', () => {
    const fp = plan.footprint
    expect(plan.presets.map(p => p.hotkey)).toEqual(['1', '2', '3', '4', '5', '6'])
    for (const p of plan.presets) {
      const [x, y, z] = p.position
      const inside = x > fp.minX && x < fp.maxX && z > fp.minZ && z < fp.maxZ
      expect(inside).toBe(p.interior)
      if (p.interior) expect(y).toBeLessThan(plan.heights.clear)
      expect(y).toBeGreaterThan(0)
    }
  })

  it('enters the building through the personnel door', () => {
    const door = plan.openings.find(o => o.kind === 'personnel')!
    const last = plan.entryPath[plan.entryPath.length - 1]
    const before = plan.entryPath[plan.entryPath.length - 2]
    expect(before.position[2]).toBeGreaterThan(plan.footprint.maxZ)
    expect(last.position[2]).toBeLessThan(plan.footprint.maxZ)
    expect(Math.abs(last.position[0] - door.along)).toBeLessThan(door.width / 2)
    expect(last.position[1]).toBeLessThan(door.height)
  })

  it('is deterministic for a seed', () => {
    expect(buildSitePlan(layout, 7).trees).toEqual(buildSitePlan(layout, 7).trees)
    expect(buildSitePlan(layout, 7).trees).not.toEqual(buildSitePlan(layout, 8).trees)
  })
})

describe('dock state', () => {
  const shipment = (status: Shipment['status'], dockId: string | null = 'D02'): Shipment => ({
    id: 'S', supplier: { id: 'X', name: 'X' }, vehicleType: 'container_truck', dockId, status,
    sku: null, qty: null, eta: null, milestones: [],
  })

  it('opens only for trucks that a shipment record places at the dock', () => {
    const dock = { ...layout.docks[1], status: 'available' as const }
    expect(isDockOpen(dock, [])).toBe(false)
    expect(isDockOpen(dock, [shipment('scheduled')])).toBe(false)
    expect(isDockOpen(dock, [shipment('arriving')])).toBe(false)
    expect(isDockOpen(dock, [shipment('at_dock')])).toBe(true)
    expect(isDockOpen(dock, [shipment('unloading')])).toBe(true)
    expect(isDockOpen(dock, [shipment('departed')])).toBe(false)
    expect(isDockOpen(dock, [shipment('unloading', 'D05')])).toBe(false)
    expect(isDockOpen({ ...dock, status: 'occupied' }, [])).toBe(true)
  })
})

describe('scene params', () => {
  it('parses seed, freeze and debug', () => {
    expect(parseSceneParams('?seed=42&freeze=1&debug')).toEqual({ seed: 42, freeze: true, debug: true })
    expect(parseSceneParams('')).toEqual({ seed: 42, freeze: false, debug: false })
    expect(parseSceneParams('?seed=abc').seed).toBe(42)
  })

  it('has a deterministic RNG', () => {
    const a = createRng(5)
    const b = createRng(5)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })
})
