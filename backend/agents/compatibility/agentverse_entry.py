"""RETIRED: Standalone Compatibility mailbox entry point.

Consolidated 8-identity configuration:
This standalone identity has been retired. Compatibility tasks are now served
by the Supplier Sourcing specialist (`agents.supplier_discovery.agentverse_entry`)
using the shared `AGENTVERSE_SUPPLIER_DISCOVERY_ADDRESS`.
"""

from __future__ import annotations

from uagents import Agent

from agents.protocols.agentverse_helper import create_specialist_agent

AGENT_NAME = "stockrescue-compatibility"
AGENT_PORT = 8095
SEED_ENV_VAR = "AGENTVERSE_SEED_COMPATIBILITY"


def create_agent(seed: str, allowed_senders: set[str] | None = None) -> Agent:
    """Legacy helper maintained for test compatibility."""
    return create_specialist_agent(
        role="compatibility",
        agent_name=AGENT_NAME,
        port=AGENT_PORT,
        seed=seed,
        allowed_senders=allowed_senders,
    )


def main() -> None:
    raise SystemExit(
        "Compatibility specialist identity has been consolidated into the Supplier Discovery "
        "mailbox (Supplier Sourcing) under the 8-identity configuration. "
        "Run `python -m agents.supplier_discovery.agentverse_entry` instead."
    )


if __name__ == "__main__":
    main()
