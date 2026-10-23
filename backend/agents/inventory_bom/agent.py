from __future__ import annotations
from shared.agent_contracts import (
    AgentContext,
    AgentIssue,
    AgentStatus,
    InventoryBomResult,
    MAX_CASE_DEMAND,
    validate_case,
    validate_context,
)
from shared.models import DisruptionCase, MAX_QUANTITY
from tools.inventory import (
    InventoryInputError,
    normalize_sku,
    summarize_inventory,
)

def run_inventory_bom(
    case: DisruptionCase,
    context: AgentContext,
) -> InventoryBomResult:
    clean_case = validate_case(case)
    clean_context = validate_context(context, clean_case)
    sku = normalize_sku(clean_case.affected_sku)
    issues: list[AgentIssue] = []
    demand = 0
    unsupported_skus = []
    for job in clean_case.jobs:
        job_sku = normalize_sku(job.sku)
        if job_sku != sku:
            if job_sku not in unsupported_skus:
                unsupported_skus.append(job_sku)
            continue
        demand += job.quantity_required
        if demand > MAX_CASE_DEMAND:
            demand = MAX_CASE_DEMAND
            issues.append(AgentIssue(code="demand_limit_exceeded", detail="Combined job demand exceeds the supported case limit."))
            break

    try:
        positions = summarize_inventory(clean_case.inventory)
    except InventoryInputError as exc:
        raise ValueError("inventory data failed validation") from exc

    position = positions.get(sku)
    found = position is not None
    on_hand = position.quantity_on_hand if position else 0
    committed = position.quantity_committed if position else 0
    available = position.available_quantity if position else 0
    locations = list(position.locations[:100]) if position else []
    shortage = max(0, demand - max(0, available))

    if not found:
        issues.append(AgentIssue(code="inventory_record_missing", detail="No inventory record exists for the affected SKU; stock must be verified."))
    if not clean_case.jobs:
        issues.append(AgentIssue(code="affected_jobs_missing", detail="No affected jobs were supplied."))
    if unsupported_skus:
        issues.append(AgentIssue(code="multiple_skus_unsupported", detail="This workflow supports one disrupted SKU per case."))
    if demand > MAX_QUANTITY:
        issues.append(AgentIssue(code="optimizer_demand_limit", detail="The recovery optimizer supports at most one million required units per case."))
    if not found or demand > MAX_QUANTITY:
        status = AgentStatus.BLOCKED
    elif not clean_case.jobs or unsupported_skus:
        status = AgentStatus.PARTIAL
    else:
        status = AgentStatus.COMPLETE
    return InventoryBomResult(
        context=clean_context,
        status=status,
        issues=issues[:30],
        affected_sku=sku,
        demand_quantity=demand,
        inventory_found=found,
        quantity_on_hand=on_hand,
        quantity_committed=committed,
        available_quantity=available,
        shortage_quantity=shortage,
        locations=locations,
        unsupported_job_skus=unsupported_skus[:50],
    )