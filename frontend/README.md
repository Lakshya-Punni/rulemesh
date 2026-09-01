# RuleMesh — frontend (Person B)

React + TypeScript + Vite client for RuleMesh, per the hackathon plan's
Hours 0:30–4:45 (Person B) scope: shell, WS client, manual environment
controls, actuator cards, conflict/cycle panels, rule list + form, and
the dependency graph.

## Run it

```bash
npm install
npm run dev
```

Opens on the mock engine by default (`src/mock/`) — a client-side
re-implementation of the active-proposal / arbitration / cycle-detection
algorithm from the plan, so you can build and demo the whole UI without
waiting on the backend. It ships with the 12 starter rules from section 8
of the plan, a working "Start simulation" seed control, live sliders,
rule creation, and cycle rejection.

## Switching to the real backend

Copy `.env.example` to `.env.local` and set `VITE_WS_URL` to Person A's
`/ws/live` endpoint. `useRuleMeshSocket` then uses a real `WebSocket`
instead of the mock — every component is written against the shared
`ServerMessage` / `ClientCommand` contract in `src/types.ts`, so nothing
else changes. **Get this file to Person A ASAP — it's the 0:00–0:30
schema freeze.**

## What's here

- `src/types.ts` — the frozen contract: `Rule`, `EnvironmentState`,
  `ConflictInfo`, `CycleError`, `StateMessage`, `ClientCommand`.
- `src/mock/` — engine + fake socket, standalone dev/demo backend.
- `src/hooks/useRuleMeshSocket.ts` — connects to mock or real WS.
- `src/components/` — `Header`, `ZoneControls`, `ActuatorGrid`,
  `ConflictPanel`, `CycleBanner`, `RuleList`, `RuleForm`,
  `DependencyGraph` (React Flow).

## Still to do (per plan, hours 5+)

- Wire real WS URL once Person A's `/ws/live` is up; drop the mock or
  keep it for offline dev.
- Selected-zone filtering exists on the graph — extend to actuator grid
  if it gets crowded with 5 zones × 5 actuators.
- Execution trace / active-chain animation polish (hours 13–15).
- Two-session revision-sync testing once the backend's command queue
  exists (hours 11–13).
