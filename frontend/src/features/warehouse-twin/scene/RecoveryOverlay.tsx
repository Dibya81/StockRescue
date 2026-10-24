import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Disruption, InventoryLot, RecoveryBundle, Shipment, WarehouseLayout } from '../data/schemas'
import { BRAND_BLUE, GROUND_Y } from '../world/constants'
import { layoutToWorld } from '../world/layoutToWorld'
import { getSceneParams } from '../world/sceneParams'
import { actionViews, delayedShipments, shortageMarkers, shownOption, type ActionView } from '../world/planVisual'
import { TRUCK_LENGTH } from '../world/poses'
import type { SitePlan } from '../world/sitePlan'
import type { ViewMode } from '../store/twinStore'
import { sceneStats } from './registry'
import { SpriteLabel } from './Building'

interface OverlayProps {
  layout: WarehouseLayout
  plan: SitePlan
  lots: InventoryLot[]
  disruptions: Disruption[]
  recovery: RecoveryBundle | null
  shipments: Shipment[]
  viewMode: ViewMode
}

const GHOST_BLUE = '#3B82F6'
const unitBox = new THREE.BoxGeometry(1, 1, 1)
const unitEdges = new THREE.EdgesGeometry(unitBox)

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

const dashVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const dashFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uDashes;
  varying vec2 vUv;
  void main() {
    float d = fract(vUv.x * uDashes - uTime);
    if (d > 0.55) discard;
    gl_FragColor = vec4(uColor, 0.95);
  }
`

/** Where an action's goods come from: a rack position or a dock door. */
function sourcePoint(layout: WarehouseLayout, view: ActionView): THREE.Vector3 | null {
  const a = view.action
  if (a.fromPositionId) {
    const t = layoutToWorld(layout, a.fromPositionId)
    return t ? new THREE.Vector3(t.position[0], t.position[1] + 0.9, t.position[2]) : null
  }
  if (a.dockId) {
    const d = layout.docks.find(x => x.id === a.dockId)
    return d ? new THREE.Vector3(d.x, 1.6, d.z - 1.2) : null
  }
  return null
}

export function RecoveryOverlay({ layout, plan, lots, disruptions, recovery, shipments, viewMode }: OverlayProps) {
  const { freeze } = getSceneParams()
  const animate = !freeze && !prefersReducedMotion()

  const views = useMemo(() => {
    if (!recovery?.plan) return []
    return actionViews(recovery.plan, shownOption(recovery.plan, recovery.approvals), lots)
  }, [recovery, lots])

  const showProposal = viewMode === 'proposed'
  const showOps = viewMode !== 'after'
  const ghosts = showProposal ? views.filter(v => v.ghost && v.action.toPositionId) : []
  const completed = showProposal ? views.filter(v => v.solid) : []

  const delays = useMemo(() => (showOps ? delayedShipments(shipments, disruptions, Date.now()) : []), [shipments, disruptions, showOps])
  const shortages = useMemo(() => (showOps ? shortageMarkers(disruptions, lots) : []), [disruptions, lots, showOps])
  const inbound = showOps ? shipments.filter(s => s.status === 'scheduled' && s.dockId && !delays.some(d => d.shipment.id === s.id)) : []

  useEffect(() => {
    sceneStats.ghosts = ghosts.length
    sceneStats.solidActions = completed.length
    sceneStats.delayBeacons = delays.length
    sceneStats.shortageMarkers = shortages.length
  }, [ghosts.length, completed.length, delays.length, shortages.length])

  // ── Hatched ghost material ──
  const hatch = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = c.height = 64
    const ctx = c.getContext('2d')!
    ctx.fillStyle = 'rgba(59,130,246,0.35)'
    ctx.fillRect(0, 0, 64, 64)
    ctx.strokeStyle = 'rgba(219,234,254,0.95)'
    ctx.lineWidth = 6
    for (let k = -64; k < 128; k += 16) {
      ctx.beginPath()
      ctx.moveTo(k, 0)
      ctx.lineTo(k + 64, 64)
      ctx.stroke()
    }
    const t = new THREE.CanvasTexture(c)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(2, 2)
    return t
  }, [])
  const ghostMat = useMemo(() => new THREE.MeshBasicMaterial({ map: hatch, color: '#BFDBFE', transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }), [hatch])
  const pulseMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#22C55E', transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false }), [])
  const arcMats = useRef<THREE.ShaderMaterial[]>([])
  useEffect(() => () => { hatch.dispose(); ghostMat.dispose(); pulseMat.dispose() }, [hatch, ghostMat, pulseMat])

  const arcs = useMemo(() => ghosts.flatMap(v => {
    const from = sourcePoint(layout, v)
    const to = layoutToWorld(layout, v.action.toPositionId!)
    if (!from || !to) return []
    const end = new THREE.Vector3(to.position[0], to.position[1] + 1.25, to.position[2])
    const mid = from.clone().lerp(end, 0.5)
    mid.y += Math.max(3.5, from.distanceTo(end) * 0.28)
    const curve = new THREE.QuadraticBezierCurve3(from, mid, end)
    const geo = new THREE.TubeGeometry(curve, 72, 0.055, 6, false)
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(v.state === 'executing' ? '#2563EB' : GHOST_BLUE) }, uDashes: { value: Math.max(8, Math.round(curve.getLength() / 0.8)) } },
      vertexShader: dashVertex,
      fragmentShader: dashFragment,
      transparent: true,
    })
    return [{ id: v.action.id, geo, mat, apex: curve.getPoint(0.5), from, view: v }]
  }), [ghosts, layout])
  useEffect(() => {
    arcMats.current = arcs.map(a => a.mat)
    return () => arcs.forEach(a => { a.geo.dispose(); a.mat.dispose() })
  }, [arcs])

  const pulseRef = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    for (const m of arcMats.current) m.uniforms.uTime.value = animate ? t * 0.9 : 0
    ghostMat.opacity = animate ? 0.5 + 0.12 * Math.sin(t * 2.5) : 0.58
    if (pulseRef.current) {
      const k = animate ? (t % 2) / 2 : 0.5
      pulseMat.opacity = 0.65 * (1 - k)
      pulseRef.current.children.forEach(c => c.scale.setScalar(0.6 + k * 1.6))
    }
  })

  const allocations = showProposal ? (recovery?.plan?.allocations ?? []).filter(a => a.status !== 'put_away') : []

  return (
    <group>
      {/* AI proposals: ghost pallets at destinations, never solid until inventory lands */}
      {ghosts.map(v => {
        const t = layoutToWorld(layout, v.action.toPositionId!)
        if (!t) return null
        const w = Math.min(0.8, t.size[0] - 0.1)
        const y = t.position[1] + 0.15 + 0.5
        return (
          <group key={v.action.id}>
            <mesh geometry={unitBox} material={ghostMat} position={[t.position[0], y, t.position[2]]} rotation-y={t.rotationY} scale={[w, 1.0, 1.15]} renderOrder={8} />
            <lineSegments geometry={unitEdges} position={[t.position[0], y, t.position[2]]} rotation-y={t.rotationY} scale={[w + 0.02, 1.02, 1.17]} renderOrder={9}>
              <lineBasicMaterial color={GHOST_BLUE} transparent opacity={0.95} depthTest={false} toneMapped={false} />
            </lineSegments>
            <SpriteLabel
              lines={[`${v.action.seq} · AI PROPOSAL, NOT EXECUTED`, `${v.action.qty} × ${v.action.sku}${v.state === 'executing' ? ' · approved, executing' : ''}`]}
              position={[t.position[0], y + 0.95, t.position[2]]}
              width={2.6}
              height={0.5}
              style={{ fg: '#1E3A8A', bg: 'rgba(239,246,255,0.95)', border: '#3B82F6', weight: 700 }}
            />
          </group>
        )
      })}

      {/* Dashed arcs and source frames */}
      {arcs.map(a => (
        <group key={a.id}>
          <mesh geometry={a.geo} material={a.mat} renderOrder={7} />
          <lineSegments geometry={unitEdges} position={a.from} scale={[0.9, 1.0, 1.2]}>
            <lineBasicMaterial color={GHOST_BLUE} transparent opacity={0.8} depthTest={false} toneMapped={false} />
          </lineSegments>
          <SpriteLabel lines={[String(a.view.action.seq)]} position={a.apex} width={0.5} height={0.5} style={{ fg: '#FFFFFF', bg: BRAND_BLUE, weight: 800, border: '#FFFFFF' }} />
        </group>
      ))}

      {/* Completed actions: success pulse where inventory.updated landed */}
      <group ref={pulseRef}>
        {completed.map(v => {
          const t = layoutToWorld(layout, v.action.toPositionId!)
          if (!t) return null
          return (
            <mesh key={v.action.id} position={[t.position[0], t.position[1] + 0.05, t.position[2]]} rotation-x={-Math.PI / 2} material={pulseMat}>
              <ringGeometry args={[0.55, 0.7, 40]} />
            </mesh>
          )
        })}
      </group>

      {/* Allocation frames on destination positions */}
      {allocations.map(a => {
        const t = layoutToWorld(layout, a.destinationPositionId)
        if (!t) return null
        return (
          <lineSegments key={a.id} geometry={unitEdges} position={[t.position[0], t.position[1] + 0.7, t.position[2]]} rotation-y={t.rotationY} scale={[t.size[0] - 0.04, 1.4, t.size[2] + 0.12]}>
            <lineBasicMaterial color="#06B6D4" transparent opacity={0.9} toneMapped={false} />
          </lineSegments>
        )
      })}

      {/* Delay beacons: ghost outline of the expected truck, never a truck */}
      {delays.map(d => {
        const dock = layout.docks.find(x => x.id === d.shipment.dockId)
        if (!dock) return null
        const L = TRUCK_LENGTH[d.shipment.vehicleType]
        const z = plan.footprint.maxZ + L / 2 + 0.35
        return (
          <group key={d.shipment.id}>
            <DashedBox position={[dock.x, GROUND_Y + 1.85, z]} size={[2.5, 3.7, L]} color="#F97316" />
            <mesh position={[dock.x + 1.9, GROUND_Y + 2.2, plan.footprint.maxZ + 2]}>
              <cylinderGeometry args={[0.04, 0.04, 4.4, 8]} />
              <meshStandardMaterial color="#9A3412" />
            </mesh>
            <SpriteLabel
              lines={[`${d.reason === 'supplier_failed' ? 'DISRUPTED INBOUND' : `DELAYED ${d.hoursLate} h`} · ${d.shipment.id}`, `${d.shipment.supplier.name}${d.eta ? ` · ETA ${new Date(d.eta).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}`]}
              position={[dock.x + 1.9, GROUND_Y + 4.9, plan.footprint.maxZ + 2]}
              width={3.6}
              height={0.8}
              style={{ fg: '#7C2D12', bg: 'rgba(255,247,237,0.96)', border: '#F97316', weight: 700 }}
            />
          </group>
        )
      })}

      {/* Scheduled inbound markers at their docks */}
      {inbound.map(s => {
        const dock = layout.docks.find(x => x.id === s.dockId)
        if (!dock) return null
        return (
          <group key={s.id} position={[dock.x, 4.7, dock.z + 0.8]}>
            <mesh rotation-x={Math.PI}>
              <coneGeometry args={[0.25, 0.5, 12]} />
              <meshStandardMaterial color="#06B6D4" emissive="#06B6D4" emissiveIntensity={1.2} />
            </mesh>
            <SpriteLabel lines={[`Inbound ${s.id}`]} position={[0, 0.6, 0]} width={1.8} height={0.32} style={{ fg: '#155E75', bg: 'rgba(236,254,255,0.95)', weight: 700 }} />
          </group>
        )
      })}

      {/* Shortage markers with the gap from the disruption record */}
      {shortages.map((m, i) => {
        const t = layoutToWorld(layout, m.positionId)
        if (!t) return null
        return (
          <group key={`${m.positionId}-${i}`} position={[t.position[0], t.position[1] + 1.55, t.position[2]]}>
            <mesh position={[0, -0.2, 0]} rotation-x={Math.PI}>
              <coneGeometry args={[0.12, 0.3, 10]} />
              <meshStandardMaterial color="#DC2626" emissive="#DC2626" emissiveIntensity={0.8} />
            </mesh>
            <SpriteLabel lines={[`Gap ${m.gapQty} ${m.unit} · ${m.sku}`]} position={[0, 0.15, 0]} width={2.2} height={0.3} style={{ fg: '#991B1B', bg: 'rgba(254,242,242,0.96)', weight: 800 }} />
          </group>
        )
      })}
    </group>
  )
}

function DashedBox({ position, size, color }: { position: [number, number, number]; size: [number, number, number]; color: string }) {
  const [sx, sy, sz] = size
  const line = useMemo(() => {
    const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(sx, sy, sz))
    const l = new THREE.LineSegments(geo, new THREE.LineDashedMaterial({ color, dashSize: 0.4, gapSize: 0.25 }))
    l.computeLineDistances()
    return l
  }, [sx, sy, sz, color])
  useEffect(() => () => {
    line.geometry.dispose()
    ;(line.material as THREE.Material).dispose()
  }, [line])
  return <primitive object={line} position={position} />
}

export { BRAND_BLUE }
