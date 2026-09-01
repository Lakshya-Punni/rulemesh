# IOT-03 release evidence

This checklist maps every official requirement to concrete RuleMesh behavior
and reproducible evidence. It reflects the final local audit, not planned work.

## Requirements applying to every IoT problem

| Requirement | Status | Evidence |
|---|---|---|
| Push-based live path; no polling | Pass | Commands are event-driven REST requests and authoritative state is pushed through `/ws/live`. The real backend is the default even without an environment file. Reconnect uses a delayed WebSocket reconnect, not state polling. |
| Sustained 500 events/second | Pass | The seeded backend applies 60 ordered sensor events every 100 ms. An eight-second two-client run produced 540 minimum steady EPS and 660 maximum EPS. `test_simulation_is_server_owned_and_reports_real_event_counts` asserts at least 500 EPS. |
| Under 200 ms interface latency | Pass with visible runtime proof | Each snapshot carries `emitted_at_ms`; the browser measures through two rendered animation frames. The eight-second audit measured 2.14 ms p95 from server emission to WebSocket receipt. The header turns green only when the complete browser measurement is below 200 ms. |
| Judge-controlled generator seed | Pass | `POST /api/simulation/start` accepts `{ "seed": 42 }`; the seed input is exposed in the header and the running seed is broadcast to every session. |
| Two simultaneous sessions without corruption or desynchronization | Pass | Runtime mutations commit under one lock, broadcasts are monotonic, obsolete frames are dropped on the server and client, and both sessions receive the same authoritative revision. `test_simultaneous_commands_remain_ordered_in_two_live_sessions` submits different commands concurrently. |

## IOT-03-specific requirements

| Requirement | Status | Evidence |
|---|---|---|
| Dependency graph rather than ordered condition list | Pass | `build_dependency_graph` creates condition-variable to action-target edges and `recompute_state` evaluates targets in NetworkX topological order. |
| Conditions fire only when true; chains run in order | Pass | Active proposals are recomputed from sensor truth on every revision. `test_chain_and_proposal_retraction` and the guided Fire stage exercise `smoke -> alarm -> evacuation -> exits/lights`. |
| Contradictions visibly arbitrated | Pass | Winner selection uses priority and creation sequence. The conflict panel displays every proposal, winner/loser, values, priorities, and the reason. |
| Live circular dependency detection | Pass | Proposed graph mutations are validated before commit. HTTP 422 returns the exact closed cycle path; the saved graph is unchanged. The Unsafe cycle preset uses the real API. |
| New rules added without restart | Pass | `POST /api/rules` validates, commits, recomputes, increments revision, and broadcasts immediately. The Valid live override preset demonstrates rule 8 becoming active while the system runs. |

## Final audit results

- Backend: 13 tests passed.
- Frontend: TypeScript production build passed.
- Frontend lint: zero warnings and zero errors.
- Two-client live run: 81 snapshots per client over eight seconds.
- Concurrent final state: identical in both clients.
- Revision order: monotonic in both clients.
- Throughput: 540 minimum steady EPS, 660 maximum EPS.
- Server-to-WebSocket delivery latency: 2.14 ms p95, 0.94 ms mean.

## Judge-visible verification

1. Open two dashboards and confirm `Sessions = 2`.
2. Start seed `42` and wait about two seconds.
3. Confirm the badge reads **SLA PASS**, EPS is at least `500`, and p95 is below `200 ms`.
4. Use Fire and Safety override to show chaining and visible arbitration.
5. Add Valid live override, then Reset demo.
6. Add Unsafe cycle and show the exact rejected path with the rule count still `7`.
