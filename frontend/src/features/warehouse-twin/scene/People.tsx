import { useEffect, useMemo, useRef } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { WorkerSpec } from '../world/poses'
import { createRng, getSceneParams } from '../world/sceneParams'
import { isDragRelease, mounts, sceneStats, setEntityPosition } from './registry'

// Articulated procedural workers: one InstancedMesh per body part, joint
// angles from a small activity state machine, stride tied to distance.

type PartName = 'pelvis' | 'torso' | 'head' | 'helmet' | 'upperArm' | 'forearm' | 'hand' | 'thigh' | 'shin' | 'boot' | 'carton'
const PER_PERSON: Record<PartName, number> = { pelvis: 1, torso: 1, head: 1, helmet: 1, upperArm: 2, forearm: 2, hand: 2, thigh: 2, shin: 2, boot: 2, carton: 1 }
const MAX_PEOPLE = 64
const LOD_DISTANCE = 25

const SKIN = ['#F1C9A5', '#D9A37C', '#B07850', '#8A5A3B', '#5E3B26']
const HELMET = ['#F8FAFC', '#1F4FD8', '#F8FAFC', '#F97316']

interface Rig {
  thigh: [number, number]
  knee: [number, number]
  upper: [number, number]
  elbow: [number, number]
  lean: number
  crouch: number
}

/** Joint angles (radians, negative = forward) for an activity at a gait phase. */
function rigFor(activity: WorkerSpec['activity'], phase: number, t: number): Rig {
  const s = Math.sin(phase)
  const c = Math.cos(phase)
  switch (activity) {
    case 'walk':
    case 'push':
    case 'carry': {
      const swing = 0.42
      const legs: [number, number] = [-swing * s, swing * s]
      const knees: [number, number] = [Math.max(0, -c) * 0.65, Math.max(0, c) * 0.65]
      if (activity === 'walk') return { thigh: legs, knee: knees, upper: [swing * 0.8 * s, -swing * 0.8 * s], elbow: [-0.25, -0.25], lean: 0.04, crouch: 0 }
      if (activity === 'push') return { thigh: legs, knee: knees, upper: [-1.0, -1.0], elbow: [-0.3, -0.3], lean: 0.18, crouch: 0 }
      return { thigh: legs, knee: knees, upper: [-0.75, -0.75], elbow: [-0.7, -0.7], lean: 0.06, crouch: 0 }
    }
    case 'drive': return { thigh: [-1.5, -1.5], knee: [1.5, 1.5], upper: [-0.9, -0.9], elbow: [-0.55, -0.55], lean: -0.05, crouch: 0 }
    case 'stand': return { thigh: [0, 0], knee: [0, 0], upper: [-0.85, -0.6], elbow: [-0.5, -0.6], lean: 0.05, crouch: 0 }
    case 'scan': return { thigh: [0.05, -0.05], knee: [0, 0], upper: [-1.15 + 0.08 * Math.sin(t * 1.3), 0.1], elbow: [-0.35, -0.15], lean: 0.05, crouch: 0 }
    case 'inspect': return { thigh: [0, 0], knee: [0.15, 0.15], upper: [-0.85, -0.9], elbow: [-0.5, -0.4], lean: 0.45, crouch: 0.03 }
    case 'idle':
    default: return { thigh: [0, 0], knee: [0, 0], upper: [0.05, -0.05], elbow: [-0.15, -0.15], lean: 0.02 * Math.sin(t * 0.8), crouch: 0 }
  }
}

interface PeopleProps {
  workers: WorkerSpec[]
  onSelect: (workerId: string) => void
}

export function People({ workers, onSelect }: PeopleProps) {
  const { freeze } = getSceneParams()
  const geos = useMemo(() => {
    const rb = (w: number, h: number, d: number, r: number) => new RoundedBoxGeometry(w, h, d, 2, r)
    const helmet = new THREE.SphereGeometry(0.125, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2)
    return {
      pelvis: rb(0.32, 0.16, 0.2, 0.05),
      torso: rb(0.38, 0.52, 0.24, 0.08),
      head: new THREE.SphereGeometry(0.105, 16, 12),
      helmet,
      upperArm: rb(0.095, 0.3, 0.095, 0.04),
      forearm: rb(0.085, 0.27, 0.085, 0.035),
      hand: new THREE.SphereGeometry(0.048, 10, 8),
      thigh: rb(0.135, 0.43, 0.145, 0.05),
      shin: rb(0.115, 0.42, 0.12, 0.045),
      boot: rb(0.12, 0.08, 0.26, 0.03),
      carton: rb(0.36, 0.28, 0.3, 0.02),
    } satisfies Record<PartName, THREE.BufferGeometry>
  }, [])
  const vestTex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 64
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#D6F22B'
    ctx.fillRect(0, 0, 64, 64)
    ctx.fillStyle = '#C9CED6'
    ctx.fillRect(0, 22, 64, 6)
    ctx.fillRect(0, 40, 64, 6)
    return new THREE.CanvasTexture(c)
  }, [])
  useEffect(() => () => {
    Object.values(geos).forEach(g => g.dispose())
    vestTex.dispose()
  }, [geos, vestTex])

  const refs = useRef(new Map<PartName, THREE.InstancedMesh>())
  const people = useMemo(() => workers.slice(0, MAX_PEOPLE).map(w => {
    let h = 0
    for (const ch of w.id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0
    const rng = createRng(h)
    return {
      spec: w,
      height: 0.93 + rng() * 0.14,
      build: 0.92 + rng() * 0.2,
      skin: new THREE.Color(SKIN[Math.floor(rng() * SKIN.length)]),
      helmet: new THREE.Color(HELMET[Math.floor(rng() * HELMET.length)]),
      walked: 0,
      dir: 1,
      along: 0,
    }
  }), [workers])

  useEffect(() => {
    sceneStats.workers = people.length
    const head = refs.current.get('head')
    const hand = refs.current.get('hand')
    const helmet = refs.current.get('helmet')
    people.forEach((p, i) => {
      head?.setColorAt(i, p.skin)
      hand?.setColorAt(i * 2, p.skin)
      hand?.setColorAt(i * 2 + 1, p.skin)
      helmet?.setColorAt(i, p.helmet)
    })
    for (const m of [head, hand, helmet]) if (m?.instanceColor) m.instanceColor.needsUpdate = true
  }, [people])

  const M = useMemo(() => ({
    root: new THREE.Matrix4(),
    tmp: new THREE.Matrix4(),
    part: new THREE.Matrix4(),
    q: new THREE.Quaternion(),
    v: new THREE.Vector3(),
    s: new THREE.Vector3(),
    zero: new THREE.Matrix4().makeScale(0, 0, 0),
  }), [])

  useFrame(({ camera, clock }, dt) => {
    const t = freeze ? 0 : clock.elapsedTime
    const counts: Record<PartName, number> = { pelvis: 0, torso: 0, head: 0, helmet: 0, upperArm: 0, forearm: 0, hand: 0, thigh: 0, shin: 0, boot: 0, carton: 0 }
    const set = (name: PartName, m: THREE.Matrix4) => {
      const mesh = refs.current.get(name)
      if (mesh) mesh.setMatrixAt(counts[name]++, m)
    }

    for (const p of people) {
      const w = p.spec
      let x = w.x
      let y = 0
      let z = w.z
      let heading = w.heading
      let travelled = 0
      let activity = w.activity
      const mount = w.equipmentId ? mounts.get(w.equipmentId) : undefined
      if (mount) {
        x = mount.position.x
        z = mount.position.z
        y = mount.kind === 'seat' ? mount.floorY - 0.55 * p.height : mount.kind === 'platform' ? mount.floorY : 0
        heading = mount.heading
        travelled = mount.travelled
        if (mount.kind === 'behind') activity = travelled > 0 ? 'push' : 'stand'
      } else if (w.loop && w.loop.length === 2 && !freeze) {
        // Ambient staff pace their walkway at 1.3 m/s
        const [a, b] = w.loop
        const len = Math.hypot(b[0] - a[0], b[1] - a[1])
        p.along += p.dir * dt * 1.3
        if (p.along > len || p.along < 0) { p.dir *= -1; p.along = Math.min(len, Math.max(0, p.along)) }
        p.walked += dt * 1.3
        const k = p.along / len
        x = a[0] + (b[0] - a[0]) * k
        z = a[1] + (b[1] - a[1]) * k
        heading = Math.atan2((b[0] - a[0]) * p.dir, (b[1] - a[1]) * p.dir)
        travelled = p.walked
      }
      setEntityPosition(w.id, x, y + 1, z)

      const S = p.height
      const B = p.build
      const stride = 1.45 * S
      const phase = (travelled / stride) * Math.PI * 2
      const rig = rigFor(activity, phase, t)
      const far = camera.position.distanceTo(M.v.set(x, y + 1, z)) > LOD_DISTANCE

      M.root.compose(M.v.set(x, y, z), M.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, heading), M.s.set(B, S, B))
      const hipY = 0.92 - rig.crouch
      // Builds a part matrix: root · joint translation · rotations · offset to the part centre
      const limb = (jx: number, jy: number, jz: number, pitch: number, len: number, extra?: THREE.Matrix4) => {
        M.part.copy(M.root).multiply(M.tmp.makeTranslation(jx, jy, jz))
        if (extra) M.part.multiply(extra)
        M.part.multiply(M.tmp.makeRotationX(pitch)).multiply(M.tmp.makeTranslation(0, -len / 2, 0))
        return M.part
      }

      set('pelvis', M.part.copy(M.root).multiply(M.tmp.makeTranslation(0, hipY, 0)))
      const torsoBase = new THREE.Matrix4().copy(M.root).multiply(M.tmp.makeTranslation(0, hipY + 0.06, 0)).multiply(M.tmp.makeRotationX(rig.lean))
      set('torso', M.part.copy(torsoBase).multiply(M.tmp.makeTranslation(0, 0.27, 0)))
      set('head', M.part.copy(torsoBase).multiply(M.tmp.makeTranslation(0, 0.68, 0.01)))
      set('helmet', M.part.copy(torsoBase).multiply(M.tmp.makeTranslation(0, 0.7, 0.01)))

      if (far) {
        // Distant LOD: torso and head only
        for (const name of ['upperArm', 'upperArm', 'forearm', 'forearm', 'hand', 'hand', 'thigh', 'thigh', 'shin', 'shin', 'boot', 'boot'] as PartName[]) set(name, M.zero)
      } else {
        for (const side of [0, 1] as const) {
          const sx = side === 0 ? -1 : 1
          // Arm: shoulder → elbow → wrist, all relative to the leaning torso
          const shoulder = new THREE.Matrix4().copy(torsoBase).multiply(M.tmp.makeTranslation(sx * 0.235, 0.48, 0))
          const upper = new THREE.Matrix4().copy(shoulder).multiply(M.tmp.makeRotationX(rig.upper[side])).multiply(M.tmp.makeRotationZ(sx * 0.06))
          set('upperArm', M.part.copy(upper).multiply(M.tmp.makeTranslation(0, -0.15, 0)))
          const elbow = new THREE.Matrix4().copy(upper).multiply(M.tmp.makeTranslation(0, -0.3, 0)).multiply(M.tmp.makeRotationX(rig.elbow[side]))
          set('forearm', M.part.copy(elbow).multiply(M.tmp.makeTranslation(0, -0.135, 0)))
          set('hand', M.part.copy(elbow).multiply(M.tmp.makeTranslation(0, -0.3, 0)))
          // Leg: hip → knee → ankle
          const thigh = limb(sx * 0.1, hipY - 0.04, 0, rig.thigh[side], 0.43)
          set('thigh', thigh)
          const knee = new THREE.Matrix4().copy(M.root)
            .multiply(M.tmp.makeTranslation(sx * 0.1, hipY - 0.04, 0))
            .multiply(M.tmp.makeRotationX(rig.thigh[side]))
            .multiply(M.tmp.makeTranslation(0, -0.43, 0))
            .multiply(M.tmp.makeRotationX(rig.knee[side]))
          set('shin', M.part.copy(knee).multiply(M.tmp.makeTranslation(0, -0.21, 0)))
          set('boot', M.part.copy(knee).multiply(M.tmp.makeTranslation(0, -0.44, 0.05)))
        }
      }
      if (activity === 'carry') set('carton', M.part.copy(torsoBase).multiply(M.tmp.makeTranslation(0, 0.22, 0.32)))
    }

    for (const [name, mesh] of refs.current) {
      mesh.count = counts[name as PartName]
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
    }
  })

  const torsoClick = (e: ThreeEvent<MouseEvent>) => {
    if (isDragRelease(e) || e.instanceId == null) return
    const p = people[e.instanceId]
    if (!p) return
    e.stopPropagation()
    onSelect(p.spec.id)
  }

  const mesh = (name: PartName, material: THREE.Material | React.ReactNode, extra: Record<string, unknown> = {}) => (
    <instancedMesh
      key={name}
      ref={m => {
        if (m) refs.current.set(name, m)
        else refs.current.delete(name)
      }}
      args={[geos[name], material instanceof THREE.Material ? material : undefined, MAX_PEOPLE * PER_PERSON[name]]}
      count={0}
      castShadow
      frustumCulled={false}
      {...extra}
    >
      {material instanceof THREE.Material ? null : material}
    </instancedMesh>
  )

  return (
    <group>
      {mesh('pelvis', <meshStandardMaterial color="#1E2A44" roughness={0.8} />)}
      {mesh('torso', <meshStandardMaterial map={vestTex} roughness={0.6} />, { onClick: torsoClick })}
      {mesh('head', <meshStandardMaterial roughness={0.7} />)}
      {mesh('helmet', <meshStandardMaterial roughness={0.35} metalness={0.1} />)}
      {mesh('upperArm', <meshStandardMaterial color="#1E3A8A" roughness={0.75} />)}
      {mesh('forearm', <meshStandardMaterial color="#1E3A8A" roughness={0.75} />)}
      {mesh('hand', <meshStandardMaterial roughness={0.7} />)}
      {mesh('thigh', <meshStandardMaterial color="#1E2A44" roughness={0.8} />)}
      {mesh('shin', <meshStandardMaterial color="#1E2A44" roughness={0.8} />)}
      {mesh('boot', <meshStandardMaterial color="#111317" roughness={0.6} />)}
      {mesh('carton', <meshStandardMaterial color="#C8A06A" roughness={0.9} />)}
    </group>
  )
}
