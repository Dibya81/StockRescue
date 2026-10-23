// ─────────────────────────────────────────────────────────
// StockRescue API Types — matches backend Pydantic schemas
// ─────────────────────────────────────────────────────────

export type Currency = string // ISO 4217, e.g. "INR", "USD"

export type StockStatus = 'normal' | 'low' | 'shortage' | 'unknown'
export type RecoveryPlanStatus = 'proposed' | 'approved' | 'revoked' | 'expired'
export type CompatibilityVerdict = 'compatible' | 'incompatible' | 'unverified'

// ── Inventory & BOM ──────────────────────────────────────

export interface InventoryRecord {
  sku: string
  location: string | null
  available_quantity: number
  required_quantity: number
  shortage: number
  min_stock_level: number | null
  status: StockStatus
}

export interface JobRequirement {
  job_id: string
  sku: string
  required_quantity: number
  deadline: string | null // ISO datetime
  priority: number | null
}

// ── Suppliers ────────────────────────────────────────────

export interface SupplierOffer {
  supplier_id: string
  sku: string
  available_quantity: number | null
  unit_price: string // Decimal as string
  currency: Currency
  lead_time_days: number | null
  quote_expires_at: string | null // ISO datetime
  notes: string | null
}

export interface CompatibilityAssessment {
  requested_sku: string
  candidate_sku: string
  supplier_id: string
  verdict: CompatibilityVerdict
  confidence: number | null
  explanation: string | null
  assessed_at: string | null
}

// ── Cases ────────────────────────────────────────────────

export interface DisruptionCase {
  case_id: string
  affected_sku: string
  failed_supplier_id: string
  delayed_until: string | null
  budget: string | null // Decimal as string
  currency: Currency
  created_at: string
  updated_at: string
  jobs: JobRequirement[]
  inventory: InventoryRecord[]
  offers: SupplierOffer[]
  compatibility: CompatibilityAssessment[]
}

export interface CaseCreateRequest {
  affected_sku: string
  failed_supplier_id: string
  delayed_until?: string | null
  budget?: string | null
  currency?: Currency
  jobs?: JobRequirement[]
  inventory?: InventoryRecord[]
  offers?: SupplierOffer[]
  compatibility?: CompatibilityAssessment[]
}

// ── Recovery Plans ───────────────────────────────────────

export interface RecoveryLineItem {
  supplier_id: string
  sku: string
  quantity: number
  unit_price: string
  currency: Currency
  lead_time_days: number | null
  notes: string | null
}

export interface RecoveryPlan {
  plan_id: string
  case_id: string
  status: RecoveryPlanStatus
  total_cost: string // Decimal as string
  currency: Currency
  line_items: RecoveryLineItem[]
  risk_findings: string[]
  outstanding_uncertainties: string[]
  created_at: string
  updated_at: string
}

// ── Approvals ────────────────────────────────────────────

export interface ProcurementApproval {
  approval_id: string
  case_id: string
  plan_id: string
  plan_fingerprint: string
  approved_by: string
  approved_at: string
  expires_at: string
  max_total_cost: string
  currency: Currency
  revoked: boolean
  revoked_by: string | null
  revoked_at: string | null
  revocation_reason: string | null
}

export interface ApprovalCreateRequest {
  max_total_cost: string // Decimal as string
  currency: Currency
  expires_at: string // ISO datetime with timezone
}

export interface ApprovalRevokeRequest {
  revocation_reason: string
}

// ── Audit Events ─────────────────────────────────────────

export interface AuditEvent {
  event_id: string
  event_type: string
  entity_type: string
  entity_id: string
  actor_id: string
  occurred_at: string
  details: Record<string, unknown>
}

// ── Health ───────────────────────────────────────────────

export interface HealthResponse {
  status: 'ok'
  app_name: string
  demo_mode: boolean
  real_purchasing_enabled: false
}

// ── List Wrappers ────────────────────────────────────────

export interface ListResponse<T> {
  items: T[]
  count: number
  limit: number
  offset: number
}

export type CaseListResponse = ListResponse<DisruptionCase>
export type PlanListResponse = ListResponse<RecoveryPlan>
export type ApprovalListResponse = ListResponse<ProcurementApproval>
export type AuditEventListResponse = ListResponse<AuditEvent>

// ── API Error ────────────────────────────────────────────

export interface ApiError {
  status: number
  detail: string | { loc: string[]; type: string; msg: string }[]
}
