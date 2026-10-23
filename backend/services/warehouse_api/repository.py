from __future__ import annotations

import logging
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Iterator, Protocol, runtime_checkable

from pydantic import ValidationError

from shared.models import (
    AuditEvent,
    DisruptionCase,
    ProcurementApproval,
    RecoveryPlan,
    RecoveryPlanStatus,
)

if TYPE_CHECKING:
    from shared.config import Settings

logger = logging.getLogger(__name__)
CASE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$", re.ASCII)
MAX_PAGE_SIZE = 100
MAX_OFFSET = 1_000_000
SCHEMA_VERSION = 3


class RepositoryError(RuntimeError):
    pass


class RepositoryNotFound(RepositoryError):
    pass


class RepositoryConflict(RepositoryError):
    pass


class RepositoryCorruption(RepositoryError):
    pass


@runtime_checkable
class WarehouseRepository(Protocol):
    def initialize(self) -> None: ...
    def close(self) -> None: ...
    def create_case(self, case: DisruptionCase) -> DisruptionCase: ...
    def get_case(self, case_id: str) -> DisruptionCase: ...
    def list_cases(self, *, limit: int = 50, offset: int = 0) -> tuple[list[DisruptionCase], int]: ...
    def save_plan(self, plan: RecoveryPlan) -> RecoveryPlan: ...
    def get_plan(self, plan_id: str) -> RecoveryPlan: ...
    def list_plans(self, case_id: str, *, limit: int = 50, offset: int = 0) -> tuple[list[RecoveryPlan], int]: ...
    def save_approval(self, approval: ProcurementApproval) -> ProcurementApproval: ...
    def get_approval(self, approval_id: str) -> ProcurementApproval: ...
    def list_approvals(self, plan_id: str, *, limit: int = 50, offset: int = 0) -> tuple[list[ProcurementApproval], int]: ...
    def get_active_approval(self, plan_id: str, *, as_of: datetime | None = None) -> ProcurementApproval | None: ...
    def revoke_approval(self, approval_id: str, *, revoked_by: str, reason: str | None = None, at: datetime | None = None) -> ProcurementApproval: ...
    def record_audit_event(self, event: AuditEvent) -> AuditEvent: ...
    def list_audit_events(self, entity_id: str, *, limit: int = 50, offset: int = 0) -> tuple[list[AuditEvent], int]: ...


def serialize_case(case: DisruptionCase) -> tuple[DisruptionCase, str]:
    if not isinstance(case, DisruptionCase):
        raise RepositoryError("a validated disruption case is required")
    try:
        clean = DisruptionCase.model_validate_json(
            case.model_dump_json(exclude={"inventory": {"__all__": {"available_quantity"}}})
        )
        payload = clean.model_dump_json(exclude={"inventory": {"__all__": {"available_quantity"}}})
        return clean, payload
    except (ValidationError, TypeError, ValueError) as exc:
        raise RepositoryError("disruption case failed validation") from exc


def deserialize_case(raw_json: str) -> DisruptionCase:
    try:
        return DisruptionCase.model_validate_json(raw_json)
    except (ValidationError, ValueError, TypeError) as exc:
        logger.error("stored disruption case failed validation")
        raise RepositoryCorruption("stored disruption case is invalid") from exc


def serialize_plan(plan: RecoveryPlan) -> tuple[RecoveryPlan, str]:
    if not isinstance(plan, RecoveryPlan):
        raise RepositoryError("a validated recovery plan is required")
    try:
        clean = RecoveryPlan.model_validate_json(
            plan.model_dump_json(exclude={"lines": {"__all__": {"line_total"}}})
        )
        payload = clean.model_dump_json(exclude={"lines": {"__all__": {"line_total"}}})
        return clean, payload
    except (ValidationError, TypeError, ValueError) as exc:
        raise RepositoryError("recovery plan failed validation") from exc


def deserialize_plan(raw_json: str) -> RecoveryPlan:
    try:
        return RecoveryPlan.model_validate_json(raw_json)
    except (ValidationError, ValueError, TypeError) as exc:
        logger.error("stored recovery plan failed validation")
        raise RepositoryCorruption("stored recovery plan is invalid") from exc


def serialize_approval(approval: ProcurementApproval) -> tuple[ProcurementApproval, str]:
    if not isinstance(approval, ProcurementApproval):
        raise RepositoryError("a validated procurement approval is required")
    try:
        clean = ProcurementApproval.model_validate_json(approval.model_dump_json())
        payload = clean.model_dump_json()
        return clean, payload
    except (ValidationError, TypeError, ValueError) as exc:
        raise RepositoryError("procurement approval failed validation") from exc


def deserialize_approval(raw_json: str) -> ProcurementApproval:
    try:
        return ProcurementApproval.model_validate_json(raw_json)
    except (ValidationError, ValueError, TypeError) as exc:
        logger.error("stored procurement approval failed validation")
        raise RepositoryCorruption("stored procurement approval is invalid") from exc


def serialize_audit_event(event: AuditEvent) -> tuple[AuditEvent, str]:
    if not isinstance(event, AuditEvent):
        raise RepositoryError("a validated audit event is required")
    try:
        clean = AuditEvent.model_validate_json(event.model_dump_json())
        payload = clean.model_dump_json()
        return clean, payload
    except (ValidationError, TypeError, ValueError) as exc:
        raise RepositoryError("audit event failed validation") from exc


def deserialize_audit_event(raw_json: str) -> AuditEvent:
    try:
        return AuditEvent.model_validate_json(raw_json)
    except (ValidationError, ValueError, TypeError) as exc:
        logger.error("stored audit event failed validation")
        raise RepositoryCorruption("stored audit event is invalid") from exc



def validate_identifier(identifier: str) -> str:
    if not isinstance(identifier, str) or CASE_ID_PATTERN.fullmatch(identifier) is None:
        raise RepositoryError("case identifier is invalid")
    return identifier


def validate_pagination(limit: int, offset: int) -> tuple[int, int]:
    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= MAX_PAGE_SIZE:
        raise RepositoryError("page size is outside the allowed range")
    if not isinstance(offset, int) or isinstance(offset, bool) or not 0 <= offset <= MAX_OFFSET:
        raise RepositoryError("page offset is outside the allowed range")
    return limit, offset


class SQLiteWarehouseRepository:
    def __init__(self, database_path: str | Path, *, timeout: float = 5.0) -> None:
        if not isinstance(database_path, (str, Path)):
            raise RepositoryError("database path is invalid")
        path_value = str(database_path)
        if not path_value or len(path_value) > 4096 or "\x00" in path_value:
            raise RepositoryError("database path is invalid")
        if not isinstance(timeout, (int, float)) or isinstance(timeout, bool) or not 0.5 <= timeout <= 30:
            raise RepositoryError("database timeout is invalid")
        self.database_path = Path(path_value).expanduser()
        if not self.database_path.is_absolute():
            self.database_path = Path(__file__).resolve().parents[2] / self.database_path
        self.timeout = float(timeout)

    def _connect(self) -> sqlite3.Connection:
        try:
            connection = sqlite3.connect(
                str(self.database_path),
                timeout=self.timeout,
                isolation_level="DEFERRED",
            )
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA foreign_keys = ON")
            connection.execute("PRAGMA busy_timeout = 5000")
            return connection
        except (sqlite3.Error, OSError) as exc:
            logger.error("warehouse database connection failed (%s)", type(exc).__name__)
            raise RepositoryError("warehouse database is unavailable") from exc

    @contextmanager
    def _session(self) -> Iterator[sqlite3.Connection]:
        connection = self._connect()
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def close(self) -> None:
        """Close repository resources. Per-call SQLite connections require no teardown."""
        pass

    def initialize(self) -> None:
        try:
            self.database_path.parent.mkdir(parents=True, exist_ok=True)
            with self._session() as connection:
                connection.execute("PRAGMA journal_mode = WAL")
                connection.execute(
                    """CREATE TABLE IF NOT EXISTS schema_version (
                        version INTEGER PRIMARY KEY,
                        applied_at TEXT NOT NULL,
                        description TEXT NOT NULL
                    )"""
                )
                row = connection.execute("SELECT MAX(version) FROM schema_version").fetchone()
                current_ver = row[0] if row and row[0] is not None else 0
                if current_ver > SCHEMA_VERSION:
                    raise RepositoryError(
                        f"database schema version {current_ver} exceeds supported version {SCHEMA_VERSION}"
                    )
                if current_ver < 1:
                    connection.execute(
                        """CREATE TABLE IF NOT EXISTS disruption_cases (
                            case_id TEXT PRIMARY KEY,
                            affected_sku TEXT NOT NULL,
                            reported_at TEXT NOT NULL,
                            payload_json TEXT NOT NULL,
                            created_at TEXT NOT NULL,
                            updated_at TEXT NOT NULL
                        )"""
                    )
                    connection.execute(
                        """CREATE TABLE IF NOT EXISTS recovery_plans (
                            plan_id TEXT PRIMARY KEY,
                            case_id TEXT NOT NULL REFERENCES disruption_cases(case_id) ON DELETE CASCADE,
                            status TEXT NOT NULL,
                            generated_at TEXT NOT NULL,
                            payload_json TEXT NOT NULL,
                            created_at TEXT NOT NULL
                        )"""
                    )
                    connection.execute(
                        "CREATE INDEX IF NOT EXISTS idx_cases_updated ON disruption_cases(updated_at DESC)"
                    )
                    connection.execute(
                        "CREATE INDEX IF NOT EXISTS idx_plans_case ON recovery_plans(case_id, generated_at DESC)"
                    )
                    now_str = datetime.now(timezone.utc).isoformat()
                    connection.execute(
                        "INSERT OR IGNORE INTO schema_version (version, applied_at, description) VALUES (?, ?, ?)",
                        (1, now_str, "initial schema: disruption_cases and recovery_plans"),
                    )
                if current_ver < 2:
                    connection.execute(
                        """CREATE TABLE IF NOT EXISTS procurement_approvals (
                            approval_id TEXT PRIMARY KEY,
                            case_id TEXT NOT NULL REFERENCES disruption_cases(case_id) ON DELETE CASCADE,
                            plan_id TEXT NOT NULL REFERENCES recovery_plans(plan_id) ON DELETE CASCADE,
                            plan_fingerprint TEXT NOT NULL,
                            approved_by TEXT NOT NULL,
                            approved_at TEXT NOT NULL,
                            expires_at TEXT NOT NULL,
                            max_total_cost TEXT NOT NULL,
                            currency TEXT NOT NULL,
                            revoked INTEGER NOT NULL DEFAULT 0,
                            revoked_at TEXT,
                            revoked_by TEXT,
                            revocation_reason TEXT,
                            payload_json TEXT NOT NULL,
                            created_at TEXT NOT NULL,
                            updated_at TEXT NOT NULL
                        )"""
                    )
                    connection.execute(
                        "CREATE INDEX IF NOT EXISTS idx_approvals_plan ON procurement_approvals(plan_id, approved_at DESC)"
                    )
                    connection.execute(
                        "CREATE INDEX IF NOT EXISTS idx_approvals_case ON procurement_approvals(case_id, approved_at DESC)"
                    )
                    now_str = datetime.now(timezone.utc).isoformat()
                    connection.execute(
                        "INSERT OR IGNORE INTO schema_version (version, applied_at, description) VALUES (?, ?, ?)",
                        (2, now_str, "procurement_approvals schema and indexes"),
                    )
                if current_ver < 3:
                    connection.execute(
                        """CREATE TABLE IF NOT EXISTS audit_events (
                            event_id TEXT PRIMARY KEY,
                            event_type TEXT NOT NULL,
                            entity_type TEXT NOT NULL,
                            entity_id TEXT NOT NULL,
                            actor_id TEXT NOT NULL,
                            occurred_at TEXT NOT NULL,
                            details_json TEXT NOT NULL
                        )"""
                    )
                    connection.execute(
                        "CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_events(entity_id, occurred_at DESC)"
                    )
                    now_str = datetime.now(timezone.utc).isoformat()
                    connection.execute(
                        "INSERT OR IGNORE INTO schema_version (version, applied_at, description) VALUES (?, ?, ?)",
                        (3, now_str, "audit_events schema and indexes"),
                    )
        except RepositoryError:
            raise
        except (sqlite3.Error, OSError) as exc:
            logger.error("warehouse database initialization failed (%s)", type(exc).__name__)
            raise RepositoryError("warehouse database could not be initialized") from exc

    def create_case(self, case: DisruptionCase) -> DisruptionCase:
        clean, payload = serialize_case(case)
        now = datetime.now(timezone.utc).isoformat()
        try:
            with self._session() as connection:
                connection.execute(
                    """INSERT INTO disruption_cases
                    (case_id, affected_sku, reported_at, payload_json, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)""",
                    (clean.case_id, clean.affected_sku, clean.reported_at.isoformat(), payload, now, now),
                )
        except sqlite3.IntegrityError as exc:
            raise RepositoryConflict("case identifier already exists") from exc
        except sqlite3.Error as exc:
            logger.error("disruption case write failed (%s)", type(exc).__name__)
            raise RepositoryError("disruption case could not be saved") from exc
        return clean

    def get_case(self, case_id: str) -> DisruptionCase:
        clean_id = validate_identifier(case_id)
        try:
            with self._session() as connection:
                row = connection.execute(
                    "SELECT payload_json FROM disruption_cases WHERE case_id = ?",
                    (clean_id,),
                ).fetchone()
        except sqlite3.Error as exc:
            logger.error("disruption case read failed (%s)", type(exc).__name__)
            raise RepositoryError("disruption case could not be read") from exc
        if row is None:
            raise RepositoryNotFound("disruption case was not found")
        return deserialize_case(row["payload_json"])

    def list_cases(self, *, limit: int = 50, offset: int = 0) -> tuple[list[DisruptionCase], int]:
        limit, offset = validate_pagination(limit, offset)
        try:
            with self._session() as connection:
                count = int(connection.execute("SELECT COUNT(*) FROM disruption_cases").fetchone()[0])
                rows = connection.execute(
                    "SELECT payload_json FROM disruption_cases ORDER BY updated_at DESC, case_id ASC LIMIT ? OFFSET ?",
                    (limit, offset),
                ).fetchall()
        except sqlite3.Error as exc:
            logger.error("disruption case listing failed (%s)", type(exc).__name__)
            raise RepositoryError("disruption cases could not be listed") from exc
        return [deserialize_case(row["payload_json"]) for row in rows], count

    def save_plan(self, plan: RecoveryPlan) -> RecoveryPlan:
        clean, payload = serialize_plan(plan)
        now = datetime.now(timezone.utc).isoformat()
        try:
            with self._session() as connection:
                exists = connection.execute(
                    "SELECT 1 FROM disruption_cases WHERE case_id = ?",
                    (clean.case_id,),
                ).fetchone()
                if exists is None:
                    raise RepositoryNotFound("disruption case was not found")
                connection.execute(
                    """INSERT INTO recovery_plans
                    (plan_id, case_id, status, generated_at, payload_json, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)""",
                    (clean.plan_id, clean.case_id, clean.status.value, clean.generated_at.isoformat(), payload, now),
                )
        except RepositoryNotFound:
            raise
        except sqlite3.IntegrityError as exc:
            if "FOREIGN KEY" in str(exc).upper():
                raise RepositoryNotFound("disruption case was not found") from exc
            raise RepositoryConflict("recovery plan identifier already exists") from exc
        except sqlite3.Error as exc:
            logger.error("recovery plan write failed (%s)", type(exc).__name__)
            raise RepositoryError("recovery plan could not be saved") from exc
        return clean

    def get_plan(self, plan_id: str) -> RecoveryPlan:
        clean_id = validate_identifier(plan_id)
        try:
            with self._session() as connection:
                row = connection.execute(
                    "SELECT payload_json FROM recovery_plans WHERE plan_id = ?",
                    (clean_id,),
                ).fetchone()
        except sqlite3.Error as exc:
            logger.error("recovery plan read failed (%s)", type(exc).__name__)
            raise RepositoryError("recovery plan could not be read") from exc
        if row is None:
            raise RepositoryNotFound("recovery plan was not found")
        return deserialize_plan(row["payload_json"])

    def list_plans(
        self, case_id: str, *, limit: int = 50, offset: int = 0
    ) -> tuple[list[RecoveryPlan], int]:
        clean_id = validate_identifier(case_id)
        limit, offset = validate_pagination(limit, offset)
        try:
            with self._session() as connection:
                exists = connection.execute(
                    "SELECT 1 FROM disruption_cases WHERE case_id = ?", (clean_id,)
                ).fetchone()
                if exists is None:
                    raise RepositoryNotFound("disruption case was not found")
                count = int(connection.execute(
                    "SELECT COUNT(*) FROM recovery_plans WHERE case_id = ?", (clean_id,)
                ).fetchone()[0])
                rows = connection.execute(
                    "SELECT payload_json FROM recovery_plans WHERE case_id = ? ORDER BY generated_at DESC, plan_id ASC LIMIT ? OFFSET ?",
                    (clean_id, limit, offset),
                ).fetchall()
        except RepositoryNotFound:
            raise
        except sqlite3.Error as exc:
            logger.error("recovery plan listing failed (%s)", type(exc).__name__)
            raise RepositoryError("recovery plans could not be listed") from exc
        return [deserialize_plan(row["payload_json"]) for row in rows], count

    def save_approval(self, approval: ProcurementApproval) -> ProcurementApproval:
        clean, payload = serialize_approval(approval)
        now_dt = datetime.now(timezone.utc)
        now_str = now_dt.isoformat()
        try:
            with self._session() as connection:
                case_row = connection.execute(
                    "SELECT payload_json FROM disruption_cases WHERE case_id = ?",
                    (clean.case_id,),
                ).fetchone()
                if case_row is None:
                    raise RepositoryNotFound("disruption case was not found")
                case = deserialize_case(case_row["payload_json"])

                plan_row = connection.execute(
                    "SELECT payload_json FROM recovery_plans WHERE plan_id = ?",
                    (clean.plan_id,),
                ).fetchone()
                if plan_row is None:
                    raise RepositoryNotFound("recovery plan was not found")
                plan = deserialize_plan(plan_row["payload_json"])

                if plan.case_id != clean.case_id:
                    raise RepositoryConflict("approval case_id does not match recovery plan case_id")
                if plan.status != RecoveryPlanStatus.PROPOSED:
                    raise RepositoryError("only proposed recovery plans can be approved")
                if clean.currency != plan.currency or clean.currency != case.currency:
                    raise RepositoryError("approval currency does not match recovery plan or case")
                if plan.total_cost > clean.max_total_cost:
                    raise RepositoryError("plan total cost exceeds approved maximum total cost")
                if case.budget is not None and plan.total_cost > case.budget:
                    raise RepositoryError("recovery plan exceeds case budget")

                expected_fingerprint = plan.compute_fingerprint()
                if clean.plan_fingerprint and clean.plan_fingerprint != expected_fingerprint:
                    raise RepositoryConflict("approval fingerprint does not match persisted recovery plan")

                if not clean.plan_fingerprint:
                    clean = clean.model_copy(update={"plan_fingerprint": expected_fingerprint})
                    _, payload = serialize_approval(clean)

                if clean.is_expired(clean.approved_at):
                    raise RepositoryError("cannot record an expired approval")
                if clean.is_revoked():
                    raise RepositoryError("cannot record an already revoked approval")

                connection.execute(
                    """INSERT INTO procurement_approvals
                    (approval_id, case_id, plan_id, plan_fingerprint, approved_by, approved_at,
                     expires_at, max_total_cost, currency, revoked, revoked_at, revoked_by,
                     revocation_reason, payload_json, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        clean.approval_id,
                        clean.case_id,
                        clean.plan_id,
                        clean.plan_fingerprint,
                        clean.approved_by,
                        clean.approved_at.isoformat(),
                        clean.expires_at.isoformat(),
                        str(clean.max_total_cost),
                        clean.currency,
                        1 if clean.is_revoked() else 0,
                        clean.revoked_at.isoformat() if clean.revoked_at else None,
                        clean.revoked_by,
                        clean.revocation_reason,
                        payload,
                        now_str,
                        now_str,
                    ),
                )
        except (RepositoryNotFound, RepositoryConflict, RepositoryError):
            raise
        except sqlite3.IntegrityError as exc:
            if "FOREIGN KEY" in str(exc).upper():
                raise RepositoryNotFound("referenced case or plan was not found") from exc
            raise RepositoryConflict("approval identifier already exists") from exc
        except sqlite3.Error as exc:
            logger.error("procurement approval write failed (%s)", type(exc).__name__)
            raise RepositoryError("procurement approval could not be saved") from exc
        return clean

    def get_approval(self, approval_id: str) -> ProcurementApproval:
        clean_id = validate_identifier(approval_id)
        try:
            with self._session() as connection:
                row = connection.execute(
                    "SELECT payload_json FROM procurement_approvals WHERE approval_id = ?",
                    (clean_id,),
                ).fetchone()
        except sqlite3.Error as exc:
            logger.error("procurement approval read failed (%s)", type(exc).__name__)
            raise RepositoryError("procurement approval could not be read") from exc
        if row is None:
            raise RepositoryNotFound("procurement approval was not found")
        return deserialize_approval(row["payload_json"])

    def list_approvals(
        self, plan_id: str, *, limit: int = 50, offset: int = 0
    ) -> tuple[list[ProcurementApproval], int]:
        clean_id = validate_identifier(plan_id)
        limit, offset = validate_pagination(limit, offset)
        try:
            with self._session() as connection:
                exists = connection.execute(
                    "SELECT 1 FROM recovery_plans WHERE plan_id = ?", (clean_id,)
                ).fetchone()
                if exists is None:
                    raise RepositoryNotFound("recovery plan was not found")
                count = int(
                    connection.execute(
                        "SELECT COUNT(*) FROM procurement_approvals WHERE plan_id = ?",
                        (clean_id,),
                    ).fetchone()[0]
                )
                rows = connection.execute(
                    "SELECT payload_json FROM procurement_approvals WHERE plan_id = ? "
                    "ORDER BY approved_at DESC, approval_id ASC LIMIT ? OFFSET ?",
                    (clean_id, limit, offset),
                ).fetchall()
        except RepositoryNotFound:
            raise
        except sqlite3.Error as exc:
            logger.error("procurement approvals listing failed (%s)", type(exc).__name__)
            raise RepositoryError("procurement approvals could not be listed") from exc
        return [deserialize_approval(row["payload_json"]) for row in rows], count

    def get_active_approval(
        self, plan_id: str, *, as_of: datetime | None = None
    ) -> ProcurementApproval | None:
        clean_id = validate_identifier(plan_id)
        check_time = as_of or datetime.now(timezone.utc)
        if check_time.tzinfo is None or check_time.utcoffset() is None:
            raise RepositoryError("comparison time must include a timezone")
        try:
            with self._session() as connection:
                plan_row = connection.execute(
                    "SELECT payload_json FROM recovery_plans WHERE plan_id = ?",
                    (clean_id,),
                ).fetchone()
                if plan_row is None:
                    raise RepositoryNotFound("recovery plan was not found")
                plan = deserialize_plan(plan_row["payload_json"])
                current_fingerprint = plan.compute_fingerprint()

                rows = connection.execute(
                    "SELECT payload_json FROM procurement_approvals "
                    "WHERE plan_id = ? AND revoked = 0 "
                    "ORDER BY approved_at DESC, created_at DESC",
                    (clean_id,),
                ).fetchall()

                for row in rows:
                    approval = deserialize_approval(row["payload_json"])
                    if approval.is_revoked():
                        continue
                    if approval.is_expired(check_time):
                        continue
                    if approval.approved_at > check_time:
                        continue
                    if approval.plan_fingerprint != current_fingerprint:
                        continue
                    if plan.total_cost > approval.max_total_cost:
                        continue
                    if plan.currency != approval.currency:
                        continue
                    return approval
                return None
        except RepositoryNotFound:
            raise
        except sqlite3.Error as exc:
            logger.error("active approval read failed (%s)", type(exc).__name__)
            raise RepositoryError("active approval could not be read") from exc

    def revoke_approval(
        self,
        approval_id: str,
        *,
        revoked_by: str,
        reason: str | None = None,
        at: datetime | None = None,
    ) -> ProcurementApproval:
        clean_id = validate_identifier(approval_id)
        if not isinstance(revoked_by, str) or not revoked_by.strip():
            raise RepositoryError("revoking approver identity is required")
        revocation_time = at or datetime.now(timezone.utc)
        if revocation_time.tzinfo is None or revocation_time.utcoffset() is None:
            raise RepositoryError("comparison time must include a timezone")
        now_str = revocation_time.isoformat()
        try:
            with self._session() as connection:
                row = connection.execute(
                    "SELECT payload_json FROM procurement_approvals WHERE approval_id = ?",
                    (clean_id,),
                ).fetchone()
                if row is None:
                    raise RepositoryNotFound("procurement approval was not found")
                approval = deserialize_approval(row["payload_json"])
                updated_approval = approval.model_copy(
                    update={
                        "revoked": True,
                        "revoked_at": revocation_time,
                        "revoked_by": revoked_by.strip(),
                        "revocation_reason": reason.strip() if reason else "revoked by authorized actor",
                    }
                )
                _, payload = serialize_approval(updated_approval)
                connection.execute(
                    """UPDATE procurement_approvals
                    SET revoked = 1,
                        revoked_at = ?,
                        revoked_by = ?,
                        revocation_reason = ?,
                        payload_json = ?,
                        updated_at = ?
                    WHERE approval_id = ?""",
                    (
                        updated_approval.revoked_at.isoformat(),
                        updated_approval.revoked_by,
                        updated_approval.revocation_reason,
                        payload,
                        now_str,
                        clean_id,
                    ),
                )
                return updated_approval
        except RepositoryNotFound:
            raise
        except sqlite3.Error as exc:
            logger.error("procurement approval revocation failed (%s)", type(exc).__name__)
            raise RepositoryError("procurement approval could not be revoked") from exc

    def record_audit_event(self, event: AuditEvent) -> AuditEvent:
        clean, payload = serialize_audit_event(event)
        now_str = clean.occurred_at.isoformat()
        try:
            with self._session() as connection:
                connection.execute(
                    """INSERT INTO audit_events
                    (event_id, event_type, entity_type, entity_id, actor_id, occurred_at, details_json)
                    VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (
                        clean.event_id,
                        clean.event_type,
                        clean.entity_type,
                        clean.entity_id,
                        clean.actor_id,
                        now_str,
                        payload,
                    ),
                )
        except sqlite3.IntegrityError as exc:
            raise RepositoryConflict("audit event identifier already exists") from exc
        except sqlite3.Error as exc:
            logger.error("audit event recording failed (%s)", type(exc).__name__)
            raise RepositoryError("audit event could not be recorded") from exc
        return clean

    def list_audit_events(
        self, entity_id: str, *, limit: int = 50, offset: int = 0
    ) -> tuple[list[AuditEvent], int]:
        clean_id = validate_identifier(entity_id)
        limit, offset = validate_pagination(limit, offset)
        try:
            with self._session() as connection:
                count = int(
                    connection.execute(
                        "SELECT COUNT(*) FROM audit_events WHERE entity_id = ?",
                        (clean_id,),
                    ).fetchone()[0]
                )
                rows = connection.execute(
                    "SELECT details_json FROM audit_events WHERE entity_id = ? "
                    "ORDER BY occurred_at DESC, event_id ASC LIMIT ? OFFSET ?",
                    (clean_id, limit, offset),
                ).fetchall()
        except sqlite3.Error as exc:
            logger.error("audit events listing failed (%s)", type(exc).__name__)
            raise RepositoryError("audit events could not be listed") from exc
        return [deserialize_audit_event(row["details_json"]) for row in rows], count




def get_repository(settings: Settings | None = None) -> WarehouseRepository:
    from shared.config import get_settings

    config = settings or get_settings()
    backend = config.database_backend
    if backend == "postgres":
        if not config.warehouse_database_url or not config.warehouse_database_url.get_secret_value().strip():
            raise RepositoryError(
                "WAREHOUSE_DATABASE_URL is required when DATABASE_BACKEND=postgres"
            )
        from services.warehouse_api.postgres_repository import (
            PostgresWarehouseRepository,
        )

        return PostgresWarehouseRepository(
            config.warehouse_database_url.get_secret_value(),
            timeout=config.database_timeout_seconds,
            environment=config.stockrescue_env,
        )

    if config.stockrescue_env == "production":
        raise RepositoryError(
            "production environment requires DATABASE_BACKEND=postgres"
        )

    return SQLiteWarehouseRepository(
        config.database_path,
        timeout=config.database_timeout_seconds,
    )