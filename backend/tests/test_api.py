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


def test_judge_demo_flow_stays_consistent_across_two_live_sessions() -> None:
    """Prove the complete demo path through public HTTP and WebSocket APIs."""
    with TestClient(app) as demo_client:
        demo_client.post("/api/demo/reset")

        with demo_client.websocket_connect("/ws/live") as first_session:
            first_session.receive_json()
            with demo_client.websocket_connect("/ws/live") as second_session:
                joined_first = first_session.receive_json()
                joined_second = second_session.receive_json()
                assert joined_first["connected_sessions"] == 2
                assert joined_second["connected_sessions"] == 2

                cooling = demo_client.post(
                    "/api/environment",
                    json={"changes": {"laboratory.temperature": 36.0}},
                )
                cooling_first = first_session.receive_json()
                cooling_second = second_session.receive_json()
                assert cooling.status_code == 200
                assert cooling_first["revision"] == cooling_second["revision"]
                assert cooling_first["state"]["laboratory.hvac"] == "cool"
                assert "rule-6" in cooling_first["active_rule_ids"]

                emergency = demo_client.post(
                    "/api/environment",
                    json={"changes": {"laboratory.smoke": 80.0}},
                )
                emergency_first = first_session.receive_json()
                emergency_second = second_session.receive_json()
                assert emergency.status_code == 200
                assert emergency_first["revision"] == emergency_second["revision"]
                assert emergency_first["state"] == emergency_second["state"]
                assert emergency_first["state"]["laboratory.alarm"] is True
                assert emergency_first["state"]["building.evacuation"] is True
                assert emergency_first["state"]["laboratory.exit_locked"] is False
                assert emergency_first["state"]["laboratory.emergency_lights"] is True
                assert emergency_first["state"]["laboratory.hvac"] == "off"
                hvac_conflict = next(
                    conflict
                    for conflict in emergency_first["conflicts"]
                    if conflict["target"] == "laboratory.hvac"
                )
                assert hvac_conflict["winner"]["rule_name"] == "Smoke shutdown"

                cleared = demo_client.post(
                    "/api/environment",
                    json={
                        "changes": {
                            "laboratory.smoke": 0.0,
                            "laboratory.temperature": 24.0,
                        }
                    },
                )
                cleared_first = first_session.receive_json()
                cleared_second = second_session.receive_json()
                assert cleared.status_code == 200
                assert cleared_first["revision"] == cleared_second["revision"]
                assert cleared_first["active_rule_ids"] == []
                assert cleared_first["conflicts"] == []
                assert cleared_first["state"]["laboratory.alarm"] is False
                assert cleared_first["state"]["building.evacuation"] is False
                assert cleared_first["state"]["laboratory.exit_locked"] is True

                rejected = demo_client.post(
                    "/api/rules",
                    json={
                        "name": "Rejected evacuation loop",
                        "enabled": True,
                        "priority": 100,
                        "conditions": [
                            {
                                "variable": "building.evacuation",
                                "operator": "==",
                                "value": True,
                            }
                        ],
                        "action": {"target": "laboratory.alarm", "value": True},
                    },
                )
                assert rejected.status_code == 422
                assert rejected.json()["code"] == "CYCLE_DETECTED"
                assert rejected.json()["path"][0] == rejected.json()["path"][-1]

                # A rejected rule emits no state mutation. Trigger a harmless
                # sensor event and verify both clients still receive the same
                # seven-rule graph.
                demo_client.post(
                    "/api/environment",
                    json={"changes": {"laboratory.smoke": 0.0}},
                )
                unchanged_first = first_session.receive_json()
                unchanged_second = second_session.receive_json()
                assert unchanged_first["revision"] == unchanged_second["revision"]
                assert len(unchanged_first["rules"]) == 7
                assert all(
                    rule["name"] != "Rejected evacuation loop"
                    for rule in unchanged_first["rules"]
                )

                reset = demo_client.post("/api/demo/reset")
                reset_first = first_session.receive_json()
                reset_second = second_session.receive_json()
                assert reset.status_code == 200
                assert reset_first["revision"] == reset_second["revision"]
                assert reset_first["state"]["laboratory.smoke"] == 0.0
                assert reset_first["active_rule_ids"] == []
                assert reset_first["perf"] == {
                    "events_per_second": 0,
                    "accepted_events": 0,
                    "rejected_events": 0,
                }


def test_guided_demo_stages_are_atomic_and_cancel_the_simulator() -> None:
    with TestClient(app) as demo_client:
        demo_client.post("/api/demo/reset")

        heat = demo_client.post("/api/demo/stage", json={"stage": "heat"})
        assert heat.status_code == 200
        assert heat.json()["state"]["laboratory.hvac"] == "cool"
        assert heat.json()["active_rule_ids"] == ["rule-6"]
        assert heat.json()["conflicts"] == []

        demo_client.post("/api/simulation/start", json={"seed": 42})
        safety = demo_client.post(
            "/api/demo/stage",
            json={"stage": "safety_override"},
        )
        assert safety.status_code == 200
        safety_snapshot = safety.json()
        assert safety_snapshot["simulation_running"] is False
        assert safety_snapshot["simulation_seed"] is None
        assert safety_snapshot["state"]["laboratory.alarm"] is True
        assert safety_snapshot["state"]["building.evacuation"] is True
        assert safety_snapshot["state"]["laboratory.hvac"] == "off"
        winners = {
            conflict["target"]: conflict["winner"]["rule_name"]
            for conflict in safety_snapshot["conflicts"]
        }
        assert winners == {
            "laboratory.alarm": "Fire alarm",
            "laboratory.hvac": "Smoke shutdown",
        }

        normal = demo_client.post("/api/demo/stage", json={"stage": "normal"})
        assert normal.status_code == 200
        assert normal.json()["active_rule_ids"] == []
        assert normal.json()["conflicts"] == []
        assert normal.json()["state"]["laboratory.alarm"] is False
        assert normal.json()["state"]["laboratory.exit_locked"] is True
