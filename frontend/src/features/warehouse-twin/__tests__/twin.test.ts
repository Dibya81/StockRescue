import { describe, expect, it, vi } from 'vitest'
import {
  inventoryLotSchema,
  POSITION_ID_PATTERN,
  twinEventSchema,
  warehouseLayoutSchema,
  type InventoryLot,
  type TwinEvent,
} from '../data/schemas'
import { can, resolveTwinRole, type TwinRole } from '../data/roles'
import { countByStatus, LEGEND_ORDER, positionStatus, rollupStatus, STATUS_STYLES } from '../data/statusMapping'
import { formatPositionId, parsePositionId, rackPositionIds } from '../data/layoutGeometry'
import { applyToInventory, applyToRecovery, emptyRecoveryBundle } from '../data/reducers'
import { SimulationProvider } from '../data/simProvider'
import { LiveProvider } from '../data/liveProvider'
import { ProviderError } from '../data/provider'
import { parseScenario, SCENARIOS, type Scenario } from '../scenarios'

const loadScenario = () => SCENARIOS[0].load()
const actor = (role: TwinRole) => ({ id: `${role}@test`, role })

function lot(overrides: Partial<InventoryLot> = {}): InventoryLot {
  return {
    lotId: 'LOT-1',
    sku: 'SKU-1',
    description: 'Test part',
    positionId: 'A01-R01-L01-P01',
    qty: 10,
    unit: 'pcs',
    status: 'in_stock',
    reorderPoint: 5,
    lastUpdated: '2026-10-24T08:00:00Z',
    source: 'simulated',
    ...overrides,
  }
}

// ─────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────
describe('schemas', () => {
  it('accepts canonical position ids and rejects malformed ones', () => {
    expect(POSITION_ID_PATTERN.test('A01-R01-L02-P03')).toBe(true)
    expect(POSITION_ID_PATTERN.test('A1-R01-L02-P03')).toBe(false)
    expect(POSITION_ID_PATTERN.test('A01-R01-L02')).toBe(false)
  })

  it('validates inventory lots', () => {
    expect(inventoryLotSchema.safeParse(lot()).success).toBe(true)
    expect(inventoryLotSchema.safeParse(lot({ qty: -1 })).success).toBe(false)
    expect(inventoryLotSchema.safeParse(lot({ positionId: 'bad' })).success).toBe(false)
    expect(inventoryLotSchema.safeParse(lot({ lastUpdated: 'yesterday' })).success).toBe(false)
    // Missing location is allowed and must be shown as "No location assigned"
    expect(inventoryLotSchema.safeParse(lot({ positionId: null })).success).toBe(true)
  })

  it('discriminates stream events and rejects unknown types', () => {
    const ok = twinEventSchema.safeParse({ type: 'dock.status', dockId: 'D01', status: 'occupied', at: '2026-10-24T08:00:00Z' })
    expect(ok.success).toBe(true)
    expect(twinEventSchema.safeParse({ type: 'sensor.reading', at: '2026-10-24T08:00:00Z' }).success).toBe(false)
    expect(twinEventSchema.safeParse({ type: 'inventory.updated', at: '2026-10-24T08:00:00Z', lot: { sku: 'x' } }).success).toBe(false)
  })

  it('validates the bundled scenario, including every step event', async () => {
    const scenario = await loadScenario()
    expect(scenario.simulated).toBe(true)
    expect(warehouseLayoutSchema.safeParse(scenario.initialState.layout).success).toBe(true)
    expect(scenario.initialState.inventory.every(l => l.source === 'simulated')).toBe(true)
  })

  it('rejects a scenario with an invalid step event', async () => {
    const scenario = structuredClone(await loadScenario()) as Scenario
    scenario.steps[0].events = [{ type: 'inventory.updated', lot: { sku: 'broken' } }]
    expect(() => parseScenario(scenario)).toThrow(/step 0/)
  })
})

// ─────────────────────────────────────────────────────────
// Status mapping
// ─────────────────────────────────────────────────────────
describe('status mapping', () => {
  it('covers every legend status with a glyph and a pattern, not colour alone', () => {
    expect(LEGEND_ORDER).toHaveLength(8)
    for (const s of LEGEND_ORDER) {
      expect(STATUS_STYLES[s].glyph).toBeTruthy()
      expect(STATUS_STYLES[s].pattern).toBeTruthy()
      expect(STATUS_STYLES[s].label).toBeTruthy()
    }
    const patterns = new Set(LEGEND_ORDER.map(s => STATUS_STYLES[s].pattern))
    expect(patterns.size).toBe(LEGEND_ORDER.length)
  })

  it('rolls up to the most severe status', () => {
    expect(rollupStatus(['in_stock', 'low_stock'])).toBe('low_stock')
    expect(rollupStatus(['low_stock', 'disruption_affected', 'shortage'])).toBe('disruption_affected')
    expect(rollupStatus([])).toBe('empty')
  })

  it('treats a position without lots as empty rather than inventing stock', () => {
    expect(positionStatus(undefined)).toBe('empty')
    expect(positionStatus([])).toBe('empty')
    expect(positionStatus([lot({ status: 'quarantine' })])).toBe('quarantine')
  })

  it('counts lots per status', () => {
    const counts = countByStatus([lot(), lot({ lotId: '2', status: 'reserved' }), lot({ lotId: '3' })])
    expect(counts.in_stock).toBe(2)
    expect(counts.reserved).toBe(1)
    expect(counts.empty).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────
// Roles
// ─────────────────────────────────────────────────────────
describe('role gating', () => {
  it('only lets approvers approve or reject', () => {
    expect(can('approver', 'approve')).toBe(true)
    expect(can('approver', 'reject')).toBe(true)
    for (const role of ['operator', 'inventory_manager', 'procurement'] as const) {
      expect(can(role, 'approve')).toBe(false)
      expect(can(role, 'reject')).toBe(false)
    }
    expect(can('operator', 'view')).toBe(true)
    expect(can('operator', 'create_disruption')).toBe(false)
  })

  it('resolves roles from Supabase app_metadata', () => {
    expect(resolveTwinRole(undefined)).toBe('operator')
    expect(resolveTwinRole({ roles: ['procurement_approver'] })).toBe('approver')
    expect(resolveTwinRole({ roles: ['procurement', 'inventory_manager'] })).toBe('procurement')
    expect(resolveTwinRole({ twin_role: 'inventory_manager', roles: ['procurement_approver'] })).toBe('inventory_manager')
    expect(resolveTwinRole({ twin_role: 'superuser' })).toBe('operator')
  })
})

// ─────────────────────────────────────────────────────────
// Layout geometry & reducers
// ─────────────────────────────────────────────────────────
describe('layout geometry and reducers', () => {
  it('round-trips position ids', () => {
    const id = formatPositionId('A06-R05', 2, 3)
    expect(id).toBe('A06-R05-L02-P03')
    expect(parsePositionId(id)).toEqual({ aisleId: 'A06', rackId: 'A06-R05', level: 2, position: 3 })
    expect(parsePositionId('nope')).toBeNull()
  })

  it('enumerates rack positions from the layout', async () => {
    const scenario = await loadScenario()
    const rack = scenario.initialState.layout.racks[0]
    const ids = rackPositionIds(rack)
    expect(ids).toHaveLength(rack.levels * rack.positionsPerLevel)
    expect(ids.every(id => POSITION_ID_PATTERN.test(id))).toBe(true)
  })

  it('upserts lots and ignores unrelated events', () => {
    const base = [lot()]
    const at = '2026-10-24T09:00:00Z'
    const updated = applyToInventory(base, { type: 'inventory.updated', at, lot: lot({ qty: 3, status: 'low_stock' }) })
    expect(updated).toEqual([lot({ qty: 3, status: 'low_stock' })])
    expect(applyToInventory(base, { type: 'dock.status', at, dockId: 'D01', status: 'occupied' })).toBeNull()
  })

  it('scopes recovery events to their disruption', () => {
    const at = '2026-10-24T09:00:00Z'
    const run = { id: 'R1', disruptionId: 'D-1', agent: 'a', step: 's', status: 'done' as const, trace: [] }
    expect(applyToRecovery(emptyRecoveryBundle('D-1'), { type: 'agent.step', at, run })?.agentRuns).toHaveLength(1)
    expect(applyToRecovery(emptyRecoveryBundle('D-2'), { type: 'agent.step', at, run })).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────
// Simulation provider
// ─────────────────────────────────────────────────────────
describe('SimulationProvider', () => {
  const make = () => new SimulationProvider(loadScenario, { latencyMs: 0, speed: 1000 })

  async function stepUntil(sim: SimulationProvider, status: string, max = 30) {
    for (let i = 0; i < max && sim.getSimState().status !== status; i++) await sim.step()
    expect(sim.getSimState().status).toBe(status)
  }

  it('serves the scenario layout and inventory', async () => {
    const sim = make()
    const layout = await sim.getLayout()
    const inventory = await sim.getInventory()
    expect(layout.racks.length).toBeGreaterThan(50)
    expect(inventory.length).toBeGreaterThan(500)
    expect((await sim.getDisruptions())).toEqual([])
    const motors = await sim.searchInventory('mtr-7.5kw')
    expect(motors.reduce((n, l) => n + l.qty, 0)).toBe(35)
  })

  it('returns copies so callers cannot mutate provider state', async () => {
    const sim = make()
    const first = await sim.getInventory()
    first[0].qty = 999_999
    expect((await sim.getInventory())[0].qty).not.toBe(999_999)
  })

  it('stops at the approval gate and enforces the approver role', async () => {
    const sim = make()
    const events: TwinEvent[] = []
    sim.subscribe(e => events.push(e))
    await stepUntil(sim, 'awaiting_approval')

    expect(events[0].type).toBe('disruption.created')
    const [disruption] = await sim.getDisruptions()
    expect(disruption.requiredQty).toBe(100)
    expect(disruption.availableQty).toBe(35)
    const bundle = await sim.getRecovery(disruption.id)
    expect(bundle.plan?.status).toBe('awaiting_approval')
    expect(bundle.agentRuns.length).toBeGreaterThan(0)

    // Stepping does not pass the gate on its own
    await sim.step()
    expect(sim.getSimState().status).toBe('awaiting_approval')

    await expect(sim.approveRecovery(disruption.id, { optionId: 'OPT-A', comment: 'go' }, actor('operator')))
      .rejects.toMatchObject({ kind: 'forbidden' })
    await expect(sim.approveRecovery(disruption.id, { optionId: 'OPT-A', comment: '  ' }, actor('approver')))
      .rejects.toMatchObject({ kind: 'invalid' })
  })

  it('runs the full flow after approval and updates inventory', async () => {
    vi.useFakeTimers()
    try {
      const sim = make()
      await stepUntil(sim, 'awaiting_approval')
      const [disruption] = await sim.getDisruptions()
      await sim.approveRecovery(disruption.id, { optionId: 'OPT-A', comment: 'Within budget, meets deadline' }, actor('approver'))
      sim.pause()
      await stepUntil(sim, 'completed')

      const inventory = await sim.getInventory()
      const putAway = inventory.find(l => l.positionId === 'A06-R05-L01-P01')
      expect(putAway).toMatchObject({ sku: 'MTR-7.5KW-IE3', qty: 25, status: 'reserved', source: 'simulated' })
      const [resolved] = await sim.getDisruptions()
      expect(resolved.status).toBe('resolved')
      const shipments = await sim.getShipments()
      expect(shipments.find(s => s.id === 'SHP-90140')?.status).toBe('departed')
      const equipment = await sim.getEquipment()
      expect(equipment.every(e => e.status !== 'active')).toBe(true)
      const audit = await sim.getAudit()
      expect(audit.some(a => a.action === 'recovery.approved')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('ends the scenario when the plan is rejected', async () => {
    const sim = make()
    await stepUntil(sim, 'awaiting_approval')
    const [disruption] = await sim.getDisruptions()
    await sim.rejectRecovery(disruption.id, { optionId: null, comment: 'Need alternatives' }, actor('approver'))
    expect(sim.getSimState().status).toBe('rejected')
    expect((await sim.getRecovery(disruption.id)).plan?.status).toBe('rejected')
  })

  it('reset restores the initial state', async () => {
    const sim = make()
    await stepUntil(sim, 'awaiting_approval')
    await sim.reset()
    expect(sim.getSimState()).toMatchObject({ status: 'idle', stepIndex: 0 })
    expect(await sim.getDisruptions()).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────
// Live provider
// ─────────────────────────────────────────────────────────
describe('LiveProvider', () => {
  const respond = (status: number, body: unknown) =>
    vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(body), { status }))

  const make = (fetchImpl: typeof fetch) =>
    new LiveProvider({ baseUrl: 'http://api.test', getToken: async () => 'tok', fetchImpl, webSocketImpl: undefined })

  it('maps a missing endpoint to an explicit "unavailable" error', async () => {
    const live = make(respond(404, { detail: 'Not Found' }))
    await expect(live.getLayout()).rejects.toMatchObject({ kind: 'unavailable', endpoint: 'GET /api/warehouse/layout' })
  })

  it('rejects payloads that fail validation instead of rendering them', async () => {
    const live = make(respond(200, [{ sku: 'X', qty: 'lots' }]))
    await expect(live.getInventory()).rejects.toBeInstanceOf(ProviderError)
    await expect(live.getInventory()).rejects.toMatchObject({ kind: 'invalid' })
  })

  it('surfaces server-side authorization errors', async () => {
    const live = make(respond(403, { detail: 'Approver role required' }))
    await expect(live.approveRecovery('D-1', { optionId: 'O', comment: 'ok' }, actor('approver')))
      .rejects.toMatchObject({ kind: 'forbidden', message: 'Approver role required' })
  })

  it('sends the bearer token and parses valid data', async () => {
    const fetchImpl = respond(200, [lot({ source: 'live' })])
    const live = make(fetchImpl)
    await expect(live.getInventory()).resolves.toHaveLength(1)
    const init = fetchImpl.mock.calls[0][1]
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer tok')
  })

  it('reports the network as unreachable when fetch fails', async () => {
    const live = make(vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(live.getShipments()).rejects.toMatchObject({ kind: 'network' })
  })
})
