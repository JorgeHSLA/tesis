"""routers/jobs.py — api-contract.md §7 (fuentes, upload, list/get/cancel/output)."""

from __future__ import annotations

import os
import time

from fastapi.testclient import TestClient

from app.services.job_runner import JobHandle
from fakes import (
    FakeDockerService,
    FakeExecution,
    build_app,
    make_record,
    make_settings,
)

MAX_THREADS = min(8, os.cpu_count() or 1)


def wait_status(repo, job_id, statuses, timeout=5.0):
    """Espera (desde el thread del test) a que el job alcance un estado."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        rec = repo.records.get(job_id)
        if rec is not None and rec.status in statuses:
            return rec
        time.sleep(0.01)
    raise AssertionError(f"{job_id} no alcanzó {statuses}")


# ─────────────────────────── POST /api/v1/jobs ──────────────────────────────


def test_post_solo_example_id():
    app, ctx = build_app()
    with TestClient(app) as client:
        r = client.post("/api/v1/jobs", json={"example_id": "spmd"})
        assert r.status_code == 202
        data = r.json()["data"]
        job_id = data["job_id"]
        assert data["status"] == "queued"
        assert data["threads_effective"] == MAX_THREADS  # sweep ⇒ min(8, cores)
        assert data["threads_note"] is not None
        assert data["ws_url"] == f"/ws/jobs/{job_id}"
        assert data["href"] == f"/api/v1/jobs/{job_id}"
        rec = ctx.repo.records[job_id]
        assert rec.source_kind == "example"
        assert rec.example_id == "spmd"
        assert rec.filename == "piSpmd.py"
        assert rec.source_code == ctx.content.example("spmd").source_code
        assert rec.timeout_s == 60  # default_timeout_s del fixture
        wait_status(ctx.repo, job_id, {"completed"})


def test_post_solo_codigo_editor():
    app, ctx = build_app()
    with TestClient(app) as client:
        r = client.post(
            "/api/v1/jobs",
            json={"code": "print('mio')\n", "threads": 1, "timeout_s": 30},
        )
        assert r.status_code == 202
        data = r.json()["data"]
        assert data["threads_effective"] == 1
        assert data["threads_note"] is None
        rec = ctx.repo.records[data["job_id"]]
        assert rec.source_kind == "editor"
        assert rec.filename == "main.py"
        assert rec.timeout_s == 30
        wait_status(ctx.repo, data["job_id"], {"completed"})


def test_post_example_mas_codigo_identico_y_editado():
    app, ctx = build_app()
    fixture_code = ctx.content.example("sumaVectores").source_code
    with TestClient(app) as client:
        r1 = client.post(
            "/api/v1/jobs",
            json={"example_id": "sumaVectores", "code": fixture_code},
        )
        rec1 = ctx.repo.records[r1.json()["data"]["job_id"]]
        assert rec1.source_kind == "example"  # byte-idéntico al fixture

        r2 = client.post(
            "/api/v1/jobs",
            json={"example_id": "sumaVectores", "code": fixture_code + "# editado\n"},
        )
        rec2 = ctx.repo.records[r2.json()["data"]["job_id"]]
        assert rec2.source_kind == "editor"  # difiere: ejemplo editado
        assert rec2.example_id == "sumaVectores"  # trazabilidad conservada
        assert rec2.filename == "sumaVectores.py"  # filename del ejemplo
        wait_status(ctx.repo, rec1.id, {"completed"})
        wait_status(ctx.repo, rec2.id, {"completed"})


def test_post_threads_ignorado_en_fixed_threads():
    app, ctx = build_app()
    with TestClient(app) as client:
        # threads presente pero el ejemplo NO es configurable: se IGNORA
        r = client.post(
            "/api/v1/jobs", json={"example_id": "monteCarloPi", "threads": 1}
        )
        assert r.status_code == 202
        data = r.json()["data"]
        assert data["threads_effective"] == min(4, MAX_THREADS)
        assert "4 hilos" in data["threads_note"]
        wait_status(ctx.repo, data["job_id"], {"completed"})


def test_post_validaciones_de_negocio():
    app, ctx = build_app()
    with TestClient(app) as client:
        r = client.post("/api/v1/jobs", json={})
        assert r.status_code == 400
        assert r.json()["error"]["code"] == "VALIDATION_ERROR"

        r = client.post("/api/v1/jobs", json={"example_id": "noExiste"})
        assert r.status_code == 404
        assert r.json()["error"]["code"] == "EXAMPLE_NOT_FOUND"

        r = client.post("/api/v1/jobs", json={"example_id": "sumaVectoresGPU"})
        assert r.status_code == 409
        assert r.json()["error"]["code"] == "EXAMPLE_DISABLED"

        r = client.post(
            "/api/v1/jobs", json={"code": "x=1\n", "lesson_id": "noExiste"}
        )
        assert r.status_code == 404
        assert r.json()["error"]["code"] == "LESSON_NOT_FOUND"

        r = client.post("/api/v1/jobs", json={"code": "x" * 262145})
        assert r.status_code == 413
        assert r.json()["error"]["code"] == "CODE_TOO_LARGE"

        r = client.post("/api/v1/jobs", json={"code": "x=1\n", "threads": 99})
        assert r.status_code == 422

        r = client.post("/api/v1/jobs", json={"code": "x=1\n", "timeout_s": 4})
        assert r.status_code == 422

        r = client.post(
            "/api/v1/jobs", json={"code": "x=1\n", "filename": 'mal"nombre.py'}
        )
        assert r.status_code == 422


def test_post_429_cola_llena():
    app, ctx = build_app()
    for i in range(10):  # cola interna llena (10 en queued)
        ctx.runner.registry[f"fake{i}"] = JobHandle(
            job_id=f"fake{i}", source_code="", threads=1, timeout_s=5,
            parser_id="none", max_output_bytes=1,
        )
    with TestClient(app) as client:
        r = client.post("/api/v1/jobs", json={"code": "x=1\n"})
        assert r.status_code == 429
        assert r.json()["error"]["code"] == "TOO_MANY_JOBS"


def test_post_503_infraestructura():
    app, ctx = build_app()
    with TestClient(app) as client:
        ctx.docker.ping_ok = False
        r = client.post("/api/v1/jobs", json={"code": "x=1\n"})
        assert r.status_code == 503
        assert r.json()["error"]["code"] == "DOCKER_UNAVAILABLE"

        ctx.docker.ping_ok = True
        ctx.docker.image_ok = False
        r = client.post("/api/v1/jobs", json={"code": "x=1\n"})
        assert r.status_code == 503
        assert r.json()["error"]["code"] == "RUNNER_IMAGE_MISSING"


# ─────────────────────── POST /api/v1/jobs/upload ────────────────────────────


def test_upload_valido():
    app, ctx = build_app()
    with TestClient(app) as client:
        r = client.post(
            "/api/v1/jobs/upload",
            files={"file": ("mi_experimento.py", b"print('subido')\n")},
            data={"threads": "2", "timeout_s": "30"},
        )
        assert r.status_code == 202
        rec = ctx.repo.records[r.json()["data"]["job_id"]]
        assert rec.source_kind == "upload"
        assert rec.filename == "mi_experimento.py"
        assert rec.source_code == "print('subido')\n"
        wait_status(ctx.repo, rec.id, {"completed"})


def test_upload_filename_estricto():
    app, _ = build_app()
    with TestClient(app) as client:
        for bad in ("evil.txt", "con espacio.py", 'x"y.py', "a/b.py",
                    ("x" * 81) + ".py", ".py"):
            r = client.post(
                "/api/v1/jobs/upload", files={"file": (bad, b"print(1)\n")}
            )
            assert r.status_code == 415, bad
            assert r.json()["error"]["code"] == "INVALID_EXTENSION"


def test_upload_413_por_chunks():
    app, _ = build_app(settings=make_settings(max_code_bytes=1000))
    with TestClient(app) as client:
        r = client.post(
            "/api/v1/jobs/upload", files={"file": ("big.py", b"x" * 2000)}
        )
        assert r.status_code == 413
        assert r.json()["error"]["code"] == "CODE_TOO_LARGE"


def test_upload_utf8_invalido_y_vacio():
    app, _ = build_app()
    with TestClient(app) as client:
        r = client.post(
            "/api/v1/jobs/upload", files={"file": ("bin.py", b"\xff\xfe\x00caf\xe9")}
        )
        assert r.status_code == 422
        assert r.json()["error"]["code"] == "INVALID_ENCODING"

        r = client.post("/api/v1/jobs/upload", files={"file": ("vacio.py", b"")})
        assert r.status_code == 422


# ──────────────────────── GET list / GET detalle ─────────────────────────────


def test_list_jobs_paginado_y_filtro():
    app, ctx = build_app()
    ctx.repo.records["a"] = make_record(
        "a", status="completed", created_at="2026-07-13T00:00:01.000Z"
    )
    ctx.repo.records["b"] = make_record(
        "b", status="failed", created_at="2026-07-13T00:00:02.000Z"
    )
    ctx.repo.records["c"] = make_record(
        "c", status="completed", created_at="2026-07-13T00:00:03.000Z"
    )
    with TestClient(app) as client:
        r = client.get("/api/v1/jobs")
        body = r.json()
        assert r.status_code == 200
        assert [j["job_id"] for j in body["data"]["jobs"]] == ["c", "b", "a"]
        assert body["meta"] == {"total": 3, "limit": 20, "offset": 0}
        assert "source_code" not in body["data"]["jobs"][0]
        assert "stdout" not in body["data"]["jobs"][0]

        r = client.get("/api/v1/jobs", params={"status": "completed", "limit": 1})
        body = r.json()
        assert [j["job_id"] for j in body["data"]["jobs"]] == ["c"]
        assert body["meta"]["total"] == 2

        r = client.get("/api/v1/jobs", params={"status": "inventado"})
        assert r.status_code == 422


def test_get_job_detalle_no_terminal_oculta_resultados():
    app, ctx = build_app()
    ctx.repo.records["r1"] = make_record(
        "r1", status="running", stdout="parcial", metrics_summary={"samples": 1}
    )
    with TestClient(app) as client:
        data = client.get("/api/v1/jobs/r1").json()["data"]
        assert data["status"] == "running"
        assert data["stdout"] is None  # el vivo va por WS (§7.4)
        assert data["metrics_summary"] is None
        assert data["parsed_timings"] is None

        assert client.get("/api/v1/jobs/nope").status_code == 404


def test_get_job_detalle_terminal():
    app, ctx = build_app()
    parsed = {"parser_id": "sweep_pi", "kind": "sweep", "series": [],
              "extra": {}, "correct": None}
    ctx.repo.records["t1"] = make_record(
        "t1", status="completed", exit_code=0, stdout="hola\n", stderr="",
        metrics_summary={"samples": 2}, parsed_timings=parsed,
        wall_time_ms=1234, finished_at="2026-07-13T00:01:00.000Z",
    )
    with TestClient(app) as client:
        data = client.get("/api/v1/jobs/t1").json()["data"]
        assert data["stdout"] == "hola\n"
        assert data["metrics_summary"] == {"samples": 2}
        assert data["parsed_timings"] == parsed
        assert data["wall_time_ms"] == 1234
        assert data["source_code"] == "print('x')\n"


# ─────────────────────────────── cancel ─────────────────────────────────────


def test_cancel_flujo_completo():
    execution = FakeExecution(stdout=[b"trabajando\n"], hang=True)
    docker = FakeDockerService(default_factory=lambda: execution)
    app, ctx = build_app(docker=docker)
    with TestClient(app) as client:
        job_id = client.post(
            "/api/v1/jobs", json={"code": "while True: pass\n"}
        ).json()["data"]["job_id"]

        r = client.post(f"/api/v1/jobs/{job_id}/cancel")
        assert r.status_code == 202
        assert r.json()["data"] == {"job_id": job_id, "status": "cancelling"}
        rec = wait_status(ctx.repo, job_id, {"cancelled"})
        assert rec.error_detail is None

        r = client.post(f"/api/v1/jobs/{job_id}/cancel")  # ya terminal
        assert r.status_code == 409
        assert r.json()["error"]["code"] == "JOB_NOT_CANCELLABLE"

        assert client.post("/api/v1/jobs/nope/cancel").status_code == 404


# ─────────────────────────────── output ─────────────────────────────────────


def test_output_descarga_y_content_disposition():
    app, ctx = build_app()
    ctx.repo.records["o1"] = make_record(
        "o1abcdef12345678", filename="transporteMonteCarlo.py",
        status="completed", stdout="linea out\n", stderr="linea err\n",
    )
    ctx.repo.records["o1abcdef12345678"] = ctx.repo.records.pop("o1")
    with TestClient(app) as client:
        r = client.get("/api/v1/jobs/o1abcdef12345678/output")
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/plain")
        assert (
            r.headers["content-disposition"]
            == 'attachment; filename="transporteMonteCarlo-o1abcdef.txt"'
        )
        assert r.text == "linea out\nlinea err\n"

        r = client.get(
            "/api/v1/jobs/o1abcdef12345678/output", params={"stream": "stdout"}
        )
        assert r.text == "linea out\n"
        r = client.get(
            "/api/v1/jobs/o1abcdef12345678/output", params={"stream": "stderr"}
        )
        assert r.text == "linea err\n"
        r = client.get(
            "/api/v1/jobs/o1abcdef12345678/output", params={"stream": "otro"}
        )
        assert r.status_code == 422


def test_output_truncado_y_errores():
    app, ctx = build_app()
    ctx.repo.records["tr"] = make_record(
        "tr", status="failed", stdout="algo\n", stderr="",
        output_truncated=True, error_detail="output_limit_exceeded",
    )
    ctx.repo.records["vivo"] = make_record("vivo", status="running")
    with TestClient(app) as client:
        r = client.get("/api/v1/jobs/tr/output")
        assert r.text.endswith("--- [E-HPC] output truncado a 262144 bytes ---\n")

        r = client.get("/api/v1/jobs/vivo/output")
        assert r.status_code == 409
        assert r.json()["error"]["code"] == "JOB_NOT_FINISHED"

        assert client.get("/api/v1/jobs/nope/output").status_code == 404
