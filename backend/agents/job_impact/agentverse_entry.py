"""Agentverse mailbox entry point for Job Impact specialist."""

from __future__ import annotations

from uagents import Agent

from agents.protocols.agentverse_helper import create_specialist_agent, run_specialist_main

AGENT_NAME = "stockrescue-job-impact"
AGENT_PORT = 8093
SEED_ENV_VAR = "AGENTVERSE_SEED_JOB_IMPACT"


def create_agent(seed: str, allowed_senders: set[str] | None = None) -> Agent:
    return create_specialist_agent(
        role="job_impact",
        agent_name=AGENT_NAME,
        port=AGENT_PORT,
        seed=seed,
        allowed_senders=allowed_senders,
    )


def main() -> None:
    run_specialist_main(
        role="job_impact",
        agent_name=AGENT_NAME,
        default_port=AGENT_PORT,
        seed_env_var=SEED_ENV_VAR,
    )


if __name__ == "__main__":
    main()
