import type { Equipment, EquipmentType, Shipment, WarehouseLayout } from '../data/schemas'
import { levelY } from './layoutToWorld'
import {
  dockNodeId,
  findPath,
  homeNodeId,
  positionFacePoint,
  positionServiceNode,
  zoneNodeId,
  type NavGraph,
} from './navGraph'
import type { SitePlan } from './sitePlan'

// Poses are derived from the current records, never replayed from events:
// the same state and elapsed time always give the same pose, so a reload
// mid-task shows the vehicle where the task says it is.

export type Pt = [number, number]

export interface Route {
  points: Pt[]
  /** Heading to face at the end (towards the rack face, dock or station) */
  finalHeading: number | null
  /** Fork/platform height to raise to at the work point */
  liftY: number | null
}

export interface EquipmentPose {
  x: number
  z: number
  heading: number
  lift: number
  /** Metres travelled along the route, for wheel rotation */
  travelled: number
  phase: 'parked' | 'travel' | 'working'
  speed: number
}

/** Travel speed in m/s by equipment type (indoor limits). */
export const EQUIPMENT_SPEED: Record<EquipmentType, number> = {
  forklift: 2.2,
  reach_truck: 1.8,
  electric_pallet_jack: 1.5,
  manual_pallet_jack: 1.1,
  order_picker: 1.6,
  trolley: 1.1,
  scissor_lift: 0.8,
  conveyor: 0,
}

/** Equipment that moves along the graph (the conveyor is fixed) */
export const MOBILE = (t: EquipmentType) => t !== 'conveyor'

const LIFTERS = new Set<EquipmentType>(['forklift', 'reach_truck', 'order_picker', 'scissor_lift'])

/** Where the current task sends this unit; parked units route to their bay only. */
export function equipmentRoute(eq: Equipment, layout: WarehouseLayout, g: NavGraph): Route {
  const home: Pt = [eq.home.x, eq.home.z]
  const task = eq.currentTask
  if (eq.status !== 'active' || !task || !MOBILE(eq.type)) return { points: [home], finalHeading: null, liftY: null }

  // A return leg drives from where the previous task ended back to the bay
  if (task.kind === 'return') {
    const from = task.fromPositionId ? positionServiceNode(layout, g, task.fromPositionId)
      : task.dockId ? dockNodeId(task.dockId)
      : task.zoneId ? zoneNodeId(task.zoneId) : null
    const back = from ? findPath(g, from, homeNodeId(eq.id)) : null
    if (!back) return { points: [home], finalHeading: null, liftY: null }
    return { points: back.map(id => [g.nodes.get(id)!.x, g.nodes.get(id)!.z] as Pt), finalHeading: Math.PI, liftY: null }
  }

  let target: string | null = null
  let facePoint: Pt | null = null
  let liftY: number | null = null
  const pos = task.toPositionId ?? task.fromPositionId
  if (pos) {
    target = positionServiceNode(layout, g, pos)
    facePoint = positionFacePoint(layout, pos)
    const rack = layout.racks.find(r => r.id === pos.slice(0, 7))
    const level = Number(pos.split('-L')[1]?.slice(0, 2))
    if (rack && level && LIFTERS.has(eq.type)) liftY = levelY(rack, level) + 0.05
  } else if (task.dockId) {
    target = dockNodeId(task.dockId)
    const d = layout.docks.find(x => x.id === task.dockId)
    if (d) facePoint = [d.x, d.z]
  } else if (task.zoneId) {
    target = zoneNodeId(task.zoneId)
  }
  const ids = target ? findPath(g, homeNodeId(eq.id), target) : null
  if (!ids) return { points: [home], finalHeading: null, liftY: null }
  const points = ids.map(id => {
    const n = g.nodes.get(id)!
    return [n.x, n.z] as Pt
  })
  const end = points[points.length - 1]
  return {
    points,
    finalHeading: facePoint ? Math.atan2(facePoint[0] - end[0], facePoint[1] - end[1]) : null,
    liftY,
  }
}

export function routeLength(points: readonly Pt[]): number {
  let L = 0
  for (let i = 1; i < points.length; i++) L += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
  return L
}

/** Point and tangent heading at distance d along a polyline. */
export function pointAlong(points: readonly Pt[], d: number): { x: number; z: number; heading: number } {
  if (points.length === 1) return { x: points[0][0], z: points[0][1], heading: 0 }
  let rest = Math.max(0, d)
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1]
    const [bx, bz] = points[i]
    const len = Math.hypot(bx - ax, bz - az)
    const heading = Math.atan2(bx - ax, bz - az)
    if (rest <= len || i === points.length - 1) {
      const t = len > 0 ? Math.min(1, rest / len) : 1
      return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, heading }
    }
    rest -= len
  }
  const last = points[points.length - 1]
  return { x: last[0], z: last[1], heading: 0 }
}

const LIFT_SECONDS = 2.5

/**
 * @param elapsed seconds since the task started, or null when unknown
 *   (e.g. the page loaded mid-task): the unit is then shown at its work point.
 */
export function equipmentPose(eq: Equipment, route: Route, elapsed: number | null): EquipmentPose {
  const total = routeLength(route.points)
  const speed = EQUIPMENT_SPEED[eq.type]
  if (route.points.length === 1 || speed === 0) {
    const [x, z] = route.points[0]
    return { x, z, heading: Math.PI, lift: 0, travelled: 0, phase: 'parked', speed: 0 }
  }
  const e = elapsed == null ? Infinity : Math.max(0, elapsed)
  const travelled = Math.min(total, e * speed)
  const p = pointAlong(route.points, travelled)
  if (travelled < total) return { x: p.x, z: p.z, heading: p.heading, lift: 0, travelled, phase: 'travel', speed }
  const sinceArrival = e === Infinity ? Infinity : e - total / speed
  const liftT = Math.min(1, sinceArrival / LIFT_SECONDS)
  return {
    x: p.x,
    z: p.z,
    heading: route.finalHeading ?? p.heading,
    lift: (route.liftY ?? 0) * liftT,
    travelled: total,
    phase: 'working',
    speed: 0,
  }
}

// ── Trucks ───────────────────────────────────────────────

export const TRUCK_LENGTH: Record<Shipment['vehicleType'], number> = {
  delivery_truck: 7.5,
  trailer_truck: 19.5,
  container_truck: 17.5,
}

export interface TruckPose {
  x: number
  z: number
  /** Heading of the cab (direction it faces) */
  heading: number
  doorsOpen: boolean
  reversing: boolean
  travelled: number
  phase: 'arriving' | 'docked'
}

/** Gate → turning point on the apron → reverse into the bay. */
export function truckRoute(shipment: Shipment, layout: WarehouseLayout, plan: SitePlan): { forward: Pt[]; reverse: Pt[] } | null {
  const dock = layout.docks.find(d => d.id === shipment.dockId)
  if (!dock) return null
  const L = TRUCK_LENGTH[shipment.vehicleType]
  const gate = plan.fence.gate
  const bayZ = plan.footprint.maxZ + L / 2 + 0.35
  const pivot: Pt = [dock.x + L * 0.75, Math.min(plan.apron.maxZ - 3, bayZ + L * 0.7)]
  return {
    forward: [[gate.x, gate.z + 4], [gate.x, plan.apron.maxZ - 4], pivot],
    reverse: [pivot, [dock.x, pivot[1] - 2], [dock.x, bayZ]],
  }
}

const TRUCK_SPEED = 5

/**
 * Trucks exist only while a shipment record puts them in the yard:
 * Arriving drives in, At dock / Unloading / Loading sits in the bay.
 */
export function truckPose(shipment: Shipment, layout: WarehouseLayout, plan: SitePlan, elapsed: number | null): TruckPose | null {
  if (!['arriving', 'at_dock', 'unloading', 'loading'].includes(shipment.status)) return null
  const route = truckRoute(shipment, layout, plan)
  if (!route) return null
  if (shipment.status !== 'arriving') {
    const [x, z] = route.reverse[route.reverse.length - 1]
    return { x, z, heading: 0, doorsOpen: shipment.status === 'unloading' || shipment.status === 'loading', reversing: false, travelled: 0, phase: 'docked' }
  }
  const fwd = routeLength(route.forward)
  const rev = routeLength(route.reverse)
  // Unknown elapsed: shown waiting at the turning point, ready to reverse
  const d = elapsed == null ? fwd : Math.min(fwd + rev, Math.max(0, elapsed) * TRUCK_SPEED)
  if (d <= fwd) {
    const p = pointAlong(route.forward, d)
    return { x: p.x, z: p.z, heading: p.heading, doorsOpen: false, reversing: false, travelled: d, phase: 'arriving' }
  }
  const p = pointAlong(route.reverse, d - fwd)
  // Reversing: the cab faces away from the direction of travel
  return { x: p.x, z: p.z, heading: p.heading + Math.PI, doorsOpen: false, reversing: true, travelled: d, phase: 'arriving' }
}

// ── Workers ──────────────────────────────────────────────

export type WorkerRole = 'operator' | 'dock_staff' | 'inspector' | 'ambient'
export type WorkerActivity = 'drive' | 'stand' | 'push' | 'scan' | 'carry' | 'inspect' | 'walk' | 'idle'

export interface WorkerSpec {
  id: string
  role: WorkerRole
  activity: WorkerActivity
  /** Rides on / walks with this equipment */
  equipmentId?: string
  x: number
  z: number
  heading: number
  /** Walking loop for ambient staff */
  loop?: Pt[]
  /** Short provenance note for the inspector */
  source: string
}

const RIDE = new Set<EquipmentType>(['forklift', 'reach_truck', 'order_picker', 'scissor_lift'])
const PUSH = new Set<EquipmentType>(['manual_pallet_jack', 'electric_pallet_jack', 'trolley'])

/**
 * People only from task and shipment data: operators of active equipment,
 * dock staff while a truck is unloading or loading, an inspector while an
 * inspection task runs. Ambient staff only when explicitly enabled.
 */
export function deriveWorkers(
  equipment: readonly Equipment[],
  shipments: readonly Shipment[],
  layout: WarehouseLayout,
  plan: SitePlan,
  ambient: boolean,
): WorkerSpec[] {
  const out: WorkerSpec[] = []
  for (const e of equipment) {
    if (e.status !== 'active' || !e.currentTask || !MOBILE(e.type)) continue
    out.push({
      id: `W-${e.id}`,
      role: 'operator',
      activity: RIDE.has(e.type) ? 'drive' : PUSH.has(e.type) ? 'push' : 'stand',
      equipmentId: e.id,
      x: e.home.x, z: e.home.z, heading: 0,
      source: `Operator of ${e.label} (task ${e.currentTask.id})`,
    })
    if (e.currentTask.zoneId) {
      const zone = layout.zones.find(z => z.id === e.currentTask!.zoneId)
      if (zone?.kind === 'inspection') {
        out.push({
          id: `W-INS-${e.currentTask.id}`,
          role: 'inspector',
          activity: 'inspect',
          x: zone.bounds.x + zone.bounds.width * 0.7,
          z: zone.bounds.z + 2.6,
          heading: Math.PI,
          source: `Inspector for task ${e.currentTask.id}`,
        })
      }
    }
  }
  for (const s of shipments) {
    if (s.status !== 'unloading' && s.status !== 'loading') continue
    const dock = layout.docks.find(d => d.id === s.dockId)
    if (!dock) continue
    const z = plan.footprint.maxZ - 4.2
    out.push(
      { id: `W-DOCK-${s.id}-1`, role: 'dock_staff', activity: 'scan', x: dock.x - 2.3, z, heading: 0, source: `Dock staff for ${s.id} (${s.status})` },
      { id: `W-DOCK-${s.id}-2`, role: 'dock_staff', activity: 'carry', x: dock.x + 2.1, z: z - 0.6, heading: 0.4, source: `Dock staff for ${s.id} (${s.status})` },
    )
  }
  if (ambient) {
    plan.walkways.forEach((w, i) => {
      const cx = (w.minX + w.maxX) / 2
      const cz = (w.minZ + w.maxZ) / 2
      const long = w.maxX - w.minX > w.maxZ - w.minZ
      const loop: Pt[] = long ? [[w.minX + 2, cz], [w.maxX - 2, cz]] : [[cx, w.minZ + 2], [cx, w.maxZ - 2]]
      out.push({ id: `W-AMB-${i + 1}`, role: 'ambient', activity: 'walk', x: loop[0][0], z: loop[0][1], heading: 0, loop, source: 'Ambient staff (decorative, not from data)' })
    })
  }
  return out
}
