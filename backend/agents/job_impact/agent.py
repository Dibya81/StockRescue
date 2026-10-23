from __future__ import annotations
from shared.agent_contracts import (
    AffectedJob,
    AgentContext,
    AgentIssue,
    AgentStatus,
    InventoryBomResult,
    JobImpactResult,
    MAX_CASE_DEMAND,
    validate_case,
    validate_context,
)
from shared.models import DisruptionCase
from tools.inventory import normalize_sku

def run_job_impact(
    case: DisruptionCase,
    inventory: InventoryBomResult,
    context: AgentContext,
) -> JobImpactResult:
    clean_case = validate_case(case)
    clean_context = validate_context(context, clean_case)
    if inventory.context.case_id != clean_context.case_id or inventory.context.workflow_id != clean_context.workflow_id or inventory.context.trace_id != clean_context.trace_id:
        raise ValueError("inventory result does not match the active workflow")
    sku = normalize_sku(clean_case.affected_sku)
    issues: list[AgentIssue] = []
    supported_jobs = []
    unsupported_skus = []
    for job in clean_case.jobs:
        job_sku = normalize_sku(job.sku)
        if job_sku != sku:
            if job_sku not in unsupported_skus:
                unsupported_skus.append(job_sku)
            continue
        supported_jobs.append(job)
    if not supported_jobs:
        issues.append(AgentIssue(code="affected_jobs_missing", detail="No jobs require the affected SKU."))
    if unsupported_skus:
        issues.append(AgentIssue(code="multiple_skus_unsupported", detail="Jobs requiring other SKUs need separate recovery cases."))
    if clean_case.delayed_until is None:
        issues.append(AgentIssue(code="delay_time_unknown", detail="The supplier's expected recovery time is unknown."))
    if not inventory.inventory_found:
        issues.append(AgentIssue(code="inventory_unverified", detail="Job allocation cannot rely on missing inventory records."))
    ordered_jobs = sorted(
        supported_jobs,
        key=lambda job: (job.required_by, -job.priority, job.job_id),
    )
    remaining_stock = max(0, inventory.available_quantity) if inventory.inventory_found else 0
    output_jobs = []
    total_demand = 0
    uncovered_total = 0

    for job in ordered_jobs:
        total_demand += job.quantity_required
        covered = min(job.quantity_required, remaining_stock)
        remaining_stock -= covered
        uncovered = job.quantity_required - covered
        uncovered_total += uncovered
        delay_risk = None
        if clean_case.delayed_until is not None:
            delay_risk = uncovered > 0 and clean_case.delayed_until > job.required_by
        output_jobs.append(
            AffectedJob(
                job_id=job.job_id,
                sku=sku,
                quantity_required=job.quantity_required,
                required_by=job.required_by,
                priority=job.priority,
                covered_from_stock=covered,
                uncovered_quantity=uncovered,
                deadline_risk_from_delay=delay_risk,
            )
        )

    if total_demand > MAX_CASE_DEMAND:
        raise ValueError("combined job demand exceeds the supported case limit")
    if not supported_jobs or not inventory.inventory_found:
        status = AgentStatus.BLOCKED
    elif unsupported_skus or clean_case.delayed_until is None:
        status = AgentStatus.PARTIAL
    else:
        status = AgentStatus.COMPLETE
    return JobImpactResult(
        context=clean_context,
        status=status,
        issues=issues[:30],
        affected_sku=sku,
        jobs=output_jobs,
        total_demand=total_demand,
        inventory_available=inventory.available_quantity,
        uncovered_demand=uncovered_total,
        earliest_deadline=min((job.required_by for job in supported_jobs), default=None),
        unsupported_job_skus=unsupported_skus[:50],
    )