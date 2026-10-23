"""Comprehensive unit tests for AgentverseTaskExchange transport and verification."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import os
import time
from uuid import uuid4
from unittest.mock import AsyncMock, patch

import pytest
from uagents_core.identity import Identity
from uagents_core.types import DeliveryStatus, MsgStatus

from agents.protocols.agentverse_transport import AgentverseTaskExchange
from agents.protocols.messages import (
    CorrelationMismatchError,
    TaskErrorCode,
    TaskRequest,
    TaskResponse,
    TaskResponseStatus,
)
from agents.protocols.transport import SpecialistExecutionError
from shared.config import Settings

COORD_SEED = "agentverse-test-seed-coordinator-12345"
INVENTORY_SEED = "agentverse-test-seed-inventory-12345"
coord_identity = Identity.from_seed(COORD_SEED, 0)
inv_identity = Identity.from_seed(INVENTORY_SEED, 0)
COORD_ADDR = coord_identity.address
INV_ADDR = inv_identity.address


def test_exchange_successful_typed_request_response():
    async def _test():
        exchange = AgentverseTaskExchange(
            agent_or_identity=coord_identity,
            allowed_specialist_addresses={INV_ADDR},
            default_timeout=5.0,
        )

        req = TaskRequest.create(
            task_type="inventory_bom",
            workflow_id="wf-100",
            trace_id="tr-100",
            sender=COORD_ADDR,
            recipient=INV_ADDR,
            payload={"sku": "BRG-6204"},
            timeout_seconds=5.0,
        )

        with patch("agents.protocols.agentverse_transport.send_message", new_callable=AsyncMock) as mock_send:
            mock_send.return_value = MsgStatus(
                status=DeliveryStatus.DELIVERED,
                detail="Delivered to mailbox",
                destination=INV_ADDR,
                endpoint="https://agentverse.ai/v2/agents/mailbox/submit",
                session=uuid4(),
            )

            async def simulate_specialist_reply():
                await asyncio.sleep(0.05)
                resp = TaskResponse.ok(
                    req,
                    sender="stockrescue-inventory-bom",
                    result={"status": "complete", "available_quantity": 10},
                )
                exchange._route_response(INV_ADDR, resp)

            reply_task = asyncio.create_task(simulate_specialist_reply())
            response = await exchange.send_and_wait_async(destination=INV_ADDR, request=req)
            await reply_task

            assert response.status == TaskResponseStatus.OK
            assert response.correlation_id == req.correlation_id
            assert response.workflow_id == req.workflow_id
            assert response.get_result() == {"status": "complete", "available_quantity": 10}

    asyncio.run(_test())


def test_exchange_delivery_failure_raises_unavailable():
    async def _test():
        exchange = AgentverseTaskExchange(
            agent_or_identity=coord_identity,
            allowed_specialist_addresses={INV_ADDR},
            default_timeout=5.0,
        )

        req = TaskRequest.create(
            task_type="inventory_bom",
            workflow_id="wf-100",
            trace_id="tr-100",
            sender=COORD_ADDR,
            recipient=INV_ADDR,
            payload={"sku": "BRG-6204"},
        )

        with patch("agents.protocols.agentverse_transport.send_message", new_callable=AsyncMock) as mock_send:
            mock_send.return_value = MsgStatus(
                status=DeliveryStatus.FAILED,
                detail="Network connect failed",
                destination=INV_ADDR,
                endpoint="https://agentverse.ai",
                session=uuid4(),
            )

            with pytest.raises(SpecialistExecutionError) as exc_info:
                await exchange.send_and_wait_async(destination=INV_ADDR, request=req)

            assert exc_info.value.status == TaskResponseStatus.UNAVAILABLE
            assert exc_info.value.error_code == TaskErrorCode.AGENT_UNAVAILABLE
            assert "Delivery failed" in str(exc_info.value)

    asyncio.run(_test())


def test_exchange_timeout_when_agent_unavailable():
    async def _test():
        exchange = AgentverseTaskExchange(
            agent_or_identity=coord_identity,
            allowed_specialist_addresses={INV_ADDR},
            default_timeout=0.2,
        )

        req = TaskRequest.create(
            task_type="inventory_bom",
            workflow_id="wf-100",
            trace_id="tr-100",
            sender=COORD_ADDR,
            recipient=INV_ADDR,
            payload={"sku": "BRG-6204"},
            timeout_seconds=0.2,
        )

        with patch("agents.protocols.agentverse_transport.send_message", new_callable=AsyncMock) as mock_send:
            mock_send.return_value = MsgStatus(
                status=DeliveryStatus.DELIVERED,
                detail="Queued",
                destination=INV_ADDR,
                endpoint="https://agentverse.ai",
                session=uuid4(),
            )

            with pytest.raises(SpecialistExecutionError) as exc_info:
                await exchange.send_and_wait_async(destination=INV_ADDR, request=req, timeout=0.2)

            assert exc_info.value.status == TaskResponseStatus.TIMEOUT
            assert exc_info.value.error_code == TaskErrorCode.TIMEOUT

    asyncio.run(_test())


def test_exchange_rejects_unrelated_agent_sender():
    async def _test():
        unrelated_identity = Identity.from_seed("agentverse-unrelated-agent-seed-12345", 0)
        unrelated_addr = unrelated_identity.address

        exchange = AgentverseTaskExchange(
            agent_or_identity=coord_identity,
            allowed_specialist_addresses={INV_ADDR},
            default_timeout=0.3,
        )

        req = TaskRequest.create(
            task_type="inventory_bom",
            workflow_id="wf-100",
            trace_id="tr-100",
            sender=COORD_ADDR,
            recipient=INV_ADDR,
            payload={"sku": "BRG-6204"},
            timeout_seconds=0.3,
        )

        with patch("agents.protocols.agentverse_transport.send_message", new_callable=AsyncMock) as mock_send:
            mock_send.return_value = MsgStatus(
                status=DeliveryStatus.DELIVERED,
                detail="Queued",
                destination=INV_ADDR,
                endpoint="https://agentverse.ai",
                session=uuid4(),
            )

            async def send_unauthorized_reply():
                await asyncio.sleep(0.05)
                resp = TaskResponse.ok(req, sender=unrelated_addr, result={"fake": True})
                exchange._route_response(unrelated_addr, resp)

            reply_task = asyncio.create_task(send_unauthorized_reply())

            with pytest.raises(SpecialistExecutionError) as exc_info:
                await exchange.send_and_wait_async(destination=INV_ADDR, request=req, timeout=0.2)

            await reply_task
            assert exc_info.value.status == TaskResponseStatus.TIMEOUT

    asyncio.run(_test())


def test_exchange_rejects_correlation_and_workflow_mismatch():
    async def _test():
        exchange = AgentverseTaskExchange(
            agent_or_identity=coord_identity,
            allowed_specialist_addresses={INV_ADDR},
            default_timeout=0.3,
        )

        req = TaskRequest.create(
            task_type="inventory_bom",
            workflow_id="wf-100",
            trace_id="tr-100",
            sender=COORD_ADDR,
            recipient=INV_ADDR,
            payload={"sku": "BRG-6204"},
            timeout_seconds=0.3,
        )

        with patch("agents.protocols.agentverse_transport.send_message", new_callable=AsyncMock) as mock_send:
            mock_send.return_value = MsgStatus(
                status=DeliveryStatus.DELIVERED,
                detail="Queued",
                destination=INV_ADDR,
                endpoint="https://agentverse.ai",
                session=uuid4(),
            )

            async def send_mismatched_reply():
                await asyncio.sleep(0.05)
                mismatched_resp = TaskResponse(
                    schema_version="1.0",
                    message_id=str(uuid4()),
                    correlation_id=req.correlation_id,
                    workflow_id="DIFFERENT-WORKFLOW-ID",
                    trace_id=req.trace_id,
                    sender=INV_ADDR,
                    recipient=req.sender,
                    task_type=req.task_type,
                    status=TaskResponseStatus.OK,
                    result_json="{}",
                    created_at=datetime.now(timezone.utc),
                )
                exchange._route_response(INV_ADDR, mismatched_resp)

            reply_task = asyncio.create_task(send_mismatched_reply())

            with pytest.raises(SpecialistExecutionError) as exc_info:
                await exchange.send_and_wait_async(destination=INV_ADDR, request=req, timeout=0.3)

            await reply_task
            assert exc_info.value.status == TaskResponseStatus.INVALID_REQUEST
            assert "Workflow ID mismatch" in str(exc_info.value)

    asyncio.run(_test())


def test_exchange_rejects_expired_deadline():
    async def _test():
        exchange = AgentverseTaskExchange(
            agent_or_identity=coord_identity,
            allowed_specialist_addresses={INV_ADDR},
            default_timeout=0.1,
        )

        req = TaskRequest.create(
            task_type="inventory_bom",
            workflow_id="wf-100",
            trace_id="tr-100",
            sender=COORD_ADDR,
            recipient=INV_ADDR,
            payload={"sku": "BRG-6204"},
            timeout_seconds=0.1,
        )

        with patch("agents.protocols.agentverse_transport.send_message", new_callable=AsyncMock) as mock_send:
            mock_send.return_value = MsgStatus(
                status=DeliveryStatus.DELIVERED,
                detail="Queued",
                destination=INV_ADDR,
                endpoint="https://agentverse.ai",
                session=uuid4(),
            )

            async def send_late_reply():
                await asyncio.sleep(0.15)
                resp = TaskResponse.ok(req, sender=INV_ADDR, result={})
                exchange._route_response(INV_ADDR, resp)

            reply_task = asyncio.create_task(send_late_reply())

            with pytest.raises(SpecialistExecutionError) as exc_info:
                await exchange.send_and_wait_async(destination=INV_ADDR, request=req, timeout=0.1)

            await reply_task
            assert exc_info.value.status == TaskResponseStatus.TIMEOUT

    asyncio.run(_test())


def test_allowlists_separated_and_fail_closed():
    # Chat allowlist configured, specialist empty
    s1 = Settings(
        agentverse_chat_allowed_senders=COORD_ADDR,
        agentverse_specialist_allowed_senders="",
    )
    assert s1.get_chat_allowed_senders() == {COORD_ADDR}
    assert s1.get_specialist_allowed_senders() == set()  # Fail closed!

    # Specialist allowlist configured, chat empty
    s2 = Settings(
        agentverse_chat_allowed_senders="",
        agentverse_specialist_allowed_senders=INV_ADDR,
    )
    assert s2.get_chat_allowed_senders() == set()  # Fail closed!
    assert s2.get_specialist_allowed_senders() == {INV_ADDR}

    # Both empty: both fail closed
    s3 = Settings()
    assert s3.get_chat_allowed_senders() == set()
    assert s3.get_specialist_allowed_senders() == set()
