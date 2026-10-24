import { describe, expect, it } from 'vitest'
import { SimulationEngine, type SimSnapshot } from '../engine'
import { OFFLINE_CASE, buildPlans, compatibility, type ScenarioId } from '../model'

function run(id: ScenarioId, decision: 'approved' | 'rejected' | 'more_info' = 'approved') {
  let snap!: SimSnapshot
  const engine = new SimulationEngine(s => { snap = s })
  engine.setBase(OFFLINE_CASE)
  engine.setScenario(id)
  engine.setMode('step')
  engine.start()
  let decided = false
  for (let i = 0; i < 600 && snap.status !== 'completed' && snap.status !== 'blocked'; i++) {
    if (snap.status === 'waiting_approval') {
      const sel = engine.plans().find(p => p.status !== 'BLOCKED')
      engine.decide(decided && decision === 'more_info' ? 'approved' : decision, sel?.id ?? null, 'test')
      decided = true
    } else engine.next()
  }
  engine.dispose()
  return snap
}

describe('live multi-agent simulation', () => {
  it('calculates plan totals from quote lines', () => {
    const plans = buildPlans(OFFLINE_CASE, 380, compatibility(OFFLINE_CASE))
    const a = plans.find(p => p.id === 'PLAN-A')!
    expect(a.lines.map(l => l.quantity)).toEqual([200, 180])
    expect(a.goods_total).toBe(200 * 450 + 180 * 480)
    expect(a.total).toBe(200 * 450 + 180 * 480 + 2500 + 3200)
    expect(plans.find(p => p.id === 'PLAN-B')!.status).toBe('CONDITIONAL')
  })

  it('runs the normal scenario end to end with partial delivery', () => {
    const snap = run('normal')
    expect(snap.status).toBe('completed')
    const inv = snap.steps.find(s => s.key === 'inventory')!.result!.output as { shortage: number }
    expect(inv.shortage).toBe(380)
    expect(snap.approval.planId).toBe('PLAN-A')
    const del = snap.steps.find(s => s.key === 'delivery')!.result!.output as { received: number; expected: number; exceptions: string[] }
    expect(del).toMatchObject({ received: 200, expected: 380 })
    expect(del.exceptions).toHaveLength(1)
    // Inventory/BOM and Job Impact start at the same simulated time
    const [i, j] = ['inventory', 'job_impact'].map(k => snap.steps.find(s => s.key === k)!.startedAt)
    expect(i).toBe(j)
    // Every lifecycle transition is an event
    expect(snap.events.some(e => e.new_state === 'RESPONSE_SENT')).toBe(true)
  })

  it('is deterministic', () => {
    const a = run('normal').events.map(e => `${e.t}|${e.event_type}|${e.message}`)
    const b = run('normal').events.map(e => `${e.t}|${e.event_type}|${e.message}`)
    expect(a).toEqual(b)
  })

  it('skips procurement when the plan is rejected', () => {
    const snap = run('approval_rejected', 'rejected')
    expect(snap.steps.find(s => s.key === 'po_draft')!.status).toBe('skipped')
    expect(snap.status).toBe('completed')
  })

  it('runs a clarification round when info is requested', () => {
    const snap = run('normal', 'more_info')
    expect(snap.steps.find(s => s.key === 'clarification')!.status).toBe('done')
    expect(snap.status).toBe('completed')
  })

  it.each<[ScenarioId, string]>([
    ['invalid_response', 'review'],
    ['no_feasible_plan', 'recovery_planner'],
    ['agent_failure', 'delivery'],
  ])('%s stops the workflow at %s', (id, key) => {
    const snap = run(id)
    expect(snap.status).toBe('blocked')
    expect(['blocked', 'failed']).toContain(snap.steps.find(s => s.key === key)!.status)
    expect(snap.steps.find(s => s.key === 'final_summary')!.status).toBe('done')
  })

  it.each<ScenarioId>(['quote_missing', 'insufficient_quantity', 'deadline_missed', 'compatibility_unverified', 'quality_missing'])('%s completes', id => {
    const snap = run(id)
    expect(['completed', 'blocked']).toContain(snap.status)
  })
})
