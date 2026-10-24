import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import {
  AlertTriangle,
  Box,
  CheckCircle2,
  Clock,
  DoorOpen,
  FlaskConical,
  Gauge,
  Layers,
  Loader2,
  MonitorX,
  Radio,
} from 'lucide-react'
import type { DataMode } from '../data/provider'
import { effectiveTier, useTwinStore, type QualitySetting } from '../store/twinStore'
import type { CameraPreset } from '../world/sitePlan'

export const glass = 'border border-white/70 bg-white/80 shadow-[0_8px_24px_-8px_rgba(15,23,42,0.25)] backdrop-blur-md'

// ── WebGL availability ───────────────────────────────────

export function detectWebGL(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'))
  } catch {
    return false
  }
}

export function WebGLRequired() {
  return (
    <div className="flex h-full items-center justify-center bg-[#F1F5F9] p-6">
      <div role="alert" className="max-w-lg rounded-2xl border border-[#E2E8F0] bg-white p-8 shadow-sm">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[#FEF2F2] text-[#B91C1C]">
          <MonitorX className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="text-lg font-bold text-[#0F172A]">WebGL is required for the 3D warehouse</h1>
        <p className="mt-2 text-sm text-[#475569]">
          This browser could not create a WebGL context, so the 3D view cannot start. There is no 2D substitute for this view.
        </p>
        <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm text-[#334155]">
          <li>Turn on hardware acceleration (Chrome: Settings → System → “Use graphics acceleration when available”), then restart the browser.</li>
          <li>Open <code className="rounded bg-[#F1F5F9] px-1">chrome://gpu</code> (or <code className="rounded bg-[#F1F5F9] px-1">about:support</code> in Firefox) and check that WebGL is “Hardware accelerated”.</li>
          <li>Update your graphics driver and operating system.</li>
          <li>Disable extensions that block canvas or WebGL fingerprinting, or try a private window.</li>
          <li>Try a current version of Chrome, Edge, Firefox or Safari.</li>
        </ol>
      </div>
    </div>
  )
}

// ── Loading & recovery overlays ──────────────────────────

export function SceneLoading({ stage }: { stage: 'engine' | 'data' | 'world' }) {
  const steps: { id: typeof stage; label: string }[] = [
    { id: 'engine', label: 'Loading 3D engine' },
    { id: 'data', label: 'Loading warehouse layout' },
    { id: 'world', label: 'Building the warehouse from the layout' },
  ]
  const current = steps.findIndex(s => s.id === stage)
  return (
    <div className="animate-fade-in absolute inset-0 z-30 flex items-center justify-center bg-[#EEF2F6]" aria-live="polite">
      <div className="w-72 rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-[#0F172A]">
          <Box className="h-4 w-4 text-[#1F4FD8]" aria-hidden="true" /> Preparing 3D warehouse
        </div>
        <ol className="space-y-2.5">
          {steps.map((s, i) => (
            <li key={s.id} className={clsx('flex items-center gap-2 text-xs', i <= current ? 'text-[#0F172A]' : 'text-[#94A3B8]')}>
              {i < current ? (
                <CheckCircle2 className="h-4 w-4 text-[#16A34A]" aria-hidden="true" />
              ) : i === current ? (
                <Loader2 className="h-4 w-4 animate-spin text-[#1F4FD8]" aria-hidden="true" />
              ) : (
                <span className="h-4 w-4 rounded-full border border-[#CBD5E1]" aria-hidden="true" />
              )}
              {s.label}
            </li>
          ))}
        </ol>
        <div className="mt-4 h-1 overflow-hidden rounded-full bg-[#F1F5F9]">
          <div className="h-full rounded-full bg-[#1F4FD8] transition-[width] duration-500" style={{ width: `${((current + 0.5) / steps.length) * 100}%` }} />
        </div>
      </div>
    </div>
  )
}

export function ContextLostOverlay() {
  return (
    <div role="alert" className="absolute inset-0 z-30 flex items-center justify-center bg-[#0F172A]/40 backdrop-blur-sm">
      <div className={clsx('flex items-center gap-3 rounded-xl px-4 py-3 text-sm text-[#0F172A]', glass)}>
        <Loader2 className="h-4 w-4 animate-spin text-[#1F4FD8]" aria-hidden="true" />
        Graphics context was lost. Restoring the 3D view…
      </div>
    </div>
  )
}

export function CinematicHint() {
  return (
    <div className="animate-fade-in pointer-events-none absolute bottom-24 left-1/2 z-20 -translate-x-1/2 rounded-full bg-[#0F172A]/75 px-4 py-2 text-xs font-medium text-white backdrop-blur">
      Entering the building · click anywhere or press Esc to skip
    </div>
  )
}

// ── Mode & staleness ─────────────────────────────────────

export function ModeBadge({ mode }: { mode: DataMode }) {
  return mode === 'live' ? (
    <span className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#15803D] px-2.5 text-[11px] font-bold uppercase tracking-wider text-white">
      <Radio className="h-3.5 w-3.5" aria-hidden="true" /> Live
    </span>
  ) : (
    <span className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#9A3412] px-2.5 text-[11px] font-bold uppercase tracking-wider text-white">
      <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" /> Simulation
    </span>
  )
}

const STALE_MS = Number(import.meta.env.VITE_TWIN_STALE_MS) > 0 ? Number(import.meta.env.VITE_TWIN_STALE_MS) : 60_000

function formatAge(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`
}

/**
 * LIVE data counts as stale when neither a fetch nor a stream event has
 * refreshed it within the threshold. Simulation data is never stale.
 */
export function useStaleness(mode: DataMode, lastFetchAt: number): { stale: boolean; ageMs: number | null } {
  const lastEventAt = useTwinStore(s => s.lastEventAt)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (mode !== 'live') return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [mode])
  const fresh = Math.max(lastFetchAt || 0, lastEventAt ?? 0)
  if (mode !== 'live' || fresh === 0) return { stale: false, ageMs: null }
  const ageMs = Math.max(0, now - fresh)
  return { stale: ageMs > STALE_MS, ageMs }
}

export function StaleBadge({ ageMs }: { ageMs: number }) {
  return (
    <span role="status" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#78350F] px-2.5 text-[11px] font-bold uppercase tracking-wider text-white">
      <Clock className="h-3.5 w-3.5" aria-hidden="true" /> Stale · {formatAge(ageMs)}
    </span>
  )
}

// ── Top HUD ──────────────────────────────────────────────

const QUALITY_OPTIONS: { value: QualitySetting; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
]

export function PresetBar({ presets }: { presets: CameraPreset[] }) {
  const preset = useTwinStore(s => s.preset)
  const setPreset = useTwinStore(s => s.setPreset)
  const requestEntry = useTwinStore(s => s.requestEntry)
  const cinematic = useTwinStore(s => s.cinematic)
  return (
    <div className={clsx('flex items-center gap-1 overflow-x-auto rounded-xl p-1', glass)} role="toolbar" aria-label="Camera views">
      {presets.map(p => (
        <button
          key={p.id}
          type="button"
          onClick={() => setPreset(p.id)}
          aria-pressed={preset === p.id}
          title={`${p.label} (${p.hotkey})`}
          className={clsx(
            'flex h-11 flex-shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-colors lg:h-8',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F4FD8]',
            preset === p.id ? 'bg-[#1F4FD8] text-white' : 'text-[#334155] hover:bg-white',
          )}
        >
          <kbd className={clsx('rounded px-1 font-mono text-[10px]', preset === p.id ? 'bg-white/20' : 'bg-[#E2E8F0] text-[#475569]')}>{p.hotkey}</kbd>
          <span className="whitespace-nowrap">{p.label}</span>
        </button>
      ))}
      <span className="mx-1 h-5 w-px flex-shrink-0 bg-[#CBD5E1]" aria-hidden="true" />
      <button
        type="button"
        onClick={requestEntry}
        disabled={cinematic}
        className="flex h-11 flex-shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-[#1F4FD8] transition-colors hover:bg-white disabled:opacity-50 lg:h-8"
      >
        <DoorOpen className="h-3.5 w-3.5" aria-hidden="true" /> Enter building
      </button>
    </div>
  )
}

export function ViewControls() {
  const cutaway = useTwinStore(s => s.cutaway)
  const setCutaway = useTwinStore(s => s.setCutaway)
  const quality = useTwinStore(s => s.quality)
  const setQuality = useTwinStore(s => s.setQuality)
  const tier = useTwinStore(effectiveTier)
  return (
    <div className={clsx('flex items-center gap-1 rounded-xl p-1', glass)}>
      <button
        type="button"
        onClick={() => setCutaway(!cutaway)}
        aria-pressed={cutaway}
        className={clsx(
          'flex h-11 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-colors lg:h-8',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F4FD8]',
          cutaway ? 'bg-[#1F4FD8] text-white' : 'text-[#334155] hover:bg-white',
        )}
      >
        <Layers className="h-3.5 w-3.5" aria-hidden="true" /> Cutaway
      </button>
      <label className="flex h-11 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-[#334155] lg:h-8">
        <Gauge className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="sr-only">Quality</span>
        <select
          value={quality}
          onChange={e => setQuality(e.target.value as QualitySetting)}
          className="rounded-md border border-[#E2E8F0] bg-white px-1.5 py-1 text-xs font-medium text-[#0F172A] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1F4FD8]"
          aria-label="Render quality"
        >
          {QUALITY_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>
              {o.value === 'auto' ? `Auto (${tier})` : o.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

export function StaleNotice({ ageMs }: { ageMs: number }) {
  return (
    <div role="status" className={clsx('flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-[#78350F]', glass)}>
      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
      LIVE data last refreshed {formatAge(ageMs)} ago. The scene is desaturated and equipment motion from older events is paused.
    </div>
  )
}
