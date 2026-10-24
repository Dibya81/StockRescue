import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { GROUND_Y } from '../world/constants'
import { createRng, getSceneParams } from '../world/sceneParams'
import type { SitePlan } from '../world/sitePlan'

const STREAKS = 2200
const RIPPLES = 160

/** Rain is a labelled visual state: streaks outside the building and ripples on the apron. */
export function Rain({ plan }: { plan: SitePlan }) {
  const { seed, freeze } = getSceneParams()
  const streakRef = useRef<THREE.InstancedMesh>(null)
  const rippleRef = useRef<THREE.InstancedMesh>(null)
  const drops = useMemo(() => {
    const rng = createRng(seed + 77)
    const s = plan.site
    const fp = plan.footprint
    const out: { x: number; y: number; z: number; v: number }[] = []
    while (out.length < STREAKS) {
      const x = s.minX + rng() * (s.maxX - s.minX)
      const z = s.minZ + rng() * (s.maxZ - s.minZ)
      // No rain inside the roofed footprint
      if (x > fp.minX && x < fp.maxX && z > fp.minZ && z < fp.maxZ) continue
      out.push({ x, y: GROUND_Y + rng() * 28, z, v: 18 + rng() * 8 })
    }
    return out
  }, [seed, plan])
  const ripples = useMemo(() => {
    const rng = createRng(seed + 78)
    const a = plan.apron
    return Array.from({ length: RIPPLES }, () => ({ x: a.minX + rng() * (a.maxX - a.minX), z: a.minZ + 1 + rng() * (a.maxZ - a.minZ - 1), phase: rng() }))
  }, [seed, plan])
  const m = useMemo(() => new THREE.Matrix4(), [])
  const q = useMemo(() => new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)), [])
  const v = useMemo(() => new THREE.Vector3(), [])
  const sc = useMemo(() => new THREE.Vector3(), [])
  const rippleMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#E2E8F0', transparent: true, opacity: 0.35, depthWrite: false }), [])
  useEffect(() => () => rippleMat.dispose(), [rippleMat])

  useFrame(({ clock }, dt) => {
    const step = freeze ? 0 : Math.min(dt, 0.05)
    const s = streakRef.current
    if (s) {
      drops.forEach((d, i) => {
        d.y -= d.v * step
        if (d.y < GROUND_Y) d.y += 28
        s.setMatrixAt(i, m.makeTranslation(d.x, d.y, d.z))
      })
      s.instanceMatrix.needsUpdate = true
    }
    const r = rippleRef.current
    if (r) {
      const t = freeze ? 0.5 : clock.elapsedTime
      ripples.forEach((p, i) => {
        const k = (t * 0.9 + p.phase) % 1
        r.setMatrixAt(i, m.compose(v.set(p.x, GROUND_Y + 0.015, p.z), q, sc.set(0.05 + k * 0.45, 0.05 + k * 0.45, 1)))
      })
      r.instanceMatrix.needsUpdate = true
    }
  })

  return (
    <group>
      <instancedMesh ref={streakRef} args={[undefined, undefined, STREAKS]} frustumCulled={false}>
        <boxGeometry args={[0.012, 0.55, 0.012]} />
        <meshBasicMaterial color="#C7D2DE" transparent opacity={0.45} depthWrite={false} />
      </instancedMesh>
      <instancedMesh ref={rippleRef} args={[undefined, rippleMat, RIPPLES]} frustumCulled={false}>
        <ringGeometry args={[0.85, 1, 24]} />
      </instancedMesh>
    </group>
  )
}
