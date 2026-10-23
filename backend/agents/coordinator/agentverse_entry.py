from __future__ import annotations

import asyncio
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4
from dotenv import load_dotenv
from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    TextContent,
    chat_protocol_spec,
)

from agents.coordinator.agent import run_coordinator
from agents.protocols.agentverse_transport import AgentverseTaskExchange
from agents.protocols.transport import SpecialistTransport
from services.warehouse_api.repository import (
    RepositoryError,
    RepositoryNotFound,
    get_repository,
)
from shared.config import get_settings
from services.intent.resolve_intent import resolve_intent

MAX_CHAT_CHARS = 2_000
MAX_REPLY_CHARS = 1_000
CASE_COMMAND = re.compile(
    r"^(?:recover|analyze|analyse|plan)\s+(?:case\s+)?"
    r"([A-Za-z0-9][A-Za-z0-9._:-]{0,99})$",
    re.IGNORECASE | re.ASCII,
)
AGENT_NAME = "stockrescue-coordinator"
AGENT_PORT = 8091


def _message_text(message: ChatMessage) -> str:
    chunks = []
    total = 0

    for item in message.content:
        if not isinstance(item, TextContent):
            continue

        total += len(item.text)
        if total > MAX_CHAT_CHARS:
            return "!message-too-large"

        chunks.append(item.text)

    return " ".join(chunks).strip()


def create_agent(seed: str) -> Agent:
    if (
        not isinstance(seed, str)
        or not 16 <= len(seed) <= 256
        or not seed.isprintable()
    ):
        raise ValueError("coordinator seed is invalid")
    settings = get_settings()
    repository = get_repository(settings)
    repository.initialize()

    raw_chat_allowed = os.getenv("AGENTVERSE_CHAT_ALLOWED_SENDERS", "")
    allowed_senders = {
        value.strip()
        for value in raw_chat_allowed.split(",")
        if value.strip()
    }

    agent = Agent(
        name=AGENT_NAME,
        seed=seed,
        port=AGENT_PORT,
        mailbox=True,
        publish_agent_details=True,
    )

    # Attach AgentverseTaskExchange for remote specialist communication
    exchange = AgentverseTaskExchange(
        agent=agent,
        allowed_specialist_addresses=settings.get_specialist_allowed_senders(),
        default_timeout=settings.specialist_timeout_seconds,
    )
    exchange.attach_to_agent()

    recipient_addresses = {
        role: settings.get_specialist_address(role)
        for role in [
            "inventory_bom",
            "job_impact",
            "supplier_discovery",
            "compatibility",
            "quote_risk",
            "recovery_planner",
            "procurement",
            "vendor_voice",
            "delivery_watch",
        ]
    }
    transport = SpecialistTransport(
        mode=settings.specialist_transport_mode,
        sender_identity=agent.address,
        recipient_addresses=recipient_addresses,
        timeout_seconds=settings.specialist_timeout_seconds,
        max_retries=settings.specialist_max_retries,
        remote_caller=exchange.sync_caller if settings.specialist_transport_mode == "agentverse" else None,
    )

    protocol = Protocol(spec=chat_protocol_spec)

    @protocol.on_message(ChatMessage)
    async def handle_message(
        ctx: Context,
        sender: str,
        message: ChatMessage,
    ):
        await ctx.send(
            sender,
            ChatAcknowledgement(
                timestamp=datetime.now(timezone.utc),
                acknowledged_msg_id=message.msg_id,
            ),
        )

        ctx.logger.info("Received chat request from sender=%s", sender)

        text = _message_text(message)
        mention = f"@{agent.address}"

        if text.casefold().startswith(mention.casefold()):
            text = text[len(mention):].lstrip(" \t\r\n,:;")

        if text == "!message-too-large":
            response = "Message is too long. Send a shorter command."
        else:
            decision = resolve_intent(text)

            if decision.intent == "help":
                response = (
                    "StockRescue can analyze a stored disruption case. "
                    "Send `recover <case_id>` to request an assessment. "
                    "Purchasing is not authorized by this command."
                )

            elif decision.intent == "recover_case" and decision.case_id:
                if not allowed_senders or sender not in allowed_senders:
                    response = (
                        "Recovery access is restricted. Configure "
                        "AGENTVERSE_CHAT_ALLOWED_SENDERS for this sender."
                    )
                else:
                    try:
                        case = repository.get_case(decision.case_id)
                        # Run workflow in worker thread to prevent blocking uAgents event loop
                        result = await asyncio.to_thread(
                            run_coordinator,
                            case,
                            transport=transport,
                        )

                        response = (
                            f"Case: {case.case_id}. "
                            f"Outcome: {result.outcome.value}. "
                            f"{result.summary} Procurement authorized: no."
                        )

                    except RepositoryNotFound:
                        response = "No stored case matches that identifier."

                    except RepositoryError as exc:
                        ctx.logger.error(
                            "Warehouse read failed (%s)",
                            type(exc).__name__,
                        )
                        response = "The warehouse service could not load this case."

                    except Exception as exc:
                        ctx.logger.error(
                            "Recovery workflow failed (%s)",
                            type(exc).__name__,
                        )
                        response = "Recovery analysis failed. Check the service logs."

            else:
                response = (
                    "I couldn't identify a supported StockRescue request. "
                    "Ask for help or specify a case ID to recover."
                )

        await ctx.send(
            sender,
            ChatMessage(
                timestamp=datetime.now(timezone.utc),
                msg_id=uuid4(),
                content=[
                    TextContent(type="text", text=response[:MAX_REPLY_CHARS]),
                    EndSessionContent(type="end-session"),
                ],
            ),
        )

    @protocol.on_message(ChatAcknowledgement)
    async def handle_acknowledgement(
        ctx: Context,
        sender: str,
        message: ChatAcknowledgement,
    ):
        ctx.logger.debug(
            "Received acknowledgement from %s",
            sender,
        )

    agent.include(protocol, publish_manifest=True)
    return agent


def main() -> None:
    env_path = Path(__file__).resolve().parents[2] / ".env"
    load_dotenv(env_path)

    seed = os.getenv("AGENTVERSE_SEED_COORDINATOR", "")
    if not seed:
        raise SystemExit(
            "Set AGENTVERSE_SEED_COORDINATOR in backend/.env before startup."
        )

    create_agent(seed).run()


if __name__ == "__main__":
    main()

