from __future__ import annotations

import asyncio

from fastapi import WebSocket

from .engine import recompute_state
from .graph import CycleDetectedError, build_graph_snapshot, validate_acyclic
from .models import Rule, RuleCreate, RuleUpdate, ScalarValue, Snapshot
from .variables import ACTUATOR_DEFAULTS, SENSOR_DEFAULTS, validate_environment_changes, validate_rule_create


class LiveConnections:
    def __init__(self) -> None:
        self._connections: set[WebSocket] = set()

    @property
    def count(self) -> int:
        return len(self._connections)

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections.add(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        self._connections.discard(websocket)

    async def broadcast(self, snapshot: Snapshot) -> None:
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

    def _recompute(self) -> None:
        self.effective_state, self.active_rule_ids, self.conflicts = recompute_state(
            self.sensor_values,
            self.actuator_defaults,
            self.rules,
        )

    def _snapshot(self) -> Snapshot:
        return Snapshot(
            revision=self.revision,
            state=dict(self.effective_state),
            rules=list(self.rules),
            graph=build_graph_snapshot(self.rules),
            active_rule_ids=list(self.active_rule_ids),
            conflicts=list(self.conflicts),
            connected_sessions=live_connections.count,
        )

    async def snapshot(self) -> Snapshot:
        async with self.lock:
            return self._snapshot()

    async def update_environment(self, changes: dict[str, ScalarValue]) -> Snapshot:
        validate_environment_changes(changes)
        async with self.lock:
            self.sensor_values.update(changes)
            self._recompute()
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
