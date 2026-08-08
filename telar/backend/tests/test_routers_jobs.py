"""Suite 6 (architecture §11): routers de jobs y sistema contra el CONTRATO.

Semántica de fuentes de POST /jobs (§7.1), filename estricto del upload
(§7.2), envelope de errores (§1/§1.1), listados (§7.3), detalle (§7.4),
cancel (§7.5), output (§7.6) y salud/sistema (§2). Todo con el FakeRunner
inyectado por ``app.state`` — sin daemon Docker.
"""

from __future__ import annotations

import os

import pytest

from app.services.job_runner import JobHandle

from conftest import wait_registry_empty, wait_terminal
from fakes.fake_docker import FakeExecution

MAX_THREADS = min(8, os.cpu_count() or 1)


def assert_error_envelope(response, status: int, code: str) -> dict:
    """El envelope §1 es OBLIGATORIO en todo error."""
    assert response.status_code == status, response.text
    body = response.json()
    assert body["success"] is False
    assert body["data"] is None
    assert body["meta"] is None
    assert body["error"]["code"] == code
    assert isinstance(body["error"]["message"], str) and body["error"]["message"]
    return body


def assert_ok_envelope(response, status: int = 200) -> dict:
    assert response.status_code == status, response.text
    body = response.json()
    assert body["success"] is True
    assert body["error"] is None
    return body


# ───────────────────── POST /jobs: semántica de fuentes §7.1 ─────────────────


def test_solo_example_id_source_kind_example(client, fake_docker, real_content):
    fake_docker.queue_execution(FakeExecution(stdout=[b"ok\n"]))
    response = client.post("/api/v1/jobs", json={"example_id": "primerEjemplo"})
    body = assert_ok_envelope(response, 202)
    data = body["data"]
    assert data["status"] == "queued"
    assert data["href"] == f"/api/v1/jobs/{data['job_id']}"
    assert data["created_at"].endswith("Z")

    detail = wait_terminal(client, data["job_id"])
    assert detail["source_kind"] == "example"
    assert detail["example_id"] == "primerEjemplo"
    # se ejecuta el fixture TAL CUAL
    assert detail["source_code"] == real_content.example("primerEjemplo").source_code
    assert detail["filename"] == real_content.example("primerEjemplo").filename


def test_solo_code_source_kind_editor(client, fake_docker):
    fake_docker.queue_execution(FakeExecution(stdout=[b"ok\n"]))
    response = client.post("/api/v1/jobs", json={"code": "print('mio')\n"})
    data = assert_ok_envelope(response, 202)["data"]
    detail = wait_terminal(client, data["job_id"])
    assert detail["source_kind"] == "editor"
    assert detail["example_id"] is None
    assert detail["filename"] == "main.py"  # default sin ejemplo
    assert detail["parsed_timings"] is None  # editor ⇒ parser none


def test_example_mas_code_identico_sigue_siendo_example(client, fake_docker, real_content):
    fixture_code = real_content.example("spmd").source_code
    fake_docker.queue_execution(FakeExecution(stdout=[b"ok\n"]))
    response = client.post(
        "/api/v1/jobs", json={"example_id": "spmd", "code": fixture_code}
    )
    data = assert_ok_envelope(response, 202)["data"]
    detail = wait_terminal(client, data["job_id"])
    assert detail["source_kind"] == "example"  # byte-idéntico al fixture


def test_example_mas_code_editado_es_editor_pero_conserva_parser(
    client, fake_docker, real_content
):
    from conftest import load_stdout

    edited = real_content.example("spmd").source_code + "\n# editado\n"
    fake_docker.queue_execution(FakeExecution(
        stdout=[load_stdout("sweep_pi_critical.txt").encode()],
    ))
    response = client.post(
        "/api/v1/jobs", json={"example_id": "spmd", "code": edited}
    )
    data = assert_ok_envelope(response, 202)["data"]
    detail = wait_terminal(client, data["job_id"])
    assert detail["source_kind"] == "editor"
    assert detail["example_id"] == "spmd"  # trazabilidad
    assert detail["source_code"] == edited  # se ejecuta EL CÓDIGO editado
    assert detail["filename"] == real_content.example("spmd").filename
    # el parser del ejemplo se conserva si el stdout sigue casando
    assert detail["parsed_timings"]["parser_id"] == "sweep_pi"


def test_ninguna_fuente_400(client):
    response = client.post("/api/v1/jobs", json={})
    assert_error_envelope(response, 400, "VALIDATION_ERROR")


def test_example_inexistente_404(client):
    response = client.post("/api/v1/jobs", json={"example_id": "no-existe"})
    assert_error_envelope(response, 404, "EXAMPLE_NOT_FOUND")


def test_example_deshabilitado_409(client):
    response = client.post("/api/v1/jobs", json={"example_id": "sumaVectoresGPU"})
    assert_error_envelope(response, 409, "EXAMPLE_DISABLED")


def test_lesson_id_inexistente_404(client):
    response = client.post(
        "/api/v1/jobs", json={"code": "print(1)\n", "lesson_id": "no-existe"}
    )
    assert_error_envelope(response, 404, "LESSON_NOT_FOUND")


def test_body_no_json_422(client):
    response = client.post(
        "/api/v1/jobs", content=b"no soy json",
        headers={"content-type": "application/json"},
    )
    assert_error_envelope(response, 422, "VALIDATION_ERROR")


def test_code_supera_262144_413(client):
    response = client.post("/api/v1/jobs", json={"code": "x" * 262_145})
    assert_error_envelope(response, 413, "CODE_TOO_LARGE")


def test_code_supera_max_code_bytes_configurado(
    settings, fake_docker, real_content
):
    from fastapi.testclient import TestClient

    from conftest import build_app

    small = settings.model_copy(update={"max_code_bytes": 64})
    app = build_app(settings=small, docker=fake_docker, content=real_content)
    with TestClient(app) as client:
        response = client.post("/api/v1/jobs", json={"code": "x" * 100})
        assert_error_envelope(response, 413, "CODE_TOO_LARGE")


def test_filename_invalido_422(client):
    for bad in ("sin_extension", "malo.txt", 'com"illas.py', "con espacio.py",
                "x" * 81 + ".py"):
        response = client.post(
            "/api/v1/jobs", json={"code": "print(1)\n", "filename": bad}
        )
        assert_error_envelope(response, 422, "VALIDATION_ERROR")


# ─────────────────────────── threads §7.1 ────────────────────────────────────


def test_threads_default_4(client, fake_docker):
    fake_docker.queue_execution(FakeExecution(stdout=[b"ok\n"]))
    response = client.post("/api/v1/jobs", json={"code": "print(1)\n"})
    data = assert_ok_envelope(response, 202)["data"]
    assert data["threads_effective"] == min(4, MAX_THREADS)
    assert data["threads_note"] is None
    wait_terminal(client, data["job_id"])


def test_threads_fuera_de_rango_422(client):
    response = client.post(
        "/api/v1/jobs", json={"code": "print(1)\n", "threads": MAX_THREADS + 1}
    )
    assert_error_envelope(response, 422, "VALIDATION_ERROR")
    response = client.post(
        "/api/v1/jobs", json={"code": "print(1)\n", "threads": 0}
    )
    assert_error_envelope(response, 422, "VALIDATION_ERROR")


def test_threads_ignorado_en_sweep(client, fake_docker):
    """spmd barre 1/2/4/8 internamente: threads se IGNORA por completo."""
    fake_docker.queue_execution(FakeExecution(stdout=[b"ok\n"]))
    response = client.post(
        "/api/v1/jobs", json={"example_id": "spmd", "threads": 1}
    )
    data = assert_ok_envelope(response, 202)["data"]
    assert data["threads_effective"] == MAX_THREADS  # min(8, cores)
    assert data["threads_note"] is not None
    job_id = data["job_id"]
    wait_terminal(client, job_id)
    # el docker service recibió las CPUs efectivas, no el slider
    run_call = next(c for c in fake_docker.run_calls if c["job_id"] == job_id)
    assert run_call["threads"] == MAX_THREADS


def test_threads_ignorado_en_fixed(client, fake_docker, real_content):
    """monteCarloPi fija 4 hilos por código (fixed_threads=4)."""
    fixed = real_content.example("monteCarloPi").fixed_threads
    assert fixed == 4  # invariante de los fixtures WP4
    fake_docker.queue_execution(FakeExecution(stdout=[b"ok\n"]))
    response = client.post(
        "/api/v1/jobs", json={"example_id": "monteCarloPi", "threads": 8}
    )
    data = assert_ok_envelope(response, 202)["data"]
    assert data["threads_effective"] == min(fixed, MAX_THREADS)
    assert data["threads_note"] is not None
    wait_terminal(client, data["job_id"])


# ─────────────────────────── timeout §7.4 ────────────────────────────────────


def test_timeout_minimo_siempre_422(client):
    """El MÍNIMO (5 s) se valida SIEMPRE, con o sin tope configurado."""
    response = client.post(
        "/api/v1/jobs", json={"code": "print(1)\n", "timeout_s": 4}
    )
    assert_error_envelope(response, 422, "VALIDATION_ERROR")


def test_timeout_supera_tope_configurado_422(client):
    """El MÁXIMO es opcional: solo aplica si ``max_timeout_s > 0``.

    La fixture ``settings`` fija ``max_timeout_s=120`` a propósito (despliegue
    CON tope), así que 121 sigue dando 422 — pero ahora lo rechaza el router
    contra la config, no un ``le=120`` hardcodeado en el DTO.
    """
    response = client.post(
        "/api/v1/jobs", json={"code": "print(1)\n", "timeout_s": 121}
    )
    body = assert_error_envelope(response, 422, "VALIDATION_ERROR")
    assert "120" in body["error"]["message"]


def _build_client(settings, max_timeout_s: int):
    """TestClient con un ``max_timeout_s`` distinto al de la fixture."""
    from fastapi.testclient import TestClient

    from conftest import build_app
    from fakes.fake_docker import FakeDockerService

    app = build_app(
        settings=settings.model_copy(update={"max_timeout_s": max_timeout_s}),
        docker=FakeDockerService(),
    )
    return TestClient(app)


def test_timeout_tope_configurable_no_solo_120(settings):
    """Con ``TELAR_MAX_TIMEOUT_S=30`` el tope es 30, no el viejo 120 fijo."""
    with _build_client(settings, 30) as client:
        response = client.post(
            "/api/v1/jobs", json={"code": "print(1)\n", "timeout_s": 60}
        )
        body = assert_error_envelope(response, 422, "VALIDATION_ERROR")
        assert "30" in body["error"]["message"]


def test_timeout_sin_tope_acepta_lo_que_el_tope_rechazaba(settings, real_content):
    """``TELAR_MAX_TIMEOUT_S=0`` ⇒ SIN LÍMITE: el mismo valor que con tope 30
    daba 422 ahora se acepta. Es el centinela del refactor."""
    with _build_client(settings, 0) as client:
        response = client.post(
            "/api/v1/jobs", json={"code": "print(1)\n", "timeout_s": 60}
        )
        data = assert_ok_envelope(response, 202)["data"]
        detail = wait_terminal(client, data["job_id"])
        assert detail["timeout_s"] == 60


def test_timeout_sin_tope_sigue_exigiendo_el_minimo(settings):
    """Sin límite superior, pero el mínimo de 5 s no se negocia."""
    with _build_client(settings, 0) as client:
        response = client.post(
            "/api/v1/jobs", json={"code": "print(1)\n", "timeout_s": 4}
        )
        assert_error_envelope(response, 422, "VALIDATION_ERROR")


def test_dto_job_create_sin_cap_estatico_de_timeout():
    """CONTRATO: ``JobCreateRequest.timeout_s`` ya no lleva ``le=120``, y con
    el centinela de «sin timeout» tampoco ``ge=5``: ahora es ``ge=0``.

    El tope dejó de vivir en el DTO (era estático) y pasó a runtime; la regla
    «0 (sin timeout) o >= 5» la aplica el router, porque depende de
    ``settings.max_timeout_s``. El DTO solo descarta los negativos.
    """
    import pydantic

    from app.schemas import JobCreateRequest

    assert JobCreateRequest(code="print(1)\n", timeout_s=36000).timeout_s == 36000
    assert JobCreateRequest(code="print(1)\n", timeout_s=0).timeout_s == 0  # sin timeout
    # 4 ya NO lo rechaza el DTO (lo hace el router con un 422 del contrato).
    assert JobCreateRequest(code="print(1)\n", timeout_s=4).timeout_s == 4
    with pytest.raises(pydantic.ValidationError):
        JobCreateRequest(code="print(1)\n", timeout_s=-1)


def test_timeout_cuatro_lo_rechaza_el_router_422(client):
    """El mínimo sigue vigente aunque el DTO ya no lo imponga."""
    response = client.post("/api/v1/jobs", json={"code": "print(1)\n", "timeout_s": 4})
    assert_error_envelope(response, 422, "VALIDATION_ERROR")


def test_sin_timeout_rechazado_si_hay_tope_configurado(client):
    """Con ``max_timeout_s = 120`` (fixture), pedir 0 es contradictorio → 422."""
    response = client.post("/api/v1/jobs", json={"code": "print(1)\n", "timeout_s": 0})
    body = assert_error_envelope(response, 422, "VALIDATION_ERROR")
    assert "sin timeout" in body["error"]["message"]


def test_sin_timeout_aceptado_si_no_hay_tope(settings, fake_docker):
    """Sin tope (``max_timeout_s = 0``), ``timeout_s = 0`` crea el job y se
    persiste como 0 = espera indefinida."""
    with _build_client(settings, 0) as client:
        fake_docker_local = client.app.state.docker_service
        fake_docker_local.queue_execution(FakeExecution(stdout=[b"ok\n"]))
        response = client.post("/api/v1/jobs", json={"code": "print(1)\n", "timeout_s": 0})
        data = assert_ok_envelope(response, 202)["data"]
        detail = wait_terminal(client, data["job_id"])
        assert detail["timeout_s"] == 0
        assert detail["status"] == "completed"
        assert detail["error_detail"] is None


def test_timeout_default_del_ejemplo(client, fake_docker, real_content):
    fake_docker.queue_execution(FakeExecution(stdout=[b"ok\n"]))
    response = client.post("/api/v1/jobs", json={"example_id": "primerEjemplo"})
    data = assert_ok_envelope(response, 202)["data"]
    detail = wait_terminal(client, data["job_id"])
    assert detail["timeout_s"] == real_content.example("primerEjemplo").default_timeout_s


# ────────── BL-32: threads_note con el valor YA clampado (auditoría) ─────────


def test_bl32_threads_note_cita_el_valor_clampado(client, app, fake_docker, monkeypatch):
    """Con fixed_threads > max_threads, la nota por defecto debe citar los
    hilos/CPUs EFECTIVOS (post-clamp), no los del fixture."""
    from types import SimpleNamespace

    from app.routers import jobs as jobs_router

    monkeypatch.setattr(jobs_router, "_max_threads", lambda: 2)
    fixed_example = SimpleNamespace(
        enabled=True, threads_configurable=False, sweeps_threads=False,
        fixed_threads=4, fixed_threads_note=None, parser_id="none",
        source_code="print('fijo')\n", filename="fijo.py", default_timeout_s=30,
    )

    class StubContent:
        def example(self, example_id):
            return fixed_example if example_id == "fijoAlto" else None

        def exists_lesson(self, lesson_id):
            return False

    app.state.content = StubContent()
    fake_docker.queue_execution(FakeExecution(stdout=[b"ok\n"]))
    response = client.post("/api/v1/jobs", json={"example_id": "fijoAlto"})
    data = assert_ok_envelope(response, 202)["data"]
    assert data["threads_effective"] == 2
    assert "fija 2 hilos" in data["threads_note"]
    assert "2 CPUs" in data["threads_note"]
    assert "4" not in data["threads_note"]


# ─────────────────── capacidad e infraestructura §7.1 ────────────────────────


def test_cola_llena_429(client, app):
    runner = app.state.job_runner
    for i in range(10):
        runner.registry[f"fantasma-{i}"] = JobHandle(
            job_id=f"fantasma-{i}", source_code="", threads=1,
            timeout_s=30, parser_id="none", max_output_bytes=1024,
        )
    response = client.post("/api/v1/jobs", json={"code": "print(1)\n"})
    assert_error_envelope(response, 429, "TOO_MANY_JOBS")
    runner.registry.clear()


async def test_bl08_rafaga_concurrente_respeta_el_tope_de_cola(settings, fake_docker):
    """TOCTOU del tope (auditoría BL-08): N POST concurrentes cerca del límite
    no pueden superar los 10 en cola — la reserva del slot es atómica respecto
    al chequeo (antes de cualquier await) y se revierte si la petición falla."""
    import asyncio
    import time

    import httpx

    from conftest import build_app

    def slow_ping() -> bool:
        time.sleep(0.1)  # corre en to_thread: mantiene N peticiones en vuelo
        return True

    fake_docker.ping = slow_ping
    application = build_app(settings=settings, docker=fake_docker)
    async with application.router.lifespan_context(application):
        transport = httpx.ASGITransport(app=application)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://test"
        ) as async_client:
            responses = await asyncio.gather(*[
                async_client.post("/api/v1/jobs", json={"code": "print(1)\n"})
                for _ in range(25)
            ])
        codes = [r.status_code for r in responses]
        assert codes.count(202) == 10, codes
        assert codes.count(429) == 15, codes

        # dejar terminar los 10 jobs antes de cerrar la DB del lifespan
        runner = application.state.job_runner

        async def _drained():
            while runner.registry:
                await asyncio.sleep(0.02)

        await asyncio.wait_for(_drained(), 15)


async def test_bl08_la_reserva_se_libera_si_la_peticion_falla(settings, fake_docker):
    """Un 503 posterior a la reserva no puede dejar el slot ocupado."""
    import httpx

    from conftest import build_app

    fake_docker.ping_ok = False
    application = build_app(settings=settings, docker=fake_docker)
    async with application.router.lifespan_context(application):
        transport = httpx.ASGITransport(app=application)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://test"
        ) as async_client:
            for _ in range(12):  # más intentos que el tope de 10
                response = await async_client.post(
                    "/api/v1/jobs", json={"code": "print(1)\n"}
                )
                assert response.status_code == 503  # jamás degenera en 429
            fake_docker.ping_ok = True
            fake_docker.queue_execution(FakeExecution(stdout=[b"ok\n"]))
            response = await async_client.post(
                "/api/v1/jobs", json={"code": "print(1)\n"}
            )
            assert response.status_code == 202  # la cola quedó libre

        runner = application.state.job_runner
        import asyncio

        async def _drained():
            while runner.registry:
                await asyncio.sleep(0.02)

        await asyncio.wait_for(_drained(), 15)


def test_docker_no_disponible_503(client, fake_docker):
    fake_docker.ping_ok = False
    response = client.post("/api/v1/jobs", json={"code": "print(1)\n"})
    assert_error_envelope(response, 503, "DOCKER_UNAVAILABLE")


def test_imagen_runner_ausente_503(client, fake_docker):
    fake_docker.image_ok = False
    response = client.post("/api/v1/jobs", json={"code": "print(1)\n"})
    assert_error_envelope(response, 503, "RUNNER_IMAGE_MISSING")


# ───────────────────────── POST /jobs/upload §7.2 ────────────────────────────


def upload(client, filename: str, content: bytes = b"print('up')\n", **form):
    return client.post(
        "/api/v1/jobs/upload",
        files={"file": (filename, content, "text/x-python")},
        data=form,
    )


def test_upload_happy_path(client, fake_docker):
    fake_docker.queue_execution(FakeExecution(stdout=[b"ok\n"]))
    response = upload(client, "mi_experimento.py", threads="2")
    data = assert_ok_envelope(response, 202)["data"]
    detail = wait_terminal(client, data["job_id"])
    assert detail["source_kind"] == "upload"
    assert detail["filename"] == "mi_experimento.py"
    assert detail["source_code"] == "print('up')\n"
    assert detail["threads"] == 2


def test_upload_filename_estricto_415(client):
    """MISMO patrón de 7.1: rechaza comillas, espacios, no-.py y >80 chars."""
    for bad in ("script.txt", "sin_extension", 'mal"icia.py', "con espacio.py",
                "acento_á.py", "x" * 81 + ".py", ".py"[1:]):
        response = upload(client, bad)
        assert_error_envelope(response, 415, "INVALID_EXTENSION")


def test_upload_filename_80_chars_valido(client, fake_docker):
    fake_docker.queue_execution(FakeExecution(stdout=[b"ok\n"]))
    filename = "x" * 80 + ".py"
    response = upload(client, filename)
    data = assert_ok_envelope(response, 202)["data"]
    wait_terminal(client, data["job_id"])


def test_upload_demasiado_grande_413(
    settings, fake_docker, real_content
):
    from fastapi.testclient import TestClient

    from conftest import build_app

    small = settings.model_copy(update={"max_code_bytes": 1024})
    app = build_app(settings=small, docker=fake_docker, content=real_content)
    with TestClient(app) as client:
        response = upload(client, "grande.py", b"x" * 2048)
        assert_error_envelope(response, 413, "CODE_TOO_LARGE")


def test_upload_no_utf8_422(client):
    response = upload(client, "binario.py", b"\xff\xfe\x00\x01")
    assert_error_envelope(response, 422, "INVALID_ENCODING")


def test_upload_vacio_422(client):
    response = upload(client, "vacio.py", b"")
    assert_error_envelope(response, 422, "VALIDATION_ERROR")


def test_upload_lesson_id_invalido_404(client):
    response = upload(client, "ok.py", lesson_id="no-existe")
    assert_error_envelope(response, 404, "LESSON_NOT_FOUND")


# ────────────────────────── GET /jobs §7.3 ───────────────────────────────────


def seed_jobs(client, fake_docker, n: int = 3) -> list[str]:
    ids = []
    for i in range(n):
        fake_docker.queue_execution(FakeExecution(stdout=[f"job {i}\n".encode()]))
        response = client.post("/api/v1/jobs", json={"code": f"print({i})\n"})
        ids.append(response.json()["data"]["job_id"])
    for job_id in ids:
        wait_terminal(client, job_id)
    return ids


def test_list_jobs_meta_y_shape_resumido(client, fake_docker):
    ids = seed_jobs(client, fake_docker, 3)
    response = client.get("/api/v1/jobs", params={"limit": 2})
    body = assert_ok_envelope(response)
    assert body["meta"] == {"total": 3, "limit": 2, "offset": 0}
    jobs = body["data"]["jobs"]
    assert len(jobs) == 2
    summary = jobs[0]
    # shape resumido: sin código ni stdout (§7.3)
    assert "source_code" not in summary and "stdout" not in summary
    assert set(summary) == {
        "job_id", "filename", "source_kind", "example_id", "lesson_id",
        "status", "exit_code", "threads", "wall_time_ms", "created_at",
        "finished_at",
    }
    assert summary["status"] == "completed"
    # offset
    response = client.get("/api/v1/jobs", params={"limit": 2, "offset": 2})
    assert len(response.json()["data"]["jobs"]) == 1
    assert set(ids) == {
        j["job_id"]
        for j in client.get("/api/v1/jobs").json()["data"]["jobs"]
    }


def test_list_jobs_filtro_status(client, fake_docker):
    seed_jobs(client, fake_docker, 2)
    response = client.get("/api/v1/jobs", params={"status": "completed"})
    assert response.json()["meta"]["total"] == 2
    response = client.get("/api/v1/jobs", params={"status": "failed"})
    assert response.json()["meta"]["total"] == 0


def test_list_jobs_query_invalida_422(client):
    assert_error_envelope(
        client.get("/api/v1/jobs", params={"status": "raro"}),
        422, "VALIDATION_ERROR",
    )
    assert_error_envelope(
        client.get("/api/v1/jobs", params={"limit": 101}),
        422, "VALIDATION_ERROR",
    )
    assert_error_envelope(
        client.get("/api/v1/jobs", params={"limit": 0}),
        422, "VALIDATION_ERROR",
    )


# ──────────────────────── GET /jobs/{id} §7.4 ────────────────────────────────


def test_get_job_404(client):
    assert_error_envelope(
        client.get("/api/v1/jobs/no-existe"), 404, "JOB_NOT_FOUND"
    )


def test_get_job_no_terminal_oculta_resultados(client, fake_docker):
    execution = fake_docker.queue_execution(
        FakeExecution(stdout=[b"en vivo\n"], hang=True)
    )
    response = client.post("/api/v1/jobs", json={"code": "print(1)\n"})
    job_id = response.json()["data"]["job_id"]
    data = client.get(f"/api/v1/jobs/{job_id}").json()["data"]
    assert data["status"] in {"queued", "creating", "compiling", "running"}
    # mientras no es terminal: el vivo va por WS (§7.4)
    assert data["stdout"] is None and data["stderr"] is None
    assert data["metrics_summary"] is None and data["parsed_timings"] is None
    execution.finish(exit_code=0)
    detail = wait_terminal(client, job_id)
    assert detail["stdout"] == "en vivo\n"


def test_get_job_terminal_shape_completo(client, fake_docker):
    from fakes.fake_docker import first_stats_sample, stats_sample

    fake_docker.queue_execution(FakeExecution(
        stdout=[b"resultado\n"],
        stats=[first_stats_sample(), stats_sample()],
    ))
    response = client.post("/api/v1/jobs", json={"code": "print(1)\n"})
    detail = wait_terminal(client, response.json()["data"]["job_id"])
    assert set(detail) == {
        "job_id", "filename", "source_kind", "example_id", "lesson_id",
        "source_code", "status", "exit_code", "oom_killed", "error_detail",
        "threads", "timeout_s", "created_at", "started_at", "finished_at",
        "wall_time_ms", "stdout", "stderr", "output_truncated",
        "metrics_summary", "parsed_timings",
    }
    assert detail["exit_code"] == 0
    assert detail["metrics_summary"]["samples"] == 1
    assert detail["metrics_summary"]["cpu_percent_max"] == 800.0


# ─────────────────────── POST /jobs/{id}/cancel §7.5 ─────────────────────────


def test_cancel_rest_404(client):
    assert_error_envelope(
        client.post("/api/v1/jobs/no-existe/cancel"), 404, "JOB_NOT_FOUND"
    )


def test_cancel_rest_en_vivo_202(client, fake_docker):
    fake_docker.queue_execution(FakeExecution(stdout=[b"x\n"], hang=True))
    response = client.post("/api/v1/jobs", json={"code": "print(1)\n"})
    job_id = response.json()["data"]["job_id"]
    cancel = client.post(f"/api/v1/jobs/{job_id}/cancel")
    body = assert_ok_envelope(cancel, 202)
    assert body["data"] == {"job_id": job_id, "status": "cancelling"}
    detail = wait_terminal(client, job_id)
    assert detail["status"] == "cancelled"


def test_cancel_rest_terminal_409(client, fake_docker, app):
    fake_docker.queue_execution(FakeExecution(stdout=[b"x\n"]))
    response = client.post("/api/v1/jobs", json={"code": "print(1)\n"})
    job_id = response.json()["data"]["job_id"]
    wait_terminal(client, job_id)
    wait_registry_empty(app, job_id)
    assert_error_envelope(
        client.post(f"/api/v1/jobs/{job_id}/cancel"), 409, "JOB_NOT_CANCELLABLE"
    )


# ──────────────────── GET /jobs/{id}/output §7.6 ─────────────────────────────


def make_finished_job(client, fake_docker, **execution_kwargs) -> str:
    fake_docker.queue_execution(FakeExecution(**execution_kwargs))
    response = client.post("/api/v1/jobs", json={"code": "print(1)\n",
                                                 "filename": "salida.py"})
    job_id = response.json()["data"]["job_id"]
    wait_terminal(client, job_id)
    return job_id


def test_output_combined_stdout_stderr(client, fake_docker):
    job_id = make_finished_job(
        client, fake_docker, stdout=[b"linea out\n"], stderr=[b"linea err\n"],
        exit_code=1,
    )
    combined = client.get(f"/api/v1/jobs/{job_id}/output")
    assert combined.status_code == 200
    assert combined.headers["content-type"].startswith("text/plain")
    disposition = combined.headers["content-disposition"]
    assert disposition == f'attachment; filename="salida-{job_id[:8]}.txt"'
    assert "linea out" in combined.text and "linea err" in combined.text

    only_out = client.get(f"/api/v1/jobs/{job_id}/output",
                          params={"stream": "stdout"})
    assert only_out.text == "linea out\n"
    only_err = client.get(f"/api/v1/jobs/{job_id}/output",
                          params={"stream": "stderr"})
    assert only_err.text == "linea err\n"


def test_output_stream_invalido_422(client, fake_docker):
    job_id = make_finished_job(client, fake_docker, stdout=[b"x\n"])
    assert_error_envelope(
        client.get(f"/api/v1/jobs/{job_id}/output", params={"stream": "raro"}),
        422, "VALIDATION_ERROR",
    )


def test_output_404_y_no_terminado_409(client, fake_docker):
    assert_error_envelope(
        client.get("/api/v1/jobs/no-existe/output"), 404, "JOB_NOT_FOUND"
    )
    execution = fake_docker.queue_execution(FakeExecution(hang=True))
    response = client.post("/api/v1/jobs", json={"code": "print(1)\n"})
    job_id = response.json()["data"]["job_id"]
    body = assert_error_envelope(
        client.get(f"/api/v1/jobs/{job_id}/output"), 409, "JOB_NOT_FINISHED"
    )
    assert body["error"]["message"] == "El job aún no ha terminado"
    execution.finish(exit_code=0)
    wait_terminal(client, job_id)


def test_output_truncado_anade_marca(settings, fake_docker, real_content):
    from fastapi.testclient import TestClient

    from conftest import build_app

    small = settings.model_copy(update={"max_output_bytes": 128})
    app = build_app(settings=small, docker=fake_docker, content=real_content)
    fake_docker.queue_execution(FakeExecution(
        stdout=[b"z" * 64 + b"\n"], hang=True, repeat_last=True,
    ))
    with TestClient(app) as client:
        response = client.post("/api/v1/jobs", json={"code": "print(1)\n"})
        job_id = response.json()["data"]["job_id"]
        detail = wait_terminal(client, job_id)
        assert detail["output_truncated"] is True
        output = client.get(f"/api/v1/jobs/{job_id}/output")
        assert output.text.endswith(
            "--- [Telar] output truncado a 128 bytes ---\n"
        )


# ───────────────────────── salud y sistema §2 ────────────────────────────────


def test_health_sin_envelope_y_liveness(client, fake_docker):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok", "checks": {"db": True, "docker": True, "runner_image": True}
    }
    # liveness ≠ readiness: docker caído NO tumba /health (checks informativos)
    fake_docker.ping_ok = False
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["checks"]["docker"] is False


def test_system_contrato_completo(client, settings):
    body = assert_ok_envelope(client.get("/api/v1/system"))
    data = body["data"]
    cores = os.cpu_count() or 1
    assert data["cores"] == cores
    assert data["max_threads"] == min(8, cores)
    assert data["runner_image"] == settings.runner_image
    assert data["runner_image_present"] is True
    assert data["gpu_examples_enabled"] is False  # sumaVectoresGPU disabled
    assert data["versions"]["api"] == "v1"
    assert data["versions"]["pyomp"] == "0.5.1"  # tag de la imagen
    assert data["limits"] == {
        "max_code_bytes": 262144,
        "max_timeout_s": 120,
        "max_concurrent_jobs": 2,
        "max_output_bytes": 262144,
    }


def test_system_docker_caido_503(client, fake_docker):
    fake_docker.ping_ok = False
    assert_error_envelope(
        client.get("/api/v1/system"), 503, "DOCKER_UNAVAILABLE"
    )


def test_system_imagen_ausente_sirve_igual(client, fake_docker):
    fake_docker.image_ok = False
    data = assert_ok_envelope(client.get("/api/v1/system"))["data"]
    assert data["runner_image_present"] is False


# ─────────────────────── envelope en errores HTTP crudos ─────────────────────


def test_ruta_inexistente_tambien_lleva_envelope(client):
    response = client.get("/api/v1/no-existe")
    assert response.status_code == 404
    body = response.json()
    assert body["success"] is False and body["error"]["code"] == "NOT_FOUND"


def test_metodo_no_permitido_envelope(client):
    response = client.delete("/api/v1/system")
    assert response.status_code == 405
    assert response.json()["error"]["code"] == "METHOD_NOT_ALLOWED"
