
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from math import ceil
from typing import Literal

from pydantic import Field

from shared.models import (
    CompatibilityStatus,
    DisruptionCase,
    StockRescueModel,
)


MAX_QUANTITY = 1_000_000

BLOCKING_FLAGS = {
    "failed_supplier",
    "quote_from_future",
    "quote_expired",
    "currency_mismatch",
    "insufficient_supplier_quantity",
    "known_incompatible",
    "conflicting_compatibility",
}

REVIEW_FLAGS = {
    "quote_expiry_unknown",
    "freight_unknown",
    "lead_time_unknown",
    "compatibility_unknown",
}


class QuoteRiskItem(StockRescueModel):
    offer_id: str
    supplier_id: str
    sku: str
    status: Literal["eligible", "review_required", "blocked"]
    flags: list[str] = Field(default_factory=list, max_length=20)
    required_order_quantity: int = Field(ge=0, le=MAX_QUANTITY)
    material_cost: Decimal | None = Field(default=None, ge=0)
    freight_cost: Decimal | None = Field(default=None, ge=0)
    total_cost: Decimal | None = Field(default=None, ge=0)


class QuoteRiskResult(StockRescueModel):
    case_id: str
    as_of: datetime
    required_quantity: int = Field(ge=0, le=MAX_QUANTITY)
    offers: list[QuoteRiskItem] = Field(default_factory=list, max_length=500)
    eligible_offer_ids: list[str] = Field(default_factory=list, max_length=500)
    blocked_offer_ids: list[str] = Field(default_factory=list, max_length=500)
    review_offer_ids: list[str] = Field(default_factory=list, max_length=500)
    status: Literal["ready", "review_required", "blocked", "no_demand", "no_offers"]


def _aware_time(value: datetime | None) -> datetime:
    result = value or datetime.now(timezone.utc)

    if result.tzinfo is None or result.utcoffset() is None:
        raise ValueError("comparison time must include a timezone")

    return result


def _compatibility(
    case: DisruptionCase,
    sku: str,
    as_of: datetime,
) -> str:
    target = case.affected_sku.upper()

    if sku.upper() == target:
        return CompatibilityStatus.COMPATIBLE.value

    assessments = [
        item
        for item in case.compatibility
        if item.requested_sku.upper() == target
        and item.candidate_sku.upper() == sku.upper()
        and item.assessed_at <= as_of
    ]

    if not assessments:
        return CompatibilityStatus.UNKNOWN.value

    latest_time = max(item.assessed_at for item in assessments)
    latest = [
        item.status.value
        for item in assessments
        if item.assessed_at == latest_time
    ]

    statuses = set(latest)

    if len(statuses) != 1:
        return "conflict"

    return next(iter(statuses))


def run_quote_risk(
    case: DisruptionCase,
    *,
    required_quantity: int | None = None,
    as_of: datetime | None = None,
) -> QuoteRiskResult:
    if not isinstance(case, DisruptionCase):
        raise ValueError("a validated disruption case is required")

    checked_at = _aware_time(as_of)

    if required_quantity is None:
        required_quantity = sum(
            job.quantity_required
            for job in case.jobs
            if job.sku.upper() == case.affected_sku.upper()
        )

    if (
        not isinstance(required_quantity, int)
        or isinstance(required_quantity, bool)
        or not 0 <= required_quantity <= MAX_QUANTITY
    ):
        raise ValueError("required quantity is invalid")

    items = []
    eligible_ids = []
    blocked_ids = []
    review_ids = []

    for offer in case.offers:
        flags = []
        blocked = False
        needs_review = False
        quantity = 0
        material_cost = None
        freight_cost = offer.freight_cost
        total_cost = None

        if offer.supplier_id == case.failed_supplier_id:
            flags.append("failed_supplier")
            blocked = True

        if offer.quoted_at > checked_at:
            flags.append("quote_from_future")
            blocked = True

        if offer.valid_until is None:
            flags.append("quote_expiry_unknown")
            needs_review = True
        elif offer.valid_until <= checked_at:
            flags.append("quote_expired")
            blocked = True

        if offer.currency != case.currency:
            flags.append("currency_mismatch")
            blocked = True

        compatibility = _compatibility(case, offer.sku, checked_at)

        if compatibility == CompatibilityStatus.INCOMPATIBLE.value:
            flags.append("known_incompatible")
            blocked = True
        elif compatibility == "conflict":
            flags.append("conflicting_compatibility")
            blocked = True
        elif compatibility != CompatibilityStatus.COMPATIBLE.value:
            flags.append("compatibility_unknown")
            needs_review = True

        if offer.freight_cost is None:
            flags.append("freight_unknown")
            needs_review = True

        if offer.lead_time_days is None:
            flags.append("lead_time_unknown")
            needs_review = True

        if required_quantity > 0:
            quantity = max(
                required_quantity,
                offer.minimum_order_quantity,
            )
            quantity = ceil(quantity / offer.pack_size) * offer.pack_size

            if offer.quantity_available < quantity:
                flags.append("insufficient_supplier_quantity")
                blocked = True
            else:
                material_cost = offer.unit_price * quantity

                if freight_cost is not None:
                    total_cost = material_cost + freight_cost

        if blocked:
            status = "blocked"
            blocked_ids.append(offer.offer_id)
        elif needs_review:
            status = "review_required"
            review_ids.append(offer.offer_id)
        else:
            status = "eligible"
            eligible_ids.append(offer.offer_id)

        items.append(
            QuoteRiskItem(
                offer_id=offer.offer_id,
                supplier_id=offer.supplier_id,
                sku=offer.sku,
                status=status,
                flags=flags[:20],
                required_order_quantity=quantity,
                material_cost=material_cost,
                freight_cost=freight_cost,
                total_cost=total_cost,
            )
        )

    if required_quantity == 0:
        status = "no_demand"
    elif not items:
        status = "no_offers"
    elif eligible_ids:
        status = "ready"
    elif review_ids:
        status = "review_required"
    else:
        status = "blocked"

    return QuoteRiskResult(
        case_id=case.case_id,
        as_of=checked_at,
        required_quantity=required_quantity,
        offers=items,
        eligible_offer_ids=eligible_ids,
        blocked_offer_ids=blocked_ids,
        review_offer_ids=review_ids,
        status=status,
    )
