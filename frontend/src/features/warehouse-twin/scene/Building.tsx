import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { WarehouseLayout } from '../data/schemas'
import { BRAND_BLUE, COLUMN_SIZE, GROUND_Y, WALL_THICKNESS } from '../world/constants'
import { rectD, rectW, type SitePlan, type WallOpening, type WallSide } from '../world/sitePlan'
import { getSceneParams } from '../world/sceneParams'
import { createCladdingNormal, createLabelTexture } from './textures'
import { useTwinStore } from '../store/twinStore'

// ── Shared helpers ───────────────────────────────────────

export function rbox(w: number, h: number, d: number, r = 0.03, seg = 2): THREE.BufferGeometry {
  return new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3))
}

/** Places instances of an InstancedMesh from a list of matrices. */
export function useInstanceMatrices(ref: React.RefObject<THREE.InstancedMesh | null>, matrices: THREE.Matrix4[]) {
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m))
    mesh.count = matrices.length
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [ref, matrices])
}

export function compose(x: number, y: number, z: number, rotY = 0, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY),
    new THREE.Vector3(sx, sy, sz),
  )
}

/** A text label on a plane, sized in metres. */
export function Label({ lines, width, height, position, rotationY = 0, style, emissive = 0 }: {
  lines: string[]
  width: number
  height: number
  position: [number, number, number]
  rotationY?: number
  style?: Parameters<typeof createLabelTexture>[3]
  emissive?: number
}) {
  const key = JSON.stringify([lines, width, height, style])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tex = useMemo(() => createLabelTexture(lines, height, width, style), [key])
  useEffect(() => () => tex.dispose(), [tex])
  return (
    <mesh position={position} rotation-y={rotationY}>
      <planeGeometry args={[width, height]} />
      <meshStandardMaterial
        map={tex}
        transparent={!style?.bg}
        emissive={emissive > 0 ? '#ffffff' : '#000000'}
        emissiveMap={emissive > 0 ? tex : null}
        emissiveIntensity={emissive}
        toneMapped={emissive <= 0}
        roughness={0.6}
        polygonOffset
        polygonOffsetFactor={-2}
      />
    </mesh>
  )
}

// ── Walls ────────────────────────────────────────────────

interface WallSpec {
  side: WallSide
  length: number
  position: [number, number, number]
  rotationY: number
  /** Outward normal in world XZ */
  normal: [number, number]
}

function wallSpecs(plan: SitePlan): WallSpec[] {
  const fp = plan.footprint
  const t = WALL_THICKNESS
  const W = rectW(fp)
  const D = rectD(fp)
  return [
    { side: 'south', length: W + t, position: [0, GROUND_Y, fp.maxZ - t / 2], rotationY: 0, normal: [0, 1] },
    { side: 'north', length: W + t, position: [0, GROUND_Y, fp.minZ - t / 2], rotationY: 0, normal: [0, -1] },
    { side: 'east', length: D - t, position: [fp.maxX + t / 2, GROUND_Y, 0], rotationY: -Math.PI / 2, normal: [1, 0] },
    { side: 'west', length: D - t, position: [fp.minX + t / 2, GROUND_Y, 0], rotationY: -Math.PI / 2, normal: [-1, 0] },
  ]
}

/** Whether the wall's outer face is at local z = WALL_THICKNESS (else at 0). */
const outerAtT = (side: WallSide) => side === 'south' || side === 'west'

function wallGeometry(spec: WallSpec, height: number, openings: WallOpening[], centerAlong: number): THREE.BufferGeometry {
  const half = spec.length / 2
  const shape = new THREE.Shape()
  shape.moveTo(-half, 0)
  shape.lineTo(half, 0)
  shape.lineTo(half, height)
  shape.lineTo(-half, height)
  shape.closePath()
  for (const o of openings) {
    const u = o.along - centerAlong
    const v0 = o.sill - GROUND_Y
    const hole = new THREE.Path()
    hole.moveTo(u - o.width / 2, v0)
    hole.lineTo(u - o.width / 2, v0 + o.height)
    hole.lineTo(u + o.width / 2, v0 + o.height)
    hole.lineTo(u + o.width / 2, v0)
    hole.closePath()
    shape.holes.push(hole)
  }
  return new THREE.ExtrudeGeometry(shape, { depth: WALL_THICKNESS, bevelEnabled: false })
}

interface FadeTarget {
  materials: THREE.Material[]
  opacity: number
}

function setFade(t: FadeTarget, target: number, dt: number) {
  t.opacity = THREE.MathUtils.damp(t.opacity, target, 6, dt)
  const o = t.opacity
  for (const m of t.materials) {
    m.opacity = o
    m.depthWrite = o > 0.97
    m.visible = o > 0.02
  }
}

// ── Building ─────────────────────────────────────────────

interface BuildingProps {
  layout: WarehouseLayout
  plan: SitePlan
  cutaway: boolean
}

export function Building({ layout, plan, cutaway }: BuildingProps) {
  const fp = plan.footprint
  const { clear, roof, parapetTop } = plan.heights
  const wallHeight = parapetTop - GROUND_Y
  const specs = useMemo(() => wallSpecs(plan), [plan])

  const claddingNormal = useMemo(() => createCladdingNormal([4, 1]), [])
  useEffect(() => () => claddingNormal.dispose(), [claddingNormal])

  // One material set per wall so near walls fade independently
  const wallMats = useMemo(() => specs.map(() => ({
    cladding: new THREE.MeshStandardMaterial({
      color: '#E8EBEF', metalness: 0.35, roughness: 0.42, normalMap: claddingNormal,
      normalScale: new THREE.Vector2(0.9, 0.9), transparent: true, side: THREE.DoubleSide,
    }),
    plinth: new THREE.MeshStandardMaterial({ color: '#9CA3AB', roughness: 0.92, transparent: true }),
    fascia: new THREE.MeshStandardMaterial({ color: BRAND_BLUE, metalness: 0.5, roughness: 0.35, transparent: true }),
    cap: new THREE.MeshStandardMaterial({ color: '#C7CDD4', metalness: 0.8, roughness: 0.3, transparent: true }),
  })), [specs, claddingNormal])
  useEffect(() => () => wallMats.forEach(m => Object.values(m).forEach(x => x.dispose())), [wallMats])

  const wallGeos = useMemo(
    () => specs.map(spec => wallGeometry(spec, wallHeight, plan.openings.filter(o => o.side === spec.side), 0)),
    [specs, wallHeight, plan.openings],
  )
  useEffect(() => () => wallGeos.forEach(g => g.dispose()), [wallGeos])

  // ── Roof ──
  const roofGeo = useMemo(() => {
    const s = new THREE.Shape()
    s.moveTo(fp.minX, -fp.minZ)
    s.lineTo(fp.maxX, -fp.minZ)
    s.lineTo(fp.maxX, -fp.maxZ)
    s.lineTo(fp.minX, -fp.maxZ)
    s.closePath()
    for (const sk of plan.skylights) {
      const h = new THREE.Path()
      h.moveTo(sk.minX, -sk.minZ)
      h.lineTo(sk.minX, -sk.maxZ)
      h.lineTo(sk.maxX, -sk.maxZ)
      h.lineTo(sk.maxX, -sk.minZ)
      h.closePath()
      s.holes.push(h)
    }
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.25, bevelEnabled: false })
    g.rotateX(-Math.PI / 2)
    return g
  }, [fp, plan.skylights])
  useEffect(() => () => roofGeo.dispose(), [roofGeo])

  const roofMats = useMemo(() => ({
    deck: new THREE.MeshStandardMaterial({ color: '#D9DEE4', metalness: 0.2, roughness: 0.7, transparent: true, side: THREE.DoubleSide }),
    skylight: new THREE.MeshPhysicalMaterial({ color: '#E6F0FF', roughness: 0.25, metalness: 0, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
    shadow: new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
  }), [])
  useEffect(() => () => Object.values(roofMats).forEach(m => m.dispose()), [roofMats])

  // ── Trusses ──
  const trussGeo = useMemo(() => {
    const parts: THREE.BufferGeometry[] = []
    const span = rectD(fp) - WALL_THICKNESS
    const z0 = fp.minZ + WALL_THICKNESS / 2
    const chord = (y: number) => {
      const g = new THREE.BoxGeometry(0.16, 0.2, span)
      g.translate(0, y, z0 + span / 2)
      return g
    }
    parts.push(chord(clear + 0.1), chord(roof - 0.12))
    const panel = 3
    const n = Math.floor(span / panel)
    const h = roof - clear - 0.22
    for (let i = 0; i <= n; i++) {
      const z = z0 + i * (span / n)
      const v = new THREE.BoxGeometry(0.1, h, 0.1)
      v.translate(0, clear + 0.1 + h / 2, z)
      parts.push(v)
      if (i < n) {
        const len = Math.hypot(span / n, h)
        const d = new THREE.BoxGeometry(0.08, len, 0.08)
        d.rotateX((i % 2 === 0 ? 1 : -1) * Math.atan2(span / n, h))
        d.translate(0, clear + 0.1 + h / 2, z + span / n / 2)
        parts.push(d)
      }
    }
    const merged = mergeGeometries(parts)
    parts.forEach(p => p.dispose())
    return merged
  }, [fp, clear, roof])
  useEffect(() => () => trussGeo.dispose(), [trussGeo])

  const trussRef = useRef<THREE.InstancedMesh>(null)
  const trussMatrices = useMemo(() => plan.trusses.map(x => compose(x, 0, 0)), [plan.trusses])
  useInstanceMatrices(trussRef, trussMatrices)

  // ── Columns, pilasters, guards ──
  const columnGeo = useMemo(() => rbox(COLUMN_SIZE, clear, COLUMN_SIZE, 0.04), [clear])
  const guardGeo = useMemo(() => rbox(0.75, 1.0, 0.75, 0.08), [])
  useEffect(() => () => { columnGeo.dispose(); guardGeo.dispose() }, [columnGeo, guardGeo])
  const columnRef = useRef<THREE.InstancedMesh>(null)
  const guardRef = useRef<THREE.InstancedMesh>(null)
  const columnMatrices = useMemo(() => {
    const inset = WALL_THICKNESS / 2 + COLUMN_SIZE / 2
    const pil = plan.pilasters.map(p => {
      const x = Math.min(Math.max(p.x, fp.minX + inset), fp.maxX - inset)
      const z = Math.min(Math.max(p.z, fp.minZ + inset), fp.maxZ - inset)
      return compose(x, clear / 2, z)
    })
    return [...plan.columns.map(c => compose(c.x, clear / 2, c.z)), ...pil]
  }, [plan.columns, plan.pilasters, fp, clear])
  const guardMatrices = useMemo(() => plan.columns.map(c => compose(c.x, 0.5, c.z)), [plan.columns])
  useInstanceMatrices(columnRef, columnMatrices)
  useInstanceMatrices(guardRef, guardMatrices)

  // ── Light strips ──
  const stripGeo = useMemo(() => rbox(0.3, 0.08, 4.2, 0.03), [])
  useEffect(() => () => stripGeo.dispose(), [stripGeo])
  const stripRef = useRef<THREE.InstancedMesh>(null)
  const stripMatrices = useMemo(() => plan.lightStrips.map(s => compose(s.x, clear - 0.35, s.z)), [plan.lightStrips, clear])
  useInstanceMatrices(stripRef, stripMatrices)

  // ── Fades: roof when looking down from inside the footprint, near walls in cutaway ──
  const fades = useRef({
    roof: { materials: [roofMats.deck, roofMats.skylight], opacity: 1 } as FadeTarget,
    walls: wallMats.map(m => ({ materials: Object.values(m), opacity: 1 } as FadeTarget)),
  })
  useEffect(() => {
    fades.current = {
      roof: { materials: [roofMats.deck, roofMats.skylight], opacity: fades.current.roof.opacity },
      walls: wallMats.map((m, i) => ({ materials: Object.values(m), opacity: fades.current.walls[i]?.opacity ?? 1 })),
    }
  }, [roofMats, wallMats])

  const freeze = getSceneParams().freeze
  const raining = useTwinStore(s => s.weather) === 'rain'
  useEffect(() => {
    // Rain: skylights read darker and wetter (visual state only)
    roofMats.skylight.color.set(raining ? '#AEB9C6' : '#E6F0FF')
    roofMats.skylight.roughness = raining ? 0.05 : 0.25
  }, [raining, roofMats])
  useFrame(({ camera }, delta) => {
    const dt = freeze ? 10 : delta
    const { x, y, z } = camera.position
    const inside = x > fp.minX && x < fp.maxX && z > fp.minZ && z < fp.maxZ
    const above = y > roof
    const roofGone = cutaway || (inside && above)
    // Skylight glass keeps its base translucency
    const f = fades.current
    setFade(f.roof, roofGone ? 0 : 1, dt)
    roofMats.skylight.opacity = Math.min(f.roof.opacity, 0.5)
    specs.forEach((spec, i) => {
      // Signed distance from the wall plane, positive outside the building
      const dist = spec.normal[0] !== 0 ? (x - spec.position[0]) * spec.normal[0] : (z - spec.position[2]) * spec.normal[1]
      // Near walls fade only in cutaway (walls between camera and interior) or when looking down from inside above the eaves
      const near = cutaway ? dist > -1 : inside && above && dist > -14
      setFade(f.walls[i], near ? 0.07 : 1, dt)
    })
  })

  const signLines = useMemo(() => [layout.name.toUpperCase()], [layout.name])
  const entrance = plan.openings.find(o => o.kind === 'personnel')

  return (
    <group>
      {/* Walls */}
      {specs.map((spec, i) => (
        <group key={spec.side} position={spec.position} rotation-y={spec.rotationY}>
          <mesh geometry={wallGeos[i]} material={wallMats[i].cladding} castShadow receiveShadow />
          {/* Concrete plinth (dock face) and blue fascia on the outer face */}
          <mesh position={[0, (0 - GROUND_Y) / 2, outerAtT(spec.side) ? WALL_THICKNESS + 0.03 : -0.03]} material={wallMats[i].plinth} receiveShadow>
            <boxGeometry args={[spec.length + 0.12, -GROUND_Y + 0.02, 0.06]} />
          </mesh>
          <mesh position={[0, wallHeight - 0.75, outerAtT(spec.side) ? WALL_THICKNESS + 0.03 : -0.03]} material={wallMats[i].fascia}>
            <boxGeometry args={[spec.length + 0.12, 1.1, 0.06]} />
          </mesh>
          <mesh position={[0, wallHeight + 0.04, WALL_THICKNESS / 2]} material={wallMats[i].cap}>
            <boxGeometry args={[spec.length + 0.2, 0.08, WALL_THICKNESS + 0.16]} />
          </mesh>
        </group>
      ))}

      {/* Facade sign over the entrance side */}
      <Label
        lines={signLines}
        width={Math.min(26, rectW(fp) * 0.36)}
        height={1.6}
        position={[entrance ? entrance.along : 0, roof - 3.2, fp.maxZ + WALL_THICKNESS / 2 + 0.03]}
        style={{ fg: '#0F172A', weight: 800, padding: 0.08 }}
      />

      {/* Roof */}
      <mesh geometry={roofGeo} material={roofMats.deck} position-y={roof} receiveShadow />
      <mesh geometry={roofGeo} material={roofMats.shadow} position-y={roof} castShadow />
      {plan.skylights.map((s, i) => (
        <mesh key={i} position={[(s.minX + s.maxX) / 2, roof + 0.32, (s.minZ + s.maxZ) / 2]} material={roofMats.skylight}>
          <boxGeometry args={[rectW(s), 0.12, rectD(s)]} />
        </mesh>
      ))}

      {/* Structure */}
      <instancedMesh ref={trussRef} args={[trussGeo, undefined, trussMatrices.length]} frustumCulled={false}>
        <meshStandardMaterial color="#F4F6F8" metalness={0.45} roughness={0.38} />
      </instancedMesh>
      <instancedMesh ref={columnRef} args={[columnGeo, undefined, columnMatrices.length]} castShadow receiveShadow frustumCulled={false}>
        <meshStandardMaterial color="#F1F3F5" metalness={0.4} roughness={0.4} />
      </instancedMesh>
      <instancedMesh ref={guardRef} args={[guardGeo, undefined, Math.max(1, guardMatrices.length)]} castShadow frustumCulled={false}>
        <meshStandardMaterial color={BRAND_BLUE} metalness={0.2} roughness={0.45} />
      </instancedMesh>

      {/* Sprinkler main and ducts under the trusses (hidden with the roof in cutaway) */}
      <group visible={!cutaway}>
      <mesh position={[0, clear - 0.15, fp.minZ + rectD(fp) * 0.35]} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.08, 0.08, rectW(fp) - 1, 12]} />
        <meshStandardMaterial color="#B91C1C" roughness={0.45} metalness={0.3} />
      </mesh>
      <mesh position={[0, clear - 0.55, fp.minZ + rectD(fp) * 0.68]} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.32, 0.32, rectW(fp) - 1, 20]} />
        <meshStandardMaterial color="#C9CED4" metalness={0.85} roughness={0.32} />
      </mesh>

      {/* LED high-bay strips */}
      <instancedMesh ref={stripRef} args={[stripGeo, undefined, stripMatrices.length]} frustumCulled={false}>
        <meshStandardMaterial color="#ffffff" emissive="#F5F8FF" emissiveIntensity={6} toneMapped={false} />
      </instancedMesh>
      </group>

      {plan.openings.filter(o => o.kind === 'personnel').map(o => (
        <PersonnelEntrance key={o.id} opening={o} plan={plan} />
      ))}
      {plan.openings.filter(o => o.kind === 'exit').map(o => (
        <ExitDoor key={o.id} opening={o} plan={plan} />
      ))}
      <WallLights plan={plan} />
    </group>
  )
}

// ── Doors & fixtures ─────────────────────────────────────

function openingFrame(o: WallOpening, plan: SitePlan) {
  const fp = plan.footprint
  switch (o.side) {
    case 'south': return { x: o.along, z: fp.maxZ, rotationY: 0 }
    case 'north': return { x: o.along, z: fp.minZ, rotationY: Math.PI }
    case 'east': return { x: fp.maxX, z: o.along, rotationY: Math.PI / 2 }
    case 'west': return { x: fp.minX, z: o.along, rotationY: -Math.PI / 2 }
  }
}

/** Automatic sliding glass doors; open when the camera approaches (prop behaviour, not data). */
function PersonnelEntrance({ opening, plan }: { opening: WallOpening; plan: SitePlan }) {
  const f = openingFrame(opening, plan)
  const left = useRef<THREE.Mesh>(null)
  const right = useRef<THREE.Mesh>(null)
  const open = useRef(0)
  const worldPos = useMemo(() => new THREE.Vector3(f.x, 1.2, f.z), [f.x, f.z])
  const stepCount = 6
  const rise = -GROUND_Y / stepCount
  const canopyGeo = useMemo(() => rbox(opening.width + 2.4, 0.18, 2.2, 0.06), [opening.width])
  useEffect(() => () => canopyGeo.dispose(), [canopyGeo])

  useFrame(({ camera }, delta) => {
    const near = camera.position.distanceTo(worldPos) < 9
    open.current = THREE.MathUtils.damp(open.current, near ? 1 : 0, 5, delta)
    const shift = open.current * (opening.width / 2 - 0.05)
    if (left.current) left.current.position.x = -opening.width / 4 - shift
    if (right.current) right.current.position.x = opening.width / 4 + shift
  })

  return (
    <group position={[f.x, 0, f.z]} rotation-y={f.rotationY}>
      {/* Frame */}
      {[-1, 1].map(s => (
        <mesh key={s} position={[s * (opening.width / 2 + 0.05), opening.height / 2, 0]}>
          <boxGeometry args={[0.1, opening.height, WALL_THICKNESS + 0.04]} />
          <meshStandardMaterial color="#334155" metalness={0.7} roughness={0.3} />
        </mesh>
      ))}
      <mesh position={[0, opening.height + 0.05, 0]}>
        <boxGeometry args={[opening.width + 0.3, 0.12, WALL_THICKNESS + 0.04]} />
        <meshStandardMaterial color="#334155" metalness={0.7} roughness={0.3} />
      </mesh>
      {/* Sliding leaves */}
      {[left, right].map((ref, i) => (
        <mesh key={i} ref={ref} position={[(i === 0 ? -1 : 1) * opening.width / 4, opening.height / 2, 0]}>
          <boxGeometry args={[opening.width / 2 - 0.02, opening.height - 0.05, 0.04]} />
          <meshPhysicalMaterial color="#DCEBFF" roughness={0.08} metalness={0.1} transparent opacity={0.35} />
        </mesh>
      ))}
      {/* Canopy */}
      <mesh position={[0, opening.height + 0.6, 1.1]} geometry={canopyGeo} castShadow>
        <meshStandardMaterial color={BRAND_BLUE} metalness={0.5} roughness={0.35} />
      </mesh>
      <Label lines={['PERSONNEL ENTRANCE']} width={3.6} height={0.42} position={[0, opening.height + 0.6, 2.22]} style={{ fg: '#FFFFFF', weight: 700 }} />
      {/* Landing and steps down to the yard */}
      <mesh position={[0, GROUND_Y / 2 - 0.01, 0.9]} receiveShadow castShadow>
        <boxGeometry args={[opening.width + 1.6, -GROUND_Y, 1.8]} />
        <meshStandardMaterial color="#B8BEC5" roughness={0.9} />
      </mesh>
      {Array.from({ length: stepCount - 1 }, (_, i) => {
        const h = -GROUND_Y - (i + 1) * rise
        return (
          <mesh key={i} position={[0, GROUND_Y + h / 2, 1.8 + 0.3 * i + 0.15]} receiveShadow castShadow>
            <boxGeometry args={[opening.width + 1.6, h, 0.3]} />
            <meshStandardMaterial color="#C3C8CE" roughness={0.9} />
          </mesh>
        )
      })}
      {/* Handrails following the stair slope, on posts */}
      {[-1, 1].map(s => {
        const x = s * (opening.width / 2 + 0.7)
        const z0 = 1.8
        const z1 = 1.8 + (stepCount - 1) * 0.3
        const run = z1 - z0
        const drop = -GROUND_Y - rise
        const len = Math.hypot(run, drop)
        return (
          <group key={s}>
            <mesh position={[x, 0.95 - drop / 2, (z0 + z1) / 2]} rotation-x={Math.atan2(run, -drop)}>
              <cylinderGeometry args={[0.025, 0.025, len, 8]} />
              <meshStandardMaterial color="#94A3B8" metalness={0.9} roughness={0.25} />
            </mesh>
            {[0, 0.5, 1].map(t => (
              <mesh key={t} position={[x, 0.95 / 2 - drop * t, z0 + run * t]}>
                <cylinderGeometry args={[0.02, 0.02, 0.95, 8]} />
                <meshStandardMaterial color="#94A3B8" metalness={0.9} roughness={0.25} />
              </mesh>
            ))}
          </group>
        )
      })}
    </group>
  )
}

function ExitDoor({ opening, plan }: { opening: WallOpening; plan: SitePlan }) {
  const f = openingFrame(opening, plan)
  return (
    <group position={[f.x, 0, f.z]} rotation-y={f.rotationY}>
      <mesh position={[0, opening.height / 2, -0.02]}>
        <boxGeometry args={[opening.width - 0.02, opening.height - 0.02, 0.06]} />
        <meshStandardMaterial color="#64748B" metalness={0.5} roughness={0.45} />
      </mesh>
      <mesh position={[opening.width * 0.32, 1.05, 0.03]}>
        <boxGeometry args={[0.04, 0.04, 0.12]} />
        <meshStandardMaterial color="#E2E8F0" metalness={0.9} roughness={0.2} />
      </mesh>
      {/* Illuminated exit signs, inside and out */}
      {[WALL_THICKNESS / 2 + 0.03, -(WALL_THICKNESS / 2 + 0.03)].map((z, i) => (
        <Label key={i} lines={['EXIT']} width={0.8} height={0.3} position={[0, opening.height + 0.35, z]} rotationY={i === 1 ? Math.PI : 0}
          style={{ fg: '#FFFFFF', bg: '#15803D', weight: 800 }} emissive={4} />
      ))}
      {/* Landing & steps */}
      <mesh position={[0, GROUND_Y / 2 - 0.02, 0.7]} receiveShadow castShadow>
        <boxGeometry args={[1.8, -GROUND_Y, 1.4]} />
        <meshStandardMaterial color="#B8BEC5" roughness={0.9} />
      </mesh>
      {[0, 1, 2, 3].map(i => {
        const h = -GROUND_Y * (1 - (i + 1) / 5)
        return (
          <mesh key={i} position={[0, GROUND_Y + h / 2, 1.4 + 0.3 * i + 0.15]} castShadow receiveShadow>
            <boxGeometry args={[1.8, h, 0.3]} />
            <meshStandardMaterial color="#C3C8CE" roughness={0.9} />
          </mesh>
        )
      })}
    </group>
  )
}

function WallLights({ plan }: { plan: SitePlan }) {
  const night = useTwinStore(s => s.timeOfDay) !== 'day'
  const ref = useRef<THREE.InstancedMesh>(null)
  const geo = useMemo(() => rbox(0.5, 0.18, 0.32, 0.05), [])
  useEffect(() => () => geo.dispose(), [geo])
  const matrices = useMemo(() => {
    const fp = plan.footprint
    const y = plan.heights.clear - 3
    const out: THREE.Matrix4[] = []
    for (let x = fp.minX + 6; x < fp.maxX; x += 12) {
      if (!plan.openings.some(o => o.side === 'south' && Math.abs(o.along - x) < 2.5)) out.push(compose(x, y, fp.maxZ + 0.32))
      out.push(compose(x, y, fp.minZ - 0.32, Math.PI))
    }
    for (let z = fp.minZ + 6; z < fp.maxZ; z += 12) {
      out.push(compose(fp.maxX + 0.32, y, z, Math.PI / 2), compose(fp.minX - 0.32, y, z, -Math.PI / 2))
    }
    return out
  }, [plan])
  useInstanceMatrices(ref, matrices)
  return (
    <instancedMesh ref={ref} args={[geo, undefined, matrices.length]} frustumCulled={false}>
      <meshStandardMaterial color="#E2E8F0" emissive="#FFF4DD" emissiveIntensity={night ? 5 : 1.6} metalness={0.6} roughness={0.3} toneMapped={false} />
    </instancedMesh>
  )
}

/** Camera-facing label drawn into a canvas texture (no DOM, no font downloads). */
export function SpriteLabel({ lines, position, width, height, style }: {
  lines: string[]
  position: [number, number, number] | THREE.Vector3
  width: number
  height: number
  style?: Parameters<typeof createLabelTexture>[3]
}) {
  const key = JSON.stringify([lines, width, height, style])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tex = useMemo(() => createLabelTexture(lines, height, width, { ppm: 220, ...style }), [key])
  useEffect(() => () => tex.dispose(), [tex])
  return (
    <sprite position={position} scale={[width, height, 1]} renderOrder={20}>
      <spriteMaterial map={tex} depthTest={false} transparent toneMapped={false} />
    </sprite>
  )
}
