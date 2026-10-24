import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Dock, Shipment, WarehouseLayout } from '../data/schemas'
import { BRAND_BLUE, DOCK_DOOR, WALL_THICKNESS } from '../world/constants'
import { layoutToWorld } from '../world/layoutToWorld'
import { getSceneParams } from '../world/sceneParams'
import { isDockOpen } from '../world/sitePlan'
import { useTwinStore } from '../store/twinStore'
import { Label, rbox } from './Building'
import { createShutterNormal } from './textures'

const LIGHT_COLOR: Record<Dock['status'], string> = {
  available: '#22C55E',
  occupied: '#EF4444',
  maintenance: '#F59E0B',
}

/** Static dock hardware for every dock, merged per material (a few draw calls in total). */
function useStaticDockParts(layout: WarehouseLayout) {
  return useMemo(() => {
    const { width: w, height: h } = DOCK_DOOR
    const outer = WALL_THICKNESS / 2
    const byMat = new Map<string, THREE.BufferGeometry[]>()
    const add = (mat: string, g: THREE.BufferGeometry, m: THREE.Matrix4) => {
      g.applyMatrix4(m)
      const flat = g.index ? g.toNonIndexed() : g
      if (flat !== g) g.dispose()
      const list = byMat.get(mat) ?? []
      list.push(flat)
      byMat.set(mat, list)
    }
    for (const d of layout.docks) {
      const tf = layoutToWorld(layout, d.id)
      if (!tf) continue
      const base = new THREE.Matrix4().compose(new THREE.Vector3(tf.position[0], 0, tf.position[2]), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), tf.rotationY), new THREE.Vector3(1, 1, 1))
      const at = (x: number, y: number, z: number) => base.clone().multiply(new THREE.Matrix4().makeTranslation(x, y, z))
      add('housing', rbox(w + 0.5, 0.6, 0.6, 0.08), at(0, h + 0.32, -outer - 0.28))
      for (const sx of [-1, 1]) {
        add('steel', new THREE.BoxGeometry(0.1, h, 0.12), at(sx * (w / 2 + 0.06), h / 2, -outer - 0.04))
        add('seal', rbox(0.32, h + 0.2, 0.36, 0.06), at(sx * (w / 2 + 0.16), h / 2 + 0.05, outer + 0.18))
        add('rubber', rbox(0.26, 0.5, 0.14, 0.04), at(sx * (w / 2 - 0.35), -0.42, outer + 0.1))
      }
      add('seal', rbox(w + 0.64, 0.5, 0.36, 0.06), at(0, h + 0.25, outer + 0.18))
      add('plate', new THREE.BoxGeometry(w - 0.2, 0.012, 2.4), at(0, 0.006, -1.3))
      const arm = new THREE.CylinderGeometry(0.03, 0.03, 0.7, 8)
      arm.rotateX(Math.PI / 2)
      add('steel', arm, at(w / 2 + 0.9, 3.0, outer + 0.4))
      add('rubber', new THREE.BoxGeometry(0.28, 0.6, 0.14), at(-(w / 2 + 0.75), 2.3, outer + 0.08))
    }
    const merged = [...byMat].map(([mat, geos]) => {
      const geo = mergeGeometries(geos)
      geos.forEach(g => g.dispose())
      return { mat, geo }
    })
    return merged
  }, [layout])
}

const STATIC_MATS: Record<string, THREE.MeshStandardMaterial> = {
  housing: new THREE.MeshStandardMaterial({ color: '#E5E7EB', metalness: 0.5, roughness: 0.4 }),
  steel: new THREE.MeshStandardMaterial({ color: '#94A3B8', metalness: 0.8, roughness: 0.3 }),
  seal: new THREE.MeshStandardMaterial({ color: '#1F2328', roughness: 0.95 }),
  rubber: new THREE.MeshStandardMaterial({ color: '#111317', roughness: 0.9 }),
  plate: new THREE.MeshStandardMaterial({ color: '#5B6470', metalness: 0.75, roughness: 0.5 }),
}

export function Docks({ layout, shipments }: { layout: WarehouseLayout; shipments: Shipment[] }) {
  const shutterNormal = useMemo(() => createShutterNormal([1, DOCK_DOOR.height / 0.12]), [])
  useEffect(() => () => shutterNormal.dispose(), [shutterNormal])
  const statics = useStaticDockParts(layout)
  useEffect(() => () => statics.forEach(s => s.geo.dispose()), [statics])
  return (
    <group>
      {statics.map(s => <mesh key={s.mat} geometry={s.geo} material={STATIC_MATS[s.mat]} castShadow receiveShadow />)}
      {layout.docks.map(d => (
        <DockBay key={d.id} layout={layout} dock={d} open={isDockOpen(d, shipments)} shutterNormal={shutterNormal} />
      ))}
    </group>
  )
}

function DockBay({ layout, dock, open, shutterNormal }: {
  layout: WarehouseLayout
  dock: Dock
  open: boolean
  shutterNormal: THREE.Texture
}) {
  const tf = layoutToWorld(layout, dock.id)
  const { width: w, height: h } = DOCK_DOOR
  const t = WALL_THICKNESS
  const freeze = getSceneParams().freeze
  const night = useTwinStore(s => s.timeOfDay) === 'night'

  // State-derived: starts at the target so a reload mid-unload shows an open door
  const openness = useRef(open ? 1 : 0)
  const shutter = useRef<THREE.Mesh>(null)
  const lip = useRef<THREE.Group>(null)
  const lamp = useRef<THREE.MeshStandardMaterial>(null)

  const geos = useMemo(() => ({
    bumper: rbox(0.26, 0.5, 0.14, 0.04),
    sealSide: rbox(0.32, h + 0.2, 0.36, 0.06),
    sealTop: rbox(w + 0.64, 0.5, 0.36, 0.06),
    housing: rbox(w + 0.5, 0.6, 0.6, 0.08),
    lampHead: rbox(0.36, 0.22, 0.3, 0.05),
  }), [w, h])
  useEffect(() => () => Object.values(geos).forEach(g => g.dispose()), [geos])

  useFrame((_, delta) => {
    const target = open ? 1 : 0
    openness.current = freeze ? target : THREE.MathUtils.damp(openness.current, target, 2.2, delta)
    const o = openness.current
    const visible = Math.max(0.02, 1 - o)
    if (shutter.current) {
      shutter.current.scale.y = visible
      shutter.current.position.y = h - (h * visible) / 2
    }
    // Hinged at the dock edge: hangs down when stowed, rests on the truck bed when out
    if (lip.current) lip.current.rotation.x = THREE.MathUtils.lerp(Math.PI / 2, 0.12, o)
    if (lamp.current) lamp.current.emissiveIntensity = Math.max(night ? 4 : 0.1, 0.1 + o * 6)
  })

  if (!tf) return null
  const [x, , z] = tf.position
  const outer = t / 2

  return (
    <group position={[x, 0, z]} rotation-y={tf.rotationY}>
      {/* Roller shutter (inside face) */}
      <mesh ref={shutter} position={[0, h / 2, -outer + 0.06]} castShadow={false}>
        <boxGeometry args={[w, h, 0.05]} />
        <meshStandardMaterial color="#CBD2D9" metalness={0.65} roughness={0.38} normalMap={shutterNormal} />
      </mesh>


      {/* Leveler plate and hinged lip */}
      <group ref={lip} position={[0, -0.02, outer + 0.02]} rotation-x={open ? 0.12 : Math.PI / 2}>
        <mesh position={[0, 0, 0.225]}>
          <boxGeometry args={[w - 0.25, 0.03, 0.45]} />
          <meshStandardMaterial color="#5B6470" metalness={0.75} roughness={0.5} />
        </mesh>
      </group>

      {/* Dock lamp (lights the trailer when a truck is docked) */}
      <group position={[w / 2 + 0.9, 3.0, outer + 0.05]}>
        <mesh position={[0, -0.05, 0.75]} geometry={geos.lampHead}>
          <meshStandardMaterial ref={lamp} color="#E5E7EB" emissive="#FFE8B0" emissiveIntensity={open ? 6.1 : 0.1} toneMapped={false} />
        </mesh>
      </group>

      {/* Traffic light from the dock record */}
      <group position={[-(w / 2 + 0.75), 2.3, outer + 0.08]}>
        <mesh position={[0, dock.status === 'available' ? -0.13 : 0.13, 0.075]}>
          <circleGeometry args={[0.09, 20]} />
          <meshStandardMaterial color={LIGHT_COLOR[dock.status]} emissive={LIGHT_COLOR[dock.status]} emissiveIntensity={5} toneMapped={false} />
        </mesh>
      </group>

      {/* Dock number sign */}
      <Label
        lines={[dock.label.toUpperCase(), dock.purpose.toUpperCase()]}
        width={1.9}
        height={0.62}
        position={[0, h + 0.95, outer + 0.38]}
        style={{ fg: '#FFFFFF', bg: BRAND_BLUE, weight: 800, padding: 0.1 }}
      />
    </group>
  )
}
