import type { WarehouseLayout } from '../data/schemas'
import { layoutToWorld } from './layoutToWorld'
import type { Rect, SitePlan } from './sitePlan'

// Waypoint graph for vehicles: aisle centre lines, the cross-aisle vehicle
// lane, dock approaches, zone service points and equipment parking bays.
// Edges only run where floor is open, so routes never cut through racks.

export interface NavNode {
  id: string
  x: number
  z: number
}

export interface NavGraph {
  nodes: Map<string, NavNode>
  adj: Map<string, Set<string>>
}

export const homeNodeId = (equipmentId: string) => `home:${equipmentId}`
export const dockNodeId = (dockId: string) => `dock:${dockId}`
export const zoneNodeId = (zoneId: string) => `zone:${zoneId}`

function addNode(g: NavGraph, id: string, x: number, z: number) {
  if (!g.nodes.has(id)) {
    g.nodes.set(id, { id, x, z })
    g.adj.set(id, new Set())
  }
  return id
}

function link(g: NavGraph, a: string, b: string) {
  if (a === b) return
  g.adj.get(a)?.add(b)
  g.adj.get(b)?.add(a)
}

/** Connects nodes that lie on one straight line, in order along it. */
function chain(g: NavGraph, ids: string[], key: (n: NavNode) => number) {
  const sorted = ids.map(id => g.nodes.get(id)!).sort((a, b) => key(a) - key(b))
  for (let i = 1; i < sorted.length; i++) link(g, sorted[i - 1].id, sorted[i].id)
}

export interface NavHome {
  id: string
  x: number
  z: number
}

/** Vehicle lane z inside the cross aisle (south of it is the pedestrian walkway). */
export function vehicleLaneZ(plan: SitePlan): number | null {
  if (!plan.crossAisle) return null
  const walkwayTop = plan.crossAisle.maxZ - 1.35
  return (plan.crossAisle.minZ + walkwayTop) / 2
}

/** The x of the spine corridor that links the equipment zone to the lane. */
export function equipmentSpineX(layout: WarehouseLayout): number | null {
  const zone = layout.zones.find(z => z.kind === 'equipment')
  return zone ? zone.bounds.x - 1 : null
}

export function buildNavGraph(layout: WarehouseLayout, plan: SitePlan, homes: readonly NavHome[]): NavGraph {
  const g: NavGraph = { nodes: new Map(), adj: new Map() }
  const laneZ = vehicleLaneZ(plan)
  const fp = plan.footprint
  if (laneZ == null) return g

  const lane: string[] = []
  const laneNode = (x: number) => {
    const id = addNode(g, `lane:${x.toFixed(2)}`, x, laneZ)
    if (!lane.includes(id)) lane.push(id)
    return id
  }
  laneNode(fp.minX + 3)
  laneNode(fp.maxX - 3)

  // Aisles: mouth → each bay, along the centre line
  for (const a of layout.aisles) {
    if (a.orientation !== 'z') continue
    const front = a.z + a.length / 2
    const mouth = addNode(g, `aisle:${a.id}:mouth`, a.x, front + 1)
    link(g, mouth, laneNode(a.x))
    const bays = [...new Set(layout.racks.filter(r => r.aisleId === a.id).map(r => r.z.toFixed(2)))].map(Number)
    const ids = [mouth, ...bays.map(z => addNode(g, `aisle:${a.id}:${z.toFixed(2)}`, a.x, z))]
    chain(g, ids, n => -n.z)
  }

  // Dock approaches inside each door, straight up to the lane
  for (const d of layout.docks) {
    if (d.side !== 'south') continue
    const id = addNode(g, dockNodeId(d.id), d.x, fp.maxZ - 3.2)
    link(g, id, laneNode(d.x))
  }

  // Zone service points on the lane side of front zones
  for (const z of layout.zones) {
    if (z.kind === 'storage' || z.kind === 'equipment' || z.kind === 'control') continue
    const cx = z.bounds.x + z.bounds.width / 2
    const zz = z.bounds.z > laneZ ? z.bounds.z + 2.2 : z.bounds.z + z.bounds.depth - 2.2
    const id = addNode(g, zoneNodeId(z.id), cx, zz)
    link(g, id, laneNode(cx))
  }

  // Equipment bays: home → its front lane → spine → vehicle lane
  const spineX = equipmentSpineX(layout)
  if (spineX != null) {
    const spineTop = laneNode(spineX)
    const spine: string[] = [spineTop]
    const rows = new Map<string, string[]>()
    for (const h of homes) {
      const home = addNode(g, homeNodeId(h.id), h.x, h.z)
      const fz = h.z + 2
      const front = addNode(g, `bay:${h.id}`, h.x, fz)
      link(g, home, front)
      const key = fz.toFixed(2)
      const row = rows.get(key) ?? []
      row.push(front)
      rows.set(key, row)
    }
    for (const [key, row] of rows) {
      const s = addNode(g, `spine:${key}`, spineX, Number(key))
      spine.push(s)
      chain(g, [s, ...row], n => n.x)
    }
    chain(g, spine, n => n.z)
  }

  chain(g, lane, n => n.x)
  return g
}

const dist = (a: NavNode, b: NavNode) => Math.hypot(a.x - b.x, a.z - b.z)

/** A* shortest path between two node ids; null if unreachable. */
export function findPath(g: NavGraph, from: string, to: string): string[] | null {
  const goal = g.nodes.get(to)
  if (!g.nodes.has(from) || !goal) return null
  const open = new Set([from])
  const came = new Map<string, string>()
  const gScore = new Map([[from, 0]])
  const f = new Map([[from, dist(g.nodes.get(from)!, goal)]])
  while (open.size) {
    let cur = ''
    let best = Infinity
    for (const id of open) {
      const v = f.get(id) ?? Infinity
      if (v < best) { best = v; cur = id }
    }
    if (cur === to) {
      const path = [cur]
      while (came.has(path[0])) path.unshift(came.get(path[0])!)
      return path
    }
    open.delete(cur)
    for (const nb of g.adj.get(cur) ?? []) {
      const t = (gScore.get(cur) ?? Infinity) + dist(g.nodes.get(cur)!, g.nodes.get(nb)!)
      if (t < (gScore.get(nb) ?? Infinity)) {
        came.set(nb, cur)
        gScore.set(nb, t)
        f.set(nb, t + dist(g.nodes.get(nb)!, goal))
        open.add(nb)
      }
    }
  }
  return null
}

/** The aisle node a vehicle stops at to serve a rack position. */
export function positionServiceNode(layout: WarehouseLayout, g: NavGraph, positionId: string): string | null {
  const rack = layout.racks.find(r => r.id === positionId.slice(0, 7))
  if (!rack) return null
  const id = `aisle:${rack.aisleId}:${rack.z.toFixed(2)}`
  return g.nodes.has(id) ? id : null
}

/** World point of the rack face a vehicle at the service node works on. */
export function positionFacePoint(layout: WarehouseLayout, positionId: string): [number, number] | null {
  const t = layoutToWorld(layout, positionId)
  return t ? [t.position[0], t.position[2]] : null
}

export function edgeList(g: NavGraph): [NavNode, NavNode][] {
  const out: [NavNode, NavNode][] = []
  for (const [a, set] of g.adj) {
    for (const b of set) if (a < b) out.push([g.nodes.get(a)!, g.nodes.get(b)!])
  }
  return out
}

/** Segment–rectangle intersection (Liang–Barsky clip). */
export function segmentHitsRect(a: { x: number; z: number }, b: { x: number; z: number }, r: Rect): boolean {
  let t0 = 0
  let t1 = 1
  const dx = b.x - a.x
  const dz = b.z - a.z
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0
    const t = q / p
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t }
    else { if (t < t0) return false; if (t < t1) t1 = t }
    return true
  }
  return clip(-dx, a.x - r.minX) && clip(dx, r.maxX - a.x) && clip(-dz, a.z - r.minZ) && clip(dz, r.maxZ - a.z) && t0 < t1
}

/** Clearance rectangles around every edge; furniture must stay out of them. */
export function edgeCorridors(g: NavGraph, halfWidth = 1.3): Rect[] {
  return edgeList(g).map(([a, b]) => ({
    minX: Math.min(a.x, b.x) - halfWidth,
    maxX: Math.max(a.x, b.x) + halfWidth,
    minZ: Math.min(a.z, b.z) - halfWidth,
    maxZ: Math.max(a.z, b.z) + halfWidth,
  }))
}
