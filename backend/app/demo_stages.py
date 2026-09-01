from __future__ import annotations

from .models import DemoStageName, ScalarValue


# Full sensor snapshots make every stage deterministic and prevent state from a
# previous rehearsal leaking into the next judge-facing step.
DEMO_STAGE_CHANGES: dict[DemoStageName, dict[str, ScalarValue]] = {
    "normal": {
        "laboratory.smoke": 0.0,
        "laboratory.temperature": 24.0,
        "building.quiet_hours": False,
    },
    "heat": {
        "laboratory.smoke": 10.0,
        "laboratory.temperature": 38.0,
        "building.quiet_hours": False,
    },
    "fire": {
        "laboratory.smoke": 85.0,
        "laboratory.temperature": 43.0,
        "building.quiet_hours": False,
    },
    "safety_override": {
        "laboratory.smoke": 85.0,
        "laboratory.temperature": 43.0,
        "building.quiet_hours": True,
    },
}
