from __future__ import annotations

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .graph import CycleDetectedError
from .models import (
    CycleError,
    DemoStageRequest,
    EnvironmentUpdate,
    RuleCreate,
    RuleToggle,
    RuleUpdate,
    SimulationStart,
    Snapshot,
)
from .simulation import simulation
from .state import RuleNotFoundError, live_connections, runtime


app = FastAPI(title="RuleMesh API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health() -> dict[str, object]:
    return {
        "status": "ok",
        "revision": runtime.revision,
        "connected_sessions": live_connections.count,
    }


@app.post("/api/environment", response_model=Snapshot)
async def update_environment(request: EnvironmentUpdate) -> Snapshot:
    try:
        snapshot = await runtime.update_environment(request.changes)
    except ValueError as error:
        await runtime.record_rejection()
        raise HTTPException(status_code=422, detail=str(error)) from error
    await live_connections.broadcast(snapshot)
    return snapshot


@app.post("/api/rules", response_model=Snapshot)
async def create_rule(request: RuleCreate) -> Snapshot | JSONResponse:
    try:
        snapshot = await runtime.add_rule(request)
    except ValueError as error:
        await runtime.record_rejection()
        raise HTTPException(status_code=422, detail=str(error)) from error
    except CycleDetectedError as error:
        await runtime.record_rejection()
        payload = CycleError(path=error.path, proposed_edges=error.proposed_edges)
        return JSONResponse(status_code=422, content=payload.model_dump(mode="json"))
    await live_connections.broadcast(snapshot)
    return snapshot


def cycle_response(error: CycleDetectedError) -> JSONResponse:
    payload = CycleError(path=error.path, proposed_edges=error.proposed_edges)
    return JSONResponse(status_code=422, content=payload.model_dump(mode="json"))


@app.put("/api/rules/{rule_id}", response_model=Snapshot)
async def update_rule(rule_id: str, request: RuleUpdate) -> Snapshot | JSONResponse:
    try:
        snapshot = await runtime.update_rule(rule_id, request)
    except RuleNotFoundError as error:
        raise HTTPException(status_code=404, detail=f"Rule not found: {rule_id}") from error
    except ValueError as error:
        await runtime.record_rejection()
        raise HTTPException(status_code=422, detail=str(error)) from error
    except CycleDetectedError as error:
        await runtime.record_rejection()
        return cycle_response(error)
    await live_connections.broadcast(snapshot)
    return snapshot


@app.post("/api/rules/{rule_id}/toggle", response_model=Snapshot)
async def toggle_rule(rule_id: str, request: RuleToggle) -> Snapshot:
    try:
        snapshot = await runtime.toggle_rule(rule_id, request.enabled)
    except RuleNotFoundError as error:
        raise HTTPException(status_code=404, detail=f"Rule not found: {rule_id}") from error
    await live_connections.broadcast(snapshot)
    return snapshot


@app.delete("/api/rules/{rule_id}", response_model=Snapshot)
async def delete_rule(rule_id: str) -> Snapshot:
    try:
        snapshot = await runtime.delete_rule(rule_id)
    except RuleNotFoundError as error:
        raise HTTPException(status_code=404, detail=f"Rule not found: {rule_id}") from error
    await live_connections.broadcast(snapshot)
    return snapshot


@app.post("/api/simulation/start", response_model=Snapshot)
async def start_simulation(request: SimulationStart) -> Snapshot:
    return await simulation.start(request.seed)


@app.post("/api/simulation/stop", response_model=Snapshot)
async def stop_simulation() -> Snapshot:
    return await simulation.stop()


@app.post("/api/demo/reset", response_model=Snapshot)
async def reset_demo() -> Snapshot:
    return await simulation.reset_demo()


@app.post("/api/demo/stage", response_model=Snapshot)
async def apply_demo_stage(request: DemoStageRequest) -> Snapshot:
    return await simulation.apply_demo_stage(request.stage)


@app.websocket("/ws/live")
async def live_state(websocket: WebSocket) -> None:
    await live_connections.connect(websocket)
    try:
        # Broadcast connection-count changes too, so every open dashboard shows
        # the same multi-session state rather than only the newest browser.
        await live_connections.broadcast(await runtime.snapshot())
        while True:
            message = await websocket.receive_text()
            if message == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception:
        raise
    finally:
        live_connections.disconnect(websocket)
        await live_connections.broadcast(await runtime.snapshot())
