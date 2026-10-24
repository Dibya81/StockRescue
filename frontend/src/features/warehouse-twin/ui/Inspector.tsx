import { useMemo, useState } from 'react'
import { MapPin, MousePointerClick, Search, X } from 'lucide-react'
import { clsx } from 'clsx'
import { parsePositionId, rackPositionIds } from '../data/layoutGeometry'
import { countByStatus, LEGEND_ORDER, positionStatus, STATUS_STYLES } from '../data/statusMapping'
import type { DataMode } from '../data/provider'
import type { Dock, Equipment, InventoryLot, Rack, Shipment } from '../data/schemas'
import type { SelectedEntity } from '../store/twinStore'
import { isDockOpen } from '../world/sitePlan'
import { useInventorySearch } from '../hooks/useTwinData'
import { StatusChip, StatusIcon } from './StatusGlyph'
import { PanelEmpty, PanelError, PanelLoading, SimulatedTag } from './TwinChrome'
import { formatDateTime, relativeTime } from './format'

function SourceTag({ lot }: { lot: InventoryLot }) {
  return lot.source === 'simulated' ? (
    <SimulatedTag />
  ) : (
    <span className="rounded border border-[#BBF7D0] bg-[#F0FDF4] px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.08em] text-[#166534]">
      Live
    </span>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">{label}</dt>
      <dd className="mt-0.5 truncate-text text-sm text-[#0F172A]">{children}</dd>
    </div>
  )
}

export function PositionInspector({ positionId, lots, mode }: { positionId: string; lots: InventoryLot[] | undefined; mode: DataMode }) {
  const parsed = parsePositionId(positionId)
  const status = positionStatus(lots)
  return (
    <div className="animate-fade-in flex flex-col gap-3" aria-live="polite">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#64748B]">Position</p>
          <p className="font-mono text-base font-semibold text-[#0F172A]">{positionId}</p>
          {parsed && (
            <p className="text-xs text-[#64748B]">
              Aisle {parsed.aisleId} · Rack {parsed.rackId.split('-')[1]} · Level {parsed.level} · Slot {parsed.position}
            </p>
          )}
        </div>
        <StatusChip status={status} />
      </div>

      {!lots || lots.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#CBD5E1] bg-[#F8FAFC] px-3 py-4 text-center text-sm text-[#475569]">
          No inventory recorded at this position.
          <p className="mt-1 text-xs text-[#64748B]">Source: {mode === 'simulation' ? 'simulation scenario' : 'GET /api/inventory'}</p>
        </div>
      ) : (
        lots.map(lot => (
          <article key={lot.lotId} className="rounded-lg border border-[#E2E8F0] p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="font-mono text-sm font-semibold text-[#1F4FD8]">{lot.sku}</span>
              <SourceTag lot={lot} />
            </div>
            <p className="mb-3 text-xs text-[#475569]">{lot.description ?? 'No description on record'}</p>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5">
              <Field label="Quantity">
                <span className="font-mono font-semibold tabular-nums">{lot.qty}</span> {lot.unit}
              </Field>
              <Field label="Lot">
                <span className="font-mono">{lot.lotId}</span>
              </Field>
              <Field label="Status">
                <span className="inline-flex items-center gap-1">
                  <StatusIcon status={lot.status} className="h-3 w-3" />
                  {STATUS_STYLES[lot.status].label}
                </span>
              </Field>
              <Field label="Reorder point">
                {lot.reorderPoint == null ? 'Not set' : `${lot.reorderPoint} ${lot.unit}`}
              </Field>
              <Field label="Last updated">
                <time dateTime={lot.lastUpdated} title={lot.lastUpdated}>
                  {formatDateTime(lot.lastUpdated)}
                </time>
                <span className="ml-1 text-xs text-[#64748B]">({relativeTime(lot.lastUpdated)})</span>
              </Field>
              <Field label="Data source">{lot.source === 'simulated' ? 'Simulation scenario' : 'Live backend'}</Field>
            </dl>
          </article>
        ))
      )}
    </div>
  )
}

export function RackSummaryInspector({ rack, lotsByPosition }: { rack: Rack; lotsByPosition: Map<string, InventoryLot[]> }) {
  const ids = rackPositionIds(rack)
  const lots = ids.flatMap(id => lotsByPosition.get(id) ?? [])
  const counts = countByStatus(lots)
  counts.empty = ids.filter(id => positionStatus(lotsByPosition.get(id)) === 'empty').length
  const skus = new Set(lots.map(l => l.sku))
  return (
    <div className="animate-fade-in flex flex-col gap-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#64748B]">Rack</p>
        <p className="font-mono text-base font-semibold text-[#0F172A]">{rack.id}</p>
        <p className="text-xs text-[#64748B]">
          {ids.length - counts.empty}/{ids.length} positions occupied · {skus.size} SKUs · {rack.side} side of {rack.aisleId}
        </p>
      </div>
      <ul className="flex flex-col gap-1">
        {LEGEND_ORDER.filter(s => counts[s] > 0).map(s => (
          <li key={s} className="flex items-center justify-between rounded-md px-2 py-1 text-xs" style={{ background: STATUS_STYLES[s].bg, color: STATUS_STYLES[s].text }}>
            <span className="flex items-center gap-1.5">
              <StatusIcon status={s} className="h-3 w-3" />
              {STATUS_STYLES[s].label}
            </span>
            <span className="font-mono font-semibold tabular-nums">{counts[s]}</span>
          </li>
        ))}
      </ul>
      <p className="flex items-center gap-1.5 text-xs text-[#64748B]">
        <MousePointerClick className="h-3.5 w-3.5" aria-hidden="true" /> Pick a level or position in the elevation to inspect it.
      </p>
    </div>
  )
}

export function InspectorHint() {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <MapPin className="h-5 w-5 text-[#94A3B8]" aria-hidden="true" />
      <p className="text-sm font-medium text-[#334155]">Nothing selected</p>
      <p className="max-w-[240px] text-xs text-[#64748B]">
        Click a rack in the 3D view, then a level tab or a pallet position, to inspect what is stored there. Docks and live-table rows are selectable too.
      </p>
    </div>
  )
}

// ── Docks, shipments, equipment ──────────────────────────

const titleCaseWords = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

export function EntityInspector({ entity, docks, shipments, equipment, mode }: {
  entity: SelectedEntity
  docks: Dock[]
  shipments: Shipment[]
  equipment: Equipment[]
  mode: DataMode
}) {
  if (entity.kind === 'dock') {
    const dock = docks.find(d => d.id === entity.id)
    if (!dock) return <PanelEmpty title="Dock not in layout" detail={entity.id} />
    const atDock = shipments.filter(s => s.dockId === dock.id)
    const open = isDockOpen(dock, shipments)
    return (
      <div className="animate-fade-in flex flex-col gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#64748B]">Dock</p>
          <p className="text-base font-semibold text-[#0F172A]">{dock.label}</p>
          <p className="text-xs text-[#64748B]">{titleCaseWords(dock.purpose)} · {titleCaseWords(dock.side)} wall</p>
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5">
          <Field label="Dock status">{titleCaseWords(dock.status)}</Field>
          <Field label="Door">{open ? 'Open (truck at dock)' : 'Closed'}</Field>
        </dl>
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">Shipments assigned</p>
          {atDock.length === 0 ? (
            <p className="text-xs text-[#64748B]">No shipment record assigns this dock.</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {atDock.map(s => (
                <li key={s.id} className="flex items-center justify-between rounded-md bg-[#F8FAFC] px-2 py-1">
                  <span className="font-mono">{s.id}</span>
                  <span>{titleCaseWords(s.status)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {mode === 'simulation' && <SimulatedTag className="w-fit" />}
      </div>
    )
  }
  if (entity.kind === 'shipment') {
    const s = shipments.find(x => x.id === entity.id)
    if (!s) return <PanelEmpty title="Shipment not found" detail={entity.id} />
    return (
      <div className="animate-fade-in flex flex-col gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#64748B]">Shipment</p>
          <p className="font-mono text-base font-semibold text-[#0F172A]">{s.id}</p>
          <p className="text-xs text-[#64748B]">{s.supplier.name}</p>
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5">
          <Field label="Status">{titleCaseWords(s.status)}</Field>
          <Field label="Vehicle">{titleCaseWords(s.vehicleType)}</Field>
          <Field label="Dock">{s.dockId ?? 'No dock assigned'}</Field>
          <Field label="ETA">{s.eta ? formatDateTime(s.eta) : 'Not provided'}</Field>
          <Field label="Cargo">{s.sku ? `${s.qty ?? '—'} × ${s.sku}` : 'No cargo line on record'}</Field>
        </dl>
        <ol className="space-y-1 text-xs">
          {s.milestones.map(m => (
            <li key={m.label} className="flex justify-between">
              <span className={m.at ? 'text-[#166534]' : 'text-[#94A3B8]'}>{m.label}</span>
              <span className="text-[#64748B]">{m.at ? formatDateTime(m.at) : 'Pending'}</span>
            </li>
          ))}
        </ol>
        {mode === 'simulation' && <SimulatedTag className="w-fit" />}
      </div>
    )
  }
  const e = equipment.find(x => x.id === entity.id)
  if (!e) return <PanelEmpty title="Equipment not found" detail={entity.id} />
  return (
    <div className="animate-fade-in flex flex-col gap-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#64748B]">Equipment</p>
        <p className="text-base font-semibold text-[#0F172A]">{e.label}</p>
        <p className="font-mono text-xs text-[#64748B]">{e.id} · {titleCaseWords(e.type)}</p>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5">
        <Field label="Status">{e.status === 'idle' ? 'Parked' : titleCaseWords(e.status)}</Field>
        <Field label="Task">{e.currentTask ? titleCaseWords(e.currentTask.kind) : 'None'}</Field>
      </dl>
      <p className="text-xs text-[#475569]">{e.currentTask?.description ?? 'No task assigned.'}</p>
      {mode === 'simulation' && <SimulatedTag className="w-fit" />}
    </div>
  )
}

// ── SKU search ───────────────────────────────────────────

interface SkuSearchProps {
  highlightSku: string | null
  onHighlight: (sku: string | null) => void
  onSelectPosition: (positionId: string) => void
}

export function SkuSearch({ highlightSku, onHighlight, onSelectPosition }: SkuSearchProps) {
  const [query, setQuery] = useState('')
  const search = useInventorySearch(query)

  const grouped = useMemo(() => {
    const map = new Map<string, InventoryLot[]>()
    for (const lot of search.data ?? []) {
      const list = map.get(lot.sku)
      if (list) list.push(lot)
      else map.set(lot.sku, [lot])
    }
    return [...map.entries()].slice(0, 8)
  }, [search.data])

  const open = query.trim().length >= 2

  return (
    <div className="relative w-full sm:w-72">
      <label htmlFor="twin-sku-search" className="sr-only">Search SKU</label>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]" aria-hidden="true" />
      <input
        id="twin-sku-search"
        type="search"
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') setQuery('')
        }}
        placeholder="Search SKU, e.g. MTR-7.5"
        autoComplete="off"
        className="input-field pl-9 pr-8"
        aria-expanded={open}
        aria-controls="twin-sku-results"
      />
      {highlightSku && (
        <button
          type="button"
          onClick={() => onHighlight(null)}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[#64748B] hover:bg-[#F1F5F9]"
          aria-label={`Clear highlight for ${highlightSku}`}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}

      {open && (
        <div
          id="twin-sku-results"
          className="animate-pop-in absolute left-0 right-0 top-[calc(100%+6px)] z-20 max-h-80 overflow-y-auto rounded-xl border border-[#E2E8F0] bg-white p-1.5 shadow-[0_16px_40px_-8px_rgba(15,23,42,0.18)]"
        >
          {search.isLoading ? (
            <PanelLoading label="Searching…" className="py-4" />
          ) : search.isError ? (
            <PanelError error={search.error} className="py-4" />
          ) : grouped.length === 0 ? (
            <PanelEmpty title="No matching SKU" detail={`No inventory record matches “${query.trim()}”.`} className="py-4" />
          ) : (
            grouped.map(([sku, lots]) => (
              <div key={sku} className="rounded-lg p-1.5">
                <button
                  type="button"
                  onClick={() => {
                    onHighlight(sku)
                    setQuery('')
                  }}
                  className={clsx(
                    'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[#EFF6FF]',
                    highlightSku === sku && 'bg-[#EFF6FF]',
                  )}
                >
                  <span className="font-mono text-xs font-semibold text-[#1F4FD8]">{sku}</span>
                  <span className="text-[11px] text-[#64748B]">
                    {lots.length} location{lots.length === 1 ? '' : 's'} · {lots.reduce((n, l) => n + l.qty, 0)} {lots[0].unit}
                  </span>
                </button>
                <ul className="mt-0.5 flex flex-wrap gap-1 px-2">
                  {lots.slice(0, 6).map(l => (
                    <li key={l.lotId}>
                      <button
                        type="button"
                        disabled={!l.positionId}
                        onClick={() => {
                          if (!l.positionId) return
                          onHighlight(sku)
                          onSelectPosition(l.positionId)
                          setQuery('')
                        }}
                        className="rounded border border-[#E2E8F0] px-1.5 py-0.5 font-mono text-[10px] text-[#334155] hover:border-[#1F4FD8] hover:text-[#1F4FD8] disabled:opacity-60"
                      >
                        {l.positionId ?? 'No location assigned'}
                      </button>
                    </li>
                  ))}
                  {lots.length > 6 && <li className="text-[10px] text-[#64748B]">+{lots.length - 6} more</li>}
                </ul>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
