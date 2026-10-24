import { beforeAll, describe, expect, it } from 'vitest'
import type { Disruption, Equipment, InventoryLot, RecoveryPlan, Shipment, WarehouseLayout } from '../data/schemas'
import { SCENARIOS, type Scenario } from '../scenarios'
import { rackWorldBounds } from '../world/layoutToWorld'
import {
  buildNavGraph,
  dockNodeId,
  edgeList,
  findPath,
  homeNodeId,
  positionServiceNode,
  segmentHitsRect,
  zoneNodeId,
  type NavGraph,
} from '../world/navGraph'
import { agentPoint, createAgent, edgeKey, nodeKey, PRIORITY, stepTraffic, TrafficManager, type TrafficAgent } from '../world/traffic'
import { deriveWorkers, equipmentPose, equipmentRoute, routeLength, truckPose } from '../world/poses'
import { actionLanded, actionViews, delayedShipments, planPhase, shortageMarkers, shownOption } from '../world/planVisual'
import { buildSitePlan, type SitePlan } from '../world/sitePlan'
import { createRng } from '../world/sceneParams'

let scenario: Scenario
let layout: WarehouseLayout
let plan: SitePlan
let equipment: Equipment[]
let graph: NavGraph

beforeAll(async () => {
  scenario = await SCENARIOS[0].load()
  layout = scenario.initialState.layout
  equipment = scenario.initialState.equipment
  plan = buildSitePlan(layout, 42)
  graph = buildNavGraph(layout, plan, equipment.map(e => ({ id: e.id, x: e.home.x, z: e.home.z })))
})

/** Events of a given type from every step, materialised without stamping. */
function stepPayloads<T>(type: string, key: string): T[] {
  return scenario.steps.flatMap(s => s.events.filter(e => e.type === type).map(e => (e as Record<string, unknown>)[key] as T))
}

describe('equipment path generation', () => {
  it('never routes a segment through a rack', () => {
    const racks = layout.racks.map(r => rackWorldBounds(layout, r))
    for (const [a, b] of edgeList(graph)) {
      for (const r of racks) expect(segmentHitsRect(a, b, r)).toBe(false)
    }
  })

  it('reaches every rack position, dock and front zone from every parking bay', () => {
    const targets = [
      ...layout.racks.map(r => positionServiceNode(layout, graph, `${r.id}-L01-P01`)!),
      ...layout.docks.map(d => dockNodeId(d.id)),
      ...layout.zones.filter(z => ['receiving', 'inspection', 'dispatch'].includes(z.kind)).map(z => zoneNodeId(z.id)),
    ]
    for (const e of equipment.filter(x => x.type !== 'conveyor')) {
      for (const t of targets) expect(findPath(graph, homeNodeId(e.id), t)).not.toBeNull()
    }
  })

  it('stays inside the building footprint', () => {
    const fp = plan.footprint
    for (const n of graph.nodes.values()) {
      expect(n.x).toBeGreaterThan(fp.minX)
      expect(n.x).toBeLessThan(fp.maxX)
      expect(n.z).toBeGreaterThan(fp.minZ)
      expect(n.z).toBeLessThan(fp.maxZ)
    }
  })
})

describe('traffic reservation', () => {
  /** Resources an agent physically occupies right now, derived from its state alone. */
  const occupied = (a: TrafficAgent) => {
    const here = a.path[a.at]
    if (a.t === 0 || a.at >= a.path.length - 1) return [nodeKey(here)]
    const next = a.path[a.at + 1]
    return [nodeKey(here), edgeKey(here, next), nodeKey(next)]
  }

  it('never lets two agents share a segment or node across randomized runs', () => {
    const ids = [...graph.nodes.keys()]
    for (let trial = 0; trial < 120; trial++) {
      const rng = createRng(1000 + trial)
      const tm = new TrafficManager()
      const agents: TrafficAgent[] = []
      const starts = new Set<string>()
      const n = 3 + Math.floor(rng() * 5)
      for (let i = 0; i < n; i++) {
        let start = ids[Math.floor(rng() * ids.length)]
        while (starts.has(start)) start = ids[Math.floor(rng() * ids.length)]
        starts.add(start)
        const end = ids[Math.floor(rng() * ids.length)]
        const path = findPath(graph, start, end) ?? [start]
        const pr = [PRIORITY.emptyVehicle, PRIORITY.loadedVehicle, PRIORITY.pedestrian][Math.floor(rng() * 3)]
        agents.push(createAgent(`A${i}`, path, 1 + rng() * 2, pr))
      }
      for (let tick = 0; tick < 300; tick++) {
        stepTraffic(graph, tm, agents, 0.1)
        const seen = new Map<string, string>()
        for (const a of agents) {
          for (const r of occupied(a)) {
            const other = seen.get(r)
            expect(other === undefined || other === a.id, `trial ${trial} tick ${tick}: ${r} shared by ${other} and ${a.id}`).toBe(true)
            seen.set(r, a.id)
          }
        }
      }
    }
  }, 60_000)

  it('queues the lower-priority agent at a contested segment', () => {
    const lane = [...graph.nodes.keys()].filter(k => k.startsWith('lane:')).slice(0, 3)
    const tm = new TrafficManager()
    const empty = createAgent('empty', [lane[0], lane[1], lane[2]], 2, PRIORITY.emptyVehicle)
    const person = createAgent('person', [lane[2], lane[1], lane[0]], 1, PRIORITY.pedestrian)
    stepTraffic(graph, tm, [empty, person], 0.1)
    // Both want lane[1]; the pedestrian wins it, the empty vehicle waits
    expect(person.waiting).toBe(false)
    expect(empty.waiting).toBe(true)
    const p = agentPoint(graph, empty)
    expect(p.x).toBeCloseTo(graph.nodes.get(lane[0])!.x)
  })
})

describe('state-derived poses', () => {
  const putaway = () => {
    const ev = stepPayloads<Equipment>('equipment.task', 'equipment').find(e => e.id === 'RT-01' && e.status === 'active')!
    return ev
  }

  it('parks idle equipment at its bay', () => {
    const idle = equipment.find(e => e.id === 'FL-01')!
    const pose = equipmentPose(idle, equipmentRoute(idle, layout, graph), 12)
    expect(pose.phase).toBe('parked')
    expect([pose.x, pose.z]).toEqual([idle.home.x, idle.home.z])
  })

  it('is idempotent and depends only on state and elapsed time', () => {
    const eq = putaway()
    const route = equipmentRoute(eq, layout, graph)
    const a = equipmentPose(eq, route, 4.2)
    const b = equipmentPose(structuredClone(eq), equipmentRoute(structuredClone(eq), layout, graph), 4.2)
    expect(a).toEqual(b)
    expect(a.phase).toBe('travel')
    expect(a.travelled).toBeLessThan(routeLength(route.points))
  })

  it('shows a task in progress at its work point when the start time is unknown, forks at the target level', () => {
    const eq = putaway()
    const route = equipmentRoute(eq, layout, graph)
    const pose = equipmentPose(eq, route, null)
    expect(pose.phase).toBe('working')
    expect(route.liftY).not.toBeNull()
    expect(pose.lift).toBeCloseTo(route.liftY!)
    const end = route.points[route.points.length - 1]
    expect([pose.x, pose.z]).toEqual(end)
  })

  it('puts trucks in the yard only while a shipment record says so', () => {
    const base = scenario.initialState.shipments[0]
    const s = (status: Shipment['status']): Shipment => ({ ...base, dockId: 'D02', status })
    expect(truckPose(s('scheduled'), layout, plan, null)).toBeNull()
    expect(truckPose(s('departed'), layout, plan, null)).toBeNull()
    const docked = truckPose(s('unloading'), layout, plan, null)!
    expect(docked.phase).toBe('docked')
    expect(docked.doorsOpen).toBe(true)
    expect(truckPose(s('at_dock'), layout, plan, null)!.doorsOpen).toBe(false)
    // Reloading mid-unload gives the same pose
    expect(truckPose(s('unloading'), layout, plan, 999)).toEqual(docked)
    expect(docked.z).toBeGreaterThan(plan.footprint.maxZ)
  })

  it('derives people only from task and shipment data', () => {
    expect(deriveWorkers(equipment, scenario.initialState.shipments, layout, plan, false)).toEqual([])
    const ambient = deriveWorkers(equipment, scenario.initialState.shipments, layout, plan, true)
    expect(ambient.every(w => w.role === 'ambient')).toBe(true)
    const active = stepPayloads<Equipment>('equipment.task', 'equipment').filter(e => e.status === 'active')
    const unloading = stepPayloads<Shipment>('shipment.status', 'shipment').filter(x => x.status === 'unloading')
    const workers = deriveWorkers(active, unloading.slice(0, 1), layout, plan, false)
    expect(workers.filter(w => w.role === 'operator').length).toBeGreaterThan(0)
    expect(workers.filter(w => w.role === 'dock_staff')).toHaveLength(2)
  })
})

describe('plan lifecycle', () => {
  const recovery = () => stepPayloads<RecoveryPlan>('recovery.updated', 'plan')
  const lots = (): InventoryLot[] => scenario.initialState.inventory

  it('shows one ghost per action while proposed', () => {
    const proposed = recovery().find(p => p.status === 'awaiting_approval')!
    const option = shownOption(proposed, [])!
    expect(option.id).toBe(proposed.recommendedOptionId)
    const views = actionViews(proposed, option, lots())
    expect(views).toHaveLength(option.actions.length)
    expect(views.every(v => v.ghost && v.arc && v.state === 'proposed')).toBe(true)
    expect(planPhase(proposed, views)).toBe('awaiting_approval')
  })

  it('keeps ghosts while executing and turns them solid only when inventory lands', () => {
    const approved = recovery().find(p => p.status === 'approved')!
    const option = approved.options.find(o => o.id === approved.recommendedOptionId)!
    const before = actionViews(approved, option, lots())
    expect(before.every(v => v.state === 'executing' && v.ghost)).toBe(true)

    const finalLots = stepPayloads<InventoryLot>('inventory.updated', 'lot')
    const merged = new Map(lots().map(l => [l.lotId, l]))
    finalLots.forEach(l => merged.set(l.lotId, l))
    const after = actionViews(approved, option, [...merged.values()].map(l => ({ ...l, lastUpdated: '2026-10-24T08:00:00Z' })))
    expect(after.every(v => v.state === 'completed' && v.solid && !v.ghost)).toBe(true)
    expect(planPhase(approved, after)).toBe('completed')
  })

  it('treats incoming placeholders as not yet landed, and dissolves on rejection', () => {
    const action = recovery().find(p => p.status === 'awaiting_approval')!.options[0].actions[1]
    const placeholder = { ...lots()[0], positionId: action.toPositionId, sku: action.sku, status: 'incoming' as const, qty: 0 }
    expect(actionLanded(action, [placeholder])).toBe(false)
    const rejected = { ...recovery().find(p => p.status === 'awaiting_approval')!, status: 'rejected' as const }
    expect(actionViews(rejected, rejected.options[0], lots()).every(v => !v.ghost && !v.arc)).toBe(true)
  })
})

describe('delays and shortages', () => {
  it('flags the failed supplier inbound without spawning a truck', () => {
    const disruption = stepPayloads<Disruption>('disruption.created', 'disruption')[0]
    const ships = scenario.initialState.shipments
    const delays = delayedShipments(ships, [{ ...disruption, createdAt: '2026-10-24T08:00:00Z' }], Date.parse('2026-10-24T09:00:00Z'))
    const apex = delays.find(d => d.shipment.supplier.id === disruption.failedSupplier.id)!
    expect(apex.reason).toBe('supplier_failed')
    expect(truckPose(apex.shipment, layout, plan, null)).toBeNull()
    expect(delayedShipments(ships, [{ ...disruption, status: 'resolved' }], Date.parse('2026-10-24T09:00:00Z')).some(d => d.reason === 'supplier_failed')).toBe(false)
  })

  it('places shortage markers with the gap from the disruption data', () => {
    const disruption = stepPayloads<Disruption>('disruption.created', 'disruption')[0]
    const affected = stepPayloads<InventoryLot>('inventory.updated', 'lot').filter(l => l.status === 'disruption_affected' || l.status === 'shortage')
    const markers = shortageMarkers([disruption], affected)
    expect(markers.length).toBe(affected.length)
    for (const m of markers) {
      expect(m.gapQty).toBe(disruption.shortages.find(s => s.sku === m.sku)!.gapQty)
    }
  })
})
