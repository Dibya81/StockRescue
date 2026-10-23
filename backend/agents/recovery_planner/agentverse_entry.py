"""RETIRED: Standalone Recovery Planner mailbox entry point.

Consolidated 8-identity configuration:
This standalone identity has been retired. Recovery planning tasks are now served
by the Quote & Planning specialist (`agents.quote_risk.agentverse_entry`)
using the shared `AGENTVERSE_QUOTE_RISK_ADDRESS`.
"""

from __future__ import annotations

from uagents import Agent

from agents.protocols.agentverse_helper import create_specialist_agent

AGENT_NAME = "stockrescue-recovery-planner"
AGENT_PORT = 8097
SEED_ENV_VAR = "AGENTVERSE_SEED_RECOVERY_PLANNER"


def create_agent(seed: str, allowed_senders: set[str] | None = None) -> Agent:
    """Legacy helper maintained for test compatibility."""
    return create_specialist_agent(
        role="recovery_planner",
        agent_name=AGENT_NAME,
        port=AGENT_PORT,
        seed=seed,
        allowed_senders=allowed_senders,
    )


def main() -> None:
    raise SystemExit(
        "Recovery Planner specialist identity has been consolidated into the Quote Risk "
        "mailbox (Quote & Planning) under the 8-identity configuration. "
        "Run `python -m agents.quote_risk.agentverse_entry` instead."
    )


if __name__ == "__main__":
    main()
