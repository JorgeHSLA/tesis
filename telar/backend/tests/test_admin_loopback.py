"""El modo autoría solo responde a la propia máquina (``app/loopback_guard.py``).

Sin login, la autoría se apoyaba en el loopback. Eso no protege de una página web
que el administrador abra en su navegador: con ``Origin: null`` (iframe sandbox)
o con un dominio que resuelve a 127.0.0.1 (DNS rebinding) podía llamar a
``/api/v1/admin/*`` —incluido publicar en el bucket— con SU credencial. Lo que se
defiende aquí:

* Host que no es loopback → 403 ``HOST_NOT_ALLOWED``;
* Origin ``null`` o ajeno a ``TELAR_ALLOWED_ORIGINS`` → 403 ``ORIGIN_NOT_ALLOWED``;
* la interfaz legítima (localhost / 127.0.0.1 con su origen) y los clientes sin
  ``Origin`` (curl, scripts) siguen funcionando;
* el resto de la API y el modo estudiante no cambian.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.loopback_guard import host_sin_puerto
from app.main import create_app

ADMIN = "/api/v1/admin/modules"
LOCAL = "http://127.0.0.1:8000"


def _cliente(settings, fake_docker, *, admin: bool, base_url: str = LOCAL):
    # Los orígenes de producción (los de la fixture solo traen localhost).
    ajustes = settings.model_copy(
        update={
            "admin_mode": admin,
            "allowed_origins": Settings.model_fields["allowed_origins"].default,
        }
    )
    return TestClient(create_app(settings=ajustes, docker_service=fake_docker), base_url=base_url)


@pytest.fixture
def admin(settings, fake_docker):
    with _cliente(settings, fake_docker, admin=True) as cliente:
        yield cliente


def _codigo(respuesta) -> str:
    return respuesta.json()["error"]["code"]


# ───────────────────────────── lo que sigue pasando ─────────────────────────


def test_sin_origin_pasa(admin):
    """curl o un script local: no hay navegador de por medio."""
    assert admin.get(ADMIN).status_code == 200


@pytest.mark.parametrize(
    "origen", ["http://localhost:5173", "http://127.0.0.1:5173", "http://127.0.0.1:8080"]
)
def test_la_interfaz_de_autoria_pasa(admin, origen):
    assert admin.get(ADMIN, headers={"Origin": origen}).status_code == 200


@pytest.mark.parametrize("host", ["localhost:8000", "127.0.0.1", "[::1]:8000", "[::1]"])
def test_hosts_de_loopback_pasan(admin, host):
    # Por cabecera: el cliente de pruebas no sabe armar una URL con IPv6.
    assert admin.get(ADMIN, headers={"Host": host}).status_code == 200


# ─────────────────────────────── lo que se corta ────────────────────────────


@pytest.mark.parametrize("metodo", ["get", "post", "delete"])
def test_origin_null_se_rechaza(admin, metodo):
    """El caso del iframe sandbox: antes llegaba a publicar."""
    respuesta = getattr(admin, metodo)(ADMIN, headers={"Origin": "null"})
    assert respuesta.status_code == 403
    assert _codigo(respuesta) == "ORIGIN_NOT_ALLOWED"


def test_origin_ajeno_se_rechaza(admin):
    respuesta = admin.get(ADMIN, headers={"Origin": "https://sitio-ajeno.example"})
    assert respuesta.status_code == 403
    assert _codigo(respuesta) == "ORIGIN_NOT_ALLOWED"


def test_el_publicar_tampoco_desde_un_origin_ajeno(admin):
    respuesta = admin.post(
        "/api/v1/admin/modules/m1/publish",
        json={"dry_run": True},
        headers={"Origin": "null"},
    )
    assert respuesta.status_code == 403


@pytest.mark.parametrize("host", ["sitio-ajeno.example", "sitio-ajeno.example:8000", "192.168.1.20"])
def test_dns_rebinding_host_ajeno_se_rechaza(settings, fake_docker, host):
    """Un dominio ajeno que resuelve a 127.0.0.1 llega con SU nombre en Host."""
    with _cliente(settings, fake_docker, admin=True, base_url=f"http://{host}") as cliente:
        respuesta = cliente.get(ADMIN)
    assert respuesta.status_code == 403
    assert _codigo(respuesta) == "HOST_NOT_ALLOWED"


def test_el_preflight_lo_responde_cors_y_la_peticion_real_se_rechaza(admin):
    preflight = admin.options(
        ADMIN,
        headers={"Origin": "null", "Access-Control-Request-Method": "POST"},
    )
    assert preflight.status_code == 200
    real = admin.post(ADMIN, json={}, headers={"Origin": "null"})
    assert real.status_code == 403


def test_el_rechazo_lleva_las_cabeceras_cors_de_la_interfaz(admin):
    """La interfaz legítima puede leer el motivo del 403 (CORS envuelve al filtro)."""
    respuesta = admin.get(ADMIN, headers={"Origin": "https://sitio-ajeno.example"})
    assert respuesta.status_code == 403
    assert respuesta.json()["success"] is False


# ─────────────────────────────── lo que no cambia ───────────────────────────


def test_el_resto_de_la_api_no_se_ve_afectada(admin):
    assert admin.get("/api/v1/modules", headers={"Origin": "null"}).status_code == 200
    assert admin.get("/health", headers={"Origin": "null"}).status_code == 200


def test_en_modo_estudiante_el_filtro_ni_se_instala(settings, fake_docker):
    """Estudiante: ``/admin/*`` sigue respondiendo lo de siempre (401), no 403."""
    with _cliente(settings, fake_docker, admin=False) as cliente:
        respuesta = cliente.get(ADMIN, headers={"Origin": "null"})
    assert respuesta.status_code in (401, 404)
    assert _codigo(respuesta) != "ORIGIN_NOT_ALLOWED"


# ────────────────────────────── el parseo del Host ──────────────────────────


@pytest.mark.parametrize(
    "valor, esperado",
    [
        ("localhost", "localhost"),
        ("LocalHost:8000", "localhost"),
        ("127.0.0.1:5173", "127.0.0.1"),
        ("[::1]:8000", "::1"),
        ("[::1]", "::1"),
        ("::1", "::1"),
        ("", ""),
    ],
)
def test_host_sin_puerto(valor, esperado):
    assert host_sin_puerto(valor) == esperado
