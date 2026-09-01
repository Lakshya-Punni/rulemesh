from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from .models import Condition, RuleCreate, ScalarValue


VariableKind = Literal["number", "boolean", "enum"]


@dataclass(frozen=True)
class VariableSpec:
    kind: VariableKind
    allowed_values: frozenset[str] = frozenset()


SENSOR_DEFAULTS: dict[str, ScalarValue] = {
    "laboratory.smoke": 0.0,
    "laboratory.temperature": 24.0,
    "building.quiet_hours": False,
}

ACTUATOR_DEFAULTS: dict[str, ScalarValue] = {
    "laboratory.alarm": False,
    "laboratory.hvac": "off",
    "laboratory.exit_locked": True,
    "laboratory.emergency_lights": False,
    "building.evacuation": False,
}

VARIABLE_SPECS: dict[str, VariableSpec] = {
    "laboratory.smoke": VariableSpec("number"),
    "laboratory.temperature": VariableSpec("number"),
    "building.quiet_hours": VariableSpec("boolean"),
    "laboratory.alarm": VariableSpec("boolean"),
    "laboratory.hvac": VariableSpec("enum", frozenset({"off", "cool", "ventilate"})),
    "laboratory.exit_locked": VariableSpec("boolean"),
    "laboratory.emergency_lights": VariableSpec("boolean"),
    "building.evacuation": VariableSpec("boolean"),
}


def _is_number(value: ScalarValue) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def validate_value(variable: str, value: ScalarValue) -> None:
    spec = VARIABLE_SPECS.get(variable)
    if spec is None:
        raise ValueError(f"Unknown variable: {variable}")

    if spec.kind == "number" and not _is_number(value):
        raise ValueError(f"{variable} requires a numeric value")
    if spec.kind == "boolean" and not isinstance(value, bool):
        raise ValueError(f"{variable} requires a boolean value")
    if spec.kind == "enum" and value not in spec.allowed_values:
        allowed = ", ".join(sorted(spec.allowed_values))
        raise ValueError(f"{variable} must be one of: {allowed}")


def validate_condition(condition: Condition) -> None:
    validate_value(condition.variable, condition.value)
    spec = VARIABLE_SPECS[condition.variable]
    if condition.operator in {">", ">=", "<", "<="} and spec.kind != "number":
        raise ValueError(
            f"Operator {condition.operator} requires a numeric variable; "
            f"{condition.variable} is {spec.kind}"
        )


def validate_rule_create(rule: RuleCreate) -> None:
    seen_conditions: set[tuple[str, str, str]] = set()
    for condition in rule.conditions:
        validate_condition(condition)
        identity = (condition.variable, condition.operator, repr(condition.value))
        if identity in seen_conditions:
            raise ValueError("A rule cannot contain duplicate conditions")
        seen_conditions.add(identity)

    if rule.action.target not in ACTUATOR_DEFAULTS:
        raise ValueError(f"Rule actions cannot write {rule.action.target}")
    validate_value(rule.action.target, rule.action.value)


def validate_environment_changes(changes: dict[str, ScalarValue]) -> None:
    for variable, value in changes.items():
        if variable not in SENSOR_DEFAULTS:
            raise ValueError(f"Environment updates cannot write {variable}")
        validate_value(variable, value)

