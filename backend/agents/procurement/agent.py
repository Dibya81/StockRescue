
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from decimal import Decimal
from typing import Literal
from uuid import uuid4

from pydantic import Field

from shared.models import (
    CompatibilityStatus,
    DisruptionCase,
    ProcurementApproval,
    RecoveryPlan,
    RecoveryPlanStatus,
    StockRescueModel,
)


class ProcurementDraftLine(StockRescueModel):
    offer_id: str
    supplier_id: str
    sku: str
    quantity: int = Field(gt=0)
    unit_price: Decimal = Field(gt=0)
    freight_cost: Decimal = Field(ge=0)


class PurchaseOrderDraft(StockRescueModel):
    draft_id: str = Field(default_factory=lambda: str(uuid4()))
    case_id: str
    plan_id: str
    approval_id: str
    lines: list[ProcurementDraftLine] = Field(min_length=1, max_length=100)
    total_cost: Decimal = Field(ge=0)
    currency: str
    external_submission_enabled: Literal[False] = False


class ProcurementGateResult(StockRescueModel):
    status: Literal["blocked", "draft_prepared"]
    case_id: str
    plan_id: str
    blockers: list[str] = Field(default_factory=list, max_length=50)
    draft: PurchaseOrderDraft | None = None
    external_submission_enabled: Literal[False] = False


def _aware_time(value: datetime | None) -> datetime:
    checked_at = value or datetime.now(timezone.utc)

    if checked_at.tzinfo is None or checked_at.utcoffset() is None:
        raise ValueError("comparison time must include a timezone")

    return checked_at


def _compatible(case: DisruptionCase, sku: str, as_of: datetime) -> bool:
    if sku.upper() == case.affected_sku.upper():
        return True

    assessments = [
        item
        for item in case.compatibility
        if item.requested_sku.upper() == case.affected_sku.upper()
        and item.candidate_sku.upper() == sku.upper()
        and item.assessed_at <= as_of
    ]

    if not assessments:
        return False

    latest_time = max(item.assessed_at for item in assessments)
    latest = {
        item.status
        for item in assessments
        if item.assessed_at == latest_time
    }

    return latest == {CompatibilityStatus.COMPATIBLE}


def prepare_procurement_draft(
    case: DisruptionCase,
    plan: RecoveryPlan,
    approval: ProcurementApproval,
    *,
    current_plan: RecoveryPlan | None = None,
    approval_verified: bool = False,
    as_of: datetime | None = None,
) -> ProcurementGateResult:
    if not isinstance(case, DisruptionCase):
        raise ValueError("a validated disruption case is required")

    if not isinstance(plan, RecoveryPlan):
        raise ValueError("a validated recovery plan is required")

    if not isinstance(approval, ProcurementApproval):
        raise ValueError("a validated procurement approval is required")

    checked_at = _aware_time(as_of)
    blockers = []

    if approval_verified is not True:
        blockers.append("approval_source_not_verified")

    if current_plan is None:
        blockers.append("current_persisted_plan_not_verified")
    elif not isinstance(current_plan, RecoveryPlan):
        blockers.append("current_persisted_plan_invalid")
    elif (
        current_plan.plan_id != plan.plan_id
        or current_plan.case_id != case.case_id
        or current_plan.total_cost != plan.total_cost
        or current_plan.currency != plan.currency
        or current_plan.status != plan.status
        or current_plan.lines != plan.lines
    ):
        blockers.append("plan_changed_since_approval")

    if plan.case_id != case.case_id:
        blockers.append("plan_case_mismatch")

    if approval.case_id != case.case_id:
        blockers.append("approval_case_mismatch")

    if approval.plan_id != plan.plan_id:
        blockers.append("approval_plan_mismatch")

    if approval.approved_at > checked_at:
        blockers.append("approval_from_future")

    if approval.is_revoked():
        blockers.append("approval_revoked")

    if approval.is_expired(checked_at):
        blockers.append("approval_expired")

    if approval.plan_fingerprint and approval.plan_fingerprint != plan.compute_fingerprint():
        blockers.append("plan_fingerprint_mismatch")

    if plan.status != RecoveryPlanStatus.PROPOSED:
        blockers.append("plan_not_proposed")

    if not plan.lines:
        blockers.append("plan_has_no_purchase_lines")

    if approval.currency != case.currency or plan.currency != case.currency:
        blockers.append("currency_mismatch")

    if plan.total_cost > approval.max_total_cost:
        blockers.append("approval_cost_limit_exceeded")

    if case.budget is not None and plan.total_cost > case.budget:
        blockers.append("case_budget_exceeded")

    if plan.expected_completion_at is None:
        blockers.append("plan_completion_unknown")

    if not plan.lines:
        return ProcurementGateResult(
            status="blocked",
            case_id=case.case_id,
            plan_id=plan.plan_id,
            blockers=blockers or ["plan_has_no_purchase_lines"],
        )

    if len({line.offer_id for line in plan.lines}) != len(plan.lines):
        blockers.append("duplicate_offer_lines")

    offers = {offer.offer_id: offer for offer in case.offers}
    draft_lines = []
    expected_cost = Decimal("0")
    planned_quantity = 0

    for line in plan.lines:
        offer = offers.get(line.offer_id)

        if offer is None:
            blockers.append("offer_not_found")
            continue

        if offer.supplier_id != line.supplier_id:
            blockers.append("supplier_changed")

        if offer.sku.upper() != line.sku.upper():
            blockers.append("sku_changed")

        if offer.supplier_id == case.failed_supplier_id:
            blockers.append("failed_supplier_selected")

        if offer.currency != case.currency:
            blockers.append("offer_currency_mismatch")

        if offer.unit_price != line.unit_price:
            blockers.append("unit_price_changed")

        if offer.quoted_at > checked_at:
            blockers.append("quote_from_future")

        if offer.valid_until is None or offer.valid_until <= checked_at:
            blockers.append("quote_expired_or_unverified")

        if offer.freight_cost is None:
            blockers.append("freight_unknown")

        if offer.lead_time_days is None:
            blockers.append("lead_time_unknown")

        if offer.quantity_available < line.quantity:
            blockers.append("supplier_quantity_changed")

        if (
            line.quantity < offer.minimum_order_quantity
            or line.quantity % offer.pack_size != 0
        ):
            blockers.append("order_quantity_violates_supplier_terms")

        if not _compatible(case, line.sku, checked_at):
            blockers.append("compatibility_not_verified")

        if (
            offer.lead_time_days is not None
            and plan.expected_completion_at is not None
        ):
            expected_arrival = offer.quoted_at + timedelta(
                days=offer.lead_time_days
            )

            if plan.expected_completion_at < expected_arrival:
                blockers.append("plan_completion_precedes_supplier_eta")

        if offer.freight_cost is None:
            continue

        material_cost = line.unit_price * line.quantity
        expected_cost += material_cost + offer.freight_cost
        planned_quantity += line.quantity

        draft_lines.append(
            ProcurementDraftLine(
                offer_id=line.offer_id,
                supplier_id=line.supplier_id,
                sku=line.sku,
                quantity=line.quantity,
                unit_price=line.unit_price,
                freight_cost=offer.freight_cost,
            )
        )

    demand = sum(
        job.quantity_required
        for job in case.jobs
        if job.sku.upper() == case.affected_sku.upper()
    )

    physical = sum(
        record.quantity_on_hand
        for record in case.inventory
        if record.sku.upper() == case.affected_sku.upper()
    )

    committed = sum(
        record.quantity_committed
        for record in case.inventory
        if record.sku.upper() == case.affected_sku.upper()
    )

    available = max(0, physical - committed)
    shortage = max(0, demand - available)

    if planned_quantity < shortage:
        blockers.append("purchase_quantity_does_not_cover_shortage")

    if any(
        job.sku.upper() != case.affected_sku.upper()
        for job in case.jobs
    ):
        blockers.append("case_contains_unsupported_skus")

    if expected_cost != plan.total_cost:
        blockers.append("plan_cost_does_not_match_current_quotes")

    if blockers:
        return ProcurementGateResult(
            status="blocked",
            case_id=case.case_id,
            plan_id=plan.plan_id,
            blockers=sorted(set(blockers))[:50],
        )

    draft = PurchaseOrderDraft(
        case_id=case.case_id,
        plan_id=plan.plan_id,
        approval_id=approval.approval_id,
        lines=draft_lines,
        total_cost=expected_cost,
        currency=case.currency,
    )

    return ProcurementGateResult(
        status="draft_prepared",
        case_id=case.case_id,
        plan_id=plan.plan_id,
        draft=draft,
    )
