import { create } from 'zustand'
import type { ConnectionState, DataMode } from '../data/provider'
import type { TwinEvent } from '../data/schemas'
import type { SimState } from '../data/simProvider'
import type { CameraPose, CameraPresetId } from '../world/sitePlan'

export interface SelectedEntity {
  kind: 'dock' | 'shipment' | 'equipment' | 'worker'
  id: string
}

export type ViewMode = 'before' | 'proposed' | 'after'
export type TimeOfDay = 'day' | 'golden' | 'night'
export type Weather = 'clear' | 'rain' | 'fog'

/** Key for when an entity entered its current state (from stream events) */
export const startKey = (kind: 'equipment' | 'shipment', id: string, state: string) => `${kind}:${id}:${state}`

const MODE_KEY = 'stockrescue_twin_mode'
const EVENT_LOG_LIMIT = 150

function initialMode(): DataMode {
  try {
    const stored = localStorage.getItem(MODE_KEY)
    if (stored === 'live' || stored === 'simulation') return stored
  } catch {
    // storage unavailable
  }
  return import.meta.env.VITE_TWIN_MODE === 'live' ? 'live' : 'simulation'
}

export interface Selection {
  rackId: string | null
  level: number | null
  positionId: string | null
}

export type QualityTier = 'low' | 'medium' | 'high'
export type QualitySetting = QualityTier | 'auto'

export interface LoggedEvent {
  seq: number
  mode: DataMode
  event: TwinEvent
}

interface TwinState {
  mode: DataMode
  selection: Selection
  highlightSku: string | null
  connection: ConnectionState
  sim: SimState | null
  events: LoggedEvent[]

  /** Scene view state */
  preset: CameraPresetId
  /** Bumps on every preset request so re-selecting the same preset re-frames */
  presetNonce: number
  /** True while the exterior → interior camera move is playing */
  cinematic: boolean
  /** Bumps when the HUD asks for the entry cinematic */
  entryNonce: number
  /** A non-position object selected in 3D or in the live table */
  selectedEntity: SelectedEntity | null
  cameraRequest: { nonce: number; pose: CameraPose; cutaway: boolean } | null
  /** Camera follows this moving entity */
  follow: SelectedEntity | null
  viewMode: ViewMode
  tour: { nonce: number; poses: CameraPose[] } | null
  timeOfDay: TimeOfDay
  weather: Weather
  walk: boolean
  /** Decorative staff on walkways; off by default and labelled */
  ambientStaff: boolean
  /** Wall-clock ms when an equipment task / shipment status began, from events */
  startedAt: Record<string, number>
  cutaway: boolean
  quality: QualitySetting
  autoTier: QualityTier
  sceneReady: boolean
  /** Wall-clock ms of the last stream event, for staleness */
  lastEventAt: number | null

  setMode: (mode: DataMode) => void
  selectRack: (rackId: string | null) => void
  selectLevel: (level: number | null) => void
  selectPosition: (positionId: string | null) => void
  clearSelection: () => void
  setHighlightSku: (sku: string | null) => void
  setConnection: (state: ConnectionState) => void
  setSim: (sim: SimState | null) => void
  pushEvent: (event: TwinEvent) => void
  clearEvents: () => void
  setPreset: (preset: CameraPresetId) => void
  setCinematic: (on: boolean) => void
  requestEntry: () => void
  selectEntity: (entity: SelectedEntity | null) => void
  /** Fly the camera to a pose (row-to-camera sync, search, selection) */
  requestCamera: (pose: CameraPose, cutaway?: boolean) => void
  setFollow: (e: SelectedEntity | null) => void
  setViewMode: (m: ViewMode) => void
  requestTour: (poses: CameraPose[]) => void
  setTimeOfDay: (t: TimeOfDay) => void
  setWeather: (w: Weather) => void
  setWalk: (on: boolean) => void
  setAmbientStaff: (on: boolean) => void
  setCutaway: (on: boolean) => void
  setQuality: (q: QualitySetting) => void
  setAutoTier: (t: QualityTier) => void
  setSceneReady: (ready: boolean) => void
}

const NO_SELECTION: Selection = { rackId: null, level: null, positionId: null }
let eventSeq = 0

export const useTwinStore = create<TwinState>(set => ({
  mode: initialMode(),
  selection: NO_SELECTION,
  highlightSku: null,
  connection: 'connecting',
  sim: null,
  events: [],
  preset: 'exterior',
  presetNonce: 0,
  cinematic: false,
  entryNonce: 0,
  selectedEntity: null,
  cameraRequest: null,
  follow: null,
  viewMode: 'proposed',
  tour: null,
  timeOfDay: 'day',
  weather: 'clear',
  walk: false,
  ambientStaff: false,
  startedAt: {},
  cutaway: false,
  quality: 'auto',
  autoTier: 'medium',
  sceneReady: false,
  lastEventAt: null,

  setMode: mode => {
    try {
      localStorage.setItem(MODE_KEY, mode)
    } catch {
      // storage unavailable
    }
    set({ mode, selection: NO_SELECTION, selectedEntity: null, follow: null, highlightSku: null, events: [], sim: null, connection: 'connecting', lastEventAt: null, startedAt: {} })
  },
  selectRack: rackId => set({ selection: { rackId, level: null, positionId: null }, selectedEntity: null }),
  selectLevel: level => set(s => ({ selection: { ...s.selection, level, positionId: null } })),
  selectPosition: positionId => {
    if (!positionId) {
      set(s => ({ selection: { ...s.selection, positionId: null } }))
      return
    }
    const [aisle, rack, level] = positionId.split('-')
    set({ selection: { rackId: `${aisle}-${rack}`, level: Number(level.slice(1)), positionId }, selectedEntity: null })
  },
  clearSelection: () => set({ selection: NO_SELECTION }),
  selectEntity: entity => set(s => ({ selectedEntity: entity, selection: entity ? NO_SELECTION : s.selection })),
  setFollow: follow => set({ follow }),
  setViewMode: viewMode => set({ viewMode }),
  requestTour: poses => set(s => ({ tour: { nonce: (s.tour?.nonce ?? 0) + 1, poses } })),
  setTimeOfDay: timeOfDay => set({ timeOfDay }),
  setWeather: weather => set({ weather }),
  setWalk: walk => set({ walk, follow: null }),
  setAmbientStaff: ambientStaff => set({ ambientStaff }),
  requestCamera: (pose, cutaway = false) =>
    set(s => ({ cameraRequest: { nonce: (s.cameraRequest?.nonce ?? 0) + 1, pose, cutaway } })),
  setHighlightSku: highlightSku => set({ highlightSku }),
  setConnection: connection => set({ connection }),
  setSim: sim => set({ sim }),
  pushEvent: event =>
    set(s => {
      const at = Date.parse(event.at) || Date.now()
      let startedAt = s.startedAt
      // Record only the first time an entity enters a state, so re-delivered events are idempotent
      const mark = (key: string) => {
        if (startedAt[key] === undefined) startedAt = { ...startedAt, [key]: at }
      }
      if (event.type === 'equipment.task' && event.equipment.currentTask) mark(startKey('equipment', event.equipment.id, event.equipment.currentTask.id))
      if (event.type === 'shipment.status') mark(startKey('shipment', event.shipment.id, event.shipment.status))
      return {
        events: [{ seq: ++eventSeq, mode: s.mode, event }, ...s.events].slice(0, EVENT_LOG_LIMIT),
        lastEventAt: Date.now(),
        startedAt,
      }
    }),
  clearEvents: () => set({ events: [], startedAt: {} }),
  setPreset: preset => set(s => ({ preset, presetNonce: s.presetNonce + 1 })),
  setCinematic: cinematic => set({ cinematic }),
  requestEntry: () => set(s => ({ entryNonce: s.entryNonce + 1 })),
  setCutaway: cutaway => set({ cutaway }),
  setQuality: quality => set({ quality }),
  setAutoTier: autoTier => set({ autoTier }),
  setSceneReady: sceneReady => set({ sceneReady }),
}))

export const effectiveTier = (s: { quality: QualitySetting; autoTier: QualityTier }): QualityTier =>
  s.quality === 'auto' ? s.autoTier : s.quality
