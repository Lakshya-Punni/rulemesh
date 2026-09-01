# RuleMesh API Contract

This file is the shared contract between the backend and frontend. Change it only after both contributors agree.

## Rule

```json
{
  "id": "rule-1",
  "name": "Fire alarm",
  "enabled": true,
  "priority": 90,
  "conditions": [
    {
      "variable": "laboratory.smoke",
      "operator": ">",
      "value": 70
    }
  ],
  "action": {
    "target": "laboratory.alarm",
    "value": true
  },
  "created_sequence": 1
}
```

Supported operators: `==`, `!=`, `>`, `>=`, `<`, `<=`. Conditions use AND semantics. Each rule has one action.

## Update environment

`POST /api/environment`

```json
{
  "changes": {
    "laboratory.smoke": 80,
    "laboratory.temperature": 36
  }
}
```

## Create rule

`POST /api/rules`

The request omits `id` and `created_sequence`; the backend assigns them.

Cycle rejection uses HTTP 422:

```json
{
  "code": "CYCLE_DETECTED",
  "message": "The proposed rule creates a circular dependency.",
  "path": [
    "laboratory.alarm",
    "building.evacuation",
    "laboratory.alarm"
  ],
  "proposed_edges": []
}
```

## Live state

`WS /ws/live`

The backend sends a snapshot immediately after connection and after every committed state or rule change:

```json
{
  "type": "snapshot",
  "revision": 1,
  "state": {},
  "rules": [],
  "graph": {
    "nodes": [],
    "edges": []
  },
  "active_rule_ids": [],
  "conflicts": []
}
```

The backend is authoritative. The frontend must not independently evaluate rules or finalize actuator state.

