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
Copy-Item .env.example .env.local
npm run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:5173`. The backend boots with the seven validated Review
1 starter rules, so the demo is ready immediately after any restart. The
frontend uses REST for commands and treats `/ws/live` snapshots as the
authoritative live state. Set `VITE_USE_MOCK=true` only when the backend is
unavailable.

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
