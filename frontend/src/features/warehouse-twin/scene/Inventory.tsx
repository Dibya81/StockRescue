import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { InventoryLot, InventoryStatus, WarehouseLayout } from '../data/schemas'
import { STATUS_STYLES } from '../data/statusMapping'
import { totalPositions } from '../data/layoutGeometry'
import { PALLET } from '../world/constants'
import {
  buildInventoryScene,
  FLAGGED_STATUSES,
  LOAD_KINDS,
  type LoadInstance,
  type LoadKind,
  type PalletInstance,
} from '../world/inventoryLayout'
import { getSceneParams } from '../world/sceneParams'
import { rackHeight } from '../world/layoutToWorld'
import { rbox } from './Building'
import {
  createCartonTexture,
  createPalletTexture,
  createStatusIconTexture,
  createSteelBundleTexture,
  createToteTexture,
} from './textures'

interface InventoryProps {
  layout: WarehouseLayout
  lots: InventoryLot[]
  highlightSku: string | null
  onPick: (positionId: string) => void
  onHover: (positionId: string | null) => void
}

const Y = new THREE.Vector3(0, 1, 0)
const tmpQ = new THREE.Quaternion()
const tmpP = new THREE.Vector3()
const tmpS = new THREE.Vector3()

function compose(m: THREE.Matrix4, x: number, y: number, z: number, rotY: number, sx: number, sy: number, sz: number) {
  return m.compose(tmpP.set(x, y, z), tmpQ.setFromAxisAngle(Y, rotY), tmpS.set(sx, sy, sz))
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/** Writes per-instance transforms (and optional colours) into an InstancedMesh. */
function useInstances<T>(
  ref: React.RefObject<THREE.InstancedMesh | null>,
  items: readonly T[],
  write: (m: THREE.Matrix4, item: T) => void,
  color?: (item: T) => THREE.Color,
) {
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const m = new THREE.Matrix4()
    items.forEach((item, i) => {
      write(m, item)
      mesh.setMatrixAt(i, m)
      if (color) mesh.setColorAt(i, color(item))
    })
    mesh.count = items.length
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
    // Instance data is computed once per data change, never per frame
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, items])
}

const statusColor = (s: InventoryStatus) => new THREE.Color(STATUS_STYLES[s].color)

export function Inventory({ layout, lots, highlightSku, onPick, onHover }: InventoryProps) {
  const { seed, freeze } = getSceneParams()
  const capacity = useMemo(() => Math.max(1, totalPositions(layout)), [layout])
  const scene = useMemo(() => buildInventoryScene(layout, lots), [layout, lots])
  const loads = useMemo(() => LOAD_KINDS.flatMap(k => scene.loads[k]), [scene])
  const halos = useMemo(() => loads.filter(l => l.status === 'disruption_affected'), [loads])

  // ── Shared resources ──
  const res = useMemo(() => {
    const drum = mergeGeometries([-0.25, 0.25].flatMap(x => [-0.25, 0.25].map(z => {
      const g = new THREE.CylinderGeometry(0.23, 0.23, 1, 18)
      g.translate(x, 0, z)
      return g
    })))
    const reel = new THREE.CylinderGeometry(0.5, 0.5, 1, 24)
    reel.rotateZ(Math.PI / 2)
    return {
      geo: {
        pallet: rbox(1, PALLET.height, 1, 0.02),
        carton: rbox(1, 1, 1, 0.02),
        tote: rbox(1, 1, 1, 0.04),
        steel: rbox(1, 1, 1, 0.03),
        reel,
        drum,
        band: rbox(1, 0.07, 1, 0.01),
        halo: new THREE.BoxGeometry(1, 1, 1),
        flag: new THREE.PlaneGeometry(0.42, 0.42),
        beacon: new THREE.TorusGeometry(0.55, 0.05, 10, 32),
        beam: new THREE.CylinderGeometry(0.04, 0.04, 1, 8, 1, true),
      },
      tex: {
        pallet: createPalletTexture(seed),
        carton: createCartonTexture(seed),
        tote: createToteTexture(),
        steel: createSteelBundleTexture(),
        icons: new Map<InventoryStatus, THREE.Texture>(
          FLAGGED_STATUSES.map(s => [s, createStatusIconTexture(STATUS_STYLES[s].glyph, STATUS_STYLES[s].color)]),
        ),
      },
    }
  }, [seed])
  useEffect(() => () => {
    Object.values(res.geo).forEach(g => g.dispose())
    const { icons, ...rest } = res.tex
    Object.values(rest).forEach(t => t.dispose())
    icons.forEach(t => t.dispose())
  }, [res])

  const haloMat = useMemo(() => new THREE.MeshBasicMaterial({ color: STATUS_STYLES.disruption_affected.color, transparent: true, opacity: 0.3, depthWrite: false }), [])
  const beaconMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#1F4FD8', transparent: true, opacity: 0.9, toneMapped: false }), [])
  useEffect(() => () => { haloMat.dispose(); beaconMat.dispose() }, [haloMat, beaconMat])

  // ── Instance writers ──
  const palletRef = useRef<THREE.InstancedMesh>(null)
  useInstances(palletRef, scene.pallets, (m, p: PalletInstance) =>
    compose(m, p.x, p.y + PALLET.height / 2, p.z, p.rotationY, p.width, 1, p.depth),
  p => new THREE.Color(p.plastic ? '#6B7480' : '#E8D2AE'))

  const kindRefs = {
    carton: useRef<THREE.InstancedMesh>(null),
    tote: useRef<THREE.InstancedMesh>(null),
    reel: useRef<THREE.InstancedMesh>(null),
    steel: useRef<THREE.InstancedMesh>(null),
    drum: useRef<THREE.InstancedMesh>(null),
  } satisfies Record<LoadKind, React.RefObject<THREE.InstancedMesh | null>>

  const loadMatrix = (kind: LoadKind) => (m: THREE.Matrix4, l: LoadInstance) => {
    const base = l.y + PALLET.height
    const h = kind === 'steel' ? l.height * 0.55 : l.height
    const d = kind === 'reel' ? Math.min(h, l.depth - 0.1) : l.depth - 0.08
    return compose(m, l.x, base + h / 2, l.z, l.rotationY, l.width - 0.04, h, d)
  }
  useInstances(kindRefs.carton, scene.loads.carton, loadMatrix('carton'))
  useInstances(kindRefs.tote, scene.loads.tote, loadMatrix('tote'))
  useInstances(kindRefs.reel, scene.loads.reel, loadMatrix('reel'))
  useInstances(kindRefs.steel, scene.loads.steel, loadMatrix('steel'))
  useInstances(kindRefs.drum, scene.loads.drum, loadMatrix('drum'))

  // Status band around each load: the status colour, paired with stack shape and icon
  const bandRef = useRef<THREE.InstancedMesh>(null)
  useInstances(bandRef, loads, (m, l: LoadInstance) =>
    compose(m, l.x, l.y + PALLET.height + 0.05, l.z, l.rotationY, l.width + 0.02, 1, l.depth - 0.05),
  l => statusColor(l.status))

  const haloRef = useRef<THREE.InstancedMesh>(null)
  useInstances(haloRef, halos, (m, l: LoadInstance) =>
    compose(m, l.x, l.y + PALLET.height + l.height / 2, l.z, l.rotationY, l.width + 0.12, l.height + 0.12, l.depth + 0.04))

  // Incoming: ghost frame only, there is no stock yet
  const incomingGeo = useMemo(() => {
    if (scene.incoming.length === 0) return null
    const edge = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1))
    const parts = scene.incoming.map(p => {
      const g = edge.clone()
      g.applyMatrix4(compose(new THREE.Matrix4(), p.x, p.y + 0.55, p.z, p.rotationY, p.width, 1.0, p.depth))
      return g
    })
    const merged = mergeGeometries(parts)
    parts.forEach(g => g.dispose())
    edge.dispose()
    return merged
  }, [scene.incoming])
  useEffect(() => () => incomingGeo?.dispose(), [incomingGeo])
  const incomingLines = useMemo(() => {
    if (!incomingGeo) return null
    const line = new THREE.LineSegments(incomingGeo, new THREE.LineDashedMaterial({ color: STATUS_STYLES.incoming.color, dashSize: 0.12, gapSize: 0.08 }))
    line.computeLineDistances()
    return line
  }, [incomingGeo])
  useEffect(() => () => { (incomingLines?.material as THREE.Material | undefined)?.dispose() }, [incomingLines])

  // ── Flags (billboards) ──
  const flagsByStatus = useMemo(() => {
    const out = new Map<InventoryStatus, typeof scene.flags>()
    for (const f of scene.flags) {
      const list = out.get(f.status)
      if (list) list.push(f)
      else out.set(f.status, [f])
    }
    return out
  }, [scene.flags])
  const flagRefs = useRef(new Map<InventoryStatus, THREE.InstancedMesh>())
  const lastCam = useRef(new THREE.Vector3(Infinity, 0, 0))
  const flagM = useMemo(() => new THREE.Matrix4(), [])

  // ── SKU beacons ──
  const beacons = useMemo(() => {
    if (!highlightSku) return []
    const positions = new Set(lots.filter(l => l.sku === highlightSku && l.positionId).map(l => l.positionId as string))
    // Beacons float above the rack top so stock on higher levels never hides them
    return [...positions].flatMap(pid => {
      const inst = scene.byPosition.get(pid)
      const rack = layout.racks.find(r => r.id === pid.slice(0, 7))
      return inst && rack ? [{ x: inst.x, y: inst.y, z: inst.z, top: rackHeight(rack) + 0.9 }] : []
    })
  }, [highlightSku, lots, scene.byPosition, layout.racks])
  const beaconRef = useRef<THREE.InstancedMesh>(null)
  const beamRef = useRef<THREE.InstancedMesh>(null)

  const animate = !freeze && !prefersReducedMotion()
  useFrame(({ camera, clock }) => {
    // Re-orient flags only when the camera moved
    if (camera.position.distanceToSquared(lastCam.current) > 0.0004) {
      lastCam.current.copy(camera.position)
      for (const [status, list] of flagsByStatus) {
        const mesh = flagRefs.current.get(status)
        if (!mesh) continue
        list.forEach((f, i) => {
          const yaw = Math.atan2(camera.position.x - f.x, camera.position.z - f.z)
          mesh.setMatrixAt(i, compose(flagM, f.x, f.y, f.z, yaw, 1, 1, 1))
        })
        mesh.count = list.length
        mesh.instanceMatrix.needsUpdate = true
        mesh.computeBoundingSphere()
      }
    }
    const t = clock.elapsedTime
    haloMat.opacity = animate ? 0.18 + 0.2 * (0.5 + 0.5 * Math.sin(t * 3)) : 0.3
    if (beaconRef.current && beamRef.current) {
      beacons.forEach((b, i) => {
        const bob = animate ? Math.sin(t * 2.4 + i) * 0.1 : 0
        beaconRef.current!.setMatrixAt(i, flagM.makeRotationX(Math.PI / 2).setPosition(b.x, b.top + bob, b.z))
        // Light beam from the position up to the beacon ring
        const len = b.top - b.y
        beamRef.current!.setMatrixAt(i, compose(flagM, b.x, b.y + len / 2, b.z, 0, 1, len, 1))
      })
      beaconRef.current.count = beacons.length
      beamRef.current.count = beacons.length
      beaconRef.current.instanceMatrix.needsUpdate = true
      beamRef.current.instanceMatrix.needsUpdate = true
    }
  })
  useEffect(() => {
    // Force flag placement on the next frame after data changes
    lastCam.current.set(Infinity, 0, 0)
  }, [flagsByStatus])

  // ── Picking ──
  const pickFrom = (list: readonly { positionId: string }[]) => ({
    onClick: (e: ThreeEvent<MouseEvent>) => {
      if (e.instanceId == null || !list[e.instanceId]) return
      e.stopPropagation()
      onPick(list[e.instanceId].positionId)
    },
    onPointerMove: (e: ThreeEvent<PointerEvent>) => {
      if (e.instanceId == null || !list[e.instanceId]) return
      e.stopPropagation()
      onHover(list[e.instanceId].positionId)
    },
    onPointerOut: () => onHover(null),
  })

  return (
    <group>
      <instancedMesh ref={palletRef} args={[res.geo.pallet, undefined, capacity]} castShadow receiveShadow frustumCulled={false} {...pickFrom(scene.pallets)}>
        <meshStandardMaterial map={res.tex.pallet} roughness={0.85} />
      </instancedMesh>

      <instancedMesh ref={kindRefs.carton} args={[res.geo.carton, undefined, capacity]} castShadow receiveShadow frustumCulled={false} {...pickFrom(scene.loads.carton)}>
        <meshStandardMaterial map={res.tex.carton} roughness={0.9} />
      </instancedMesh>
      <instancedMesh ref={kindRefs.tote} args={[res.geo.tote, undefined, capacity]} castShadow receiveShadow frustumCulled={false} {...pickFrom(scene.loads.tote)}>
        <meshStandardMaterial map={res.tex.tote} roughness={0.55} />
      </instancedMesh>
      <instancedMesh ref={kindRefs.reel} args={[res.geo.reel, undefined, capacity]} castShadow receiveShadow frustumCulled={false} {...pickFrom(scene.loads.reel)}>
        <meshStandardMaterial color="#2B2F36" roughness={0.6} metalness={0.1} />
      </instancedMesh>
      <instancedMesh ref={kindRefs.steel} args={[res.geo.steel, undefined, capacity]} castShadow receiveShadow frustumCulled={false} {...pickFrom(scene.loads.steel)}>
        <meshStandardMaterial map={res.tex.steel} metalness={0.7} roughness={0.38} />
      </instancedMesh>
      <instancedMesh ref={kindRefs.drum} args={[res.geo.drum, undefined, capacity]} castShadow receiveShadow frustumCulled={false} {...pickFrom(scene.loads.drum)}>
        <meshStandardMaterial color="#1E40AF" metalness={0.55} roughness={0.35} />
      </instancedMesh>

      <instancedMesh ref={bandRef} args={[res.geo.band, undefined, capacity]} frustumCulled={false}>
        <meshStandardMaterial roughness={0.5} emissive="#ffffff" emissiveIntensity={0.08} />
      </instancedMesh>
      <instancedMesh ref={haloRef} args={[res.geo.halo, haloMat, capacity]} frustumCulled={false} />

      {incomingLines && <primitive object={incomingLines} />}

      {FLAGGED_STATUSES.map(status => (
        <instancedMesh
          key={status}
          ref={m => {
            if (m) flagRefs.current.set(status, m)
            else flagRefs.current.delete(status)
          }}
          args={[res.geo.flag, undefined, capacity]}
          count={flagsByStatus.get(status)?.length ?? 0}
          frustumCulled={false}
          {...pickFrom(flagsByStatus.get(status) ?? [])}
        >
          <meshBasicMaterial map={res.tex.icons.get(status) ?? null} transparent alphaTest={0.4} toneMapped={false} />
        </instancedMesh>
      ))}

      <instancedMesh ref={beaconRef} args={[res.geo.beacon, beaconMat, capacity]} count={beacons.length} frustumCulled={false} />
      <instancedMesh ref={beamRef} args={[res.geo.beam, undefined, capacity]} count={beacons.length} frustumCulled={false}>
        <meshBasicMaterial color="#3B82F6" transparent opacity={0.35} depthWrite={false} toneMapped={false} />
      </instancedMesh>
    </group>
  )
}
