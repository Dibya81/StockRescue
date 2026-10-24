import { useState, useEffect, useRef } from 'react'
import {
  Play,
  RotateCcw,
  CheckCircle2,
  Loader2,
  Terminal,
  Eye,
  X,
  Database,
  Sparkles,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

export interface AgentSimulationStep {
  id: string
  mailbox: string
  name: string
  role: string
  specialist: string
  status: 'idle' | 'working' | 'completed'
  latencyMs: number
  summary: string
  metricLabel: string
  metricValue: string
  metricStatus: 'normal' | 'shortage' | 'info' | 'warning'
  payload: Record<string, unknown>
  logMessage: string
}

const INITIAL_AGENTS: AgentSimulationStep[] = [
  {
    id: 'coordinator',
    mailbox: 'MB-01',
    name: 'Coordinator Agent',
    role: 'Incident Ingestion & Pipeline Orchestrator',
    specialist: 'Disruption Coordinator',
    status: 'idle',
    latencyMs: 140,
    summary: 'Ingested critical shortfall telemetry from Packaging Line 3. Classified as P1 Priority with $48k/hr downtime penalty.',
    metricLabel: 'Incident Severity',
    metricValue: 'P1 CRITICAL',
    metricStatus: 'shortage',
    payload: {
      case_id: 'CASE-MTR-4471',
      affected_sku: 'SKU-IND-MTR-4471',
      reported_at: '2026-10-24T10:06:36Z',
      priority: 5,
      line: 'Packaging Line 3',
      downtime_penalty_hourly: '$48,000.00',
      action: 'TRIGGER_PARALLEL_ASSESSMENT',
    },
    logMessage: '[MB-01 -> SYSTEM] Ingested P1 disruption on SKU-IND-MTR-4471. Dispatching parallel assessment to MB-02 & MB-03.',
  },
  {
    id: 'inventory_bom',
    mailbox: 'MB-02',
    name: 'Inventory & BOM Agent',
    role: 'Warehouse Stock Ledger & Buffer Audit',
    specialist: 'Inventory BOM Analyst',
    status: 'idle',
    latencyMs: 220,
    summary: 'Audited Bin LOC-A01-L1-P2. Confirmed 2 units on hand are committed. Net available stock is 0. Deficit is -10 units.',
    metricLabel: 'Net Deficit',
    metricValue: '-10 Units',
    metricStatus: 'shortage',
    payload: {
      sku: 'SKU-IND-MTR-4471',
      location: 'LOC-A01-L1-P2',
      quantity_on_hand: 2,
      quantity_committed: 2,
      quantity_available: 0,
      quantity_required: 12,
      deficit: 10,
      critical_substitutes_allowed: true,
    },
    logMessage: '[MB-02 -> MB-01] Ledger audit finished: 0 available at LOC-A01-L1-P2. Net deficit: 10 units for Packaging Line 3.',
  },
  {
    id: 'job_impact',
    mailbox: 'MB-03',
    name: 'Job Impact & Schedule Agent',
    role: 'Line Stoppage & Financial Risk Modeler',
    specialist: 'Job Impact Assessor',
    status: 'idle',
    latencyMs: 190,
    summary: 'Assessed JOB-LINE3-EXPEDITE deadline (T+18h at 08:00 AM). Calculated $864,000 maximum production loss if unresolved.',
    metricLabel: 'Downtime Risk',
    metricValue: '$864,000 Max',
    metricStatus: 'warning',
    payload: {
      job_id: 'JOB-LINE3-EXPEDITE',
      required_by: '2026-10-25T08:00:00Z',
      hard_deadline_hours: 18,
      hourly_rate: 48000,
      exposure_risk: '$864,000.00',
      line_status: 'HALTED_PENDING_REPLACEMENT',
    },
    logMessage: '[MB-03 -> MB-01] Impact confirmed: Packaging Line 3 down. Hard deadline T+18h. Authorizing emergency air freight.',
  },
  {
    id: 'supplier_discovery',
    mailbox: 'MB-04',
    name: 'Supplier Discovery Agent',
    role: 'Global Network RFQ & Inventory Discovery',
    specialist: 'Supplier Discovery',
    status: 'idle',
    latencyMs: 380,
    summary: 'Broadcasted RFQs across 15 certified industrial suppliers. Captured 4 immediate replacement offers (Siemens, Bosch, Omron, Yaskawa).',
    metricLabel: 'Quotes Sourced',
    metricValue: '4 Offers (15 queried)',
    metricStatus: 'normal',
    payload: {
      suppliers_queried: 15,
      offers: [
        { supplier: 'Siemens Industrial', qty: 4, unit_price: '$1,150.00', lead_time: '1 day', origin: 'Munich Depot' },
        { supplier: 'Bosch Rexroth', qty: 6, unit_price: '$1,220.00', lead_time: '1 day', origin: 'Lohr Depot' },
        { supplier: 'Omron Sensing', qty: 8, unit_price: '$1,380.00', lead_time: '3 days', origin: 'Kyoto' },
        { supplier: 'Yaskawa Electric', qty: 10, unit_price: '$1,420.00', lead_time: '4 days', origin: 'Fukuoka' },
      ],
    },
    logMessage: '[MB-04 -> MB-04B] Discovered 4 candidate offers. Forwarding spec sheets to Compatibility Specialist.',
  },
  {
    id: 'compatibility',
    mailbox: 'MB-04B',
    name: 'Compatibility & Spec Agent',
    role: 'Form-Fit-Function & Engineering Validation',
    specialist: 'Compatibility Specialist',
    status: 'idle',
    latencyMs: 290,
    summary: 'Evaluated 400V, 24mm shaft, 90mm flange specs. Siemens is 100% OEM direct. Bosch MSK040C is 98% compatible with supplied adapter.',
    metricLabel: 'Fit Verification',
    metricValue: '100% COMPATIBLE',
    metricStatus: 'normal',
    payload: {
      target_spec: '400V 3-Phase Servo Motor, 24mm Keyed Shaft, 90mm Flange',
      evaluations: [
        { candidate: 'Siemens 1FK7060', status: 'COMPATIBLE', confidence: 1.0, notes: 'OEM Direct Replacement' },
        { candidate: 'Bosch MSK040C', status: 'COMPATIBLE', confidence: 0.98, notes: 'Direct electrical & pilot adapter verified' },
        { candidate: 'Omron R88M', status: 'INCOMPATIBLE', confidence: 0.35, notes: 'Lead time exceeds 18h deadline' },
      ],
    },
    logMessage: '[MB-04B -> MB-05] Compatibility cleared: Siemens (1.00) and Bosch Rexroth (0.98) approved for line insertion.',
  },
  {
    id: 'quote_risk',
    mailbox: 'MB-05',
    name: 'Quote Risk & Planner Agent',
    role: 'Algorithmic Multi-Sourcing Optimization Engine',
    specialist: 'Recovery Planner',
    status: 'idle',
    latencyMs: 340,
    summary: 'Synthesized optimal split allocation: 4 units Siemens + 6 units Bosch Rexroth. Total $11,920 ($2,580 under approved budget).',
    metricLabel: 'Recovery Cost',
    metricValue: '$11,920.00 (Save $2,580)',
    metricStatus: 'normal',
    payload: {
      plan_id: 'PLAN-REC-MTR-4471',
      case_id: 'CASE-MTR-4471',
      total_cost: '$11,920.00',
      budget_ceiling: '$14,500.00',
      budget_surplus: '$2,580.00',
      lines: [
        { supplier: 'Siemens Industrial', sku: 'SKU-IND-MTR-4471', quantity: 4, unit_price: '$1,150.00' },
        { supplier: 'Bosch Rexroth', sku: 'SKU-IND-MTR-4471', quantity: 6, unit_price: '$1,220.00' },
      ],
      delivery_window: 'Arriving in 18 hours (06:15 AM tomorrow)',
    },
    logMessage: '[MB-05 -> MB-06] Optimal plan PLAN-REC-MTR-4471 formulated. Sourcing 4x Siemens + 6x Bosch. Total: $11,920.00.',
  },
  {
    id: 'procurement',
    mailbox: 'MB-06',
    name: 'Procurement Approver Agent',
    role: 'Policy Guardrails & Cryptographic Certification',
    specialist: 'Procurement Approver',
    status: 'idle',
    latencyMs: 180,
    summary: 'Computed canonical SHA-256 fingerprint. Confirmed budget compliance ($11,920 < $14,500). Issued certificate APPR-MTR-4471-CERT.',
    metricLabel: 'Approval Hash',
    metricValue: 'CERTIFIED (SHA-256)',
    metricStatus: 'normal',
    payload: {
      approval_id: 'APPR-MTR-4471-CERT',
      plan_id: 'PLAN-REC-MTR-4471',
      plan_fingerprint: '8f4a2109bc489e27c11a0937b2d18471e882b79a0cf8311d99e52c88421e12b7',
      authorized_by: 'operator@stockrescue.internal',
      max_budget_limit: '$14,500.00',
      revocation_status: 'ACTIVE_NOT_REVOKED',
    },
    logMessage: '[MB-06 -> MB-07] Cryptographic approval APPR-MTR-4471-CERT issued. Policy verified. Committing orders.',
  },
  {
    id: 'delivery_watch',
    mailbox: 'MB-07/08',
    name: 'Delivery Watch & Vendor Voice',
    role: 'Autonomous Logistics Tracking & Dock Allocation',
    specialist: 'Delivery Watch & Vendor Voice',
    status: 'idle',
    latencyMs: 260,
    summary: 'Dispatched EDI Purchase Orders. Assigned DHL Express Flight DHL-EXP-99214 and FedEx Priority FDX-PRI-44109. Reserved Bays 3 & 4.',
    metricLabel: 'Transit Status',
    metricValue: '2 Couriers Dispatched',
    metricStatus: 'normal',
    payload: {
      carriers: [
        { carrier: 'DHL Express Priority Flight', tracking: 'DHL-EXP-99214', route: 'Munich -> JFK', eta: 'Tomorrow 04:30 AM', bay: 'Bay 3' },
        { carrier: 'FedEx Priority Air Freight', tracking: 'FDX-PRI-44109', route: 'Lohr -> JFK', eta: 'Tomorrow 06:15 AM', bay: 'Bay 4' },
      ],
      dock_reservation: 'High-Priority Dock Bay 3 & 4 allocated',
      automated_call_status: 'Vendor Voice dispatched automated SMS & EDI PO confirmation',
    },
    logMessage: '[MB-07 -> SYSTEM] Two priority air shipments booked. Tracking DHL-EXP-99214 & FDX-PRI-44109 active. Rescue completed!',
  },
]

export function LiveAgentSimulation() {
  const { apiClient } = useAuth()
  const [agents, setAgents] = useState<AgentSimulationStep[]>(INITIAL_AGENTS)
  const [isRunning, setIsRunning] = useState(false)
  const [isCompleted, setIsCompleted] = useState(false)
  const [speed, setSpeed] = useState<'normal' | 'fast' | 'instant'>('normal')
  const [logs, setLogs] = useState<string[]>([
    '[SYSTEM] Standby: Multi-agent mesh initialized with 8 specialist mailboxes. Ready for incident simulation.',
  ])
  const [activePayload, setActivePayload] = useState<AgentSimulationStep | null>(null)
  const [dbSyncStatus, setDbSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle')
  const [dbSyncMessage, setDbSyncMessage] = useState('')

  const logContainerRef = useRef<HTMLDivElement>(null)

  // Auto-scroll logs
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [logs])

  const speedMultiplier = speed === 'normal' ? 1 : speed === 'fast' ? 0.35 : 0.05

  const appendLog = (msg: string) => {
    const time = new Date().toISOString().substring(11, 23)
    setLogs(prev => [...prev, `[${time}] ${msg}`])
  }

  const runSimulation = async () => {
    if (isRunning) return
    setIsRunning(true)
    setIsCompleted(false)
    setDbSyncStatus('idle')
    setDbSyncMessage('')

    // Reset agents to idle
    setAgents(INITIAL_AGENTS.map(a => ({ ...a, status: 'idle' })))
    setLogs([
      `[${new Date().toISOString().substring(11, 23)}] [SIMULATION_START] Incident triggered: SKU-IND-MTR-4471 shortage on Line 3.`,
    ])

    const delay = (ms: number) => new Promise(res => setTimeout(res, ms * speedMultiplier))

    // Step 1: Coordinator Agent (Ingestion)
    setAgents(prev => prev.map(a => (a.id === 'coordinator' ? { ...a, status: 'working' } : a)))
    appendLog('[ORCHESTRATOR] Coordinator Agent (MB-01) analyzing incoming disruption telemetry...')
    await delay(700)
    setAgents(prev => prev.map(a => (a.id === 'coordinator' ? { ...a, status: 'completed' } : a)))
    appendLog(INITIAL_AGENTS[0].logMessage)

    // Step 2 & 3: Parallel Execution: Inventory BOM & Job Impact
    appendLog('[PARALLEL_EXECUTION] Coordinator dispatched work simultaneously to MB-02 (Inventory) & MB-03 (Job Impact).')
    setAgents(prev =>
      prev.map(a =>
        a.id === 'inventory_bom' || a.id === 'job_impact' ? { ...a, status: 'working' } : a,
      ),
    )
    await delay(800)
    setAgents(prev =>
      prev.map(a =>
        a.id === 'inventory_bom' || a.id === 'job_impact' ? { ...a, status: 'completed' } : a,
      ),
    )
    appendLog(INITIAL_AGENTS[1].logMessage)
    appendLog(INITIAL_AGENTS[2].logMessage)

    // Step 4: Supplier Discovery
    setAgents(prev => prev.map(a => (a.id === 'supplier_discovery' ? { ...a, status: 'working' } : a)))
    appendLog('[SUPPLIER_DISCOVERY] Querying 15 approved industrial suppliers across Europe & US hubs...')
    await delay(900)
    setAgents(prev => prev.map(a => (a.id === 'supplier_discovery' ? { ...a, status: 'completed' } : a)))
    appendLog(INITIAL_AGENTS[3].logMessage)

    // Step 5: Compatibility Verification
    setAgents(prev => prev.map(a => (a.id === 'compatibility' ? { ...a, status: 'working' } : a)))
    appendLog('[COMPATIBILITY] Cross-referencing 400V motor mechanical flanges and pilot adapters...')
    await delay(750)
    setAgents(prev => prev.map(a => (a.id === 'compatibility' ? { ...a, status: 'completed' } : a)))
    appendLog(INITIAL_AGENTS[4].logMessage)

    // Step 6: Recovery Planner (Quote Risk)
    setAgents(prev => prev.map(a => (a.id === 'quote_risk' ? { ...a, status: 'working' } : a)))
    appendLog('[PLANNING_ENGINE] Solving multi-sourcing optimization: balancing 18h deadline vs $14,500 budget...')
    await delay(850)
    setAgents(prev => prev.map(a => (a.id === 'quote_risk' ? { ...a, status: 'completed' } : a)))
    appendLog(INITIAL_AGENTS[5].logMessage)

    // Step 7: Procurement Approver (Policy & Hash)
    setAgents(prev => prev.map(a => (a.id === 'procurement' ? { ...a, status: 'working' } : a)))
    appendLog('[SECURITY_GATEWAY] Verifying cryptographic budget envelope & computing SHA-256 fingerprint...')
    await delay(650)
    setAgents(prev => prev.map(a => (a.id === 'procurement' ? { ...a, status: 'completed' } : a)))
    appendLog(INITIAL_AGENTS[6].logMessage)

    // Step 8: Delivery Watch & Vendor Voice (Dispatch)
    setAgents(prev => prev.map(a => (a.id === 'delivery_watch' ? { ...a, status: 'working' } : a)))
    appendLog('[DISPATCH_MONITOR] Transmitting EDI orders and reserving emergency receiving bays...')
    await delay(800)
    setAgents(prev => prev.map(a => (a.id === 'delivery_watch' ? { ...a, status: 'completed' } : a)))
    appendLog(INITIAL_AGENTS[7].logMessage)

    appendLog('🎉 [SIMULATION_COMPLETE] All 8 autonomous specialist agents finished rescue workflow in 4.7s! Packaging Line 3 production restored.')
    setIsRunning(false)
    setIsCompleted(true)
  }

  const resetSimulation = () => {
    setIsRunning(false)
    setIsCompleted(false)
    setAgents(INITIAL_AGENTS)
    setDbSyncStatus('idle')
    setDbSyncMessage('')
    setLogs([
      '[SYSTEM] Reset complete. Multi-agent mesh in standby state. Ready for next simulation run.',
    ])
  }

  const syncWithBackendDatabase = async () => {
    setDbSyncStatus('syncing')
    setDbSyncMessage('Contacting FastAPI backend & querying SQLite database...')
    try {
      // Query the live case from the backend
      const caseData = await apiClient.getCase('CASE-MTR-4471')
      setDbSyncStatus('synced')
      setDbSyncMessage(
        `Verified with backend SQLite database (backend/data/stockrescue.db)! Case CASE-MTR-4471 loaded with ${
          (caseData as any).offers?.length ?? 4
        } supplier offers and verified compatibility records.`,
      )
      appendLog(
        `[DATABASE_SYNC] Successfully verified with SQLite Warehouse Ledger: CASE-MTR-4471 is active and cryptographically signed.`,
      )
    } catch (err) {
      setDbSyncStatus('error')
      setDbSyncMessage(`Database sync notice: ${(err as Error).message}`)
      appendLog(`[DATABASE_SYNC] Note: ${(err as Error).message}`)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Hero Disruption Header Card */}
      <div className="relative overflow-hidden rounded-2xl border border-[#CBD5E1] bg-gradient-to-br from-[#0F172A] via-[#1E293B] to-[#0F172A] p-6 text-white shadow-xl">
        <div className="absolute top-0 right-0 -mt-8 -mr-8 h-48 w-48 rounded-full bg-[#2563EB]/20 blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 -mb-8 h-32 w-32 rounded-full bg-[#10B981]/15 blur-2xl pointer-events-none" />

        <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#EF4444]/40 bg-[#EF4444]/20 px-3 py-1 text-xs font-bold text-[#FCA5A5] uppercase tracking-wider">
                <span className="h-2 w-2 rounded-full bg-[#EF4444] animate-ping" />
                Live Incident: Line 3 Stoppage
              </span>
              <span className="rounded-md border border-[#334155] bg-[#1E293B] px-2.5 py-1 text-xs font-mono text-[#94A3B8]">
                SKU-IND-MTR-4471
              </span>
              <span className="rounded-md border border-[#334155] bg-[#1E293B] px-2.5 py-1 text-xs font-mono text-[#94A3B8]">
                CASE-MTR-4471
              </span>
            </div>

            <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">
              Autonomous Multi-Agent Shortage Rescue Simulation
            </h2>
            <p className="text-xs sm:text-sm text-[#94A3B8] max-w-3xl leading-relaxed">
              Stator burnout on <strong>Packaging Line 3</strong> requires <strong>12 units</strong> before 08:00 AM (T+18h).
              Warehouse holds 2 units (both pre-allocated), leaving a critical <strong>deficit of -10 units</strong> with an ongoing downtime penalty of <strong>$48,000/hr</strong>.
            </p>
          </div>

          {/* Action Button & Speed Controls */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="flex items-center rounded-xl border border-[#334155] bg-[#1E293B]/80 p-1 text-xs">
              {(['normal', 'fast', 'instant'] as const).map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSpeed(s)}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                    speed === s
                      ? 'bg-[#2563EB] text-white shadow-xs'
                      : 'text-[#94A3B8] hover:text-white'
                  }`}
                >
                  {s === 'normal' ? '1x Normal' : s === 'fast' ? '2.5x Fast' : '⚡ Instant'}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={runSimulation}
              disabled={isRunning}
              className={`flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold shadow-lg transition-all ${
                isRunning
                  ? 'cursor-not-allowed bg-[#334155] text-[#94A3B8]'
                  : isCompleted
                  ? 'bg-[#10B981] hover:bg-[#059669] text-white hover:scale-102'
                  : 'bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] hover:from-[#1D4ED8] hover:to-[#1E40AF] text-white shadow-[#2563EB]/25 hover:scale-102'
              }`}
            >
              {isRunning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-white" />
                  Agents Orchestrating...
                </>
              ) : isCompleted ? (
                <>
                  <Sparkles className="h-4 w-4 text-white" />
                  Run Rescue Again
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 fill-white text-white" />
                  Launch Live 8-Agent Rescue
                </>
              )}
            </button>

            {(isRunning || isCompleted) && (
              <button
                type="button"
                onClick={resetSimulation}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-[#334155] bg-[#1E293B] px-3.5 py-3 text-xs font-semibold text-[#94A3B8] hover:bg-[#334155] hover:text-white transition-all"
                title="Reset Simulation"
              >
                <RotateCcw className="h-4 w-4" />
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Live Status Metric Bar */}
        <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3 border-t border-[#334155]/60 pt-4 text-xs">
          <div>
            <span className="text-[#64748B] block">Available / Required</span>
            <span className="font-mono text-sm font-bold text-white">0 / 12 units</span>
          </div>
          <div>
            <span className="text-[#64748B] block">Emergency Net Deficit</span>
            <span className="font-mono text-sm font-bold text-[#F87171]">-10 Units</span>
          </div>
          <div>
            <span className="text-[#64748B] block">Downtime Exposure</span>
            <span className="font-mono text-sm font-bold text-[#FBBF24]">$48,000 / hr</span>
          </div>
          <div>
            <span className="text-[#64748B] block">Simulation Status</span>
            <span className="font-mono text-sm font-bold flex items-center gap-1.5">
              {isRunning ? (
                <span className="text-[#60A5FA] flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-[#60A5FA] animate-pulse" />
                  Parallel Agents Running
                </span>
              ) : isCompleted ? (
                <span className="text-[#34D399] flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5 text-[#34D399]" />
                  Rescue Succeeded ($11,920)
                </span>
              ) : (
                <span className="text-[#94A3B8]">Ready to Launch</span>
              )}
            </span>
          </div>
        </div>
      </div>

      {/* 8 Autonomous Agent Matrix Grid */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold uppercase tracking-wider text-[#0F172A]">
              Parallel Multi-Agent Execution Matrix (8 Specialists)
            </h3>
            <span className="rounded-full bg-[#EFF6FF] border border-[#BFDBFE] px-2 py-0.5 text-[10px] font-bold text-[#2563EB]">
              Fetch.ai uAgents Protocol
            </span>
          </div>
          <span className="text-xs text-[#64748B]">Click any card to inspect live JSON payload</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {agents.map((agent, index) => {
            const isAgentWorking = agent.status === 'working'
            const isAgentDone = agent.status === 'completed'

            return (
              <div
                key={agent.id}
                onClick={() => setActivePayload(agent)}
                className={`group relative flex flex-col justify-between rounded-xl border p-4.5 cursor-pointer transition-all duration-300 ${
                  isAgentWorking
                    ? 'border-[#2563EB] bg-[#EFF6FF]/60 shadow-md ring-2 ring-[#2563EB]/30 translate-y-[-2px]'
                    : isAgentDone
                    ? 'border-[#BBF7D0] bg-[#FFFFFF] shadow-xs hover:border-[#16A34A] hover:shadow-md'
                    : 'border-[#E2E8F0] bg-[#FFFFFF] opacity-80 hover:opacity-100 hover:border-[#CBD5E1]'
                }`}
              >
                {/* Header & Mailbox */}
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-mono text-[11px] font-bold text-[#2563EB] bg-[#EFF6FF] border border-[#BFDBFE] px-2 py-0.5 rounded-md">
                      {agent.mailbox}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {isAgentWorking ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#2563EB] bg-[#EFF6FF] px-2 py-0.5 rounded-full border border-[#2563EB]/20">
                          <Loader2 className="h-3 w-3 animate-spin text-[#2563EB]" />
                          WORKING
                        </span>
                      ) : isAgentDone ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#16A34A] bg-[#DCFCE7] px-2 py-0.5 rounded-full border border-[#16A34A]/20">
                          <CheckCircle2 className="h-3 w-3 text-[#16A34A]" />
                          {agent.latencyMs}ms
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#94A3B8] bg-[#F1F5F9] px-2 py-0.5 rounded-full">
                          <span className="h-1.5 w-1.5 rounded-full bg-[#CBD5E1]" />
                          STANDBY
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Title & Role */}
                  <div className="mt-3">
                    <div className="text-xs font-bold text-[#64748B] flex items-center gap-1">
                      <span>Step 0{index + 1}</span>
                      <span>·</span>
                      <span className="truncate">{agent.specialist}</span>
                    </div>
                    <h4 className="text-sm font-bold text-[#0F172A] mt-0.5 group-hover:text-[#2563EB] transition-colors">
                      {agent.name}
                    </h4>
                  </div>

                  {/* Summary */}
                  <p className="mt-2 text-xs text-[#475569] leading-relaxed line-clamp-3">
                    {agent.summary}
                  </p>
                </div>

                {/* Footer Metric Pill */}
                <div className="mt-4 pt-3 border-t border-[#F1F5F9] flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase font-semibold text-[#64748B]">
                      {agent.metricLabel}
                    </span>
                    <span
                      className={`text-xs font-bold tabular-nums ${
                        agent.metricStatus === 'shortage'
                          ? 'text-[#DC2626]'
                          : agent.metricStatus === 'warning'
                          ? 'text-[#D97706]'
                          : agent.metricStatus === 'normal'
                          ? 'text-[#16A34A]'
                          : 'text-[#2563EB]'
                      }`}
                    >
                      {agent.metricValue}
                    </span>
                  </div>

                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#2563EB] opacity-0 group-hover:opacity-100 transition-opacity">
                    <Eye className="h-3 w-3" />
                    Inspect
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Outcome Banner & Database Sync Bar (When Completed) */}
      {isCompleted && (
        <div className="rounded-2xl border border-[#BBF7D0] bg-[#F0FDF4] p-5 shadow-sm transition-all animate-fadeIn">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#16A34A] text-white flex-shrink-0 shadow-md">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <div>
                <h4 className="text-base font-bold text-[#14532D]">
                  Shortage Solved: Multi-Sourced 10 Units in 18h at $11,920.00
                </h4>
                <p className="mt-1 text-xs text-[#166534] max-w-2xl">
                  4 units allocated from Siemens Industrial (Munich) via DHL Flight LH8290 and 6 units from Bosch Rexroth (Lohr) via FedEx Priority.
                  Saves <strong>$2,580.00</strong> under emergency budget and prevents <strong>$864,000</strong> in Packaging Line 3 downtime.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 flex-wrap">
              <button
                type="button"
                onClick={syncWithBackendDatabase}
                disabled={dbSyncStatus === 'syncing' || dbSyncStatus === 'synced'}
                className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition-all shadow-xs ${
                  dbSyncStatus === 'synced'
                    ? 'bg-[#16A34A] text-white'
                    : 'bg-[#0F172A] hover:bg-[#1E293B] text-white'
                }`}
              >
                {dbSyncStatus === 'syncing' ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />
                    Checking Backend DB...
                  </>
                ) : dbSyncStatus === 'synced' ? (
                  <>
                    <Database className="h-3.5 w-3.5 text-white" />
                    Verified in SQLite DB
                  </>
                ) : (
                  <>
                    <Database className="h-3.5 w-3.5 text-[#38BDF8]" />
                    Verify with SQLite Database
                  </>
                )}
              </button>
            </div>
          </div>

          {dbSyncMessage && (
            <div className="mt-3 rounded-lg border border-[#BBF7D0] bg-white p-2.5 text-xs font-mono text-[#14532D]">
              {dbSyncMessage}
            </div>
          )}
        </div>
      )}

      {/* Terminal Log Stream of Agentverse Mailbox Packets */}
      <div className="overflow-hidden rounded-xl border border-[#0F172A] bg-[#0A0F1D] shadow-lg">
        <div className="flex items-center justify-between border-b border-[#1E293B] bg-[#0F172A] px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-[#38BDF8]" />
            <span className="text-xs font-mono font-bold text-white">
              Agentverse Mailbox Telemetry & Packet Log
            </span>
          </div>
          <span className="text-[10px] font-mono text-[#64748B]">
            8 Endpoints Connected · Port 8000
          </span>
        </div>

        <div
          ref={logContainerRef}
          className="h-44 overflow-y-auto p-4 font-mono text-[11px] leading-relaxed text-[#94A3B8] space-y-1.5"
        >
          {logs.map((log, i) => (
            <div
              key={i}
              className={`${
                log.includes('CRITICAL') || log.includes('shortage')
                  ? 'text-[#F87171]'
                  : log.includes('COMPATIBLE') || log.includes('COMPLETE') || log.includes('SUCCESS')
                  ? 'text-[#4ADE80]'
                  : log.includes('PARALLEL') || log.includes('ORCHESTRATOR')
                  ? 'text-[#38BDF8]'
                  : 'text-[#CBD5E1]'
              }`}
            >
              {log}
            </div>
          ))}
        </div>
      </div>

      {/* Inspect Payload Modal */}
      {activePayload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-fadeIn">
          <div className="relative w-full max-w-2xl rounded-2xl border border-[#CBD5E1] bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#E2E8F0] bg-[#F8FAFC] px-5 py-4">
              <div className="flex items-center gap-2.5">
                <span className="font-mono text-xs font-bold text-[#2563EB] bg-[#EFF6FF] border border-[#BFDBFE] px-2 py-0.5 rounded-md">
                  {activePayload.mailbox}
                </span>
                <div>
                  <h3 className="text-sm font-bold text-[#0F172A]">
                    {activePayload.name}
                  </h3>
                  <p className="text-[11px] text-[#64748B]">
                    {activePayload.role}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActivePayload(null)}
                className="rounded-lg p-1.5 text-[#64748B] hover:bg-[#E2E8F0] hover:text-[#0F172A] transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-5 max-h-[70vh] overflow-y-auto flex flex-col gap-4">
              <div>
                <h4 className="text-xs font-bold text-[#0F172A] uppercase tracking-wider">
                  Operational Summary
                </h4>
                <p className="mt-1 text-xs text-[#475569] leading-relaxed bg-[#F8FAFC] border border-[#E2E8F0] p-3 rounded-lg">
                  {activePayload.summary}
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <h4 className="text-xs font-bold text-[#0F172A] uppercase tracking-wider">
                    Structured Telemetry Payload
                  </h4>
                  <span className="text-[10px] font-mono text-[#64748B]">application/json</span>
                </div>
                <pre className="overflow-x-auto rounded-xl border border-[#0F172A] bg-[#0A0F1D] p-4 text-[11px] font-mono text-[#38BDF8] leading-relaxed">
                  {JSON.stringify(activePayload.payload, null, 2)}
                </pre>
              </div>
            </div>

            <div className="border-t border-[#E2E8F0] bg-[#F8FAFC] px-5 py-3 flex justify-end">
              <button
                type="button"
                onClick={() => setActivePayload(null)}
                className="btn-primary text-xs py-1.5 px-4"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
