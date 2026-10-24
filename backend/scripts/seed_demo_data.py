from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from shared.config import get_settings
from shared.models import (
    AuditEvent,
    CompatibilityAssessment,
    CompatibilityStatus,
    DisruptionCase,
    InventoryRecord,
    JobRequirement,
    ProcurementApproval,
    RecoveryLine,
    RecoveryPlan,
    RecoveryPlanStatus,
    SupplierOffer,
)
from services.warehouse_api.repository import RepositoryConflict, SQLiteWarehouseRepository


def build_motor_case() -> tuple[DisruptionCase, RecoveryPlan, ProcurementApproval, AuditEvent]:
    now = datetime.now(timezone.utc)
    tomorrow_morning = now + timedelta(hours=18)

    case = DisruptionCase(
        case_id="CASE-MTR-4471",
        affected_sku="SKU-IND-MTR-4471",
        failed_supplier_id="SUP-PRIMARY-FAILED",
        reported_at=now - timedelta(minutes=45),
        delayed_until=now + timedelta(days=7),
        budget=Decimal("14500.00"),
        currency="USD",
        inventory=[
            InventoryRecord(
                sku="SKU-IND-MTR-4471",
                quantity_on_hand=2,
                quantity_committed=2,
                unit_cost=Decimal("1250.00"),
                location="LOC-A01-L1-P2",
            )
        ],
        jobs=[
            JobRequirement(
                job_id="JOB-LINE3-EXPEDITE",
                sku="SKU-IND-MTR-4471",
                quantity_required=12,
                required_by=tomorrow_morning,
                priority=5,
                description="Packaging Line 3 Drive Motor Burnout — Critical Stoppage",
            )
        ],
        offers=[
            SupplierOffer(
                offer_id="OFFER-SIEMENS-MTR",
                supplier_id="SUP-SIEMENS-01",
                supplier_name="Siemens Industrial Technologies",
                sku="SKU-IND-MTR-4471",
                quantity_available=4,
                unit_price=Decimal("1150.00"),
                freight_cost=Decimal("380.00"),
                currency="USD",
                minimum_order_quantity=1,
                pack_size=1,
                lead_time_days=1,
                quoted_at=now - timedelta(minutes=30),
                valid_until=now + timedelta(days=2),
            ),
            SupplierOffer(
                offer_id="OFFER-BOSCH-MTR",
                supplier_id="SUP-BOSCH-02",
                supplier_name="Bosch Rexroth Mechatronics",
                sku="SKU-IND-MTR-4471",
                quantity_available=6,
                unit_price=Decimal("1220.00"),
                freight_cost=Decimal("420.00"),
                currency="USD",
                minimum_order_quantity=1,
                pack_size=1,
                lead_time_days=1,
                quoted_at=now - timedelta(minutes=25),
                valid_until=now + timedelta(days=2),
            ),
            SupplierOffer(
                offer_id="OFFER-OMRON-MTR",
                supplier_id="SUP-OMRON-04",
                supplier_name="Omron Electronic Sensing Corp",
                sku="SKU-IND-MTR-4471",
                quantity_available=8,
                unit_price=Decimal("1380.00"),
                freight_cost=Decimal("600.00"),
                currency="USD",
                minimum_order_quantity=1,
                pack_size=1,
                lead_time_days=3,
                quoted_at=now - timedelta(minutes=20),
                valid_until=now + timedelta(days=3),
            ),
            SupplierOffer(
                offer_id="OFFER-YASKAWA-MTR",
                supplier_id="SUP-YASKAWA-09",
                supplier_name="Yaskawa Electric Drives",
                sku="SKU-IND-MTR-4471",
                quantity_available=10,
                unit_price=Decimal("1420.00"),
                freight_cost=Decimal("850.00"),
                currency="USD",
                minimum_order_quantity=2,
                pack_size=1,
                lead_time_days=4,
                quoted_at=now - timedelta(minutes=15),
                valid_until=now + timedelta(days=4),
            ),
        ],
        compatibility=[
            CompatibilityAssessment(
                requested_sku="SKU-IND-MTR-4471",
                candidate_sku="SKU-IND-MTR-4471",
                status=CompatibilityStatus.COMPATIBLE,
                evidence=["OEM Direct Replacement. Voltage 400V, 24mm Keyed Shaft, 90mm Flange."],
                assessed_by="SUP-SIEMENS-01",
                assessed_at=now - timedelta(minutes=20),
            ),
            CompatibilityAssessment(
                requested_sku="SKU-IND-MTR-4471",
                candidate_sku="SKU-IND-MTR-4471",
                status=CompatibilityStatus.COMPATIBLE,
                evidence=["Form-fit-function verified. MSK040C series with supplied pilot adapter."],
                assessed_by="SUP-BOSCH-02",
                assessed_at=now - timedelta(minutes=18),
            ),
        ],
    )

    plan = RecoveryPlan(
        plan_id="PLAN-REC-MTR-4471",
        case_id="CASE-MTR-4471",
        status=RecoveryPlanStatus.PROPOSED,
        total_cost=Decimal("11920.00"),
        currency="USD",
        lines=[
            RecoveryLine(
                offer_id="OFFER-SIEMENS-MTR",
                supplier_id="SUP-SIEMENS-01",
                sku="SKU-IND-MTR-4471",
                quantity=4,
                unit_price=Decimal("1150.00"),
            ),
            RecoveryLine(
                offer_id="OFFER-BOSCH-MTR",
                supplier_id="SUP-BOSCH-02",
                sku="SKU-IND-MTR-4471",
                quantity=6,
                unit_price=Decimal("1220.00"),
            ),
        ],
        expected_completion_at=tomorrow_morning,
        explanation="Multi-sourcing across Siemens (4) and Bosch Rexroth (6) fulfills 100% of Line 3 demand within 18h.",
        assumptions=[
            "Siemens priority flight arrives Frankfurt-JFK by 04:00 AM.",
            "Bosch Rexroth truck courier arrives from Lohr depot by 06:30 AM.",
        ],
        blockers=[],
        generated_at=now - timedelta(minutes=15),
    )

    approval = ProcurementApproval(
        approval_id="APPR-MTR-4471-CERT",
        case_id="CASE-MTR-4471",
        plan_id="PLAN-REC-MTR-4471",
        plan_fingerprint=plan.compute_fingerprint(),
        approved_by="operator@stockrescue.internal",
        approved_at=now - timedelta(minutes=5),
        expires_at=now + timedelta(days=2),
        max_total_cost=Decimal("14500.00"),
        currency="USD",
        revoked=False,
    )

    audit = AuditEvent(
        event_type="plan_approved",
        entity_type="recovery_plan",
        entity_id="PLAN-REC-MTR-4471",
        actor_id="operator@stockrescue.internal",
        occurred_at=now - timedelta(minutes=5),
        details={
            "approval_id": approval.approval_id,
            "case_id": case.case_id,
            "total_cost": str(plan.total_cost),
            "currency": plan.currency,
            "fingerprint": approval.plan_fingerprint,
        },
    )

    return case, plan, approval, audit


def build_bearing_case() -> DisruptionCase:
    now = datetime.now(timezone.utc)
    return DisruptionCase(
        case_id="CASE-BRG-6204",
        affected_sku="SKU-BRG-6204",
        failed_supplier_id="SUP-BEARING-PRIMARY",
        reported_at=now - timedelta(hours=3),
        delayed_until=now + timedelta(days=5),
        budget=Decimal("3500.00"),
        currency="USD",
        inventory=[
            InventoryRecord(
                sku="SKU-BRG-6204",
                quantity_on_hand=8,
                quantity_committed=5,
                unit_cost=Decimal("45.00"),
                location="LOC-A01-L1-P1",
            )
        ],
        jobs=[
            JobRequirement(
                job_id="JOB-CONVEYOR-MAINT",
                sku="SKU-BRG-6204",
                quantity_required=16,
                required_by=now + timedelta(hours=24),
                priority=4,
                description="Conveyor #2 Preventive Bearing Overhaul",
            )
        ],
        offers=[
            SupplierOffer(
                offer_id="OFFER-SKF-BRG",
                supplier_id="SUP-SKF-BEARINGS",
                supplier_name="SKF Industrial Bearings",
                sku="SKU-BRG-6204",
                quantity_available=20,
                unit_price=Decimal("48.00"),
                freight_cost=Decimal("65.00"),
                currency="USD",
                minimum_order_quantity=5,
                pack_size=5,
                lead_time_days=1,
                quoted_at=now - timedelta(hours=2),
                valid_until=now + timedelta(days=3),
            )
        ],
    )


def build_plc_case() -> DisruptionCase:
    now = datetime.now(timezone.utc)
    return DisruptionCase(
        case_id="CASE-PLC-S715",
        affected_sku="SKU-PLC-S715",
        failed_supplier_id="SUP-DISTRIB-EAST",
        reported_at=now - timedelta(hours=6),
        delayed_until=now + timedelta(days=10),
        budget=Decimal("15000.00"),
        currency="USD",
        inventory=[
            InventoryRecord(
                sku="SKU-PLC-S715",
                quantity_on_hand=1,
                quantity_committed=1,
                unit_cost=Decimal("3200.00"),
                location="LOC-B01-L1-P1",
            )
        ],
        jobs=[
            JobRequirement(
                job_id="JOB-RETROFIT-PLC",
                sku="SKU-PLC-S715",
                quantity_required=4,
                required_by=now + timedelta(days=3),
                priority=3,
                description="Line 1 Upgrade PLC Modules",
            )
        ],
        offers=[
            SupplierOffer(
                offer_id="OFFER-RA-PLC",
                supplier_id="SUP-ROCKWELL-06",
                supplier_name="Rockwell Automation",
                sku="SKU-PLC-S715",
                quantity_available=3,
                unit_price=Decimal("3400.00"),
                freight_cost=Decimal("150.00"),
                currency="USD",
                minimum_order_quantity=1,
                pack_size=1,
                lead_time_days=2,
                quoted_at=now - timedelta(hours=5),
                valid_until=now + timedelta(days=4),
            )
        ],
    )


def main() -> int:
    settings = get_settings()
    repository = SQLiteWarehouseRepository(
        settings.database_path,
        timeout=settings.database_timeout_seconds,
    )
    repository.initialize()

    try:
        # 1. Seed Case MTR-4471 (Hero incident for Live Simulation)
        motor_case, motor_plan, motor_approval, motor_audit = build_motor_case()
        try:
            repository.create_case(motor_case)
            print(f"✅ Seeded Case: {motor_case.case_id}")
        except RepositoryConflict:
            print(f"ℹ️ Case already exists: {motor_case.case_id}")

        try:
            repository.save_plan(motor_plan)
            print(f"✅ Seeded Recovery Plan: {motor_plan.plan_id}")
        except RepositoryConflict:
            print(f"ℹ️ Plan already exists: {motor_plan.plan_id}")

        try:
            repository.save_approval(motor_approval)
            repository.record_audit_event(motor_audit)
            print(f"✅ Seeded Certified Approval: {motor_approval.approval_id}")
        except RepositoryConflict:
            pass

        # 2. Seed Bearing Case
        bearing_case = build_bearing_case()
        try:
            repository.create_case(bearing_case)
            print(f"✅ Seeded Case: {bearing_case.case_id}")
        except RepositoryConflict:
            pass

        # 3. Seed PLC Case
        plc_case = build_plc_case()
        try:
            repository.create_case(plc_case)
            print(f"✅ Seeded Case: {plc_case.case_id}")
        except RepositoryConflict:
            pass

        print("🎉 Full realistic database seeded successfully!")
        return 0
    finally:
        repository.close()


if __name__ == "__main__":
    raise SystemExit(main())
