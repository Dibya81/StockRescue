
from __future__ import annotations
from datetime import datetime
from agents.coordinator.langgraph_workflow import run_coordinator_graph
from agents.protocols.transport import SpecialistTransport
from shared.agent_contracts import CoordinatorResult
from shared.models import DisruptionCase

def run_coordinator(
    case: DisruptionCase,
    *,
    workflow_id: str | None = None,
    trace_id: str | None = None,
    as_of: datetime | None = None,
    transport: SpecialistTransport | None = None,
) -> CoordinatorResult:
    return run_coordinator_graph(
        case,
        workflow_id=workflow_id,
        trace_id=trace_id,
        as_of=as_of,
        transport=transport,
    )