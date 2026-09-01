from __future__ import annotations

from collections import defaultdict

import networkx as nx

from .graph import build_dependency_graph
from .models import Condition, ConflictRecord, ProposalSummary, Rule, ScalarValue


def evaluate_condition(condition: Condition, state: dict[str, ScalarValue]) -> bool:
    if condition.variable not in state:
        return False

    current = state[condition.variable]
    expected = condition.value

    if condition.operator == "==":
        return current == expected
    if condition.operator == "!=":
        return current != expected
    if condition.operator == ">":
        return current > expected  # type: ignore[operator]
    if condition.operator == ">=":
        return current >= expected  # type: ignore[operator]
    if condition.operator == "<":
        return current < expected  # type: ignore[operator]
    if condition.operator == "<=":
        return current <= expected  # type: ignore[operator]
    return False


def _proposal(rule: Rule) -> ProposalSummary:
    return ProposalSummary(
        rule_id=rule.id,
        rule_name=rule.name,
        priority=rule.priority,
        created_sequence=rule.created_sequence,
        value=rule.action.value,
    )


def _conflict_reason(winner: Rule, candidates: list[Rule]) -> str:
    other_priorities = [rule.priority for rule in candidates if rule.id != winner.id]
    if other_priorities and winner.priority > max(other_priorities):
        return f"priority {winner.priority} > {max(other_priorities)}"
    return (
        f"equal priority {winner.priority}; earlier creation sequence "
        f"{winner.created_sequence} won"
    )


def recompute_state(
    sensor_values: dict[str, ScalarValue],
    actuator_defaults: dict[str, ScalarValue],
    rules: list[Rule],
) -> tuple[dict[str, ScalarValue], list[str], list[ConflictRecord]]:
    state = {**sensor_values, **actuator_defaults}
    active_rule_ids: set[str] = set()
    conflicts: list[ConflictRecord] = []

    rules_by_target: dict[str, list[Rule]] = defaultdict(list)
    for rule in rules:
        rules_by_target[rule.action.target].append(rule)

    graph = build_dependency_graph(rules)
    ordered_variables = list(nx.topological_sort(graph)) if graph.nodes else []

    for target in ordered_variables:
        candidates = [
            rule
            for rule in rules_by_target.get(target, [])
            if rule.enabled
            and all(evaluate_condition(condition, state) for condition in rule.conditions)
        ]
        if not candidates:
            continue

        active_rule_ids.update(rule.id for rule in candidates)
        winner = max(candidates, key=lambda rule: (rule.priority, -rule.created_sequence))
        state[target] = winner.action.value

        distinct_values: list[ScalarValue] = []
        for candidate in candidates:
            if candidate.action.value not in distinct_values:
                distinct_values.append(candidate.action.value)

        if len(distinct_values) > 1:
            conflicts.append(
                ConflictRecord(
                    target=target,
                    winner=_proposal(winner),
                    proposals=[_proposal(rule) for rule in candidates],
                    reason=_conflict_reason(winner, candidates),
                )
            )

    return state, sorted(active_rule_ids), conflicts

