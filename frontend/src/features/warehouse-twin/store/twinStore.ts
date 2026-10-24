import { create } from 'zustand'
import type { ConnectionState, DataMode } from '../data/provider'
import type { TwinEvent } from '../data/schemas'
import type { SimState } from '../data/simProvider'
import type { CameraPresetId } from '../world/sitePlan'

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
    set({ mode, selection: NO_SELECTION, highlightSku: null, events: [], sim: null, connection: 'connecting', lastEventAt: null })
  },
  selectRack: rackId => set({ selection: { rackId, level: null, positionId: null } }),
  selectLevel: level => set(s => ({ selection: { ...s.selection, level, positionId: null } })),
  selectPosition: positionId => {
    if (!positionId) {
      set(s => ({ selection: { ...s.selection, positionId: null } }))
      return
    }
    const [aisle, rack, level] = positionId.split('-')
    set({ selection: { rackId: `${aisle}-${rack}`, level: Number(level.slice(1)), positionId } })
  },
  clearSelection: () => set({ selection: NO_SELECTION }),
  setHighlightSku: highlightSku => set({ highlightSku }),
  setConnection: connection => set({ connection }),
  setSim: sim => set({ sim }),
  pushEvent: event =>
    set(s => ({
      events: [{ seq: ++eventSeq, mode: s.mode, event }, ...s.events].slice(0, EVENT_LOG_LIMIT),
      lastEventAt: Date.now(),
    })),
  clearEvents: () => set({ events: [] }),
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
