import type { ReactNode } from 'react'
import { clsx } from 'clsx'
import { AlertTriangle, FlaskConical, Inbox, Loader2, Radio, RefreshCw, ShieldCheck, WifiOff } from 'lucide-react'
import type { ConnectionState, DataMode } from '../data/provider'
import { describeProviderError, ProviderError } from '../data/provider'
import { ROLE_LABELS, type TwinRole } from '../data/roles'
import { LEGEND_ORDER, STATUS_STYLES } from '../data/statusMapping'
import type { InventoryStatus } from '../data/schemas'
import { StatusIcon, StatusSwatch } from './StatusGlyph'

// ── Mode & connection ────────────────────────────────────

export function ModeSwitch({ mode, onChange }: { mode: DataMode; onChange: (m: DataMode) => void }) {
  const options: { value: DataMode; label: string; icon: typeof Radio }[] = [
    { value: 'live', label: 'Live', icon: Radio },
    { value: 'simulation', label: 'Simulation', icon: FlaskConical },
  ]
  return (
    <div role="radiogroup" aria-label="Data mode" className="relative inline-flex rounded-lg border border-[#E2E8F0] bg-[#F1F5F9] p-0.5">
      <span
        aria-hidden="true"
        className={clsx(
          'absolute inset-y-0.5 w-[calc(50%-2px)] rounded-md shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
          mode === 'live' ? 'translate-x-0 bg-white' : 'translate-x-full bg-[#7C2D12]',
        )}
      />
      {options.map(({ value, label, icon: Icon }) => {
        const active = mode === value
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(value)}
            className={clsx(
              'relative z-[1] flex w-[108px] items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition-colors duration-200',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F4FD8]',
              active ? (value === 'live' ? 'text-[#15803D]' : 'text-white') : 'text-[#64748B] hover:text-[#0F172A]',
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {label}
          </button>
        )
      })}
    </div>
  )
}

const CONNECTION_COPY: Record<ConnectionState, { label: string; tone: string; dot: string }> = {
  connecting:   { label: 'Connecting',          tone: 'border-[#E2E8F0] bg-[#F8FAFC] text-[#475569]', dot: 'bg-[#94A3B8] animate-pulse' },
  open:         { label: 'Event stream open',   tone: 'border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]', dot: 'bg-[#16A34A]' },
  reconnecting: { label: 'Reconnecting',        tone: 'border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]', dot: 'bg-[#D97706] animate-pulse' },
  closed:       { label: 'Stream closed',       tone: 'border-[#E2E8F0] bg-[#F8FAFC] text-[#475569]', dot: 'bg-[#94A3B8]' },
  unavailable:  { label: 'No event stream',     tone: 'border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]', dot: 'bg-[#DC2626]' },
}

export function ConnectionPill({ state, mode }: { state: ConnectionState; mode: DataMode }) {
  const c = CONNECTION_COPY[state]
  return (
    <span
      role="status"
      aria-live="polite"
      className={clsx('inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium', c.tone)}
      title={mode === 'simulation' ? 'Events come from the local scenario player' : 'Live /ws/events stream'}
    >
      <span className="relative flex h-2 w-2" aria-hidden="true">
        {state === 'open' && <span className="animate-status-ping absolute inset-0 rounded-full bg-[#16A34A]" />}
        <span className={clsx('relative h-2 w-2 rounded-full', c.dot)} />
      </span>
      {mode === 'simulation' && state === 'open' ? 'Scenario player ready' : c.label}
    </span>
  )
}

export function RoleChip({ role }: { role: TwinRole }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E2E8F0] bg-white px-2.5 py-1 text-xs font-medium text-[#334155]">
      <ShieldCheck className={clsx('h-3.5 w-3.5', role === 'approver' ? 'text-[#1F4FD8]' : 'text-[#94A3B8]')} aria-hidden="true" />
      {ROLE_LABELS[role]}
    </span>
  )
}

// ── Simulation labelling ─────────────────────────────────

export function SimulatedTag({ className }: { className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded border border-[#FDBA74] bg-[#FFF7ED] px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.08em] text-[#9A3412]',
        className,
      )}
    >
      <FlaskConical className="h-2.5 w-2.5" aria-hidden="true" />
      Simulated
    </span>
  )
}

export function SimBanner({ scenarioTitle }: { scenarioTitle: string | null }) {
  return (
    <div
      role="note"
      className="animate-fade-in flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-[#FDBA74] bg-[repeating-linear-gradient(135deg,#FFF7ED_0_12px,#FFEDD5_12px_24px)] px-4 py-2.5 text-sm text-[#7C2D12]"
    >
      <FlaskConical className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
      <strong className="font-semibold">Simulation mode: not real operational data.</strong>
      {scenarioTitle && <span className="text-[#9A3412]">Scenario: {scenarioTitle}</span>}
    </div>
  )
}

// ── Panel states ─────────────────────────────────────────

export function Panel({ title, actions, children, className, bodyClassName }: {
  title: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={clsx('flex min-w-0 flex-col rounded-xl border border-[#E2E8F0] bg-white', className)}>
      <header className="flex min-h-12 items-center justify-between gap-3 border-b border-[#F1F5F9] px-4 py-2.5">
        <h2 className="text-sm font-semibold text-[#0F172A]">{title}</h2>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </header>
      <div className={clsx('min-h-0 flex-1', bodyClassName ?? 'p-4')}>{children}</div>
    </section>
  )
}

export function PanelLoading({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div className={clsx('flex items-center justify-center gap-2 py-10 text-sm text-[#64748B]', className)} aria-live="polite">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      {label}
    </div>
  )
}

export function PanelEmpty({ title, detail, className }: { title: string; detail?: string; className?: string }) {
  return (
    <div className={clsx('flex flex-col items-center justify-center gap-1.5 py-8 text-center', className)}>
      <Inbox className="h-5 w-5 text-[#94A3B8]" aria-hidden="true" />
      <p className="text-sm font-medium text-[#334155]">{title}</p>
      {detail && <p className="max-w-xs text-xs text-[#64748B]">{detail}</p>}
    </div>
  )
}

export function PanelError({ error, onRetry, action, className }: {
  error: unknown
  onRetry?: () => void
  action?: ReactNode
  className?: string
}) {
  const { title, detail } = describeProviderError(error)
  const offline = error instanceof ProviderError && error.kind === 'network'
  const Icon = offline ? WifiOff : AlertTriangle
  return (
    <div role="alert" className={clsx('flex flex-col items-center justify-center gap-2 py-8 text-center', className)}>
      <Icon className={clsx('h-5 w-5', offline ? 'text-[#64748B]' : 'text-[#D97706]')} aria-hidden="true" />
      <p className="text-sm font-semibold text-[#0F172A]">{offline ? 'Offline' : title}</p>
      <p className="max-w-sm text-xs text-[#475569]">{detail}</p>
      <div className="mt-1 flex flex-wrap justify-center gap-2">
        {onRetry && (
          <button type="button" onClick={onRetry} className="btn-secondary px-3 py-1.5 text-xs">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Retry
          </button>
        )}
        {action}
      </div>
    </div>
  )
}

// ── Legend & KPIs ────────────────────────────────────────

export function StatusLegend({ counts }: { counts?: Record<InventoryStatus, number> }) {
  return (
    <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2" aria-label="Status legend">
      {LEGEND_ORDER.map(status => {
        const s = STATUS_STYLES[status]
        return (
          <li key={status} className="flex items-center gap-2 text-xs text-[#334155]" title={s.description}>
            <StatusSwatch status={status} />
            <StatusIcon status={status} className="h-3 w-3" />
            <span className="flex-1 truncate-text">{s.label}</span>
            {counts && <span className="font-mono tabular-nums text-[#64748B]">{counts[status]}</span>}
          </li>
        )
      })}
    </ul>
  )
}

export interface KpiItem {
  label: string
  value: number | string
  status?: InventoryStatus
  hint?: string
}

export function KpiStrip({ items, compact = false }: { items: KpiItem[]; compact?: boolean }) {
  return (
    <dl className={clsx('grid gap-2', compact ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-6')}>
      {items.map((k, i) => (
        <div
          key={k.label}
          className={clsx('animate-nav-item rounded-xl border border-[#E2E8F0] bg-white', compact ? 'px-2.5 py-2' : 'px-3.5 py-3')}
          style={{ animationDelay: `${i * 40}ms` }}
          title={k.hint}
        >
          <dt className={clsx('flex items-center gap-1.5 font-semibold uppercase tracking-wide text-[#64748B]', compact ? 'text-[9px]' : 'text-[11px]')}>
            {k.status && <StatusIcon status={k.status} className="h-3 w-3" />}
            <span className="truncate-text">{k.label}</span>
          </dt>
          <dd className={clsx('mt-1 font-mono font-semibold tabular-nums text-[#0F172A]', compact ? 'text-base' : 'text-xl')}>{k.value}</dd>
        </div>
      ))}
    </dl>
  )
}
