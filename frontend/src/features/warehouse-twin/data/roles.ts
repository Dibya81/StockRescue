export const TWIN_ROLES = ['operator', 'inventory_manager', 'procurement', 'approver'] as const
export type TwinRole = (typeof TWIN_ROLES)[number]

export type TwinAction = 'view' | 'create_disruption' | 'analyze_recovery' | 'approve' | 'reject'

const PERMISSIONS: Record<TwinRole, readonly TwinAction[]> = {
  operator:          ['view'],
  inventory_manager: ['view', 'create_disruption'],
  procurement:       ['view', 'create_disruption', 'analyze_recovery'],
  approver:          ['view', 'create_disruption', 'analyze_recovery', 'approve', 'reject'],
}

export const ROLE_LABELS: Record<TwinRole, string> = {
  operator: 'Operator',
  inventory_manager: 'Inventory manager',
  procurement: 'Procurement',
  approver: 'Approver',
}

export function can(role: TwinRole, action: TwinAction): boolean {
  return PERMISSIONS[role].includes(action)
}

function isTwinRole(value: unknown): value is TwinRole {
  return typeof value === 'string' && (TWIN_ROLES as readonly string[]).includes(value)
}

/**
 * Resolves the twin role from Supabase `app_metadata`. An explicit
 * `twin_role` wins; otherwise the highest-privilege role in `roles` is used.
 * The existing `procurement_approver` role maps to `approver`.
 */
export function resolveTwinRole(appMetadata: unknown): TwinRole {
  if (!appMetadata || typeof appMetadata !== 'object') return 'operator'
  const meta = appMetadata as { twin_role?: unknown; roles?: unknown }
  if (isTwinRole(meta.twin_role)) return meta.twin_role

  const roles = Array.isArray(meta.roles) ? meta.roles.filter((r): r is string => typeof r === 'string') : []
  if (roles.includes('approver') || roles.includes('procurement_approver')) return 'approver'
  if (roles.includes('procurement')) return 'procurement'
  if (roles.includes('inventory_manager')) return 'inventory_manager'
  return 'operator'
}
