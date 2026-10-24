import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { LiveProvider } from '../data/liveProvider'
import { SimulationProvider } from '../data/simProvider'
import { ProviderError, type Actor, type DataMode, type TwinDataProvider } from '../data/provider'
import {
  applyToDisruptions,
  applyToEquipment,
  applyToInventory,
  applyToLayout,
  applyToRecovery,
  applyToShipments,
  emptyRecoveryBundle,
  recoveryEventDisruptionId,
} from '../data/reducers'
import { resolveTwinRole } from '../data/roles'
import type {
  DecisionInput,
  Disruption,
  Equipment,
  InventoryLot,
  RecoveryBundle,
  Shipment,
  TwinEvent,
  WarehouseLayout,
} from '../data/schemas'
import { DEFAULT_SCENARIO_ID, SCENARIOS } from '../scenarios'
import { useTwinStore } from '../store/twinStore'
import { getSceneParams } from '../world/sceneParams'

// ── Provider registry ────────────────────────────────────
// One provider per mode for the lifetime of the page, so the simulation
// keeps its state across re-renders and the WebSocket is shared.

const tokenRef: { current: () => Promise<string | null> } = { current: async () => null }
let liveProvider: LiveProvider | null = null
let simProvider: SimulationProvider | null = null

export function getProvider(mode: 'simulation'): SimulationProvider
export function getProvider(mode: DataMode): TwinDataProvider
export function getProvider(mode: DataMode): TwinDataProvider {
  if (mode === 'live') {
    liveProvider ??= new LiveProvider({
      baseUrl: import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') || 'http://localhost:8000',
      wsUrl: import.meta.env.VITE_TWIN_WS_URL || undefined,
      getToken: () => tokenRef.current(),
    })
    return liveProvider
  }
  simProvider ??= new SimulationProvider(() => {
    const entry = SCENARIOS.find(s => s.id === DEFAULT_SCENARIO_ID) ?? SCENARIOS[0]
    return entry.load()
  }, { background: !getSceneParams().freeze })
  return simProvider
}

export function useTwinProvider(): TwinDataProvider {
  const { getToken } = useAuth()
  useEffect(() => {
    tokenRef.current = getToken
  }, [getToken])
  const mode = useTwinStore(s => s.mode)
  return getProvider(mode)
}

export function useActor(): Actor {
  const { user } = useAuth()
  return useMemo(
    () => ({ id: user?.email ?? user?.id ?? 'unknown', role: resolveTwinRole(user?.app_metadata) }),
    [user],
  )
}

// ── Queries ──────────────────────────────────────────────

export const twinKeys = {
  all: (mode: DataMode) => ['twin', mode] as const,
  layout: (mode: DataMode) => ['twin', mode, 'layout'] as const,
  inventory: (mode: DataMode) => ['twin', mode, 'inventory'] as const,
  search: (mode: DataMode, sku: string) => ['twin', mode, 'search', sku] as const,
  disruptions: (mode: DataMode) => ['twin', mode, 'disruptions'] as const,
  recovery: (mode: DataMode, id: string) => ['twin', mode, 'recovery', id] as const,
  shipments: (mode: DataMode) => ['twin', mode, 'shipments'] as const,
  equipment: (mode: DataMode) => ['twin', mode, 'equipment'] as const,
  audit: (mode: DataMode) => ['twin', mode, 'audit'] as const,
}

// Endpoints the backend doesn't implement won't appear by retrying
const retry = (count: number, err: unknown) =>
  !(err instanceof ProviderError && ['unavailable', 'forbidden', 'unauthorized', 'invalid'].includes(err.kind)) && count < 2

const queryOptions = { retry, staleTime: 60_000 }

export function useLayout() {
  const provider = useTwinProvider()
  return useQuery<WarehouseLayout>({ queryKey: twinKeys.layout(provider.mode), queryFn: () => provider.getLayout(), ...queryOptions })
}

export function useInventory() {
  const provider = useTwinProvider()
  return useQuery<InventoryLot[]>({ queryKey: twinKeys.inventory(provider.mode), queryFn: () => provider.getInventory(), ...queryOptions })
}

export function useInventorySearch(sku: string) {
  const provider = useTwinProvider()
  const q = sku.trim()
  return useQuery<InventoryLot[]>({
    queryKey: twinKeys.search(provider.mode, q.toUpperCase()),
    queryFn: () => provider.searchInventory(q),
    enabled: q.length >= 2,
    ...queryOptions,
  })
}

export function useDisruptions() {
  const provider = useTwinProvider()
  return useQuery<Disruption[]>({ queryKey: twinKeys.disruptions(provider.mode), queryFn: () => provider.getDisruptions(), ...queryOptions })
}

export function useRecovery(disruptionId: string | null) {
  const provider = useTwinProvider()
  return useQuery<RecoveryBundle>({
    queryKey: twinKeys.recovery(provider.mode, disruptionId ?? ''),
    queryFn: () => provider.getRecovery(disruptionId ?? ''),
    enabled: !!disruptionId,
    ...queryOptions,
  })
}

export function useShipments() {
  const provider = useTwinProvider()
  return useQuery<Shipment[]>({ queryKey: twinKeys.shipments(provider.mode), queryFn: () => provider.getShipments(), ...queryOptions })
}

export function useEquipment() {
  const provider = useTwinProvider()
  return useQuery<Equipment[]>({ queryKey: twinKeys.equipment(provider.mode), queryFn: () => provider.getEquipment(), ...queryOptions })
}

export function useAudit() {
  const provider = useTwinProvider()
  return useQuery({ queryKey: twinKeys.audit(provider.mode), queryFn: () => provider.getAudit(), ...queryOptions })
}

/** Simulation only: the scenario's recorded end state, for the After view. */
export function useRecordedOutcome() {
  const mode = useTwinStore(s => s.mode)
  return useQuery<InventoryLot[]>({
    queryKey: ['twin', 'simulation', 'outcome'],
    queryFn: () => getProvider('simulation').getRecordedOutcome(),
    enabled: mode === 'simulation',
    staleTime: Infinity,
  })
}

// ── Event stream → cache ─────────────────────────────────

function patch<T>(qc: QueryClient, key: readonly unknown[], fn: (current: T) => T | null) {
  const current = qc.getQueryData<T>(key)
  if (current === undefined) return
  const next = fn(current)
  if (next) qc.setQueryData(key, next)
}

/** Applies one stream event to every cached collection it affects. */
export function applyEventToCache(qc: QueryClient, mode: DataMode, event: TwinEvent) {
  patch<InventoryLot[]>(qc, twinKeys.inventory(mode), c => applyToInventory(c, event))
  patch<Disruption[]>(qc, twinKeys.disruptions(mode), c => applyToDisruptions(c, event))
  patch<Shipment[]>(qc, twinKeys.shipments(mode), c => applyToShipments(c, event))
  patch<Equipment[]>(qc, twinKeys.equipment(mode), c => applyToEquipment(c, event))
  patch<WarehouseLayout>(qc, twinKeys.layout(mode), c => applyToLayout(c, event))

  const plans = qc
    .getQueriesData<RecoveryBundle>({ queryKey: ['twin', mode, 'recovery'] })
    .flatMap(([, b]) => (b?.plan ? [b.plan] : []))
  const disruptionId = recoveryEventDisruptionId(event, plans)
  if (disruptionId) {
    const key = twinKeys.recovery(mode, disruptionId)
    const bundle = qc.getQueryData<RecoveryBundle>(key) ?? emptyRecoveryBundle(disruptionId)
    const next = applyToRecovery(bundle, event)
    if (next) qc.setQueryData(key, next)
  }
  if (event.type === 'inventory.updated') {
    void qc.invalidateQueries({ queryKey: ['twin', mode, 'search'] })
  }
  void qc.invalidateQueries({ queryKey: twinKeys.audit(mode) })
}

/** Subscribes to the active provider's event stream for the page's lifetime. */
export function useTwinEventStream() {
  const provider = useTwinProvider()
  const qc = useQueryClient()
  const pushEvent = useTwinStore(s => s.pushEvent)
  const setConnection = useTwinStore(s => s.setConnection)

  useEffect(() => {
    const mode = provider.mode
    const offEvents = provider.subscribe(event => {
      applyEventToCache(qc, mode, event)
      pushEvent(event)
    })
    const offConn = provider.subscribeConnection(setConnection)
    let offReset = () => {}
    if (provider instanceof SimulationProvider) {
      offReset = provider.subscribeReset(() => {
        useTwinStore.getState().clearEvents()
        void qc.invalidateQueries({ queryKey: twinKeys.all(mode) })
      })
    }
    return () => {
      offEvents()
      offConn()
      offReset()
    }
  }, [provider, qc, pushEvent, setConnection])
}

// ── Simulation controls ──────────────────────────────────

export function useSimulation() {
  const mode = useTwinStore(s => s.mode)
  const sim = mode === 'simulation' ? getProvider('simulation') : null
  const subscribe = useCallback((onChange: () => void) => (sim ? sim.subscribeSim(onChange) : () => {}), [sim])
  const state = useSyncExternalStore(subscribe, () => sim?.getSimState() ?? null)

  return {
    state,
    start: useCallback(() => void sim?.start(), [sim]),
    pause: useCallback(() => sim?.pause(), [sim]),
    step: useCallback(() => void sim?.step(), [sim]),
    reset: useCallback(() => void sim?.reset(), [sim]),
    setBackground: useCallback((on: boolean) => sim?.setBackground(on), [sim]),
  }
}

// ── Mutations ────────────────────────────────────────────

export function useRecoveryDecision(disruptionId: string | null) {
  const provider = useTwinProvider()
  const actor = useActor()
  return useMutation<void, ProviderError | Error, { decision: 'approve' | 'reject'; input: DecisionInput }>({
    mutationFn: ({ decision, input }) => {
      if (!disruptionId) return Promise.reject(new Error('No disruption selected'))
      return decision === 'approve'
        ? provider.approveRecovery(disruptionId, input, actor)
        : provider.rejectRecovery(disruptionId, input, actor)
    },
  })
}
