import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import type {
  CaseListResponse,
  DisruptionCase,
  PlanListResponse,
  RecoveryPlan,
  ApprovalListResponse,
  ProcurementApproval,
  AuditEventListResponse,
  HealthResponse,
  CaseCreateRequest,
  ApprovalCreateRequest,
  ApprovalRevokeRequest,
} from '@/types/api'

// ── Health ────────────────────────────────────────────────
export function useHealth() {
  const { apiClient } = useAuth()
  return useQuery<HealthResponse>({
    queryKey: ['health'],
    queryFn: () => apiClient.getHealth() as Promise<HealthResponse>,
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
}

// ── Cases ─────────────────────────────────────────────────
export function useCases(params?: { limit?: number; offset?: number }) {
  const { apiClient } = useAuth()
  return useQuery<CaseListResponse>({
    queryKey: ['cases', params],
    queryFn: () => apiClient.listCases(params) as Promise<CaseListResponse>,
  })
}

export function useCase(caseId: string | undefined) {
  const { apiClient } = useAuth()
  return useQuery<DisruptionCase>({
    queryKey: ['cases', caseId],
    queryFn: () => apiClient.getCase(caseId!) as Promise<DisruptionCase>,
    enabled: !!caseId,
  })
}

export function useCreateCase() {
  const { apiClient } = useAuth()
  const qc = useQueryClient()
  return useMutation<DisruptionCase, Error, CaseCreateRequest>({
    mutationFn: body => apiClient.createCase(body) as Promise<DisruptionCase>,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cases'] }),
  })
}

// ── Plans ─────────────────────────────────────────────────
export function usePlans(caseId: string | undefined) {
  const { apiClient } = useAuth()
  return useQuery<PlanListResponse>({
    queryKey: ['plans', caseId],
    queryFn: () => apiClient.listPlans(caseId!) as Promise<PlanListResponse>,
    enabled: !!caseId,
  })
}

export function useCreatePlan() {
  const { apiClient } = useAuth()
  const qc = useQueryClient()
  return useMutation<RecoveryPlan, Error, string>({
    mutationFn: caseId => apiClient.createPlan(caseId) as Promise<RecoveryPlan>,
    onSuccess: (_data, caseId) => qc.invalidateQueries({ queryKey: ['plans', caseId] }),
  })
}

// ── Approvals ─────────────────────────────────────────────
export function useApprovals(caseId: string | undefined, planId: string | undefined) {
  const { apiClient } = useAuth()
  return useQuery<ApprovalListResponse>({
    queryKey: ['approvals', caseId, planId],
    queryFn: () => apiClient.listApprovals(caseId!, planId!) as Promise<ApprovalListResponse>,
    enabled: !!caseId && !!planId,
  })
}

export function useActiveApproval(caseId: string | undefined, planId: string | undefined) {
  const { apiClient } = useAuth()
  return useQuery<ProcurementApproval | null>({
    queryKey: ['approvals', caseId, planId, 'active'],
    queryFn: () => apiClient.getActiveApproval(caseId!, planId!) as Promise<ProcurementApproval | null>,
    enabled: !!caseId && !!planId,
  })
}

export function useCreateApproval() {
  const { apiClient } = useAuth()
  const qc = useQueryClient()
  return useMutation<
    ProcurementApproval,
    Error,
    { caseId: string; planId: string; body: ApprovalCreateRequest }
  >({
    mutationFn: ({ caseId, planId, body }) =>
      apiClient.createApproval(caseId, planId, body) as Promise<ProcurementApproval>,
    onSuccess: (_data, { caseId, planId }) => {
      qc.invalidateQueries({ queryKey: ['approvals', caseId, planId] })
    },
  })
}

export function useRevokeApproval() {
  const { apiClient } = useAuth()
  const qc = useQueryClient()
  return useMutation<
    ProcurementApproval,
    Error,
    { caseId: string; planId: string; approvalId: string; body: ApprovalRevokeRequest }
  >({
    mutationFn: ({ caseId, planId, approvalId, body }) =>
      apiClient.revokeApproval(caseId, planId, approvalId, body) as Promise<ProcurementApproval>,
    onSuccess: (_data, { caseId, planId }) => {
      qc.invalidateQueries({ queryKey: ['approvals', caseId, planId] })
    },
  })
}

// ── Audit ─────────────────────────────────────────────────
export function useAuditEvents(caseId: string | undefined, planId: string | undefined) {
  const { apiClient } = useAuth()
  return useQuery<AuditEventListResponse>({
    queryKey: ['audit', caseId, planId],
    queryFn: () => apiClient.listAuditEvents(caseId!, planId!) as Promise<AuditEventListResponse>,
    enabled: !!caseId && !!planId,
  })
}
