import { can, ROLE_LABELS, type TwinAction } from './roles'
import {
  ProviderError,
  type Actor,
  type ConnectionState,
  type TwinDataProvider,
} from './provider'
import {
  applyToDisruptions,
  applyToEquipment,
  applyToInventory,
  applyToLayout,
  applyToRecovery,
  applyToShipments,
  emptyRecoveryBundle,
  recoveryEventDisruptionId,
} from './reducers'
import {
  createDisruptionInputSchema,
  decisionInputSchema,
  twinEventSchema,
  type AuditEvent,
  type CreateDisruptionInput,
  type DecisionInput,
  type Disruption,
  type Equipment,
  type InventoryLot,
  type RecoveryBundle,
  type Shipment,
  type TwinEvent,
  type WarehouseLayout,
} from './schemas'
import { materializeEvent, type Scenario, type ScenarioStep } from '../scenarios'

export type SimRunStatus = 'loading' | 'idle' | 'running' | 'paused' | 'awaiting_approval' | 'completed' | 'rejected'

export interface SimState {
  status: SimRunStatus
  scenarioId: string | null
  scenarioTitle: string | null
  /** Index of the next step to play */
  stepIndex: number
  totalSteps: number
  lastStepLabel: string | null
  nextStepLabel: string | null
}

interface SimData {
  layout: WarehouseLayout
  inventory: InventoryLot[]
  shipments: Shipment[]
  equipment: Equipment[]
  audit: AuditEvent[]
  disruptions: Disruption[]
  recovery: Map<string, RecoveryBundle>
}

export interface SimulationProviderOptions {
  /** Artificial response latency, so loading states are exercised. */
  latencyMs?: number
  /** Multiplier on scenario step delays (2 = twice as fast). */
  speed?: number
  now?: () => Date
}

const clone = <T,>(v: T): T => structuredClone(v)

/**
 * In-browser mock of the StockRescue backend, driven by a scenario file.
 * Implements the same contract as the LIVE provider; it validates and
 * authorises requests the way the server is expected to.
 */
export class SimulationProvider implements TwinDataProvider {
  readonly mode = 'simulation' as const

  private readonly loadScenario: () => Promise<Scenario>
  private readonly latencyMs: number
  private readonly speed: number
  private readonly now: () => Date

  private scenario: Scenario | null = null
  private loading: Promise<void> | null = null
  private data: SimData | null = null
  private stepIndex = 0
  private status: SimRunStatus = 'loading'
  private lastStepLabel: string | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private auditSeq = 0
  private snapshot: SimState = this.computeSimState()

  private readonly listeners = new Set<(e: TwinEvent) => void>()
  private readonly connectionListeners = new Set<(s: ConnectionState) => void>()
  private readonly simListeners = new Set<(s: SimState) => void>()
  private readonly resetListeners = new Set<() => void>()

  constructor(loadScenario: () => Promise<Scenario>, options: SimulationProviderOptions = {}) {
    this.loadScenario = loadScenario
    this.latencyMs = options.latencyMs ?? 160
    this.speed = options.speed ?? 1
    this.now = options.now ?? (() => new Date())
  }

  // ── Lifecycle ──────────────────────────────────────────

  private ready(): Promise<void> {
    if (!this.loading) {
      this.loading = this.loadScenario().then(scenario => {
        this.scenario = scenario
        this.resetData()
        this.status = 'idle'
        this.emitConnection()
        this.emitSim()
      })
      this.loading.catch(() => {
        this.loading = null
      })
    }
    return this.loading
  }

  private resetData() {
    if (!this.scenario) return
    const init = clone(this.scenario.initialState)
    this.data = {
      ...init,
      recovery: new Map(init.recovery.map(b => [b.disruptionId, b])),
    }
    this.stepIndex = 0
    this.lastStepLabel = null
    this.auditSeq = 0
  }

  private async read<T>(fn: (d: SimData) => T): Promise<T> {
    await this.ready()
    if (this.latencyMs > 0) await new Promise(r => setTimeout(r, this.latencyMs))
    if (!this.data) throw new ProviderError('server', 'Simulation data is not loaded', 'simulation')
    return clone(fn(this.data))
  }

  // ── Reads ──────────────────────────────────────────────

  getLayout() { return this.read(d => d.layout) }
  getInventory() { return this.read(d => d.inventory) }
  getShipments() { return this.read(d => d.shipments) }
  getEquipment() { return this.read(d => d.equipment) }
  getDisruptions() { return this.read(d => d.disruptions) }
  getAudit() { return this.read(d => [...d.audit].sort((a, b) => b.at.localeCompare(a.at))) }

  searchInventory(sku: string) {
    const q = sku.trim().toUpperCase()
    return this.read(d => (q ? d.inventory.filter(l => l.sku.toUpperCase().includes(q)) : []))
  }

  async getRecovery(disruptionId: string): Promise<RecoveryBundle> {
    return this.read(d => {
      if (!d.disruptions.some(x => x.id === disruptionId)) {
        throw new ProviderError('server', `Disruption ${disruptionId} not found`, `/api/recovery/${disruptionId}`, 404)
      }
      return d.recovery.get(disruptionId) ?? emptyRecoveryBundle(disruptionId)
    })
  }

  // ── Writes ─────────────────────────────────────────────

  private authorize(actor: Actor, action: TwinAction, endpoint: string) {
    if (!can(actor.role, action)) {
      throw new ProviderError(
        'forbidden',
        `Your role (${ROLE_LABELS[actor.role]}) is not permitted to ${action.replace('_', ' ')}.`,
        endpoint,
        403,
      )
    }
  }

  async createDisruption(input: CreateDisruptionInput, actor: Actor): Promise<Disruption> {
    const endpoint = '/api/disruptions'
    await this.ready()
    this.authorize(actor, 'create_disruption', endpoint)
    const parsed = createDisruptionInputSchema.safeParse(input)
    if (!parsed.success) throw new ProviderError('invalid', parsed.error.message, endpoint, 422)
    const d = this.requireData()

    const lots = d.inventory.filter(l => l.sku === parsed.data.sku && l.status !== 'quarantine')
    if (lots.length === 0) {
      throw new ProviderError('invalid', `SKU ${parsed.data.sku} has no inventory record in this warehouse`, endpoint, 422)
    }
    const available = lots.reduce((n, l) => n + l.qty, 0)
    const nowIso = this.now().toISOString()
    const disruption: Disruption = {
      id: `DSR-SIM-${String(d.disruptions.length + 1).padStart(4, '0')}`,
      sku: parsed.data.sku,
      description: lots[0].description,
      failedSupplier: { id: parsed.data.failedSupplierId, name: parsed.data.failedSupplierId },
      reason: parsed.data.reason,
      requiredQty: parsed.data.requiredQty,
      availableQty: available,
      unit: lots[0].unit,
      deadline: parsed.data.deadline,
      budget: parsed.data.budget,
      affectedJobs: [],
      shortages: [{
        sku: parsed.data.sku,
        description: lots[0].description,
        requiredQty: parsed.data.requiredQty,
        availableQty: available,
        gapQty: Math.max(0, parsed.data.requiredQty - available),
        unit: lots[0].unit,
      }],
      status: 'open',
      createdAt: nowIso,
    }
    this.dispatch({ type: 'disruption.created', disruption, at: nowIso })
    this.audit(actor.id, 'disruption.created', 'disruption', disruption.id, `Reported ${parsed.data.sku} supplier failure`)
    return clone(disruption)
  }

  async analyzeRecovery(disruptionId: string, actor: Actor): Promise<void> {
    const endpoint = `/api/recovery/${disruptionId}/analyze`
    await this.ready()
    this.authorize(actor, 'analyze_recovery', endpoint)
    const d = this.requireData()
    if (!d.disruptions.some(x => x.id === disruptionId)) {
      throw new ProviderError('server', `Disruption ${disruptionId} not found`, endpoint, 404)
    }
    // Only the scenario's own disruption has scripted agent output; never invent analysis.
    const nowIso = this.now().toISOString()
    this.dispatch({
      type: 'agent.step',
      at: nowIso,
      run: {
        id: `RUN-SIM-${disruptionId}`,
        disruptionId,
        agent: 'Simulation',
        step: 'No scripted analysis',
        status: 'failed',
        trace: [`The loaded scenario has no scripted agent output for ${disruptionId}. Connect LIVE mode for real analysis.`],
      },
    })
  }

  async approveRecovery(disruptionId: string, input: DecisionInput, actor: Actor): Promise<void> {
    await this.decide(disruptionId, input, actor, 'approved')
  }

  async rejectRecovery(disruptionId: string, input: DecisionInput, actor: Actor): Promise<void> {
    await this.decide(disruptionId, input, actor, 'rejected')
  }

  private async decide(disruptionId: string, input: DecisionInput, actor: Actor, decision: 'approved' | 'rejected') {
    const endpoint = `/api/recovery/${disruptionId}/${decision === 'approved' ? 'approve' : 'reject'}`
    await this.ready()
    this.authorize(actor, decision === 'approved' ? 'approve' : 'reject', endpoint)
    const parsed = decisionInputSchema.safeParse(input)
    if (!parsed.success) throw new ProviderError('invalid', parsed.error.issues[0]?.message ?? 'Invalid decision', endpoint, 422)

    const d = this.requireData()
    const bundle = d.recovery.get(disruptionId)
    const plan = bundle?.plan
    if (!plan || plan.status !== 'awaiting_approval') {
      throw new ProviderError('server', 'There is no recovery plan awaiting approval for this disruption', endpoint, 409)
    }
    const optionId = decision === 'approved' ? parsed.data.optionId ?? plan.recommendedOptionId : parsed.data.optionId
    if (decision === 'approved' && (!optionId || !plan.options.some(o => o.id === optionId))) {
      throw new ProviderError('invalid', 'Select a recovery option to approve', endpoint, 422)
    }

    const nowIso = this.now().toISOString()
    this.dispatch({
      type: 'approval.changed',
      at: nowIso,
      approval: {
        id: `APR-${plan.id}-${bundle.approvals.length + 1}`,
        planId: plan.id,
        optionId: optionId ?? null,
        approver: actor.id,
        decision,
        comment: parsed.data.comment,
        timestamp: nowIso,
      },
    })
    this.dispatch({ type: 'recovery.updated', at: nowIso, plan: { ...plan, status: decision } })
    const disruption = d.disruptions.find(x => x.id === disruptionId)
    if (disruption) {
      this.dispatch({ type: 'disruption.created', at: nowIso, disruption: { ...disruption, status: decision } })
    }
    this.audit(actor.id, `recovery.${decision}`, 'recovery_plan', plan.id,
      `${decision === 'approved' ? 'Approved' : 'Rejected'}${optionId ? ` ${optionId}` : ''}: ${parsed.data.comment}`)

    if (this.status !== 'awaiting_approval') return
    if (decision === 'rejected') {
      this.status = 'rejected'
      this.stepIndex = this.scenario?.steps.length ?? this.stepIndex
      this.emitSim()
      return
    }
    if (optionId !== plan.recommendedOptionId) {
      // The scenario scripts fulfilment for its recommended option only.
      this.status = 'completed'
      this.lastStepLabel = `Approved ${optionId}; scenario has no scripted fulfilment for this option`
      this.stepIndex = this.scenario?.steps.length ?? this.stepIndex
      this.emitSim()
      return
    }
    this.stepIndex += 1 // pass the approval gate
    this.status = 'running'
    this.emitSim()
    this.schedule()
  }

  // ── Scenario engine ────────────────────────────────────

  async start() {
    await this.ready()
    if (this.status === 'running' || this.status === 'awaiting_approval') return
    if (this.status === 'completed' || this.status === 'rejected') return
    this.status = 'running'
    this.emitSim()
    this.schedule()
  }

  pause() {
    if (this.status !== 'running') return
    this.clearTimer()
    this.status = 'paused'
    this.emitSim()
  }

  async step() {
    await this.ready()
    if (this.status === 'awaiting_approval' || this.status === 'completed' || this.status === 'rejected') return
    this.clearTimer()
    this.status = 'paused'
    this.playNext()
  }

  async reset() {
    await this.ready()
    this.clearTimer()
    this.resetData()
    this.status = 'idle'
    this.emitSim()
    this.resetListeners.forEach(l => l())
  }

  /** Stable snapshot (same object until the state changes), for useSyncExternalStore. */
  /**
   * Inventory after the scenario's scripted run (recommended option approved),
   * replayed on a copy of the initial state. Used for the labelled After view.
   */
  async getRecordedOutcome(): Promise<InventoryLot[]> {
    await this.ready()
    if (!this.scenario) return []
    let inventory = clone(this.scenario.initialState.inventory)
    const probe = this.now().toISOString()
    for (const step of this.scenario.steps) {
      for (const raw of step.events) {
        const event = materializeEvent(raw, probe)
        inventory = applyToInventory(inventory, event) ?? inventory
      }
    }
    return inventory
  }

  getSimState(): SimState {
    return this.snapshot
  }

  private computeSimState(): SimState {
    const steps = this.scenario?.steps ?? []
    return {
      status: this.status,
      scenarioId: this.scenario?.id ?? null,
      scenarioTitle: this.scenario?.title ?? null,
      stepIndex: this.stepIndex,
      totalSteps: steps.length,
      lastStepLabel: this.lastStepLabel,
      nextStepLabel: steps[this.stepIndex]?.label ?? null,
    }
  }

  subscribeSim(listener: (s: SimState) => void): () => void {
    this.simListeners.add(listener)
    void this.ready()
    return () => this.simListeners.delete(listener)
  }

  /** Fires after reset(), so consumers can refetch everything. */
  subscribeReset(listener: () => void): () => void {
    this.resetListeners.add(listener)
    return () => this.resetListeners.delete(listener)
  }

  private schedule() {
    this.clearTimer()
    if (this.status !== 'running' || !this.scenario) return
    const next = this.scenario.steps[this.stepIndex]
    if (!next) return
    this.timer = setTimeout(() => {
      this.timer = null
      if (this.status !== 'running') return
      this.playNext()
      if (this.status === 'running') this.schedule()
    }, next.delayMs / this.speed)
  }

  private playNext() {
    const step = this.scenario?.steps[this.stepIndex]
    if (!step) return
    if (step.gate === 'approval') {
      this.clearTimer()
      this.status = 'awaiting_approval'
      this.lastStepLabel = step.label
      this.emitSim()
      return
    }
    this.playStep(step)
    this.stepIndex += 1
    this.lastStepLabel = step.label
    if (this.stepIndex >= (this.scenario?.steps.length ?? 0)) {
      this.clearTimer()
      this.status = 'completed'
    }
    this.emitSim()
  }

  private playStep(step: ScenarioStep) {
    const nowIso = this.now().toISOString()
    for (const raw of step.events) this.dispatch(materializeEvent(raw, nowIso))
    if (step.audit) {
      this.audit(step.audit.actor, step.audit.action, step.audit.entity, step.audit.entityId, step.audit.detail)
    }
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  // ── State & events ─────────────────────────────────────

  private requireData(): SimData {
    if (!this.data) throw new ProviderError('server', 'Simulation data is not loaded', 'simulation')
    return this.data
  }

  private dispatch(event: TwinEvent) {
    const validated = twinEventSchema.parse(event)
    const d = this.requireData()
    d.inventory = applyToInventory(d.inventory, validated) ?? d.inventory
    d.disruptions = applyToDisruptions(d.disruptions, validated) ?? d.disruptions
    d.shipments = applyToShipments(d.shipments, validated) ?? d.shipments
    d.equipment = applyToEquipment(d.equipment, validated) ?? d.equipment
    d.layout = applyToLayout(d.layout, validated) ?? d.layout

    const plans = [...d.recovery.values()].flatMap(b => (b.plan ? [b.plan] : []))
    const disruptionId = recoveryEventDisruptionId(validated, plans)
    if (disruptionId) {
      const bundle = d.recovery.get(disruptionId) ?? emptyRecoveryBundle(disruptionId)
      d.recovery.set(disruptionId, applyToRecovery(bundle, validated) ?? bundle)
    }
    this.listeners.forEach(l => l(clone(validated)))
  }

  private audit(actor: string, action: string, entity: string, entityId: string, detail: string) {
    const d = this.requireData()
    this.auditSeq += 1
    d.audit.push({
      id: `AUD-SIM-${this.auditSeq}`,
      at: this.now().toISOString(),
      actor,
      action,
      entity,
      entityId,
      detail,
    })
  }

  subscribe(listener: (event: TwinEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  subscribeConnection(listener: (state: ConnectionState) => void): () => void {
    this.connectionListeners.add(listener)
    listener(this.getConnectionState())
    void this.ready()
    return () => this.connectionListeners.delete(listener)
  }

  getConnectionState(): ConnectionState {
    return this.scenario ? 'open' : 'connecting'
  }

  private emitConnection() {
    const s = this.getConnectionState()
    this.connectionListeners.forEach(l => l(s))
  }

  private emitSim() {
    this.snapshot = this.computeSimState()
    const s = this.snapshot
    this.simListeners.forEach(l => l(s))
  }

  dispose() {
    this.clearTimer()
    this.listeners.clear()
    this.connectionListeners.clear()
    this.simListeners.clear()
    this.resetListeners.clear()
  }
}
