import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronLeft, Pause, Play, RotateCcw, Repeat, ShieldAlert, SkipForward } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useSimStore, type SimSnapshot, type Speed, type StepKey } from '@/features/live-sim/engine'
import { AGENTS, OFFLINE_CASE, SCENARIOS, agentById, type AgentId, type ScenarioId, type SimCase } from '@/features/live-sim/model'
import {
  AgentGraph,
  AnimatePresence,
  ApprovalWorkspace,
  ExecutionPanel,
  FinalSummary,
  PlanCard,
  StageChecklist,
  StateBadge,
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

const card = 'rounded-2xl border border-slate-200 bg-white shadow-sm'
const label = 'text-[11px] font-semibold uppercase tracking-wider text-slate-400'

/** Right-rail card: what the agents are doing right now, in plain words. */
function NowWorking({ snap, onReview }: { snap: SimSnapshot; onReview: () => void }) {
  const running = snap.steps.filter(s => s.status === 'running')
  const lastDone = [...snap.steps].filter(s => s.endedAt != null && s.result).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))[0]

  if (snap.status === 'ready') {
    return (
      <div className="space-y-3 text-sm text-slate-600">
        <p>A bearing is running out: <b className="text-slate-900">500 needed, only 120 usable</b>. Press <b className="text-blue-600">Start</b> to watch 8 agents work out a recovery.</p>
        <ol className="space-y-1.5">
          {['Check stock and affected repair jobs (in parallel)', 'Find suppliers and collect quotes', 'Verify parts and build recovery plans', 'You approve a plan → purchase order draft → delivery tracking'].map((t, i) => (
            <li key={t} className="flex gap-2"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-blue-50 text-[11px] font-semibold text-blue-600">{i + 1}</span>{t}</li>
          ))}
        </ol>
      </div>
    )
  }
  if (snap.status === 'waiting_approval') {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-amber-700"><ShieldAlert className="h-4 w-4" />Your approval is needed</div>
        <p className="text-sm text-slate-600">Quote & Planning prepared 3 recovery plans. Pick one to continue.</p>
        <button type="button" onClick={onReview} className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">Review plans</button>
      </div>
    )
  }
  if (snap.status === 'completed' || snap.status === 'blocked') return <FinalSummary snap={snap} />
  if (running.length === 0) {
    return lastDone ? (
      <div className="flex gap-2 text-sm text-slate-700"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /><span><b>{agentById(lastDone.agent).name}:</b> {lastDone.result?.summary}</span></div>
    ) : <p className="text-sm text-slate-500">Paused.</p>
  }
  return (
    <div className="space-y-4">
      {running.length > 1 && <div className="text-xs font-medium text-blue-600">{running.length} agents working in parallel</div>}
      {running.map(s => (
        <div key={s.key} className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[15px] font-semibold text-slate-900">{agentById(s.agent).name}</div>
            <StateBadge state={s.phase} />
          </div>
          <p className="text-[13px] leading-snug text-slate-500">{s.reason}</p>
          <StageChecklist step={s} />
        </div>
      ))}
    </div>
  )
}

export function LiveSimulationPage() {
  const { apiClient } = useAuth()
  const [engine] = useState(() => useSimStore.getState().init())
  const snap = useSimStore(s => s.snap) ?? engine.snapshot
  const [source, setSource] = useState<'database' | 'offline' | 'loading'>('loading')
  const [inspect, setInspect] = useState<StepKey | null>(null)
  const [pendingAgent, setPendingAgent] = useState<AgentId | null>(null)
  const [replay, setReplay] = useState<{ key: StepKey; stage: number } | null>(null)
  const [approvalOpen, setApprovalOpen] = useState(true)
  const [more, setMore] = useState(false)

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
    if (replay.stage >= (step?.result?.stages.length ?? 0)) return
    const id = setTimeout(() => setReplay(r => (r ? { ...r, stage: r.stage + 1 } : r)), 750)
    return () => clearTimeout(id)
  }, [replay, snap.steps])

  // Re-open the approval dialog each time a new approval is requested
  const approvalRound = snap.events.filter(e => e.event_type === 'approval_requested').length
  useEffect(() => { setApprovalOpen(true) }, [approvalRound])

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
  const running = snap.steps.filter(s => s.status === 'running')
  const inspected = inspect ? snap.steps.find(s => s.key === inspect) ?? null : null
  const overlay: 'approval' | 'inspect' | 'pending' | null =
    inspected ? 'inspect' : pendingAgent ? 'pending' : snap.status === 'waiting_approval' && approvalOpen ? 'approval' : null
  const focusAgent: AgentId | null = overlay === 'inspect' && inspected ? inspected.agent : null

  const finished = snap.steps.filter(s => s.endedAt != null).sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0))
  const closeOverlay = () => { setInspect(null); setReplay(null); setPendingAgent(null); setApprovalOpen(false) }
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

  const scenario = SCENARIOS.find(s => s.id === snap.scenarioId) ?? SCENARIOS[0]
  const c = snap.caseData
  const doneAgents = useMemo(() => new Set(snap.steps.filter(s => s.status === 'done').map(s => s.agent)).size, [snap.steps])
  const isOver = snap.status === 'completed' || snap.status === 'blocked'

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Live Agent Simulation</h1>
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700">Demo · simulated</span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Case <span className="font-mono font-medium text-blue-600">{c?.case_id ?? 'SR-2026-001'}</span> · {scenario.description}
            {source === 'database' ? ' · data from stockrescue.db' : source === 'offline' ? ' · offline data' : ''}
          </p>
        </div>
        <div className="flex items-center gap-5 text-right">
          <div><div className={label}>Agents done</div><div className="text-lg font-semibold text-slate-900">{doneAgents}<span className="text-slate-400">/{AGENTS.length}</span></div></div>
          <div><div className={label}>Time</div><div className="font-mono text-lg font-semibold text-slate-900">{fmtClock(snap.time).slice(0, 5)}</div></div>
        </div>
      </div>

      {/* Controls */}
      <div className={`${card} flex flex-wrap items-center gap-2 p-3`}>
        {snap.status === 'running' ? (
          <button type="button" onClick={() => engine.pause()} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"><Pause className="h-4 w-4" />Pause</button>
        ) : (
          <button type="button" disabled={!c || snap.status === 'waiting_approval'} onClick={() => { closeOverlay(); engine.start() }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40">
            <Play className="h-4 w-4" />{snap.status === 'ready' ? 'Start simulation' : snap.status === 'paused' ? 'Resume' : snap.status === 'waiting_approval' ? 'Waiting for approval' : 'Run again'}
          </button>
        )}
        <button type="button" onClick={() => { closeOverlay(); engine.restart() }} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"><RotateCcw className="h-4 w-4" />Restart</button>
        <div className="flex items-center rounded-lg bg-slate-100 p-0.5" role="group" aria-label="Speed">
          {SPEEDS.map(s => (
            <button key={String(s)} type="button" onClick={() => engine.setSpeed(s)}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${snap.speed === s ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
              {s === 'instant' ? 'Instant' : `${s}x`}
            </button>
          ))}
        </div>
        <select value={snap.scenarioId} onChange={e => { closeOverlay(); engine.setScenario(e.target.value as ScenarioId) }}
          className="ml-auto rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500" aria-label="Scenario">
          {SCENARIOS.map((s, i) => <option key={s.id} value={s.id}>Scenario {i + 1}: {s.title}</option>)}
        </select>
        <button type="button" onClick={() => setMore(m => !m)} className="inline-flex items-center gap-1 rounded-lg px-2 py-2 text-sm text-slate-500 hover:text-slate-800">
          More <ChevronDown className={`h-4 w-4 transition-transform ${more ? 'rotate-180' : ''}`} />
        </button>
        {more && (
          <div className="flex w-full flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
            <button type="button" onClick={() => { closeOverlay(); engine.next() }} disabled={!c || isOver || snap.status === 'waiting_approval'}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-40"><SkipForward className="h-3.5 w-3.5" />Next step</button>
            <button type="button" onClick={previousAgent} disabled={!finished.length} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-40"><ChevronLeft className="h-3.5 w-3.5" />Previous agent</button>
            <button type="button" onClick={replayAgent} disabled={!finished.length} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-40"><Repeat className="h-3.5 w-3.5" />Replay agent</button>
            <div className="flex items-center rounded-lg bg-slate-100 p-0.5" role="group" aria-label="Mode">
              {(['auto', 'step'] as const).map(m => (
                <button key={m} type="button" onClick={() => engine.setMode(m)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium ${snap.mode === m ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
                  {m === 'auto' ? 'Automatic' : 'Step-by-step'}
                </button>
              ))}
            </div>
            <span className="text-xs text-slate-400">Shortcuts: Space = play/pause · → = next step · Esc = close</span>
          </div>
        )}
      </div>

      {/* Graph + right rail */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className={`${card} relative h-[540px] overflow-hidden bg-slate-50/60`}>
          <div className="pointer-events-none absolute left-4 top-3 z-10 text-xs text-slate-400">Click any agent to see what it did</div>
          <AgentGraph snap={snap} focusAgent={focusAgent} onInspect={onInspectAgent} />
          <AnimatePresence>
            {overlay && (
              <div key="overlay" className="absolute inset-0 z-20 flex items-center justify-center bg-white/50 p-4 backdrop-blur-[2px]"
                onClick={e => { if (e.target === e.currentTarget) closeOverlay() }}>
                {overlay === 'approval' && (
                  <ApprovalWorkspace key={approvalRound} plans={outcome.plans} recommendedId={outcome.selected} round={approvalRound}
                    onDecide={(d, p, cm) => engine.decide(d, p, cm)} />
                )}
                {overlay === 'inspect' && inspected && (
                  <ExecutionPanel key={inspected.key} step={inspected} events={snap.events} now={snap.time}
                    replayStage={replay?.key === inspected.key ? replay.stage : null}
                    onClose={() => { setInspect(null); setReplay(null) }} />
                )}
                {overlay === 'pending' && pendingAgent && (
                  <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
                    <div className="text-xs text-slate-400">Agent {agentById(pendingAgent).number} · not started yet</div>
                    <h3 className="mt-1 text-lg font-semibold text-slate-900">{agentById(pendingAgent).name}</h3>
                    <p className="mt-1 text-sm text-slate-500">{agentById(pendingAgent).responsibility}</p>
                    <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><b>Waiting for:</b> {WAITS_FOR[pendingAgent]}</div>
                    <button type="button" onClick={() => setPendingAgent(null)} className="mt-4 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">Close</button>
                  </div>
                )}
              </div>
            )}
          </AnimatePresence>
          {snap.status === 'ready' && !overlay && (
            <div className="absolute inset-x-0 bottom-5 z-10 flex justify-center">
              <button type="button" disabled={!c} onClick={() => engine.start()}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/25 hover:bg-blue-700 disabled:opacity-40">
                <Play className="h-4 w-4" />Start simulation
              </button>
            </div>
          )}
        </div>

        <div className="flex h-[540px] flex-col gap-5">
          <div className={`${card} max-h-[60%] shrink-0 overflow-y-auto p-4`}>
            <div className={`${label} mb-3`}>{running.length ? 'Working now' : 'Status'}</div>
            <NowWorking snap={snap} onReview={() => setApprovalOpen(true)} />
          </div>
          <div className={`${card} flex min-h-0 flex-1 flex-col p-4`}>
            <div className={`${label} mb-2`}>Activity</div>
            <div className="min-h-0 flex-1"><Timeline events={snap.events} onPick={onInspectAgent} /></div>
          </div>
        </div>
      </div>

      {/* Case facts */}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className={`${card} p-5`}>
          <div className={label}>Part short</div>
          <div className="mt-1 text-base font-semibold text-slate-900">{c?.component.name}</div>
          <div className="font-mono text-xs text-slate-400">{c?.component.sku}</div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            {([['Needed', c?.required_quantity ?? '—'], ['Usable', outcome.inv?.available ?? '—'], ['Short', outcome.inv?.shortage ?? '—']] as const).map(([k, v]) => (
              <div key={k} className="rounded-xl bg-slate-50 py-2.5">
                <div className="text-xs text-slate-500">{k}</div>
                <div className={`text-xl font-semibold ${k === 'Short' && outcome.inv ? 'text-rose-600' : 'text-slate-900'}`}>{v}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 text-xs text-slate-500">Deadline {c?.deadline_days ?? '—'} days · budget {c ? fmtMoney(c.budget.amount) : '—'}</div>
        </div>

        <div className={`${card} p-5`}>
          <div className={label}>Repair jobs at risk</div>
          <ul className="mt-3 space-y-2.5">
            {(c?.jobs ?? []).map(j => {
              const imp = outcome.jobs.find(x => x.job_id === j.job_id)
              return (
                <li key={j.job_id} className="flex items-start justify-between gap-3 text-sm">
                  <div>
                    <div className="font-medium text-slate-900">{j.machine}</div>
                    <div className="text-xs text-slate-500">{j.quantity} units · due in {j.deadline_days} days{imp ? ` · ${imp.uncovered} uncovered` : ''}</div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${j.priority === 'critical' ? 'bg-rose-50 text-rose-700' : j.priority === 'high' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>{j.priority}</span>
                </li>
              )
            })}
          </ul>
        </div>

        <div className={`${card} p-5`}>
          <div className={label}>Supplier quotes</div>
          {outcome.quotes.length === 0 ? <p className="mt-3 text-sm text-slate-400">Quotes show up once the suppliers reply.</p> : (
            <ul className="mt-3 space-y-2.5">
              {outcome.quotes.map(q => (
                <li key={q.label} className="flex items-start justify-between gap-3 text-sm">
                  <div>
                    <div className="font-medium text-slate-900">{q.supplier_name ?? q.label}</div>
                    <div className="text-xs text-slate-500">{q.quantity} units · {q.lead_time_days} days · docs {q.quality_docs}</div>
                  </div>
                  <span className="shrink-0 font-semibold text-slate-900">{fmtMoney(q.unit_price)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {outcome.plans.length > 0 && (
        <div>
          <div className={`${label} mb-2`}>Recovery plans</div>
          <div className="grid gap-4 lg:grid-cols-3">
            {outcome.plans.map(p => <PlanCard key={p.id} plan={p} recommended={p.id === outcome.selected} selected={p.id === snap.approval.planId} />)}
          </div>
        </div>
      )}

      {(outcome.po?.drafts || outcome.del?.expected != null) && (
        <div className="grid gap-5 lg:grid-cols-2">
          {outcome.po?.drafts && (
            <div className={`${card} p-5`}>
              <div className="flex items-center justify-between">
                <div className={label}>Purchase order drafts</div>
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Draft · not sent</span>
              </div>
              <ul className="mt-3 space-y-2 text-sm">
                {outcome.po.drafts.map(d => (
                  <li key={d.po} className="flex justify-between">
                    <span><span className="font-mono text-blue-600">{d.po}</span> <span className="text-slate-500">· {d.supplier}</span></span>
                    <span className="font-medium text-slate-900">{d.quantity} units · {fmtMoney(d.total)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {outcome.del?.expected != null && (
            <div className={`${card} p-5`}>
              <div className={label}>Delivery</div>
              <div className="mt-2 flex items-end gap-3">
                <div className="text-2xl font-semibold text-slate-900">{outcome.del.received}<span className="text-base text-slate-400"> / {outcome.del.expected} received</span></div>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-emerald-500 transition-all duration-700" style={{ width: `${Math.round(((outcome.del.received ?? 0) / Math.max(1, outcome.del.expected)) * 100)}%` }} />
              </div>
              {(outcome.del.exceptions ?? []).map(x => <div key={x} className="mt-2 text-xs text-amber-700">⚠ {x}</div>)}
            </div>
          )}
        </div>
      )}

      <p className="text-center text-xs text-slate-400">Simulated demo: no AI calls, no messages sent, no purchases made.</p>
    </div>
  )
}
