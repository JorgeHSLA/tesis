"""``create_app`` REAL (main.py): lifespan completo con docker inyectado,
reaper de arranque, degradación sin daemon (liveness ≠ readiness) y CORS.
"""

from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient

import app.main as app_main
from app.db import apply_schema, open_db
from app.main import create_app
from app.repositories.jobs import JobRepository

from conftest import make_job_record, wait_terminal
from fakes.fake_docker import FakeDockerService, FakeExecution


def test_lifespan_completo_y_estado(settings, fake_docker):
    application = create_app(settings=settings, docker_service=fake_docker)
    with TestClient(application) as client:
        state = application.state
        assert state.settings is settings
        assert state.docker is fake_docker
        assert state.docker_service is fake_docker
        assert state.jobs == {}
        assert state.content.exists_lesson("spmd")
        assert fake_docker.reap_calls == 1  # reaper en el arranque

        response = client.get("/health")
        assert response.status_code == 200
        assert response.json()["checks"] == {
            "db": True, "docker": True, "runner_image": True
        }
        assert settings.db_path_expanded.exists()  # DB física creada


def test_job_end_to_end_contra_app_real(settings, fake_docker):
    """El flujo §3 completo por la app REAL (con runner fake): POST → WS
    implícito por fases → GET con resultados."""
    fake_docker.queue_execution(FakeExecution(stdout=[b"hola e2e\n"]))
    application = create_app(settings=settings, docker_service=fake_docker)
    with TestClient(application) as client:
        response = client.post("/api/v1/jobs", json={"code": "print('e2e')\n"})
        assert response.status_code == 202
        detail = wait_terminal(client, response.json()["data"]["job_id"])
        assert detail["status"] == "completed"
        assert detail["stdout"] == "hola e2e\n"


def test_apagado_invoca_el_shutdown_del_runner(settings, fake_docker, monkeypatch):
    """El lifespan debe cancelar las retenciones de handles terminales (BL-09)
    al cerrar; si no, uvicorn deja tareas `_expire()` colgadas y CPython avisa
    «Task was destroyed but it is pending!» en cada redespliegue (review S3).

    Se verifica el WIRING (que main.py lo llame), no el efecto: bajo TestClient
    el portal de anyio cancela las tareas remanentes de todas formas, así que
    observar solo las tareas no distinguiría el fix de su ausencia.
    """
    from app.services.job_runner import JobRunner

    calls: list[JobRunner] = []
    original = JobRunner.shutdown

    async def spy(self: JobRunner) -> None:
        calls.append(self)
        await original(self)

    monkeypatch.setattr(JobRunner, "shutdown", spy)

    fake_docker.queue_execution(FakeExecution(stdout=[b"ok\n"]))
    application = create_app(settings=settings, docker_service=fake_docker)
    with TestClient(application) as client:
        job_id = client.post(
            "/api/v1/jobs", json={"code": "print('x')\n"}
        ).json()["data"]["job_id"]
        wait_terminal(client, job_id)
        handle = application.state.jobs[job_id]  # terminal, aún retenido
        assert any(not t.done() for t in handle.aux_tasks)
        assert calls == []  # todavía no se apagó
    assert calls == [application.state.job_runner]
    assert all(t.done() for t in handle.aux_tasks)


def test_reaper_marca_huerfanos_en_db(settings, fake_docker):
    """Jobs no terminales de una sesión anterior → failed/orphaned_on_restart."""

    async def seed() -> None:
        settings.db_path_expanded.parent.mkdir(parents=True, exist_ok=True)
        conn = await open_db(str(settings.db_path_expanded))
        await apply_schema(conn)
        await JobRepository(conn).create(
            make_job_record("huerfano", status="running")
        )
        await conn.close()

    asyncio.run(seed())
    fake_docker.reap_result = (1, 2)
    application = create_app(settings=settings, docker_service=fake_docker)
    with TestClient(application) as client:
        data = client.get("/api/v1/jobs/huerfano").json()["data"]
        assert data["status"] == "failed"
        assert data["error_detail"] == "orphaned_on_restart"


def test_reaper_que_falla_no_impide_el_arranque(settings, fake_docker):
    fake_docker.reap_error = RuntimeError("daemon raro")
    application = create_app(settings=settings, docker_service=fake_docker)
    with TestClient(application) as client:
        assert client.get("/health").status_code == 200


def test_sin_docker_service_liveness_pero_system_503(settings, monkeypatch):
    """Si el docker service no se puede construir, la app arranca igual:
    /health 200 (checks informativos) y /system 503 DOCKER_UNAVAILABLE."""

    def broken_builder(cfg):
        raise RuntimeError("sin daemon")

    monkeypatch.setattr(app_main, "_build_docker_service", broken_builder)
    application = create_app(settings=settings)
    with TestClient(application) as client:
        health = client.get("/health")
        assert health.status_code == 200  # liveness ≠ readiness
        assert health.json()["checks"]["docker"] is False
        assert health.json()["checks"]["runner_image"] is False

        system = client.get("/api/v1/system")
        assert system.status_code == 503
        assert system.json()["error"]["code"] == "DOCKER_UNAVAILABLE"

        jobs = client.post("/api/v1/jobs", json={"code": "print(1)\n"})
        assert jobs.status_code == 503
        assert jobs.json()["error"]["code"] == "DOCKER_UNAVAILABLE"


def test_cors_origins_congelados(settings, fake_docker):
    application = create_app(settings=settings, docker_service=fake_docker)
    with TestClient(application) as client:
        for origin in ("http://localhost:5173", "http://localhost:8080", "null"):
            response = client.get("/health", headers={"origin": origin})
            assert response.headers.get("access-control-allow-origin") == origin
        response = client.get("/health", headers={"origin": "http://evil.example"})
        assert "access-control-allow-origin" not in response.headers


def test_internal_error_envelope_generico(settings, fake_docker):
    """Una excepción no controlada responde INTERNAL_ERROR sin detalle."""
    application = create_app(settings=settings, docker_service=fake_docker)

    @application.get("/api/v1/_boom")
    async def _boom():
        raise RuntimeError("secreto interno: /ruta/privada")

    with TestClient(application, raise_server_exceptions=False) as client:
        response = client.get("/api/v1/_boom")
        assert response.status_code == 500
        body = response.json()
        assert body["error"]["code"] == "INTERNAL_ERROR"
        assert "secreto" not in response.text  # detalle SOLO en logs


# ───────── BL-21 (auditoría §3): marcador persistente del auto-seed ──────────


def _db_path(settings) -> str:
    return str(settings.db_path_expanded)


async def _run_sql(path: str, sql: str, params: tuple = ()) -> list:
    conn = await open_db(path)
    try:
        cursor = await conn.execute(sql, params)
        rows = list(await cursor.fetchall())
        await conn.commit()
        return rows
    finally:
        await conn.close()


def _lessons_count(settings) -> int:
    rows = asyncio.run(_run_sql(_db_path(settings), "SELECT COUNT(*) FROM lessons"))
    return int(rows[0][0])


def _seed_marker(settings) -> str | None:
    rows = asyncio.run(_run_sql(
        _db_path(settings),
        "SELECT value FROM app_meta WHERE key = 'content_seeded_at'",
    ))
    return rows[0][0] if rows else None


def test_bl21_primer_arranque_siembra_y_deja_marcador(settings, fake_docker):
    application = create_app(settings=settings, docker_service=fake_docker)
    with TestClient(application):
        pass
    assert _lessons_count(settings) == 14
    assert _seed_marker(settings) is not None


def test_bl21_catalogo_vaciado_por_admin_no_se_resiembra(settings, fake_docker):
    """BL-21: 'lessons vacía' ya no implica 'nunca sembrada' — vaciar el
    catálogo es una decisión del admin que un reinicio debe respetar."""
    with TestClient(create_app(settings=settings, docker_service=fake_docker)):
        pass  # primer arranque: siembra + marcador

    # el admin vacía el catálogo (DELETE lecciones; CASCADE ejemplos/quiz)
    asyncio.run(_run_sql(_db_path(settings), "DELETE FROM lessons"))
    assert _lessons_count(settings) == 0

    with TestClient(create_app(settings=settings, docker_service=fake_docker)):
        pass  # reinicio: NO debe re-sembrar los fixtures

    assert _lessons_count(settings) == 0
    assert _seed_marker(settings) is not None


def test_bl21_backfill_db_poblada_sin_marcador(settings, fake_docker):
    """DB legado (pre-migración 3) ya sembrada y quizá editada: el arranque
    marca content_seeded_at SIN tocar el contenido (no pisa ediciones)."""
    with TestClient(create_app(settings=settings, docker_service=fake_docker)):
        pass
    # simular instalación previa a la migración: sin marcador + edición admin
    asyncio.run(_run_sql(_db_path(settings), "DELETE FROM app_meta"))
    asyncio.run(_run_sql(
        _db_path(settings),
        "UPDATE lessons SET title = 'Editada por el admin' WHERE id = 'spmd'",
    ))

    with TestClient(create_app(settings=settings, docker_service=fake_docker)):
        pass

    assert _seed_marker(settings) is not None  # backfill del marcador
    rows = asyncio.run(_run_sql(
        _db_path(settings), "SELECT title FROM lessons WHERE id = 'spmd'"
    ))
    assert rows[0][0] == "Editada por el admin"  # el contenido NO se pisó
