from __future__ import annotations

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .graph import CycleDetectedError
from .models import CycleError, EnvironmentUpdate, RuleCreate, Snapshot
from .state import live_connections, runtime


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
        raise HTTPException(status_code=422, detail=str(error)) from error
    await live_connections.broadcast(snapshot)
    return snapshot


@app.post("/api/rules", response_model=Snapshot)
async def create_rule(request: RuleCreate) -> Snapshot | JSONResponse:
    try:
        snapshot = await runtime.add_rule(request)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except CycleDetectedError as error:
        payload = CycleError(path=error.path, proposed_edges=error.proposed_edges)
        return JSONResponse(status_code=422, content=payload.model_dump(mode="json"))
    await live_connections.broadcast(snapshot)
    return snapshot


@app.websocket("/ws/live")
async def live_state(websocket: WebSocket) -> None:
    await live_connections.connect(websocket)
    try:
        await websocket.send_json((await runtime.snapshot()).model_dump(mode="json"))
        while True:
            message = await websocket.receive_text()
            if message == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        live_connections.disconnect(websocket)
    except Exception:
        live_connections.disconnect(websocket)
        raise

