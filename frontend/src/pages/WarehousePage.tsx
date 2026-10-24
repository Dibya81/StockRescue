import { useCallback, useMemo } from 'react'
import { FlaskConical, X } from 'lucide-react'
import {
  indexLotsByPosition,
  indexLotsByRack,
  parsePositionId,
  totalPositions,
} from '@/features/warehouse-twin/data/layoutGeometry'
import { countByStatus, rollupStatus } from '@/features/warehouse-twin/data/statusMapping'
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
} from '@/features/warehouse-twin/hooks/useTwinData'
import { useTwinStore } from '@/features/warehouse-twin/store/twinStore'
import { FloorPlan, type RackSummary } from '@/features/warehouse-twin/ui/FloorPlan'
import { RackElevation } from '@/features/warehouse-twin/ui/RackElevation'
import { InspectorHint, PositionInspector, RackSummaryInspector, SkuSearch } from '@/features/warehouse-twin/ui/Inspector'
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
  SimBanner,
  StatusLegend,
  type KpiItem,
} from '@/features/warehouse-twin/ui/TwinChrome'

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

  const lots = useMemo(() => inventory.data ?? [], [inventory.data])
  const { byPosition } = useMemo(() => indexLotsByPosition(lots), [lots])

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
  const onHighlight = useCallback((sku: string | null) => setHighlightSku(sku), [setHighlightSku])
  const planForApproval = recovery.data?.plan ?? null

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">Warehouse Digital Twin</h1>
          <p className="mt-0.5 text-xs text-[#475569]">
            {layout.data
              ? `${layout.data.name} · layout v${layout.data.version} · ${layout.data.racks.length} racks`
              : 'Spatial inventory, docks, equipment and recovery flow'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ModeSwitch mode={mode} onChange={setMode} />
          <ConnectionPill state={connection} mode={mode} />
          <RoleChip role={actor.role} />
        </div>
      </div>

      {mode === 'simulation' && <SimBanner scenarioTitle={sim.state?.scenarioTitle ?? null} />}

      {kpis && <KpiStrip items={kpis} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Main column */}
        <div className="flex min-w-0 flex-col gap-4">
          <Panel
            title="Floor plan"
            actions={<SkuSearch highlightSku={highlightSku} onHighlight={onHighlight} onSelectPosition={selectPosition} />}
            bodyClassName="p-3 sm:p-4"
          >
            {highlightSku && (
              <div className="animate-fade-in mb-3 flex items-center justify-between rounded-lg bg-[#EFF6FF] px-3 py-1.5 text-xs text-[#1E3A8A]">
                <span>
                  Showing locations holding <span className="font-mono font-semibold">{highlightSku}</span> ({highlightedRackIds?.size ?? 0} racks)
                </span>
                <button type="button" onClick={() => setHighlightSku(null)} className="rounded p-0.5 hover:bg-white" aria-label="Clear SKU highlight">
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            )}

            {layout.isLoading || inventory.isLoading ? (
              <PanelLoading label="Loading warehouse layout…" className="py-24" />
            ) : layout.isError || inventory.isError ? (
              <PanelError
                error={layout.error ?? inventory.error}
                onRetry={() => {
                  void layout.refetch()
                  void inventory.refetch()
                }}
                className="py-20"
                action={
                  mode === 'live' && (
                    <button type="button" onClick={() => setMode('simulation')} className="btn-primary px-3 py-1.5 text-xs">
                      <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" /> Switch to Simulation
                    </button>
                  )
                }
              />
            ) : layout.data ? (
              <FloorPlan
                layout={layout.data}
                rackSummaries={rackSummaries}
                shipments={shipments.data ?? []}
                equipment={equipment.data ?? []}
                selectedRackId={selection.rackId}
                highlightedRackIds={highlightedRackIds}
                onSelectRack={selectRack}
              />
            ) : null}

            {selectedRack && (
              <div className="mt-4 border-t border-[#F1F5F9] pt-4">
                <RackElevation
                  rack={selectedRack}
                  lotsByPosition={byPosition}
                  selectedLevel={selection.level}
                  selectedPositionId={selection.positionId}
                  highlightSku={highlightSku}
                  onSelectLevel={selectLevel}
                  onSelectPosition={selectPosition}
                  onClose={clearSelection}
                />
              </div>
            )}
          </Panel>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel title="Docks & shipments">
              <ShipmentsList query={shipments} mode={mode} />
            </Panel>
            <Panel title="Equipment">
              <EquipmentList query={equipment} />
            </Panel>
          </div>
        </div>

        {/* Right rail */}
        <aside className="flex min-w-0 flex-col gap-4" aria-label="Inspector and controls">
          {mode === 'simulation' && sim.state && (
            <Panel title="Scenario player">
              <SimControls state={sim.state} onStart={sim.start} onPause={sim.pause} onStep={sim.step} onReset={sim.reset} />
            </Panel>
          )}

          <Panel title="Inspector">
            {selection.positionId ? (
              <PositionInspector positionId={selection.positionId} lots={byPosition.get(selection.positionId)} mode={mode} />
            ) : selectedRack ? (
              <RackSummaryInspector rack={selectedRack} lotsByPosition={byPosition} />
            ) : (
              <InspectorHint />
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
              <ApprovalCard
                key={planForApproval.id}
                disruption={activeDisruption}
                plan={planForApproval}
                simulated={mode === 'simulation'}
              />
            </Panel>
          )}

          <Panel title="Legend">
            <StatusLegend counts={legendCounts} />
          </Panel>
        </aside>
      </div>

      <Panel title="Event feed" bodyClassName="max-h-80 overflow-y-auto">
        <EventFeed events={events} mode={mode} />
      </Panel>
    </div>
  )
}
