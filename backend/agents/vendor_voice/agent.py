"""Vendor communication preparation specialist.

Prepares deterministic, structured communication drafts (inquiries, lead-time
confirmations, or order notifications) for human operators contacting suppliers.
Does NOT execute live calls, does NOT automate purchasing, and never simulates
vendor acceptance.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from decimal import Decimal
from typing import Literal
from uuid import uuid4

from pydantic import Field, field_validator

from shared.models import (
    DisruptionCase,
    MAX_QUANTITY,
    RecoveryPlan,
    StockRescueModel,
)


SAFE_TEXT_PATTERN = re.compile(r"[\x00-\x1f\x7f-\x9f]")


def _sanitize_untrusted_text(text: str, max_length: int = 500) -> str:
    """Removes control characters and truncates untrusted content."""
    cleaned = SAFE_TEXT_PATTERN.sub(" ", text)
    return " ".join(cleaned.split())[:max_length]


class VendorCommunicationDraft(StockRescueModel):
    draft_id: str = Field(min_length=1, max_length=100)
    case_id: str = Field(min_length=1, max_length=100)
    supplier_id: str = Field(min_length=1, max_length=100)
    supplier_name: str = Field(min_length=1, max_length=200)
    communication_type: Literal[
        "quote_inquiry",
        "lead_time_confirmation",
        "expedite_request",
        "order_notification",
    ]
    sku: str = Field(min_length=1, max_length=64)
    quantity: int = Field(gt=0, le=MAX_QUANTITY)
    quoted_price: Decimal | None = Field(default=None, gt=0, decimal_places=2)
    currency: str = Field(min_length=3, max_length=3)
    target_delivery_date: datetime | None = None
    script_text: str = Field(min_length=10, max_length=2000)
    key_discussion_points: list[str] = Field(default_factory=list, max_length=20)
    requires_human_approval: Literal[True] = True
    prepared_at: datetime

    @field_validator("target_delivery_date", "prepared_at")
    @classmethod
    def validate_tz(cls, v: datetime | None) -> datetime | None:
        if v is not None and (v.tzinfo is None or v.utcoffset() is None):
            raise ValueError("datetime must be timezone-aware")
        return v


class VendorCommunicationResult(StockRescueModel):
    case_id: str
    status: Literal["ready", "no_suppliers_to_contact", "blocked"]
    drafts: list[VendorCommunicationDraft] = Field(default_factory=list, max_length=50)
    disclaimers: list[str] = Field(default_factory=list, max_length=10)
    procurement_authorized: Literal[False] = False


def prepare_vendor_communication(
    case: DisruptionCase,
    *,
    plan: RecoveryPlan | None = None,
    offer_id: str | None = None,
    as_of: datetime | None = None,
) -> VendorCommunicationResult:
    """Prepares structured vendor communication drafts for human review."""
    if not isinstance(case, DisruptionCase):
        raise ValueError("a validated disruption case is required")

    checked_at = as_of or datetime.now(timezone.utc)
    if checked_at.tzinfo is None or checked_at.utcoffset() is None:
        raise ValueError("comparison time must include a timezone")

    drafts: list[VendorCommunicationDraft] = []
    disclaimers: list[str] = [
        "Human operator review required before transmitting or placing calls.",
        "Purchasing is not authorized by this communication draft.",
        "Supplier terms, pricing, and freight must be re-confirmed on contact.",
    ]

    # Scenario 1: Plan provided with allocated lines
    if plan is not None:
        if not isinstance(plan, RecoveryPlan):
            raise ValueError("recovery plan has an invalid type")
        if plan.case_id != case.case_id:
            return VendorCommunicationResult(
                case_id=case.case_id,
                status="blocked",
                drafts=[],
                disclaimers=["Plan case identifier does not match active disruption case."],
            )

        for line in plan.lines:
            supplier_name = next(
                (o.supplier_name for o in case.offers if o.supplier_id == line.supplier_id),
                line.supplier_id,
            )
            clean_name = _sanitize_untrusted_text(supplier_name, max_length=100)
            script = (
                f"Hello, this is StockRescue dispatch on behalf of warehouse operations. "
                f"We are preparing an urgent purchase requisition for SKU {line.sku}, quantity {line.quantity}. "
                f"We reference your quote for {plan.currency} {line.unit_price} each. "
                f"Please confirm inventory reservation and earliest ship date."
            )
            drafts.append(
                VendorCommunicationDraft(
                    draft_id=f"draft-{uuid4()}",
                    case_id=case.case_id,
                    supplier_id=line.supplier_id,
                    supplier_name=clean_name,
                    communication_type="order_notification",
                    sku=line.sku,
                    quantity=line.quantity,
                    quoted_price=line.unit_price,
                    currency=plan.currency,
                    target_delivery_date=plan.expected_completion_at,
                    script_text=script,
                    key_discussion_points=[
                        f"Confirm stock reservation for {line.quantity} units.",
                        f"Confirm agreed unit price of {plan.currency} {line.unit_price}.",
                        "Verify freight carrier and tracking availability.",
                    ],
                    requires_human_approval=True,
                    prepared_at=checked_at,
                )
            )

    # Scenario 2: Specific offer targeted
    elif offer_id is not None:
        matching_offer = next((o for o in case.offers if o.offer_id == offer_id), None)
        if matching_offer is None:
            return VendorCommunicationResult(
                case_id=case.case_id,
                status="blocked",
                drafts=[],
                disclaimers=[f"Target offer {offer_id} was not found in disruption case."],
            )
        if matching_offer.supplier_id == case.failed_supplier_id:
            return VendorCommunicationResult(
                case_id=case.case_id,
                status="blocked",
                drafts=[],
                disclaimers=["Cannot prepare communication for the disrupted failed supplier."],
            )

        clean_name = _sanitize_untrusted_text(matching_offer.supplier_name, max_length=100)
        req_qty = sum(j.quantity_required for j in case.jobs if j.sku.upper() == matching_offer.sku.upper()) or 1
        script = (
            f"Hello, this is StockRescue inquiry desk. We are reviewing quote {matching_offer.offer_id} "
            f"for SKU {matching_offer.sku}. Please confirm available quantity ({matching_offer.quantity_available}), "
            f"lead time in business days, and exact freight costs to our distribution center."
        )
        drafts.append(
            VendorCommunicationDraft(
                draft_id=f"draft-{uuid4()}",
                case_id=case.case_id,
                supplier_id=matching_offer.supplier_id,
                supplier_name=clean_name,
                communication_type="quote_inquiry",
                sku=matching_offer.sku,
                quantity=req_qty,
                quoted_price=matching_offer.unit_price,
                currency=matching_offer.currency,
                target_delivery_date=matching_offer.estimated_delivery_at,
                script_text=script,
                key_discussion_points=[
                    "Clarify freight costs if not included in quote.",
                    "Verify firm shipping lead time.",
                    f"Check minimum order quantity ({matching_offer.minimum_order_quantity}) compliance.",
                ],
                requires_human_approval=True,
                prepared_at=checked_at,
            )
        )

    # Scenario 3: General inquiries for candidate suppliers
    else:
        candidates = [
            o for o in case.offers
            if o.supplier_id != case.failed_supplier_id and o.is_active(checked_at)
        ]
        for offer in candidates[:5]:
            clean_name = _sanitize_untrusted_text(offer.supplier_name, max_length=100)
            req_qty = sum(j.quantity_required for j in case.jobs if j.sku.upper() == offer.sku.upper()) or 1
            script = (
                f"Hello {clean_name}, we are checking catalog availability for SKU {offer.sku}. "
                f"We require up to {req_qty} units under case {case.case_id}. "
                f"Please confirm current stock, lead time, and shipping rates."
            )
            drafts.append(
                VendorCommunicationDraft(
                    draft_id=f"draft-{uuid4()}",
                    case_id=case.case_id,
                    supplier_id=offer.supplier_id,
                    supplier_name=clean_name,
                    communication_type="quote_inquiry",
                    sku=offer.sku,
                    quantity=req_qty,
                    quoted_price=offer.unit_price,
                    currency=offer.currency,
                    target_delivery_date=offer.estimated_delivery_at,
                    script_text=script,
                    key_discussion_points=[
                        "Inquire about bulk purchase discounts.",
                        "Confirm expedited dispatch options.",
                    ],
                    requires_human_approval=True,
                    prepared_at=checked_at,
                )
            )

    status: Literal["ready", "no_suppliers_to_contact", "blocked"] = "ready" if drafts else "no_suppliers_to_contact"
    return VendorCommunicationResult(
        case_id=case.case_id,
        status=status,
        drafts=drafts,
        disclaimers=disclaimers,
    )
