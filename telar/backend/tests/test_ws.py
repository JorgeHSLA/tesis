"""Suite 4 (architecture §11): WS ``/ws/jobs/{id}`` con TestClient de Starlette.

Origin (§8.1), 4404, replay terminal + close 1000, snapshot + backlog,
stream vivo, ``cancel``, ``BAD_CLIENT_MESSAGE`` y fan-out a 2 conexiones.
"""

from __future__ import annotations

import pytest
from starlette.websockets import WebSocketDisconnect

from conftest import wait_terminal
from fakes.fake_docker import FakeExecution


def collect_until_eof(ws, max_msgs: int = 300) -> list[dict]:
    messages = []
    for _ in range(max_msgs):
        msg = ws.receive_json()
        messages.append(msg)
        if msg["type"] == "eof":
            return messages
    raise AssertionError("no llegó eof")


def collect_until(ws, predicate, max_msgs: int = 300) -> list[dict]:
    messages = []
    for _ in range(max_msgs):
        msg = ws.receive_json()
        messages.append(msg)
        if predicate(msg):
            return messages
    raise AssertionError("no llegó el mensaje esperado")


def post_job(client, *, code="print('x')\n", timeout_s=30) -> str:
    response = client.post(
        "/api/v1/jobs", json={"code": code, "timeout_s": timeout_s}
    )
    assert response.status_code == 202, response.text
    data = response.json()["data"]
    assert data["ws_url"] == f"/ws/jobs/{data['job_id']}"
    return data["job_id"]


# ────────────────────────────── handshake §8.1 ───────────────────────────────


def test_origin_no_permitido_1008(client):
    with pytest.raises(WebSocketDisconnect) as excinfo:
        with client.websocket_connect(
            "/ws/jobs/x", headers={"origin": "http://evil.example"}
        ):
            pass
    assert excinfo.value.code == 1008


def test_origin_permitido_null_y_ausente(client, fake_docker):
    fake_docker.queue_execution(FakeExecution(stdout=[b"a\n"]))
    job_id = post_job(client)
    wait_terminal(client, job_id)
    for headers in (
        {"origin": "http://localhost:5173"},
        {"origin": "http://localhost:8080"},
        # Electron manda DOS orígenes distintos desde la misma página file://:
        # "null" por fetch/XHR y "file://" por WebSocket. Cubrir solo "null"
        # dejaba el WS del escritorio rechazado con 403 en todos los jobs.
        {"origin": "null"},
        {"origin": "file://"},
        None,                # cliente no-navegador
    ):
        kwargs = {"headers": headers} if headers else {}
        with client.websocket_connect(f"/ws/jobs/{job_id}", **kwargs) as ws:
            assert ws.receive_json()["type"] == "status"


def test_job_inexistente_4404(client):
    with pytest.raises(WebSocketDisconnect) as excinfo:
        with client.websocket_connect("/ws/jobs/no-existe") as ws:
            ws.receive_json()
    assert excinfo.value.code == 4404
    assert excinfo.value.reason == "job not found"


# ─────────────────────── replay terminal (F5) + 1000 ─────────────────────────


def test_replay_terminal_status_logs_eof_close_1000(client, fake_docker, app):
    fake_docker.queue_execution(FakeExecution(
        stdout=[b"salida 1\nsalida 2\n"], stderr=[b"aviso\n"], exit_code=1,
    ))
    job_id = post_job(client)
    data = wait_terminal(client, job_id)
    assert data["status"] == "failed"

    from conftest import wait_registry_empty
    wait_registry_empty(app, job_id)  # forzar la vía DB (replay §8.1)

    with client.websocket_connect(f"/ws/jobs/{job_id}") as ws:
        messages = collect_until_eof(ws)
        status = messages[0]
        assert status["type"] == "status"
        assert status["phase"] == "failed"
        assert status["job_id"] == job_id
        assert status["detail"]["exit_code"] == 1
        assert status["detail"]["oom_killed"] is False
        logs = [m for m in messages if m["type"] == "log"]
        stdout_lines = [
            line for m in logs if m["stream"] == "stdout" for line in m["lines"]
        ]
        stderr_lines = [
            line for m in logs if m["stream"] == "stderr" for line in m["lines"]
        ]
        assert stdout_lines == ["salida 1", "salida 2"]
        assert stderr_lines == ["aviso"]
        assert all(m["seq"] >= 1 for m in logs)
        eof = messages[-1]
        assert eof["truncated"] is False
        assert eof["total_log_bytes"] > 0
        with pytest.raises(WebSocketDisconnect) as excinfo:
            ws.receive_json()
        assert excinfo.value.code == 1000


# ───────────────────────────── stream en vivo ────────────────────────────────


def test_stream_vivo_fases_logs_y_eof(client, fake_docker):
    execution = fake_docker.queue_execution(FakeExecution(
        stdout=[b"progreso 1\n", b"progreso 2\n"], hang=True,
    ))
    job_id = post_job(client)
    with client.websocket_connect(f"/ws/jobs/{job_id}") as ws:
        first = ws.receive_json()
        assert first["type"] == "status"  # snapshot al conectar
        assert first["phase"] in {
            "queued", "creating", "compiling", "running"
        }
        collect_until(
            ws, lambda m: m["type"] == "log" and "progreso 2" in m["lines"]
        )
        execution.finish(exit_code=0)
        messages = collect_until_eof(ws)
        statuses = [m for m in messages if m["type"] == "status"]
        assert statuses[-1]["phase"] == "completed"
        assert statuses[-1]["detail"]["exit_code"] == 0
        with pytest.raises(WebSocketDisconnect) as excinfo:
            ws.receive_json()
        assert excinfo.value.code == 1000


def test_cancel_por_ws(client, fake_docker):
    fake_docker.queue_execution(FakeExecution(stdout=[b"vivo\n"], hang=True))
    job_id = post_job(client)
    with client.websocket_connect(f"/ws/jobs/{job_id}") as ws:
        assert ws.receive_json()["type"] == "status"
        ws.send_json({"type": "cancel"})
        messages = collect_until_eof(ws)
        statuses = [m for m in messages if m["type"] == "status"]
        assert statuses[-1]["phase"] == "cancelled"
        assert statuses[-1]["detail"]["error_detail"] is None
    data = wait_terminal(client, job_id)
    assert data["status"] == "cancelled"


def test_bad_client_message_no_cierra(client, fake_docker):
    execution = fake_docker.queue_execution(
        FakeExecution(stdout=[b"x\n"], hang=True)
    )
    job_id = post_job(client)
    with client.websocket_connect(f"/ws/jobs/{job_id}") as ws:
        assert ws.receive_json()["type"] == "status"
        ws.send_text("esto no es json {")
        error = collect_until(ws, lambda m: m["type"] == "error")[-1]
        assert error["code"] == "BAD_CLIENT_MESSAGE"
        ws.send_json({"type": "desconocido"})
        error = collect_until(ws, lambda m: m["type"] == "error")[-1]
        assert error["code"] == "BAD_CLIENT_MESSAGE"
        # la conexión sigue viva: el job termina y llega el cierre normal
        execution.finish(exit_code=0)
        messages = collect_until_eof(ws)
        assert messages[-1]["type"] == "eof"


def test_fanout_dos_conexiones_reciben_lo_mismo(client, fake_docker):
    execution = fake_docker.queue_execution(FakeExecution(
        stdout=[b"linea A\nlinea B\n"], hang=True,
    ))
    job_id = post_job(client)
    with client.websocket_connect(f"/ws/jobs/{job_id}") as ws_a:
        assert ws_a.receive_json()["type"] == "status"
        with client.websocket_connect(f"/ws/jobs/{job_id}") as ws_b:
            assert ws_b.receive_json()["type"] == "status"
            execution.finish(exit_code=0)
            messages_a = collect_until_eof(ws_a)
            messages_b = collect_until_eof(ws_b)

            def log_lines(messages):
                return [
                    line
                    for m in messages
                    if m["type"] == "log"
                    for line in m["lines"]
                ]

            # ambos ven el stream completo (backlog + vivo, §8.1)
            assert "linea A" in log_lines(messages_b)
            assert log_lines(messages_a)[-2:] == log_lines(messages_b)[-2:]
            assert messages_a[-1]["type"] == "eof"
            assert messages_b[-1]["type"] == "eof"


def test_conectar_tarde_recibe_backlog_con_seq(client, fake_docker):
    execution = fake_docker.queue_execution(FakeExecution(
        stdout=[b"temprano 1\ntemprano 2\n"], hang=True,
    ))
    job_id = post_job(client)
    # esperar a que las líneas estén ingeridas antes de conectar
    import time
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        response = client.get(f"/api/v1/jobs/{job_id}")
        if response.json()["data"]["status"] == "running":
            break
        time.sleep(0.02)
    time.sleep(0.1)  # flush del drainer al backlog
    with client.websocket_connect(f"/ws/jobs/{job_id}") as ws:
        first = ws.receive_json()
        assert first["type"] == "status"
        backlog = collect_until(
            ws, lambda m: m["type"] == "log" and "temprano 2" in m["lines"]
        )
        logs = [m for m in backlog if m["type"] == "log"]
        assert logs and logs[0]["seq"] >= 1  # seq ORIGINALES del ring-buffer
        execution.finish(exit_code=0)
        collect_until_eof(ws)


def test_desconexion_no_cancela_el_job(client, fake_docker):
    execution = fake_docker.queue_execution(FakeExecution(
        stdout=[b"sigo vivo\n"], hang=True,
    ))
    job_id = post_job(client)
    with client.websocket_connect(f"/ws/jobs/{job_id}") as ws:
        assert ws.receive_json()["type"] == "status"
    # cliente desconectado: el job sigue (§8.4)
    response = client.get(f"/api/v1/jobs/{job_id}")
    assert response.json()["data"]["status"] not in {"cancelled", "failed"}
    execution.finish(exit_code=0)
    data = wait_terminal(client, job_id)
    assert data["status"] == "completed"


def test_bl16_replay_no_fabrica_ts_en_los_logs(client, fake_docker, app):
    """El replay desde DB no conoce el instante real de cada línea: `ts` va
    vacío (marcado, §8.2) en vez de fabricarse con la hora del refresh."""
    fake_docker.queue_execution(FakeExecution(stdout=[b"salida\n"]))
    job_id = post_job(client)
    wait_terminal(client, job_id)
    from conftest import wait_registry_empty
    wait_registry_empty(app, job_id)  # forzar la vía DB (replay §8.1)

    with client.websocket_connect(f"/ws/jobs/{job_id}") as ws:
        messages = collect_until_eof(ws)
        assert messages[0]["type"] == "status" and messages[0]["ts"]
        logs = [m for m in messages if m["type"] == "log"]
        assert logs and all(m["ts"] == "" for m in logs)
        assert messages[-1]["type"] == "eof" and messages[-1]["ts"]


def test_bl33_estado_inconsistente_emite_error_antes_del_1011(
    client, fake_docker, app
):
    """§8.4: el cierre 1011 va «tras intentar emitir error» (catálogo §8.2)."""
    execution = fake_docker.queue_execution(
        FakeExecution(stdout=[b"x\n"], hang=True)
    )
    job_id = post_job(client)
    # inconsistencia forzada: no-terminal en DB pero fuera del registro
    import time
    deadline = time.monotonic() + 5
    while job_id not in app.state.jobs and time.monotonic() < deadline:
        time.sleep(0.01)
    handle = app.state.jobs.pop(job_id)
    try:
        with client.websocket_connect(f"/ws/jobs/{job_id}") as ws:
            error = ws.receive_json()
            assert error["type"] == "error"
            assert error["code"] == "STREAM_ERROR"  # catálogo cerrado §8.2
            with pytest.raises(WebSocketDisconnect) as excinfo:
                ws.receive_json()
            assert excinfo.value.code == 1011
    finally:
        app.state.jobs[job_id] = handle
        execution.finish(exit_code=0)
        wait_terminal(client, job_id)


def test_bl09_reconexion_en_retencion_recibe_backlog_con_seq_originales(
    settings, fake_docker, real_content
):
    """BL-09 (opción A): el handle terminal se retiene un periodo corto — la
    reconexión recibe el backlog con los seq y ts ORIGINALES del stream vivo
    (el dedupe del cliente por `seq` sigue funcionando, §8.2)."""
    from conftest import build_app
    from fastapi.testclient import TestClient

    retained_app = build_app(
        settings=settings, docker=fake_docker, content=real_content,
        terminal_retention_s=5.0,
    )
    fake_docker.queue_execution(FakeExecution(stdout=[b"uno\ndos\n"]))
    with TestClient(retained_app) as retained_client:
        job_id = post_job(retained_client)
        wait_terminal(retained_client, job_id)
        # terminal en DB pero AÚN retenido en el registro (§3.4 p.5 diferido)
        handle = retained_app.state.jobs[job_id]
        original_seqs = [m["seq"] for m in handle.backlog]
        assert original_seqs

        with retained_client.websocket_connect(f"/ws/jobs/{job_id}") as ws:
            messages = collect_until_eof(ws)
            status = messages[0]
            assert status["type"] == "status"
            assert status["phase"] == "completed"
            assert status["detail"]["exit_code"] == 0
            logs = [m for m in messages if m["type"] == "log"]
            assert [line for m in logs for line in m["lines"]] == ["uno", "dos"]
            assert [m["seq"] for m in logs] == original_seqs
            assert all(m["ts"] for m in logs)  # ts reales del vivo
            assert messages[-1]["truncated"] is False
            with pytest.raises(WebSocketDisconnect) as excinfo:
                ws.receive_json()
            assert excinfo.value.code == 1000


def test_replay_truncado_marca_eof(client, fake_docker, settings, real_content):
    """Job truncado: el replay terminal marca ``eof.truncated=true``."""
    from conftest import build_app
    from fastapi.testclient import TestClient

    small = settings.model_copy(update={"max_output_bytes": 256})
    small_app = build_app(
        settings=small, docker=fake_docker, content=real_content
    )
    fake_docker.queue_execution(FakeExecution(
        stdout=[b"y" * 64 + b"\n"], hang=True, repeat_last=True,
    ))
    with TestClient(small_app) as small_client:
        job_id = post_job(small_client)
        data = wait_terminal(small_client, job_id)
        assert data["status"] == "failed"
        assert data["output_truncated"] is True
        from conftest import wait_registry_empty
        wait_registry_empty(small_app, job_id)
        with small_client.websocket_connect(f"/ws/jobs/{job_id}") as ws:
            messages = collect_until_eof(ws)
            assert messages[0]["detail"]["error_detail"] == "output_limit_exceeded"
            assert messages[-1]["truncated"] is True
