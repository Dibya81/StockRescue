import { z } from 'zod'
import {
  auditEventSchema,
  disruptionSchema,
  equipmentSchema,
  inventoryLotSchema,
  recoveryBundleSchema,
  shipmentSchema,
  twinEventSchema,
  warehouseLayoutSchema,
  type TwinEvent,
} from '../data/schemas'

// Scenario files hold SIMULATED data only. Timestamps written as "@now"
// are stamped with the wall-clock time when the step is played.

export const NOW_TOKEN = '@now'

const scenarioStepSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  delayMs: z.number().int().nonnegative(),
  gate: z.enum(['approval']).optional(),
  events: z.array(z.record(z.string(), z.unknown())),
  audit: auditEventSchema.omit({ id: true, at: true }).optional(),
})

export const scenarioSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  simulated: z.literal(true),
  initialState: z.object({
    layout: warehouseLayoutSchema,
    inventory: z.array(inventoryLotSchema),
    shipments: z.array(shipmentSchema),
    equipment: z.array(equipmentSchema),
    audit: z.array(auditEventSchema),
    disruptions: z.array(disruptionSchema),
    recovery: z.array(recoveryBundleSchema),
  }),
  steps: z.array(scenarioStepSchema).min(1),
})

export type Scenario = z.infer<typeof scenarioSchema>
export type ScenarioStep = z.infer<typeof scenarioStepSchema>

function stamp(value: unknown, nowIso: string): unknown {
  if (value === NOW_TOKEN) return nowIso
  if (Array.isArray(value)) return value.map(v => stamp(v, nowIso))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stamp(v, nowIso)]))
  }
  return value
}

/** Turns a raw scenario event into a validated TwinEvent stamped at `nowIso`. */
export function materializeEvent(raw: Record<string, unknown>, nowIso: string): TwinEvent {
  return twinEventSchema.parse({ ...(stamp(raw, nowIso) as Record<string, unknown>), at: nowIso })
}

/** Parses and fully validates a scenario, including every step event. */
export function parseScenario(json: unknown): Scenario {
  const scenario = scenarioSchema.parse(json)
  const probe = new Date(0).toISOString()
  scenario.steps.forEach((step, i) => {
    step.events.forEach((raw, j) => {
      const result = twinEventSchema.safeParse({ ...(stamp(raw, probe) as Record<string, unknown>), at: probe })
      if (!result.success) {
        throw new Error(`Scenario ${scenario.id}: step ${i} (${step.id}) event ${j} is invalid: ${result.error.message}`)
      }
    })
  })
  return scenario
}

export const SCENARIOS = [
  {
    id: 'motor-component-shortage',
    title: 'Critical motor component supplier failure',
    load: async (): Promise<Scenario> => {
      const text = (await import('./motor-component-shortage.json?raw')).default
      return parseScenario(JSON.parse(text))
    },
  },
] as const

export type ScenarioId = (typeof SCENARIOS)[number]['id']
export const DEFAULT_SCENARIO_ID: ScenarioId = 'motor-component-shortage'
