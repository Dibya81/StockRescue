"""Agentverse mailbox entry point for Supplier Sourcing specialist.

Consolidated 8-identity configuration:
This mailbox identity handles both `supplier_discovery` and `compatibility` tasks,
routing each to its dedicated specialist function while sharing this single mailbox.
"""

from __future__ import annotations

from uagents import Agent

from agents.protocols.agentverse_helper import create_specialist_agent, run_specialist_main

AGENT_NAME = "stockrescue-supplier-discovery"
AGENT_PORT = 8094
SEED_ENV_VAR = "AGENTVERSE_SEED_SUPPLIER_DISCOVERY"


def create_agent(seed: str, allowed_senders: set[str] | None = None) -> Agent:
    return create_specialist_agent(
        role="supplier_discovery",
        agent_name=AGENT_NAME,
        port=AGENT_PORT,
        seed=seed,
        allowed_senders=allowed_senders,
    )


def main() -> None:
    run_specialist_main(
        role="supplier_discovery",
        agent_name=AGENT_NAME,
        default_port=AGENT_PORT,
        seed_env_var=SEED_ENV_VAR,
    )


if __name__ == "__main__":
    main()
