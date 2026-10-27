import { create } from 'zustand'
import {
  agentById,
  AGENTS,
  executeTask,
  SCENARIOS,
  buildCase,
  type AgentId,
  type AgentState,
  type ExecContext,
  type RecoveryPlan,
  type ScenarioDef,
  type ScenarioId,
  type SimCase,
  type TaskResult,
  type TaskType,
} from './model'

// Simulation engine: a dependency-driven state machine on a virtual clock.
// Every transition is computed here and published as an event; React only
// renders snapshots. One interval drives the clock and is cancelled on
// pause, restart and dispose, so re-renders never restart the workflow.

type StepKey =
  | 'intake' | 'inventory' | 'job_impact' | 'review' | 'supplier_discovery' | 'enquiry_drafts'
  | 'collect_responses' | 'compatibility' | 'quote_risk' | 'recovery_planner' | 'approval'
  | 'clarification' | 'po_draft' | 'delivery' | 'final_summary'

interface StepDef {
  key: StepKey
  agent: AgentId
  task: TaskType | null
  deps: StepKey[]
  /** Runs even if a dependency was blocked or failed (summary steps) */
  settles?: boolean
}

const STEPS: StepDef[] = [
  { key: 'intake', agent: 'coordinator', task: 'intake', deps: [] },
  { key: 'inventory', agent: 'inventory_bom', task: 'inventory', deps: ['intake'] },
  { key: 'job_impact', agent: 'job_impact', task: 'job_impact', deps: ['intake'] },
  { key: 'review', agent: 'coordinator', task: 'review', deps: ['inventory', 'job_impact'], settles: true },
  { key: 'supplier_discovery', agent: 'supplier_sourcing', task: 'supplier_discovery', deps: ['review'] },
  { key: 'enquiry_drafts', agent: 'vendor_communication', task: 'enquiry_drafts', deps: ['supplier_discovery'] },
  { key: 'collect_responses', agent: 'coordinator', task: 'collect_responses', deps: ['enquiry_drafts'] },
  { key: 'compatibility', agent: 'supplier_sourcing', task: 'compatibility', deps: ['collect_responses'] },
  { key: 'quote_risk', agent: 'quote_planning', task: 'quote_risk', deps: ['compatibility'] },
  { key: 'recovery_planner', agent: 'quote_planning', task: 'recovery_planner', deps: ['quote_risk'] },
  { key: 'approval', agent: 'procurement', task: null, deps: ['recovery_planner'] },
  { key: 'po_draft', agent: 'procurement', task: 'po_draft', deps: ['approval'] },
  { key: 'delivery', agent: 'delivery_watch', task: 'delivery', deps: ['po_draft'] },
  { key: 'final_summary', agent: 'coordinator', task: 'final_summary', deps: ['delivery'], settles: true },
]

const ACTIVATION_MS = 450
const INPUT_MS = 350
const RESPONSE_MS = 500

export type StepStatus = 'pending' | 'running' | 'done' | 'blocked' | 'failed' | 'skipped' | 'waiting'

export interface StepRun {
  key: StepKey
  agent: AgentId
  task: TaskType | null
  status: StepStatus
  startedAt: number | null
  endedAt: number | null
  /** Number of stages completed */
  stageDone: number
  phase: AgentState
  result: TaskResult | null
  activatedBy: AgentId | null
  reason: string
  blockedReason: string | null
}

export interface SimEvent {
  event_id: string
  workflow_id: string
  agent_id: AgentId
  task: TaskType | 'approval' | null
  event_type: string
  t: number
  status: string
  message: string
  previous_state: AgentState | null
  new_state: AgentState | null
}

export type Speed = 0.5 | 1 | 2 | 'instant'
export type Mode = 'auto' | 'step'

export interface ApprovalState {
  decision: 'approved' | 'rejected' | 'more_info' | null
  planId: string | null
  planVersion: string | null
  comment: string
  at: number | null
}

export interface SimSnapshot {
  scenarioId: ScenarioId
  caseData: SimCase | null
  status: 'ready' | 'running' | 'paused' | 'waiting_approval' | 'completed' | 'blocked'
  time: number
  speed: Speed
  mode: Mode
  steps: StepRun[]
  events: SimEvent[]
  agentStates: Record<AgentId, AgentState>
  approval: ApprovalState
  /** Step currently in focus for the execution panel */
  focus: StepKey | null
  /** Edges with a message in flight: coordinator ⇄ agent */
  flights: { from: AgentId; to: AgentId; key: string }[]
}

const initialAgentStates = () => Object.fromEntries(AGENTS.map(a => [a.id, 'IDLE'])) as Record<AgentId, AgentState>

function reasonFor(key: StepKey, results: ExecContext['results']): string {
  const inv = results.inventory?.output as { shortage?: number } | undefined
  const ji = results.job_impact?.output as { affected?: number } | undefined
  switch (key) {
    case 'intake': return 'A recovery case was opened for a component whose demand exceeds stock. The Coordinator validates it and decides which specialists are needed.'
    case 'inventory': return 'The Coordinator needs verified inventory before any sourcing decision: usable stock, reservations and quarantine must be reconciled.'
    case 'job_impact': return 'Runs in parallel with Inventory/BOM: the Coordinator needs to know which repair jobs and deadlines the shortage puts at risk.'
    case 'review': return 'Both specialist results arrived; the Coordinator validates them before routing the case onward.'
    case 'supplier_discovery': return `Inventory/BOM confirmed a shortage of ${inv?.shortage ?? '—'} units and Job Impact found ${ji?.affected ?? '—'} affected jobs. Supplier Sourcing looks for alternative suppliers.`
    case 'enquiry_drafts': return 'Candidate suppliers were discovered but their availability is unconfirmed. Vendor Communication prepares enquiry drafts.'
    case 'collect_responses': return 'Enquiries are drafted; the Coordinator correlates the (simulated) supplier quotations to the case.'
    case 'compatibility': return 'Quotations arrived; Supplier Sourcing verifies each offered part against the required specification before it can be planned.'
    case 'quote_risk': return 'Compatibility evidence is available; Quote & Planning validates quantities, prices, freight, lead times and documentation.'
    case 'recovery_planner': return 'Validated quotes and constraints are ready; Quote & Planning builds and ranks recovery plans.'
    case 'approval': return 'A recovery plan is ready. A human approver must decide before any procurement draft is prepared.'
    case 'clarification': return 'The approver asked for more information; Vendor Communication drafts clarification requests.'
    case 'po_draft': return 'The approver approved a specific plan version. Procurement prepares purchase-order drafts without executing them.'
    case 'delivery': return 'Purchase-order drafts exist; Delivery Watch reads the recorded delivery events for the approved suppliers.'
    case 'final_summary': return 'All dependent work has settled; the Coordinator assembles the recovery outcome.'
  }
}

export class SimulationEngine {
  private snap: SimSnapshot
  private base: SimCase | null = null
  private scenario: ScenarioDef = SCENARIOS[0]
  private timer: ReturnType<typeof setInterval> | null = null
  private last = 0
  private seq = 0
  private autoRejectAt: number | null = null
  private readonly onChange: (s: SimSnapshot) => void

  constructor(onChange: (s: SimSnapshot) => void) {
    this.onChange = onChange
    this.snap = this.fresh('normal')
  }

  private fresh(scenarioId: ScenarioId): SimSnapshot {
    return {
      scenarioId,
      caseData: this.base ? buildCase(this.base, SCENARIOS.find(s => s.id === scenarioId)!) : null,
      status: 'ready', time: 0, speed: this.snap?.speed ?? 1, mode: this.snap?.mode ?? 'auto',
      steps: STEPS.map(d => ({ key: d.key, agent: d.agent, task: d.task, status: 'pending', startedAt: null, endedAt: null, stageDone: 0, phase: 'IDLE', result: null, activatedBy: null, reason: '', blockedReason: null })),
      events: [], agentStates: initialAgentStates(),
      approval: { decision: null, planId: null, planVersion: null, comment: '', at: null },
      focus: null, flights: [],
    }
  }

  get snapshot() { return this.snap }

  setBase(c: SimCase) {
    this.base = c
    this.restart()
  }

  setScenario(id: ScenarioId) {
    this.scenario = SCENARIOS.find(s => s.id === id) ?? SCENARIOS[0]
    this.snap.scenarioId = this.scenario.id
    this.restart()
  }

  setSpeed(speed: Speed) {
    this.snap = { ...this.snap, speed }
    this.publish()
  }

  setMode(mode: Mode) {
    this.snap = { ...this.snap, mode }
    if (mode === 'auto' && this.snap.status === 'running') this.ensureTimer()
    this.publish()
  }

  setFocus(key: StepKey | null) {
    this.snap = { ...this.snap, focus: key }
    this.publish()
  }

  start() {
    if (!this.base) return
    if (this.snap.status === 'completed' || this.snap.status === 'blocked') this.restart()
    if (this.snap.status === 'ready') this.emitCaseCreated()
    this.snap = { ...this.snap, status: this.snap.status === 'waiting_approval' ? 'waiting_approval' : 'running' }
    this.advance(0)
    this.ensureTimer()
    this.publish()
  }

  pause() {
    if (this.snap.status !== 'running') return
    this.clearTimer()
    this.snap = { ...this.snap, status: 'paused' }
    this.publish()
  }

  /** Advances to the next meaningful transition (one stage). */
  next() {
    if (!this.base) return
    if (this.snap.status === 'ready') this.emitCaseCreated()
    if (this.snap.status === 'completed' || this.snap.status === 'waiting_approval') return
    const nb = this.nextBoundary()
    if (nb == null) return
    this.clearTimer()
    this.snap = { ...this.snap, status: 'paused' }
    this.advance(Math.max(0, nb - this.snap.time))
    this.publish()
  }

  restart() {
    this.clearTimer()
    this.seq = 0
    this.autoRejectAt = null
    const mode = this.snap.mode
    const speed = this.snap.speed
    this.snap = { ...this.fresh(this.scenario.id), mode, speed }
    this.publish()
  }

  dispose() {
    this.clearTimer()
  }

  decide(decision: 'approved' | 'rejected' | 'more_info', planId: string | null, comment: string) {
    if (this.snap.status !== 'waiting_approval') return
    const plans = this.plans()
    const plan = plans.find(p => p.id === planId) ?? null
    const approval: ApprovalState = { decision, planId: plan?.id ?? null, planVersion: plan?.version ?? null, comment, at: this.snap.time }
    this.snap = { ...this.snap, approval, status: 'running' }
    const gate = this.step('approval')
    this.emit('procurement', 'approval', decision === 'approved' ? 'approval_granted' : decision === 'rejected' ? 'approval_rejected' : 'more_information_requested',
      decision, decision === 'approved' ? `Approver approved ${plan?.id} (version ${plan?.version}). SIMULATED APPROVAL.` : decision === 'rejected' ? `Approver rejected the plan: ${comment || 'no comment'}` : `Approver requested more information: ${comment || 'no comment'}`,
      'WAITING_FOR_APPROVAL', decision === 'more_info' ? 'QUEUED' : 'COMPLETED')
    if (decision === 'more_info') {
      // Clarification round, then the gate waits again
      gate.status = 'pending'
      const clar = this.step('clarification', true)
      Object.assign(clar, { status: 'pending', startedAt: null, endedAt: null, stageDone: 0, phase: 'IDLE', result: null })
    } else {
      gate.status = 'done'
      gate.endedAt = this.snap.time
      if (decision === 'rejected') {
        for (const k of ['po_draft', 'delivery'] as StepKey[]) {
          const s = this.step(k)
          s.status = 'skipped'
          s.blockedReason = 'Plan rejected by approver'
          this.emit(s.agent, s.task, 'agent_skipped', 'skipped', `${agentById(s.agent).name} skipped: plan rejected`, s.phase, 'SKIPPED')
          s.phase = 'SKIPPED'
        }
      }
    }
    this.advance(0)
    this.ensureTimer()
    this.publish()
  }

  /** The planner's plans (empty until it ran). */
  plans(): RecoveryPlan[] {
    return ((this.step('recovery_planner').result?.output as { plans?: RecoveryPlan[] } | undefined)?.plans) ?? []
  }

  // ── internals ──

  private step(key: StepKey, create = false): StepRun {
    let s = this.snap.steps.find(x => x.key === key)
    if (!s && create) {
      s = { key, agent: key === 'clarification' ? 'vendor_communication' : 'coordinator', task: 'clarification_drafts', status: 'pending', startedAt: null, endedAt: null, stageDone: 0, phase: 'IDLE', result: null, activatedBy: null, reason: '', blockedReason: null }
      this.snap.steps.splice(this.snap.steps.findIndex(x => x.key === 'approval'), 0, s)
    }
    return s!
  }

  private deps(key: StepKey): StepKey[] {
    if (key === 'clarification') return []
    if (key === 'approval') {
      const clar = this.snap.steps.find(s => s.key === 'clarification')
      return clar && clar.status !== 'done' ? ['recovery_planner', 'clarification'] : ['recovery_planner']
    }
    return STEPS.find(d => d.key === key)?.deps ?? []
  }

  private ensureTimer() {
    if (this.timer || this.snap.mode === 'step') return
    this.last = performance.now()
    this.timer = setInterval(() => this.tick(), 60)
  }

  private clearTimer() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private tick() {
    if (this.snap.status !== 'running' && this.snap.status !== 'waiting_approval') return this.clearTimer()
    const now = performance.now()
    const dt = now - this.last
    this.last = now
    if (this.snap.status === 'waiting_approval') {
      // Scenario where the approver rejects (automatic mode only)
      if (this.autoRejectAt != null && this.snap.mode === 'auto' && performance.now() >= this.autoRejectAt) {
        this.autoRejectAt = null
        const sel = (this.step('recovery_planner').result?.output as { selected_plan_id?: string } | undefined)?.selected_plan_id ?? null
        this.decide('rejected', sel, 'Budget committee rejected: single-source risk not accepted')
      }
      return
    }
    if (this.snap.speed === 'instant') {
      for (let i = 0; i < 400 && this.snap.status === 'running'; i++) {
        const nb = this.nextBoundary()
        if (nb == null) break
        this.advance(nb - this.snap.time)
      }
    } else {
      this.advance(dt * this.snap.speed)
    }
    this.publish()
  }

  private emitCaseCreated() {
    const c = this.snap.caseData
    if (!c) return
    this.emit('coordinator', null, 'case_created', 'info', `Case ${c.case_id} created: ${c.required_quantity} × ${c.component.sku} required within ${c.deadline_days} days (${this.scenario.title}, SIMULATED)`, null, null)
  }

  private emit(agent: AgentId, task: SimEvent['task'], type: string, status: string, message: string, prev: AgentState | null, next: AgentState | null) {
    this.seq += 1
    this.snap.events = [...this.snap.events, {
      event_id: `evt-${String(this.seq).padStart(3, '0')}`, workflow_id: this.snap.caseData?.case_id ?? '', agent_id: agent, task, event_type: type,
      t: Math.round(this.snap.time), status, message, previous_state: prev, new_state: next,
    }]
  }

  private setPhase(s: StepRun, phase: AgentState, type: string, message: string, status = 'running') {
    if (s.phase === phase) return
    this.emit(s.agent, s.task ?? 'approval', type, status, message, s.phase, phase)
    s.phase = phase
  }

  private timeline(s: StepRun): number[] {
    // [activated, input, stage ends..., response]
    const t0 = s.startedAt ?? 0
    const out = [t0, t0 + ACTIVATION_MS, t0 + ACTIVATION_MS + INPUT_MS]
    let acc = out[2]
    for (const st of s.result?.stages ?? []) {
      acc += st.ms
      out.push(acc)
    }
    out.push(acc + RESPONSE_MS)
    return out
  }

  private nextBoundary(): number | null {
    let best: number | null = null
    if (this.readySteps().length) return this.snap.time
    for (const s of this.snap.steps) {
      if (s.status !== 'running') continue
      for (const b of this.timeline(s)) if (b > this.snap.time + 0.5 && (best == null || b < best)) best = b
    }
    return best
  }

  private settled(k: StepKey) {
    const s = this.snap.steps.find(x => x.key === k)
    return !s || ['done', 'blocked', 'failed', 'skipped'].includes(s.status)
  }

  private readySteps(): StepRun[] {
    return this.snap.steps.filter(s => s.status === 'pending' && this.deps(s.key).every(d => this.settled(d)))
  }

  private ctx(): ExecContext {
    const results: ExecContext['results'] = {}
    for (const s of this.snap.steps) if (s.result && s.task) results[s.task] = s.result
    return { c: this.snap.caseData!, scenario: this.scenario, results, approval: this.snap.approval }
  }

  private advance(dt: number) {
    this.snap = { ...this.snap, time: this.snap.time + dt, steps: this.snap.steps.map(s => ({ ...s })) }
    let guard = 0
    let changed = true
    while (changed && guard++ < 200) {
      changed = false
      for (const s of this.readySteps()) {
        changed = true
        this.startStep(s)
      }
      for (const s of this.snap.steps) if (s.status === 'running' && this.progress(s)) changed = true
    }
    this.refreshDerived()
    const all = this.snap.steps.every(s => this.settled(s.key))
    if (all && this.snap.status !== 'waiting_approval') {
      this.clearTimer()
      const blocked = this.snap.steps.some(s => s.status === 'blocked' || s.status === 'failed')
      if (this.snap.status !== 'completed' && this.snap.status !== 'blocked') {
        this.emit('coordinator', 'final_summary', blocked ? 'workflow_completed_with_exceptions' : 'workflow_completed', blocked ? 'warning' : 'completed',
          blocked ? 'Workflow finished with blocked or failed tasks; see summary.' : 'Workflow completed. Recovery outcome assembled.', null, null)
      }
      this.snap.status = blocked ? 'blocked' : 'completed'
    }
  }

  private startStep(s: StepRun) {
    const failedDep = this.deps(s.key).map(d => this.snap.steps.find(x => x.key === d)).find(d => d && (d.status === 'blocked' || d.status === 'failed' || (d.status === 'skipped' && !STEPS.find(x => x.key === s.key)?.settles)))
    const def = STEPS.find(d => d.key === s.key)
    if (failedDep && !def?.settles) {
      s.status = failedDep.status === 'skipped' ? 'skipped' : 'blocked'
      s.blockedReason = `${agentById(failedDep.agent).name} (${failedDep.key.replace('_', ' ')}) ${failedDep.status}; required input missing`
      this.emit(s.agent, s.task, s.status === 'skipped' ? 'agent_skipped' : 'workflow_blocked', s.status, `${agentById(s.agent).name} ${s.status}: ${s.blockedReason}`, s.phase, s.status === 'skipped' ? 'SKIPPED' : 'BLOCKED')
      s.phase = s.status === 'skipped' ? 'SKIPPED' : 'BLOCKED'
      return
    }
    s.reason = reasonFor(s.key, this.ctx().results)
    s.activatedBy = s.key === 'intake' ? null : 'coordinator'
    if (s.key === 'approval') {
      s.status = 'waiting'
      s.startedAt = this.snap.time
      this.snap.status = 'waiting_approval'
      this.setPhase(s, 'WAITING_FOR_APPROVAL', 'approval_requested', 'Approval requested for the recommended recovery plan (SIMULATED APPROVAL).', 'waiting')
      this.snap.focus = 'approval'
      if (this.scenario.autoReject) this.autoRejectAt = performance.now() + 2500
      return
    }
    s.status = 'running'
    s.startedAt = this.snap.time
    s.result = executeTask(s.task!, this.ctx())
    this.snap.flights = [...this.snap.flights.filter(f => f.to !== s.agent), { from: 'coordinator', to: s.agent, key: `${s.key}-in` }]
    if (s.agent !== 'coordinator') this.emit('coordinator', s.task, 'task_created', 'info', `Coordinator created ${s.task?.replace('_', ' ')} task for ${agentById(s.agent).name}`, null, null)
    this.setPhase(s, 'ACTIVATED', 'agent_activated', s.agent === 'coordinator' ? `Coordinator started ${s.task?.replace('_', ' ')}` : `Coordinator activated ${agentById(s.agent).name}`)
    this.snap.focus = s.key
  }

  /** Emits every transition of a running step that is due. Returns whether anything changed. */
  private progress(s: StepRun): boolean {
    const tl = this.timeline(s)
    const now = this.snap.time + 0.5
    const stages = s.result?.stages ?? []
    let changed = false
    if (now >= tl[1] && s.phase === 'ACTIVATED') {
      this.setPhase(s, 'INPUT_RECEIVED', 'input_received', `${agentById(s.agent).name} received its input payload`)
      changed = true
    }
    if (now >= tl[2] && s.phase === 'INPUT_RECEIVED') {
      this.setPhase(s, 'ANALYZING', 'processing_started', `${agentById(s.agent).name}: ${stages[0]?.label ?? 'processing'}`)
      changed = true
    }
    while (s.stageDone < stages.length && now >= tl[3 + s.stageDone]) {
      const st = stages[s.stageDone]
      s.stageDone += 1
      this.emit(s.agent, s.task, 'stage_completed', 'running', `${agentById(s.agent).name} · ${st.label}: ${st.detail}`, s.phase, s.phase)
      if (s.stageDone === stages.length - 1) this.setPhase(s, 'VALIDATING', 'validation_started', `${agentById(s.agent).name} validating result`)
      changed = true
    }
    if (s.stageDone === stages.length && s.endedAt == null) {
      const r = s.result!
      const final: AgentState = r.status === 'failed' ? 'FAILED' : r.status === 'blocked' ? 'BLOCKED' : 'COMPLETED'
      this.setPhase(s, final, r.status === 'completed' ? 'validation_completed' : r.status === 'failed' ? 'agent_failed' : 'workflow_blocked', `${agentById(s.agent).name}: ${r.summary}${r.errors.length ? ` (${r.errors[0]})` : ''}`, r.status)
      s.endedAt = this.snap.time
      changed = true
    }
    if (s.endedAt != null && now >= tl[tl.length - 1] && s.status === 'running') {
      const r = s.result!
      s.status = r.status === 'failed' ? 'failed' : r.status === 'blocked' ? 'blocked' : 'done'
      if (r.status === 'completed') {
        this.setPhase(s, 'RESPONSE_SENT', 'response_sent', `${agentById(s.agent).name} → Coordinator: ${r.summary}`, 'completed')
        if (s.agent !== 'coordinator') this.snap.flights = [...this.snap.flights.filter(f => f.from !== s.agent), { from: s.agent, to: 'coordinator', key: `${s.key}-out` }]
      }
      changed = true
    }
    return changed
  }

  private refreshDerived() {
    const states = initialAgentStates()
    const ready = new Set(this.readySteps().map(s => s.agent))
    for (const s of this.snap.steps) {
      if (s.status === 'pending') {
        if (ready.has(s.agent) && states[s.agent] === 'IDLE') states[s.agent] = 'QUEUED'
        continue
      }
      states[s.agent] = s.phase
    }
    // Inflight arrows fade once the target agent is busy or done
    this.snap.flights = this.snap.flights.filter(f => {
      const s = this.snap.steps.find(x => `${x.key}-in` === f.key || `${x.key}-out` === f.key)
      if (!s) return false
      return f.key.endsWith('-in') ? s.phase === 'ACTIVATED' || s.phase === 'INPUT_RECEIVED' : this.snap.time - (s.endedAt ?? 0) < 1600
    })
    this.snap.agentStates = states
  }

  private publish() {
    this.onChange({ ...this.snap, steps: this.snap.steps.map(s => ({ ...s })) })
  }
}

interface SimStore {
  snap: SimSnapshot | null
  engine: SimulationEngine | null
  init: () => SimulationEngine
}

export const useSimStore = create<SimStore>((set, get) => ({
  snap: null,
  engine: null,
  init: () => {
    const existing = get().engine
    if (existing) return existing
    const engine = new SimulationEngine(snap => set({ snap }))
    set({ engine, snap: engine.snapshot })
    return engine
  },
}))

export type { StepKey }
