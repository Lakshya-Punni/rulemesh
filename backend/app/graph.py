from __future__ import annotations

import networkx as nx

from .models import GraphSnapshot, Rule


class CycleDetectedError(Exception):
    def __init__(self, path: list[str], proposed_edges: list[dict[str, str]]) -> None:
        super().__init__("The proposed rule creates a circular dependency")
        self.path = path
        self.proposed_edges = proposed_edges


def build_dependency_graph(rules: list[Rule]) -> nx.DiGraph:
    graph = nx.DiGraph()
    for rule in rules:
        for condition in rule.conditions:
            graph.add_edge(condition.variable, rule.action.target, rule_id=rule.id)
    return graph


def find_cycle_path(graph: nx.DiGraph) -> list[str] | None:
    try:
        edges = nx.find_cycle(graph, orientation="original")
    except nx.NetworkXNoCycle:
        return None

    if not edges:
        return None
    return [edges[0][0], *[edge[1] for edge in edges]]


def validate_acyclic(existing_rules: list[Rule], proposed_rule: Rule) -> None:
    candidate_rules = [*existing_rules, proposed_rule]
    cycle_path = find_cycle_path(build_dependency_graph(candidate_rules))
    if cycle_path is None:
        return

    proposed_edges = [
        {"source": condition.variable, "target": proposed_rule.action.target}
        for condition in proposed_rule.conditions
    ]
    raise CycleDetectedError(cycle_path, proposed_edges)


def build_graph_snapshot(rules: list[Rule]) -> GraphSnapshot:
    nodes: dict[str, dict[str, object]] = {}
    edges: list[dict[str, object]] = []

    for rule in rules:
        rule_node_id = f"rule:{rule.id}"
        nodes[rule_node_id] = {
            "id": rule_node_id,
            "kind": "rule",
            "label": rule.name,
            "enabled": rule.enabled,
            "priority": rule.priority,
        }
        nodes[rule.action.target] = {
            "id": rule.action.target,
            "kind": "variable",
            "label": rule.action.target,
        }
        edges.append(
            {
                "id": f"{rule_node_id}->{rule.action.target}",
                "source": rule_node_id,
                "target": rule.action.target,
                "rule_id": rule.id,
            }
        )

        for index, condition in enumerate(rule.conditions):
            nodes[condition.variable] = {
                "id": condition.variable,
                "kind": "variable",
                "label": condition.variable,
            }
            edges.append(
                {
                    "id": f"{condition.variable}->{rule_node_id}:{index}",
                    "source": condition.variable,
                    "target": rule_node_id,
                    "rule_id": rule.id,
                }
            )

    return GraphSnapshot(nodes=list(nodes.values()), edges=edges)

