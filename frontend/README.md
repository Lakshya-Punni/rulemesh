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

The integrated FastAPI backend is the default, even when no local environment
file exists. The optional mock engine (`src/mock/`) is used only when
`VITE_USE_MOCK=true`; it preserves an offline recovery path but is never part of
the normal judged data path. Both modes use the same seven starter rules.

## Switching to the real backend

The default URLs are `http://localhost:8000` and
`ws://localhost:8000/ws/live`. Copy `.env.example` to `.env.local` only when
those addresses need to be overridden. Every component is written against the
shared `ServerMessage` / `ClientCommand` contract in `src/types.ts`.

## What's here

- `src/types.ts` — the frozen contract: `Rule`, `EnvironmentState`,
  `ConflictInfo`, `CycleError`, `StateMessage`, `ClientCommand`.
- `src/mock/` — engine + fake socket, standalone dev/demo backend.
- `src/hooks/useRuleMeshSocket.ts` — connects to mock or real WS.
- `src/components/` — `Header`, `ZoneControls`, `ActuatorGrid`,
  `ConflictPanel`, `CycleBanner`, `RuleList`, `RuleForm`,
  `DependencyGraph` (React Flow).

## Integrated demo features

- Real REST commands plus authoritative `/ws/live` snapshots and reconnection.
- Active-chain graph highlighting, sensor history, and execution trace.
- Visible conflict winners/losers and exact rejected cycle paths.
- Server-owned deterministic simulation shared by every browser session.
- Atomic four-stage judge path, reset recovery, command progress, and success
  feedback.
