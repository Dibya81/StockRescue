import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { Equipment, EquipmentType, Shipment, WarehouseLayout } from '../data/schemas'
import { BRAND_BLUE, GROUND_Y } from '../world/constants'
import { getSceneParams } from '../world/sceneParams'
import type { NavGraph } from '../world/navGraph'
import {
  EQUIPMENT_SPEED,
  equipmentPose,
  equipmentRoute,
  MOBILE,
  routeLength,
  TRUCK_LENGTH,
  truckPose,
  type Pt,
  type Route,
} from '../world/poses'
import type { SitePlan } from '../world/sitePlan'
import { TrafficManager } from '../world/traffic'
import { startKey, useTwinStore } from '../store/twinStore'
import { isDragRelease, mounts, sceneStats, setEntityPosition } from './registry'
import { createCladdingNormal, createCartonTexture } from './textures'
import { SpriteLabel } from './Building'

// ── Materials ────────────────────────────────────────────

type MatKey = 'body' | 'dark' | 'steel' | 'rubber' | 'seat' | 'wood' | 'carton' | 'white' | 'glass' | 'container' | 'red'

function useMaterials() {
  const res = useMemo(() => {
    const carton = createCartonTexture(5)
    const ribs = createCladdingNormal([6, 1])
    const m: Record<MatKey, THREE.MeshStandardMaterial> = {
      body: new THREE.MeshStandardMaterial({ color: BRAND_BLUE, metalness: 0.35, roughness: 0.38 }),
      dark: new THREE.MeshStandardMaterial({ color: '#2B3138', metalness: 0.45, roughness: 0.5 }),
      steel: new THREE.MeshStandardMaterial({ color: '#B7BEC6', metalness: 0.8, roughness: 0.32 }),
      rubber: new THREE.MeshStandardMaterial({ color: '#15171A', roughness: 0.92 }),
      seat: new THREE.MeshStandardMaterial({ color: '#1F2328', roughness: 0.7 }),
      wood: new THREE.MeshStandardMaterial({ color: '#C9A26B', roughness: 0.85 }),
      carton: new THREE.MeshStandardMaterial({ map: carton, roughness: 0.9 }),
      white: new THREE.MeshStandardMaterial({ color: '#EEF1F4', metalness: 0.3, roughness: 0.42 }),
      glass: new THREE.MeshPhysicalMaterial({ color: '#9CC3E6', roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.55 }),
      container: new THREE.MeshStandardMaterial({ color: '#E8EBEF', metalness: 0.5, roughness: 0.42, normalMap: ribs }),
      red: new THREE.MeshStandardMaterial({ color: '#B91C1C', roughness: 0.5 }),
    }
    return { m, textures: [carton, ribs] }
  }, [])
  useEffect(() => () => {
    Object.values(res.m).forEach(x => x.dispose())
    res.textures.forEach(t => t.dispose())
  }, [res])
  return res.m
}

// ── Part-based procedural models ─────────────────────────

type Group = 'chassis' | 'mast' | 'carriage' | 'platform' | 'scissor' | 'load'
interface Part { geo: THREE.BufferGeometry; mat: MatKey; group: Group }
interface Wheel { x: number; y: number; z: number; r: number; w: number }
interface ModelSpec {
  parts: Part[]
  wheels: Wheel[]
  beacon: [number, number, number] | null
  mount: { x: number; y: number; z: number; kind: 'seat' | 'platform' | 'behind' }
  footprint: [number, number]
}

const rb = (w: number, h: number, d: number, x: number, y: number, z: number, mat: MatKey, group: Group = 'chassis', r = 0.04): Part => {
  const geo = new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3))
  geo.translate(x, y, z)
  return { geo, mat, group }
}
const bx = (w: number, h: number, d: number, x: number, y: number, z: number, mat: MatKey, group: Group = 'chassis'): Part => {
  const geo = new THREE.BoxGeometry(w, h, d)
  geo.translate(x, y, z)
  return { geo, mat, group }
}
const cy = (r: number, h: number, x: number, y: number, z: number, mat: MatKey, group: Group = 'chassis', tilt = 0): Part => {
  const geo = new THREE.CylinderGeometry(r, r, h, 14)
  if (tilt) geo.rotateX(tilt)
  geo.translate(x, y, z)
  return { geo, mat, group }
}

function loadParts(z: number, y = 0.08): Part[] {
  return [bx(0.8, 0.13, 1.0, 0, y + 0.065, z, 'wood', 'load'), rb(0.76, 0.66, 0.94, 0, y + 0.47, z, 'carton', 'load', 0.02)]
}

function buildSpec(type: EquipmentType): ModelSpec {
  switch (type) {
    case 'forklift': return {
      parts: [
        rb(1.08, 0.72, 1.7, 0, 0.62, -0.18, 'body'), rb(1.12, 0.66, 0.5, 0, 0.62, -1.05, 'dark'),
        rb(0.5, 0.1, 0.45, 0, 1.03, -0.35, 'seat'), rb(0.5, 0.45, 0.09, 0, 1.28, -0.58, 'seat'),
        cy(0.03, 0.5, 0, 1.2, 0.12, 'dark', 'chassis', -0.4), cy(0.17, 0.03, 0, 1.43, 0.22, 'rubber', 'chassis', -0.4),
        ...[[-0.5, 0.35], [0.5, 0.35], [-0.5, -0.78], [0.5, -0.78]].map(([x, z]) => bx(0.05, 1.3, 0.05, x, 1.6, z, 'dark')),
        bx(1.06, 0.05, 1.2, 0, 2.25, -0.21, 'dark'),
        ...[-0.25, 0, 0.25].map(x => bx(0.03, 0.03, 1.12, x, 2.28, -0.21, 'dark')),
        bx(0.08, 2.2, 0.12, -0.33, 1.2, 0.82, 'steel'), bx(0.08, 2.2, 0.12, 0.33, 1.2, 0.82, 'steel'), bx(0.74, 0.08, 0.1, 0, 2.28, 0.82, 'steel'),
        bx(0.06, 2.0, 0.08, -0.27, 1.15, 0.9, 'steel', 'mast'), bx(0.06, 2.0, 0.08, 0.27, 1.15, 0.9, 'steel', 'mast'), bx(0.6, 0.06, 0.08, 0, 2.12, 0.9, 'steel', 'mast'),
        bx(0.74, 0.55, 0.05, 0, 0.45, 0.98, 'steel', 'carriage'),
        bx(0.1, 0.5, 0.05, -0.22, 0.3, 1.0, 'dark', 'carriage'), bx(0.1, 0.5, 0.05, 0.22, 0.3, 1.0, 'dark', 'carriage'),
        bx(0.1, 0.045, 1.1, -0.22, 0.06, 1.55, 'dark', 'carriage'), bx(0.1, 0.045, 1.1, 0.22, 0.06, 1.55, 'dark', 'carriage'),
        ...loadParts(1.55),
      ],
      wheels: [{ x: -0.48, y: 0.3, z: 0.52, r: 0.3, w: 0.22 }, { x: 0.48, y: 0.3, z: 0.52, r: 0.3, w: 0.22 }, { x: -0.48, y: 0.24, z: -0.82, r: 0.24, w: 0.18 }, { x: 0.48, y: 0.24, z: -0.82, r: 0.24, w: 0.18 }],
      beacon: [0, 2.34, -0.65],
      mount: { x: 0, y: 1.08, z: -0.35, kind: 'seat' },
      footprint: [1.2, 3.0],
    }
    case 'reach_truck': return {
      parts: [
        rb(1.0, 1.5, 1.2, 0, 0.9, -0.55, 'body'), rb(0.95, 0.08, 0.6, 0, 0.22, -0.2, 'dark'),
        bx(0.12, 0.12, 1.5, -0.45, 0.12, 0.55, 'dark'), bx(0.12, 0.12, 1.5, 0.45, 0.12, 0.55, 'dark'),
        ...[[-0.45, 0.0], [0.45, 0.0]].map(([x, z]) => bx(0.05, 1.9, 0.05, x, 1.25, z, 'dark')), bx(1.0, 0.05, 0.6, 0, 2.2, -0.25, 'dark'),
        bx(0.08, 2.8, 0.12, -0.3, 1.5, 0.3, 'steel'), bx(0.08, 2.8, 0.12, 0.3, 1.5, 0.3, 'steel'),
        bx(0.06, 2.6, 0.08, -0.25, 1.45, 0.38, 'steel', 'mast'), bx(0.06, 2.6, 0.08, 0.25, 1.45, 0.38, 'steel', 'mast'),
        bx(0.7, 0.5, 0.05, 0, 0.42, 0.62, 'steel', 'carriage'),
        bx(0.1, 0.045, 1.05, -0.2, 0.06, 1.15, 'dark', 'carriage'), bx(0.1, 0.045, 1.05, 0.2, 0.06, 1.15, 'dark', 'carriage'),
        ...loadParts(1.15),
      ],
      wheels: [{ x: -0.45, y: 0.12, z: 1.1, r: 0.12, w: 0.1 }, { x: 0.45, y: 0.12, z: 1.1, r: 0.12, w: 0.1 }, { x: 0, y: 0.18, z: -0.95, r: 0.18, w: 0.16 }],
      beacon: [0, 2.28, -0.4],
      mount: { x: 0, y: 0.26, z: -0.2, kind: 'platform' },
      footprint: [1.1, 2.6],
    }
    case 'electric_pallet_jack': return {
      parts: [
        rb(0.7, 0.85, 0.55, 0, 0.5, -0.4, 'body'), cy(0.03, 0.9, 0, 0.95, -0.85, 'dark', 'chassis', -0.6), bx(0.4, 0.06, 0.06, 0, 1.33, -1.1, 'rubber'),
        bx(0.16, 0.08, 1.15, -0.25, 0.09, 0.45, 'dark'), bx(0.16, 0.08, 1.15, 0.25, 0.09, 0.45, 'dark'),
      ],
      wheels: [{ x: 0, y: 0.12, z: -0.45, r: 0.12, w: 0.1 }, { x: -0.25, y: 0.05, z: 0.95, r: 0.05, w: 0.08 }, { x: 0.25, y: 0.05, z: 0.95, r: 0.05, w: 0.08 }],
      beacon: null,
      mount: { x: 0, y: 0, z: -1.45, kind: 'behind' },
      footprint: [0.8, 2.0],
    }
    case 'manual_pallet_jack': return {
      parts: [
        cy(0.08, 0.35, 0, 0.3, -0.3, 'red'), cy(0.02, 1.0, 0, 0.75, -0.55, 'dark', 'chassis', -0.5), bx(0.35, 0.05, 0.05, 0, 1.18, -0.78, 'rubber'),
        bx(0.16, 0.07, 1.15, -0.25, 0.08, 0.4, 'red'), bx(0.16, 0.07, 1.15, 0.25, 0.08, 0.4, 'red'),
      ],
      wheels: [{ x: -0.1, y: 0.09, z: -0.32, r: 0.09, w: 0.06 }, { x: 0.1, y: 0.09, z: -0.32, r: 0.09, w: 0.06 }],
      beacon: null,
      mount: { x: 0, y: 0, z: -1.2, kind: 'behind' },
      footprint: [0.7, 1.7],
    }
    case 'order_picker': return {
      parts: [
        rb(1.0, 0.45, 1.6, 0, 0.3, -0.2, 'body'),
        bx(0.08, 3.6, 0.12, -0.36, 1.9, -0.85, 'steel'), bx(0.08, 3.6, 0.12, 0.36, 1.9, -0.85, 'steel'), bx(0.8, 0.08, 0.12, 0, 3.7, -0.85, 'steel'),
        bx(0.9, 0.07, 0.9, 0, 0.56, -0.25, 'dark', 'platform'),
        bx(0.9, 0.04, 0.04, 0, 1.6, 0.2, 'body', 'platform'), bx(0.04, 1.05, 0.04, -0.44, 1.08, 0.2, 'body', 'platform'), bx(0.04, 1.05, 0.04, 0.44, 1.08, 0.2, 'body', 'platform'),
        bx(0.5, 0.3, 0.2, 0, 1.4, 0.12, 'dark', 'platform'),
        bx(0.1, 0.045, 1.0, -0.2, 0.5, 0.75, 'dark', 'platform'), bx(0.1, 0.045, 1.0, 0.2, 0.5, 0.75, 'dark', 'platform'),
      ],
      wheels: [{ x: -0.4, y: 0.14, z: 0.4, r: 0.14, w: 0.1 }, { x: 0.4, y: 0.14, z: 0.4, r: 0.14, w: 0.1 }, { x: 0, y: 0.18, z: -0.7, r: 0.18, w: 0.16 }],
      beacon: [0, 3.8, -0.85],
      mount: { x: 0, y: 0.6, z: -0.3, kind: 'platform' },
      footprint: [1.1, 2.0],
    }
    case 'scissor_lift': return {
      parts: [
        rb(0.85, 0.35, 1.9, 0, 0.3, 0, 'body'),
        ...[-0.38, 0.38].flatMap(x => [bx(0.05, 1.0, 0.05, x, 0.5, 0, 'dark', 'scissor')]).map(p => { p.geo.rotateX(0); return p }),
        ...[-0.38, 0.38].flatMap(x => {
          const a = new THREE.BoxGeometry(0.05, 0.06, 1.8); a.rotateX(0.5); a.translate(x, 0.5, 0)
          const b = new THREE.BoxGeometry(0.05, 0.06, 1.8); b.rotateX(-0.5); b.translate(x, 0.5, 0)
          return [{ geo: a, mat: 'dark' as MatKey, group: 'scissor' as Group }, { geo: b, mat: 'dark' as MatKey, group: 'scissor' as Group }]
        }),
        bx(0.85, 0.07, 1.9, 0, 0.55, 0, 'steel', 'platform'),
        bx(0.85, 0.04, 0.04, 0, 1.6, 0.93, 'body', 'platform'), bx(0.85, 0.04, 0.04, 0, 1.6, -0.93, 'body', 'platform'),
        bx(0.04, 0.04, 1.9, -0.42, 1.6, 0, 'body', 'platform'), bx(0.04, 0.04, 1.9, 0.42, 1.6, 0, 'body', 'platform'),
      ],
      wheels: [{ x: -0.36, y: 0.15, z: 0.7, r: 0.15, w: 0.1 }, { x: 0.36, y: 0.15, z: 0.7, r: 0.15, w: 0.1 }, { x: -0.36, y: 0.15, z: -0.7, r: 0.15, w: 0.1 }, { x: 0.36, y: 0.15, z: -0.7, r: 0.15, w: 0.1 }],
      beacon: [0.35, 0.55, -0.85],
      mount: { x: 0, y: 0.6, z: 0, kind: 'platform' },
      footprint: [0.95, 2.0],
    }
    case 'trolley': return {
      parts: [
        rb(0.8, 0.06, 1.4, 0, 0.36, 0, 'steel'), bx(0.8, 0.04, 1.3, 0, 0.12, 0, 'steel'),
        cy(0.02, 0.9, -0.36, 0.78, -0.7, 'dark'), cy(0.02, 0.9, 0.36, 0.78, -0.7, 'dark'), bx(0.74, 0.04, 0.04, 0, 1.22, -0.7, 'rubber'),
      ],
      wheels: [[-0.32, 0.55], [0.32, 0.55], [-0.32, -0.55], [0.32, -0.55]].map(([x, z]) => ({ x, y: 0.07, z, r: 0.07, w: 0.05 })),
      beacon: null,
      mount: { x: 0, y: 0, z: -1.25, kind: 'behind' },
      footprint: [0.85, 1.6],
    }
    case 'conveyor': return { parts: [], wheels: [], beacon: null, mount: { x: 0, y: 0, z: 0, kind: 'behind' }, footprint: [6, 0.8] }
  }
}

interface BuiltModel {
  groups: Map<Group, { mat: MatKey; geo: THREE.BufferGeometry }[]>
  wheels: Wheel[]
  wheelGeo: THREE.BufferGeometry
  spec: ModelSpec
}

const modelCache = new Map<EquipmentType, BuiltModel>()

/** Static parts merged per (group, material): a handful of draw calls per unit. */
function getModel(type: EquipmentType): BuiltModel {
  const cached = modelCache.get(type)
  if (cached) return cached
  const spec = buildSpec(type)
  const groups = new Map<Group, { mat: MatKey; geo: THREE.BufferGeometry }[]>()
  const byKey = new Map<string, THREE.BufferGeometry[]>()
  for (const p of spec.parts) {
    const k = `${p.group}|${p.mat}`
    const flat = p.geo.index ? p.geo.toNonIndexed() : p.geo
    if (flat !== p.geo) p.geo.dispose()
    const list = byKey.get(k)
    if (list) list.push(flat)
    else byKey.set(k, [flat])
  }
  for (const [k, geos] of byKey) {
    const [group, mat] = k.split('|') as [Group, MatKey]
    const geo = mergeGeometries(geos)
    geos.forEach(g => g.dispose())
    const list = groups.get(group) ?? []
    list.push({ mat, geo })
    groups.set(group, list)
  }
  const wheelGeo = new THREE.CylinderGeometry(1, 1, 1, 18)
  wheelGeo.rotateZ(Math.PI / 2)
  const built = { groups, wheels: spec.wheels, wheelGeo, spec }
  modelCache.set(type, built)
  return built
}

// ── Equipment ────────────────────────────────────────────

interface VehiclesProps {
  layout: WarehouseLayout
  plan: SitePlan
  graph: NavGraph
  equipment: Equipment[]
  shipments: Shipment[]
  stale: boolean
  onSelectEquipment: (id: string) => void
  onSelectShipment: (id: string) => void
}

const ptKey = (p: Pt) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`
const LOADED_TASKS = new Set(['putaway', 'reallocate', 'replenish'])
/** Carrying a pallet: loaded jobs on the way out, picks on the way back */
const isLoaded = (task: Equipment['currentTask']) =>
  !!task && (LOADED_TASKS.has(task.kind) || (task.kind === 'return' && task.description.includes('after pick')))

export function Vehicles({ layout, plan, graph, equipment, shipments, stale, onSelectEquipment, onSelectShipment }: VehiclesProps) {
  const mats = useMaterials()
  const traffic = useMemo(() => new TrafficManager(), [])
  const timeOfDay = useTwinStore(s => s.timeOfDay)
  const routes = useMemo(() => new Map(equipment.map(e => [e.id, equipmentRoute(e, layout, graph)])), [equipment, layout, graph])

  // Granted travel distance per unit, limited by traffic reservations
  const granted = useRef(new Map<string, { taskId: string; upto: number }>())
  const { freeze } = getSceneParams()

  // One arbitration pass per frame, highest priority first (loaded before empty, then id)
  useFrame(() => {
    if (stale || freeze) return
    const s = useTwinStore.getState()
    const active = equipment
      .filter(e => e.status === 'active' && e.currentTask && MOBILE(e.type))
      .sort((a, b) => Number(isLoaded(b.currentTask)) - Number(isLoaded(a.currentTask)) || a.id.localeCompare(b.id))
    for (const e of active) {
      const route = routes.get(e.id)
      const started = s.startedAt[startKey('equipment', e.id, e.currentTask!.id)]
      if (!route || route.points.length < 2 || started === undefined) continue
      const speed = EQUIPMENT_SPEED[e.type]
      const want = Math.min(routeLength(route.points), ((Date.now() - started) / 1000) * speed)
      const gr = granted.current.get(e.id) ?? { taskId: e.currentTask!.id, upto: 0 }
      let acc = 0
      for (let i = 1; i < route.points.length && acc < want; i++) {
        const a = ptKey(route.points[i - 1])
        const b = ptKey(route.points[i])
        // Hold the next segment and the node at its end before entering it
        if (!traffic.tryAcquire(e.id, [`e:${a < b ? `${a}|${b}` : `${b}|${a}`}`, `n:${b}`])) break
        acc += Math.hypot(route.points[i][0] - route.points[i - 1][0], route.points[i][1] - route.points[i - 1][1])
        // Segments fully behind the unit are released for others
        if (i >= 2 && acc - want < 0) {
          const pa = ptKey(route.points[i - 2])
          traffic.release(e.id, [`e:${pa < a ? `${pa}|${a}` : `${a}|${pa}`}`, `n:${pa}`])
        }
      }
      gr.upto = Math.max(gr.upto, Math.min(want, acc))
      granted.current.set(e.id, gr)
    }
  })

  useEffect(() => {
    sceneStats.activeEquipment = equipment.filter(e => e.status === 'active').length
  }, [equipment])

  const trucks = shipments.filter(s => ['arriving', 'at_dock', 'unloading', 'loading'].includes(s.status) && s.dockId)
  useEffect(() => {
    sceneStats.trucks = trucks.length
  }, [trucks.length])

  return (
    <group>
      {equipment.map(e => e.type === 'conveyor'
        ? <Conveyor key={e.id} eq={e} mats={mats} onSelect={onSelectEquipment} />
        : (
          <EquipmentUnit
            key={e.id}
            eq={e}
            route={routes.get(e.id)!}
            mats={mats}
            traffic={traffic}
            granted={granted.current}
            stale={stale}
            onSelect={onSelectEquipment}
          />
        ))}
      {trucks.map(s => (
        <Truck key={s.id} shipment={s} layout={layout} plan={plan} mats={mats} night={timeOfDay === 'night'} stale={stale} onSelect={onSelectShipment} />
      ))}
    </group>
  )
}

function ContactShadow({ w, d }: { w: number; d: number }) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = c.height = 64
    const ctx = c.getContext('2d')!
    const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 32)
    g.addColorStop(0, 'rgba(0,0,0,0.55)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 64, 64)
    return new THREE.CanvasTexture(c)
  }, [])
  useEffect(() => () => tex.dispose(), [tex])
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={0.012} renderOrder={1}>
      <planeGeometry args={[w * 1.5, d * 1.3]} />
      <meshBasicMaterial map={tex} transparent depthWrite={false} />
    </mesh>
  )
}

interface UnitProps {
  eq: Equipment
  route: Route
  mats: Record<MatKey, THREE.MeshStandardMaterial>
  traffic: TrafficManager
  granted: Map<string, { taskId: string; upto: number }>
  stale: boolean
  onSelect: (id: string) => void
}

function EquipmentUnit({ eq, route, mats, traffic, granted, stale, onSelect }: UnitProps) {
  const model = getModel(eq.type)
  const root = useRef<THREE.Group>(null)
  const mast = useRef<THREE.Group>(null)
  const carriage = useRef<THREE.Group>(null)
  const platform = useRef<THREE.Group>(null)
  const scissor = useRef<THREE.Group>(null)
  const load = useRef<THREE.Group>(null)
  const wheelRefs = useRef<(THREE.Mesh | null)[]>([])
  const beaconMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#F59E0B', emissive: '#F59E0B', emissiveIntensity: 0.2, toneMapped: false }), [])
  useEffect(() => () => beaconMat.dispose(), [beaconMat])
  const frozenElapsed = useRef<number | null>(null)
  const { freeze } = getSceneParams()
  const taskId = eq.currentTask?.id ?? null
  const loaded = isLoaded(eq.currentTask)
  const total = routeLength(route.points)
  const speed = EQUIPMENT_SPEED[eq.type]

  useEffect(() => {
    // New task: release whatever this unit held and start over
    traffic.releaseAll(eq.id)
    granted.set(eq.id, { taskId: taskId ?? '', upto: 0 })
    return () => traffic.releaseAll(eq.id)
  }, [eq.id, taskId, traffic, granted])

  useFrame(({ clock }) => {
    const g = root.current
    if (!g) return
    const s = useTwinStore.getState()
    const started = taskId ? s.startedAt[startKey('equipment', eq.id, taskId)] : undefined
    let elapsed: number | null = started === undefined || freeze ? null : (Date.now() - started) / 1000
    // Stale LIVE data: hold the last pose instead of animating from outdated events
    if (stale) elapsed = frozenElapsed.current
    else frozenElapsed.current = elapsed

    // Traffic: travel no further than the reservations granted by the parent (queues instead of overlapping)
    if (elapsed != null && route.points.length > 1 && speed > 0) {
      const want = Math.min(total, elapsed * speed)
      const gr = granted.get(eq.id)
      if (gr && gr.upto < want) elapsed = gr.upto / speed
    }

    const pose = equipmentPose(eq, route, elapsed)
    g.position.set(pose.x, 0, pose.z)
    g.rotation.y = pose.heading
    const lift = pose.lift
    if (mast.current) mast.current.position.y = lift * 0.5
    if (carriage.current) carriage.current.position.y = lift
    if (load.current) {
      load.current.position.y = eq.type === 'order_picker' || eq.type === 'scissor_lift' ? lift : lift
      load.current.visible = loaded
    }
    if (platform.current) platform.current.position.y = lift
    if (scissor.current) scissor.current.scale.y = 1 + lift / 0.6
    wheelRefs.current.forEach((w, i) => {
      if (w) w.rotation.x = pose.travelled / model.wheels[i].r
    })
    // Beacon flashes while active; faster near nodes (aisle ends, crossings)
    const nearNode = route.points.some(p => Math.hypot(p[0] - pose.x, p[1] - pose.z) < 2.2)
    const on = eq.status === 'active' && (!freeze ? Math.sin(clock.elapsedTime * (nearNode ? 14 : 6)) > 0 : true)
    beaconMat.emissiveIntensity = on ? 6 : 0.2

    setEntityPosition(eq.id, pose.x, 1, pose.z)
    const m = model.spec.mount
    const c = Math.cos(pose.heading)
    const sn = Math.sin(pose.heading)
    const mountY = m.kind === 'platform' ? m.y + lift : m.y
    const prev = mounts.get(eq.id)
    const pos = new THREE.Vector3(pose.x + m.x * c + m.z * sn, mountY, pose.z - m.x * sn + m.z * c)
    if (prev) {
      prev.position.copy(pos)
      prev.heading = pose.heading
      prev.floorY = mountY
      prev.travelled = pose.travelled
    } else {
      mounts.set(eq.id, { position: pos, heading: pose.heading, floorY: mountY, kind: m.kind, travelled: pose.travelled })
    }
  })

  const groupMeshes = (group: Group) =>
    (model.groups.get(group) ?? []).map(({ mat, geo }) => <mesh key={mat} geometry={geo} material={mats[mat]} castShadow={false} receiveShadow />)

  return (
    <group
      ref={root}
      onClick={e => {
        if (isDragRelease(e)) return
        e.stopPropagation()
        onSelect(eq.id)
      }}
      onPointerOver={() => (document.body.style.cursor = 'pointer')}
      onPointerOut={() => (document.body.style.cursor = '')}
    >
      <ContactShadow w={model.spec.footprint[0]} d={model.spec.footprint[1]} />
      {groupMeshes('chassis')}
      <group ref={scissor}>{groupMeshes('scissor')}</group>
      <group ref={mast}>{groupMeshes('mast')}</group>
      <group ref={carriage}>{groupMeshes('carriage')}</group>
      <group ref={platform}>{groupMeshes('platform')}</group>
      <group ref={load}>{groupMeshes('load')}</group>
      {model.wheels.map((w, i) => (
        <mesh
          key={i}
          ref={m => {
            wheelRefs.current[i] = m
          }}
          geometry={model.wheelGeo}
          material={mats.rubber}
          position={[w.x, w.y, w.z]}
          scale={[w.w, w.r, w.r]}
        />
      ))}
      {model.spec.beacon && (
        <mesh position={model.spec.beacon} material={beaconMat}>
          <cylinderGeometry args={[0.06, 0.07, 0.11, 12]} />
        </mesh>
      )}
    </group>
  )
}

function Conveyor({ eq, mats, onSelect }: { eq: Equipment; mats: Record<MatKey, THREE.MeshStandardMaterial>; onSelect: (id: string) => void }) {
  const beltTex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 16
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#23272D'
    ctx.fillRect(0, 0, 64, 16)
    ctx.fillStyle = '#3A4048'
    for (let x = 0; x < 64; x += 8) ctx.fillRect(x, 0, 3, 16)
    const t = new THREE.CanvasTexture(c)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(12, 1)
    return t
  }, [])
  useEffect(() => () => beltTex.dispose(), [beltTex])
  const { freeze } = getSceneParams()
  const active = eq.status === 'active'
  useFrame((_, dt) => {
    // The belt only runs while the conveyor has an active task
    if (active && !freeze) beltTex.offset.x -= dt * 0.6
  })
  useEffect(() => {
    setEntityPosition(eq.id, eq.home.x, 1, eq.home.z)
  }, [eq.id, eq.home.x, eq.home.z])
  const L = 6
  return (
    <group position={[eq.home.x, 0, eq.home.z]} onClick={e => { if (isDragRelease(e)) return; e.stopPropagation(); onSelect(eq.id) }}>
      {[-0.36, 0.36].map(z => <mesh key={z} position={[0, 0.82, z]} material={mats.steel}><boxGeometry args={[L, 0.12, 0.06]} /></mesh>)}
      {[-L / 2 + 0.3, 0, L / 2 - 0.3].flatMap(x => [-0.32, 0.32].map(z => (
        <mesh key={`${x}${z}`} position={[x, 0.4, z]} material={mats.dark}><boxGeometry args={[0.05, 0.8, 0.05]} /></mesh>
      )))}
      <mesh position={[0, 0.86, 0]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[L, 0.66]} />
        <meshStandardMaterial map={beltTex} roughness={0.8} />
      </mesh>
      <mesh position={[L / 2 + 0.25, 1.05, 0.5]} material={mats.white}><boxGeometry args={[0.4, 0.5, 0.3]} /></mesh>
    </group>
  )
}

// ── Trucks ───────────────────────────────────────────────

function Truck({ shipment, layout, plan, mats, night, stale, onSelect }: {
  shipment: Shipment
  layout: WarehouseLayout
  plan: SitePlan
  mats: Record<MatKey, THREE.MeshStandardMaterial>
  night: boolean
  stale: boolean
  onSelect: (id: string) => void
}) {
  const root = useRef<THREE.Group>(null)
  const doorL = useRef<THREE.Group>(null)
  const doorR = useRef<THREE.Group>(null)
  const wheelRefs = useRef<(THREE.Mesh | null)[]>([])
  const reverseMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#FFFFFF', emissive: '#FFFFFF', emissiveIntensity: 0, toneMapped: false }), [])
  const headMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#FFF7E0', emissive: '#FFF1C4', emissiveIntensity: 0.4, toneMapped: false }), [])
  useEffect(() => () => { reverseMat.dispose(); headMat.dispose() }, [reverseMat, headMat])
  const { freeze } = getSceneParams()
  const L = TRUCK_LENGTH[shipment.vehicleType]
  const cabL = 2.3
  const cargoL = L - cabL - 0.25
  const cabGeo = useMemo(() => new RoundedBoxGeometry(2.45, 2.3, cabL, 3, 0.18), [])
  useEffect(() => () => cabGeo.dispose(), [cabGeo])
  const wheelGeo = useMemo(() => {
    const g = new THREE.CylinderGeometry(0.5, 0.5, 0.35, 18)
    g.rotateZ(Math.PI / 2)
    return g
  }, [])
  useEffect(() => () => wheelGeo.dispose(), [wheelGeo])
  const axles = useMemo(() => {
    const front = L / 2 - 1.2
    const rear = shipment.vehicleType === 'delivery_truck' ? [-L / 2 + 1.6] : [-L / 2 + 1.4, -L / 2 + 2.7, -L / 2 + 4.0]
    const mid = shipment.vehicleType === 'delivery_truck' ? [] : [L / 2 - 3.6]
    return [front, ...mid, ...rear]
  }, [L, shipment.vehicleType])
  const frozen = useRef<number | null>(null)
  const doorAngle = useRef(0)

  useFrame((_, dt) => {
    const s = useTwinStore.getState()
    const started = s.startedAt[startKey('shipment', shipment.id, shipment.status)]
    let elapsed: number | null = started === undefined || freeze ? null : (Date.now() - started) / 1000
    if (stale) elapsed = frozen.current
    else frozen.current = elapsed
    const pose = truckPose(shipment, layout, plan, elapsed)
    if (!pose || !root.current) return
    root.current.position.set(pose.x, GROUND_Y, pose.z)
    root.current.rotation.y = pose.heading
    const target = pose.doorsOpen ? 1.55 : 0
    doorAngle.current = freeze ? target : THREE.MathUtils.damp(doorAngle.current, target, 3, dt)
    if (doorL.current) doorL.current.rotation.y = -doorAngle.current
    if (doorR.current) doorR.current.rotation.y = doorAngle.current
    wheelRefs.current.forEach(w => { if (w) w.rotation.x = pose.travelled / 0.5 * (pose.reversing ? -1 : 1) })
    reverseMat.emissiveIntensity = pose.reversing ? 5 : 0
    headMat.emissiveIntensity = night || pose.phase === 'arriving' ? 5 : 0.4
    setEntityPosition(shipment.id, pose.x, 2, pose.z)
  })

  const cargoZ = -L / 2 + cargoL / 2
  const cargoMat = shipment.vehicleType === 'container_truck' ? mats.container : mats.white
  return (
    <group ref={root} onClick={e => { if (isDragRelease(e)) return; e.stopPropagation(); onSelect(shipment.id) }}>
      <ContactShadow w={2.6} d={L} />
      {/* Chassis rails */}
      <mesh position={[0, 0.75, 0]} material={mats.dark}><boxGeometry args={[1.0, 0.25, L - 0.4]} /></mesh>
      {/* Cab */}
      <group position={[0, 0, L / 2 - cabL / 2]}>
        <mesh position={[0, 1.95, 0]} geometry={cabGeo} material={mats.body} castShadow />
        <mesh position={[0, 2.5, cabL / 2 + 0.01]} material={mats.glass}><planeGeometry args={[2.1, 0.9]} /></mesh>
        {[-0.85, 0.85].map(x => <mesh key={x} position={[x, 1.25, cabL / 2 + 0.02]} material={headMat}><boxGeometry args={[0.35, 0.18, 0.04]} /></mesh>)}
        <mesh position={[0, 0.95, cabL / 2 + 0.05]} material={mats.dark}><boxGeometry args={[2.4, 0.3, 0.12]} /></mesh>
      </group>
      {/* Cargo body: box, trailer or container */}
      <mesh position={[0, 2.35, cargoZ]} material={cargoMat} castShadow><boxGeometry args={[2.5, 2.6, cargoL]} /></mesh>
      {/* Rear doors hinge at the sides */}
      <group ref={doorL} position={[-1.25, 2.35, -L / 2 + 0.25 - 0.26]}>
        <mesh position={[0.62, 0, -0.02]} material={mats.steel}><boxGeometry args={[1.24, 2.5, 0.05]} /></mesh>
      </group>
      <group ref={doorR} position={[1.25, 2.35, -L / 2 + 0.25 - 0.26]}>
        <mesh position={[-0.62, 0, -0.02]} material={mats.steel}><boxGeometry args={[1.24, 2.5, 0.05]} /></mesh>
      </group>
      {[-1.05, 1.05].map(x => <mesh key={x} position={[x, 0.95, -L / 2 + 0.05]} material={reverseMat}><boxGeometry args={[0.22, 0.12, 0.04]} /></mesh>)}
      {axles.flatMap((z, ai) => [-1.05, 1.05].map((x, si) => (
        <mesh key={`${ai}-${si}`} ref={m => { wheelRefs.current[ai * 2 + si] = m }} position={[x, 0.5, z]} geometry={wheelGeo} material={mats.rubber} />
      )))}
      <SpriteLabel lines={[`${shipment.id} · ${shipment.status.replace('_', ' ')}`]} position={[0, 4.4, 0]} width={2.6} height={0.38} style={{ fg: '#FFFFFF', bg: 'rgba(15,23,42,0.85)', weight: 700 }} />
    </group>
  )
}

export { MOBILE }
