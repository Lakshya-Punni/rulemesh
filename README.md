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

