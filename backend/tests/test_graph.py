import pytest

from app.graph import CycleDetectedError, validate_acyclic
from app.models import Action, Condition, Rule


def rule(sequence: int, source: str, target: str, value: bool = True) -> Rule:
    return Rule(
        id=f"rule-{sequence}",
        name=f"Rule {sequence}",
        enabled=True,
        priority=50,
        conditions=[Condition(variable=source, operator="==", value=True)],
        action=Action(target=target, value=value),
        created_sequence=sequence,
    )


def test_cycle_returns_exact_path_without_mutating_rules() -> None:
    existing = [rule(1, "laboratory.alarm", "building.evacuation")]
    proposed = rule(2, "building.evacuation", "laboratory.alarm", False)
    original_count = len(existing)

    with pytest.raises(CycleDetectedError) as caught:
        validate_acyclic(existing, proposed)

    assert caught.value.path == [
        "laboratory.alarm",
        "building.evacuation",
        "laboratory.alarm",
    ]
    assert len(existing) == original_count

