from __future__ import annotations
from datetime import datetime, timezone
import hmac
import json
from contextlib import asynccontextmanager
from typing import Annotated
from uuid import uuid4
from fastapi import Depends, FastAPI, Header, HTTPException, Path, Query, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError
from shared.checkpointing import close_checkpointer, get_checkpointer
from shared.config import Settings, get_settings
from shared.models import (
    AuditEvent,
    DisruptionCase,
    ProcurementApproval,
    RecoveryPlan,
    RecoveryPlanStatus,
)
from tools.recovery_optimizer import (
    NoProcurementRequired,
    RecoveryOptimizationError,
    plan_recovery,
)
from services.warehouse_api.auth import (
    OperatorPrincipal,
    extract_bearer_token,
    require_procurement_approver,
    verify_supabase_jwt,
)
from services.warehouse_api.repository import (
    RepositoryConflict,
    RepositoryCorruption,
    RepositoryError,
    RepositoryNotFound,
    WarehouseRepository,
    get_repository,
)
from services.warehouse_api.schemas import (
    ApprovalCreateRequest,
    ApprovalListResponse,
    ApprovalRevokeRequest,
    AuditEventListResponse,
    CaseCreateRequest,
    CaseListResponse,
    HealthResponse,
    PlanListResponse,
)
from observability.tracing import trace_span

SAFE_CLIENT_HOSTS = {"127.0.0.1", "::1", "localhost", "testclient"}
CASE_ID_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$"

class RequestBodyLimitMiddleware:
    def __init__(self, app, *, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes
    async def __call__(self, scope, receive, send) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        content_length = None
        for key, value in scope.get("headers", []):
            if key.lower() == b"content-length":
                try:
                    content_length = int(value.decode("ascii"))
                except (ValueError, UnicodeError):
                    await self._respond(send, 400, b'{"detail":"invalid content length"}')
                    return
                break
        if content_length is not None and (content_length < 0 or content_length > self.max_bytes):
            await self._respond(send, 413, b'{"detail":"request body too large"}')
            return
        body = bytearray()
        while True:
            message = await receive()
            if message.get("type") == "http.disconnect":
                return
            if message.get("type") != "http.request":
                continue
            chunk = message.get("body", b"")
            if len(body) + len(chunk) > self.max_bytes:
                await self._respond(send, 413, b'{"detail":"request body too large"}')
                return
            body.extend(chunk)
            if not message.get("more_body", False):
                break
        delivered = False
        async def replay_receive():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()
        await self.app(scope, replay_receive, send)
    @staticmethod
    async def _respond(send, code: int, body: bytes) -> None:
        await send({
            "type": "http.response.start",
            "status": code,
            "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode("ascii"))],
        })
        await send({"type": "http.response.body", "body": body})
def create_app(
    *,
    settings: Settings | None = None,
    repository: WarehouseRepository | None = None,
) -> FastAPI:
    config = settings or get_settings()
    repo = repository or get_repository(config)
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        config.validate_network_binding()
        if config.real_purchasing_enabled:
            raise RuntimeError("live purchasing is not implemented")
        repo.initialize()
        try:
            # durable checkpoints must be ready at startup, not on first request
            if config.stockrescue_env == "production" or config.langgraph_checkpoints_enabled:
                get_checkpointer(config)
            app.state.settings = config
            app.state.repository = repo
            yield
        finally:
            repo.close()
            close_checkpointer()
    app = FastAPI(
        title=config.app_name,
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/docs" if config.demo_mode else None,
        redoc_url=None,
    )
    app.add_middleware(RequestBodyLimitMiddleware, max_bytes=config.max_request_body_bytes)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.cors_origin_list(),
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "X-API-Key", "Authorization"],
        max_age=600,
    )
    @app.exception_handler(RequestValidationError)
    async def request_validation_error_handler(request: Request, exc: RequestValidationError):
        errors = []
        for error in exc.errors()[:20]:
            location = [str(part)[:80] for part in error.get("loc", ())[:8]]
            errors.append({"loc": location, "type": str(error.get("type", "invalid"))[:80], "msg": "invalid request value"})
        return JSONResponse(status_code=422, content={"detail": errors})
    async def authorize(
        request: Request,
        x_api_key: Annotated[str | None, Header(alias="X-API-Key")] = None,
        authorization: Annotated[str | None, Header(alias="Authorization")] = None,
    ) -> OperatorPrincipal | None:
        active_settings: Settings = request.app.state.settings
        bearer = extract_bearer_token(authorization)
        if bearer:
            return verify_supabase_jwt(bearer, active_settings)

        configured = active_settings.warehouse_api_key
        if configured is not None:
            expected = configured.get_secret_value()
            if not isinstance(x_api_key, str) or len(x_api_key) > 512 or not hmac.compare_digest(x_api_key, expected):
                raise HTTPException(status_code=401, detail="API authentication required")
            return None
        client_host = request.client.host if request.client else ""
        if client_host not in SAFE_CLIENT_HOSTS:
            raise HTTPException(status_code=403, detail="API is restricted to local clients")
        return None

    def repository_or_http_error(callable_, *args, **kwargs):
        try:
            return callable_(*args, **kwargs)
        except RepositoryNotFound as exc:
            raise HTTPException(status_code=404, detail="resource not found") from exc
        except RepositoryConflict as exc:
            raise HTTPException(status_code=409, detail="resource already exists") from exc
        except RepositoryCorruption as exc:
            raise HTTPException(status_code=500, detail="stored data failed validation") from exc
        except RepositoryError as exc:
            raise HTTPException(status_code=503, detail="warehouse storage is unavailable") from exc

    @app.get("/health", response_model=HealthResponse, tags=["system"])
    async def health(request: Request) -> HealthResponse:
        active_settings: Settings = request.app.state.settings
        return HealthResponse(
            app_name=active_settings.app_name,
            demo_mode=active_settings.demo_mode,
            real_purchasing_enabled=False,
        )
    @app.post("/cases", response_model=DisruptionCase, status_code=status.HTTP_201_CREATED, tags=["cases"])
    def create_case(
        body: CaseCreateRequest,
        request: Request,
        _: None = Depends(authorize),
    ) -> DisruptionCase:
        try:
            case = body.to_case()
        except ValidationError as exc:
            raise HTTPException(status_code=422, detail="case data failed validation") from exc
        with trace_span("api.create_case", workflow_id=case.case_id, metadata={"operation": "create_case"}):
            return repository_or_http_error(request.app.state.repository.create_case, case)

    @app.get("/cases", response_model=CaseListResponse, tags=["cases"])
    def list_cases(
        request: Request,
        _: None = Depends(authorize),
        limit: int = Query(default=50, ge=1, le=100),
        offset: int = Query(default=0, ge=0, le=1_000_000),
    ) -> CaseListResponse:
        items, count = repository_or_http_error(
            request.app.state.repository.list_cases, limit=limit, offset=offset
        )
        return CaseListResponse(items=items, count=count, limit=limit, offset=offset)

    @app.get("/cases/{case_id}", response_model=DisruptionCase, tags=["cases"])
    def get_case(
        request: Request,
        case_id: Annotated[str, Path(min_length=1, max_length=100, pattern=CASE_ID_PATTERN)],
        _: None = Depends(authorize),
    ) -> DisruptionCase:
        return repository_or_http_error(request.app.state.repository.get_case, case_id)

    @app.post("/cases/{case_id}/plans", response_model=RecoveryPlan, tags=["planning"])
    def create_plan(
        request: Request,
        case_id: Annotated[str, Path(min_length=1, max_length=100, pattern=CASE_ID_PATTERN)],
        _: None = Depends(authorize),
    ) -> RecoveryPlan:
        case: DisruptionCase = repository_or_http_error(request.app.state.repository.get_case, case_id)
        try:
            with trace_span("api.plan_recovery", workflow_id=case.case_id, metadata={"operation": "plan_recovery"}):
                plan = plan_recovery(case)
        except NoProcurementRequired as exc:
            raise HTTPException(status_code=409, detail="available stock already covers the case demand") from exc
        except RecoveryOptimizationError as exc:
            raise HTTPException(status_code=422, detail="recovery planning could not validate this case") from exc
        return repository_or_http_error(request.app.state.repository.save_plan, plan)

    @app.get("/cases/{case_id}/plans", response_model=PlanListResponse, tags=["planning"])
    def list_plans(
        request: Request,
        case_id: Annotated[str, Path(min_length=1, max_length=100, pattern=CASE_ID_PATTERN)],
        _: None = Depends(authorize),
        limit: int = Query(default=50, ge=1, le=100),
        offset: int = Query(default=0, ge=0, le=1_000_000),
    ) -> PlanListResponse:
        items, count = repository_or_http_error(
            request.app.state.repository.list_plans,
            case_id,
            limit=limit,
            offset=offset,
        )
        return PlanListResponse(items=items, count=count, limit=limit, offset=offset)

    @app.post(
        "/cases/{case_id}/plans/{plan_id}/approvals",
        response_model=ProcurementApproval,
        status_code=status.HTTP_201_CREATED,
        tags=["approvals"],
    )
    def create_approval(
        request: Request,
        case_id: Annotated[str, Path(min_length=1, max_length=100, pattern=CASE_ID_PATTERN)],
        plan_id: Annotated[str, Path(min_length=1, max_length=100, pattern=CASE_ID_PATTERN)],
        body: ApprovalCreateRequest,
        operator: Annotated[OperatorPrincipal, Depends(require_procurement_approver)],
    ) -> ProcurementApproval:
        case: DisruptionCase = repository_or_http_error(request.app.state.repository.get_case, case_id)
        plan: RecoveryPlan = repository_or_http_error(request.app.state.repository.get_plan, plan_id)
        if plan.case_id != case_id:
            raise HTTPException(status_code=404, detail="recovery plan not found for this case")
        if plan.status != RecoveryPlanStatus.PROPOSED:
            raise HTTPException(status_code=400, detail="only proposed recovery plans can be approved")
        if body.currency != plan.currency or body.currency != case.currency:
            raise HTTPException(status_code=400, detail="approval currency does not match recovery plan or case")
        if plan.total_cost > body.max_total_cost:
            raise HTTPException(status_code=400, detail="plan total cost exceeds approved maximum total cost")
        if case.budget is not None and plan.total_cost > case.budget:
            raise HTTPException(status_code=400, detail="recovery plan total cost exceeds case budget")

        now_dt = datetime.now(timezone.utc)
        if body.expires_at <= now_dt:
            raise HTTPException(status_code=400, detail="approval expiry must be in the future")

        canonical_fingerprint = plan.compute_fingerprint()
        existing_active = repository_or_http_error(
            request.app.state.repository.get_active_approval, plan_id, as_of=now_dt
        )
        if existing_active is not None and existing_active.plan_fingerprint == canonical_fingerprint:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="an active approval already exists for this recovery plan",
            )

        approval = ProcurementApproval(
            approval_id=f"APPR-{uuid4().hex[:12].upper()}",
            case_id=case.case_id,
            plan_id=plan.plan_id,
            plan_fingerprint=canonical_fingerprint,
            approved_by=operator.approver_identity,
            approved_at=now_dt,
            expires_at=body.expires_at,
            max_total_cost=body.max_total_cost,
            currency=body.currency,
            revoked=False,
        )
        saved_approval = repository_or_http_error(request.app.state.repository.save_approval, approval)

        audit_event = AuditEvent(
            event_type="approval_created",
            entity_type="recovery_plan",
            entity_id=plan.plan_id,
            actor_id=operator.approver_identity,
            occurred_at=now_dt,
            details={
                "approval_id": saved_approval.approval_id,
                "case_id": case.case_id,
                "plan_id": plan.plan_id,
                "plan_fingerprint": canonical_fingerprint,
                "max_total_cost": str(saved_approval.max_total_cost),
                "currency": saved_approval.currency,
                "expires_at": saved_approval.expires_at.isoformat(),
            },
        )
        repository_or_http_error(request.app.state.repository.record_audit_event, audit_event)
        return saved_approval

    @app.post(
        "/cases/{case_id}/plans/{plan_id}/approvals/{approval_id}/revoke",
        response_model=ProcurementApproval,
        tags=["approvals"],
    )
    def revoke_approval(
        request: Request,
        case_id: Annotated[str, Path(min_length=1, max_length=100, pattern=CASE_ID_PATTERN)],
        plan_id: Annotated[str, Path(min_length=1, max_length=100, pattern=CASE_ID_PATTERN)],
        approval_id: Annotated[str, Path(min_length=1, max_length=100, pattern=CASE_ID_PATTERN)],
        body: ApprovalRevokeRequest,
        operator: Annotated[OperatorPrincipal, Depends(require_procurement_approver)],
    ) -> ProcurementApproval:
        repository_or_http_error(request.app.state.repository.get_case, case_id)
        plan: RecoveryPlan = repository_or_http_error(request.app.state.repository.get_plan, plan_id)
        if plan.case_id != case_id:
            raise HTTPException(status_code=404, detail="recovery plan not found for this case")
        approval: ProcurementApproval = repository_or_http_error(
            request.app.state.repository.get_approval, approval_id
        )
        if approval.case_id != case_id or approval.plan_id != plan_id:
            raise HTTPException(status_code=404, detail="approval does not belong to this case and plan")
        if approval.is_revoked():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="approval is already revoked")

        now_dt = datetime.now(timezone.utc)
        revoked_approval = repository_or_http_error(
            request.app.state.repository.revoke_approval,
            approval_id,
            revoked_by=operator.approver_identity,
            reason=body.revocation_reason,
            at=now_dt,
        )
        audit_event = AuditEvent(
            event_type="approval_revoked",
            entity_type="recovery_plan",
            entity_id=plan.plan_id,
            actor_id=operator.approver_identity,
            occurred_at=now_dt,
            details={
                "approval_id": approval_id,
                "case_id": case_id,
                "plan_id": plan_id,
                "revocation_reason": body.revocation_reason,
            },
        )
        repository_or_http_error(request.app.state.repository.record_audit_event, audit_event)
        return revoked_approval

    @app.get(
        "/cases/{case_id}/plans/{plan_id}/approvals/audit",
        response_model=AuditEventListResponse,
        tags=["approvals"],
    )
    def list_approval_audit_events(
        request: Request,
        case_id: Annotated[str, Path(min_length=1, max_length=100, pattern=CASE_ID_PATTERN)],
        plan_id: Annotated[str, Path(min_length=1, max_length=100, pattern=CASE_ID_PATTERN)],
        _: None = Depends(authorize),
        limit: int = Query(default=50, ge=1, le=100),
        offset: int = Query(default=0, ge=0, le=1_000_000),
    ) -> AuditEventListResponse:
        repository_or_http_error(request.app.state.repository.get_case, case_id)
        plan: RecoveryPlan = repository_or_http_error(request.app.state.repository.get_plan, plan_id)
        if plan.case_id != case_id:
            raise HTTPException(status_code=404, detail="recovery plan not found for this case")
        items, count = repository_or_http_error(
            request.app.state.repository.list_audit_events,
            plan_id,
            limit=limit,
            offset=offset,
        )
        return AuditEventListResponse(items=items, count=count, limit=limit, offset=offset)


    @app.get(
        "/cases/{case_id}/plans/{plan_id}/approvals",
        response_model=ApprovalListResponse,
        tags=["approvals"],
    )
    def list_approvals(
        request: Request,
        case_id: Annotated[str, Path(min_length=1, max_length=100, pattern=CASE_ID_PATTERN)],
        plan_id: Annotated[str, Path(min_length=1, max_length=100, pattern=CASE_ID_PATTERN)],
        _: None = Depends(authorize),
        limit: int = Query(default=50, ge=1, le=100),
        offset: int = Query(default=0, ge=0, le=1_000_000),
    ) -> ApprovalListResponse:
        repository_or_http_error(request.app.state.repository.get_case, case_id)
        plan: RecoveryPlan = repository_or_http_error(request.app.state.repository.get_plan, plan_id)
        if plan.case_id != case_id:
            raise HTTPException(status_code=404, detail="recovery plan not found for this case")
        items, count = repository_or_http_error(
            request.app.state.repository.list_approvals,
            plan_id,
            limit=limit,
            offset=offset,
        )
        return ApprovalListResponse(items=items, count=count, limit=limit, offset=offset)

    @app.get(
        "/cases/{case_id}/plans/{plan_id}/approvals/active",
        response_model=ProcurementApproval | None,
        tags=["approvals"],
    )
    def get_active_approval(
        request: Request,
        case_id: Annotated[str, Path(min_length=1, max_length=100, pattern=CASE_ID_PATTERN)],
        plan_id: Annotated[str, Path(min_length=1, max_length=100, pattern=CASE_ID_PATTERN)],
        _: None = Depends(authorize),
        as_of: datetime | None = Query(default=None),
    ) -> ProcurementApproval | None:
        repository_or_http_error(request.app.state.repository.get_case, case_id)
        plan: RecoveryPlan = repository_or_http_error(request.app.state.repository.get_plan, plan_id)
        if plan.case_id != case_id:
            raise HTTPException(status_code=404, detail="recovery plan not found for this case")
        return repository_or_http_error(
            request.app.state.repository.get_active_approval, plan_id, as_of=as_of
        )

    @app.get(
        "/approvals/{approval_id}",
        response_model=ProcurementApproval,
        tags=["approvals"],
    )
    def get_approval(
        request: Request,
        approval_id: Annotated[str, Path(min_length=1, max_length=100, pattern=CASE_ID_PATTERN)],
        _: None = Depends(authorize),
    ) -> ProcurementApproval:
        return repository_or_http_error(request.app.state.repository.get_approval, approval_id)

    @app.get("/suppliers", tags=["suppliers"])
    def list_suppliers(_: None = Depends(authorize)):
        return [
            {
                "supplier_id": "SUP-SIEMENS-01",
                "name": "Siemens Industrial Technologies",
                "tier": "Tier 1 Preferred",
                "rating": 4.9,
                "on_time_delivery_pct": 98.4,
                "location": "Munich, Germany (Central Depot)",
                "contact_email": "dispatch@siemens-industrial.internal",
                "phone": "+49 89 636 00",
                "specialty": "Motion & Servo Drives, PLCs, High-Voltage Switchgear",
                "active_catalog_items": 1420,
                "average_lead_time_days": 1.0,
                "reliability_score": 98.8,
                "payment_terms": "Net 30",
                "status": "active",
            },
            {
                "supplier_id": "SUP-BOSCH-02",
                "name": "Bosch Rexroth Mechatronics",
                "tier": "Tier 1 Preferred",
                "rating": 4.9,
                "on_time_delivery_pct": 99.1,
                "location": "Lohr am Main, Germany",
                "contact_email": "orders@boschrexroth.internal",
                "phone": "+49 9352 18 0",
                "specialty": "Linear Motion, Hydraulic Drives, Servo Motors",
                "active_catalog_items": 980,
                "average_lead_time_days": 1.0,
                "reliability_score": 99.2,
                "payment_terms": "Net 30",
                "status": "active",
            },
            {
                "supplier_id": "SUP-ABB-03",
                "name": "ABB Robotics & Motion Ltd",
                "tier": "Tier 1 Preferred",
                "rating": 4.8,
                "on_time_delivery_pct": 97.2,
                "location": "Zurich, Switzerland",
                "contact_email": "supply@abb-motion.internal",
                "phone": "+41 43 317 71 11",
                "specialty": "Robotics, Variable Frequency Inverters, Motors",
                "active_catalog_items": 1150,
                "average_lead_time_days": 2.0,
                "reliability_score": 97.5,
                "payment_terms": "Net 45",
                "status": "active",
            },
            {
                "supplier_id": "SUP-OMRON-04",
                "name": "Omron Electronic Sensing Corp",
                "tier": "Qualified Partner",
                "rating": 4.7,
                "on_time_delivery_pct": 95.8,
                "location": "Kyoto, Japan / Regional Hub",
                "contact_email": "b2b@omron.internal",
                "phone": "+81 75 344 7000",
                "specialty": "Proximity Sensors, Safety Relays, Servo Controllers",
                "active_catalog_items": 840,
                "average_lead_time_days": 3.0,
                "reliability_score": 96.0,
                "payment_terms": "Net 30",
                "status": "active",
            },
            {
                "supplier_id": "SUP-SCHNEIDER-05",
                "name": "Schneider Electric Automation",
                "tier": "Tier 1 Preferred",
                "rating": 4.8,
                "on_time_delivery_pct": 96.5,
                "location": "Rueil-Malmaison, France",
                "contact_email": "industrial@se.internal",
                "phone": "+33 1 41 29 70 00",
                "specialty": "Motor Starters, Contactors, Modicon PLCs",
                "active_catalog_items": 1290,
                "average_lead_time_days": 2.0,
                "reliability_score": 97.0,
                "payment_terms": "Net 30",
                "status": "active",
            },
            {
                "supplier_id": "SUP-ROCKWELL-06",
                "name": "Rockwell Automation (Allen-Bradley)",
                "tier": "Tier 1 Preferred",
                "rating": 4.6,
                "on_time_delivery_pct": 94.2,
                "location": "Milwaukee, USA / Express Hub",
                "contact_email": "orders@ra.rockwell.internal",
                "phone": "+1 414 382 2000",
                "specialty": "ControlLogix PLCs, Kinetix Drives, Encoders",
                "active_catalog_items": 1650,
                "average_lead_time_days": 2.5,
                "reliability_score": 95.4,
                "payment_terms": "Net 60",
                "status": "active",
            },
            {
                "supplier_id": "SUP-FESTO-07",
                "name": "Festo Pneumatic Systems",
                "tier": "Tier 1 Preferred",
                "rating": 4.9,
                "on_time_delivery_pct": 98.0,
                "location": "Esslingen am Neckar, Germany",
                "contact_email": "priority@festo.internal",
                "phone": "+49 711 347 0",
                "specialty": "Pneumatic Valves, Air Cylinders, Grippers",
                "active_catalog_items": 720,
                "average_lead_time_days": 1.5,
                "reliability_score": 98.4,
                "payment_terms": "Net 30",
                "status": "active",
            },
            {
                "supplier_id": "SUP-PARKER-08",
                "name": "Parker Hannifin Fluid & Drive",
                "tier": "Qualified Partner",
                "rating": 4.7,
                "on_time_delivery_pct": 96.1,
                "location": "Cleveland, OH / EU Logistics",
                "contact_email": "distrib@parker.internal",
                "phone": "+1 216 896 3000",
                "specialty": "Hydraulic Pumps, Proportional Valves, Fittings",
                "active_catalog_items": 890,
                "average_lead_time_days": 2.0,
                "reliability_score": 96.5,
                "payment_terms": "Net 30",
                "status": "active",
            },
            {
                "supplier_id": "SUP-YASKAWA-09",
                "name": "Yaskawa Electric Drives",
                "tier": "Qualified Partner",
                "rating": 4.8,
                "on_time_delivery_pct": 97.5,
                "location": "Kitakyushu, Japan / Global Air",
                "contact_email": "express@yaskawa.internal",
                "phone": "+81 93 695 3030",
                "specialty": "Sigma-7 Servo Drives, Industrial Motors, Inverters",
                "active_catalog_items": 910,
                "average_lead_time_days": 4.0,
                "reliability_score": 97.8,
                "payment_terms": "Net 45",
                "status": "active",
            },
            {
                "supplier_id": "SUP-TE-10",
                "name": "TE Connectivity Sensors",
                "tier": "Standard Vendor",
                "rating": 4.5,
                "on_time_delivery_pct": 93.8,
                "location": "Schaffhausen, Switzerland",
                "contact_email": "sales@te-connectivity.internal",
                "phone": "+41 52 633 66 61",
                "specialty": "Industrial Connectors, Cable Harnesses, Thermocouples",
                "active_catalog_items": 640,
                "average_lead_time_days": 3.0,
                "reliability_score": 94.2,
                "payment_terms": "Net 30",
                "status": "active",
            },
            {
                "supplier_id": "SUP-NIDEC-11",
                "name": "Nidec Precision Motors",
                "tier": "Standard Vendor",
                "rating": 4.6,
                "on_time_delivery_pct": 95.0,
                "location": "Kyoto, Japan / Regional Depot",
                "contact_email": "support@nidec-precision.internal",
                "phone": "+81 75 922 1111",
                "specialty": "Brushless DC Motors, Spindle Drives, Stepper Motors",
                "active_catalog_items": 580,
                "average_lead_time_days": 3.5,
                "reliability_score": 95.5,
                "payment_terms": "Net 30",
                "status": "active",
            },
            {
                "supplier_id": "SUP-DANFOSS-12",
                "name": "Danfoss Power Solutions",
                "tier": "Qualified Partner",
                "rating": 4.8,
                "on_time_delivery_pct": 96.8,
                "location": "Nordborg, Denmark",
                "contact_email": "power@danfoss.internal",
                "phone": "+45 7488 2222",
                "specialty": "VLT Inverters, Soft Starters, Pressure Transmitters",
                "active_catalog_items": 770,
                "average_lead_time_days": 2.0,
                "reliability_score": 97.1,
                "payment_terms": "Net 30",
                "status": "active",
            },
            {
                "supplier_id": "SUP-HONEYWELL-13",
                "name": "Honeywell Process Solutions",
                "tier": "Qualified Partner",
                "rating": 4.7,
                "on_time_delivery_pct": 95.5,
                "location": "Charlotte, NC / Domestic Depot",
                "contact_email": "process@honeywell.internal",
                "phone": "+1 704 627 6200",
                "specialty": "Process Limit Switches, Flow Meters, Gas Detectors",
                "active_catalog_items": 830,
                "average_lead_time_days": 2.5,
                "reliability_score": 96.0,
                "payment_terms": "Net 45",
                "status": "active",
            },
            {
                "supplier_id": "SUP-KUKA-14",
                "name": "KUKA Robotics Components",
                "tier": "Tier 1 Preferred",
                "rating": 4.8,
                "on_time_delivery_pct": 97.0,
                "location": "Augsburg, Germany",
                "contact_email": "parts@kuka.internal",
                "phone": "+49 821 797 0",
                "specialty": "Arm Link Gearboxes, Harmonic Drives, Safety Teach Pendants",
                "active_catalog_items": 460,
                "average_lead_time_days": 2.0,
                "reliability_score": 97.3,
                "payment_terms": "Net 30",
                "status": "active",
            },
            {
                "supplier_id": "SUP-FANUC-15",
                "name": "Fanuc Mechatronics Europe",
                "tier": "Tier 1 Preferred",
                "rating": 4.9,
                "on_time_delivery_pct": 98.6,
                "location": "Echternach, Luxembourg",
                "contact_email": "spares@fanuc.internal",
                "phone": "+352 72 77 77 0",
                "specialty": "Alpha i Servo Motors, CNC Amplifiers, Teach Units",
                "active_catalog_items": 620,
                "average_lead_time_days": 1.5,
                "reliability_score": 98.7,
                "payment_terms": "Net 30",
                "status": "active",
            },
        ]

    @app.get("/inventory", tags=["inventory"])
    def list_inventory(_: None = Depends(authorize)):
        return [
            {"sku": "SKU-IND-MTR-4471", "name": "3-Phase High-Torque Servo Motor (400V)", "location": "LOC-A01-L1-P2", "available_quantity": 2, "required_quantity": 12, "shortage": 10, "min_stock_level": 8, "unit_cost": "1250.00", "currency": "USD", "category": "Motors & Drives", "status": "shortage"},
            {"sku": "SKU-BRG-6204", "name": "Deep Groove Ball Bearing (20x47x14mm)", "location": "LOC-A01-L1-P1", "available_quantity": 8, "required_quantity": 16, "shortage": 8, "min_stock_level": 20, "unit_cost": "45.00", "currency": "USD", "category": "Bearings", "status": "shortage"},
            {"sku": "SKU-PLC-S715", "name": "Simatic S7-1500 Modular PLC CPU", "location": "LOC-B01-L1-P1", "available_quantity": 1, "required_quantity": 4, "shortage": 3, "min_stock_level": 3, "unit_cost": "3200.00", "currency": "USD", "category": "Controllers", "status": "low"},
            {"sku": "SKU-VLV-PX22", "name": "Festo Proportional Directional Control Valve", "location": "LOC-B02-L1-P1", "available_quantity": 5, "required_quantity": 5, "shortage": 0, "min_stock_level": 4, "unit_cost": "620.00", "currency": "USD", "category": "Pneumatics", "status": "normal"},
            {"sku": "SKU-SNS-IND-08", "name": "Omron M12 Inductive Proximity Sensor", "location": "LOC-A02-L1-P1", "available_quantity": 42, "required_quantity": 15, "shortage": 0, "min_stock_level": 25, "unit_cost": "85.00", "currency": "USD", "category": "Sensors", "status": "normal"},
            {"sku": "SKU-DRV-ACS880", "name": "ABB Industrial Variable Frequency Inverter", "location": "LOC-B03-L1-P1", "available_quantity": 3, "required_quantity": 6, "shortage": 3, "min_stock_level": 4, "unit_cost": "2850.00", "currency": "USD", "category": "Motors & Drives", "status": "low"},
            {"sku": "SKU-ENC-OP500", "name": "Optical 1024-PPR Incremental Rotary Encoder", "location": "LOC-A03-L1-P1", "available_quantity": 14, "required_quantity": 10, "shortage": 0, "min_stock_level": 10, "unit_cost": "340.00", "currency": "USD", "category": "Sensors", "status": "normal"},
            {"sku": "SKU-PWR-24V40A", "name": "Phoenix Contact 24V 40A DIN-Rail Power Supply", "location": "LOC-B04-L1-P1", "available_quantity": 19, "required_quantity": 8, "shortage": 0, "min_stock_level": 12, "unit_cost": "290.00", "currency": "USD", "category": "Power Systems", "status": "normal"},
            {"sku": "SKU-CBL-CAT7-50", "name": "Shielded Industrial Gigabit Ethernet Cable 50m", "location": "LOC-A04-L1-P1", "available_quantity": 60, "required_quantity": 20, "shortage": 0, "min_stock_level": 20, "unit_cost": "65.00", "currency": "USD", "category": "Cables & Wiring", "status": "normal"},
            {"sku": "SKU-REL-SSR-50A", "name": "Crydom Solid State Relay 50A / 480VAC", "location": "LOC-A01-L2-P1", "available_quantity": 28, "required_quantity": 12, "shortage": 0, "min_stock_level": 15, "unit_cost": "42.00", "currency": "USD", "category": "Power Systems", "status": "normal"},
            {"sku": "SKU-FLT-HYD-10U", "name": "10-Micron Hydraulic Fluid Return Filter Element", "location": "LOC-B02-L2-P1", "available_quantity": 11, "required_quantity": 8, "shortage": 0, "min_stock_level": 10, "unit_cost": "115.00", "currency": "USD", "category": "Hydraulics", "status": "normal"},
            {"sku": "SKU-SW-DISC-100", "name": "100A Padlockable Safety Emergency Disconnect Switch", "location": "LOC-B01-L2-P1", "available_quantity": 7, "required_quantity": 6, "shortage": 0, "min_stock_level": 5, "unit_cost": "185.00", "currency": "USD", "category": "Power Systems", "status": "normal"},
            {"sku": "SKU-PMP-GR-05", "name": "Parker High-Pressure Rotary External Gear Pump", "location": "LOC-A04-L2-P1", "available_quantity": 2, "required_quantity": 4, "shortage": 2, "min_stock_level": 3, "unit_cost": "890.00", "currency": "USD", "category": "Hydraulics", "status": "low"},
            {"sku": "SKU-BRK-DISC-90", "name": "Pneumatic Caliper Disc Brake for Conveyor", "location": "LOC-B03-L2-P1", "available_quantity": 6, "required_quantity": 6, "shortage": 0, "min_stock_level": 4, "unit_cost": "410.00", "currency": "USD", "category": "Mechanical", "status": "normal"},
            {"sku": "SKU-HMI-10W", "name": "Pro-face 10.4-Inch Wide Color Touchscreen Display", "location": "LOC-B04-L2-P1", "available_quantity": 4, "required_quantity": 4, "shortage": 0, "min_stock_level": 3, "unit_cost": "1450.00", "currency": "USD", "category": "Controllers", "status": "normal"},
            {"sku": "SKU-TC-K-100", "name": "Inconel Sheathed K-Type Thermocouple Sensor 100mm", "location": "LOC-A03-L2-P1", "available_quantity": 35, "required_quantity": 10, "shortage": 0, "min_stock_level": 20, "unit_cost": "55.00", "currency": "USD", "category": "Sensors", "status": "normal"},
            {"sku": "SKU-VAL-SOL-24", "name": "24VDC 5/2-Way Solenoid Pneumatic Manifold Valve", "location": "LOC-A02-L2-P1", "available_quantity": 9, "required_quantity": 8, "shortage": 0, "min_stock_level": 8, "unit_cost": "175.00", "currency": "USD", "category": "Pneumatics", "status": "normal"},
            {"sku": "SKU-LUB-SYN-20L", "name": "Mobil SHC 220 High-Temp Synthetic Gear Oil (20L Pail)", "location": "Staging Buffer Bay", "available_quantity": 15, "required_quantity": 5, "shortage": 0, "min_stock_level": 10, "unit_cost": "210.00", "currency": "USD", "category": "Chemicals", "status": "normal"},
        ]

    @app.get("/deliveries", tags=["deliveries"])
    def list_deliveries(_: None = Depends(authorize)):
        return [
            {
                "delivery_id": "DEL-2026-0891",
                "po_number": "PO-SR-2026-0891",
                "case_id": "CASE-MTR-4471",
                "sku": "SKU-IND-MTR-4471",
                "description": "3-Phase High-Torque Servo Motor (400V)",
                "quantity": 4,
                "supplier_name": "Siemens Industrial Technologies",
                "carrier": "DHL Express Priority Flight",
                "tracking_number": "DHL-EXP-992147382",
                "status": "in_transit",
                "estimated_arrival": "Tomorrow 06:45 AM",
                "destination_bay": "Staging Bay #2",
                "driver_contact": "+49 170 998231",
                "temperature_monitored": True,
            },
            {
                "delivery_id": "DEL-2026-0892",
                "po_number": "PO-SR-2026-0892",
                "case_id": "CASE-MTR-4471",
                "sku": "SKU-IND-MTR-4471",
                "description": "3-Phase High-Torque Servo Motor (400V)",
                "quantity": 6,
                "supplier_name": "Bosch Rexroth Mechatronics",
                "carrier": "FedEx Priority Freight (Air)",
                "tracking_number": "FDX-PRI-881203991",
                "status": "in_transit",
                "estimated_arrival": "Tomorrow 07:30 AM",
                "destination_bay": "Staging Bay #2",
                "driver_contact": "+49 171 442190",
                "temperature_monitored": True,
            },
            {
                "delivery_id": "DEL-2026-0885",
                "po_number": "PO-SR-2026-0870",
                "case_id": "CASE-VLV-PX22",
                "sku": "SKU-VLV-PX22",
                "description": "Festo Proportional Directional Valve",
                "quantity": 5,
                "supplier_name": "Festo Pneumatic Systems",
                "carrier": "UPS Worldwide Express",
                "tracking_number": "1Z9999999999999999",
                "status": "delivered",
                "estimated_arrival": "Delivered Today 11:20 AM",
                "destination_bay": "Receiving Bay #1",
                "driver_contact": "Delivered & Signed",
                "temperature_monitored": False,
            },
            {
                "delivery_id": "DEL-2026-0880",
                "po_number": "PO-SR-2026-0865",
                "case_id": "CASE-BRG-6204",
                "sku": "SKU-BRG-6204",
                "description": "Deep Groove Ball Bearing (20x47x14mm)",
                "quantity": 8,
                "supplier_name": "SKF Industrial Bearings",
                "carrier": "Blue Dart Express Air",
                "tracking_number": "BLD-6677889921",
                "status": "out_for_delivery",
                "estimated_arrival": "Today by 05:00 PM",
                "destination_bay": "Receiving Bay #3",
                "driver_contact": "+91 98200 12345",
                "temperature_monitored": False,
            },
            {
                "delivery_id": "DEL-2026-0872",
                "po_number": "PO-SR-2026-0850",
                "case_id": "CASE-PLC-S715",
                "sku": "SKU-PLC-S715",
                "description": "Simatic S7-1500 Modular PLC CPU",
                "quantity": 3,
                "supplier_name": "Rockwell Automation",
                "carrier": "DB Schenker Priority Air",
                "tracking_number": "DBS-4455667710",
                "status": "scheduled",
                "estimated_arrival": "In 2 Days (Oct 26)",
                "destination_bay": "Quarantine Inspection Bay",
                "driver_contact": "Awaiting Flight Confirmation",
                "temperature_monitored": True,
            },
        ]

    @app.get("/communications", tags=["communications"])
    def list_communications(_: None = Depends(authorize)):
        return [
            {
                "comm_id": "COMM-2026-0104",
                "channel": "EDI / RFQ",
                "recipient": "Siemens Industrial Technologies",
                "subject": "URGENT DISPATCH REQUEST: 4x SKU-IND-MTR-4471",
                "status": "confirmed",
                "sent_at": "10 minutes ago",
                "summary": "RFQ confirmed. Siemens allocated 4 units from Munich Central Depot with 1-day flight dispatch.",
                "payload_preview": "{\"po\":\"PO-SR-2026-0891\",\"sku\":\"SKU-IND-MTR-4471\",\"qty\":4,\"price\":1150.00}",
            },
            {
                "comm_id": "COMM-2026-0105",
                "channel": "EDI / RFQ",
                "recipient": "Bosch Rexroth Mechatronics",
                "subject": "URGENT DISPATCH REQUEST: 6x SKU-IND-MTR-4471",
                "status": "confirmed",
                "sent_at": "8 minutes ago",
                "summary": "RFQ confirmed. Bosch Rexroth allocated 6 units with express courier pickup.",
                "payload_preview": "{\"po\":\"PO-SR-2026-0892\",\"sku\":\"SKU-IND-MTR-4471\",\"qty\":6,\"price\":1220.00}",
            },
            {
                "comm_id": "COMM-2026-0098",
                "channel": "Vendor Voice (Twilio/ElevenLabs)",
                "recipient": "Siemens Shift Dispatch Desk",
                "subject": "Automated Autonomous Dispatch Call (Hans Gruber, Dispatcher)",
                "status": "completed",
                "sent_at": "6 minutes ago",
                "summary": "Autonomous AI Voice Agent confirmed priority carrier collection and generated air waybill DHL-EXP-992147382.",
                "payload_preview": "{\"call_id\":\"CA99882211\",\"duration_seconds\":48,\"outcome\":\"confirmed\"}",
            },
            {
                "comm_id": "COMM-2026-0092",
                "channel": "SMS / Webhook Alert",
                "recipient": "Plant Maintenance Superintendent (Devon Ross)",
                "subject": "CRITICAL INCIDENT MITIGATED: Line 3 Motors Sourced",
                "status": "delivered",
                "sent_at": "4 minutes ago",
                "summary": "Alert dispatched: Full recovery plan approved. All 10 motors arriving by 07:30 AM tomorrow. Stoppage averted.",
                "payload_preview": "{\"line\":\"Line 3\",\"budget_saved\":2580.00,\"eta\":\"Tomorrow 07:30 AM\"}",
            },
        ]

    return app
app = create_app()