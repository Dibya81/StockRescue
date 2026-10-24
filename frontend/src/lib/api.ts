import { type ApiError } from '@/types/api'

// ─────────────────────────────────────────────────────────
// Typed API Client
// All requests attach the Supabase Bearer token from session.
// Base URL from VITE_API_BASE_URL — no embedded localhost.
// ─────────────────────────────────────────────────────────

const BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') || 'http://localhost:8000'

export class ApiClientError extends Error {
  public readonly status: number
  public readonly detail: ApiError['detail']

  constructor(status: number, detail: ApiError['detail']) {
    super(typeof detail === 'string' ? detail : 'Request validation failed')
    this.name = 'ApiClientError'
    this.status = status
    this.detail = detail
  }
}

async function request<T>(
  path: string,
  options: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const { token, ...fetchOptions } = options

  const headers = new Headers(fetchOptions.headers)
  headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)

  let response: Response
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...fetchOptions,
      headers,
    })
  } catch (err) {
    throw new ApiClientError(
      0,
      `Unable to reach backend API at ${BASE_URL}. Verify the server is running. (${(err as Error).message})`,
    )
  }

  const text = await response.text()

  // Guard against HTML error pages or SPA index.html fallback
  if (text.trim().startsWith('<')) {
    throw new ApiClientError(
      response.ok ? 502 : response.status,
      `Received an HTML response instead of JSON from ${BASE_URL}${path}. Verify FastAPI backend is running.`,
    )
  }

  if (!response.ok) {
    let detail: ApiError['detail'] = response.statusText || `Request failed with status ${response.status}`
    try {
      if (text) {
        const body = JSON.parse(text)
        if (body?.detail !== undefined) detail = body.detail
      }
    } catch {
      // Keep statusText if body isn't JSON
    }
    throw new ApiClientError(response.status, detail)
  }

  // 204 No Content or empty body
  if (!text.trim()) return undefined as unknown as T

  try {
    return JSON.parse(text) as T
  } catch {
    throw new ApiClientError(response.status, `Malformed JSON received from ${path}`)
  }
}

// ── Public API factory ────────────────────────────────────

export function createApiClient(getToken: () => Promise<string | null>) {
  async function call<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = await getToken()
    return request<T>(path, { ...options, token })
  }

  return {
    // Health
    getHealth: () => call('/health'),

    // Cases
    listCases: (params?: { limit?: number; offset?: number }) => {
      const qs = new URLSearchParams()
      if (params?.limit != null) qs.set('limit', String(params.limit))
      if (params?.offset != null) qs.set('offset', String(params.offset))
      return call(`/cases?${qs}`)
    },
    getCase: (caseId: string) => call(`/cases/${encodeURIComponent(caseId)}`),
    createCase: (body: unknown) =>
      call('/cases', { method: 'POST', body: JSON.stringify(body) }),

    // Plans
    listPlans: (caseId: string, params?: { limit?: number; offset?: number }) => {
      const qs = new URLSearchParams()
      if (params?.limit != null) qs.set('limit', String(params.limit))
      if (params?.offset != null) qs.set('offset', String(params.offset))
      return call(`/cases/${encodeURIComponent(caseId)}/plans?${qs}`)
    },
    createPlan: (caseId: string) =>
      call(`/cases/${encodeURIComponent(caseId)}/plans`, { method: 'POST' }),

    // Approvals
    listApprovals: (caseId: string, planId: string, params?: { limit?: number; offset?: number }) => {
      const qs = new URLSearchParams()
      if (params?.limit != null) qs.set('limit', String(params.limit))
      if (params?.offset != null) qs.set('offset', String(params.offset))
      return call(
        `/cases/${encodeURIComponent(caseId)}/plans/${encodeURIComponent(planId)}/approvals?${qs}`,
      )
    },
    getActiveApproval: (caseId: string, planId: string) =>
      call(
        `/cases/${encodeURIComponent(caseId)}/plans/${encodeURIComponent(planId)}/approvals/active`,
      ),
    createApproval: (caseId: string, planId: string, body: unknown) =>
      call(
        `/cases/${encodeURIComponent(caseId)}/plans/${encodeURIComponent(planId)}/approvals`,
        { method: 'POST', body: JSON.stringify(body) },
      ),
    revokeApproval: (caseId: string, planId: string, approvalId: string, body: unknown) =>
      call(
        `/cases/${encodeURIComponent(caseId)}/plans/${encodeURIComponent(planId)}/approvals/${encodeURIComponent(approvalId)}/revoke`,
        { method: 'POST', body: JSON.stringify(body) },
      ),
    getApproval: (approvalId: string) =>
      call(`/approvals/${encodeURIComponent(approvalId)}`),

    // Audit
    listAuditEvents: (caseId: string, planId: string, params?: { limit?: number; offset?: number }) => {
      const qs = new URLSearchParams()
      if (params?.limit != null) qs.set('limit', String(params.limit))
      if (params?.offset != null) qs.set('offset', String(params.offset))
      return call(
        `/cases/${encodeURIComponent(caseId)}/plans/${encodeURIComponent(planId)}/approvals/audit?${qs}`,
      )
    },

    // Extended operational records
    listSuppliers: () => call<any[]>('/suppliers'),
    listInventory: () => call<any[]>('/inventory'),
    listDeliveries: () => call<any[]>('/deliveries'),
    listCommunications: () => call<any[]>('/communications'),
  }
}

export type ApiClient = ReturnType<typeof createApiClient>
