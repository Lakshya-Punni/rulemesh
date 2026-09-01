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

The response is the latest `snapshot`. The same snapshot is pushed to every connected `/ws/live` session.

## Create rule

`POST /api/rules`

The request omits `id` and `created_sequence`; the backend assigns them.

The response is the latest `snapshot`. A valid rule is evaluated immediately against the current environment.

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

## Update, toggle, or delete a rule

- `PUT /api/rules/{rule_id}` accepts any subset of the rule's editable fields.
- `POST /api/rules/{rule_id}/toggle` accepts `{ "enabled": true | false }`.
- `DELETE /api/rules/{rule_id}` removes the rule.

Every successful mutation recomputes the engine, increments `revision`, and
broadcasts the new snapshot. An update that introduces a cycle returns the same
HTTP 422 payload as rule creation and leaves the saved graph unchanged.

## Live state

`WS /ws/live`

The backend sends a snapshot immediately after connection and after every committed state or rule change:

```json
{
  "type": "snapshot",
  "emitted_at_ms": 1788264000000,
  "revision": 1,
  "state": {},
  "rules": [],
  "graph": {
    "nodes": [],
    "edges": []
  },
  "active_rule_ids": [],
  "conflicts": [],
  "connected_sessions": 1,
  "simulation_running": false,
  "simulation_seed": null,
  "perf": {
    "events_per_second": 0,
    "target_events_per_second": 500,
    "accepted_events": 0,
    "rejected_events": 0
  }
}
```

## Authoritative simulation

`POST /api/simulation/start`

```json
{ "seed": 42 }
```

`POST /api/simulation/stop` takes no request body. The simulator runs in the
backend at 10 ticks per second. Every tick applies an ordered micro-batch of 60
smoke and temperature samples as one graph revision, sustaining approximately
600 input events per second while limiting interface pushes to 10 snapshots per
second. The seed, running status, metrics, and resulting engine state are
identical in every connected browser. Starting a new seed cancels the previous
simulation task before launching the next one.

`perf.target_events_per_second` is `500`. Every snapshot carries
`emitted_at_ms`; the frontend measures end-to-end interface latency from that
server timestamp through two browser animation frames and reports rolling
p50/p95 values. Its SLA badge passes only when live throughput is at least 500
EPS and p95 latency is below 200 ms.

Concurrent commands commit under the runtime lock. Broadcasts are serialized,
obsolete revisions are dropped server-side, and clients also reject any stale
revision, preventing a delayed response from rolling either session backward.

## Reset demo

`POST /api/demo/reset` takes no request body. It atomically stops the simulator,
restores the default sensor values and all seven validated starter rules, clears
performance counters, increments the revision, and broadcasts the clean
snapshot to every connected browser.

## Guided demo stage

`POST /api/demo/stage`

```json
{ "stage": "safety_override" }
```

Allowed stages are `normal`, `heat`, `fire`, and `safety_override`. A stage
cancels the free-running simulator, clears its seed, atomically applies a full
three-sensor snapshot, evaluates the complete rule graph, increments the
revision once, and broadcasts the result. `safety_override` intentionally
creates conflicts on both `laboratory.alarm` and `laboratory.hvac`; the safety
rules win by priority.

When contradictory active rules write the same actuator, `conflicts` contains:

```json
{
  "target": "laboratory.hvac",
  "winner": {
    "rule_id": "rule-5",
    "rule_name": "Smoke shutdown",
    "priority": 90,
    "created_sequence": 5,
    "value": "off"
  },
  "proposals": [
    {
      "rule_id": "rule-5",
      "rule_name": "Smoke shutdown",
      "priority": 90,
      "created_sequence": 5,
      "value": "off"
    },
    {
      "rule_id": "rule-6",
      "rule_name": "Temperature cooling",
      "priority": 40,
      "created_sequence": 6,
      "value": "cool"
    }
  ],
  "reason": "priority 90 > 40"
}
```

Current Review 1 variables:

```text
laboratory.smoke            number, environment input
laboratory.temperature      number, environment input
building.quiet_hours        boolean, environment input
laboratory.alarm            boolean, actuator
laboratory.hvac             off | cool | ventilate, actuator
laboratory.exit_locked      boolean, actuator
laboratory.emergency_lights boolean, actuator
building.evacuation         boolean, actuator
```

## Health

`GET /api/health`

```json
{
  "status": "ok",
  "revision": 0,
  "connected_sessions": 1
}
```

The backend is authoritative. The frontend must not independently evaluate rules or finalize actuator state.
