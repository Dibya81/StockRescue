import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Dock, Shipment, WarehouseLayout } from '../data/schemas'
import { BRAND_BLUE, DOCK_DOOR, WALL_THICKNESS } from '../world/constants'
import { layoutToWorld } from '../world/layoutToWorld'
import { getSceneParams } from '../world/sceneParams'
import { isDockOpen } from '../world/sitePlan'
import { Label, rbox } from './Building'
import { createShutterNormal } from './textures'

const LIGHT_COLOR: Record<Dock['status'], string> = {
  available: '#22C55E',
  occupied: '#EF4444',
  maintenance: '#F59E0B',
}

export function Docks({ layout, shipments }: { layout: WarehouseLayout; shipments: Shipment[] }) {
  const shutterNormal = useMemo(() => createShutterNormal([1, DOCK_DOOR.height / 0.12]), [])
  useEffect(() => () => shutterNormal.dispose(), [shutterNormal])
  return (
    <group>
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
    if (lamp.current) lamp.current.emissiveIntensity = 0.1 + o * 6
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
      <mesh position={[0, h + 0.32, -outer - 0.28]} geometry={geos.housing}>
        <meshStandardMaterial color="#E5E7EB" metalness={0.5} roughness={0.4} />
      </mesh>
      {[-1, 1].map(s => (
        <mesh key={s} position={[s * (w / 2 + 0.06), h / 2, -outer - 0.04]}>
          <boxGeometry args={[0.1, h, 0.12]} />
          <meshStandardMaterial color="#94A3B8" metalness={0.8} roughness={0.3} />
        </mesh>
      ))}

      {/* Dock seal (outside) */}
      {[-1, 1].map(s => (
        <mesh key={s} position={[s * (w / 2 + 0.16), h / 2 + 0.05, outer + 0.18]} geometry={geos.sealSide} castShadow>
          <meshStandardMaterial color="#1F2328" roughness={0.95} />
        </mesh>
      ))}
      <mesh position={[0, h + 0.25, outer + 0.18]} geometry={geos.sealTop} castShadow>
        <meshStandardMaterial color="#1F2328" roughness={0.95} />
      </mesh>

      {/* Bumpers on the dock face */}
      {[-1, 1].map(s => (
        <mesh key={s} position={[s * (w / 2 - 0.35), -0.42, outer + 0.1]} geometry={geos.bumper} castShadow>
          <meshStandardMaterial color="#111317" roughness={0.9} />
        </mesh>
      ))}

      {/* Leveler plate and hinged lip */}
      <mesh position={[0, 0.006, -1.3]} receiveShadow>
        <boxGeometry args={[w - 0.2, 0.012, 2.4]} />
        <meshStandardMaterial color="#5B6470" metalness={0.75} roughness={0.5} />
      </mesh>
      <group ref={lip} position={[0, -0.02, outer + 0.02]} rotation-x={open ? 0.12 : Math.PI / 2}>
        <mesh position={[0, 0, 0.225]}>
          <boxGeometry args={[w - 0.25, 0.03, 0.45]} />
          <meshStandardMaterial color="#5B6470" metalness={0.75} roughness={0.5} />
        </mesh>
      </group>

      {/* Dock lamp (lights the trailer when a truck is docked) */}
      <group position={[w / 2 + 0.9, 3.0, outer + 0.05]}>
        <mesh position={[0, 0, 0.35]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.03, 0.03, 0.7, 8]} />
          <meshStandardMaterial color="#64748B" metalness={0.8} roughness={0.3} />
        </mesh>
        <mesh position={[0, -0.05, 0.75]} geometry={geos.lampHead}>
          <meshStandardMaterial ref={lamp} color="#E5E7EB" emissive="#FFE8B0" emissiveIntensity={open ? 6.1 : 0.1} toneMapped={false} />
        </mesh>
      </group>

      {/* Traffic light from the dock record */}
      <group position={[-(w / 2 + 0.75), 2.3, outer + 0.08]}>
        <mesh>
          <boxGeometry args={[0.28, 0.6, 0.14]} />
          <meshStandardMaterial color="#1F2937" roughness={0.6} />
        </mesh>
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
