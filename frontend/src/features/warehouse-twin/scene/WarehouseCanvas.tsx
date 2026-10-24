import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { PerformanceMonitor, Stats } from '@react-three/drei'
import { useQueryClient } from '@tanstack/react-query'
import * as THREE from 'three'
import type { Shipment, WarehouseLayout } from '../data/schemas'
import { getProvider, twinKeys } from '../hooks/useTwinData'
import { effectiveTier, useTwinStore, type QualitySetting, type QualityTier } from '../store/twinStore'
import { getSceneParams } from '../world/sceneParams'
import { buildSitePlan, type CameraPresetId } from '../world/sitePlan'
import { Atmosphere, TIER_SETTINGS } from './Atmosphere'
import { Building } from './Building'
import { CameraRig } from './CameraRig'
import { Docks } from './Docks'
import { Floor } from './Floor'
import { Yard } from './Yard'

export interface WarehouseCanvasProps {
  layout: WarehouseLayout
  shipments: Shipment[]
  /** LIVE data older than the staleness threshold; equipment stops animating from it */
  stale: boolean
  onContextLost: () => void
  onContextRestored: () => void
}

const TIER_ORDER: QualityTier[] = ['low', 'medium', 'high']

export default function WarehouseCanvas({ layout, shipments, stale, onContextLost, onContextRestored }: WarehouseCanvasProps) {
  const { seed, debug, freeze } = getSceneParams()
  const plan = useMemo(() => buildSitePlan(layout, seed), [layout, seed])
  const quality = useTwinStore(s => s.quality)
  const tier = useTwinStore(effectiveTier)
  const cutaway = useTwinStore(s => s.cutaway)
  const setAutoTier = useTwinStore(s => s.setAutoTier)
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.visibilityState === 'hidden')

  // Pause rendering in background tabs
  useEffect(() => {
    const onVis = () => setHidden(document.visibilityState === 'hidden')
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const exterior = plan.presets[0]
  const settings = TIER_SETTINGS[tier]

  const step = (dir: 1 | -1) => {
    // Frozen runs keep a fixed tier so frames are deterministic
    if (quality !== 'auto' || freeze) return
    const i = TIER_ORDER.indexOf(useTwinStore.getState().autoTier)
    const next = TIER_ORDER[Math.min(TIER_ORDER.length - 1, Math.max(0, i + dir))]
    if (next !== TIER_ORDER[i]) setAutoTier(next)
  }

  return (
    <Canvas
      shadows={{ type: THREE.PCFShadowMap }}
      dpr={settings.dpr}
      frameloop={hidden ? 'never' : 'always'}
      gl={{ antialias: tier === 'low', powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.0 }}
      camera={{ fov: 42, near: 0.1, far: 2500, position: exterior.position }}
      onCreated={({ gl }) => {
        const el = gl.domElement
        el.setAttribute('role', 'img')
        el.setAttribute('aria-label', `3D view of ${layout.name}: building, yard and docks. Use the panels or keys 1 to 6 to change view.`)
        el.addEventListener('webglcontextlost', e => {
          e.preventDefault()
          onContextLost()
        })
        el.addEventListener('webglcontextrestored', () => onContextRestored())
      }}
      style={{ filter: stale ? 'saturate(0.55) brightness(0.97)' : undefined, transition: 'filter 600ms ease' }}
    >
      <PerformanceMonitor onIncline={() => step(1)} onDecline={() => step(-1)} flipflops={3} />
      <Atmosphere plan={plan} tier={tier} />
      <Yard layout={layout} plan={plan} seed={seed} />
      <Building layout={layout} plan={plan} cutaway={cutaway} />
      <Floor layout={layout} plan={plan} tier={tier} seed={seed} />
      <Docks layout={layout} shipments={shipments} />
      <CameraRig plan={plan} />
      <StaticShadows deps={[tier, layout, cutaway]} />
      <SceneReady />
      {import.meta.env.DEV || debug ? <DevHook presets={plan.presets.map(p => p.id)} /> : null}
      {debug && <Stats />}
    </Canvas>
  )
}

/** Static geometry: render the shadow map on demand instead of every frame. */
function StaticShadows({ deps }: { deps: unknown[] }) {
  const gl = useThree(s => s.gl)
  const pending = useRef(3)
  useEffect(() => {
    gl.shadowMap.autoUpdate = false
    gl.shadowMap.needsUpdate = true
    pending.current = 3
    return () => {
      gl.shadowMap.autoUpdate = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, ...deps])
  useFrame(() => {
    if (pending.current <= 0) return
    gl.shadowMap.needsUpdate = true
    pending.current--
  })
  return null
}

function SceneReady() {
  const setSceneReady = useTwinStore(s => s.setSceneReady)
  const frames = useRef(0)
  useFrame(() => {
    frames.current++
    if (frames.current === 3) setSceneReady(true)
  })
  useEffect(() => () => setSceneReady(false), [setSceneReady])
  return null
}

export interface SR3DHook {
  info: () => {
    calls: number
    triangles: number
    geometries: number
    textures: number
    programs: number
    shadowMaps: number
    shadowCasters: number
    shadowsEnabled: boolean
  }
  setPreset: (id: CameraPresetId) => void
  setQuality: (q: QualitySetting) => void
  selectPosition: (id: string | null) => void
  selectEntity: (id: string | null) => void
  getSnapshot: () => {
    mode: string
    preset: CameraPresetId
    tier: QualityTier
    cutaway: boolean
    ready: boolean
    lots: number
    equipment: number
    workers: number
    ghosts: number
  }
  stepSim: (n: number) => Promise<void>
}

declare global {
  interface Window {
    __SR3D__?: SR3DHook
  }
}

/** Dev-only automation hook used by the Playwright suite. */
function DevHook({ presets }: { presets: CameraPresetId[] }) {
  const gl = useThree(s => s.gl)
  const scene = useThree(s => s.scene)
  const qc = useQueryClient()
  useEffect(() => {
    window.__SR3D__ = {
      info: () => {
        let shadowMaps = 0
        let shadowCasters = 0
        scene.traverse(o => {
          if ((o as THREE.DirectionalLight).isDirectionalLight && (o as THREE.DirectionalLight).shadow?.map) shadowMaps++
          if ((o as THREE.Mesh).isMesh && o.castShadow) shadowCasters++
        })
        return {
          calls: gl.info.render.calls,
          triangles: gl.info.render.triangles,
          geometries: gl.info.memory.geometries,
          textures: gl.info.memory.textures,
          programs: gl.info.programs?.length ?? 0,
          shadowMaps,
          shadowCasters,
          shadowsEnabled: gl.shadowMap.enabled,
        }
      },
      setPreset: id => {
        if (presets.includes(id)) useTwinStore.getState().setPreset(id)
      },
      setQuality: q => useTwinStore.getState().setQuality(q),
      selectPosition: id => useTwinStore.getState().selectPosition(id),
      selectEntity: id => useTwinStore.getState().selectPosition(id),
      getSnapshot: () => {
        const s = useTwinStore.getState()
        const lots = qc.getQueryData<unknown[]>(twinKeys.inventory(s.mode))?.length ?? 0
        const equipment = qc.getQueryData<unknown[]>(twinKeys.equipment(s.mode))?.length ?? 0
        return {
          mode: s.mode,
          preset: s.preset,
          tier: effectiveTier(s),
          cutaway: s.cutaway,
          ready: s.sceneReady,
          lots,
          equipment,
          // Workers and ghost pallets are rendered from Stage 3/4 onwards
          workers: 0,
          ghosts: 0,
        }
      },
      stepSim: async n => {
        if (useTwinStore.getState().mode !== 'simulation') return
        const sim = getProvider('simulation')
        for (let i = 0; i < n; i++) await sim.step()
      },
    }
    return () => {
      delete window.__SR3D__
    }
  }, [gl, scene, qc, presets])
  return null
}
