import { useCallback, useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { CameraControls } from '@react-three/drei'
import * as THREE from 'three'
import { useTwinStore } from '../store/twinStore'
import { GROUND_Y } from '../world/constants'
import { getSceneParams } from '../world/sceneParams'
import { entityPositions } from './registry'
import type { CameraPose, CameraPreset, SitePlan } from '../world/sitePlan'

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

export function CameraRig({ plan }: { plan: SitePlan }) {
  const controlsRef = useRef<CameraControls>(null)
  const camera = useThree(s => s.camera)
  const gl = useThree(s => s.gl)
  const presetNonce = useTwinStore(s => s.presetNonce)
  const entryNonce = useTwinStore(s => s.entryNonce)
  const setCinematic = useTwinStore(s => s.setCinematic)
  const walk = useTwinStore(s => s.walk)
  const sequence = useRef(0)
  const initialised = useRef(false)
  const fp = plan.footprint
  const { freeze } = getSceneParams()

  const animate = useCallback(() => !freeze && !prefersReducedMotion(), [freeze])

  const lookAt = useCallback((pose: CameraPose, transition: boolean) => {
    const c = controlsRef.current
    if (!c) return Promise.resolve()
    return c.setLookAt(...pose.position, ...pose.target, transition)
  }, [])

  const isInside = useCallback((v: THREE.Vector3) => v.x > fp.minX && v.x < fp.maxX && v.z > fp.minZ && v.z < fp.maxZ, [fp])

  const runEntry = useCallback(async (final: CameraPreset) => {
    const c = controlsRef.current
    if (!c) return
    const token = ++sequence.current
    if (!animate()) {
      await lookAt(final, false)
      setCinematic(false)
      return
    }
    useTwinStore.setState({ cinematic: true })
    c.smoothTime = 1.1
    for (const pose of plan.entryPath) {
      if (token !== sequence.current) return
      await lookAt(pose, true)
    }
    if (token !== sequence.current) return
    await lookAt(final, true)
    if (token !== sequence.current) return
    c.smoothTime = 0.35
    setCinematic(false)
  }, [animate, lookAt, plan.entryPath, setCinematic])

  const skipCinematic = useCallback(() => {
    const c = controlsRef.current
    if (!c || !useTwinStore.getState().cinematic) return
    sequence.current++
    c.smoothTime = 0.35
    const final = plan.presets.find(p => p.id === useTwinStore.getState().preset) ?? plan.presets[0]
    void lookAt(final, false)
    setCinematic(false)
  }, [lookAt, plan.presets, setCinematic])

  // Limits, damping and initial pose
  useEffect(() => {
    const c = controlsRef.current
    if (!c) return
    const s = plan.site
    c.setBoundary(new THREE.Box3(new THREE.Vector3(s.minX - 10, GROUND_Y + 0.3, s.minZ - 10), new THREE.Vector3(s.maxX + 10, 60, s.maxZ + 10)))
    c.boundaryFriction = 0.2
    c.minDistance = 1.5
    c.maxDistance = 260
    c.maxPolarAngle = Math.PI / 2 - 0.04
    c.smoothTime = 0.35
    c.draggingSmoothTime = 0.12
    c.dollyToCursor = true
    // Taking the mouse (orbit, pan, zoom) hands control back to the user
    const onUserControl = () => {
      const st = useTwinStore.getState()
      if (st.follow) st.setFollow(null)
    }
    c.addEventListener('controlstart', onUserControl)
    // First mount, and every return from walk mode, frames the current preset
    initialised.current = true
    const start = plan.presets.find(p => p.id === useTwinStore.getState().preset) ?? plan.presets[0]
    void lookAt(start, false)
    return () => c.removeEventListener('controlstart', onUserControl)
  }, [plan, lookAt, walk])

  // Preset requests (including re-selecting the current one)
  useEffect(() => {
    if (!initialised.current || presetNonce === 0) return
    const target = plan.presets.find(p => p.id === useTwinStore.getState().preset)
    if (!target) return
    if (target.interior && !isInside(camera.position)) {
      void runEntry(target)
    } else {
      sequence.current++
      if (controlsRef.current) controlsRef.current.smoothTime = 0.35
      if (useTwinStore.getState().cinematic) setCinematic(false)
      void lookAt(target, animate())
    }
  }, [presetNonce, plan.presets, camera, isInside, runEntry, lookAt, animate, setCinematic])

  // "Enter building" from the HUD: always starts from the exterior
  useEffect(() => {
    if (entryNonce === 0) return
    const storage = plan.presets.find(p => p.id === 'storage') ?? plan.presets[0]
    const exterior = plan.presets.find(p => p.id === 'exterior') ?? plan.presets[0]
    // Updating `preset` without bumping the nonce does not re-trigger framing
    useTwinStore.setState({ preset: storage.id })
    void lookAt(exterior, false).then(() => runEntry(storage))
  }, [entryNonce, plan.presets, lookAt, runEntry])

  // Fly-to requests from selection, search and the live table
  const cameraRequest = useTwinStore(s => s.cameraRequest)
  useEffect(() => {
    if (!cameraRequest || !initialised.current) return
    sequence.current++
    const c = controlsRef.current
    if (c) c.smoothTime = 0.45
    if (useTwinStore.getState().cinematic) setCinematic(false)
    if (cameraRequest.cutaway) useTwinStore.getState().setCutaway(true)
    void lookAt(cameraRequest.pose, animate())
  }, [cameraRequest, lookAt, animate, setCinematic])

  // Guided "Show impact" tour through the plan's actions; any click skips to the end
  const tour = useTwinStore(s => s.tour)
  useEffect(() => {
    if (!tour || tour.poses.length === 0) return
    const c = controlsRef.current
    if (!c) return
    const token = ++sequence.current
    const run = async () => {
      if (!animate()) return lookAt(tour.poses[tour.poses.length - 1], false)
      useTwinStore.setState({ cinematic: true, follow: null })
      c.smoothTime = 0.9
      for (const pose of tour.poses) {
        if (token !== sequence.current) return
        await lookAt(pose, true)
        await new Promise(r => setTimeout(r, 700))
      }
      if (token !== sequence.current) return
      c.smoothTime = 0.35
      setCinematic(false)
    }
    void run()
  }, [tour, lookAt, animate, setCinematic])

  // Follow a moving vehicle or person, keeping the current viewing offset
  useFrame(() => {
    const s = useTwinStore.getState()
    const c = controlsRef.current
    if (!c || !s.follow || s.cinematic) return
    const p = entityPositions.get(s.follow.id)
    if (p) void c.moveTo(p.x, p.y, p.z, true)
  })

  // Game-style keys: WASD / arrows move over the ground, Q/E turn, R/F zoom, Shift is faster
  const held = useRef(new Set<string>())
  useEffect(() => {
    const typing = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
    }
    const MOVE = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyQ', 'KeyE', 'KeyR', 'KeyF', 'ShiftLeft', 'ShiftRight'])
    const down = (e: KeyboardEvent) => {
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey || !MOVE.has(e.code)) return
      if (useTwinStore.getState().walk) return
      if (e.code.startsWith('Arrow')) e.preventDefault()
      held.current.add(e.code)
    }
    const up = (e: KeyboardEvent) => held.current.delete(e.code)
    const blur = () => held.current.clear()
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])
  const tmpT = useRef(new THREE.Vector3())
  useFrame((_, dt) => {
    const k = held.current
    const c = controlsRef.current
    if (!c || k.size === 0 || useTwinStore.getState().walk) return
    const s = useTwinStore.getState()
    if (s.cinematic) skipCinematic()
    if (s.follow) s.setFollow(null)
    const step = Math.min(dt, 0.05)
    const fast = k.has('ShiftLeft') || k.has('ShiftRight') ? 2.5 : 1
    const dist = c.distance
    // Pan speed scales with zoom so it feels the same close up and far away
    const speed = Math.max(4, dist * 0.9) * fast * step
    let f = 0
    let r = 0
    if (k.has('KeyW') || k.has('ArrowUp')) f += 1
    if (k.has('KeyS') || k.has('ArrowDown')) f -= 1
    if (k.has('KeyD') || k.has('ArrowRight')) r += 1
    if (k.has('KeyA') || k.has('ArrowLeft')) r -= 1
    if (f || r) {
      const az = c.azimuthAngle
      // Ground-plane forward/right relative to where the camera looks
      const fx = -Math.sin(az)
      const fz = -Math.cos(az)
      const t = c.getTarget(tmpT.current)
      void c.moveTo(t.x + (fx * f - fz * r) * speed, t.y, t.z + (fz * f + fx * r) * speed, false)
    }
    if (k.has('KeyQ')) void c.rotate(1.6 * fast * step, 0, false)
    if (k.has('KeyE')) void c.rotate(-1.6 * fast * step, 0, false)
    if (k.has('KeyR')) void c.dolly(Math.max(2, dist * 1.2) * fast * step, false)
    if (k.has('KeyF')) void c.dolly(-Math.max(2, dist * 1.2) * fast * step, false)
  })

  // Hotkeys 1-6, Esc steps back one level
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      if (e.key === 'Escape') {
        const s = useTwinStore.getState()
        if (s.cinematic) return skipCinematic()
        if (s.follow) return s.setFollow(null)
        if (s.selection.positionId) return s.selectPosition(null)
        if (s.selection.level != null) return s.selectLevel(null)
        if (s.selection.rackId) return s.clearSelection()
        if (s.selectedEntity) return s.selectEntity(null)
        return
      }
      const p = plan.presets.find(x => x.hotkey === e.key)
      if (p && !e.metaKey && !e.ctrlKey && !e.altKey) useTwinStore.getState().setPreset(p.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [plan.presets, skipCinematic])

  // Any click skips the cinematic
  useEffect(() => {
    const el = gl.domElement
    const onDown = () => skipCinematic()
    el.addEventListener('pointerdown', onDown)
    return () => el.removeEventListener('pointerdown', onDown)
  }, [gl, skipCinematic])

  // Never below the slab when inside the building
  useFrame(() => {
    const c = controlsRef.current
    if (!c || useTwinStore.getState().cinematic) return
    const p = camera.position
    if (isInside(p) && p.y < 0.6) {
      const t = c.getTarget(new THREE.Vector3())
      void c.setLookAt(p.x, 0.6, p.z, t.x, Math.max(t.y, 0.3), t.z, false)
    }
  })

  // Walk mode owns the camera; orbit controls come back on exit
  return walk ? null : <CameraControls ref={controlsRef} makeDefault />
}
