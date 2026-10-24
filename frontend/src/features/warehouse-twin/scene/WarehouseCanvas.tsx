import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { PerformanceMonitor, Stats } from '@react-three/drei'
import { useQueryClient } from '@tanstack/react-query'
import * as THREE from 'three'
import type { Equipment, InventoryLot, Shipment, WarehouseLayout } from '../data/schemas'
import { getProvider, twinKeys } from '../hooks/useTwinData'
import { effectiveTier, useTwinStore, type QualitySetting, type QualityTier } from '../store/twinStore'
import { getSceneParams } from '../world/sceneParams'
import { buildSitePlan, type CameraPresetId } from '../world/sitePlan'
import { frameDock, frameLevel, framePosition, frameRack } from '../world/framing'
import { layoutToWorld } from '../world/layoutToWorld'
import { POSITION_ID_PATTERN } from '../data/schemas'
import { Atmosphere, TIER_SETTINGS } from './Atmosphere'
import { Building } from './Building'
import { CameraRig } from './CameraRig'
import { Docks } from './Docks'
import { Floor } from './Floor'
import { Interaction, type HoverTarget } from './Interaction'
import { Inventory } from './Inventory'
import { Racks } from './Racks'
import { ZoneProps } from './ZoneProps'
import { Yard } from './Yard'

export interface WarehouseCanvasProps {
  layout: WarehouseLayout
  shipments: Shipment[]
  lots: InventoryLot[]
  equipment: Equipment[]
  /** LIVE data older than the staleness threshold; equipment stops animating from it */
  stale: boolean
  onContextLost: () => void
  onContextRestored: () => void
}

const TIER_ORDER: QualityTier[] = ['low', 'medium', 'high']

export default function WarehouseCanvas({ layout, shipments, lots, equipment, stale, onContextLost, onContextRestored }: WarehouseCanvasProps) {
  const { seed, debug, freeze } = getSceneParams()
  const plan = useMemo(() => buildSitePlan(layout, seed), [layout, seed])
  const quality = useTwinStore(s => s.quality)
  const tier = useTwinStore(effectiveTier)
  const cutaway = useTwinStore(s => s.cutaway)
  const setAutoTier = useTwinStore(s => s.setAutoTier)
  const selection = useTwinStore(s => s.selection)
  const highlightSku = useTwinStore(s => s.highlightSku)
  const selectedEntity = useTwinStore(s => s.selectedEntity)
  const [hover, setHover] = useState<HoverTarget>(null)
  const parkingBays = useMemo(() => equipment.map(e => e.home), [equipment])

  const onSelectRack = useCallback((rackId: string) => {
    const rack = layout.racks.find(r => r.id === rackId)
    if (!rack) return
    useTwinStore.getState().selectRack(rackId)
    useTwinStore.getState().requestCamera(frameRack(layout, rack))
  }, [layout])
  const onSelectLevel = useCallback((rackId: string, level: number) => {
    const rack = layout.racks.find(r => r.id === rackId)
    if (!rack) return
    const s = useTwinStore.getState()
    if (s.selection.rackId !== rackId) s.selectRack(rackId)
    s.selectLevel(level)
    s.requestCamera(frameLevel(layout, rack, level))
  }, [layout])
  const onSelectPosition = useCallback((positionId: string) => {
    useTwinStore.getState().selectPosition(positionId)
    const pose = framePosition(layout, positionId)
    if (pose) useTwinStore.getState().requestCamera(pose)
  }, [layout])
  const onSelectDock = useCallback((dockId: string) => {
    const dock = layout.docks.find(d => d.id === dockId)
    if (!dock) return
    useTwinStore.getState().selectEntity({ kind: 'dock', id: dockId })
    const pose = frameDock(layout, dock)
    if (pose) useTwinStore.getState().requestCamera(pose)
  }, [layout])
  const onHoverPosition = useCallback((id: string | null) => {
    setHover(h => (id ? (h?.id === id ? h : { kind: 'position', id }) : h?.kind === 'position' ? null : h))
  }, [])

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
        el.setAttribute('aria-label', `3D view of ${layout.name}: racks, stock, docks and yard. Every action here is also available from the panels; keys 1 to 6 change the view.`)
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
      <ZoneProps layout={layout} plan={plan} parkingBays={parkingBays} />
      <Racks layout={layout} clearHeight={plan.heights.clear} />
      <Inventory layout={layout} lots={lots} highlightSku={highlightSku} onPick={onSelectPosition} onHover={onHoverPosition} />
      <Interaction
        layout={layout}
        lots={lots}
        selection={selection}
        selectedDockId={selectedEntity?.kind === 'dock' ? selectedEntity.id : null}
        hover={hover}
        setHover={setHover}
        onSelectRack={onSelectRack}
        onSelectLevel={onSelectLevel}
        onSelectPosition={onSelectPosition}
        onSelectDock={onSelectDock}
      />
      <CameraRig plan={plan} />
      <StaticShadows deps={[tier, layout, cutaway, lots]} />
      <SceneReady />
      {import.meta.env.DEV || debug ? <DevHook presets={plan.presets.map(p => p.id)} layout={layout} onSelectPosition={onSelectPosition} onSelectDock={onSelectDock} /> : null}
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
  /** Same path as clicking the position in 3D: selects it and frames it */
  selectPosition: (id: string | null) => void
  /** Position, dock, shipment or equipment id */
  selectEntity: (id: string | null) => void
  getCamera: () => { position: [number, number, number]; target: [number, number, number] }
  /** Client-space pixel of a layout element's centre, for real pointer clicks in tests */
  screenOf: (id: string) => { x: number; y: number; visible: boolean } | null
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
    selectedPosition: string | null
    selectedRack: string | null
    selectedEntity: string | null
    highlightSku: string | null
  }
  stepSim: (n: number) => Promise<void>
}

declare global {
  interface Window {
    __SR3D__?: SR3DHook
  }
}

interface DevHookProps {
  presets: CameraPresetId[]
  layout: WarehouseLayout
  onSelectPosition: (id: string) => void
  onSelectDock: (id: string) => void
}

/** Dev-only automation hook used by the Playwright suite. */
function DevHook({ presets, layout, onSelectPosition, onSelectDock }: DevHookProps) {
  const gl = useThree(s => s.gl)
  const scene = useThree(s => s.scene)
  const camera = useThree(s => s.camera)
  const controls = useThree(s => s.controls) as { getTarget?: (v: THREE.Vector3) => THREE.Vector3 } | null
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
      selectPosition: id => {
        if (id) onSelectPosition(id)
        else useTwinStore.getState().selectPosition(null)
      },
      selectEntity: id => {
        const s = useTwinStore.getState()
        if (!id) return s.selectEntity(null)
        if (POSITION_ID_PATTERN.test(id)) return onSelectPosition(id)
        if (layout.docks.some(d => d.id === id)) return onSelectDock(id)
        const shipments = qc.getQueryData<{ id: string }[]>(twinKeys.shipments(s.mode)) ?? []
        if (shipments.some(x => x.id === id)) return s.selectEntity({ kind: 'shipment', id })
        const equipment = qc.getQueryData<{ id: string }[]>(twinKeys.equipment(s.mode)) ?? []
        if (equipment.some(x => x.id === id)) return s.selectEntity({ kind: 'equipment', id })
      },
      getCamera: () => {
        const t = controls?.getTarget ? controls.getTarget(new THREE.Vector3()) : new THREE.Vector3()
        return { position: camera.position.toArray() as [number, number, number], target: t.toArray() as [number, number, number] }
      },
      screenOf: id => {
        const t = layoutToWorld(layout, id)
        if (!t) return null
        const lift = t.kind === 'rack' ? t.size[1] * 0.45 : t.kind === 'position' ? 0.6 : t.kind === 'dock' ? 1.7 : 0
        const v = new THREE.Vector3(t.position[0], t.position[1] + lift, t.position[2]).project(camera)
        const r = gl.domElement.getBoundingClientRect()
        return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height, visible: v.z > -1 && v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 }
      },
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
          selectedPosition: s.selection.positionId,
          selectedRack: s.selection.rackId,
          selectedEntity: s.selectedEntity?.id ?? null,
          highlightSku: s.highlightSku,
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
  }, [gl, scene, camera, controls, qc, presets, layout, onSelectPosition, onSelectDock])
  return null
}
