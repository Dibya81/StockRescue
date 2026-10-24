import { create } from 'zustand'
import type { ConnectionState, DataMode } from '../data/provider'
import type { TwinEvent } from '../data/schemas'
import type { SimState } from '../data/simProvider'

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

  setMode: mode => {
    try {
      localStorage.setItem(MODE_KEY, mode)
    } catch {
      // storage unavailable
    }
    set({ mode, selection: NO_SELECTION, highlightSku: null, events: [], sim: null, connection: 'connecting' })
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
    })),
  clearEvents: () => set({ events: [] }),
}))
