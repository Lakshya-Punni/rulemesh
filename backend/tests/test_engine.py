from app.engine import recompute_state
from app.models import Action, Condition, Rule
from app.variables import ACTUATOR_DEFAULTS, SENSOR_DEFAULTS


def make_rule(
    sequence: int,
    name: str,
    condition_variable: str,
    operator: str,
    condition_value: object,
    target: str,
    action_value: object,
    priority: int,
) -> Rule:
    return Rule.model_validate(
        {
            "id": f"rule-{sequence}",
            "name": name,
            "enabled": True,
            "priority": priority,
            "conditions": [
                Condition(
                    variable=condition_variable,
                    operator=operator,
                    value=condition_value,
                )
            ],
            "action": Action(target=target, value=action_value),
            "created_sequence": sequence,
        }
    )


def review_rules() -> list[Rule]:
    return [
        make_rule(1, "Fire alarm", "laboratory.smoke", ">", 70, "laboratory.alarm", True, 90),
        make_rule(2, "Evacuate", "laboratory.alarm", "==", True, "building.evacuation", True, 90),
        make_rule(3, "Unlock exits", "building.evacuation", "==", True, "laboratory.exit_locked", False, 100),
        make_rule(4, "Smoke shutdown", "laboratory.smoke", ">", 60, "laboratory.hvac", "off", 90),
        make_rule(5, "Temperature cooling", "laboratory.temperature", ">", 32, "laboratory.hvac", "cool", 40),
    ]


def test_chain_and_proposal_retraction() -> None:
    sensors = {**SENSOR_DEFAULTS, "laboratory.smoke": 80.0}
    state, active, conflicts = recompute_state(sensors, ACTUATOR_DEFAULTS, review_rules())

    assert state["laboratory.alarm"] is True
    assert state["building.evacuation"] is True
    assert state["laboratory.exit_locked"] is False
    assert {"rule-1", "rule-2", "rule-3"}.issubset(active)
    assert conflicts == []

    cleared_state, cleared_active, _ = recompute_state(
        SENSOR_DEFAULTS,
        ACTUATOR_DEFAULTS,
        review_rules(),
    )
    assert cleared_state["laboratory.alarm"] is False
    assert cleared_state["building.evacuation"] is False
    assert cleared_state["laboratory.exit_locked"] is True
    assert "rule-1" not in cleared_active


def test_priority_conflict_is_visible() -> None:
    sensors = {
        **SENSOR_DEFAULTS,
        "laboratory.smoke": 80.0,
        "laboratory.temperature": 36.0,
    }
    state, _, conflicts = recompute_state(sensors, ACTUATOR_DEFAULTS, review_rules())

    assert state["laboratory.hvac"] == "off"
    assert len(conflicts) == 1
    assert conflicts[0].target == "laboratory.hvac"
    assert conflicts[0].winner.rule_name == "Smoke shutdown"
    assert conflicts[0].reason == "priority 90 > 40"

