import { memo, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  BaseEdge,
  Handle,
  Position,
  ReactFlow,
  getBezierPath,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { AlertTriangle, CheckCircle2, Circle, Clock3, Loader2, ShieldAlert, X, XCircle } from 'lucide-react'
import { AGENTS, agentById, type AgentDef, type AgentId, type AgentState, type RecoveryPlan } from './model'
import type { SimEvent, SimSnapshot, StepKey, StepRun } from './engine'

// Presentation for the live simulation: agent graph, execution panel,
// approval workspace, timeline and summary. Pure views over SimSnapshot.

export const fmtMoney = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
export const fmtClock = (ms: number) => {
  const s = Math.floor(ms / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.${Math.floor((ms % 1000) / 100)}`
}

const ACTIVE: AgentState[] = ['ACTIVATED', 'INPUT_RECEIVED', 'ANALYZING', 'VALIDATING']

const STATE_STYLE: Record<AgentState, { label: string; cls: string }> = {
  IDLE: { label: 'Idle', cls: 'bg-slate-700/50 text-slate-400' },
  QUEUED: { label: 'Queued', cls: 'bg-slate-600/50 text-slate-200' },
  ACTIVATED: { label: 'Activated', cls: 'bg-sky-500/20 text-sky-300' },
  INPUT_RECEIVED: { label: 'Input received', cls: 'bg-sky-500/20 text-sky-300' },
  ANALYZING: { label: 'Analyzing', cls: 'bg-cyan-500/20 text-cyan-300' },
  VALIDATING: { label: 'Validating', cls: 'bg-indigo-500/20 text-indigo-300' },
  COMPLETED: { label: 'Completed', cls: 'bg-emerald-500/15 text-emerald-300' },
  RESPONSE_SENT: { label: 'Response sent', cls: 'bg-emerald-500/15 text-emerald-300' },
  BLOCKED: { label: 'Blocked', cls: 'bg-amber-500/15 text-amber-300' },
  FAILED: { label: 'Failed', cls: 'bg-rose-500/15 text-rose-300' },
  SKIPPED: { label: 'Skipped', cls: 'bg-slate-700/50 text-slate-400' },
  WAITING_FOR_APPROVAL: { label: 'Awaiting approval', cls: 'bg-amber-500/15 text-amber-200' },
}

export function StateBadge({ state }: { state: AgentState }) {
  const s = STATE_STYLE[state]
  return <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${s.cls}`}>
    {ACTIVE.includes(state) && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
    {s.label}
  </span>
}

// ── Graph ────────────────────────────────────────────────

const POSITIONS: Record<AgentId, { x: number; y: number }> = {
  coordinator: { x: 390, y: 205 },
  inventory_bom: { x: 0, y: 0 },
  supplier_sourcing: { x: 260, y: 0 },
  quote_planning: { x: 520, y: 0 },
  procurement: { x: 780, y: 0 },
  job_impact: { x: 130, y: 410 },
  vendor_communication: { x: 390, y: 410 },
  delivery_watch: { x: 650, y: 410 },
}
const TOP_ROW = new Set<AgentId>(['inventory_bom', 'supplier_sourcing', 'quote_planning', 'procurement'])

interface AgentNodeData extends Record<string, unknown> {
  agent: AgentDef
  state: AgentState
  step: StepRun | null
  dimmed: boolean
  onInspect: (id: AgentId) => void
}

const AgentNode = memo(function AgentNode({ data }: NodeProps<Node<AgentNodeData>>) {
  const { agent, state, step, dimmed, onInspect } = data
  const active = ACTIVE.includes(state)
  const stages = step?.result?.stages ?? []
  const pct = step?.status === 'done' ? 100 : stages.length && step ? Math.round((step.stageDone / stages.length) * 100) : 0
  const ring = active ? 'border-cyan-400/80 shadow-[0_0_0_3px_rgba(34,211,238,0.15),0_0_28px_rgba(34,211,238,0.25)]'
    : state === 'WAITING_FOR_APPROVAL' ? 'border-amber-400/70 shadow-[0_0_24px_rgba(251,191,36,0.2)]'
    : state === 'FAILED' ? 'border-rose-400/70' : state === 'BLOCKED' ? 'border-amber-400/60'
    : state === 'COMPLETED' || state === 'RESPONSE_SENT' ? 'border-emerald-400/40' : 'border-slate-700'
  const isCoord = agent.id === 'coordinator'
  const current = active && step ? stages[step.stageDone]?.label : undefined
  return (
    <button
      type="button"
      onClick={() => onInspect(agent.id)}
      className={`nodrag w-[200px] rounded-xl border p-3 text-left transition-all duration-300 hover:border-sky-400/60 ${ring} ${dimmed ? 'opacity-40' : 'opacity-100'} ${isCoord ? 'bg-[#11203a]' : 'bg-[#0f1a2e]'}`}
    >
      {isCoord ? (
        <>
          <Handle type="source" position={Position.Top} className="!h-1.5 !w-1.5 !border-0 !bg-slate-500" />
          <Handle type="source" id="b" position={Position.Bottom} className="!h-1.5 !w-1.5 !border-0 !bg-slate-500" />
        </>
      ) : (
        <Handle type="target" position={TOP_ROW.has(agent.id) ? Position.Bottom : Position.Top} className="!h-1.5 !w-1.5 !border-0 !bg-slate-500" />
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-slate-500">AGENT {agent.number}</span>
        <StateBadge state={state} />
      </div>
      <div className="mt-1.5 text-[13px] font-semibold text-slate-100">{agent.name}</div>
      <div className="text-[11px] text-slate-400">{agent.role}</div>
      <div className="mt-2 h-1 overflow-hidden rounded bg-slate-800">
        <div className={`h-full rounded transition-all duration-500 ${step?.status === 'failed' ? 'bg-rose-400' : step?.status === 'blocked' ? 'bg-amber-400' : 'bg-cyan-400'}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1.5 line-clamp-2 min-h-[28px] text-[11px] leading-snug text-slate-400">
        {current ?? step?.blockedReason ?? step?.result?.summary ?? agent.responsibility}
      </div>
    </button>
  )
})

interface FlowEdgeData extends Record<string, unknown> { flight: 'in' | 'out' | null; done: boolean }

function FlowEdge({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<Edge<FlowEdgeData>>) {
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  const flight = data?.flight ?? null
  const stroke = flight ? '#22d3ee' : data?.done ? 'rgba(52,211,153,0.35)' : 'rgba(100,116,139,0.35)'
  return (
    <>
      <BaseEdge path={path} style={{ stroke, strokeWidth: flight ? 2 : 1.25, strokeDasharray: flight ? '6 4' : undefined, transition: 'stroke 300ms' }} />
      {flight && (
        <circle r={4} fill="#67e8f9">
          <animateMotion dur="1.1s" repeatCount="indefinite" path={path} keyPoints={flight === 'in' ? '0;1' : '1;0'} keyTimes="0;1" calcMode="linear" />
        </circle>
      )}
    </>
  )
}

const nodeTypes = { agent: AgentNode }
const edgeTypes = { flow: FlowEdge }

export function AgentGraph({ snap, focusAgent, onInspect }: { snap: SimSnapshot; focusAgent: AgentId | null; onInspect: (id: AgentId) => void }) {
  const latest = (id: AgentId) => [...snap.steps].reverse().find(s => s.agent === id && s.status !== 'pending') ?? null
  const nodes: Node<AgentNodeData>[] = AGENTS.map(a => ({
    id: a.id, type: 'agent', position: POSITIONS[a.id], draggable: false,
    data: { agent: a, state: snap.agentStates[a.id], step: latest(a.id), dimmed: focusAgent != null && focusAgent !== a.id && a.id !== 'coordinator', onInspect },
  }))
  const edges: Edge<FlowEdgeData>[] = AGENTS.filter(a => a.id !== 'coordinator').map(a => {
    const f = snap.flights.find(x => x.to === a.id || x.from === a.id)
    return {
      id: `e-${a.id}`, source: 'coordinator', sourceHandle: TOP_ROW.has(a.id) ? undefined : 'b', target: a.id, type: 'flow',
      data: { flight: f ? (f.to === a.id ? 'in' : 'out') : null, done: snap.steps.some(s => s.agent === a.id && s.status === 'done') },
    }
  })
  return (
    <ReactFlow
      nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
      fitView fitViewOptions={{ padding: 0.12 }} proOptions={{ hideAttribution: true }}
      nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}
      panOnDrag={false} zoomOnScroll={false} zoomOnPinch={false} zoomOnDoubleClick={false} preventScrolling={false}
    />
  )
}

// ── Execution panel ─────────────────────────────────────

const Json = ({ value }: { value: unknown }) => (
  <pre className="max-h-48 overflow-auto rounded-lg border border-slate-800 bg-[#081120] p-2.5 font-mono text-[11px] leading-relaxed text-slate-300">{JSON.stringify(value, null, 2)}</pre>
)

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div><div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{title}</div>{children}</div>
}

const NEXT: Partial<Record<StepKey, string>> = {
  intake: 'Inventory/BOM ∥ Job Impact', inventory: 'Coordinator (review)', job_impact: 'Coordinator (review)', review: 'Supplier Sourcing · discovery',
  supplier_discovery: 'Vendor Communication', enquiry_drafts: 'Coordinator (collect responses)', collect_responses: 'Supplier Sourcing · compatibility',
  compatibility: 'Quote & Planning · quote risk', quote_risk: 'Quote & Planning · recovery planner', recovery_planner: 'Human approval',
  approval: 'Procurement · PO draft', clarification: 'Human approval', po_draft: 'Delivery Watch', delivery: 'Coordinator · final summary', final_summary: 'Workflow closed',
}

export function ExecutionPanel({ step, events, now, replayStage, onClose, tabs, onTab }: {
  step: StepRun
  events: SimEvent[]
  now: number
  /** When replaying, the number of stages to show as complete */
  replayStage?: number | null
  onClose?: () => void
  tabs?: StepRun[]
  onTab?: (k: StepKey) => void
}) {
  const agent = agentById(step.agent)
  const r = step.result
  const stages = r?.stages ?? []
  const replaying = replayStage != null
  const doneCount = replayStage ?? step.stageDone
  const finished = replaying ? doneCount >= stages.length : step.endedAt != null
  const evts = events.filter(e => e.agent_id === step.agent && (e.task === step.task || e.task == null) && e.t >= (step.startedAt ?? 0) && (step.endedAt == null || e.t <= step.endedAt + 600))
  const duration = (step.endedAt ?? now) - (step.startedAt ?? now)
  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.98 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="flex max-h-full w-full max-w-[880px] flex-col overflow-hidden rounded-2xl border border-slate-700/80 bg-[#0d1729]/95 shadow-2xl shadow-black/50"
      role="dialog" aria-label={`${agent.name} execution`}
    >
      {tabs && tabs.length > 1 && (
        <div className="flex gap-1 border-b border-slate-800 px-4 pt-3">
          {tabs.map(t => (
            <button key={t.key} type="button" onClick={() => onTab?.(t.key)}
              className={`rounded-t-md px-3 py-1.5 text-xs font-medium ${t.key === step.key ? 'bg-slate-800 text-cyan-300' : 'text-slate-400 hover:text-slate-200'}`}>
              {agentById(t.agent).name}
            </button>
          ))}
          <span className="ml-auto self-center text-[10px] uppercase tracking-wide text-slate-500">Parallel execution</span>
        </div>
      )}
      <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] text-slate-500">AGENT {agent.number} · {agent.identity}</span>
            <StateBadge state={replaying ? (finished ? 'COMPLETED' : 'ANALYZING') : step.phase} />
            {replaying && <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-300">REPLAY</span>}
          </div>
          <h3 className="mt-1 text-lg font-semibold text-slate-50">{agent.name} <span className="text-sm font-normal text-slate-400">· {step.task?.replace(/_/g, ' ') ?? 'approval gate'}</span></h3>
          <p className="mt-0.5 text-xs text-slate-400">{agent.responsibility}</p>
        </div>
        <div className="flex items-center gap-3 text-right">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Duration</div>
            <div className="font-mono text-sm text-slate-200">{(duration / 1000).toFixed(1)} s</div>
          </div>
          {onClose && <button type="button" onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100" aria-label="Close panel"><X className="h-4 w-4" /></button>}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-5 md:grid-cols-2">
        <div className="space-y-4">
          <Section title="Why this agent was activated">
            <p className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-2.5 text-xs leading-relaxed text-slate-300">{step.reason || '—'}</p>
            <p className="mt-1.5 text-[11px] text-slate-500">Activated by: <span className="text-slate-300">{step.activatedBy ? agentById(step.activatedBy).name : 'Case intake (system)'}</span></p>
          </Section>
          <Section title="Input"><Json value={r?.input ?? {}} /></Section>
          <Section title="Execution stages">
            <ol className="space-y-1.5">
              {stages.map((s, i) => {
                const st = i < doneCount ? 'done' : i === doneCount && !finished ? 'running' : 'pending'
                return (
                  <li key={s.label + i} className="flex gap-2 text-xs">
                    {st === 'done' ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                      : st === 'running' ? <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-cyan-300" />
                      : <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-600" />}
                    <div>
                      <div className={st === 'pending' ? 'text-slate-500' : 'text-slate-200'}>{s.label}</div>
                      {st !== 'pending' && <div className="text-[11px] text-slate-400">{s.detail}</div>}
                    </div>
                  </li>
                )
              })}
            </ol>
          </Section>
        </div>
        <div className="space-y-4">
          <Section title="Event stream">
            <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-slate-800 bg-[#081120] p-2">
              {evts.length === 0 && <div className="text-[11px] text-slate-500">No events yet</div>}
              {evts.map(e => (
                <div key={e.event_id} className="flex gap-2 font-mono text-[10.5px] leading-snug">
                  <span className="shrink-0 text-slate-500">{fmtClock(e.t)}</span>
                  <span className="shrink-0 text-cyan-300/80">{e.event_type}</span>
                  <span className="text-slate-300">{e.message.replace(`${agent.name}: `, '').replace(`${agent.name} · `, '')}</span>
                </div>
              ))}
            </div>
          </Section>
          <Section title="Output">
            {finished && r ? <Json value={r.output} /> : <div className="rounded-lg border border-dashed border-slate-700 p-3 text-[11px] text-slate-500">Output is published after validation</div>}
          </Section>
          <Section title="Validation">
            {!finished ? <div className="text-[11px] text-slate-500">Pending</div> : (
              <div className="space-y-1">
                {r && r.errors.length === 0 && <div className="flex items-center gap-1.5 text-xs text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" />Schema and business rules passed</div>}
                {r?.errors.map(e => <div key={e} className="flex gap-1.5 text-xs text-rose-300"><XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{e}</div>)}
                {r?.warnings.map(w => <div key={w} className="flex gap-1.5 text-xs text-amber-200"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{w}</div>)}
              </div>
            )}
          </Section>
          <div className="flex items-center justify-between rounded-lg border border-slate-800 px-3 py-2 text-xs">
            <span className="text-slate-500">Next destination</span>
            <span className="font-medium text-slate-200">{step.status === 'blocked' || step.status === 'failed' ? 'Coordinator (exception)' : NEXT[step.key] ?? '—'}</span>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

// ── Approval workspace ──────────────────────────────────

const PLAN_STATUS: Record<RecoveryPlan['status'], string> = {
  FEASIBLE: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  REQUIRES_VERIFICATION: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  CONDITIONAL: 'bg-amber-500/15 text-amber-200 border-amber-500/30',
  BLOCKED: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
}

export function PlanCard({ plan, selected, recommended, onSelect }: { plan: RecoveryPlan; selected?: boolean; recommended?: boolean; onSelect?: () => void }) {
  return (
    <button type="button" disabled={!onSelect} onClick={onSelect}
      className={`w-full rounded-xl border p-3 text-left transition-colors ${selected ? 'border-cyan-400/70 bg-cyan-500/5' : 'border-slate-700 bg-[#0f1a2e] hover:border-slate-500'} disabled:cursor-default`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-mono text-[10px] text-slate-500">{plan.id} · {plan.version}</div>
          <div className="text-sm font-semibold text-slate-100">{plan.name}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-semibold ${PLAN_STATUS[plan.status]}`}>{plan.status.replace('_', ' ')}</span>
          {recommended && <span className="text-[10px] font-semibold text-cyan-300">RECOMMENDED</span>}
        </div>
      </div>
      <table className="mt-2 w-full text-[11px]">
        <tbody>
          {plan.lines.map(l => (
            <tr key={l.supplier_id} className="text-slate-300">
              <td className="py-0.5">{l.label} <span className="text-slate-500">· {l.supplier_name}</span></td>
              <td className="py-0.5 text-right font-mono">{l.quantity} × {fmtMoney(l.unit_price)}</td>
            </tr>
          ))}
          {plan.lines.length === 0 && <tr><td className="py-1 text-slate-500">No supplier lines</td></tr>}
        </tbody>
      </table>
      <div className="mt-2 grid grid-cols-3 gap-2 border-t border-slate-800 pt-2 text-[11px]">
        <div><div className="text-slate-500">Quantity</div><div className="font-mono text-slate-200">{plan.quantity}</div></div>
        <div><div className="text-slate-500">Arrives</div><div className="font-mono text-slate-200">{plan.max_lead_days ? `${plan.max_lead_days} d` : '—'}</div></div>
        <div><div className="text-slate-500">Total</div><div className="font-mono text-slate-200">{fmtMoney(plan.total)}{plan.freight_missing ? ' + freight' : ''}</div></div>
      </div>
      {plan.reasons.length + plan.uncertainties.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[11px] text-slate-400">
          {plan.reasons.map(x => <li key={x}>• {x}</li>)}
          {plan.uncertainties.map(x => <li key={x} className="text-sky-300/80">? {x}</li>)}
        </ul>
      )}
    </button>
  )
}

export function ApprovalWorkspace({ plans, recommendedId, round, onDecide }: {
  plans: RecoveryPlan[]
  recommendedId: string | null
  round: number
  onDecide: (d: 'approved' | 'rejected' | 'more_info', planId: string | null, comment: string) => void
}) {
  const [planId, setPlanId] = useState<string | null>(recommendedId)
  const [comment, setComment] = useState('')
  const plan = plans.find(p => p.id === planId) ?? null
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}
      className="flex max-h-full w-full max-w-[940px] flex-col overflow-hidden rounded-2xl border border-amber-400/30 bg-[#0d1729]/95 shadow-2xl shadow-black/50" role="dialog" aria-label="Procurement approval">
      <div className="border-b border-slate-800 px-5 py-4">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-amber-300"><ShieldAlert className="h-4 w-4" />Human approval required · SIMULATED APPROVAL</div>
        <h3 className="mt-1 text-lg font-semibold text-slate-50">Choose a recovery plan version {round > 1 && <span className="text-sm font-normal text-slate-400">· round {round}</span>}</h3>
        <p className="text-xs text-slate-400">The decision is bound to the exact plan version. Procurement drafts only run after approval and are never executed.</p>
      </div>
      <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto p-5 md:grid-cols-3">
        {plans.map(p => <PlanCard key={p.id} plan={p} selected={p.id === planId} recommended={p.id === recommendedId} onSelect={() => setPlanId(p.id)} />)}
      </div>
      <div className="flex flex-wrap items-end gap-3 border-t border-slate-800 px-5 py-4">
        <label className="min-w-[240px] flex-1 text-xs text-slate-400">
          Approver comment
          <input value={comment} onChange={e => setComment(e.target.value)} placeholder="e.g. Verify Supplier C manufacturer approval before dispatch"
            className="mt-1 w-full rounded-lg border border-slate-700 bg-[#081120] px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-cyan-500/60" />
        </label>
        <button type="button" onClick={() => onDecide('more_info', planId, comment)} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">Request info</button>
        <button type="button" onClick={() => onDecide('rejected', planId, comment)} className="rounded-lg border border-rose-500/40 px-3 py-2 text-sm text-rose-300 hover:bg-rose-500/10">Reject</button>
        <button type="button" disabled={!plan || plan.status === 'BLOCKED'} onClick={() => onDecide('approved', planId, comment)}
          className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-40">
          Approve {plan ? plan.id : ''}
        </button>
      </div>
    </motion.div>
  )
}

// ── Timeline ────────────────────────────────────────────

export function Timeline({ events, onPick }: { events: SimEvent[]; onPick: (agent: AgentId) => void }) {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  useEffect(() => { if (el) el.scrollTop = el.scrollHeight }, [events.length, el])
  return (
    <div ref={setEl} className="h-full space-y-1 overflow-y-auto pr-1">
      {events.length === 0 && <div className="py-8 text-center text-xs text-slate-500">Events appear here once the simulation starts</div>}
      {events.map(e => {
        const tone = e.status === 'failed' ? 'text-rose-300' : e.status === 'blocked' || e.status === 'warning' || e.status === 'waiting' || e.status === 'rejected' ? 'text-amber-200' : e.status === 'completed' || e.status === 'approved' ? 'text-emerald-300' : 'text-slate-300'
        return (
          <motion.button type="button" key={e.event_id} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} onClick={() => onPick(e.agent_id)}
            className="flex w-full gap-2 rounded px-1.5 py-1 text-left hover:bg-slate-800/60">
            <span className="shrink-0 font-mono text-[10px] text-slate-500">{fmtClock(e.t)}</span>
            <span className="min-w-0">
              <span className="mr-1.5 font-mono text-[10px] text-cyan-300/70">{e.event_type}</span>
              <span className={`text-[11.5px] leading-snug ${tone}`}>{e.message}</span>
            </span>
          </motion.button>
        )
      })}
    </div>
  )
}

// ── Recovery workspace + summary ────────────────────────

export function useOutcome(snap: SimSnapshot) {
  return useMemo(() => {
    const get = (k: StepKey) => snap.steps.find(s => s.key === k)?.result?.output as Record<string, unknown> | undefined
    const inv = get('inventory') as { required?: number; available?: number; shortage?: number; reserved?: number; quarantined?: number; on_hand?: number } | undefined
    const plannerOut = get('recovery_planner') as { plans?: RecoveryPlan[]; selected_plan_id?: string | null } | undefined
    const po = get('po_draft') as { drafts?: { po: string; supplier: string; quantity: number; total: number }[]; total?: number } | undefined
    const del = get('delivery') as { expected?: number; received?: number; remaining?: number; status?: string; exceptions?: string[] } | undefined
    const quotes = get('collect_responses') as { quotations?: { label: string; supplier_name?: string; quantity: number; unit_price: number; lead_time_days: number; freight: number | null; quality_docs: string }[] } | undefined
    const jobs = get('job_impact') as { jobs?: { job_id: string; machine: string; priority: string; required: number; covered: number; uncovered: number; deadline_days?: number }[] } | undefined
    const troubled = snap.steps.filter(s => s.status === 'blocked' || s.status === 'failed')
    return { inv, jobs: jobs?.jobs ?? [], plans: plannerOut?.plans ?? [], selected: plannerOut?.selected_plan_id ?? null, po, del, quotes: quotes?.quotations ?? [], troubled }
  }, [snap.steps])
}

export function FinalSummary({ snap }: { snap: SimSnapshot }) {
  const o = useOutcome(snap)
  const a = snap.approval
  const approvedPlan = o.plans.find(p => p.id === a.planId)
  const headline = o.troubled.length
    ? `Workflow stopped with exceptions: ${o.troubled.map(s => `${agentById(s.agent).name} ${s.status}`).join(', ')}.`
    : a.decision === 'rejected' ? 'Plan rejected by the approver. No purchase-order drafts were prepared.'
    : a.decision === 'approved' ? `${approvedPlan?.name ?? a.planId} approved; drafts prepared and delivery tracked.`
    : 'Workflow finished.'
  const rows: [string, string][] = [
    ['Shortage', o.inv ? `${o.inv.shortage} units (${o.inv.available} usable of ${o.inv.required})` : 'Not determined'],
    ['Approval', a.decision ? `${a.decision.replace('_', ' ')}${a.planVersion ? ` · ${a.planVersion}` : ''} (SIMULATED)` : 'Not reached'],
    ['Purchase orders', o.po?.drafts ? `${o.po.drafts.map(d => d.po).join(', ')} · ${fmtMoney(o.po.total ?? 0)} · DRAFT, NOT EXECUTED` : 'None prepared'],
    ['Delivery', o.del?.expected != null ? `${o.del.received} of ${o.del.expected} received · ${o.del.status?.replace('_', ' ')}` : snap.steps.find(s => s.key === 'delivery')?.status === 'failed' ? 'Unknown: tracking unavailable' : 'Not started'],
    ['Exceptions', [...(o.del?.exceptions ?? []), ...o.troubled.flatMap(s => s.result?.errors.length ? s.result.errors : [s.blockedReason ?? ''])].filter(Boolean).join(' · ') || 'None'],
  ]
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={`rounded-xl border p-4 ${o.troubled.length ? 'border-amber-500/40 bg-amber-500/5' : 'border-emerald-500/30 bg-emerald-500/5'}`}>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        {o.troubled.length ? <AlertTriangle className="h-4 w-4 text-amber-300" /> : <CheckCircle2 className="h-4 w-4 text-emerald-300" />}
        Coordinator final summary
      </div>
      <p className="mt-1 text-sm font-medium text-slate-100">{headline}</p>
      <dl className="mt-3 grid gap-1.5 text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[110px_1fr] gap-2">
            <dt className="text-slate-500">{k}</dt><dd className="text-slate-200">{v}</dd>
          </div>
        ))}
      </dl>
    </motion.div>
  )
}

export function StepList({ snap, onPick }: { snap: SimSnapshot; onPick: (k: StepKey) => void }) {
  return (
    <ol className="space-y-0.5">
      {snap.steps.map(s => {
        const icon = s.status === 'done' ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
          : s.status === 'running' ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-cyan-300" />
          : s.status === 'waiting' ? <Clock3 className="h-3.5 w-3.5 shrink-0 text-amber-300" />
          : s.status === 'failed' ? <XCircle className="h-3.5 w-3.5 shrink-0 text-rose-400" />
          : s.status === 'blocked' ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
          : <Circle className="h-3.5 w-3.5 shrink-0 text-slate-600" />
        return (
          <li key={s.key}>
            <button type="button" disabled={s.status === 'pending'} onClick={() => onPick(s.key)}
              className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-slate-800/60 disabled:cursor-default disabled:hover:bg-transparent">
              {icon}
              <span className={`shrink-0 ${s.status === 'pending' ? 'text-slate-500' : 'text-slate-200'}`}>{agentById(s.agent).name}</span>
              <span className="truncate text-slate-500">· {s.task?.replace(/_/g, ' ') ?? 'approval'}</span>
              {s.startedAt != null && <span className="ml-auto shrink-0 font-mono text-[10px] text-slate-500">{fmtClock(s.startedAt)}</span>}
            </button>
          </li>
        )
      })}
    </ol>
  )
}

export { AnimatePresence }
