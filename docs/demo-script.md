# RuleMesh final demo script

Target duration: 3–4 minutes. Use one dashboard for the main story and open a
second dashboard only if the judge asks about synchronization.

## Before presenting

1. Confirm the header says **Live** and the rule count is `7`.
2. Press **Reset demo**.
3. Keep the dependency graph and conflict panel visible when explaining engine
   decisions.

## Talk track and actions

### 0:00–0:25 — Problem and core idea

“IoT automations are easy until several rules interact. Commands become stale,
policies disagree, and a newly added rule can create a feedback loop. RuleMesh
models every active rule as a retractable proposal over a dependency graph.”

Press **Normal**. Point out that no rules are active and all actuators are at
safe defaults.

### 0:25–0:50 — A normal automation

Press **Heat**. Temperature becomes `38°C`, **Temperature cooling** activates,
and HVAC becomes `cool`.

Say: “The backend recomputes from sensor truth; it does not fire a one-time
command that we later have to undo.”

### 0:50–1:30 — Chaining and arbitration

Press **Fire**. Point to the chain:

`smoke → alarm → evacuation → unlocked exits + emergency lights`

The HVAC conflict panel shows **Smoke shutdown** (`90`) defeating
**Temperature cooling** (`40`). Explain that every proposal remains visible,
including the losing one and the reason it lost.

### 1:30–1:55 — Safety policy override

Press **Safety override**. Quiet hours requests `alarm = false`, producing a
second conflict. **Fire alarm** wins because priority `90 > 10`, so evacuation
continues.

Say: “Comfort policy can never silently defeat the emergency policy.”

### 1:55–2:10 — Automatic retraction

Press **Normal**. The alarm, evacuation, lights, locks, conflicts, and active
rule highlights all return to defaults without explicit ‘turn off’ rules.

### 2:10–2:50 — Add a rule while running

Press **Heat**, then click **Valid live override** in the rule builder. Let the
judge see the populated fields and press **Add rule**. The rule count becomes
`8`; the new priority-60 `HVAC = ventilate` proposal defeats priority-40
temperature cooling.

Say: “This used the real rule API. The server validated the typed rule, rebuilt
the graph, recomputed state, and broadcast one authoritative revision.”

### 2:50–3:25 — Reject a dangerous graph mutation

Press **Reset demo**, click **Unsafe cycle**, inspect the proposed
`building.evacuation → laboratory.alarm` edge, and press **Add rule**.

The red banner must show a closed cycle path. The rule count must remain `7`.

Say: “Validation happens before commit. We return the exact path, reject the
mutation, and preserve the last known-good graph.”

### 3:25–3:50 — Close

Point to revision, sessions, events/second, latency, execution trace, and graph.

“The prototype combines a graph-safe rule engine, deterministic conflict
arbitration, atomic backend state, REST commands, and live WebSocket
synchronization. The same core can become a policy layer for buildings,
factories, energy systems, or fleet automation.”

## Recovery checklist

- Unexpected state: press **Reset demo**.
- Rule count is not `7`: press **Reset demo** before the cycle test.
- Header is disconnected: leave the backend terminal running and refresh once.
- Simulation is changing values: any guided stage automatically stops it.
- Need a shorter demo: show **Fire**, **Normal**, then **Unsafe cycle**.
