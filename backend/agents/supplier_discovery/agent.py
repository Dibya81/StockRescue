from __future__ import annotations
from datetime import timedelta
from pydantic import ValidationError
from shared.agent_contracts import (
    AgentContext,
    AgentIssue,
    AgentStatus,
    DiscoveredOffer,
    InventoryBomResult,
    SupplierDiscoveryResult,
    MAX_AGENT_OFFERS,
    validate_case,
    validate_context,
)
from shared.models import DisruptionCase
from tools.inventory import InventoryInputError, normalize_sku
from tools.supplier_catalog import SupplierCatalogError, find_supplier_offers, validate_supplier_offers

def run_supplier_discovery(
    case: DisruptionCase,
    inventory: InventoryBomResult,
    context: AgentContext,
) -> SupplierDiscoveryResult:
    clean_case = validate_case(case)
    clean_context = validate_context(context, clean_case)
    if inventory.context.case_id != clean_context.case_id or inventory.context.workflow_id != clean_context.workflow_id or inventory.context.trace_id != clean_context.trace_id:
        raise ValueError("inventory result does not match the active workflow")
    sku = normalize_sku(clean_case.affected_sku)
    issues: list[AgentIssue] = []
    failed_supplier_count = sum(1 for offer in clean_case.offers if offer.supplier_id == clean_case.failed_supplier_id)
    active_offers = [offer for offer in clean_case.offers if offer.supplier_id != clean_case.failed_supplier_id]
    if not inventory.inventory_found:
        issues.append(AgentIssue(code="inventory_unverified", detail="Supplier candidates were not evaluated because inventory is unverified."))
        return SupplierDiscoveryResult(
            context=clean_context,
            status=AgentStatus.BLOCKED,
            issues=issues,
            affected_sku=sku,
            required_quantity=inventory.shortage_quantity,
            offers=[],
            excluded_failed_supplier_offers=failed_supplier_count,
            excluded_unavailable_or_stale_offers=len(active_offers),
        )

    required_quantity = inventory.shortage_quantity
    if required_quantity == 0:
        return SupplierDiscoveryResult(
            context=clean_context,
            status=AgentStatus.COMPLETE,
            issues=[AgentIssue(code="no_shortage", detail="Verified available inventory covers the reported demand.")],
            affected_sku=sku,
            required_quantity=0,
            offers=[],
            excluded_failed_supplier_offers=failed_supplier_count,
            excluded_unavailable_or_stale_offers=len(active_offers),
        )
    if required_quantity > 1_000_000:
        return SupplierDiscoveryResult(
            context=clean_context,
            status=AgentStatus.BLOCKED,
            issues=[AgentIssue(code="quantity_limit_exceeded", detail="Supplier discovery supports at most one million required units.")],
            affected_sku=sku,
            required_quantity=required_quantity,
            offers=[],
            excluded_failed_supplier_offers=failed_supplier_count,
            excluded_unavailable_or_stale_offers=len(active_offers),
        )
    try:
        clean_offers = validate_supplier_offers(active_offers)
    except SupplierCatalogError as exc:
        raise ValueError("supplier data failed validation") from exc
    candidate_skus = set()
    for offer in clean_offers:
        try:
            candidate_skus.add(normalize_sku(offer.sku))
        except InventoryInputError as exc:
            raise ValueError("supplier SKU failed validation") from exc
    ordered_skus = sorted(candidate_skus - {sku})
    if sku in candidate_skus:
        ordered_skus.insert(0, sku)
    earliest_deadline = min(
        (job.required_by for job in clean_case.jobs if normalize_sku(job.sku) == sku),
        default=None,
    )
    discovered: list[DiscoveredOffer] = []
    matching_ids: set[str] = set()
    for candidate_sku in ordered_skus:
        try:
            candidates = find_supplier_offers(
                candidate_sku,
                required_quantity,
                clean_offers,
                currency=clean_case.currency,
                as_of=clean_context.as_of,
            )
        except SupplierCatalogError as exc:
            raise ValueError("supplier search failed validation") from exc
        for candidate in candidates:
            offer = candidate.offer
            delivery_at = (
                clean_context.as_of + timedelta(days=offer.lead_time_days)
                if offer.lead_time_days is not None
                else None
            )
            try:
                item = DiscoveredOffer(
                    offer_id=offer.offer_id,
                    supplier_id=offer.supplier_id,
                    supplier_name=offer.supplier_name,
                    sku=normalize_sku(offer.sku),
                    currency=offer.currency,
                    quantity_available=offer.quantity_available,
                    required_quantity=required_quantity,
                    order_quantity=candidate.order_quantity,
                    unit_price=offer.unit_price,
                    material_cost=candidate.material_cost,
                    freight_cost=offer.freight_cost,
                    total_cost=candidate.total_cost,
                    quoted_at=offer.quoted_at,
                    valid_until=offer.valid_until,
                    lead_time_days=offer.lead_time_days,
                    estimated_delivery_at=delivery_at,
                    meets_earliest_deadline=(delivery_at <= earliest_deadline) if delivery_at is not None and earliest_deadline is not None else None,
                )
            except ValidationError:
                issues.append(AgentIssue(code="offer_out_of_range", detail="A supplier offer exceeded supported result limits and was excluded."))
                continue
            discovered.append(item)
            matching_ids.add(offer.offer_id)

    discovered.sort(key=lambda item: (item.sku, item.supplier_id, item.offer_id))
    truncated = len(discovered) > MAX_AGENT_OFFERS
    if truncated:
        discovered = discovered[:MAX_AGENT_OFFERS]
        issues.append(AgentIssue(code="offer_result_limit", detail="Supplier results were capped at the supported candidate limit."))
    if not discovered:
        status = AgentStatus.BLOCKED
        issues.append(AgentIssue(code="no_usable_supplier_offers", detail="No current supplier offer can cover the required order quantity."))
    else:
        unknown_cost = any(item.total_cost is None for item in discovered)
        unknown_eta = any(item.estimated_delivery_at is None for item in discovered)
        if unknown_cost:
            issues.append(AgentIssue(code="freight_unknown", detail="Some offers have unknown freight charges and cannot be ranked by complete cost."))
        if unknown_eta:
            issues.append(AgentIssue(code="delivery_unknown", detail="Some offers lack a verified delivery estimate."))
        status = AgentStatus.PARTIAL if issues else AgentStatus.COMPLETE
    return SupplierDiscoveryResult(
        context=clean_context,
        status=status,
        issues=issues[:30],
        affected_sku=sku,
        required_quantity=required_quantity,
        offers=discovered,
        excluded_failed_supplier_offers=failed_supplier_count,
        excluded_unavailable_or_stale_offers=max(0, len(active_offers) - len(matching_ids)),
    )