"""Regresiones del cierre de residuos de la auditoría de lógica de negocio.

Residuos que la campaña S1-S5 dejó abiertos y que esta rama
(``fix/auditoria-residuos``) cierra:

- **BL-22 (medium, security)** — el catch manual de ``ValidationError`` en
  ``POST /jobs`` devolvía ``exc.errors(include_url=False)`` SIN sanear, reflejando
  el valor crudo rechazado (``input``/``ctx``) del cliente. Debe pasar por
  ``errors.sanitize_validation_errors()`` igual que el handler global y ``admin``.
- **BL-17 (low, consistency)** — ``JobCreateRequest.code`` conservaba un
  ``max_length=262144`` estático mientras la vía admin JSON ya lee
  ``settings.max_code_bytes`` en runtime. ``POST /jobs`` debe respetar
  ``EHPC_MAX_CODE_BYTES`` (subir Y bajar), manteniendo el 413 ``CODE_TOO_LARGE``.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from conftest import build_app

from test_routers_jobs import assert_error_envelope, assert_ok_envelope


# ─────────────────────────── BL-22 · saneo del 422 ──────────────────────────


def test_bl22_post_jobs_422_no_refleja_input_crudo(client):
    """El 422 de validación de ``POST /jobs`` NO debe reflejar el valor crudo
    rechazado en ``details[].input`` (paridad con el saneo del handler admin JSON).

    Se envía un ``filename`` inválido con un centinela reconocible: antes del fix
    su valor literal viajaba en ``error.details[].input``; tras el saneo se
    conservan ``type``/``loc``/``msg`` pero desaparecen ``input``/``ctx``/``url``.
    """
    sentinel = "valor-secreto-reflejado.txt"  # no cumple `^[A-Za-z0-9._-]{1,80}\.py$`
    response = client.post(
        "/api/v1/jobs", json={"code": "print(1)\n", "filename": sentinel}
    )
    body = assert_error_envelope(response, 422, "VALIDATION_ERROR")
    # el valor crudo rechazado no viaja en NINGUNA parte del cuerpo
    assert sentinel not in response.text
    details = body["error"]["details"]
    assert details, "el 422 debe conservar details para posicionar el error en la UI"
    for d in details:
        assert "input" not in d and "ctx" not in d and "url" not in d
        # la forma útil se conserva
        assert "loc" in d and "type" in d and "msg" in d


# ─────────────────────────── BL-17 · max_code_bytes ─────────────────────────


def _post_code_app(settings, fake_docker, real_content, *, max_code_bytes: int):
    small = settings.model_copy(update={"max_code_bytes": max_code_bytes})
    return build_app(settings=small, docker=fake_docker, content=real_content)


def test_bl17_jobs_json_honra_max_code_bytes_alto(
    settings, fake_docker, real_content
):
    """Paridad JSON↔runtime: subir ``EHPC_MAX_CODE_BYTES`` por encima de 262144
    permite código > 262144 por ``POST /jobs`` (sin cap estático de pydantic).

    RED contra el código viejo: el ``Field(max_length=262144)`` de
    ``JobCreateRequest.code`` rechaza antes de llegar al check runtime → 413.
    """
    app = _post_code_app(settings, fake_docker, real_content, max_code_bytes=400_000)
    with TestClient(app) as client:
        big_code = "x = 1\n" * 50_000  # ~300 KB, > 262144, < 400000
        assert len(big_code.encode()) > 262144
        response = client.post("/api/v1/jobs", json={"code": big_code})
        assert_ok_envelope(response, 202)


def test_bl17_jobs_json_honra_max_code_bytes_bajo(
    settings, fake_docker, real_content
):
    """Bajar ``EHPC_MAX_CODE_BYTES`` por debajo del tamaño rechaza con
    413 ``CODE_TOO_LARGE`` (no un 422 genérico), por igual que en multipart."""
    app = _post_code_app(settings, fake_docker, real_content, max_code_bytes=64)
    with TestClient(app) as client:
        response = client.post("/api/v1/jobs", json={"code": "print('x')\n" * 50})
        assert_error_envelope(response, 413, "CODE_TOO_LARGE")
