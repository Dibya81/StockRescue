// Live multi-agent simulation: agent registry, scenario fixtures and
// deterministic mock executors. No randomness and no external calls: the same
// scenario always produces the same events and results. Everything here is
// SIMULATED; replace `executeTask` with a backend executor to go live.

export type AgentId =
  | 'coordinator' | 'inventory_bom' | 'job_impact' | 'supplier_sourcing'
  | 'quote_planning' | 'procurement' | 'vendor_communication' | 'delivery_watch'

export type TaskType =
  | 'intake' | 'review' | 'collect_responses' | 'final_summary'
  | 'inventory' | 'job_impact' | 'supplier_discovery' | 'compatibility'
  | 'quote_risk' | 'recovery_planner' | 'po_draft' | 'enquiry_drafts' | 'clarification_drafts' | 'delivery'

export type AgentState =
  | 'IDLE' | 'QUEUED' | 'ACTIVATED' | 'INPUT_RECEIVED' | 'ANALYZING' | 'VALIDATING'
  | 'COMPLETED' | 'RESPONSE_SENT' | 'BLOCKED' | 'FAILED' | 'SKIPPED' | 'WAITING_FOR_APPROVAL'

export interface AgentDef {
  id: AgentId
  number: string
  name: string
  role: string
  identity: string
  responsibility: string
}

export const AGENTS: AgentDef[] = [
  { id: 'coordinator', number: '01', name: 'Coordinator', role: 'Orchestrator', identity: 'stockrescue.coordinator', responsibility: 'Opens the case, creates specialist tasks, validates responses and decides what runs next.' },
  { id: 'inventory_bom', number: '02', name: 'Inventory / BOM', role: 'Specialist', identity: 'stockrescue.inventory_bom', responsibility: 'Reads stock records and BOM demand; calculates usable stock and the uncovered shortage.' },
  { id: 'job_impact', number: '03', name: 'Job Impact', role: 'Specialist', identity: 'stockrescue.job_impact', responsibility: 'Maps the shortage onto repair jobs, deadlines and urgency.' },
  { id: 'supplier_sourcing', number: '04', name: 'Supplier Sourcing', role: 'Discovery + Compatibility', identity: 'stockrescue.supplier_sourcing', responsibility: 'Discovers candidate suppliers, then verifies part, dimension, specification and quality evidence.' },
  { id: 'quote_planning', number: '05', name: 'Quote & Planning', role: 'Quote risk + Planner', identity: 'stockrescue.quote_planning', responsibility: 'Validates quotations and builds deterministic recovery plans with feasibility and blockers.' },
  { id: 'procurement', number: '06', name: 'Procurement', role: 'Specialist', identity: 'stockrescue.procurement', responsibility: 'Validates the approved plan and prepares a purchase-order draft. Never executes a purchase.' },
  { id: 'vendor_communication', number: '07', name: 'Vendor Communication', role: 'Specialist', identity: 'stockrescue.vendor_voice', responsibility: 'Prepares supplier enquiries and clarifications. Messages stay unsent drafts.' },
  { id: 'delivery_watch', number: '08', name: 'Delivery Watch', role: 'Specialist', identity: 'stockrescue.delivery_watch', responsibility: 'Reads recorded delivery events, validates quantities and flags exceptions.' },
]

export const agentById = (id: AgentId) => AGENTS.find(a => a.id === id)!

// ── Scenario fixture (from GET /simulation/scenarios) ─────

export interface Quote {
  supplier_id: string
  supplier_name?: string
  label: string
  quantity: number
  unit_price: number
  lead_time_days: number
  freight: number | null
  quality_docs: 'available' | 'pending' | 'missing'
  manufacturer_approval: 'approved' | 'requires_verification' | 'rejected'
  part_number: string
  dimensions_match: boolean
}

export interface SimCase {
  case_id: string
  component: { sku: string; name: string; spec: Record<string, string | number> }
  required_quantity: number
  reserved_quantity: number
  deadline_days: number
  budget: { amount: number; currency: string }
  stock_records: { location: string; quantity: number; reserved: number; lot: string; note?: string }[]
  jobs: { job_id: string; machine: string; quantity: number; deadline_days: number; priority: 'critical' | 'high' | 'normal'; customer: string }[]
  suppliers?: { supplier_id: string; name: string; location: string; rating: number; on_time_delivery_pct: number }[]
  quotes: Quote[]
  delivery_events: { t: number; event: string; supplier_id?: string; quantity?: number; tracking?: string | null; detail: string }[]
  catalog_supplier_count?: number
  data_source?: string
}

export type ScenarioId =
  | 'normal' | 'quote_missing' | 'insufficient_quantity' | 'deadline_missed' | 'compatibility_unverified'
  | 'quality_missing' | 'no_feasible_plan' | 'approval_rejected' | 'invalid_response' | 'agent_failure'

export interface ScenarioDef {
  id: ScenarioId
  title: string
  description: string
  /** Applies the scenario to a copy of the base case */
  apply: (c: SimCase) => SimCase
  invalidJobImpact?: boolean
  deliveryFailure?: boolean
  autoReject?: boolean
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const quotes = (c: SimCase, fn: (q: Quote, i: number) => Quote | null): SimCase => ({ ...c, quotes: c.quotes.map(fn).filter((q): q is Quote => q !== null) })

export const SCENARIOS: ScenarioDef[] = [
  { id: 'normal', title: 'Critical component shortage', description: 'Standard recovery: three suppliers quote, a split plan is recommended.', apply: c => c },
  { id: 'quote_missing', title: 'Supplier quotation missing', description: 'Supplier B never returns a quotation.', apply: c => quotes(c, q => (q.label === 'Supplier B' ? null : q)) },
  { id: 'insufficient_quantity', title: 'Suppliers cannot cover the quantity', description: 'Combined offers fall short of the 380-unit gap.', apply: c => quotes(c, q => ({ ...q, quantity: q.label === 'Supplier A' ? 120 : q.label === 'Supplier B' ? 0 : 150 })) },
  { id: 'deadline_missed', title: 'Delivery deadline missed', description: 'Every supplier needs longer than the 5-day deadline.', apply: c => quotes(c, q => ({ ...q, lead_time_days: q.lead_time_days + 5 })) },
  { id: 'compatibility_unverified', title: 'Compatibility not verified', description: 'Supplier C cannot evidence the 6205-2RS specification.', apply: c => quotes(c, q => (q.label === 'Supplier C' ? { ...q, dimensions_match: false, manufacturer_approval: 'rejected' } : q)) },
  { id: 'quality_missing', title: 'Quality documentation missing', description: 'No supplier provides certificates of conformity.', apply: c => quotes(c, q => ({ ...q, quality_docs: 'missing' })) },
  { id: 'no_feasible_plan', title: 'No feasible recovery plan', description: 'No supplier has stock of a compatible part.', apply: c => quotes(c, q => ({ ...q, quantity: 0 })) },
  { id: 'approval_rejected', title: 'Procurement approval rejected', description: 'The approver rejects the recommended plan (auto in automatic mode).', apply: c => c, autoReject: true },
  { id: 'invalid_response', title: 'Agent response invalid', description: 'Job Impact returns a payload without deadlines; validation fails.', apply: c => c, invalidJobImpact: true },
  { id: 'agent_failure', title: 'Agent execution failure', description: 'Delivery Watch cannot reach the tracking service.', apply: c => c, deliveryFailure: true },
]

export function buildCase(base: SimCase, scenario: ScenarioDef): SimCase {
  return scenario.apply(clone(base))
}

/** Bundled copy of the database fixture, used only if the API is unreachable. */
export const OFFLINE_CASE: SimCase = {
  case_id: 'SR-2026-001',
  component: { sku: 'SKU-BRG-6205-2RS', name: 'Deep Groove Ball Bearing 6205-2RS', spec: { bore_mm: 25, outer_diameter_mm: 52, width_mm: 15, seal: '2RS rubber, both sides', dynamic_load_kn: 14.8, standard: 'ISO 15:2017' } },
  required_quantity: 500, reserved_quantity: 20, deadline_days: 5, budget: { amount: 210000, currency: 'INR' },
  stock_records: [
    { location: 'A05-R02-L01-P01', quantity: 95, reserved: 15, lot: 'LOT-24-0891' },
    { location: 'A05-R02-L02-P03', quantity: 45, reserved: 5, lot: 'LOT-24-0917' },
    { location: 'QC-HOLD-02', quantity: 20, reserved: 0, lot: 'LOT-24-0933', note: 'Quarantined: corrosion found on outer ring' },
  ],
  jobs: [
    { job_id: 'JOB-RJ-1042', machine: 'Machine A · Kiln drive gearbox', quantity: 220, deadline_days: 3, priority: 'critical', customer: 'Line 2 cement kiln' },
    { job_id: 'JOB-RJ-1047', machine: 'Machine B · Conveyor head pulley', quantity: 180, deadline_days: 5, priority: 'high', customer: 'Raw-mill conveyor' },
    { job_id: 'JOB-RJ-1051', machine: 'Machine C · Cooling fan motor', quantity: 100, deadline_days: 9, priority: 'normal', customer: 'Cooler fan bank' },
  ],
  quotes: [
    { supplier_id: 'SUP-KESTREL-16', supplier_name: 'Kestrel Bearings Pvt Ltd', label: 'Supplier A', quantity: 200, unit_price: 450, lead_time_days: 3, freight: 2500, quality_docs: 'available', manufacturer_approval: 'approved', part_number: '6205-2RS', dimensions_match: true },
    { supplier_id: 'SUP-MERIDIAN-17', supplier_name: 'Meridian Motion Supply', label: 'Supplier B', quantity: 380, unit_price: 420, lead_time_days: 6, freight: null, quality_docs: 'pending', manufacturer_approval: 'approved', part_number: '6205-2RSH', dimensions_match: true },
    { supplier_id: 'SUP-APEXRE-18', supplier_name: 'Apex Rolling Elements', label: 'Supplier C', quantity: 380, unit_price: 480, lead_time_days: 2, freight: 3200, quality_docs: 'available', manufacturer_approval: 'requires_verification', part_number: '6205-2RS C3', dimensions_match: true },
  ],
  delivery_events: [
    { t: 0, event: 'po_draft_created', detail: 'Purchase order draft PO-DRAFT-0412 prepared' },
    { t: 1, event: 'approval_recorded', detail: 'Simulated approval recorded against plan version' },
    { t: 2, event: 'supplier_ack', supplier_id: 'SUP-KESTREL-16', detail: 'Supplier A acknowledgement simulated' },
    { t: 3, event: 'shipment_dispatched', supplier_id: 'SUP-KESTREL-16', quantity: 200, tracking: 'KST-88-20417', detail: '200 units dispatched' },
    { t: 4, event: 'shipment_dispatched', supplier_id: 'SUP-APEXRE-18', quantity: 180, tracking: null, detail: '180 units dispatched, tracking number not provided' },
    { t: 5, event: 'received', supplier_id: 'SUP-KESTREL-16', quantity: 200, detail: '200 units received at Dock 2' },
  ],
  catalog_supplier_count: 18,
  data_source: 'bundled offline copy of the demo fixture (SIMULATED)',
}

// ── Plans ────────────────────────────────────────────────

export type PlanStatus = 'FEASIBLE' | 'CONDITIONAL' | 'REQUIRES_VERIFICATION' | 'BLOCKED'

export interface PlanLine { supplier_id: string; label: string; supplier_name: string; quantity: number; unit_price: number; line_total: number; freight: number | null; lead_time_days: number }

export interface RecoveryPlan {
  id: string
  version: string
  name: string
  lines: PlanLine[]
  quantity: number
  goods_total: number
  freight_total: number
  total: number
  freight_missing: boolean
  max_lead_days: number
  status: PlanStatus
  reasons: string[]
  uncertainties: string[]
  risk_score: number
}

export interface Compat { supplier_id: string; label: string; status: 'compatible' | 'requires_verification' | 'not_compatible'; checks: { name: string; ok: boolean | null; note: string }[] }

// ── Execution ────────────────────────────────────────────

export interface StageDef { label: string; ms: number; detail: string }

export interface TaskResult {
  status: 'completed' | 'blocked' | 'failed' | 'skipped'
  input: Record<string, unknown>
  output: Record<string, unknown>
  stages: StageDef[]
  warnings: string[]
  errors: string[]
  /** Short sentence for the timeline when the agent finishes */
  summary: string
}

export interface ExecContext {
  c: SimCase
  scenario: ScenarioDef
  results: Partial<Record<string, TaskResult>>
  approval: { decision: 'approved' | 'rejected' | 'more_info' | null; planId: string | null; planVersion: string | null; comment: string }
}

const fmt = (n: number, cur = 'INR') => new Intl.NumberFormat('en-IN', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n)

function usableStock(c: SimCase) {
  const usable = c.stock_records.filter(r => !r.note?.startsWith('Quarantined'))
  const onHand = usable.reduce((n, r) => n + r.quantity, 0)
  const reserved = usable.reduce((n, r) => n + r.reserved, 0)
  const quarantined = c.stock_records.filter(r => r.note?.startsWith('Quarantined')).reduce((n, r) => n + r.quantity, 0)
  return { onHand, reserved, quarantined, available: onHand - reserved }
}

export function compatibility(c: SimCase): Compat[] {
  const base = c.component.sku.replace('SKU-BRG-', '')
  return c.quotes.map(q => {
    const partOk = q.part_number.startsWith(base.replace('-2RS', '')) && q.part_number.includes('2RS')
    const checks = [
      { name: 'Part number', ok: partOk, note: `${q.part_number} vs ${base}` },
      { name: 'Dimensions 25×52×15 mm', ok: q.dimensions_match, note: q.dimensions_match ? 'Datasheet dimensions match' : 'Datasheet dimensions differ' },
      { name: 'Seal type 2RS', ok: q.part_number.includes('2RS'), note: 'Rubber seal both sides' },
      { name: 'Manufacturer approval', ok: q.manufacturer_approval === 'approved' ? true : q.manufacturer_approval === 'rejected' ? false : null, note: q.manufacturer_approval.replace('_', ' ') },
      { name: 'Quality documentation', ok: q.quality_docs === 'available' ? true : q.quality_docs === 'missing' ? false : null, note: `Certificate of conformity ${q.quality_docs}` },
    ]
    const status: Compat['status'] = checks.some(k => k.ok === false) ? 'not_compatible' : checks.some(k => k.ok === null) ? 'requires_verification' : 'compatible'
    return { supplier_id: q.supplier_id, label: q.label, status, checks }
  })
}

export function quoteRisk(c: SimCase, shortage: number) {
  return c.quotes.map(q => {
    const flags: string[] = []
    let risk = 0
    if (q.quantity <= 0) { flags.push('No stock offered'); risk += 0.5 }
    else if (q.quantity < shortage) { flags.push(`Covers ${q.quantity} of ${shortage} units`); risk += 0.15 }
    if (q.freight == null) { flags.push('Freight not quoted'); risk += 0.15 }
    if (q.lead_time_days > c.deadline_days) { flags.push(`Lead time ${q.lead_time_days} d exceeds ${c.deadline_days}-day deadline`); risk += 0.3 }
    if (q.quality_docs !== 'available') { flags.push(`Quality documentation ${q.quality_docs}`); risk += 0.2 }
    if (q.manufacturer_approval !== 'approved') { flags.push(`Manufacturer approval ${q.manufacturer_approval.replace('_', ' ')}`); risk += 0.15 }
    return { supplier_id: q.supplier_id, label: q.label, unit_price: q.unit_price, quantity: q.quantity, lead_time_days: q.lead_time_days, flags, risk: Math.min(1, Math.round(risk * 100) / 100) }
  })
}

/** Plans A/B/C, totals calculated from quote lines, never hardcoded. */
export function buildPlans(c: SimCase, shortage: number, compat: Compat[]): RecoveryPlan[] {
  const byLabel = new Map(c.quotes.map(q => [q.label, q]))
  const compatBy = new Map(compat.map(k => [k.supplier_id, k.status]))
  const defs: { id: string; name: string; parts: [string, number | 'rest' | 'all'][] }[] = [
    { id: 'PLAN-A', name: 'Split sourcing: Supplier A + Supplier C', parts: [['Supplier A', 'all'], ['Supplier C', 'rest']] },
    { id: 'PLAN-B', name: 'Single source: Supplier B', parts: [['Supplier B', 'rest']] },
    { id: 'PLAN-C', name: 'Single source: Supplier C (express)', parts: [['Supplier C', 'rest']] },
  ]
  return defs.map(d => {
    let remaining = shortage
    const lines: PlanLine[] = []
    for (const [label, how] of d.parts) {
      const q = byLabel.get(label)
      if (!q || q.quantity <= 0 || remaining <= 0) continue
      const qty = Math.min(q.quantity, how === 'all' ? q.quantity : remaining, remaining)
      lines.push({ supplier_id: q.supplier_id, label, supplier_name: q.supplier_name ?? q.supplier_id, quantity: qty, unit_price: q.unit_price, line_total: qty * q.unit_price, freight: q.freight, lead_time_days: q.lead_time_days })
      remaining -= qty
    }
    const quantity = lines.reduce((n, l) => n + l.quantity, 0)
    const goods = lines.reduce((n, l) => n + l.line_total, 0)
    const freight = lines.reduce((n, l) => n + (l.freight ?? 0), 0)
    const freightMissing = lines.some(l => l.freight == null)
    const maxLead = lines.reduce((n, l) => Math.max(n, l.lead_time_days), 0)
    const reasons: string[] = []
    const uncertainties: string[] = []
    let status: PlanStatus = 'FEASIBLE'
    const downgrade = (s: PlanStatus) => {
      const order: PlanStatus[] = ['FEASIBLE', 'REQUIRES_VERIFICATION', 'CONDITIONAL', 'BLOCKED']
      if (order.indexOf(s) > order.indexOf(status)) status = s
    }
    if (lines.length === 0) { downgrade('BLOCKED'); reasons.push('No supplier in this plan offers stock') }
    if (quantity < shortage) { downgrade(lines.length ? 'CONDITIONAL' : 'BLOCKED'); reasons.push(`Covers ${quantity} of ${shortage} units`) }
    if (maxLead > c.deadline_days) { downgrade('CONDITIONAL'); reasons.push(`Arrives in ${maxLead} days; deadline is ${c.deadline_days}`) }
    for (const l of lines) {
      const st = compatBy.get(l.supplier_id)
      if (st === 'not_compatible') { downgrade('BLOCKED'); reasons.push(`${l.label} failed compatibility`) }
      if (st === 'requires_verification') { downgrade('REQUIRES_VERIFICATION'); uncertainties.push(`${l.label}: compatibility evidence requires verification`) }
      const q = byLabel.get(l.label)
      if (q && q.quality_docs !== 'available') { downgrade('REQUIRES_VERIFICATION'); uncertainties.push(`${l.label}: quality documentation ${q.quality_docs}`) }
    }
    if (freightMissing) { downgrade('CONDITIONAL'); uncertainties.push('Freight cost missing from at least one quotation') }
    if (goods + freight > c.budget.amount) { downgrade('CONDITIONAL'); reasons.push(`Total ${fmt(goods + freight)} exceeds budget ${fmt(c.budget.amount)}`) }
    if (status === 'FEASIBLE') reasons.push('Quantity, deadline, compatibility and documentation all satisfied')
    const risk = Math.min(1, (status === 'FEASIBLE' ? 0.1 : status === 'REQUIRES_VERIFICATION' ? 0.3 : status === 'CONDITIONAL' ? 0.55 : 0.9) + (freightMissing ? 0.05 : 0))
    const version = `${d.id}-v${lines.map(l => `${l.label[9]}${l.quantity}`).join('')}`
    return { id: d.id, version, name: d.name, lines, quantity, goods_total: goods, freight_total: freight, total: goods + freight, freight_missing: freightMissing, max_lead_days: maxLead, status, reasons, uncertainties, risk_score: Math.round(risk * 100) / 100 }
  })
}

export function selectPlan(plans: RecoveryPlan[]): RecoveryPlan | null {
  const rank: Record<PlanStatus, number> = { FEASIBLE: 0, REQUIRES_VERIFICATION: 1, CONDITIONAL: 2, BLOCKED: 9 }
  const usable = plans.filter(p => p.status !== 'BLOCKED')
  if (!usable.length) return null
  return [...usable].sort((a, b) => rank[a.status] - rank[b.status] || a.risk_score - b.risk_score || a.total - b.total)[0]
}

const S = (label: string, ms: number, detail: string): StageDef => ({ label, ms, detail })

/** Deterministic mock executor for one logical task. */
export function executeTask(task: TaskType, ctx: ExecContext): TaskResult {
  const { c, scenario, results } = ctx
  const stock = usableStock(c)
  const shortage = Math.max(0, c.required_quantity - stock.available)
  const inv = results.inventory?.output as { shortage?: number } | undefined
  const base = { warnings: [] as string[], errors: [] as string[] }

  switch (task) {
    case 'intake': return {
      ...base, status: 'completed',
      input: { case_id: c.case_id, component: c.component.sku, required_quantity: c.required_quantity, deadline_days: c.deadline_days },
      stages: [S('Recovery case received', 900, `Case ${c.case_id} for ${c.component.sku}`), S('Case validated', 1100, 'Required fields present; budget and deadline set'), S('Specialists selected', 900, 'Inventory/BOM and Job Impact can run in parallel'), S('Tasks dispatched', 800, '2 tasks created with correlation IDs')],
      output: { tasks: ['inventory_bom.inventory', 'job_impact.job_impact'], parallel: true },
      summary: 'Case validated. Inventory/BOM and Job Impact activated in parallel.',
    }
    case 'inventory': return {
      ...base, status: 'completed',
      input: { component: c.component.sku, required_quantity: c.required_quantity, case_id: c.case_id },
      stages: [S('Read inventory records', 1500, `${c.stock_records.length} stock records loaded`), S('Check reserved quantities', 1300, `${stock.reserved} units reserved for other orders`), S('Exclude quarantined stock', 1100, `${stock.quarantined} units on QC hold`), S('Calculate shortage', 1400, `${c.required_quantity} − ${stock.available} = ${shortage}`), S('Validate result', 900, 'Totals reconcile with stock ledger')],
      output: { required: c.required_quantity, on_hand: stock.onHand, reserved: stock.reserved, quarantined: stock.quarantined, available: stock.available, shortage, status: shortage > 0 ? 'shortage_detected' : 'covered' },
      summary: `Shortage of ${shortage} units confirmed (${stock.available} usable of ${c.required_quantity} required).`,
    }
    case 'job_impact': {
      let left = stock.available
      const jobs = [...c.jobs].sort((a, b) => a.deadline_days - b.deadline_days).map(j => {
        const covered = Math.min(left, j.quantity)
        left -= covered
        return { job_id: j.job_id, machine: j.machine, priority: j.priority, required: j.quantity, covered, uncovered: j.quantity - covered, deadline_days: j.deadline_days }
      })
      if (scenario.invalidJobImpact) return {
        ...base, status: 'failed', errors: ['Response failed schema validation: jobs[].deadline_days missing'],
        input: { jobs: c.jobs.map(j => j.job_id), available: stock.available },
        stages: [S('Read affected repair jobs', 1400, `${c.jobs.length} jobs`), S('Load material requirements', 1300, 'BOM lines loaded'), S('Build response', 1100, 'Deadline field not populated'), S('Validate result', 900, 'Schema check failed')],
        output: { jobs: jobs.map(({ deadline_days: _d, ...j }) => { void _d; return j }) },
        summary: 'Job Impact returned an invalid payload (missing deadlines).',
      }
      return {
        ...base, status: 'completed',
        input: { jobs: c.jobs.map(j => j.job_id), available: stock.available },
        stages: [S('Read affected repair jobs', 1400, `${c.jobs.length} open repair jobs need ${c.component.sku}`), S('Load material requirements', 1300, jobs.map(j => `${j.job_id}: ${j.required}`).join(', ')), S('Check deadlines', 1200, jobs.map(j => `${j.job_id} in ${j.deadline_days} d`).join(', ')), S('Allocate usable stock by deadline', 1200, `${stock.available} units to the earliest deadline first`), S('Identify urgency', 900, `${jobs.filter(j => j.uncovered > 0).length} jobs uncovered`)],
        output: { jobs, affected: jobs.filter(j => j.uncovered > 0).length },
        summary: `${jobs.filter(j => j.uncovered > 0).length} repair jobs affected; ${jobs[0]?.machine ?? ''} is critical.`,
      }
    }
    case 'review': {
      const ji = results.job_impact
      if (!ji || ji.status !== 'completed') return {
        ...base, status: 'blocked', errors: ['Job Impact result is invalid; sourcing cannot be prioritised without job deadlines'],
        input: { inventory: results.inventory?.output ?? null, job_impact: ji?.output ?? null },
        stages: [S('Collect specialist results', 900, 'Inventory/BOM completed, Job Impact failed'), S('Validate responses', 1000, 'Job Impact failed validation')],
        output: { decision: 'blocked', missing: ['job_impact'] },
        summary: 'Workflow blocked: Job Impact response failed validation.',
      }
      return {
        ...base, status: 'completed',
        input: { inventory: results.inventory?.output, job_impact: ji.output },
        stages: [S('Collect specialist results', 900, 'Inventory/BOM and Job Impact completed'), S('Validate responses', 1000, 'Both payloads passed schema validation'), S('Decide next step', 900, `Shortage ${inv?.shortage ?? shortage} > 0 → Supplier Sourcing`)],
        output: { decision: 'source_alternatives', shortage: inv?.shortage ?? shortage, next: 'supplier_sourcing.supplier_discovery' },
        summary: 'Shortage and job impact validated. Supplier Sourcing activated.',
      }
    }
    case 'supplier_discovery': return {
      ...base, status: 'completed',
      input: { component: c.component.sku, shortage: inv?.shortage ?? shortage, spec: c.component.spec },
      stages: [S('Request received', 900, 'Discovery task from Coordinator'), S('Catalog query started', 1700, `Searching ${c.catalog_supplier_count ?? 18} supplier catalogs`), ...c.quotes.map(q => S(`${q.label} discovered`, 1300, q.supplier_name ?? q.supplier_id)), S('Availability evidence checked', 1300, 'Catalog listings only: availability unconfirmed until quoted'), S('Result validated', 800, `${c.quotes.length} candidates`)],
      output: { searched: c.catalog_supplier_count ?? 18, candidates: c.quotes.map(q => ({ supplier_id: q.supplier_id, name: q.supplier_name, label: q.label, availability: 'unconfirmed' })) },
      summary: `${c.quotes.length} candidate suppliers discovered; availability unconfirmed until they quote.`,
    }
    case 'enquiry_drafts': return {
      ...base, status: 'completed', warnings: ['SIMULATED MESSAGE — NOT SENT'],
      input: { suppliers: c.quotes.map(q => q.label), quantity: inv?.shortage ?? shortage, deadline_days: c.deadline_days },
      stages: [...c.quotes.map(q => S(`Draft enquiry to ${q.label}`, 1300, `${inv?.shortage ?? shortage} × ${c.component.sku}, delivery within ${c.deadline_days} days`)), S('Attach specification', 900, '25×52×15 mm, 2RS, ISO 15'), S('Mark drafts unsent', 600, 'No message leaves the system')],
      output: { drafts: c.quotes.map(q => ({ to: q.supplier_name, subject: `RFQ ${c.case_id}: ${inv?.shortage ?? shortage} × ${c.component.name}`, body: `Please confirm availability, unit price, freight and lead time for ${inv?.shortage ?? shortage} units of ${c.component.sku} (25×52×15 mm, 2RS). Required within ${c.deadline_days} days. Include certificate of conformity.`, status: 'SIMULATED MESSAGE — NOT SENT' })) },
      summary: `${c.quotes.length} enquiry drafts prepared (not sent).`,
    }
    case 'clarification_drafts': return {
      ...base, status: 'completed', warnings: ['SIMULATED MESSAGE — NOT SENT'],
      input: { reason: ctx.approval.comment || 'Approver requested more information' },
      stages: [S('Collect open questions', 1000, 'Freight, certificates and manufacturer approval'), S('Draft clarification', 1300, 'One draft per supplier with gaps'), S('Mark drafts unsent', 600, 'Awaiting approver review')],
      output: { drafts: quoteRisk(c, inv?.shortage ?? shortage).filter(r => r.flags.length).map(r => ({ to: r.label, questions: r.flags, status: 'SIMULATED MESSAGE — NOT SENT' })) },
      summary: 'Clarification drafts prepared for suppliers with gaps (not sent).',
    }
    case 'collect_responses': return {
      ...base, status: 'completed', warnings: ['MOCK QUOTATIONS — DEMO RESPONSES'],
      input: { awaiting: c.quotes.length },
      stages: [...c.quotes.map(q => S(`${q.label} quotation received`, 1100, `${q.quantity} @ ${fmt(q.unit_price)} · ${q.lead_time_days} d`)), S('Correlate to enquiries', 800, 'Matched by case ID')],
      output: { quotations: c.quotes },
      summary: `${c.quotes.length} simulated quotations received.`,
    }
    case 'compatibility': {
      const comp = compatibility(c)
      return {
        ...base, status: 'completed',
        input: { component: c.component.spec, offers: c.quotes.map(q => ({ label: q.label, part_number: q.part_number })) },
        stages: [S('Load required specification', 1000, '6205-2RS, 25×52×15 mm'), ...comp.map(k => S(`Check ${k.label}`, 1500, `${k.checks.filter(x => x.ok).length}/${k.checks.length} checks passed → ${k.status.replace('_', ' ')}`)), S('Validate evidence', 900, 'Unverified items listed, not assumed')],
        output: { results: comp },
        warnings: comp.filter(k => k.status !== 'compatible').map(k => `${k.label}: ${k.status.replace('_', ' ')}`),
        summary: `${comp.filter(k => k.status === 'compatible').length} compatible, ${comp.filter(k => k.status === 'requires_verification').length} need verification, ${comp.filter(k => k.status === 'not_compatible').length} rejected.`,
      }
    }
    case 'quote_risk': {
      const r = quoteRisk(c, inv?.shortage ?? shortage)
      return {
        ...base, status: c.quotes.length ? 'completed' : 'blocked',
        input: { quotations: c.quotes.length, shortage: inv?.shortage ?? shortage, budget: c.budget },
        stages: [S('Check quantity', 1200, r.map(x => `${x.label}: ${x.quantity}`).join(' · ')), S('Validate pricing', 1100, r.map(x => `${x.label}: ${fmt(x.unit_price)}`).join(' · ')), S('Identify missing freight', 1000, `${c.quotes.filter(q => q.freight == null).length} missing`), S('Check delivery deadlines', 1100, `${c.quotes.filter(q => q.lead_time_days > c.deadline_days).length} exceed ${c.deadline_days} d`), S('Flag quality documentation', 1000, `${c.quotes.filter(q => q.quality_docs !== 'available').length} incomplete`), S('Calculate commercial risk', 1000, r.map(x => `${x.label} ${Math.round(x.risk * 100)}%`).join(' · '))],
        output: { risks: r },
        warnings: r.flatMap(x => x.flags.map(f => `${x.label}: ${f}`)),
        summary: `Quotes validated; ${r.filter(x => x.flags.length).length} carry risk flags.`,
      }
    }
    case 'recovery_planner': {
      const comp = compatibility(c)
      const plans = buildPlans(c, inv?.shortage ?? shortage, comp)
      const chosen = selectPlan(plans)
      return {
        ...base, status: chosen ? 'completed' : 'blocked',
        input: { shortage: inv?.shortage ?? shortage, deadline_days: c.deadline_days, budget: c.budget, quotes: c.quotes.length },
        stages: [S('Receive validated supplier data', 1000, `${c.quotes.length} quotations, compatibility results`), ...plans.map(p => S(`Evaluate ${p.id}`, 1500, `${p.quantity} units · ${fmt(p.total)}${p.freight_missing ? ' + freight' : ''} · ${p.status.replace('_', ' ')}`)), S('Rank alternatives', 1000, chosen ? `${chosen.id} selected` : 'No plan can be selected'), S('Validate plan', 800, 'Quantities and totals recomputed from quote lines')],
        output: { plans, selected_plan_id: chosen?.id ?? null },
        errors: chosen ? [] : ['No feasible or conditional recovery plan: approval cannot be requested'],
        warnings: chosen ? chosen.uncertainties : [],
        summary: chosen ? `${chosen.name} recommended (${chosen.status.replace('_', ' ').toLowerCase()}).` : 'No feasible recovery plan.',
      }
    }
    case 'po_draft': {
      const plans = (results.recovery_planner?.output as { plans?: RecoveryPlan[] } | undefined)?.plans ?? []
      const plan = plans.find(p => p.id === ctx.approval.planId)
      if (!plan) return { ...base, status: 'blocked', errors: ['No approved plan'], input: {}, stages: [S('Check plan identity', 800, 'No approved plan')], output: {}, summary: 'Procurement blocked: no approved plan.' }
      return {
        ...base, status: 'completed', warnings: ['DRAFT ONLY — NOT EXECUTED'],
        input: { plan_id: plan.id, plan_version: ctx.approval.planVersion, approval: ctx.approval.decision },
        stages: [S('Check plan identity', 900, `${plan.id} · version ${plan.version}`), S('Validate supplier details', 1100, plan.lines.map(l => l.supplier_name).join(', ')), S('Validate component and quantity', 1000, `${plan.quantity} × ${c.component.sku}`), S('Calculate quotation totals', 1000, `${fmt(plan.goods_total)} goods + ${fmt(plan.freight_total)} freight`), S('Check approval requirements', 900, `Approved version ${ctx.approval.planVersion}`), S('Generate purchase order draft', 1100, plan.lines.map((l, i) => `PO-DRAFT-04${12 + i} → ${l.label}`).join(', '))],
        output: { drafts: plan.lines.map((l, i) => ({ po: `PO-DRAFT-04${12 + i}`, supplier: l.supplier_name, quantity: l.quantity, unit_price: l.unit_price, total: l.line_total + (l.freight ?? 0) })), total: plan.total, state: 'Draft generated → Approval recorded → Not executed' },
        summary: `${plan.lines.length} purchase-order drafts prepared, not executed.`,
      }
    }
    case 'delivery': {
      const plans = (results.recovery_planner?.output as { plans?: RecoveryPlan[] } | undefined)?.plans ?? []
      const plan = plans.find(p => p.id === ctx.approval.planId)
      const ids = new Set(plan?.lines.map(l => l.supplier_id) ?? [])
      if (scenario.deliveryFailure) return {
        ...base, status: 'failed', errors: ['Tracking service unavailable (simulated failure); delivery status unconfirmed'],
        input: { plan_id: plan?.id ?? null },
        stages: [S('Read delivery events', 1300, 'Connecting to tracking feed'), S('Retry', 1500, 'Second attempt timed out')],
        output: { status: 'unknown' },
        summary: 'Delivery Watch failed: tracking unavailable.',
      }
      const events = c.delivery_events.filter(e => !e.supplier_id || ids.has(e.supplier_id))
      const expected = plan?.quantity ?? 0
      const received = events.filter(e => e.event === 'received').reduce((n, e) => n + (e.quantity ?? 0), 0)
      const exceptions = events.filter(e => e.event === 'shipment_dispatched' && !e.tracking).map(e => `${e.supplier_id}: ${e.detail}`)
      return {
        ...base, status: 'completed',
        input: { plan_id: plan?.id, expected_quantity: expected, recorded_events: events.length },
        stages: [S('Read recorded events', 1200, `${events.length} events for the approved suppliers`), S('Validate quantities', 1200, `${received} received of ${expected}`), S('Check tracking', 1000, exceptions.length ? `${exceptions.length} shipment without tracking` : 'All shipments tracked'), S('Evaluate status', 900, received >= expected ? 'Complete' : 'Partially received')],
        output: { events, expected, received, remaining: Math.max(0, expected - received), status: received >= expected ? 'received' : received > 0 ? 'partially_received' : 'awaiting', exceptions },
        warnings: exceptions,
        summary: `${received} of ${expected} units received; ${Math.max(0, expected - received)} outstanding.`,
      }
    }
    case 'final_summary': {
      const blocked = Object.values(results).filter(r => r && (r.status === 'blocked' || r.status === 'failed')).length
      return {
        ...base, status: 'completed',
        input: { approval: ctx.approval.decision, plan: ctx.approval.planId },
        stages: [S('Collect agent results', 1000, `${Object.keys(results).length} task results`), S('Assemble recovery outcome', 1100, ctx.approval.decision === 'approved' ? 'Plan approved, drafts prepared, delivery tracked' : `Approval ${ctx.approval.decision ?? 'not given'}`), S('Close workflow', 700, blocked ? `${blocked} task(s) blocked or failed` : 'All tasks completed')],
        output: { approval: ctx.approval, blocked_or_failed: blocked },
        summary: 'Recovery outcome assembled.',
      }
    }
  }
}
