# RuleMesh

RuleMesh is a graph-native automation engine for a simulated smart building. It executes chained rules, visibly arbitrates contradictory actions, and rejects circular dependencies before they can run.

## Team ownership

- **Person A:** FastAPI backend, rule engine, dependency graph, arbitration, cycle detection, WebSockets, and backend tests.
- **Person B:** React frontend, rule builder, graph visualization, simulator, conflict/cycle presentation, and UI performance metrics.

Both contributors work in this repository and integrate against the shared contract in [`docs/api-contract.md`](docs/api-contract.md).

## Repository layout

```text
rulemesh/
|-- backend/     # Python and FastAPI
|-- frontend/    # React and TypeScript
|-- docs/        # Shared API and WebSocket contracts
|-- README.md
`-- .gitignore
```

## Run the integrated app

Backend (PowerShell terminal 1):

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Frontend (PowerShell terminal 2):

```powershell
cd frontend
npm ci
npm run dev -- --host 127.0.0.1
```

The backend URLs work without an environment file. Copy `.env.example` to
`.env.local` only when overriding the default local addresses.

Open `http://127.0.0.1:5173`. The backend boots with the seven validated Review
1 starter rules, so the demo is ready immediately after any restart. The
frontend uses REST for commands and treats `/ws/live` snapshots as the
authoritative live state. Set `VITE_USE_MOCK=true` only when the backend is
unavailable.

The deterministic incident simulator also runs in the backend. Starting seed
`42` in either browser drives one shared 10 Hz scenario. Each tick processes an
ordered micro-batch of 60 sensor samples, sustaining roughly 600 events/second,
then pushes one authoritative state revision to every connected session. The
header shows live EPS, the 500-EPS target, measured browser p95 latency, and an
**SLA PASS** badge only when throughput is at least 500 EPS and p95 is below
200 ms.

Use **Reset demo** before each rehearsal. It stops the shared simulator,
restores the seven starter rules and sensor defaults, clears metrics and UI
history, and synchronizes that clean state to every open dashboard.

For a fast presentation, use the **60-second judge path** instead of waiting
for the simulator:

1. **Normal** — no proposals are active.
2. **Heat** — temperature cooling proposes `HVAC = cool`.
3. **Fire** — the alarm/evacuation/unlock/lights chain activates and smoke
   shutdown defeats temperature cooling on the HVAC target.
4. **Safety override** — quiet hours also proposes `alarm = false`, but the
   higher-priority fire rule wins, preserving evacuation.
5. Return to **Normal** to show that every active proposal retracts cleanly.

Each stage is one atomic backend revision, stops any running simulation, and is
broadcast to every live dashboard.

The rule builder also includes two **prefill-only** judge tests. **Valid live
override** creates a priority-60 ventilation policy that can beat normal
temperature cooling. **Unsafe cycle** proposes an evacuation-to-alarm feedback
edge; the backend returns the exact cycle path and leaves the seven-rule graph
unchanged. The complete timed talk track is in
[`docs/demo-script.md`](docs/demo-script.md).

Every official requirement and its test/demo evidence is mapped in
[`docs/rubric-checklist.md`](docs/rubric-checklist.md).

## Git workflow

1. Keep `main` runnable.
2. Person A works on `person-a-backend`.
3. Person B works on `person-b-frontend`.
4. Pull from `main` before integrating.
5. Merge only working checkpoints into `main`.

Review checkpoints:

- Hour 1: project skeleton and shared schemas.
- Hour 3: first frontend/backend connection.
- Hour 4: Review 1 integration.
- Hour 5: stable Review 1 build tagged `review-1`.
- Hour 17: final feature freeze tagged `feature-freeze`.
- Hour 24: final submission tagged `hackathon-final`.
