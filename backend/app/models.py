from __future__ import annotations

import time
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictFloat, StrictInt, StrictStr


ScalarValue = StrictBool | StrictInt | StrictFloat | StrictStr
Operator = Literal["==", "!=", ">", ">=", "<", "<="]


class Condition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    variable: str = Field(min_length=1)
    operator: Operator
    value: ScalarValue


class Action(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target: str = Field(min_length=1)
    value: ScalarValue


class RuleCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    enabled: bool = True
    priority: int = Field(ge=0, le=100)
    conditions: list[Condition] = Field(min_length=1, max_length=5)
    action: Action


class RuleUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=100)
    enabled: bool | None = None
    priority: int | None = Field(default=None, ge=0, le=100)
    conditions: list[Condition] | None = Field(default=None, min_length=1, max_length=5)
    action: Action | None = None


class RuleToggle(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool


class Rule(RuleCreate):
    id: str
    created_sequence: int


class EnvironmentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    changes: dict[str, ScalarValue] = Field(min_length=1)


class SimulationStart(BaseModel):
    model_config = ConfigDict(extra="forbid")

    seed: int


DemoStageName = Literal["normal", "heat", "fire", "safety_override"]


class DemoStageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    stage: DemoStageName


class ProposalSummary(BaseModel):
    rule_id: str
    rule_name: str
    priority: int
    created_sequence: int
    value: ScalarValue


class ConflictRecord(BaseModel):
    target: str
    winner: ProposalSummary
    proposals: list[ProposalSummary]
    reason: str


class GraphSnapshot(BaseModel):
    nodes: list[dict[str, Any]] = Field(default_factory=list)
    edges: list[dict[str, Any]] = Field(default_factory=list)


class PerformanceSnapshot(BaseModel):
    events_per_second: int = 0
    target_events_per_second: int = 500
    accepted_events: int = 0
    rejected_events: int = 0


class Snapshot(BaseModel):
    type: Literal["snapshot"] = "snapshot"
    emitted_at_ms: int = Field(default_factory=lambda: int(time.time() * 1000))
    revision: int
    state: dict[str, ScalarValue]
    rules: list[Rule]
    graph: GraphSnapshot
    active_rule_ids: list[str]
    conflicts: list[ConflictRecord]
    connected_sessions: int = 0
    simulation_running: bool = False
    simulation_seed: int | None = None
    perf: PerformanceSnapshot = Field(default_factory=PerformanceSnapshot)


class CycleError(BaseModel):
    code: Literal["CYCLE_DETECTED"] = "CYCLE_DETECTED"
    message: str = "The proposed rule creates a circular dependency."
    path: list[str]
    proposed_edges: list[dict[str, str]]
