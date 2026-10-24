import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { WarehouseLayout } from '../data/schemas'
import { BRAND_BLUE, GROUND_Y } from '../world/constants'
import { createRng } from '../world/sceneParams'
import { rectCenter, rectD, rectW, type Rect, type SitePlan } from '../world/sitePlan'
import { compose, Label, rbox, useInstanceMatrices } from './Building'
import { useTwinStore } from '../store/twinStore'
import {
  createAsphaltTextures,
  createFenceAlpha,
  createGrassTexture,
  createYardMarkingsTexture,
} from './textures'

interface YardProps {
  layout: WarehouseLayout
  plan: SitePlan
  seed: number
}

function FlatRect({ rect, y, children, receiveShadow = true }: { rect: Rect; y: number; children: React.ReactNode; receiveShadow?: boolean }) {
  const [cx, cz] = rectCenter(rect)
  return (
    <mesh position={[cx, y, cz]} rotation-x={-Math.PI / 2} receiveShadow={receiveShadow}>
      <planeGeometry args={[rectW(rect), rectD(rect)]} />
      {children}
    </mesh>
  )
}

export function Yard({ layout, plan, seed }: YardProps) {
  const site = plan.site
  const wet = useTwinStore(s => s.weather) === 'rain'
  const night = useTwinStore(s => s.timeOfDay) === 'night'
  const textures = useMemo(() => ({
    grass: createGrassTexture(seed, [160, 160]),
    lawn: createGrassTexture(seed + 1, [8, 8]),
    asphalt: createAsphaltTextures(seed, [rectW(site) / 6, rectD(site) / 6]),
    road: createAsphaltTextures(seed + 3, [rectW(site) / 6 + 8, 2]),
    markings: createYardMarkingsTexture(layout, plan),
    fence: createFenceAlpha([1, 1]),
  }), [seed, site, layout, plan])
  useEffect(() => () => {
    textures.grass.dispose()
    textures.lawn.dispose()
    textures.asphalt.map.dispose()
    textures.asphalt.roughnessMap.dispose()
    textures.road.map.dispose()
    textures.road.roughnessMap.dispose()
    textures.markings.dispose()
    textures.fence.dispose()
  }, [textures])

  const road: Rect = { minX: site.minX - 80, maxX: site.maxX + 80, minZ: plan.fence.rect.maxZ + 4, maxZ: plan.fence.rect.maxZ + 14 }

  return (
    <group>
      {/* Surrounding ground */}
      <mesh position={[0, GROUND_Y - 0.03, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[900, 900]} />
        <meshStandardMaterial map={textures.grass} color="#B5C9A3" roughness={1} />
      </mesh>

      {/* Paved site, markings, road */}
      <FlatRect rect={site} y={GROUND_Y - 0.01}>
        {/* Rain is a visual state: a wet, glossier and darker apron */}
        <meshStandardMaterial map={textures.asphalt.map} roughnessMap={wet ? null : textures.asphalt.roughnessMap} roughness={wet ? 0.18 : 0.95} color={wet ? '#9AA2AA' : '#FFFFFF'} envMapIntensity={wet ? 1.6 : 1} />
      </FlatRect>
      <FlatRect rect={site} y={GROUND_Y + 0.004}>
        <meshStandardMaterial map={textures.markings} transparent depthWrite={false} roughness={0.8} polygonOffset polygonOffsetFactor={-1} />
      </FlatRect>
      <FlatRect rect={road} y={GROUND_Y - 0.012}>
        <meshStandardMaterial map={textures.road.map} roughnessMap={textures.road.roughnessMap} roughness={0.95} />
      </FlatRect>
      <FlatRect rect={plan.driveway} y={GROUND_Y - 0.009}>
        <meshStandardMaterial map={textures.asphalt.map} roughness={0.95} />
      </FlatRect>
      <RoadCentreLine road={road} />

      {/* Lawns with kerbs */}
      {plan.lawns.map((l, i) => {
        const [cx, cz] = rectCenter(l)
        return (
          <group key={i} position={[cx, GROUND_Y, cz]}>
            <mesh position-y={0.08} receiveShadow castShadow>
              <boxGeometry args={[rectW(l) + 0.3, 0.16, rectD(l) + 0.3]} />
              <meshStandardMaterial color="#C9CDD2" roughness={0.9} />
            </mesh>
            <mesh position-y={0.165} rotation-x={-Math.PI / 2} receiveShadow>
              <planeGeometry args={[rectW(l), rectD(l)]} />
              <meshStandardMaterial map={textures.lawn} roughness={1} />
            </mesh>
          </group>
        )
      })}

      <Trees plan={plan} seed={seed} />
      <Hedges plan={plan} />
      <Fence plan={plan} alpha={textures.fence} />
      <GateAndBooth plan={plan} />
      <Poles plan={plan} night={night} />
      <Bollards plan={plan} />
    </group>
  )
}

function RoadCentreLine({ road }: { road: Rect }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const matrices = useMemo(() => {
    const out: THREE.Matrix4[] = []
    const z = (road.minZ + road.maxZ) / 2
    for (let x = road.minX; x < road.maxX; x += 6) out.push(compose(x, GROUND_Y + 0.002, z))
    return out
  }, [road])
  useInstanceMatrices(ref, matrices)
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, matrices.length]} frustumCulled={false}>
      <boxGeometry args={[3, 0.005, 0.15]} />
      <meshStandardMaterial color="#F8FAFC" roughness={0.7} />
    </instancedMesh>
  )
}

function Trees({ plan, seed }: { plan: SitePlan; seed: number }) {
  const trunk = useRef<THREE.InstancedMesh>(null)
  const crownA = useRef<THREE.InstancedMesh>(null)
  const crownB = useRef<THREE.InstancedMesh>(null)
  const { trunks, crownsA, crownsB, colors } = useMemo(() => {
    const rng = createRng(seed + 21)
    const y0 = GROUND_Y + 0.16
    const out = { trunks: [] as THREE.Matrix4[], crownsA: [] as THREE.Matrix4[], crownsB: [] as THREE.Matrix4[], colors: [] as THREE.Color[] }
    for (const t of plan.trees) {
      const s = t.scale
      const rot = rng() * Math.PI * 2
      out.trunks.push(compose(t.x, y0 + 1.6 * s, t.z, rot, s, s, s))
      out.crownsA.push(compose(t.x, y0 + 4.0 * s, t.z, rot, 2.4 * s, 2.2 * s, 2.4 * s))
      out.crownsB.push(compose(t.x + 0.6 * s, y0 + 5.2 * s, t.z - 0.4 * s, rot, 1.7 * s, 1.6 * s, 1.7 * s))
      out.colors.push(new THREE.Color().setHSL(0.27 + rng() * 0.05, 0.38 + rng() * 0.12, 0.3 + rng() * 0.08))
    }
    return out
  }, [plan.trees, seed])
  useInstanceMatrices(trunk, trunks)
  useInstanceMatrices(crownA, crownsA)
  useInstanceMatrices(crownB, crownsB)
  useEffect(() => {
    colors.forEach((c, i) => {
      crownA.current?.setColorAt(i, c)
      crownB.current?.setColorAt(i, c.clone().offsetHSL(0, 0, 0.05))
    })
    if (crownA.current?.instanceColor) crownA.current.instanceColor.needsUpdate = true
    if (crownB.current?.instanceColor) crownB.current.instanceColor.needsUpdate = true
  }, [colors])
  const n = Math.max(1, trunks.length)
  return (
    <group>
      <instancedMesh ref={trunk} args={[undefined, undefined, n]} castShadow frustumCulled={false}>
        <cylinderGeometry args={[0.12, 0.2, 3.2, 8]} />
        <meshStandardMaterial color="#6B4F3A" roughness={0.95} />
      </instancedMesh>
      <instancedMesh ref={crownA} args={[undefined, undefined, n]} castShadow frustumCulled={false}>
        <icosahedronGeometry args={[1, 2]} />
        <meshStandardMaterial roughness={0.9} />
      </instancedMesh>
      <instancedMesh ref={crownB} args={[undefined, undefined, n]} castShadow frustumCulled={false}>
        <icosahedronGeometry args={[1, 2]} />
        <meshStandardMaterial roughness={0.9} />
      </instancedMesh>
    </group>
  )
}

function Hedges({ plan }: { plan: SitePlan }) {
  const geos = useMemo(() => plan.hedges.map(h => rbox(h.length, 1.1, 0.9, 0.35, 3)), [plan.hedges])
  useEffect(() => () => geos.forEach(g => g.dispose()), [geos])
  return (
    <group>
      {plan.hedges.map((h, i) => (
        <mesh key={i} position={[h.x, GROUND_Y + 0.55, h.z]} rotation-y={h.rotationY} geometry={geos[i]} castShadow receiveShadow>
          <meshStandardMaterial color="#4E7A3E" roughness={0.95} />
        </mesh>
      ))}
    </group>
  )
}

function Fence({ plan, alpha }: { plan: SitePlan; alpha: THREE.Texture }) {
  const r = plan.fence.rect
  const gate = plan.fence.gate
  const H = 2.4
  // Straight runs, leaving a gap for the vehicle gate
  const runs = useMemo(() => {
    const g0 = gate.x - gate.width / 2 - 1.5
    const g1 = gate.x + gate.width / 2 + 1.5
    return [
      { a: [r.minX, r.minZ], b: [r.maxX, r.minZ] },
      { a: [r.maxX, r.minZ], b: [r.maxX, r.maxZ] },
      { a: [r.minX, r.minZ], b: [r.minX, r.maxZ] },
      { a: [r.minX, r.maxZ], b: [g0, r.maxZ] },
      { a: [g1, r.maxZ], b: [r.maxX, r.maxZ] },
    ] as { a: [number, number]; b: [number, number] }[]
  }, [r, gate])

  const posts = useRef<THREE.InstancedMesh>(null)
  const postMatrices = useMemo(() => {
    const out: THREE.Matrix4[] = []
    for (const run of runs) {
      const len = Math.hypot(run.b[0] - run.a[0], run.b[1] - run.a[1])
      const n = Math.max(1, Math.round(len / 3))
      for (let i = 0; i <= n; i++) {
        const t = i / n
        out.push(compose(run.a[0] + (run.b[0] - run.a[0]) * t, GROUND_Y + H / 2, run.a[1] + (run.b[1] - run.a[1]) * t))
      }
    }
    return out
  }, [runs])
  useInstanceMatrices(posts, postMatrices)

  const panelTextures = useMemo(() => runs.map(run => {
    const tex = alpha.clone()
    tex.repeat.set(Math.hypot(run.b[0] - run.a[0], run.b[1] - run.a[1]) / 0.6, H / 0.6)
    tex.needsUpdate = true
    return tex
  }), [runs, alpha])
  useEffect(() => () => panelTextures.forEach(t => t.dispose()), [panelTextures])

  return (
    <group>
      <instancedMesh ref={posts} args={[undefined, undefined, postMatrices.length]} castShadow frustumCulled={false}>
        <cylinderGeometry args={[0.045, 0.045, H, 8]} />
        <meshStandardMaterial color="#64748B" metalness={0.7} roughness={0.35} />
      </instancedMesh>
      {runs.map((run, i) => {
        const len = Math.hypot(run.b[0] - run.a[0], run.b[1] - run.a[1])
        const rot = -Math.atan2(run.b[1] - run.a[1], run.b[0] - run.a[0])
        return (
          <mesh key={i} position={[(run.a[0] + run.b[0]) / 2, GROUND_Y + H / 2, (run.a[1] + run.b[1]) / 2]} rotation-y={rot}>
            <planeGeometry args={[len, H]} />
            <meshStandardMaterial color="#7C8794" metalness={0.6} roughness={0.4} alphaMap={panelTextures[i]} alphaTest={0.5} side={THREE.DoubleSide} />
          </mesh>
        )
      })}
    </group>
  )
}

function GateAndBooth({ plan }: { plan: SitePlan }) {
  const { gate } = plan.fence
  const b = plan.guardBooth
  const boothGeo = useMemo(() => rbox(3.2, 2.7, 2.6, 0.12), [])
  const roofGeo = useMemo(() => rbox(4.0, 0.22, 3.4, 0.08), [])
  useEffect(() => () => { boothGeo.dispose(); roofGeo.dispose() }, [boothGeo, roofGeo])
  const y0 = GROUND_Y
  return (
    <group>
      {/* Gate posts */}
      {[-1, 1].map(s => (
        <mesh key={s} position={[gate.x + s * (gate.width / 2 + 1.2), y0 + 1.4, gate.z]} castShadow>
          <boxGeometry args={[0.35, 2.8, 0.35]} />
          <meshStandardMaterial color="#475569" metalness={0.6} roughness={0.4} />
        </mesh>
      ))}
      {/* Boom barrier (lowered; prop only) */}
      <mesh position={[gate.x + gate.width / 2 + 0.6, y0 + 0.55, gate.z + 0.6]} castShadow>
        <boxGeometry args={[0.45, 1.1, 0.45]} />
        <meshStandardMaterial color="#E2E8F0" metalness={0.4} roughness={0.4} />
      </mesh>
      <mesh position={[gate.x, y0 + 1.0, gate.z + 0.6]} rotation-z={Math.PI / 2} castShadow>
        <cylinderGeometry args={[0.05, 0.05, gate.width + 1, 10]} />
        <meshStandardMaterial color="#F8FAFC" roughness={0.5} />
      </mesh>
      {Array.from({ length: Math.floor(gate.width / 1.2) }, (_, i) => (
        <mesh key={i} position={[gate.x - gate.width / 2 + 0.6 + i * 1.2, y0 + 1.0, gate.z + 0.6]} rotation-z={Math.PI / 2}>
          <cylinderGeometry args={[0.052, 0.052, 0.5, 10]} />
          <meshStandardMaterial color="#DC2626" roughness={0.5} />
        </mesh>
      ))}

      {/* Guard booth */}
      <group position={[b.x, y0, b.z]}>
        <mesh position-y={0.1}>
          <boxGeometry args={[4.2, 0.2, 3.6]} />
          <meshStandardMaterial color="#B8BEC5" roughness={0.9} />
        </mesh>
        <mesh position-y={1.55} geometry={boothGeo} castShadow receiveShadow>
          <meshStandardMaterial color="#F1F5F9" roughness={0.5} metalness={0.1} />
        </mesh>
        {[1.31, -1.31].map(z => (
          <mesh key={z} position={[0, 1.85, z]}>
            <boxGeometry args={[2.6, 1.0, 0.02]} />
            <meshPhysicalMaterial color="#9CC3E6" roughness={0.1} metalness={0.2} transparent opacity={0.6} />
          </mesh>
        ))}
        <mesh position-y={3.0} geometry={roofGeo} castShadow>
          <meshStandardMaterial color={BRAND_BLUE} metalness={0.5} roughness={0.35} />
        </mesh>
        <Label lines={['SECURITY']} width={1.8} height={0.36} position={[0, 2.62, 1.32]} style={{ fg: '#FFFFFF', bg: BRAND_BLUE, weight: 800 }} />
      </group>
    </group>
  )
}

function Poles({ plan, night }: { plan: SitePlan; night: boolean }) {
  const pole = useRef<THREE.InstancedMesh>(null)
  const head = useRef<THREE.InstancedMesh>(null)
  const cctvPole = useRef<THREE.InstancedMesh>(null)
  const cctvCam = useRef<THREE.InstancedMesh>(null)
  const headGeo = useMemo(() => rbox(0.9, 0.16, 0.4, 0.06), [])
  const camGeo = useMemo(() => rbox(0.45, 0.2, 0.2, 0.05), [])
  useEffect(() => () => { headGeo.dispose(); camGeo.dispose() }, [headGeo, camGeo])
  const m = useMemo(() => ({
    poles: plan.lightPoles.map(p => compose(p.x, GROUND_Y + 4.5, p.z)),
    heads: plan.lightPoles.map(p => compose(p.x, GROUND_Y + 9, p.z)),
    cctvPoles: plan.cctvPoles.map(p => compose(p.x, GROUND_Y + 3, p.z)),
    cctvCams: plan.cctvPoles.map(p => compose(p.x, GROUND_Y + 5.9, p.z, p.rotationY)),
  }), [plan])
  useInstanceMatrices(pole, m.poles)
  useInstanceMatrices(head, m.heads)
  useInstanceMatrices(cctvPole, m.cctvPoles)
  useInstanceMatrices(cctvCam, m.cctvCams)
  return (
    <group>
      <instancedMesh ref={pole} args={[undefined, undefined, m.poles.length]} castShadow frustumCulled={false}>
        <cylinderGeometry args={[0.07, 0.12, 9, 10]} />
        <meshStandardMaterial color="#94A3B8" metalness={0.8} roughness={0.3} />
      </instancedMesh>
      <instancedMesh ref={head} args={[headGeo, undefined, m.heads.length]} frustumCulled={false}>
        <meshStandardMaterial color="#CBD5E1" emissive="#FFF1D6" emissiveIntensity={night ? 6 : 1.2} metalness={0.6} roughness={0.3} toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={cctvPole} args={[undefined, undefined, m.cctvPoles.length]} castShadow frustumCulled={false}>
        <cylinderGeometry args={[0.06, 0.08, 6, 8]} />
        <meshStandardMaterial color="#E2E8F0" metalness={0.6} roughness={0.35} />
      </instancedMesh>
      <instancedMesh ref={cctvCam} args={[camGeo, undefined, m.cctvCams.length]} frustumCulled={false}>
        <meshStandardMaterial color="#F8FAFC" metalness={0.3} roughness={0.35} />
      </instancedMesh>
    </group>
  )
}

function Bollards({ plan }: { plan: SitePlan }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const matrices = useMemo(() => {
    const out: THREE.Matrix4[] = []
    const door = plan.openings.find(o => o.kind === 'personnel')
    if (door) {
      for (const dx of [-3.2, -1.6, 1.6, 3.2]) out.push(compose(door.along + dx, GROUND_Y + 0.5, plan.footprint.maxZ + 4.6))
    }
    const b = plan.guardBooth
    out.push(compose(b.x - 2.4, GROUND_Y + 0.5, b.z + 2.2), compose(b.x + 2.4, GROUND_Y + 0.5, b.z + 2.2))
    return out
  }, [plan])
  useInstanceMatrices(ref, matrices)
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, matrices.length]} castShadow frustumCulled={false}>
      <cylinderGeometry args={[0.11, 0.11, 1.0, 14]} />
      <meshStandardMaterial color="#475569" metalness={0.6} roughness={0.35} />
    </instancedMesh>
  )
}
