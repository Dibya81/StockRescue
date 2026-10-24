import { useEffect, useMemo, useState } from 'react'
import {
  ChevronLeft,
  Database,
  FastForward,
  Pause,
  Play,
  RotateCcw,
  Repeat,
  SkipForward,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useSimStore, type Speed, type StepKey } from '@/features/live-sim/engine'
import { AGENTS, OFFLINE_CASE, SCENARIOS, agentById, type AgentId, type ScenarioId, type SimCase } from '@/features/live-sim/model'
import {
  AgentGraph,
  AnimatePresence,
  ApprovalWorkspace,
  ExecutionPanel,
  FinalSummary,
  PlanCard,
  StepList,
  Timeline,
  fmtClock,
  fmtMoney,
  useOutcome,
} from '@/features/live-sim/ui'

// What each agent waits for before the Coordinator can activate it
const WAITS_FOR: Record<AgentId, string> = {
  coordinator: 'A recovery case to be opened (press Start).',
  inventory_bom: 'Coordinator intake: case validated and tasks dispatched.',
  job_impact: 'Coordinator intake: case validated and tasks dispatched.',
  supplier_sourcing: 'A confirmed shortage from Inventory/BOM and validated job impact.',
  quote_planning: 'Supplier quotations plus compatibility results from Supplier Sourcing.',
  procurement: 'A recovery plan and a human approval bound to that plan version.',
  vendor_communication: 'Discovered suppliers whose availability must be confirmed.',
  delivery_watch: 'Purchase-order drafts for an approved plan.',
}

const SPEEDS: Speed[] = [0.5, 1, 2, 'instant']

export function LiveSimulationPage() {
  const { apiClient } = useAuth()
  const [engine] = useState(() => useSimStore.getState().init())
  const snap = useSimStore(s => s.snap) ?? engine.snapshot
  const [source, setSource] = useState<'database' | 'offline' | 'loading'>('loading')
  const [inspect, setInspect] = useState<StepKey | null>(null)
  const [pendingAgent, setPendingAgent] = useState<AgentId | null>(null)
  const [tab, setTab] = useState<StepKey | null>(null)
  const [replay, setReplay] = useState<{ key: StepKey; stage: number } | null>(null)
  const [autoPanels, setAutoPanels] = useState(true)
  const [side, setSide] = useState<'events' | 'steps'>('events')

  // Load the scenario from the backend database once; fall back to the bundled copy
  useEffect(() => {
    let alive = true
    apiClient.getSimulationScenario('SR-2026-001')
      .then(c => { if (alive) { engine.setBase(c as SimCase); setSource('database') } })
      .catch(() => { if (alive) { engine.setBase(OFFLINE_CASE); setSource('offline') } })
    return () => { alive = false; engine.pause() }
  }, [apiClient, engine])

  // Replay animation for a finished agent (view-only, engine untouched)
  useEffect(() => {
    if (!replay) return
    const step = snap.steps.find(s => s.key === replay.key)
    const total = step?.result?.stages.length ?? 0
    if (replay.stage >= total) return
    const id = setTimeout(() => setReplay(r => (r ? { ...r, stage: r.stage + 1 } : r)), 750)
    return () => clearTimeout(id)
  }, [replay, snap.steps])

  // Keyboard: space toggles run/pause, → advances one step
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (e.code === 'Space') { e.preventDefault(); if (snap.status === 'running') engine.pause(); else engine.start() }
      if (e.code === 'ArrowRight') engine.next()
      if (e.code === 'Escape') { setInspect(null); setReplay(null); setPendingAgent(null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [engine, snap.status])

  const outcome = useOutcome(snap)
  const running = snap.steps.filter(s => s.status === 'running').sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
  const autoStep = running.find(s => s.key === tab) ?? running[0] ?? null
  const inspected = inspect ? snap.steps.find(s => s.key === inspect) ?? null : null
  const approvalRound = snap.events.filter(e => e.event_type === 'approval_requested').length

  const overlay: 'approval' | 'inspect' | 'pending' | 'auto' | null =
    snap.status === 'waiting_approval' && !inspected ? 'approval'
      : inspected ? 'inspect'
      : pendingAgent ? 'pending'
      : autoPanels && autoStep && snap.speed !== 'instant' ? 'auto'
      : null
  const focusAgent: AgentId | null = overlay === 'inspect' && inspected ? inspected.agent
    : overlay === 'auto' && autoStep ? autoStep.agent
    : overlay === 'approval' ? 'procurement'
    : overlay === 'pending' ? pendingAgent : null

  const finished = snap.steps.filter(s => s.endedAt != null).sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0))
  const closeOverlay = () => { setInspect(null); setReplay(null); setPendingAgent(null) }
  const onInspectAgent = (id: AgentId) => {
    setReplay(null)
    const step = [...snap.steps].reverse().find(s => s.agent === id && s.status !== 'pending')
    if (step) { setInspect(step.key); setPendingAgent(null) } else { setInspect(null); setPendingAgent(id) }
  }
  const previousAgent = () => {
    if (!finished.length) return
    const idx = inspect ? finished.findIndex(s => s.key === inspect) : finished.length
    setReplay(null)
    setInspect(finished[Math.max(0, idx - 1)].key)
  }
  const replayAgent = () => {
    const key = inspect && snap.steps.find(s => s.key === inspect)?.endedAt != null ? inspect : finished[finished.length - 1]?.key
    if (!key) return
    setInspect(key)
    setReplay({ key, stage: 0 })
  }

  const statusLabel = {
    ready: 'Ready', running: 'Running', paused: 'Paused', waiting_approval: 'Awaiting approval', completed: 'Completed', blocked: 'Completed with exceptions',
  }[snap.status]
  const scenario = SCENARIOS.find(s => s.id === snap.scenarioId) ?? SCENARIOS[0]
  const c = snap.caseData
  const doneAgents = useMemo(() => new Set(snap.steps.filter(s => s.status === 'done').map(s => s.agent)).size, [snap.steps])

  return (
    <div className="-m-4 min-h-full bg-[#0a1322] p-4 text-slate-200 sm:-m-6 sm:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold tracking-wider text-amber-300">DEMO MODE · SIMULATED</span>
            <span className="inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-400">
              <Database className="h-3 w-3" />
              {source === 'database' ? 'Case data: stockrescue.db' : source === 'offline' ? 'Case data: bundled offline copy' : 'Loading case…'}
            </span>
            <span className="rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-400">No real AI calls · no messages sent · no purchases</span>
          </div>
          <h1 className="mt-2 text-xl font-semibold text-slate-50">Live Multi-Agent Recovery · <span className="font-mono text-cyan-300">{c?.case_id ?? 'SR-2026-001'}</span></h1>
          <p className="text-sm text-slate-400">{scenario.title}: {scenario.description}</p>
        </div>
        <div className="flex items-center gap-4 rounded-xl border border-slate-800 bg-[#0d1729] px-4 py-2">
          <div><div className="text-[10px] uppercase tracking-wide text-slate-500">Status</div><div className="text-sm font-medium text-slate-100">{statusLabel}</div></div>
          <div><div className="text-[10px] uppercase tracking-wide text-slate-500">Sim clock</div><div className="font-mono text-sm text-cyan-300">{fmtClock(snap.time)}</div></div>
          <div><div className="text-[10px] uppercase tracking-wide text-slate-500">Agents done</div><div className="font-mono text-sm text-slate-100">{doneAgents}/{AGENTS.length}</div></div>
          <div><div className="text-[10px] uppercase tracking-wide text-slate-500">Events</div><div className="font-mono text-sm text-slate-100">{snap.events.length}</div></div>
        </div>
      </div>

      {/* Controls */}
      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-[#0d1729] p-2.5">
        <select value={snap.scenarioId} onChange={e => { closeOverlay(); engine.setScenario(e.target.value as ScenarioId) }}
          className="rounded-lg border border-slate-700 bg-[#081120] px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-cyan-500/60" aria-label="Scenario">
          {SCENARIOS.map((s, i) => <option key={s.id} value={s.id}>{i + 1}. {s.title}</option>)}
        </select>
        <div className="mx-1 h-6 w-px bg-slate-800" />
        {snap.status === 'running' ? (
          <button type="button" onClick={() => engine.pause()} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-600"><Pause className="h-3.5 w-3.5" />Pause</button>
        ) : (
          <button type="button" disabled={!c || snap.status === 'waiting_approval'} onClick={() => { closeOverlay(); engine.start() }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-40">
            <Play className="h-3.5 w-3.5" />{snap.status === 'ready' ? 'Start Live Simulation' : snap.status === 'paused' ? 'Resume' : snap.status === 'waiting_approval' ? 'Awaiting approval' : 'Run again'}
          </button>
        )}
        <button type="button" onClick={() => { closeOverlay(); engine.next() }} disabled={!c || snap.status === 'completed' || snap.status === 'blocked' || snap.status === 'waiting_approval'}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40"><SkipForward className="h-3.5 w-3.5" />Next step</button>
        <button type="button" onClick={previousAgent} disabled={!finished.length} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40"><ChevronLeft className="h-3.5 w-3.5" />Previous agent</button>
        <button type="button" onClick={replayAgent} disabled={!finished.length} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40"><Repeat className="h-3.5 w-3.5" />Replay agent</button>
        <button type="button" onClick={() => { closeOverlay(); engine.restart() }} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"><RotateCcw className="h-3.5 w-3.5" />Restart</button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-lg border border-slate-700 p-0.5" role="group" aria-label="Speed">
            <FastForward className="mx-1.5 h-3.5 w-3.5 text-slate-500" />
            {SPEEDS.map(s => (
              <button key={String(s)} type="button" onClick={() => engine.setSpeed(s)}
                className={`rounded-md px-2 py-1 text-[11px] font-medium ${snap.speed === s ? 'bg-slate-700 text-cyan-300' : 'text-slate-400 hover:text-slate-200'}`}>
                {s === 'instant' ? 'Instant' : `${s}x`}
              </button>
            ))}
          </div>
          <div className="flex items-center rounded-lg border border-slate-700 p-0.5" role="group" aria-label="Mode">
            {(['auto', 'step'] as const).map(m => (
              <button key={m} type="button" onClick={() => engine.setMode(m)}
                className={`rounded-md px-2 py-1 text-[11px] font-medium ${snap.mode === m ? 'bg-slate-700 text-cyan-300' : 'text-slate-400 hover:text-slate-200'}`}>
                {m === 'auto' ? 'Automatic' : 'Step-by-step'}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <input type="checkbox" checked={autoPanels} onChange={e => setAutoPanels(e.target.checked)} className="accent-cyan-500" />
            Auto-open panels
          </label>
        </div>
      </div>

      {/* Graph + side rail */}
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="relative h-[600px] overflow-hidden rounded-2xl border border-slate-800 bg-[radial-gradient(ellipse_at_center,#10213b_0%,#0a1322_70%)]">
          <div className="pointer-events-none absolute left-4 top-3 z-10 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Agent workflow · click an agent to inspect</div>
          <AgentGraph snap={snap} focusAgent={focusAgent} onInspect={onInspectAgent} />
          <AnimatePresence>
            {overlay && (
              <div key="overlay" className="absolute inset-0 z-20 flex items-center justify-center bg-[#050b16]/55 p-4 backdrop-blur-[3px]"
                onClick={e => { if (e.target === e.currentTarget && overlay !== 'approval' && overlay !== 'auto') closeOverlay() }}>
                {overlay === 'approval' && (
                  <ApprovalWorkspace key={approvalRound} plans={outcome.plans} recommendedId={outcome.selected} round={approvalRound}
                    onDecide={(d, p, cm) => engine.decide(d, p, cm)} />
                )}
                {overlay === 'inspect' && inspected && (
                  <ExecutionPanel key={inspected.key} step={inspected} events={snap.events} now={snap.time}
                    replayStage={replay?.key === inspected.key ? replay.stage : null}
                    onClose={() => { setInspect(null); setReplay(null) }} />
                )}
                {overlay === 'auto' && autoStep && (
                  <ExecutionPanel key={autoStep.key} step={autoStep} events={snap.events} now={snap.time} tabs={running} onTab={setTab} />
                )}
                {overlay === 'pending' && pendingAgent && (
                  <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-[#0d1729] p-5 shadow-2xl">
                    <div className="font-mono text-[11px] text-slate-500">AGENT {agentById(pendingAgent).number} · not activated</div>
                    <h3 className="mt-1 text-lg font-semibold text-slate-50">{agentById(pendingAgent).name}</h3>
                    <p className="mt-1 text-xs text-slate-400">{agentById(pendingAgent).responsibility}</p>
                    <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-100">
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-amber-300">Waiting for dependency</div>
                      {WAITS_FOR[pendingAgent]}
                    </div>
                    <button type="button" onClick={() => setPendingAgent(null)} className="mt-4 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800">Close</button>
                  </div>
                )}
              </div>
            )}
          </AnimatePresence>
          {snap.status === 'ready' && !overlay && (
            <div className="absolute inset-x-0 bottom-4 z-10 flex justify-center">
              <button type="button" disabled={!c} onClick={() => engine.start()}
                className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-cyan-900/40 hover:bg-cyan-500 disabled:opacity-40">
                <Play className="h-4 w-4" />Start Live Simulation
              </button>
            </div>
          )}
        </div>

        <div className="flex h-[600px] flex-col rounded-2xl border border-slate-800 bg-[#0d1729]">
          <div className="flex gap-1 border-b border-slate-800 p-2">
            {(['events', 'steps'] as const).map(t => (
              <button key={t} type="button" onClick={() => setSide(t)}
                className={`rounded-md px-3 py-1 text-xs font-medium ${side === t ? 'bg-slate-800 text-cyan-300' : 'text-slate-400 hover:text-slate-200'}`}>
                {t === 'events' ? `Live execution (${snap.events.length})` : 'Workflow steps'}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 p-2">
            {side === 'events'
              ? <Timeline events={snap.events} onPick={onInspectAgent} />
              : <StepList snap={snap} onPick={k => { setReplay(null); setInspect(k) }} />}
          </div>
        </div>
      </div>

      {/* Recovery case workspace */}
      <h2 className="mt-6 text-sm font-semibold uppercase tracking-wider text-slate-400">Recovery case workspace</h2>
      <div className="mt-2 grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-[#0d1729] p-4">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Component</div>
          <div className="mt-1 font-mono text-sm text-cyan-300">{c?.component.sku}</div>
          <div className="text-sm text-slate-200">{c?.component.name}</div>
          <div className="mt-2 flex flex-wrap gap-1">
            {c && Object.entries(c.component.spec).map(([k, v]) => <span key={k} className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">{k.replace(/_/g, ' ')}: {v}</span>)}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            {([
              ['Required', c?.required_quantity ?? '—'],
              ['Usable', outcome.inv?.available ?? '—'],
              ['Shortage', outcome.inv?.shortage ?? '—'],
            ] as const).map(([k, v]) => (
              <div key={k} className="rounded-lg border border-slate-800 py-2">
                <div className="text-[10px] text-slate-500">{k}</div>
                <div className={`font-mono text-lg ${k === 'Shortage' && outcome.inv ? 'text-rose-300' : 'text-slate-100'}`}>{v}</div>
              </div>
            ))}
          </div>
          <div className="mt-2 text-[11px] text-slate-500">Deadline {c?.deadline_days ?? '—'} days · budget {c ? fmtMoney(c.budget.amount) : '—'}{outcome.inv ? ` · ${outcome.inv.reserved} reserved, ${outcome.inv.quarantined} quarantined` : ''}</div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#0d1729] p-4">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Affected repair jobs</div>
          <ul className="mt-2 space-y-2">
            {(c?.jobs ?? []).map(j => {
              const imp = outcome.jobs.find(x => x.job_id === j.job_id)
              return (
                <li key={j.job_id} className="rounded-lg border border-slate-800 p-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-slate-300">{j.job_id}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${j.priority === 'critical' ? 'bg-rose-500/15 text-rose-300' : j.priority === 'high' ? 'bg-amber-500/15 text-amber-200' : 'bg-slate-700/60 text-slate-300'}`}>{j.priority}</span>
                  </div>
                  <div className="text-slate-200">{j.machine}</div>
                  <div className="text-[11px] text-slate-500">{j.quantity} units · due in {j.deadline_days} d{imp ? ` · ${imp.covered} covered, ${imp.uncovered} uncovered` : ''}</div>
                </li>
              )
            })}
          </ul>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#0d1729] p-4">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Supplier quotations {outcome.quotes.length ? '(MOCK RESPONSES)' : ''}</div>
          {outcome.quotes.length === 0 ? <p className="mt-3 text-xs text-slate-500">Quotations appear after Vendor Communication drafts enquiries and the Coordinator collects the simulated responses.</p> : (
            <table className="mt-2 w-full text-[11px]">
              <thead><tr className="text-left text-slate-500"><th className="py-1 font-medium">Supplier</th><th className="font-medium">Qty</th><th className="font-medium">Price</th><th className="font-medium">Lead</th><th className="font-medium">Docs</th></tr></thead>
              <tbody>
                {outcome.quotes.map(q => (
                  <tr key={q.label} className="border-t border-slate-800 text-slate-300">
                    <td className="py-1.5">{q.label}<div className="text-[10px] text-slate-500">{q.supplier_name}</div></td>
                    <td className="font-mono">{q.quantity}</td>
                    <td className="font-mono">{fmtMoney(q.unit_price)}</td>
                    <td className={`font-mono ${c && q.lead_time_days > c.deadline_days ? 'text-amber-300' : ''}`}>{q.lead_time_days} d</td>
                    <td className={q.quality_docs === 'available' ? 'text-emerald-300' : 'text-amber-300'}>{q.quality_docs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {outcome.plans.length > 0 && (
        <>
          <h2 className="mt-6 text-sm font-semibold uppercase tracking-wider text-slate-400">Recovery plans · totals calculated from quote lines</h2>
          <div className="mt-2 grid gap-3 lg:grid-cols-3">
            {outcome.plans.map(p => <PlanCard key={p.id} plan={p} recommended={p.id === outcome.selected} selected={p.id === snap.approval.planId} />)}
          </div>
        </>
      )}

      {(outcome.po?.drafts || outcome.del?.expected != null) && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {outcome.po?.drafts && (
            <div className="rounded-xl border border-slate-800 bg-[#0d1729] p-4">
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Purchase-order drafts</div>
                <span className="rounded border border-amber-400/40 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">DRAFT · NOT EXECUTED</span>
              </div>
              <ul className="mt-2 space-y-1.5 text-xs">
                {outcome.po.drafts.map(d => (
                  <li key={d.po} className="flex justify-between rounded-lg border border-slate-800 px-2.5 py-1.5">
                    <span><span className="font-mono text-cyan-300">{d.po}</span> <span className="text-slate-400">→ {d.supplier}</span></span>
                    <span className="font-mono text-slate-200">{d.quantity} u · {fmtMoney(d.total)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {outcome.del?.expected != null && (
            <div className="rounded-xl border border-slate-800 bg-[#0d1729] p-4">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Delivery watch (recorded events, simulated)</div>
              <div className="mt-2 flex items-end gap-3">
                <div className="font-mono text-2xl text-slate-100">{outcome.del.received}<span className="text-sm text-slate-500"> / {outcome.del.expected}</span></div>
                <div className="pb-1 text-xs text-amber-200">{outcome.del.status?.replace('_', ' ')}</div>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded bg-slate-800">
                <div className="h-full rounded bg-emerald-400/80 transition-all duration-700" style={{ width: `${Math.round(((outcome.del.received ?? 0) / Math.max(1, outcome.del.expected)) * 100)}%` }} />
              </div>
              {(outcome.del.exceptions ?? []).map(x => <div key={x} className="mt-2 text-[11px] text-amber-200">⚠ {x}</div>)}
            </div>
          )}
        </div>
      )}

      {(snap.status === 'completed' || snap.status === 'blocked') && <div className="mt-4"><FinalSummary snap={snap} /></div>}

      <p className="mt-6 text-center text-[11px] text-slate-600">
        Deterministic simulation of {AGENTS.length} agents. Results are computed from the case data by mock executors; panels show inputs, stages and outputs, never model reasoning.
      </p>
    </div>
  )
}
