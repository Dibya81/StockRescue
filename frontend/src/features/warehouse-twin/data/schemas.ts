import { z } from 'zod'

// ─────────────────────────────────────────────────────────
// Warehouse Twin data contract.
// Every REST response, WebSocket message and scenario record is parsed
// through these schemas before it reaches the store or the scene.
// ─────────────────────────────────────────────────────────

export const POSITION_ID_PATTERN = /^A\d{2}-R\d{2}-L\d{2}-P\d{2}$/

const isoDate = z.string().refine(v => !Number.isNaN(Date.parse(v)), 'Expected an ISO-8601 timestamp')
const money = z.object({ amount: z.number().nonnegative(), currency: z.string().length(3) })
const point = z.object({ x: z.number(), z: z.number() })

export const dataSourceSchema = z.enum(['live', 'simulated'])

// ── Layout ───────────────────────────────────────────────

export const zoneKindSchema = z.enum([
  'receiving', 'storage', 'inspection', 'dispatch', 'equipment', 'control', 'staging',
])

export const zoneSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: zoneKindSchema,
  bounds: z.object({ x: z.number(), z: z.number(), width: z.number().positive(), depth: z.number().positive() }),
})

export const aisleSchema = z.object({
  id: z.string().regex(/^A\d{2}$/),
  zoneId: z.string().min(1),
  x: z.number(),
  z: z.number(),
  length: z.number().positive(),
  width: z.number().positive(),
  orientation: z.enum(['x', 'z']),
})

export const rackSchema = z.object({
  id: z.string().regex(/^A\d{2}-R\d{2}$/),
  aisleId: z.string().regex(/^A\d{2}$/),
  side: z.enum(['left', 'right']),
  x: z.number(),
  z: z.number(),
  width: z.number().positive(),
  depth: z.number().positive(),
  levels: z.number().int().min(1).max(12),
  positionsPerLevel: z.number().int().min(1).max(8),
  levelHeight: z.number().positive(),
})

export const dockStatusSchema = z.enum(['available', 'occupied', 'maintenance'])

export const dockSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  x: z.number(),
  z: z.number(),
  side: z.enum(['north', 'south', 'east', 'west']),
  purpose: z.enum(['receiving', 'dispatch']),
  status: dockStatusSchema,
})

export const warehouseLayoutSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.number().int(),
  building: z.object({ width: z.number().positive(), depth: z.number().positive(), height: z.number().positive() }),
  zones: z.array(zoneSchema),
  aisles: z.array(aisleSchema),
  racks: z.array(rackSchema),
  docks: z.array(dockSchema),
})

// ── Inventory ────────────────────────────────────────────

export const inventoryStatusSchema = z.enum([
  'in_stock', 'low_stock', 'shortage', 'disruption_affected', 'reserved', 'incoming', 'quarantine', 'empty',
])

export const inventoryLotSchema = z.object({
  lotId: z.string().min(1),
  sku: z.string().min(1),
  description: z.string().nullable(),
  positionId: z.string().regex(POSITION_ID_PATTERN).nullable(),
  qty: z.number().nonnegative(),
  unit: z.string().min(1),
  status: inventoryStatusSchema,
  reorderPoint: z.number().nonnegative().nullable(),
  lastUpdated: isoDate,
  source: dataSourceSchema,
})

// ── Suppliers, disruptions, recovery ─────────────────────

export const supplierRefSchema = z.object({ id: z.string().min(1), name: z.string().min(1) })

export const disruptionStatusSchema = z.enum([
  'open', 'analyzing', 'awaiting_approval', 'approved', 'rejected', 'resolved',
])

export const shortageLineSchema = z.object({
  sku: z.string().min(1),
  description: z.string().nullable(),
  requiredQty: z.number().nonnegative(),
  availableQty: z.number().nonnegative(),
  gapQty: z.number().nonnegative(),
  unit: z.string().min(1),
})

export const disruptionSchema = z.object({
  id: z.string().min(1),
  sku: z.string().min(1),
  description: z.string().nullable(),
  failedSupplier: supplierRefSchema,
  reason: z.string().nullable(),
  requiredQty: z.number().nonnegative(),
  availableQty: z.number().nonnegative(),
  unit: z.string().min(1),
  deadline: isoDate,
  budget: money.nullable(),
  affectedJobs: z.array(z.object({
    jobId: z.string().min(1),
    name: z.string().min(1),
    requiredQty: z.number().nonnegative(),
    deadline: isoDate.nullable(),
  })),
  shortages: z.array(shortageLineSchema),
  status: disruptionStatusSchema,
  createdAt: isoDate,
})

export const recoveryOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  lines: z.array(z.object({
    supplier: supplierRefSchema,
    sku: z.string().min(1),
    qty: z.number().positive(),
    unitPrice: z.number().nonnegative(),
  })).min(1),
  totalCost: money,
  eta: isoDate,
  meetsDeadline: z.boolean(),
  withinBudget: z.boolean(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(1),
  sources: z.array(z.string().min(1)),
})

export const allocationSchema = z.object({
  id: z.string().min(1),
  optionId: z.string().min(1),
  sku: z.string().min(1),
  qty: z.number().positive(),
  destinationPositionId: z.string().regex(POSITION_ID_PATTERN),
  status: z.enum(['pending', 'reserved', 'received', 'put_away']),
})

export const recoveryPlanSchema = z.object({
  id: z.string().min(1),
  disruptionId: z.string().min(1),
  status: z.enum(['draft', 'awaiting_approval', 'approved', 'rejected']),
  options: z.array(recoveryOptionSchema),
  recommendedOptionId: z.string().nullable(),
  generatedAt: isoDate,
  allocations: z.array(allocationSchema),
})

export const approvalSchema = z.object({
  id: z.string().min(1),
  planId: z.string().min(1),
  optionId: z.string().nullable(),
  approver: z.string().min(1),
  decision: z.enum(['approved', 'rejected']),
  comment: z.string(),
  timestamp: isoDate,
})

export const agentRunSchema = z.object({
  id: z.string().min(1),
  disruptionId: z.string().min(1),
  agent: z.string().min(1),
  step: z.string().min(1),
  status: z.enum(['pending', 'running', 'done', 'failed']),
  trace: z.array(z.string()),
})

/** GET /api/recovery/:disruptionId */
export const recoveryBundleSchema = z.object({
  disruptionId: z.string().min(1),
  plan: recoveryPlanSchema.nullable(),
  agentRuns: z.array(agentRunSchema),
  approvals: z.array(approvalSchema),
})

// ── Shipments & equipment ────────────────────────────────

export const shipmentStatusSchema = z.enum(['scheduled', 'arriving', 'at_dock', 'unloading', 'loading', 'departed'])

export const shipmentSchema = z.object({
  id: z.string().min(1),
  supplier: supplierRefSchema,
  vehicleType: z.enum(['delivery_truck', 'trailer_truck', 'container_truck']),
  dockId: z.string().nullable(),
  status: shipmentStatusSchema,
  sku: z.string().nullable(),
  qty: z.number().nonnegative().nullable(),
  eta: isoDate.nullable(),
  milestones: z.array(z.object({ label: z.string().min(1), at: isoDate.nullable() })),
})

export const equipmentTypeSchema = z.enum([
  'forklift', 'reach_truck', 'electric_pallet_jack', 'manual_pallet_jack',
  'order_picker', 'conveyor', 'trolley', 'scissor_lift',
])

export const equipmentSchema = z.object({
  id: z.string().min(1),
  type: equipmentTypeSchema,
  label: z.string().min(1),
  status: z.enum(['idle', 'active', 'charging', 'maintenance']),
  home: point,
  currentTask: z.object({
    id: z.string().min(1),
    kind: z.string().min(1),
    description: z.string().min(1),
    fromPositionId: z.string().nullable(),
    toPositionId: z.string().nullable(),
  }).nullable(),
})

export const auditEventSchema = z.object({
  id: z.string().min(1),
  at: isoDate,
  actor: z.string().min(1),
  action: z.string().min(1),
  entity: z.string().min(1),
  entityId: z.string().min(1),
  detail: z.string(),
})

// ── Event stream (/ws/events) ────────────────────────────

const eventBase = { at: isoDate }

export const twinEventSchema = z.discriminatedUnion('type', [
  z.object({ ...eventBase, type: z.literal('inventory.updated'), lot: inventoryLotSchema }),
  z.object({ ...eventBase, type: z.literal('disruption.created'), disruption: disruptionSchema }),
  z.object({ ...eventBase, type: z.literal('recovery.updated'), plan: recoveryPlanSchema }),
  z.object({ ...eventBase, type: z.literal('agent.step'), run: agentRunSchema }),
  z.object({ ...eventBase, type: z.literal('approval.changed'), approval: approvalSchema }),
  z.object({ ...eventBase, type: z.literal('shipment.status'), shipment: shipmentSchema }),
  z.object({ ...eventBase, type: z.literal('equipment.task'), equipment: equipmentSchema }),
  z.object({ ...eventBase, type: z.literal('dock.status'), dockId: z.string().min(1), status: dockStatusSchema }),
])

// ── Request bodies ───────────────────────────────────────

export const createDisruptionInputSchema = z.object({
  sku: z.string().min(1),
  failedSupplierId: z.string().min(1),
  requiredQty: z.number().positive(),
  deadline: isoDate,
  budget: money.nullable(),
  reason: z.string().nullable(),
})

export const decisionInputSchema = z.object({
  optionId: z.string().nullable(),
  comment: z.string().trim().min(1, 'A comment is required'),
})

// ── Inferred types ───────────────────────────────────────

export type DataSource = z.infer<typeof dataSourceSchema>
export type ZoneKind = z.infer<typeof zoneKindSchema>
export type Zone = z.infer<typeof zoneSchema>
export type Aisle = z.infer<typeof aisleSchema>
export type Rack = z.infer<typeof rackSchema>
export type DockStatus = z.infer<typeof dockStatusSchema>
export type Dock = z.infer<typeof dockSchema>
export type WarehouseLayout = z.infer<typeof warehouseLayoutSchema>
export type InventoryStatus = z.infer<typeof inventoryStatusSchema>
export type InventoryLot = z.infer<typeof inventoryLotSchema>
export type SupplierRef = z.infer<typeof supplierRefSchema>
export type DisruptionStatus = z.infer<typeof disruptionStatusSchema>
export type ShortageLine = z.infer<typeof shortageLineSchema>
export type Disruption = z.infer<typeof disruptionSchema>
export type RecoveryOption = z.infer<typeof recoveryOptionSchema>
export type Allocation = z.infer<typeof allocationSchema>
export type RecoveryPlan = z.infer<typeof recoveryPlanSchema>
export type Approval = z.infer<typeof approvalSchema>
export type AgentRun = z.infer<typeof agentRunSchema>
export type RecoveryBundle = z.infer<typeof recoveryBundleSchema>
export type ShipmentStatus = z.infer<typeof shipmentStatusSchema>
export type Shipment = z.infer<typeof shipmentSchema>
export type EquipmentType = z.infer<typeof equipmentTypeSchema>
export type Equipment = z.infer<typeof equipmentSchema>
export type AuditEvent = z.infer<typeof auditEventSchema>
export type TwinEvent = z.infer<typeof twinEventSchema>
export type TwinEventType = TwinEvent['type']
export type CreateDisruptionInput = z.infer<typeof createDisruptionInputSchema>
export type DecisionInput = z.infer<typeof decisionInputSchema>
