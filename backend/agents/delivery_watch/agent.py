
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Literal

from pydantic import Field, field_validator

from shared.models import RecoveryPlan, StockRescueModel


DeliveryState = Literal[
    "ordered",
    "confirmed",
    "in_transit",
    "out_for_delivery",
    "delivered",
    "delayed",
    "cancelled",
]


class DeliveryEvent(StockRescueModel):
    event_id: str = Field(min_length=1, max_length=100)
    plan_id: str = Field(min_length=1, max_length=100)
    status: DeliveryState
    occurred_at: datetime
    source: Literal["carrier_api", "authorized_operator", "simulator"]
    reference: str | None = Field(default=None, max_length=100)
    details: str = Field(default="", max_length=300)

    @field_validator("occurred_at")
    @classmethod
    def validate_event_time(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("delivery event time must include a timezone")
        return value


class DeliveryWatchResult(StockRescueModel):
    plan_id: str
    status: Literal[
        "unknown",
        "in_progress",
        "delivered",
        "delayed",
        "cancelled",
        "overdue",
        "review_required",
    ]
    latest_event_id: str | None = None
    latest_event_at: datetime | None = None
    expected_completion_at: datetime | None = None
    alerts: list[str] = Field(default_factory=list, max_length=30)
    accepted_event_count: int = Field(ge=0, le=500)
    procurement_authorized: Literal[False] = False


def run_delivery_watch(
    plan: RecoveryPlan,
    events: list[DeliveryEvent | dict],
    *,
    as_of: datetime | None = None,
    allow_simulated: bool = False,
) -> DeliveryWatchResult:
    if not isinstance(plan, RecoveryPlan):
        raise ValueError("a validated recovery plan is required")

    checked_at = as_of or datetime.now(timezone.utc)

    if checked_at.tzinfo is None or checked_at.utcoffset() is None:
        raise ValueError("comparison time must include a timezone")

    if not isinstance(events, list) or len(events) > 500:
        raise ValueError("delivery event list is invalid")

    accepted = []
    alerts = []
    seen_ids = {}

    for raw_event in events:
        event = (
            raw_event
            if isinstance(raw_event, DeliveryEvent)
            else DeliveryEvent.model_validate(raw_event)
        )

        if event.plan_id != plan.plan_id:
            alerts.append("event_plan_mismatch")
            continue

        if event.occurred_at > checked_at + timedelta(minutes=2):
            alerts.append("event_timestamp_in_future")
            continue

        previous = seen_ids.get(event.event_id)

        if previous is not None:
            if previous != event:
                alerts.append("conflicting_duplicate_event")
            continue

        seen_ids[event.event_id] = event

        if event.source == "simulator" and not allow_simulated:
            alerts.append("simulated_event_ignored")
            continue

        accepted.append(event)

    if "conflicting_duplicate_event" in alerts:
        return DeliveryWatchResult(
            plan_id=plan.plan_id,
            status="review_required",
            expected_completion_at=plan.expected_completion_at,
            alerts=sorted(set(alerts))[:30],
            accepted_event_count=len(accepted),
        )

    accepted.sort(key=lambda event: (event.occurred_at, event.event_id))

    if not accepted:
        if (
            plan.expected_completion_at is not None
            and checked_at > plan.expected_completion_at
        ):
            status = "overdue"
            alerts.append("deadline_passed_without_verified_delivery")
        else:
            status = "unknown"

        return DeliveryWatchResult(
            plan_id=plan.plan_id,
            status=status,
            expected_completion_at=plan.expected_completion_at,
            alerts=sorted(set(alerts))[:30],
            accepted_event_count=0,
        )

    latest_time = accepted[-1].occurred_at
    latest_events = [
        event for event in accepted
        if event.occurred_at == latest_time
    ]

    latest_states = {event.status for event in latest_events}

    if len(latest_states) > 1:
        return DeliveryWatchResult(
            plan_id=plan.plan_id,
            status="review_required",
            expected_completion_at=plan.expected_completion_at,
            alerts=sorted(set(alerts + ["conflicting_latest_events"]))[:30],
            accepted_event_count=len(accepted),
        )

    latest = latest_events[-1]

    if latest.status == "delivered":
        status = "delivered"
    elif latest.status == "cancelled":
        status = "cancelled"
    elif latest.status == "delayed":
        status = "delayed"
    elif (
        plan.expected_completion_at is not None
        and checked_at > plan.expected_completion_at
    ):
        status = "overdue"
        alerts.append("delivery_deadline_passed")
    else:
        status = "in_progress"

    return DeliveryWatchResult(
        plan_id=plan.plan_id,
        status=status,
        latest_event_id=latest.event_id,
        latest_event_at=latest.occurred_at,
        expected_completion_at=plan.expected_completion_at,
        alerts=sorted(set(alerts))[:30],
        accepted_event_count=len(accepted),
    )
