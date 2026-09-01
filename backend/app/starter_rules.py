from __future__ import annotations

from .models import RuleCreate


STARTER_RULE_DATA: tuple[dict[str, object], ...] = (
    {
        "name": "Fire alarm",
        "enabled": True,
        "priority": 90,
        "conditions": [
            {"variable": "laboratory.smoke", "operator": ">", "value": 70}
        ],
        "action": {"target": "laboratory.alarm", "value": True},
    },
    {
        "name": "Evacuate",
        "enabled": True,
        "priority": 90,
        "conditions": [
            {"variable": "laboratory.alarm", "operator": "==", "value": True}
        ],
        "action": {"target": "building.evacuation", "value": True},
    },
    {
        "name": "Unlock exits",
        "enabled": True,
        "priority": 100,
        "conditions": [
            {"variable": "building.evacuation", "operator": "==", "value": True}
        ],
        "action": {"target": "laboratory.exit_locked", "value": False},
    },
    {
        "name": "Emergency lights",
        "enabled": True,
        "priority": 80,
        "conditions": [
            {"variable": "building.evacuation", "operator": "==", "value": True}
        ],
        "action": {"target": "laboratory.emergency_lights", "value": True},
    },
    {
        "name": "Smoke shutdown",
        "enabled": True,
        "priority": 90,
        "conditions": [
            {"variable": "laboratory.smoke", "operator": ">", "value": 60}
        ],
        "action": {"target": "laboratory.hvac", "value": "off"},
    },
    {
        "name": "Temperature cooling",
        "enabled": True,
        "priority": 40,
        "conditions": [
            {"variable": "laboratory.temperature", "operator": ">", "value": 32}
        ],
        "action": {"target": "laboratory.hvac", "value": "cool"},
    },
    {
        "name": "Quiet hours",
        "enabled": True,
        "priority": 10,
        "conditions": [
            {"variable": "building.quiet_hours", "operator": "==", "value": True}
        ],
        "action": {"target": "laboratory.alarm", "value": False},
    },
)


def starter_rule_creates() -> list[RuleCreate]:
    return [RuleCreate.model_validate(rule) for rule in STARTER_RULE_DATA]
