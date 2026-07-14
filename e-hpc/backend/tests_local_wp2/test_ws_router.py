"""routers/ws.py — api-contract.md §8: Origin, 4404, replay terminal + 1000,
backlog, cancel y BAD_CLIENT_MESSAGE."""

from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from fakes import FakeDockerService, FakeExecution, build_app, make_record


def collect_until_eof(ws, max_msgs=200):
    msgs = []
    for _ in range(max_msgs):
        msg = ws.receive_json()
        msgs.append(msg)
        if msg["type"] == "eof":
            return msgs
    raise AssertionError("no llegó eof")


def start_hanging_job(client, execution=None):
    r = client.post("/api/v1/jobs", json={"code": "while True: pass\n"})
    assert r.status_code == 202
    return r.json()["data"]["job_id"]


# ─────────────────────────────── handshake ──────────────────────────────────


def test_origin_no_permitido_rechaza_handshake():
    app, _ = build_app()
    with TestClient(app) as client:
        with pytest.raises(WebSocketDisconnect) as exc:
            with client.websocket_connect(
                "/ws/jobs/x", headers={"origin": "http://evil.example"}
            ):
                pass
        assert exc.value.code == 1008


def test_origin_permitido_y_null_y_ausente():
    app, ctx = build_app()
    ctx.repo.records["fin"] = make_record("fin", status="completed", stdout="")
    with TestClient(app) as client:
        for headers in (
            {"origin": "http://localhost:5173"},
            {"origin": "null"},  # Electron file:// (§8.1)
            None,  # cliente no-navegador
        ):
            kw = {"headers": headers} if headers else {}
            with client.websocket_connect("/ws/jobs/fin", **kw) as ws:
                assert ws.receive_json()["type"] == "status"


def test_job_inexistente_4404():
    app, _ = build_app()
    with TestClient(app) as client:
        with client.websocket_connect("/ws/jobs/no-existe") as ws:
            with pytest.raises(WebSocketDisconnect) as exc:
                ws.receive_json()
            assert exc.value.code == 4404
            assert exc.value.reason == "job not found"


# ──────────────────────────── replay terminal ───────────────────────────────


def test_replay_terminal_y_close_1000():
    app, ctx = build_app()
    ctx.repo.records["fin"] = make_record(
        "fin", status="completed", exit_code=0, stdout="uno\ndos\n",
        stderr="aviso\n", wall_time_ms=888,
    )
    with TestClient(app) as client:
        with client.websocket_connect("/ws/jobs/fin") as ws:
            status = ws.receive_json()
            assert status["type"] == "status"
            assert status["phase"] == "completed"
            assert status["detail"] == {
                "exit_code": 0,
                "oom_killed": False,
                "wall_time_ms": 888,
                "output_truncated": False,
                "error_detail": None,
            }
            log1 = ws.receive_json()
            assert log1["type"] == "log" and log1["stream"] == "stdout"
            assert log1["lines"] == ["uno", "dos"]
            log2 = ws.receive_json()
            assert log2["stream"] == "stderr" and log2["lines"] == ["aviso"]
            assert log2["seq"] > log1["seq"]
            eof = ws.receive_json()
            assert eof["type"] == "eof"
            assert eof["truncated"] is False
            assert eof["total_log_bytes"] == len("uno\ndos\n") + len("aviso\n")
            with pytest.raises(WebSocketDisconnect) as exc:
                ws.receive_json()
            assert exc.value.code == 1000  # F5 soportado (§8.1)


# ───────────────────────────── stream en vivo ───────────────────────────────


def test_flujo_vivo_cancel_por_ws():
    execution = FakeExecution(stdout=[b"trabajando\n"], hang=True)
    app, ctx = build_app(docker=FakeDockerService(default_factory=lambda: execution))
    with TestClient(app) as client:
        job_id = start_hanging_job(client)
        with client.websocket_connect(f"/ws/jobs/{job_id}") as ws:
            first = ws.receive_json()
            assert first["type"] == "status"  # snapshot al conectar
            ws.send_json({"type": "cancel"})
            msgs = collect_until_eof(ws)
            statuses = [m["phase"] for m in msgs if m["type"] == "status"]
            assert statuses[-1] == "cancelled"
            terminal = [m for m in msgs if m["type"] == "status"][-1]
            assert terminal["detail"] is not None
            assert msgs[-1]["type"] == "eof"
            with pytest.raises(WebSocketDisconnect) as exc:
                ws.receive_json()
            assert exc.value.code == 1000
        assert ctx.repo.records[job_id].status == "cancelled"


def test_bad_client_message_no_cierra():
    execution = FakeExecution(stdout=[b"x\n"], hang=True)
    app, ctx = build_app(docker=FakeDockerService(default_factory=lambda: execution))
    with TestClient(app) as client:
        job_id = start_hanging_job(client)
        with client.websocket_connect(f"/ws/jobs/{job_id}") as ws:
            ws.receive_json()  # snapshot
            ws.send_text("esto no es json")
            ws.send_json({"type": "desconocido"})
            errors = 0
            for _ in range(50):
                msg = ws.receive_json()
                if msg["type"] == "error" and msg["code"] == "BAD_CLIENT_MESSAGE":
                    errors += 1
                    if errors == 2:
                        break
            assert errors == 2  # respondió y NO cerró la conexión
            ws.send_json({"type": "cancel"})
            msgs = collect_until_eof(ws)
            assert msgs[-1]["type"] == "eof"


def test_backlog_al_conectar_tarde():
    execution = FakeExecution(stdout=[b"l1\nl2\nl3\n"], hang=True)
    app, ctx = build_app(docker=FakeDockerService(default_factory=lambda: execution))
    with TestClient(app) as client:
        job_id = start_hanging_job(client)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:  # espera a que el drainer ingiera
            handle = ctx.runner.registry.get(job_id)
            if handle is not None and handle.backlog:
                break
            time.sleep(0.01)
        with client.websocket_connect(f"/ws/jobs/{job_id}") as ws:
            snapshot_status = ws.receive_json()
            assert snapshot_status["type"] == "status"
            assert snapshot_status["phase"] in ("compiling", "running")
            log = ws.receive_json()
            assert log["type"] == "log"
            assert log["lines"] == ["l1", "l2", "l3"]  # replay del ring-buffer
            assert log["seq"] >= 1
            ws.send_json({"type": "cancel"})
            collect_until_eof(ws)


def test_dos_conexiones_simultaneas_mismo_job():
    execution = FakeExecution(stdout=[b"compartido\n"], hang=True)
    app, ctx = build_app(docker=FakeDockerService(default_factory=lambda: execution))
    with TestClient(app) as client:
        job_id = start_hanging_job(client)
        with client.websocket_connect(f"/ws/jobs/{job_id}") as ws1:
            with client.websocket_connect(f"/ws/jobs/{job_id}") as ws2:
                assert ws1.receive_json()["type"] == "status"
                assert ws2.receive_json()["type"] == "status"
                ws1.send_json({"type": "cancel"})  # cancel desde UNA pestaña
                msgs1 = collect_until_eof(ws1)
                msgs2 = collect_until_eof(ws2)  # la otra también recibe todo
                for msgs in (msgs1, msgs2):
                    phases = [m["phase"] for m in msgs if m["type"] == "status"]
                    assert phases[-1] == "cancelled"


def test_desconexion_no_cancela_el_job():
    execution = FakeExecution(stdout=[b"sigo vivo\n"], hang=True)
    app, ctx = build_app(docker=FakeDockerService(default_factory=lambda: execution))
    with TestClient(app) as client:
        job_id = start_hanging_job(client)
        with client.websocket_connect(f"/ws/jobs/{job_id}") as ws:
            ws.receive_json()
        # cliente desconectado: el job sigue activo (§8.4)
        time.sleep(0.1)
        rec = ctx.repo.records[job_id]
        assert rec.status not in ("cancelled", "failed")
        execution.finish(0)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if ctx.repo.records[job_id].status == "completed":
                break
            time.sleep(0.01)
        assert ctx.repo.records[job_id].status == "completed"
