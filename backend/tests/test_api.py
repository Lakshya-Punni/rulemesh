import time

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
    assert [rule["name"] for rule in snapshot["rules"]] == [
        "Fire alarm",
        "Evacuate",
        "Unlock exits",
        "Emergency lights",
        "Smoke shutdown",
        "Temperature cooling",
        "Quiet hours",
    ]


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


def test_rule_update_toggle_and_delete() -> None:
    created = client.post(
        "/api/rules",
        json={
            "name": "API CRUD test",
            "enabled": True,
            "priority": 20,
            "conditions": [
                {"variable": "laboratory.temperature", "operator": ">", "value": 30}
            ],
            "action": {"target": "laboratory.hvac", "value": "cool"},
        },
    )
    assert created.status_code == 200
    rule_id = created.json()["rules"][-1]["id"]

    updated = client.put(f"/api/rules/{rule_id}", json={"priority": 75})
    assert updated.status_code == 200
    updated_rule = next(rule for rule in updated.json()["rules"] if rule["id"] == rule_id)
    assert updated_rule["priority"] == 75

    toggled = client.post(f"/api/rules/{rule_id}/toggle", json={"enabled": False})
    assert toggled.status_code == 200
    toggled_rule = next(rule for rule in toggled.json()["rules"] if rule["id"] == rule_id)
    assert toggled_rule["enabled"] is False

    deleted = client.delete(f"/api/rules/{rule_id}")
    assert deleted.status_code == 200
    assert all(rule["id"] != rule_id for rule in deleted.json()["rules"])


def test_rule_update_rejects_cycle_without_mutating_saved_rule() -> None:
    first = client.post(
        "/api/rules",
        json={
            "name": "Cycle update source",
            "enabled": True,
            "priority": 50,
            "conditions": [{"variable": "laboratory.smoke", "operator": ">", "value": 70}],
            "action": {"target": "laboratory.alarm", "value": True},
        },
    )
    first_id = first.json()["rules"][-1]["id"]
    second = client.post(
        "/api/rules",
        json={
            "name": "Cycle update target",
            "enabled": True,
            "priority": 50,
            "conditions": [{"variable": "laboratory.alarm", "operator": "==", "value": True}],
            "action": {"target": "building.evacuation", "value": True},
        },
    )
    second_id = second.json()["rules"][-1]["id"]

    rejected = client.put(
        f"/api/rules/{first_id}",
        json={
            "conditions": [
                {"variable": "building.evacuation", "operator": "==", "value": True}
            ]
        },
    )
    assert rejected.status_code == 422
    assert rejected.json()["code"] == "CYCLE_DETECTED"
    assert rejected.json()["path"][0] == rejected.json()["path"][-1]

    with client.websocket_connect("/ws/live") as websocket:
        snapshot = websocket.receive_json()
    saved = next(rule for rule in snapshot["rules"] if rule["id"] == first_id)
    assert saved["conditions"][0]["variable"] == "laboratory.smoke"

    client.delete(f"/api/rules/{second_id}")
    client.delete(f"/api/rules/{first_id}")


def test_simulation_is_server_owned_and_reports_real_event_counts() -> None:
    with TestClient(app) as simulation_client:
        before = simulation_client.post("/api/simulation/stop").json()
        started = simulation_client.post("/api/simulation/start", json={"seed": 42})
        assert started.status_code == 200
        assert started.json()["simulation_running"] is True
        assert started.json()["simulation_seed"] == 42

        time.sleep(0.25)
        stopped = simulation_client.post("/api/simulation/stop")

    assert stopped.status_code == 200
    assert stopped.json()["simulation_running"] is False
    assert stopped.json()["simulation_seed"] == 42
    assert stopped.json()["perf"]["accepted_events"] >= before["perf"]["accepted_events"] + 2
    assert stopped.json()["perf"]["events_per_second"] >= 2


def test_demo_reset_restores_a_clean_known_state() -> None:
    with TestClient(app) as reset_client:
        reset_client.delete("/api/rules/rule-1")
        reset_client.post(
            "/api/environment",
            json={"changes": {"laboratory.smoke": 88, "building.quiet_hours": True}},
        )
        reset_client.post("/api/simulation/start", json={"seed": 99})
        time.sleep(0.12)

        reset = reset_client.post("/api/demo/reset")

    assert reset.status_code == 200
    snapshot = reset.json()
    assert snapshot["simulation_running"] is False
    assert snapshot["simulation_seed"] is None
    assert snapshot["state"]["laboratory.smoke"] == 0.0
    assert snapshot["state"]["laboratory.temperature"] == 24.0
    assert snapshot["state"]["building.quiet_hours"] is False
    assert [rule["id"] for rule in snapshot["rules"]] == [f"rule-{index}" for index in range(1, 8)]
    assert snapshot["perf"] == {
        "events_per_second": 0,
        "accepted_events": 0,
        "rejected_events": 0,
    }
