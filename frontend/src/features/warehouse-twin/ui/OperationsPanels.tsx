import { clsx } from 'clsx'
import {
  Activity,
  Bot,
  Boxes,
  CheckCircle2,
  Circle,
  Forklift,
  PackageCheck,
  ShieldCheck,
  Truck,
  Warehouse,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import type { DataMode } from '../data/provider'
import type { Disruption, Equipment, Shipment, TwinEventType } from '../data/schemas'
import type { LoggedEvent } from '../store/twinStore'
import { PanelEmpty, PanelError, PanelLoading, SimulatedTag } from './TwinChrome'
import { describeEvent, formatDate, formatDateTime, formatMoney, formatTime, titleCase } from './format'

interface QueryLike<T> {
  data: T | undefined
  isLoading: boolean
  isError: boolean
  error: unknown
  refetch: () => unknown
}

/** Props that make a list row act as a button that selects its 3D object. */
function selectable(selected: boolean, onSelect: (() => void) | undefined) {
  if (!onSelect) return {}
  return {
    role: 'button' as const,
    tabIndex: 0,
    'aria-pressed': selected,
    onClick: onSelect,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onSelect()
      }
    },
  }
}

const rowState = (selected: boolean, interactive: boolean) =>
  clsx(
    interactive && 'cursor-pointer transition-colors hover:bg-[#F8FAFF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1F4FD8]',
    selected && 'bg-[#EFF6FF] ring-1 ring-inset ring-[#1F4FD8]/40',
  )

function QueryBody<T>({ query, empty, children }: {
  query: QueryLike<T>
  empty: { title: string; detail?: string }
  children: (data: T) => React.ReactNode
}) {
  if (query.isLoading) return <PanelLoading />
  if (query.isError) return <PanelError error={query.error} onRetry={() => void query.refetch()} />
  const data = query.data
  if (data === undefined || (Array.isArray(data) && data.length === 0)) return <PanelEmpty {...empty} />
  return <>{children(data)}</>
}

// ── Event feed ───────────────────────────────────────────

const EVENT_ICON: Record<TwinEventType, LucideIcon> = {
  'inventory.updated': Boxes,
  'disruption.created': Zap,
  'recovery.updated': PackageCheck,
  'agent.step': Bot,
  'approval.changed': ShieldCheck,
  'shipment.status': Truck,
  'equipment.task': Forklift,
  'dock.status': Warehouse,
}

export function EventFeed({ events, mode, isSelected, onSelect }: {
  events: LoggedEvent[]
  mode: DataMode
  isSelected?: (e: LoggedEvent) => boolean
  /** Only events with a 3D target are selectable */
  onSelect?: (e: LoggedEvent) => (() => void) | undefined
}) {
  if (events.length === 0) {
    return (
      <PanelEmpty
        title="No events yet"
        detail={mode === 'simulation' ? 'Start the scenario to stream simulated events.' : 'Waiting for events on /ws/events.'}
      />
    )
  }
  return (
    <ol className="flex flex-col" aria-live="polite" aria-label="Event feed">
      {events.slice(0, 60).map(entry => {
        const { seq, event, mode: m } = entry
        const Icon = EVENT_ICON[event.type]
        return (
          <li
            key={seq}
            className={clsx('animate-nav-item flex items-start gap-3 border-b border-[#F1F5F9] px-4 py-2 last:border-0', rowState(!!isSelected?.(entry), !!onSelect?.(entry)))}
            {...selectable(!!isSelected?.(entry), onSelect?.(entry))}
          >
            <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-[#EFF6FF] text-[#1F4FD8]">
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-[#0F172A]">{describeEvent(event)}</p>
              <p className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-[#64748B]">
                <time dateTime={event.at}>{formatTime(event.at)}</time>
                <span>{event.type}</span>
                {m === 'simulation' && <SimulatedTag />}
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

// ── Shipments ────────────────────────────────────────────

const SHIPMENT_TONE: Record<Shipment['status'], string> = {
  scheduled: 'bg-[#F1F5F9] text-[#475569]',
  arriving: 'bg-[#CFFAFE] text-[#155E75]',
  at_dock: 'bg-[#DBEAFE] text-[#1E3A8A]',
  unloading: 'bg-[#DBEAFE] text-[#1E3A8A]',
  loading: 'bg-[#DBEAFE] text-[#1E3A8A]',
  departed: 'bg-[#DCFCE7] text-[#166534]',
}

export function ShipmentsList({ query, mode, selectedIds, onSelect }: {
  query: QueryLike<Shipment[]>
  mode: DataMode
  selectedIds?: ReadonlySet<string>
  onSelect?: (s: Shipment) => void
}) {
  return (
    <QueryBody query={query} empty={{ title: 'No shipments on record' }}>
      {shipments => (
        <ul className="flex flex-col gap-2.5">
          {[...shipments].reverse().map(s => (
            <li
              key={s.id}
              className={clsx('animate-fade-in rounded-lg border border-[#E2E8F0] p-3', rowState(!!selectedIds?.has(s.id), !!onSelect))}
              {...selectable(!!selectedIds?.has(s.id), onSelect && (() => onSelect(s)))}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <Truck className="h-4 w-4 text-[#64748B]" aria-hidden="true" />
                  <span className="font-mono text-xs font-semibold text-[#0F172A]">{s.id}</span>
                  {mode === 'simulation' && <SimulatedTag />}
                </span>
                <span className={clsx('rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors duration-300', SHIPMENT_TONE[s.status])}>
                  {titleCase(s.status)}
                </span>
              </div>
              <p className="mt-1 text-xs text-[#475569]">
                {s.supplier.name} · {titleCase(s.vehicleType)} · {s.dockId ?? 'No dock assigned'}
              </p>
              <p className="text-xs text-[#475569]">
                {s.sku ? <><span className="font-mono">{s.qty ?? '—'} × {s.sku}</span></> : 'No cargo line on record'}
                {s.eta && <> · ETA {formatDateTime(s.eta)}</>}
              </p>
              <ol className="mt-2 flex items-center gap-1" aria-label="Milestones">
                {s.milestones.map((m, i) => (
                  <li key={m.label} className="flex min-w-0 flex-1 items-center gap-1" title={m.at ? `${m.label}: ${formatDateTime(m.at)}` : `${m.label}: pending`}>
                    {m.at ? (
                      <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-[#16A34A]" aria-hidden="true" />
                    ) : (
                      <Circle className="h-3.5 w-3.5 flex-shrink-0 text-[#CBD5E1]" aria-hidden="true" />
                    )}
                    <span className={clsx('truncate-text text-[10px]', m.at ? 'text-[#166534]' : 'text-[#94A3B8]')}>{m.label}</span>
                    {i < s.milestones.length - 1 && <span className={clsx('h-px flex-1', m.at ? 'bg-[#86EFAC]' : 'bg-[#E2E8F0]')} aria-hidden="true" />}
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ul>
      )}
    </QueryBody>
  )
}

// ── Equipment ────────────────────────────────────────────

const EQUIPMENT_TONE: Record<Equipment['status'], string> = {
  idle: 'text-[#475569] bg-[#F1F5F9]',
  active: 'text-[#1E3A8A] bg-[#DBEAFE]',
  charging: 'text-[#166534] bg-[#DCFCE7]',
  maintenance: 'text-[#92400E] bg-[#FEF3C7]',
}

export function EquipmentList({ query, selectedId, onSelect }: {
  query: QueryLike<Equipment[]>
  selectedId?: string | null
  onSelect?: (e: Equipment) => void
}) {
  return (
    <QueryBody query={query} empty={{ title: 'No equipment registered' }}>
      {list => (
        <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {list.map(eq => (
            <li
              key={eq.id}
              className={clsx('flex items-start gap-2 rounded-lg border border-[#F1F5F9] px-2.5 py-2', rowState(selectedId === eq.id, !!onSelect))}
              {...selectable(selectedId === eq.id, onSelect && (() => onSelect(eq)))}
            >
              <span className="relative mt-0.5 flex h-2 w-2 flex-shrink-0" aria-hidden="true">
                {eq.status === 'active' && <span className="animate-status-ping absolute inset-0 rounded-full bg-[#1F4FD8]" />}
                <span className={clsx('relative h-2 w-2 rounded-full', eq.status === 'active' ? 'bg-[#1F4FD8]' : eq.status === 'charging' ? 'bg-[#16A34A]' : eq.status === 'maintenance' ? 'bg-[#D97706]' : 'bg-[#94A3B8]')} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center justify-between gap-2">
                  <span className="truncate-text text-xs font-medium text-[#0F172A]">{eq.label}</span>
                  <span className={clsx('rounded px-1.5 py-px text-[10px] font-semibold', EQUIPMENT_TONE[eq.status])}>
                    {eq.status === 'idle' ? 'Parked' : titleCase(eq.status)}
                  </span>
                </p>
                <p className="truncate-text text-[11px] text-[#64748B]">{eq.currentTask?.description ?? 'No task assigned'}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </QueryBody>
  )
}

// ── Disruption summary ───────────────────────────────────

const DISRUPTION_TONE: Record<Disruption['status'], string> = {
  open: 'bg-[#FEE2E2] text-[#991B1B]',
  analyzing: 'bg-[#F3E8FF] text-[#5B21B6]',
  awaiting_approval: 'bg-[#FEF3C7] text-[#92400E]',
  approved: 'bg-[#DBEAFE] text-[#1E3A8A]',
  rejected: 'bg-[#F1F5F9] text-[#475569]',
  resolved: 'bg-[#DCFCE7] text-[#166534]',
}

export function DisruptionSummary({ disruption, mode }: { disruption: Disruption; mode: DataMode }) {
  return (
    <div className="animate-fade-in flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold text-[#0F172A]">{disruption.id}</span>
        <span className={clsx('rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors duration-300', DISRUPTION_TONE[disruption.status])}>
          {titleCase(disruption.status)}
        </span>
        {mode === 'simulation' && <SimulatedTag />}
      </div>
      <p className="text-sm text-[#334155]">
        <span className="font-mono font-semibold text-[#7C3AED]">{disruption.sku}</span>
        {disruption.description && <> · {disruption.description}</>}
      </p>
      <p className="text-xs text-[#475569]">
        Failed supplier: <strong className="font-semibold text-[#0F172A]">{disruption.failedSupplier.name}</strong>
        {disruption.reason && <> · {disruption.reason}</>}
      </p>
      <dl className="grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-lg bg-[#F8FAFC] px-2.5 py-2">
          <dt className="text-[#64748B]">Deadline</dt>
          <dd className="font-semibold text-[#0F172A]">{formatDate(disruption.deadline)}</dd>
        </div>
        <div className="rounded-lg bg-[#F8FAFC] px-2.5 py-2">
          <dt className="text-[#64748B]">Budget</dt>
          <dd className="font-semibold text-[#0F172A]">
            {disruption.budget ? formatMoney(disruption.budget.amount, disruption.budget.currency) : 'Not set'}
          </dd>
        </div>
        <div className="rounded-lg bg-[#F8FAFC] px-2.5 py-2">
          <dt className="text-[#64748B]">Jobs affected</dt>
          <dd className="font-semibold text-[#0F172A]">{disruption.affectedJobs.length}</dd>
        </div>
      </dl>

      <table className="w-full text-xs">
        <caption className="sr-only">Shortage: required vs available vs gap</caption>
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide text-[#64748B]">
            <th className="py-1 font-semibold">SKU</th>
            <th className="py-1 text-right font-semibold">Required</th>
            <th className="py-1 text-right font-semibold">Available</th>
            <th className="py-1 text-right font-semibold">Gap</th>
          </tr>
        </thead>
        <tbody>
          {disruption.shortages.map(s => (
            <tr key={s.sku} className="border-t border-[#F1F5F9]">
              <td className="py-1.5 font-mono font-medium text-[#0F172A]">{s.sku}</td>
              <td className="py-1.5 text-right font-mono tabular-nums">{s.requiredQty}</td>
              <td className="py-1.5 text-right font-mono tabular-nums">{s.availableQty}</td>
              <td className={clsx('py-1.5 text-right font-mono font-semibold tabular-nums', s.gapQty > 0 ? 'text-[#B91C1C]' : 'text-[#166534]')}>
                {s.gapQty > 0 ? `−${s.gapQty}` : '0'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function NoDisruption({ mode }: { mode: DataMode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center">
      <Activity className="h-5 w-5 text-[#94A3B8]" aria-hidden="true" />
      <p className="text-sm font-medium text-[#334155]">No active disruption</p>
      <p className="max-w-[240px] text-xs text-[#64748B]">
        {mode === 'simulation' ? 'Press Start to run the motor-component shortage scenario.' : 'No disruptions reported by the backend.'}
      </p>
    </div>
  )
}
