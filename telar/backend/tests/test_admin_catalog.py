"""§11.8 CU-38 · publicar un módulo — credencial, bundle, avisos y CAS del índice.

Todo con el driver ``http_local``: **ningún test toca la red ni necesita GCP**.
Es la misma apuesta que el resto de la Fase 5 —los dos adaptadores comparten
serialización, checksum, avisos y CAS, y solo difieren en el transporte—, así que
lo que aquí se fija dice algo de producción.

Lo que se comprueba, en orden de lo que puede doler más:

1. **La credencial se rechaza por el motivo correcto**, y el motivo no lleva
   nunca el texto de una excepción ni la ruta del archivo.
2. **Publicar es irreversible**, así que ``dry_run`` tiene que recorrer el mismo
   camino y no escribir nada.
3. **Una versión publicada es inmutable**: republicarla es 409, no un
   sobreescribir silencioso.
4. **El índice queda consistente** y con el `Cache-Control` que hace que el
   estudiante se entere de que hay versión nueva.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.schemas.catalog import CatalogIndex, ModuleBundle
from app.services.catalog_hash import bundle_checksum
from app.services.catalog_publisher import inspeccionar_credencial

from app.routers import admin_catalog

from conftest import build_app

BUCKET = "telar-modulos"


# ─────────────────────────────── utilidades ──────────────────────────────────


def escribir_clave(tmp_path: Path, *, modo: int = 0o600, **extra) -> Path:
    """Clave de cuenta de servicio de mentira, con los permisos que se pidan."""
    datos = {
        "type": "service_account",
        "project_id": "reliable-banner-470503-j7",
        "client_email": "publicador@ejemplo.iam.gserviceaccount.com",
        "private_key": "-----BEGIN PRIVATE KEY-----\nfalsa\n-----END PRIVATE KEY-----\n",
    }
    datos.update(extra)
    ruta = tmp_path / "clave.json"
    ruta.write_text(json.dumps(datos), encoding="utf-8")
    os.chmod(ruta, modo)
    return ruta


def hacer_settings(tmp_path: Path, *, clave: Path | None, raiz: Path) -> Settings:
    """Despliegue admin con bucket y driver local (publica a ficheros)."""
    return Settings(
        db_path=str(tmp_path / "telar.db"),
        jobs_dir=str(tmp_path / "jobs"),
        allowed_origins="http://localhost:5173,null",
        code_delivery="bind",
        runner_image="telar-runner:0.5.1",
        max_timeout_s=120,
        max_concurrent_jobs=2,
        max_code_bytes=262144,
        max_output_bytes=262144,
        admin_mode=True,
        catalog_bucket=BUCKET,
        catalog_driver="http_local",
        catalog_endpoint="http://127.0.0.1:8095",
        catalog_local_root=str(raiz),
        gcs_credentials="" if clave is None else str(clave),
    )


def app_admin(ajustes: Settings, docker) -> "object":
    """`build_app` no monta los routers admin (son opcionales a nivel de
    artefacto, §11.2), así que cada suite admin registra el suyo — misma
    convención que `test_admin_content.py`."""
    app = build_app(settings=ajustes, docker=docker)
    app.include_router(admin_catalog.router)
    return app


@pytest.fixture
def raiz(tmp_path: Path) -> Path:
    destino = tmp_path / "bucket"
    destino.mkdir()
    return destino


@pytest.fixture
def cliente(tmp_path, raiz, fake_docker, real_content):
    ajustes = hacer_settings(tmp_path, clave=escribir_clave(tmp_path), raiz=raiz)
    with TestClient(app_admin(ajustes, fake_docker)) as c:
        yield c


def ok(respuesta, esperado: int = 200) -> dict:
    assert respuesta.status_code == esperado, respuesta.text
    cuerpo = respuesta.json()
    assert cuerpo["success"] is True, cuerpo
    return cuerpo["data"]


def falla(respuesta, esperado: int, code: str) -> dict:
    assert respuesta.status_code == esperado, respuesta.text
    cuerpo = respuesta.json()
    assert cuerpo["success"] is False and cuerpo["error"]["code"] == code, cuerpo
    return cuerpo["error"]


# ═══════════════════ §11.8.1 · la credencial de escritura ════════════════════


def test_sin_clave_la_credencial_es_absent_y_responde_200(
    tmp_path, raiz, fake_docker, real_content
):
    """§11.9 — que falte la clave es un estado normal, no un error del servidor.

    Responder 503 aquí obligaría al diálogo de autoría a tratar «este despliegue
    no publica» como una avería, cuando es la configuración por defecto de
    cualquier equipo de estudiante.
    """
    ajustes = hacer_settings(tmp_path, clave=None, raiz=raiz)
    with TestClient(app_admin(ajustes, fake_docker)) as c:
        data = ok(c.get("/api/v1/admin/catalog/credentials"))
    assert data["configured"] is False
    assert data["usable"] is False
    assert data["reason"] == "absent"
    assert data["client_email"] is None


def test_una_clave_legible_por_otros_no_es_una_credencial(
    tmp_path, raiz, fake_docker, real_content
):
    """§11.8.1 — permisos más laxos que 0600 ⇒ ``insecure_mode``.

    Una clave de cuenta de servicio que puede leer cualquier usuario del sistema
    no es una credencial, es un archivo. Y el motivo tiene que distinguirse de
    ``malformed``: mandan al admin a mirar sitios distintos.
    """
    clave = escribir_clave(tmp_path, modo=0o644)
    ajustes = hacer_settings(tmp_path, clave=clave, raiz=raiz)
    with TestClient(app_admin(ajustes, fake_docker)) as c:
        data = ok(c.get("/api/v1/admin/catalog/credentials"))
    assert data["usable"] is False
    assert data["reason"] == "insecure_mode"
    assert data["file_mode"] == "0644"
    # No se filtra la ruta de la clave por ningún campo de la respuesta.
    assert str(clave) not in json.dumps(data)


def test_una_credencial_de_usuario_no_sirve_para_publicar(tmp_path, raiz):
    """Solo cuenta de SERVICIO (§11.8.1): el OAuth de usuario caduca."""
    clave = escribir_clave(tmp_path, type="authorized_user")
    ajustes = hacer_settings(tmp_path, clave=clave, raiz=raiz)
    assert inspeccionar_credencial(ajustes).reason == "malformed"


def test_la_clave_buena_identifica_a_la_cuenta(cliente):
    """El admin necesita ver QUIÉN publica para saber si es quien cree."""
    data = ok(cliente.get("/api/v1/admin/catalog/credentials"))
    assert data["configured"] is True and data["usable"] is True
    assert data["client_email"] == "publicador@ejemplo.iam.gserviceaccount.com"
    assert data["bucket"] == BUCKET
    assert data["probed"] is False  # sin ?probe no se sale a la red
    assert data["reason"] is None


def test_publicar_sin_credencial_utilizable_es_403(
    tmp_path, raiz, fake_docker, real_content
):
    ajustes = hacer_settings(tmp_path, clave=None, raiz=raiz)
    with TestClient(app_admin(ajustes, fake_docker)) as c:
        error = falla(
            c.post("/api/v1/admin/modules/m1/publish", json={}),
            403,
            "CATALOG_CREDENTIALS_INVALID",
        )
    assert error["details"]["reason"] == "absent"


# ═══════════════════════ §11.8.2 · publicar de verdad ════════════════════════


def test_dry_run_calcula_todo_y_no_escribe_nada(cliente, raiz):
    """Publicar es irreversible, así que el ensayo tiene que ser fiel y estéril.

    Fiel: mismo checksum, mismo object_path, mismos lesson_ids que la
    publicación real. Estéril: ni un fichero en el bucket.
    """
    data = ok(cliente.post("/api/v1/admin/modules/m1/publish", json={"dry_run": True}))

    assert data["published"] is False
    assert data["version"] == 1  # nunca publicado ⇒ la primera es la v1, no la v2
    assert len(data["checksum"]) == 64
    assert data["object_path"] == "modulos/m1/v1.json"
    assert data["lesson_ids"]
    assert data["index_updated"] is False
    assert list(raiz.rglob("*.json")) == []


def test_publicar_sube_el_bundle_y_lo_anuncia_en_el_indice(cliente, raiz):
    """El camino feliz completo, comprobado sobre los BYTES que quedan escritos."""
    data = ok(cliente.post("/api/v1/admin/modules/m1/publish", json={}), 201)

    assert data["published"] is True and data["index_updated"] is True
    bundle_path = raiz / "modulos" / "m1" / "v1.json"
    assert bundle_path.exists()

    # El checksum anunciado es el del bundle REALMENTE escrito. Si esto se
    # rompe, el estudiante recibe 409 CHECKSUM_MISMATCH al instalar.
    bundle = ModuleBundle.model_validate_json(bundle_path.read_bytes())
    assert bundle.checksum == data["checksum"] == bundle_checksum(bundle)
    assert bundle.module.version == 1

    indice = CatalogIndex.model_validate_json(
        (raiz / "modulos" / "index.json").read_bytes()
    )
    entrada = next(e for e in indice.modules if e.id == "m1")
    assert entrada.version == 1
    assert entrada.checksum == bundle.checksum
    assert entrada.object_path == "modulos/m1/v1.json"
    # `size_bytes` del índice es una promesa que el estudiante usa para decidir
    # si descarga: tiene que ser el tamaño real, no una estimación.
    assert entrada.size_bytes == bundle_path.stat().st_size == data["bytes"]


def test_una_version_publicada_es_inmutable(cliente):
    """Republicar la MISMA versión es 409, nunca un sobreescribir en silencio.

    El estudiante ancla la descarga por checksum: reescribir un `v1.json` haría
    que lo ya instalado por otra persona pasara a estar «corrupto».
    """
    ok(cliente.post("/api/v1/admin/modules/m1/publish", json={}), 201)
    error = falla(
        cliente.post("/api/v1/admin/modules/m1/publish", json={"version": 1}),
        409,
        "VERSION_CONFLICT",
    )
    assert error["details"]["published_version"] == 1


def test_la_version_es_monotona_y_la_siguiente_sale_sola(cliente, raiz):
    """Tras publicar la v1, el default es la v2 sin que el admin diga nada."""
    ok(cliente.post("/api/v1/admin/modules/m1/publish", json={}), 201)
    data = ok(cliente.post("/api/v1/admin/modules/m1/publish", json={}), 201)

    assert data["version"] == 2
    assert (raiz / "modulos" / "m1" / "v2.json").exists()
    # Y la v1 SIGUE ahí: las versiones no se reemplazan, se acumulan. Quien
    # instaló la v1 debe poder seguir verificándola.
    assert (raiz / "modulos" / "m1" / "v1.json").exists()

    indice = CatalogIndex.model_validate_json(
        (raiz / "modulos" / "index.json").read_bytes()
    )
    # El índice anuncia UNA versión por módulo: la vigente. Si acumulara, el
    # estudiante vería dos entradas del mismo módulo.
    assert [e.version for e in indice.modules if e.id == "m1"] == [2]


def test_publicar_un_modulo_inexistente_es_404(cliente):
    falla(
        cliente.post("/api/v1/admin/modules/noExiste/publish", json={}),
        404,
        "MODULE_NOT_FOUND",
    )


def test_el_indice_conserva_los_otros_modulos(cliente, raiz):
    """Publicar m2 no puede borrar del índice lo que publicó m1.

    Es el fallo clásico del *read-modify-write*: serializar solo lo propio y
    subirlo encima. Aquí dejaría a los estudiantes sin ver los demás módulos.
    """
    ok(cliente.post("/api/v1/admin/modules/m1/publish", json={}), 201)
    ok(cliente.post("/api/v1/admin/modules/m2/publish", json={}), 201)

    indice = CatalogIndex.model_validate_json(
        (raiz / "modulos" / "index.json").read_bytes()
    )
    assert {e.id for e in indice.modules} == {"m1", "m2"}


def test_el_modo_autoria_apagado_deja_publicar_fuera(
    tmp_path, raiz, fake_docker, real_content
):
    """§10.0 — sin TELAR_ADMIN_MODE, 401. El gate es de despliegue, no de sesión."""
    ajustes = hacer_settings(
        tmp_path, clave=escribir_clave(tmp_path), raiz=raiz
    ).model_copy(update={"admin_mode": False})
    with TestClient(app_admin(ajustes, fake_docker)) as c:
        falla(c.post("/api/v1/admin/modules/m1/publish", json={}), 401, "UNAUTHORIZED")
        falla(c.get("/api/v1/admin/catalog/credentials"), 401, "UNAUTHORIZED")


# ═══════════ el bundle publicado es INSTALABLE por el estudiante ═════════════


@pytest.mark.xfail(
    reason=(
        "BLOQUEANTE CONOCIDO, pendiente de decisión: los 8 módulos del baseline "
        "tienen `examples.id == lessons.id` (backfill de la migración 5) y "
        "`bundle_guard` prohíbe esa colisión porque lecciones y ejemplos "
        "comparten espacio de nombres (§10.6). Consecuencia: NINGÚN módulo del "
        "baseline se puede publicar todavía. No se silencia con un cambio "
        "unilateral porque las tres salidas —renombrar al publicar, migrar los "
        "ids, o relajar el guard— tocan el contenido, el modelo de datos o el "
        "contrato."
    ),
    strict=True,
)
def test_lo_publicado_lo_puede_instalar_el_estudiante(cliente, raiz):
    """La prueba que cierra el círculo: publicar → el bundle pasa el guard.

    Un publicador que produzca algo que el instalador rechaza es un publicador
    roto, y el único modo de saberlo es hacer pasar lo escrito por la misma
    validación que corre en la máquina del estudiante. Este test es el que
    destapó los dos fallos reales del publicador (los bytes subidos sin
    `checksum`, y el CR de un ejemplo editado en Windows) y el bloqueante de ids
    que sigue abierto.
    """
    from app.services.bundle_guard import parse_bundle

    ok(cliente.post("/api/v1/admin/modules/m1/publish", json={}), 201)
    crudo = (raiz / "modulos" / "m1" / "v1.json").read_bytes()

    bundle = parse_bundle(crudo, max_bytes=4_194_304)
    assert bundle.module.id == "m1"
    assert bundle.checksum == bundle_checksum(bundle)
