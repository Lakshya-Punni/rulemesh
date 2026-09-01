from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_health_endpoint() -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_websocket_receives_initial_snapshot() -> None:
    with client.websocket_connect("/ws/live") as websocket:
        snapshot = websocket.receive_json()

    assert snapshot["type"] == "snapshot"
    assert "revision" in snapshot
    assert "state" in snapshot
    assert "graph" in snapshot


def test_environment_update_is_pushed_to_live_session() -> None:
    with client.websocket_connect("/ws/live") as websocket:
        websocket.receive_json()
        response = client.post(
            "/api/environment",
            json={"changes": {"laboratory.smoke": 42.0}},
        )
        pushed = websocket.receive_json()

    assert response.status_code == 200
    assert response.json()["state"]["laboratory.smoke"] == 42.0
    assert pushed["state"]["laboratory.smoke"] == 42.0
    assert pushed["revision"] == response.json()["revision"]
