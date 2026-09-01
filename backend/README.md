# Backend

Owned primarily by Person A.

## Run locally

From this directory:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

API documentation is available at `http://localhost:8000/docs`.

Run tests with:

```powershell
pytest
```

## Implemented vertical slice

- Typed rule and environment schemas
- Active-proposal full-graph recomputation
- NetworkX dependency graph and exact cycle-path rejection
- Priority-based conflict arbitration with visible proposals
- In-memory authoritative state
- Environment and complete rule CRUD APIs
- Live WebSocket snapshots
- Deterministic 500+ EPS server-owned simulation using ordered micro-batches
- Serialized monotonic WebSocket broadcasts across concurrent sessions
- Atomic guided-demo stages
- Backend tests for chains, retraction, conflicts, cycles, two-session sync,
  reset recovery, guided stages, health, and WebSockets
