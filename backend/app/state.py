from __future__ import annotations

import asyncio
import time
from collections import deque

from fastapi import WebSocket

from .engine import recompute_state
from .graph import CycleDetectedError, build_graph_snapshot, validate_acyclic
from .models import PerformanceSnapshot, Rule, RuleCreate, RuleUpdate, ScalarValue, Snapshot
from .starter_rules import starter_rule_creates
from .variables import ACTUATOR_DEFAULTS, SENSOR_DEFAULTS, validate_environment_changes, validate_rule_create


class LiveConnections:
    def __init__(self) -> None:
        self._connections: set[WebSocket] = set()
        self._broadcast_lock = asyncio.Lock()
        self._last_broadcast_revision = -1

    @property
    def count(self) -> int:
        return len(self._connections)

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections.add(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        self._connections.discard(websocket)

    async def broadcast(self, snapshot: Snapshot) -> None:
        # REST handlers release the runtime lock before broadcasting, so two
        # simultaneous commands can otherwise send revision N+1 before N.
        # Serialize broadcasts and discard an already-obsolete snapshot.
        async with self._broadcast_lock:
            if snapshot.revision < self._last_broadcast_revision:
                return
            self._last_broadcast_revision = snapshot.revision

            payload = snapshot.model_dump(mode="json")
            stale: list[WebSocket] = []
            for websocket in list(self._connections):
                try:
                    await websocket.send_json(payload)
                except Exception:
                    stale.append(websocket)
            for websocket in stale:
                self.disconnect(websocket)


class RuleNotFoundError(Exception):
    pass


class RuntimeState:
    def __init__(self) -> None:
        self.lock = asyncio.Lock()
        self.sensor_values: dict[str, ScalarValue] = dict(SENSOR_DEFAULTS)
        self.actuator_defaults: dict[str, ScalarValue] = dict(ACTUATOR_DEFAULTS)
        self.effective_state: dict[str, ScalarValue] = {
            **self.sensor_values,
            **self.actuator_defaults,
        }
        self.rules: list[Rule] = []
        self.active_rule_ids: list[str] = []
        self.conflicts = []
        self.created_sequence = 0
        self.revision = 0
        self.simulation_running = False
        self.simulation_seed: int | None = None
        self.accepted_events = 0
        self.rejected_events = 0
        self.event_times: deque[float] = deque()
        self._load_starter_rules()

    def _load_starter_rules(self) -> None:
        for rule_create in starter_rule_creates():
            validate_rule_create(rule_create)
            next_sequence = self.created_sequence + 1
            rule = Rule(
                **rule_create.model_dump(),
                id=f"rule-{next_sequence}",
                created_sequence=next_sequence,
            )
            validate_acyclic(self.rules, rule)
            self.rules.append(rule)
            self.created_sequence = next_sequence
        self._recompute()

    def _recompute(self) -> None:
        self.effective_state, self.active_rule_ids, self.conflicts = recompute_state(
            self.sensor_values,
            self.actuator_defaults,
            self.rules,
        )

    def _snapshot(self) -> Snapshot:
        cutoff = time.monotonic() - 1.0
        while self.event_times and self.event_times[0] < cutoff:
            self.event_times.popleft()
        return Snapshot(
            revision=self.revision,
            state=dict(self.effective_state),
            rules=list(self.rules),
            graph=build_graph_snapshot(self.rules),
            active_rule_ids=list(self.active_rule_ids),
            conflicts=list(self.conflicts),
            connected_sessions=live_connections.count,
            simulation_running=self.simulation_running,
            simulation_seed=self.simulation_seed,
            perf=PerformanceSnapshot(
                events_per_second=len(self.event_times),
                accepted_events=self.accepted_events,
                rejected_events=self.rejected_events,
            ),
        )

    async def snapshot(self) -> Snapshot:
        async with self.lock:
            return self._snapshot()

    async def update_environment(self, changes: dict[str, ScalarValue]) -> Snapshot:
        return await self.update_environment_events(list(changes.items()))

    async def update_environment_events(
        self,
        events: list[tuple[str, ScalarValue]],
    ) -> Snapshot:
        """Apply an ordered sensor micro-batch as one atomic graph revision."""
        if not events:
            raise ValueError("An environment event batch cannot be empty")
        for variable, value in events:
            validate_environment_changes({variable: value})

        async with self.lock:
            for variable, value in events:
                self.sensor_values[variable] = value
            now = time.monotonic()
            self.event_times.extend(now for _ in events)
            self.accepted_events += len(events)
            self._recompute()
            self.revision += 1
            return self._snapshot()

    async def apply_demo_stage(self, changes: dict[str, ScalarValue]) -> Snapshot:
        """Apply a complete guided-demo sensor state in one revision."""
        validate_environment_changes(changes)
        async with self.lock:
            self.simulation_running = False
            self.simulation_seed = None
            self.sensor_values.update(changes)
            now = time.monotonic()
            self.event_times.extend(now for _ in changes)
            self.accepted_events += len(changes)
            self._recompute()
            self.revision += 1
            return self._snapshot()

    async def set_simulation_status(self, running: bool, seed: int | None = None) -> Snapshot:
        async with self.lock:
            changed = self.simulation_running != running
            self.simulation_running = running
            if seed is not None and seed != self.simulation_seed:
                self.simulation_seed = seed
                changed = True
            if changed:
                self.revision += 1
            return self._snapshot()

    async def record_rejection(self) -> None:
        async with self.lock:
            self.rejected_events += 1

    async def reset_demo(self) -> Snapshot:
        async with self.lock:
            self.sensor_values = dict(SENSOR_DEFAULTS)
            self.effective_state = {**self.sensor_values, **self.actuator_defaults}
            self.rules = []
            self.active_rule_ids = []
            self.conflicts = []
            self.created_sequence = 0
            self.simulation_running = False
            self.simulation_seed = None
            self.accepted_events = 0
            self.rejected_events = 0
            self.event_times.clear()
            self._load_starter_rules()
            self.revision += 1
            return self._snapshot()

    async def add_rule(self, rule_create: RuleCreate) -> Snapshot:
        validate_rule_create(rule_create)
        async with self.lock:
            next_sequence = self.created_sequence + 1
            rule = Rule(
                **rule_create.model_dump(),
                id=f"rule-{next_sequence}",
                created_sequence=next_sequence,
            )
            validate_acyclic(self.rules, rule)
            self.rules.append(rule)
            self.created_sequence = next_sequence
            self._recompute()
            self.revision += 1
            return self._snapshot()

    async def update_rule(self, rule_id: str, update: RuleUpdate) -> Snapshot:
        async with self.lock:
            index = next((i for i, rule in enumerate(self.rules) if rule.id == rule_id), None)
            if index is None:
                raise RuleNotFoundError(rule_id)

            current = self.rules[index]
            candidate = Rule.model_validate(
                {
                    **current.model_dump(),
                    **update.model_dump(exclude_none=True),
                }
            )
            validate_rule_create(candidate)
            remaining_rules = [rule for rule in self.rules if rule.id != rule_id]
            validate_acyclic(remaining_rules, candidate)

            self.rules[index] = candidate
            self._recompute()
            self.revision += 1
            return self._snapshot()

    async def toggle_rule(self, rule_id: str, enabled: bool) -> Snapshot:
        return await self.update_rule(rule_id, RuleUpdate(enabled=enabled))

    async def delete_rule(self, rule_id: str) -> Snapshot:
        async with self.lock:
            index = next((i for i, rule in enumerate(self.rules) if rule.id == rule_id), None)
            if index is None:
                raise RuleNotFoundError(rule_id)

            self.rules.pop(index)
            self._recompute()
            self.revision += 1
            return self._snapshot()


runtime = RuntimeState()
live_connections = LiveConnections()


__all__ = ["CycleDetectedError", "RuleNotFoundError", "live_connections", "runtime"]
