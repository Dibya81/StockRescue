import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { FlaskConical, Map as MapIcon, PanelRightClose, PanelRightOpen, X } from 'lucide-react'
import {
  indexLotsByPosition,
  indexLotsByRack,
  parsePositionId,
  totalPositions,
} from '@/features/warehouse-twin/data/layoutGeometry'
import { countByStatus, LEGEND_ORDER, rollupStatus, STATUS_STYLES } from '@/features/warehouse-twin/data/statusMapping'
import type { Equipment, Shipment } from '@/features/warehouse-twin/data/schemas'
import { layoutToWorld, type Vec3 } from '@/features/warehouse-twin/world/layoutToWorld'
import { frameDock, frameFloorPoint, frameLevel, framePoints, framePosition, frameRack } from '@/features/warehouse-twin/world/framing'
import { StatusIcon, StatusSwatch } from '@/features/warehouse-twin/ui/StatusGlyph'
import type { LoggedEvent } from '@/features/warehouse-twin/store/twinStore'
import {
  useActor,
  useDisruptions,
  useEquipment,
  useInventory,
  useLayout,
  useRecovery,
  useShipments,
  useSimulation,
  useTwinEventStream,
  useRecordedOutcome,
} from '@/features/warehouse-twin/hooks/useTwinData'
import { useTwinStore } from '@/features/warehouse-twin/store/twinStore'
import { buildSitePlan } from '@/features/warehouse-twin/world/sitePlan'
import { getSceneParams } from '@/features/warehouse-twin/world/sceneParams'
import { FloorPlan, type RackSummary } from '@/features/warehouse-twin/ui/FloorPlan'
import { RackElevation } from '@/features/warehouse-twin/ui/RackElevation'
import { EntityInspector, InspectorHint, PositionInspector, RackSummaryInspector, SkuSearch } from '@/features/warehouse-twin/ui/Inspector'
import {
  DisruptionSummary,
  EquipmentList,
  EventFeed,
  NoDisruption,
  ShipmentsList,
} from '@/features/warehouse-twin/ui/OperationsPanels'
import { ApprovalCard, SimControls } from '@/features/warehouse-twin/ui/SimControls'
import {
  ConnectionPill,
  KpiStrip,
  ModeSwitch,
  Panel,
  PanelError,
  PanelLoading,
  RoleChip,
  StatusLegend,
  type KpiItem,
} from '@/features/warehouse-twin/ui/TwinChrome'
import {
  CinematicHint,
  ContextLostOverlay,
  detectWebGL,
  glass,
  ModeBadge,
  PresetBar,
  SceneLoading,
  StaleBadge,
  StaleNotice,
  useStaleness,
  ViewControls,
  WebGLRequired,
  SceneOptions,
  Tracker,
  type TrackerStep,
} from '@/features/warehouse-twin/ui/SceneHud'
import { actionViews, planPhase, shownOption } from '@/features/warehouse-twin/world/planVisual'
import { useMediaQuery } from '@/hooks/useMediaQuery'

// The 3D chunk (three, fiber, drei, postprocessing) loads on demand
const WarehouseCanvas = lazy(() => import('@/features/warehouse-twin/scene/WarehouseCanvas'))

type BottomTab = 'events' | 'shipments' | 'equipment' | 'disruptions'

export function WarehousePage() {
  useTwinEventStream()

  const mode = useTwinStore(s => s.mode)
  const setMode = useTwinStore(s => s.setMode)
  const connection = useTwinStore(s => s.connection)
  const selection = useTwinStore(s => s.selection)
  const selectRack = useTwinStore(s => s.selectRack)
  const selectLevel = useTwinStore(s => s.selectLevel)
  const selectPosition = useTwinStore(s => s.selectPosition)
  const clearSelection = useTwinStore(s => s.clearSelection)
  const highlightSku = useTwinStore(s => s.highlightSku)
  const setHighlightSku = useTwinStore(s => s.setHighlightSku)
  const events = useTwinStore(s => s.events)
  const sceneReady = useTwinStore(s => s.sceneReady)
  const cinematic = useTwinStore(s => s.cinematic)
  const selectedEntity = useTwinStore(s => s.selectedEntity)
  const selectEntity = useTwinStore(s => s.selectEntity)
  const requestCamera = useTwinStore(s => s.requestCamera)

  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const [webgl] = useState(detectWebGL)
  const [contextLost, setContextLost] = useState(false)
  const [canvasKey, setCanvasKey] = useState(0)
  const [drawer, setDrawer] = useState<boolean | null>(null)
  const [minimap, setMinimap] = useState(false)
  const [tab, setTab] = useState<BottomTab | null>('events')
  const drawerOpen = drawer ?? isDesktop

  const actor = useActor()
  const sim = useSimulation()
  const layout = useLayout()
  const inventory = useInventory()
  const shipments = useShipments()
  const equipment = useEquipment()
  const disruptions = useDisruptions()

  const activeDisruption = useMemo(() => {
    const list = disruptions.data ?? []
    return list.length > 0 ? list[list.length - 1] : null
  }, [disruptions.data])
  const recovery = useRecovery(activeDisruption?.id ?? null)
  const outcome = useRecordedOutcome()
  const viewMode = useTwinStore(s => s.viewMode)
  const requestTour = useTwinStore(s => s.requestTour)

  const lots = useMemo(() => inventory.data ?? [], [inventory.data])
  const { byPosition } = useMemo(() => indexLotsByPosition(lots), [lots])
  const plan = useMemo(() => (layout.data ? buildSitePlan(layout.data, getSceneParams().seed) : null), [layout.data])

  const { stale, ageMs } = useStaleness(mode, Math.max(layout.dataUpdatedAt, inventory.dataUpdatedAt))

  const rackSummaries = useMemo(() => {
    const map = new Map<string, RackSummary>()
    if (!layout.data) return map
    const byRack = indexLotsByRack(lots)
    for (const rack of layout.data.racks) {
      const rackLots = byRack.get(rack.id) ?? []
      map.set(rack.id, {
        status: rollupStatus(rackLots.map(l => l.status)),
        occupied: new Set(rackLots.map(l => l.positionId)).size,
        total: rack.levels * rack.positionsPerLevel,
      })
    }
    return map
  }, [layout.data, lots])

  const highlightedRackIds = useMemo(() => {
    if (!highlightSku) return null
    const ids = new Set<string>()
    for (const l of lots) {
      if (l.sku !== highlightSku || !l.positionId) continue
      const parsed = parsePositionId(l.positionId)
      if (parsed) ids.add(parsed.rackId)
    }
    return ids
  }, [highlightSku, lots])

  const kpis = useMemo<KpiItem[] | null>(() => {
    if (!layout.data || !inventory.data) return null
    const counts = countByStatus(lots)
    const positions = totalPositions(layout.data)
    return [
      { label: 'Positions', value: positions.toLocaleString(), hint: 'Rack positions defined in the layout' },
      { label: 'Occupied', value: `${Math.round((byPosition.size / Math.max(1, positions)) * 100)}%`, status: 'in_stock', hint: `${byPosition.size} positions hold at least one lot` },
      { label: 'Low stock', value: counts.low_stock, status: 'low_stock', hint: 'Lots at or below reorder point' },
      { label: 'Shortage', value: counts.shortage + counts.disruption_affected, status: 'shortage', hint: 'Shortage + disruption-affected lots' },
      { label: 'Incoming', value: counts.incoming, status: 'incoming', hint: 'Positions reserved for inbound stock' },
      { label: 'Quarantine', value: counts.quarantine, status: 'quarantine', hint: 'Lots held for inspection' },
    ]
  }, [layout.data, inventory.data, lots, byPosition])

  const legendCounts = useMemo(() => {
    if (!layout.data) return undefined
    const counts = countByStatus(lots)
    counts.empty = Math.max(0, totalPositions(layout.data) - byPosition.size)
    return counts
  }, [layout.data, lots, byPosition])

  const selectedRack = layout.data?.racks.find(r => r.id === selection.rackId) ?? null
  // ── Selection from panels moves the 3D camera, same as clicking in 3D ──
  const focusPosition = useCallback((pid: string) => {
    selectPosition(pid)
    const pose = layout.data ? framePosition(layout.data, pid) : null
    if (pose) requestCamera(pose)
  }, [layout.data, selectPosition, requestCamera])

  const focusRack = useCallback((rackId: string) => {
    selectRack(rackId)
    const rack = layout.data?.racks.find(r => r.id === rackId)
    if (rack && layout.data) requestCamera(frameRack(layout.data, rack))
  }, [layout.data, selectRack, requestCamera])

  const focusLevel = useCallback((level: number | null) => {
    selectLevel(level)
    if (level != null && selectedRack && layout.data) requestCamera(frameLevel(layout.data, selectedRack, level))
  }, [layout.data, selectedRack, selectLevel, requestCamera])

  // SKU search highlights every location holding the SKU and frames them all
  const onHighlight = useCallback((sku: string | null) => {
    setHighlightSku(sku)
    if (!sku || !layout.data || !plan) return
    const points: Vec3[] = []
    for (const l of lots) {
      if (l.sku !== sku || !l.positionId) continue
      const t = layoutToWorld(layout.data, l.positionId)
      if (t) points.push(t.position)
    }
    const pose = framePoints(points, plan)
    if (pose) requestCamera(pose, pose.cutaway)
  }, [layout.data, plan, lots, setHighlightSku, requestCamera])

  const focusDock = useCallback((dockId: string) => {
    const dock = layout.data?.docks.find(d => d.id === dockId)
    const pose = dock && layout.data ? frameDock(layout.data, dock) : null
    if (pose) requestCamera(pose)
  }, [layout.data, requestCamera])

  const focusShipment = useCallback((s: Shipment) => {
    selectEntity({ kind: 'shipment', id: s.id })
    if (s.dockId) focusDock(s.dockId)
  }, [selectEntity, focusDock])

  const focusEquipment = useCallback((e: Equipment) => {
    selectEntity({ kind: 'equipment', id: e.id })
    if (plan) requestCamera(frameFloorPoint(e.home.x, e.home.z, plan))
  }, [selectEntity, plan, requestCamera])

  /** Events with a 3D target return a handler; others are not selectable */
  const eventTarget = useCallback((entry: LoggedEvent) => {
    const e = entry.event
    switch (e.type) {
      case 'inventory.updated': return e.lot.positionId ? () => focusPosition(e.lot.positionId as string) : undefined
      case 'shipment.status': return () => focusShipment(e.shipment)
      case 'equipment.task': return () => focusEquipment(e.equipment)
      case 'dock.status': return () => {
        selectEntity({ kind: 'dock', id: e.dockId })
        focusDock(e.dockId)
      }
      default: return undefined
    }
  }, [focusPosition, focusShipment, focusEquipment, focusDock, selectEntity])

  const isEventSelected = useCallback((entry: LoggedEvent) => {
    const e = entry.event
    if (e.type === 'inventory.updated') return !!selection.positionId && e.lot.positionId === selection.positionId
    if (!selectedEntity) return false
    if (e.type === 'shipment.status') return (selectedEntity.kind === 'shipment' && e.shipment.id === selectedEntity.id) || (selectedEntity.kind === 'dock' && e.shipment.dockId === selectedEntity.id)
    if (e.type === 'equipment.task') return selectedEntity.kind === 'equipment' && e.equipment.id === selectedEntity.id
    if (e.type === 'dock.status') return selectedEntity.kind === 'dock' && e.dockId === selectedEntity.id
    return false
  }, [selection.positionId, selectedEntity])

  const selectedShipmentIds = useMemo(() => {
    if (!selectedEntity) return new Set<string>()
    if (selectedEntity.kind === 'shipment') return new Set([selectedEntity.id])
    if (selectedEntity.kind === 'dock') return new Set((shipments.data ?? []).filter(x => x.dockId === selectedEntity.id).map(x => x.id))
    return new Set<string>()
  }, [selectedEntity, shipments.data])

  // Selecting an object in 3D brings its rows into view in the live table
  useEffect(() => useTwinStore.subscribe((s, prev) => {
    if (s.selectedEntity && s.selectedEntity !== prev.selectedEntity) {
      setTab(s.selectedEntity.kind === 'equipment' ? 'equipment' : 'shipments')
    } else if (s.selection.positionId && s.selection.positionId !== prev.selection.positionId) {
      setTab('events')
    }
  }), [])
  const planForApproval = recovery.data?.plan ?? null

  // ── Recovery plan state (Stage 4) ──
  const planViews = useMemo(() => {
    const b = recovery.data
    if (!b?.plan) return []
    return actionViews(b.plan, shownOption(b.plan, b.approvals), lots)
  }, [recovery.data, lots])
  const phase = recovery.data?.plan ? planPhase(recovery.data.plan, planViews) : null
  const completed = phase === 'completed'
  const afterAvailable = completed || (mode === 'simulation' && !!outcome.data && !!recovery.data?.plan)
  const afterLabel = completed ? 'After: plan completed (current inventory)' : 'After: recorded result of the simulation scenario'
  const displayLots = viewMode === 'after' && afterAvailable && !completed && outcome.data ? outcome.data : lots

  const showImpact = useCallback(() => {
    if (!layout.data) return
    const poses = planViews.flatMap(v => {
      const out = []
      if (v.action.fromPositionId) {
        const p = framePosition(layout.data!, v.action.fromPositionId)
        if (p) out.push(p)
      } else if (v.action.dockId) {
        const d = layout.data!.docks.find(x => x.id === v.action.dockId)
        const p = d ? frameDock(layout.data!, d) : null
        if (p) out.push(p)
      }
      const to = v.action.toPositionId ? framePosition(layout.data!, v.action.toPositionId) : null
      if (to) out.push(to)
      return out
    })
    if (poses.length) requestTour(poses)
  }, [layout.data, planViews, requestTour])

  const tracker = useMemo((): { title: string; subtitle?: string; steps: TrackerStep[]; footer?: React.ReactNode } | null => {
    if (selectedEntity?.kind === 'shipment') {
      const s = shipments.data?.find(x => x.id === selectedEntity.id)
      if (s) return { title: `Shipment ${s.id}`, subtitle: `${s.supplier.name} · ${s.status.replace('_', ' ')}`, steps: s.milestones.map(m => ({ label: m.label, done: !!m.at, at: m.at })) }
    }
    const planData = recovery.data?.plan
    if (!planData || !phase) return null
    const order = ['proposed', 'awaiting_approval', 'executing', 'completed'] as const
    const idx = phase === 'rejected' ? -1 : order.indexOf(phase)
    const option = shownOption(planData, recovery.data!.approvals)
    const impact = option?.impact
    return {
      title: `Recovery plan ${planData.id}`,
      subtitle: phase === 'rejected' ? 'Rejected' : `${planViews.filter(v => v.state === 'completed').length}/${planViews.length} actions landed`,
      steps: [
        { label: 'Proposed', done: idx >= 0 },
        { label: 'Awaiting approval', done: idx >= 1 },
        { label: 'Approved / executing', done: idx >= 2 },
        { label: 'Completed', done: idx >= 3 },
      ],
      footer: impact && (
        <>
          {impact.unitsMoved != null && <>Units moved <b>{impact.unitsMoved}</b> · </>}
          {impact.skusProtected != null && <>SKUs protected <b>{impact.skusProtected}</b> · </>}
          {impact.jobsProtected != null && <>Jobs protected <b>{impact.jobsProtected}</b> · </>}
          {impact.riskBefore != null && impact.riskAfter != null && <>Risk <b>{Math.round(impact.riskBefore * 100)}% → {Math.round(impact.riskAfter * 100)}%</b></>}
          {mode === 'simulation' && ' · simulated'}
        </>
      ),
    }
  }, [selectedEntity, shipments.data, recovery.data, phase, planViews, mode])

  const onContextLost = useCallback(() => setContextLost(true), [])
  const onContextRestored = useCallback(() => {
    setContextLost(false)
    setCanvasKey(k => k + 1)
  }, [])

  // ?freeze=1: deterministic frames, so UI motion is switched off as well
  useEffect(() => {
    if (!getSceneParams().freeze) return
    document.documentElement.classList.add('sr-freeze')
    return () => document.documentElement.classList.remove('sr-freeze')
  }, [])

  if (!webgl) return <WebGLRequired />

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#E9EEF3]">
      {/* ── 3D view ── */}
      {layout.data && (
        <Suspense fallback={<SceneLoading stage="engine" />}>
          <div className="absolute inset-0" aria-label="3D warehouse view" role="region">
            <WarehouseCanvas
              key={canvasKey}
              layout={layout.data}
              shipments={shipments.data ?? []}
              lots={displayLots}
              currentLots={lots}
              equipment={equipment.data ?? []}
              disruptions={disruptions.data ?? []}
              recovery={recovery.data ?? null}
              stale={stale}
              onContextLost={onContextLost}
              onContextRestored={onContextRestored}
            />
          </div>
          {!sceneReady && <SceneLoading stage="world" />}
        </Suspense>
      )}
      {layout.isLoading && <SceneLoading stage="data" />}
      {layout.isError && (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div className={clsx('w-full max-w-md rounded-2xl p-2', glass)}>
            <PanelError
              error={layout.error}
              onRetry={() => void layout.refetch()}
              action={mode === 'live' && (
                <button type="button" onClick={() => setMode('simulation')} className="btn-primary px-3 py-1.5 text-xs">
                  <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" /> Switch to Simulation
                </button>
              )}
            />
          </div>
        </div>
      )}
      {contextLost && <ContextLostOverlay />}
      {cinematic && <CinematicHint />}

      {/* ── Top HUD (bar + notices stack in one column so they never overlap) ── */}
      <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2">
          {plan && <PresetBar presets={plan.presets} />}
          <ViewControls />
          <SceneOptions afterAvailable={afterAvailable} afterLabel={afterLabel} canShowImpact={planViews.length > 0} onShowImpact={showImpact} />
        </div>
        <div className="pointer-events-auto flex flex-wrap items-center gap-2">
          <ModeBadge mode={mode} />
          {stale && ageMs != null && <StaleBadge ageMs={ageMs} />}
          <div className={clsx('hidden items-center rounded-xl p-1 sm:flex', glass)}>
            <ConnectionPill state={connection} mode={mode} />
          </div>
          <button
            type="button"
            onClick={() => setMinimap(m => !m)}
            aria-pressed={minimap}
            className={clsx('flex h-11 w-11 items-center justify-center rounded-xl lg:h-10 lg:w-10', glass, minimap && 'text-[#1F4FD8]')}
            title="Toggle 2D minimap"
            aria-label="Toggle 2D minimap"
          >
            <MapIcon className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setDrawer(!drawerOpen)}
            aria-expanded={drawerOpen}
            aria-controls="twin-drawer"
            className={clsx('flex h-11 w-11 items-center justify-center rounded-xl lg:h-10 lg:w-10', glass)}
            title={drawerOpen ? 'Hide panels' : 'Show panels'}
            aria-label={drawerOpen ? 'Hide panels' : 'Show panels'}
          >
            {drawerOpen ? <PanelRightClose className="h-4 w-4" aria-hidden="true" /> : <PanelRightOpen className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
        </div>

        {/* Notices under the bar, kept clear of the drawer */}
        <div className={clsx('flex flex-col gap-2', drawerOpen && isDesktop && 'mr-[384px]')}>
        {mode === 'simulation' && (
          <div role="note" className="pointer-events-auto inline-flex w-fit items-center gap-2 rounded-xl border border-[#FDBA74] bg-[#FFF7ED]/90 px-3 py-1.5 text-xs font-medium text-[#7C2D12] backdrop-blur">
            <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
            Simulation mode: not real operational data{sim.state?.scenarioTitle ? ` · ${sim.state.scenarioTitle}` : ''}
          </div>
        )}
        {stale && ageMs != null && <div className="pointer-events-auto w-fit"><StaleNotice ageMs={ageMs} /></div>}
        {viewMode === 'after' && afterAvailable && (
          <div role="note" className="pointer-events-auto w-fit rounded-xl border border-[#BBF7D0] bg-[#F0FDF4]/95 px-3 py-1.5 text-xs font-medium text-[#166534]">{afterLabel}</div>
        )}
        </div>
      </div>

      {/* ── Right drawer / mobile bottom sheet ── */}
      {drawerOpen && (
        <aside
          id="twin-drawer"
          aria-label="Inspector and controls"
          className={clsx(
            'animate-fade-in absolute z-20 flex flex-col gap-3 overflow-y-auto',
            isDesktop
              ? 'bottom-3 right-3 top-[64px] w-[372px] pr-0.5'
              : clsx('inset-x-0 bottom-0 max-h-[70vh] rounded-t-2xl p-3', glass),
          )}
        >
          {!isDesktop && (
            <div className="flex items-center justify-between">
              <span className="mx-auto h-1.5 w-10 rounded-full bg-[#CBD5E1]" aria-hidden="true" />
              <button type="button" onClick={() => setDrawer(false)} className="flex h-11 w-11 items-center justify-center rounded-lg" aria-label="Close panels">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          )}

          <div className={clsx('flex flex-wrap items-center gap-2 rounded-xl p-2', glass)} aria-label="Data source">
            <ModeSwitch mode={mode} onChange={setMode} />
            <RoleChip role={actor.role} />
            <span className="sm:hidden"><ConnectionPill state={connection} mode={mode} /></span>
          </div>

          {kpis && (
            <div className={clsx('rounded-xl p-2', glass)}>
              <KpiStrip items={kpis} compact />
            </div>
          )}

          <div className={clsx('rounded-xl p-2', glass)}>
            <SkuSearch highlightSku={highlightSku} onHighlight={onHighlight} onSelectPosition={focusPosition} />
          </div>

          {mode === 'simulation' && sim.state && (
            <Panel title="Scenario player">
              <SimControls state={sim.state} onStart={sim.start} onPause={sim.pause} onStep={sim.step} onReset={sim.reset} onToggleBackground={sim.setBackground} />
            </Panel>
          )}

          <Panel title="Inspector">
            {selectedEntity ? (
              <EntityInspector
                entity={selectedEntity}
                docks={layout.data?.docks ?? []}
                shipments={shipments.data ?? []}
                equipment={equipment.data ?? []}
                mode={mode}
              />
            ) : selection.positionId ? (
              <PositionInspector positionId={selection.positionId} lots={byPosition.get(selection.positionId)} mode={mode} />
            ) : selectedRack ? (
              <RackSummaryInspector rack={selectedRack} lotsByPosition={byPosition} />
            ) : (
              <InspectorHint />
            )}
            {selectedRack && (
              <div className="mt-4 border-t border-[#F1F5F9] pt-4">
                <RackElevation
                  rack={selectedRack}
                  lotsByPosition={byPosition}
                  selectedLevel={selection.level}
                  selectedPositionId={selection.positionId}
                  highlightSku={highlightSku}
                  onSelectLevel={focusLevel}
                  onSelectPosition={focusPosition}
                  onClose={clearSelection}
                />
              </div>
            )}
          </Panel>

          <Panel title="Disruption">
            {disruptions.isLoading ? (
              <PanelLoading />
            ) : disruptions.isError ? (
              <PanelError error={disruptions.error} onRetry={() => void disruptions.refetch()} />
            ) : activeDisruption ? (
              <DisruptionSummary disruption={activeDisruption} mode={mode} />
            ) : (
              <NoDisruption mode={mode} />
            )}
          </Panel>

          {activeDisruption && planForApproval && (
            <Panel title="Recovery recommendation">
              <ApprovalCard key={planForApproval.id} disruption={activeDisruption} plan={planForApproval} simulated={mode === 'simulation'} />
            </Panel>
          )}

          <Panel title="Legend">
            <StatusLegend counts={legendCounts} />
          </Panel>
        </aside>
      )}

      {/* ── Bottom-left: minimap and live table ── */}
      <div
        className={clsx(
          'pointer-events-none absolute bottom-3 left-3 z-10 flex flex-col gap-2',
          drawerOpen && isDesktop ? 'right-[396px]' : 'right-3',
        )}
      >
        {minimap && layout.data && (
          <div className={clsx('pointer-events-auto w-[min(380px,100%)] rounded-xl p-2', glass)}>
            <div className="mb-1 flex items-center justify-between px-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[#475569]">Minimap (2D)</span>
              <button type="button" onClick={() => setMinimap(false)} className="rounded p-1 text-[#64748B] hover:bg-white" aria-label="Close minimap">
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
            <FloorPlan
              layout={layout.data}
              rackSummaries={rackSummaries}
              shipments={shipments.data ?? []}
              equipment={equipment.data ?? []}
              selectedRackId={selection.rackId}
              highlightedRackIds={highlightedRackIds}
              onSelectRack={focusRack}
            />
          </div>
        )}

        {tracker && <Tracker {...tracker} />}

        <ul className={clsx('pointer-events-auto flex w-full max-w-[640px] flex-wrap gap-x-3 gap-y-1 rounded-xl px-3 py-2', glass)} aria-label="Status legend">
          {LEGEND_ORDER.map(st => (
            <li key={st} className="flex items-center gap-1 text-[11px] font-medium text-[#334155]" title={STATUS_STYLES[st].description}>
              <StatusSwatch status={st} size={12} />
              <StatusIcon status={st} className="h-3 w-3" />
              {STATUS_STYLES[st].label}
            </li>
          ))}
        </ul>

        <section className={clsx('pointer-events-auto w-full max-w-[640px] overflow-hidden rounded-xl', glass)} aria-label="Live table">
          <div role="tablist" className="flex items-center gap-1 border-b border-[#E2E8F0]/80 p-1">
            {(['events', 'shipments', 'equipment', 'disruptions'] as const).map(t => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(tab === t ? null : t)}
                className={clsx(
                  'h-11 rounded-lg px-3 text-xs font-semibold capitalize transition-colors lg:h-8',
                  tab === t ? 'bg-[#1F4FD8] text-white' : 'text-[#334155] hover:bg-white',
                )}
              >
                {t}
                {t === 'events' && events.length > 0 && (
                  <span className={clsx('ml-1.5 rounded-full px-1.5 text-[10px]', tab === t ? 'bg-white/25' : 'bg-[#E2E8F0]')}>{events.length}</span>
                )}
              </button>
            ))}
          </div>
          {tab && (
            <div role="tabpanel" className="max-h-56 overflow-y-auto bg-white/60">
              {tab === 'events' && <EventFeed events={events} mode={mode} isSelected={isEventSelected} onSelect={eventTarget} />}
              {tab === 'shipments' && <div className="p-3"><ShipmentsList query={shipments} mode={mode} selectedIds={selectedShipmentIds} onSelect={focusShipment} /></div>}
              {tab === 'disruptions' && (
                <div className="p-3">
                  {(disruptions.data ?? []).length === 0
                    ? <NoDisruption mode={mode} />
                    : (disruptions.data ?? []).map(d => <DisruptionSummary key={d.id} disruption={d} mode={mode} />)}
                </div>
              )}
              {tab === 'equipment' && <div className="p-3"><EquipmentList query={equipment} selectedId={selectedEntity?.kind === 'equipment' ? selectedEntity.id : null} onSelect={focusEquipment} /></div>}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
