import type { Dock, Shipment, WarehouseLayout, Zone, ZoneKind } from '../data/schemas'
import {
  APRON_DEPTH,
  COLUMN_SIZE,
  COLUMN_SPACING,
  DOCK_DOOR,
  EXIT_DOOR,
  GROUND_Y,
  PARAPET_HEIGHT,
  PERSONNEL_DOOR,
  TRUSS_DEPTH,
  TRUSS_SPACING,
  WALKWAY_WIDTH,
} from './constants'
import { rackWorldBounds, type Vec3 } from './layoutToWorld'
import { createRng } from './sceneParams'

// Everything the scene places that is not a layout record (yard, shell,
// markings, camera presets) is derived here from the layout, so components
// never hardcode coordinates.

export interface Rect {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export const rectW = (r: Rect) => r.maxX - r.minX
export const rectD = (r: Rect) => r.maxZ - r.minZ
export const rectCenter = (r: Rect): [number, number] => [(r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2]

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ
}

const inflate = (r: Rect, d: number): Rect => ({ minX: r.minX - d, maxX: r.maxX + d, minZ: r.minZ - d, maxZ: r.maxZ + d })

export type WallSide = 'north' | 'south' | 'east' | 'west'

export interface WallOpening {
  id: string
  side: WallSide
  /** Offset along the wall (world x for north/south, world z for east/west) */
  along: number
  width: number
  height: number
  /** Sill height above the floor slab */
  sill: number
  kind: 'dock' | 'personnel' | 'exit'
}

export type CameraPresetId = 'exterior' | 'docks' | 'receiving' | 'storage' | 'dispatch' | 'control'

export interface CameraPose {
  position: Vec3
  target: Vec3
}

export interface CameraPreset extends CameraPose {
  id: CameraPresetId
  label: string
  hotkey: string
  interior: boolean
}

export interface ParkingStall {
  x: number
  z: number
  rotationY: number
  width: number
  length: number
}

export interface SitePlan {
  footprint: Rect
  heights: { ground: number; clear: number; roof: number; parapetTop: number }
  site: Rect
  fence: { rect: Rect; gate: { x: number; z: number; width: number } }
  apron: Rect
  stagingYard: Rect
  stagingStalls: ParkingStall[]
  parking: Rect
  parkingStalls: ParkingStall[]
  driveway: Rect
  guardBooth: { x: number; z: number }
  lightPoles: { x: number; z: number }[]
  cctvPoles: { x: number; z: number; rotationY: number }[]
  lawns: Rect[]
  trees: { x: number; z: number; scale: number }[]
  hedges: { x: number; z: number; length: number; rotationY: number }[]
  openings: WallOpening[]
  columns: { x: number; z: number }[]
  pilasters: { x: number; z: number }[]
  trusses: number[]
  skylights: Rect[]
  lightStrips: { x: number; z: number; length: number }[]
  crossAisle: Rect | null
  walkways: Rect[]
  laneArrows: { x: number; z: number; rotationY: number }[]
  dockHatches: Rect[]
  presets: CameraPreset[]
  entryPath: CameraPose[]
}

const TRUCK_AT_DOCK = new Set<Shipment['status']>(['at_dock', 'unloading', 'loading'])

/** A dock door is open when a shipment record places a truck at it, or the dock record says occupied. */
export function isDockOpen(dock: Dock, shipments: readonly Shipment[]): boolean {
  return dock.status === 'occupied' || shipments.some(s => s.dockId === dock.id && TRUCK_AT_DOCK.has(s.status))
}

function zonesOfKind(layout: WarehouseLayout, kind: ZoneKind): Zone[] {
  return layout.zones.filter(z => z.kind === kind)
}

function zoneRect(z: Zone): Rect {
  return { minX: z.bounds.x, maxX: z.bounds.x + z.bounds.width, minZ: z.bounds.z, maxZ: z.bounds.z + z.bounds.depth }
}

function union(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null
  return rects.reduce((a, b) => ({
    minX: Math.min(a.minX, b.minX), maxX: Math.max(a.maxX, b.maxX),
    minZ: Math.min(a.minZ, b.minZ), maxZ: Math.max(a.maxZ, b.maxZ),
  }))
}

/** Rects that interior columns and walkways must avoid. */
export function obstacleRects(layout: WarehouseLayout): Rect[] {
  const racks = layout.racks.map(r => rackWorldBounds(layout, r))
  const aisles = layout.aisles.map(a => {
    const halfW = a.width / 2
    const halfL = a.length / 2
    return a.orientation === 'z'
      ? { minX: a.x - halfW, maxX: a.x + halfW, minZ: a.z - halfL, maxZ: a.z + halfL }
      : { minX: a.x - halfL, maxX: a.x + halfL, minZ: a.z - halfW, maxZ: a.z + halfW }
  })
  return [...racks, ...aisles]
}

function pickPersonnelDoorX(layout: WarehouseLayout, fp: Rect): number {
  // Midpoint of the widest gap between front-wall docks
  const xs = layout.docks.filter(d => d.side === 'south').map(d => d.x).sort((a, b) => a - b)
  const edges = [fp.minX + 4, ...xs, fp.maxX - 4]
  let best = { gap: -1, x: (fp.minX + fp.maxX) / 2 }
  for (let i = 0; i < edges.length - 1; i++) {
    const gap = edges[i + 1] - edges[i]
    if (gap > best.gap) best = { gap, x: (edges[i] + edges[i + 1]) / 2 }
  }
  return Math.round(best.x * 2) / 2
}

export function buildSitePlan(layout: WarehouseLayout, seed = 42): SitePlan {
  const { width: W, depth: D, height: H } = layout.building
  const fp: Rect = { minX: -W / 2, maxX: W / 2, minZ: -D / 2, maxZ: D / 2 }
  const roof = H + TRUSS_DEPTH
  const heights = { ground: GROUND_Y, clear: H, roof, parapetTop: roof + PARAPET_HEIGHT }
  const rng = createRng(seed)

  // ── Yard ──────────────────────────────────────────────
  const apron: Rect = { minX: fp.minX - 4, maxX: fp.maxX + 4, minZ: fp.maxZ, maxZ: fp.maxZ + APRON_DEPTH }
  const stagingYard: Rect = { minX: fp.minX - 36, maxX: fp.minX - 6, minZ: fp.maxZ + 4, maxZ: apron.maxZ }
  const stagingStalls: ParkingStall[] = []
  for (let x = stagingYard.minX + 2.5; x + 2 <= stagingYard.maxX; x += 4.6) {
    stagingStalls.push({ x, z: stagingYard.minZ + 11, rotationY: 0, width: 4.0, length: 20 })
  }
  const parking: Rect = { minX: fp.maxX + 8, maxX: fp.maxX + 34, minZ: fp.minZ + 6, maxZ: fp.maxZ - 2 }
  const parkingStalls: ParkingStall[] = []
  for (let row = 0; row < 2; row++) {
    const x = row === 0 ? parking.minX + 3 : parking.maxX - 3
    for (let z = parking.minZ + 1.6; z + 1.3 <= parking.maxZ; z += 2.6) {
      parkingStalls.push({ x, z, rotationY: Math.PI / 2, width: 2.5, length: 5.2 })
    }
  }
  const site: Rect = { minX: stagingYard.minX - 10, maxX: parking.maxX + 10, minZ: fp.minZ - 18, maxZ: apron.maxZ + 16 }
  const fenceRect = inflate(site, -2)
  const gate = { x: fp.minX + 12, z: fenceRect.maxZ, width: 14 }
  const driveway: Rect = { minX: gate.x - gate.width / 2, maxX: gate.x + gate.width / 2, minZ: apron.maxZ, maxZ: fenceRect.maxZ + 6 }
  const guardBooth = { x: gate.x + gate.width / 2 + 3.5, z: fenceRect.maxZ - 4 }

  const lightPoles: { x: number; z: number }[] = []
  for (let x = apron.minX + 6; x <= apron.maxX; x += 22) lightPoles.push({ x, z: apron.maxZ - 1.5 })
  for (let z = parking.minZ + 4; z <= parking.maxZ; z += 20) lightPoles.push({ x: (parking.minX + parking.maxX) / 2, z })
  lightPoles.push({ x: stagingYard.minX + 2, z: stagingYard.maxZ - 2 })

  const cctvPoles = [
    { x: apron.minX + 1, z: apron.maxZ - 1, rotationY: Math.PI * 0.75 },
    { x: apron.maxX - 1, z: apron.maxZ - 1, rotationY: -Math.PI * 0.75 },
    { x: guardBooth.x + 2.5, z: guardBooth.z - 1, rotationY: Math.PI },
    { x: fp.minX - 2, z: fp.minZ - 2, rotationY: Math.PI / 4 },
  ]

  const lawns: Rect[] = [
    { minX: fp.minX - 8, maxX: fp.maxX + 6, minZ: fenceRect.minZ + 1, maxZ: fp.minZ - 3 },
    { minX: stagingYard.minX, maxX: fp.minX - 3, minZ: fp.minZ - 3, maxZ: stagingYard.minZ - 2 },
    { minX: fp.maxX + 3, maxX: parking.minX - 2, minZ: fp.minZ - 3, maxZ: parking.maxZ },
  ]
  const trees: { x: number; z: number; scale: number }[] = []
  for (const lawn of lawns) {
    const count = Math.max(2, Math.floor(rectW(lawn) * rectD(lawn) / 140))
    for (let i = 0; i < count; i++) {
      trees.push({
        x: lawn.minX + 1.5 + rng() * (rectW(lawn) - 3),
        z: lawn.minZ + 1.5 + rng() * (rectD(lawn) - 3),
        scale: 0.8 + rng() * 0.5,
      })
    }
  }
  const hedges = [
    { x: (parking.minX + parking.maxX) / 2, z: parking.maxZ + 1.2, length: rectW(parking), rotationY: 0 },
    { x: parking.minX - 1.2, z: (parking.minZ + parking.maxZ) / 2, length: rectD(parking), rotationY: Math.PI / 2 },
  ]

  // ── Shell openings ────────────────────────────────────
  const openings: WallOpening[] = layout.docks.map(d => ({
    id: d.id,
    side: d.side,
    along: d.side === 'north' || d.side === 'south' ? d.x : d.z,
    width: DOCK_DOOR.width,
    height: DOCK_DOOR.height,
    sill: 0,
    kind: 'dock' as const,
  }))
  const personnelX = pickPersonnelDoorX(layout, fp)
  openings.push({ id: 'ENTRANCE', side: 'south', along: personnelX, width: PERSONNEL_DOOR.width, height: PERSONNEL_DOOR.height, sill: 0, kind: 'personnel' })
  openings.push(
    { id: 'EXIT-W', side: 'west', along: 0, width: EXIT_DOOR.width, height: EXIT_DOOR.height, sill: 0, kind: 'exit' },
    { id: 'EXIT-N1', side: 'north', along: fp.minX + W * 0.3, width: EXIT_DOOR.width, height: EXIT_DOOR.height, sill: 0, kind: 'exit' },
    { id: 'EXIT-N2', side: 'north', along: fp.minX + W * 0.7, width: EXIT_DOOR.width, height: EXIT_DOOR.height, sill: 0, kind: 'exit' },
    { id: 'EXIT-E', side: 'east', along: fp.maxZ - 10, width: EXIT_DOOR.width, height: EXIT_DOOR.height, sill: 0, kind: 'exit' },
  )

  // ── Structure ─────────────────────────────────────────
  const obstacles = obstacleRects(layout).map(r => inflate(r, 0.35))
  const doorLanes: Rect[] = openings.filter(o => o.side === 'south').map(o => ({
    minX: o.along - o.width / 2 - 1, maxX: o.along + o.width / 2 + 1, minZ: fp.maxZ - 8, maxZ: fp.maxZ,
  }))
  const columns: { x: number; z: number }[] = []
  for (let x = fp.minX + COLUMN_SPACING; x < fp.maxX - 1; x += COLUMN_SPACING) {
    for (let z = fp.minZ + COLUMN_SPACING; z < fp.maxZ - 1; z += COLUMN_SPACING) {
      const half = COLUMN_SIZE / 2
      const box = { minX: x - half, maxX: x + half, minZ: z - half, maxZ: z + half }
      if (![...obstacles, ...doorLanes].some(o => rectsOverlap(o, box))) columns.push({ x, z })
    }
  }
  const pilasters: { x: number; z: number }[] = []
  for (let x = fp.minX; x <= fp.maxX + 0.01; x += COLUMN_SPACING) {
    pilasters.push({ x, z: fp.minZ })
    if (!openings.some(o => o.side === 'south' && Math.abs(o.along - x) < o.width / 2 + 0.5)) pilasters.push({ x, z: fp.maxZ })
  }
  for (let z = fp.minZ + COLUMN_SPACING; z < fp.maxZ - 0.01; z += COLUMN_SPACING) {
    pilasters.push({ x: fp.minX, z }, { x: fp.maxX, z })
  }

  const trusses: number[] = []
  for (let x = fp.minX + TRUSS_SPACING; x < fp.maxX - 0.01; x += TRUSS_SPACING) trusses.push(x)

  const skylights: Rect[] = []
  for (let x = fp.minX + COLUMN_SPACING / 2; x < fp.maxX; x += COLUMN_SPACING) {
    skylights.push({ minX: x - 1.1, maxX: x + 1.1, minZ: fp.minZ + 4, maxZ: fp.maxZ - 4 })
  }
  const lightStrips: { x: number; z: number; length: number }[] = []
  for (let x = fp.minX + TRUSS_SPACING / 2; x < fp.maxX; x += TRUSS_SPACING) {
    for (let z = fp.minZ + 4; z < fp.maxZ - 3; z += 8) lightStrips.push({ x, z, length: 4.2 })
  }

  // ── Floor markings ────────────────────────────────────
  const storage = union(zonesOfKind(layout, 'storage').map(zoneRect))
  const front = union(['receiving', 'inspection', 'dispatch'].flatMap(k => zonesOfKind(layout, k as ZoneKind)).map(zoneRect))
  const crossAisle: Rect | null = storage && front && front.minZ > storage.maxZ
    ? { minX: fp.minX + 1, maxX: fp.maxX - 1, minZ: storage.maxZ, maxZ: front.minZ }
    : null

  const walkways: Rect[] = []
  if (crossAisle) {
    walkways.push({ minX: crossAisle.minX + 0.5, maxX: crossAisle.maxX - 0.5, minZ: crossAisle.maxZ - WALKWAY_WIDTH - 0.15, maxZ: crossAisle.maxZ - 0.15 })
    walkways.push({ minX: personnelX - WALKWAY_WIDTH / 2, maxX: personnelX + WALKWAY_WIDTH / 2, minZ: crossAisle.maxZ - 0.15, maxZ: fp.maxZ - 0.2 })
  }
  walkways.push({ minX: fp.minX + 0.4, maxX: fp.minX + 0.4 + WALKWAY_WIDTH, minZ: fp.minZ + 0.4, maxZ: (crossAisle?.maxZ ?? fp.maxZ) - 0.15 })

  const laneArrows: { x: number; z: number; rotationY: number }[] = []
  if (crossAisle) {
    const vehicleMid = (crossAisle.minZ + (crossAisle.maxZ - WALKWAY_WIDTH - 0.15)) / 2
    for (let x = crossAisle.minX + 6; x < crossAisle.maxX - 4; x += 12) {
      laneArrows.push({ x, z: vehicleMid - 0.7, rotationY: Math.PI / 2 }, { x: x + 6, z: vehicleMid + 0.7, rotationY: -Math.PI / 2 })
    }
  }
  const dockHatches: Rect[] = layout.docks.filter(d => d.side === 'south').map(d => ({
    minX: d.x - DOCK_DOOR.width / 2 - 0.3, maxX: d.x + DOCK_DOOR.width / 2 + 0.3, minZ: fp.maxZ - 2.6, maxZ: fp.maxZ - 0.2,
  }))

  // ── Cameras ───────────────────────────────────────────
  const zoneCenter = (kind: ZoneKind): [number, number] => {
    const r = union(zonesOfKind(layout, kind).map(zoneRect))
    return r ? rectCenter(r) : [0, 0]
  }
  const [rx, rz] = zoneCenter('receiving')
  const [dx, dz] = zoneCenter('dispatch')
  const [cx, cz] = zoneCenter('control')
  const firstStorage = zonesOfKind(layout, 'storage')[0]
  const storageAisles = firstStorage ? layout.aisles.filter(a => a.zoneId === firstStorage.id) : []
  const midAisle = storageAisles[Math.floor(storageAisles.length / 2)] ?? layout.aisles[0]
  const aisleFront = midAisle ? midAisle.z + midAisle.length / 2 : 0
  const southDocks = layout.docks.filter(d => d.side === 'south')
  const dockMid = southDocks.length ? (Math.min(...southDocks.map(d => d.x)) + Math.max(...southDocks.map(d => d.x))) / 2 : 0
  const clearCam = Math.min(H - 2.5, 9)

  const presets: CameraPreset[] = [
    { id: 'exterior', label: 'Exterior', hotkey: '1', interior: false, position: [fp.maxX + 52, 34, apron.maxZ + 40], target: [-4, 0, fp.maxZ * 0.25] },
    { id: 'docks', label: 'Docks', hotkey: '2', interior: false, position: [dockMid + 14, 17, fp.maxZ + 44], target: [dockMid, 0.5, fp.maxZ - 2] },
    { id: 'receiving', label: 'Receiving', hotkey: '3', interior: true, position: [rx + 10, clearCam - 1.5, rz - 14], target: [rx, 0.5, rz + 2] },
    { id: 'storage', label: 'Storage Aisles', hotkey: '4', interior: true, position: [midAisle ? midAisle.x + 0.6 : 0, clearCam, aisleFront + 4], target: [midAisle ? midAisle.x : 0, 1.5, aisleFront - 16] },
    { id: 'dispatch', label: 'Dispatch', hotkey: '5', interior: true, position: [dx - 10, clearCam - 1.5, dz - 14], target: [dx, 0.5, dz + 2] },
    { id: 'control', label: 'Control', hotkey: '6', interior: true, position: [cx - 9, clearCam - 3, cz + 7], target: [cx + 1, 1, cz] },
  ]

  // Exterior → personnel entrance → interior (doors are automatic sliding doors)
  const entryPath: CameraPose[] = [
    { position: [personnelX + 10, 4, fp.maxZ + 18], target: [personnelX, 1.2, fp.maxZ] },
    { position: [personnelX, 1.0, fp.maxZ + 6], target: [personnelX, 1.4, fp.maxZ - 6] },
    { position: [personnelX, 1.7, fp.maxZ - 4], target: [personnelX, 2.2, fp.maxZ - 24] },
  ]

  return {
    footprint: fp, heights, site, fence: { rect: fenceRect, gate }, apron, stagingYard, stagingStalls, parking, parkingStalls,
    driveway, guardBooth, lightPoles, cctvPoles, lawns, trees, hedges, openings, columns, pilasters, trusses, skylights,
    lightStrips, crossAisle, walkways, laneArrows, dockHatches, presets, entryPath,
  }
}
