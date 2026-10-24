import { beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { InventoryLot, WarehouseLayout } from '../data/schemas'
import { indexLotsByPosition } from '../data/layoutGeometry'
import { SCENARIOS } from '../scenarios'
import { rackHeight, rackWorldBounds } from '../world/layoutToWorld'
import { rackPartMatrices, UPRIGHT_OVERRUN } from '../world/rackParts'
import {
  buildInventoryScene,
  FLAGGED_STATUSES,
  instancePositionIds,
  LOAD_KINDS,
  lotLoadKind,
  MAX_LOAD_HEIGHT,
  stackFill,
} from '../world/inventoryLayout'
import { frameDock, frameFloorPoint, frameLevel, framePoints, framePosition, frameRack } from '../world/framing'
import { buildSitePlan, obstacleRects, rectsOverlap, type SitePlan } from '../world/sitePlan'
import { buildZoneProps, PROP_SIZE } from '../world/zoneProps'

let layout: WarehouseLayout
let lots: InventoryLot[]
let plan: SitePlan

beforeAll(async () => {
  const s = await SCENARIOS[0].load()
  layout = s.initialState.layout
  lots = s.initialState.inventory
  plan = buildSitePlan(layout, 42)
})

const lot = (o: Partial<InventoryLot>): InventoryLot => ({
  lotId: 'L', sku: 'SKU', description: null, positionId: 'A01-R01-L01-P01', qty: 5, unit: 'pcs',
  status: 'in_stock', reorderPoint: null, lastUpdated: '2026-10-24T08:00:00Z', source: 'simulated', ...o,
})

const posOf = (m: THREE.Matrix4) => new THREE.Vector3().setFromMatrixPosition(m)

describe('rack parts', () => {
  it('builds four uprights, two beams per level and end guards per run', () => {
    const parts = rackPartMatrices(layout)
    expect(parts.upright).toHaveLength(layout.racks.length * 4)
    expect(parts.beam).toHaveLength(layout.racks.reduce((n, r) => n + r.levels * 2, 0))
    expect(parts.endGuard).toHaveLength(new Set(layout.racks.map(r => `${r.aisleId}:${r.side}`)).size)
    expect(parts.brace.length).toBeGreaterThan(layout.racks.length * 4)
  })

  it('keeps uprights and beams inside each rack footprint', () => {
    const parts = rackPartMatrices(layout)
    layout.racks.forEach((rack, i) => {
      const b = rackWorldBounds(layout, rack)
      for (const m of parts.upright.slice(i * 4, i * 4 + 4)) {
        const p = posOf(m)
        expect(p.x).toBeGreaterThanOrEqual(b.minX - 1e-6)
        expect(p.x).toBeLessThanOrEqual(b.maxX + 1e-6)
        expect(p.z).toBeGreaterThanOrEqual(b.minZ - 1e-6)
        expect(p.z).toBeLessThanOrEqual(b.maxZ + 1e-6)
        expect(p.y * 2).toBeCloseTo(rackHeight(rack) + UPRIGHT_OVERRUN)
      }
    })
  })
})

describe('inventory instances', () => {
  it('chooses packaging from unit and SKU family', () => {
    expect(lotLoadKind({ unit: 'reel', sku: 'CBL-4C-2.5' })).toBe('reel')
    expect(lotLoadKind({ unit: 'pail', sku: 'LUB-GRS-EP2' })).toBe('drum')
    expect(lotLoadKind({ unit: 'sheet', sku: 'STL-PLT-10MM' })).toBe('steel')
    expect(lotLoadKind({ unit: 'pcs', sku: 'STL-BEAM-IPE200' })).toBe('steel')
    expect(lotLoadKind({ unit: 'pcs', sku: 'STL-ASM-FRAME-220' })).toBe('carton')
    expect(lotLoadKind({ unit: 'box', sku: 'FST-M12-8.8' })).toBe('tote')
    expect(lotLoadKind({ unit: 'pcs', sku: 'MTR-7.5KW-IE3' })).toBe('carton')
  })

  it('shapes stacks by status, never by an invented quantity', () => {
    expect(stackFill('in_stock')).toBe(1)
    expect(stackFill('low_stock')).toBeLessThan(stackFill('in_stock'))
    expect(stackFill('shortage')).toBeLessThan(stackFill('low_stock'))
    expect(stackFill('incoming')).toBe(0)
    expect(stackFill('empty')).toBe(0)
  })

  it('renders exactly one load or ghost per occupied position and nothing for empty ones', () => {
    const scene = buildInventoryScene(layout, lots)
    const occupied = new Set(lots.filter(l => l.positionId).map(l => l.positionId))
    const loads = LOAD_KINDS.flatMap(k => scene.loads[k])
    expect(loads.length + scene.incoming.length).toBe(occupied.size)
    expect(scene.byPosition.size).toBe(occupied.size)
    expect(scene.pallets).toHaveLength(loads.length)
    // Empty positions have no instance
    expect(scene.byPosition.has('A06-R05-L01-P01')).toBe(false)
    for (const l of loads) {
      expect(l.height).toBeGreaterThan(0)
      expect(l.height).toBeLessThanOrEqual(MAX_LOAD_HEIGHT)
    }
  })

  it('maps instance ids back to the right positions and lots', () => {
    const scene = buildInventoryScene(layout, lots)
    const { byPosition } = indexLotsByPosition(lots)
    for (const kind of LOAD_KINDS) {
      const ids = instancePositionIds(scene.loads[kind])
      ids.forEach((pid, i) => {
        expect(scene.loads[kind][i].positionId).toBe(pid)
        const expected = byPosition.get(pid)!.map(l => l.lotId).sort()
        expect([...scene.loads[kind][i].lotIds].sort()).toEqual(expected)
      })
    }
  })

  it('draws incoming positions as ghosts with a flag, and rolls up mixed lots', () => {
    const scene = buildInventoryScene(layout, [
      lot({ lotId: 'a', positionId: 'A01-R01-L01-P01', status: 'incoming', qty: 0 }),
      lot({ lotId: 'b', positionId: 'A01-R01-L01-P02', status: 'in_stock' }),
      lot({ lotId: 'c', positionId: 'A01-R01-L01-P02', status: 'quarantine', qty: 50 }),
      lot({ lotId: 'd', positionId: null }),
      lot({ lotId: 'e', positionId: 'A99-R01-L01-P01' }),
    ])
    expect(scene.incoming.map(i => i.positionId)).toEqual(['A01-R01-L01-P01'])
    const mixed = scene.byPosition.get('A01-R01-L01-P02')
    expect(mixed && 'status' in mixed ? mixed.status : null).toBe('quarantine')
    expect(scene.flags.map(f => f.status).sort()).toEqual(['incoming', 'quarantine'])
    expect(scene.unplaced.map(l => l.lotId).sort()).toEqual(['d', 'e'])
    expect(FLAGGED_STATUSES).not.toContain('in_stock')
  })
})

describe('camera framing', () => {
  const insideFootprint = (p: number[]) =>
    p[0] > plan.footprint.minX && p[0] < plan.footprint.maxX && p[2] > plan.footprint.minZ && p[2] < plan.footprint.maxZ

  it('frames racks, levels and positions from inside the aisle, below the roof', () => {
    const racks = layout.racks.map(r => rackWorldBounds(layout, r))
    for (const rack of layout.racks) {
      for (const pose of [frameRack(layout, rack), frameLevel(layout, rack, 2), framePosition(layout, `${rack.id}-L02-P02`)!]) {
        expect(insideFootprint(pose.position)).toBe(true)
        expect(pose.position[1]).toBeGreaterThan(0.5)
        expect(pose.position[1]).toBeLessThan(plan.heights.clear)
        const [x, , z] = pose.position
        expect(racks.some(b => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ)).toBe(false)
      }
    }
  })

  it('frames many points from above with the roof cut away', () => {
    const pose = framePoints([[-20, 1, -10], [15, 1, 0]], plan)!
    expect(pose.cutaway).toBe(true)
    expect(pose.position[1]).toBeGreaterThan(plan.heights.roof)
    expect(framePoints([], plan)).toBeNull()
  })

  it('frames docks from the yard and floor points from inside', () => {
    const pose = frameDock(layout, layout.docks[0])!
    expect(pose.position[2]).toBeGreaterThan(plan.footprint.maxZ)
    const inside = frameFloorPoint(30, -12, plan)
    expect(insideFootprint(inside.position)).toBe(true)
  })
})

describe('zone props', () => {
  it('places furniture without blocking racks, aisles, walkways or parking bays', () => {
    const bays = [{ x: 28, z: -20 }, { x: 30.5, z: -16 }]
    const props = buildZoneProps(layout, plan, bays)
    const obstacles = [...obstacleRects(layout), ...plan.walkways]
    const floorProps = props.filter(p => PROP_SIZE[p.kind])
    expect(floorProps.length).toBeGreaterThan(10)
    for (const p of floorProps) {
      const box = { minX: p.x - p.w / 2, maxX: p.x + p.w / 2, minZ: p.z - p.d / 2, maxZ: p.z + p.d / 2 }
      expect(obstacles.some(o => rectsOverlap(o, box))).toBe(false)
      for (const b of bays) expect(Math.hypot(p.x - b.x, p.z - b.z)).toBeGreaterThan(1)
    }
    const kinds = new Set(props.map(p => p.kind))
    for (const k of ['scanStation', 'quarantineCage', 'packingTable', 'workstation', 'extinguisher', 'zoneBanner', 'floorLight'] as const) {
      expect(kinds.has(k)).toBe(true)
    }
  })
})
