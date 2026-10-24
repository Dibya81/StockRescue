import type { WarehouseLayout, Zone } from '../data/schemas'
import { WALL_THICKNESS } from './constants'
import { obstacleRects, rectsOverlap, type Rect, type SitePlan } from './sitePlan'
import { buildNavGraph, edgeCorridors } from './navGraph'

// Visual-only furniture for each zone, placed relative to the zone bounds.
// None of it represents data: no prop claims a live feed or holds stock.

export type PropKind =
  | 'scanStation' | 'palletStack'
  | 'inspectionTable' | 'qualityStation' | 'damagedArea' | 'quarantineCage'
  | 'packingTable' | 'wrapper'
  | 'charger' | 'maintenanceLift' | 'partsShelf'
  | 'workstation' | 'networkCabinet' | 'glassPartition'
  | 'extinguisher' | 'firstAid' | 'barrier' | 'floorLight' | 'zoneBanner'

export interface Prop {
  kind: PropKind
  x: number
  z: number
  rotationY: number
  /** Footprint (x, z before rotation); 0 for wall-mounted or overhead props */
  w: number
  d: number
  label?: string
}

/** Footprints used for placement and overlap checks */
export const PROP_SIZE: Partial<Record<PropKind, [number, number]>> = {
  scanStation: [0.8, 0.6],
  palletStack: [1.2, 0.8],
  inspectionTable: [2.4, 1.2],
  qualityStation: [1.8, 0.9],
  damagedArea: [4, 3],
  quarantineCage: [4, 3],
  packingTable: [2.2, 1.1],
  wrapper: [2.4, 2.4],
  maintenanceLift: [3, 2],
  partsShelf: [2.4, 0.6],
  workstation: [1.8, 0.9],
  networkCabinet: [0.8, 1.0],
}

const footprint = (p: Prop): Rect => {
  const swap = Math.abs(Math.sin(p.rotationY)) > 0.5
  const w = swap ? p.d : p.w
  const d = swap ? p.w : p.d
  return { minX: p.x - w / 2, maxX: p.x + w / 2, minZ: p.z - d / 2, maxZ: p.z + d / 2 }
}

const zoneRect = (z: Zone): Rect => ({ minX: z.bounds.x, maxX: z.bounds.x + z.bounds.width, minZ: z.bounds.z, maxZ: z.bounds.z + z.bounds.depth })

interface Placer {
  props: Prop[]
  /** Places the first candidate whose footprint is free; returns whether one fit */
  place: (kind: PropKind, candidates: [number, number][], rotationY?: number, label?: string) => boolean
}

function placer(blocked: Rect[]): Placer {
  const props: Prop[] = []
  const taken: Rect[] = [...blocked]
  return {
    props,
    place(kind, candidates, rotationY = 0, label) {
      const [w, d] = PROP_SIZE[kind] ?? [0.5, 0.5]
      for (const [x, z] of candidates) {
        const p: Prop = { kind, x, z, rotationY, w, d, label }
        const fp = footprint(p)
        if (taken.some(t => rectsOverlap(t, fp))) continue
        props.push(p)
        taken.push({ minX: fp.minX - 0.4, maxX: fp.maxX + 0.4, minZ: fp.minZ - 0.4, maxZ: fp.maxZ + 0.4 })
        return true
      }
      return false
    },
  }
}

/**
 * @param parkingBays floor points to keep clear (equipment home positions from data)
 */
export function buildZoneProps(layout: WarehouseLayout, plan: SitePlan, parkingBays: readonly { x: number; z: number }[] = []): Prop[] {
  const fp = plan.footprint
  const blocked: Rect[] = [
    ...obstacleRects(layout),
    ...plan.walkways,
    ...plan.dockHatches.map(h => ({ ...h, minZ: h.minZ - 3 })),
    ...parkingBays.map(b => ({ minX: b.x - 1.4, maxX: b.x + 1.4, minZ: b.z - 1.8, maxZ: b.z + 1.8 })),
    ...plan.columns.map(c => ({ minX: c.x - 0.6, maxX: c.x + 0.6, minZ: c.z - 0.6, maxZ: c.z + 0.6 })),
  ]
  if (plan.crossAisle) blocked.push(plan.crossAisle)
  // Keep every vehicle route clear (storage aisles are already blocked as obstacles)
  const graph = buildNavGraph(layout, plan, parkingBays.map((b, i) => ({ id: `bay-${i}`, x: b.x, z: b.z })))
  blocked.push(...edgeCorridors(graph).filter(r => !layout.aisles.some(a => Math.abs((r.minX + r.maxX) / 2 - a.x) < 0.01)))
  const P = placer(blocked)
  const overhead: Prop[] = []

  for (const zone of layout.zones) {
    const r = zoneRect(zone)
    const { x, z, width: w, depth: d } = zone.bounds
    const cx = x + w / 2
    const grid = (cols: number, rows: number, inset = 1.6): [number, number][] => {
      const pts: [number, number][] = []
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          pts.push([x + inset + (w - 2 * inset) * (cols === 1 ? 0.5 : i / (cols - 1)), z + inset + (d - 2 * inset) * (rows === 1 ? 0.5 : j / (rows - 1))])
        }
      }
      return pts
    }

    overhead.push({ kind: 'zoneBanner', x: cx, z: z + d / 2, rotationY: 0, w: 0, d: 0, label: zone.name.toUpperCase() })

    switch (zone.kind) {
      case 'receiving':
        P.place('scanStation', grid(5, 3, 2))
        P.place('scanStation', grid(5, 3, 2).reverse())
        P.place('palletStack', grid(4, 3, 1.2))
        P.place('palletStack', grid(4, 3, 1.2).slice(1))
        break
      case 'inspection':
        P.place('inspectionTable', grid(4, 3, 2))
        P.place('inspectionTable', grid(4, 3, 2).slice(2))
        P.place('qualityStation', grid(4, 3, 2).reverse())
        P.place('damagedArea', grid(3, 2, 2.6), 0, 'DAMAGED GOODS')
        P.place('quarantineCage', grid(3, 2, 2.6).reverse(), 0, 'QUARANTINE')
        break
      case 'dispatch':
        P.place('packingTable', grid(4, 3, 2))
        P.place('packingTable', grid(4, 3, 2).slice(1))
        P.place('packingTable', grid(4, 3, 2).slice(2))
        P.place('wrapper', grid(3, 2, 2).reverse())
        break
      case 'equipment': {
        // Chargers along the zone's rear edge, maintenance lift and parts shelving
        for (let i = 0; i < 3; i++) {
          overhead.push({ kind: 'charger', x: x + w * (0.25 + i * 0.25), z: Math.max(r.minZ + 0.35, fp.minZ + WALL_THICKNESS / 2 + 0.2), rotationY: 0, w: 0, d: 0 })
        }
        P.place('maintenanceLift', grid(3, 4, 1.8).reverse())
        P.place('partsShelf', grid(2, 4, 1.4).reverse(), Math.PI / 2)
        break
      }
      case 'control': {
        // Glass partition on the three interior sides, door gap on the west side
        const t = 0.06
        overhead.push(
          { kind: 'glassPartition', x: cx, z: r.minZ, rotationY: 0, w: w, d: t },
          { kind: 'glassPartition', x: cx, z: r.maxZ, rotationY: 0, w: w, d: t },
          { kind: 'glassPartition', x: r.minX, z: z + d * 0.3, rotationY: Math.PI / 2, w: d * 0.6, d: t },
        )
        for (const pt of grid(2, 2, 2.2)) P.place('workstation', [pt], Math.PI)
        P.place('networkCabinet', [[r.maxX - 0.9, r.minZ + 1], [r.maxX - 0.9, r.maxZ - 1]])
        break
      }
      default:
        break
    }
  }

  // Extinguishers on the inside of the walls, clear of openings
  const inset = WALL_THICKNESS / 2 + 0.18
  const clearOfOpenings = (side: string, along: number) =>
    !plan.openings.some(o => o.side === side && Math.abs(o.along - along) < o.width / 2 + 1)
  for (let ax = fp.minX + 9; ax < fp.maxX - 4; ax += 18) {
    if (clearOfOpenings('north', ax)) overhead.push({ kind: 'extinguisher', x: ax, z: fp.minZ + inset, rotationY: 0, w: 0, d: 0 })
    if (clearOfOpenings('south', ax)) overhead.push({ kind: 'extinguisher', x: ax, z: fp.maxZ - inset, rotationY: Math.PI, w: 0, d: 0 })
  }
  for (let az = fp.minZ + 9; az < fp.maxZ - 4; az += 18) {
    if (clearOfOpenings('west', az)) overhead.push({ kind: 'extinguisher', x: fp.minX + inset, z: az, rotationY: Math.PI / 2, w: 0, d: 0 })
    if (clearOfOpenings('east', az)) overhead.push({ kind: 'extinguisher', x: fp.maxX - inset, z: az, rotationY: -Math.PI / 2, w: 0, d: 0 })
  }

  // First aid beside the personnel entrance; barriers along its walkway
  const door = plan.openings.find(o => o.kind === 'personnel')
  if (door) {
    overhead.push({ kind: 'firstAid', x: door.along + door.width / 2 + 1.6, z: fp.maxZ - inset, rotationY: Math.PI, w: 0, d: 0 })
    const leg = plan.walkways.find(wk => wk.maxX - wk.minX < 2 && Math.abs((wk.minX + wk.maxX) / 2 - door.along) < 0.5)
    if (leg) {
      const len = leg.maxZ - leg.minZ - 4
      for (const sx of [leg.minX - 0.15, leg.maxX + 0.15]) {
        overhead.push({ kind: 'barrier', x: sx, z: leg.minZ + 2 + len / 2, rotationY: Math.PI / 2, w: len, d: 0.1 })
      }
    }
  }

  // Blue floor warning lights at every aisle mouth
  for (const a of layout.aisles) {
    const mouth = a.orientation === 'z' ? { x: a.x, z: a.z + a.length / 2 + 0.6 } : { x: a.x + a.length / 2 + 0.6, z: a.z }
    for (const s of [-1, 1]) {
      overhead.push({ kind: 'floorLight', x: mouth.x + (a.orientation === 'z' ? s * (a.width / 2 - 0.2) : 0), z: mouth.z + (a.orientation === 'z' ? 0 : s * (a.width / 2 - 0.2)), rotationY: 0, w: 0, d: 0 })
    }
  }

  return [...P.props, ...overhead]
}
