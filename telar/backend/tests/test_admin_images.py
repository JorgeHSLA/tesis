"""Imágenes de las lecciones — subida al bucket y regla de URL en el markdown.

Pedido de las pruebas de usabilidad: «poder cargar imágenes en vez de diagramas
ASCII». El diseño (ver ``services/image_upload``): las imágenes viven en la nube
junto al catálogo, con el hash del contenido como nombre, y la lección solo lleva
el enlace. Lo que se fija aquí, de lo más a lo menos peligroso:

1. **Se valida el CONTENIDO**, no la extensión: un SVG (puede llevar scripts) o un
   texto con extensión ``.png`` no pasan.
2. **El markdown solo acepta imágenes del bucket de Telar.** El contenido viaja
   por el catálogo remoto; sin esta regla una lección podría apuntar a un host
   cualquiera y delatar a quien la lee.
3. **Subir dos veces la misma imagen no duplica** (el nombre es el hash).
4. **Sin credencial no se sube**, igual que no se publica.

Todo con el driver ``http_local``: ningún test toca la red ni GCP.
"""

from __future__ import annotations

import hashlib
import json
import os
import struct
import zlib
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.routers import admin_catalog
from app.services import image_upload
from app.services.image_upload import ImageRejected, inspect_image, object_path_for, public_url
from app.services.markdown_validator import validate

from conftest import build_app

BUCKET = "telar-modulos"


# ─────────────────────── imágenes mínimas pero VÁLIDAS ───────────────────────


def png(ancho: int = 1, alto: int = 1) -> bytes:
    def chunk(tipo: bytes, datos: bytes) -> bytes:
        return struct.pack(">I", len(datos)) + tipo + datos + struct.pack(">I", zlib.crc32(tipo + datos))

    ihdr = struct.pack(">IIBBBBB", ancho, alto, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(b"\x00\x00\x00\x00")) + chunk(b"IEND", b"")


def jpg(ancho: int = 3, alto: int = 2) -> bytes:
    app0 = b"\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    sof0 = b"\xff\xc0\x00\x11\x08" + struct.pack(">HH", alto, ancho) + b"\x03\x01\x22\x00\x02\x11\x01\x03\x11\x01"
    return b"\xff\xd8" + app0 + sof0 + b"\xff\xd9"


def gif(ancho: int = 4, alto: int = 5) -> bytes:
    return b"GIF89a" + struct.pack("<HH", ancho, alto) + b"\x00\x00\x00;"


def webp_vp8x(ancho: int = 6, alto: int = 7) -> bytes:
    cuerpo = b"WEBP" + b"VP8X" + struct.pack("<I", 10) + b"\x00\x00\x00\x00"
    cuerpo += (ancho - 1).to_bytes(3, "little") + (alto - 1).to_bytes(3, "little")
    return b"RIFF" + struct.pack("<I", len(cuerpo)) + cuerpo


# ═══════════════════════ inspect_image: el contenido manda ═══════════════════


@pytest.mark.parametrize(
    "datos, ext, tipo, dims",
    [
        (png(10, 20), "png", "image/png", (10, 20)),
        (jpg(30, 40), "jpg", "image/jpeg", (30, 40)),
        (gif(4, 5), "gif", "image/gif", (4, 5)),
        (webp_vp8x(6, 7), "webp", "image/webp", (6, 7)),
    ],
)
def test_reconoce_los_cuatro_formatos_y_sus_dimensiones(datos, ext, tipo, dims):
    info = inspect_image(datos)
    assert (info.ext, info.content_type, (info.width, info.height)) == (ext, tipo, dims)


def test_un_svg_se_rechaza_porque_puede_llevar_scripts():
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    with pytest.raises(ImageRejected, match="SVG no se permite"):
        inspect_image(svg)


def test_la_extension_no_cuenta_un_texto_no_es_una_imagen():
    with pytest.raises(ImageRejected, match="Formato no admitido"):
        inspect_image(b"esto es solo texto con extension .png")


def test_una_imagen_truncada_se_rechaza():
    with pytest.raises(ImageRejected):
        inspect_image(png()[:12])


def test_vacia():
    with pytest.raises(ImageRejected, match="vacío"):
        inspect_image(b"")


def test_demasiado_pesada():
    pesada = png() + b"\x00" * image_upload.MAX_IMAGE_BYTES
    with pytest.raises(ImageRejected, match="máximo es 2 MB"):
        inspect_image(pesada)


def test_demasiado_grande_en_pixeles():
    with pytest.raises(ImageRejected, match="4096"):
        inspect_image(png(image_upload.MAX_IMAGE_SIDE + 1, 10))


def test_el_nombre_es_el_hash_del_contenido():
    datos = png(2, 2)
    ruta = object_path_for(datos, "png")
    assert ruta == f"imagenes/{hashlib.sha256(datos).hexdigest()[:32]}.png"
    assert object_path_for(datos, "png") == ruta  # determinista
    assert object_path_for(png(3, 3), "png") != ruta


def test_url_publica():
    assert public_url("clasestelar", "imagenes/abc.png") == "https://storage.googleapis.com/clasestelar/imagenes/abc.png"


# ════════════════════ markdown: solo imágenes del bucket de Telar ════════════


HASH = "0123456789abcdef0123456789abcdef"
URL_OK = f"https://storage.googleapis.com/clasestelar/imagenes/{HASH}.png"


def test_markdown_acepta_la_imagen_del_bucket():
    assert validate(f"![Diagrama de la caché]({URL_OK})") == []
    assert validate(f"![]({URL_OK})") == []


@pytest.mark.parametrize(
    "url",
    [
        "https://evil.example/pixel.png",  # host cualquiera: baliza de rastreo
        f"https://storage.googleapis.com/clasestelar/otra-carpeta/{HASH}.png",
        f"https://storage.googleapis.com/clasestelar/imagenes/{HASH}.svg",
        f"https://storage.googleapis.com/clasestelar/imagenes/corto.png",
        f"http://storage.googleapis.com/clasestelar/imagenes/{HASH}.png",  # sin https
        "javascript:alert(1)",
        "data:image/png;base64,AAAA",
        "./local.png",
    ],
)
def test_markdown_rechaza_cualquier_otra_url_de_imagen(url):
    problemas = validate(f"![x]({url})")
    assert problemas, url
    assert "imagen con una URL no permitida" in problemas[0]["reason"]


def test_un_enlace_normal_no_se_confunde_con_una_imagen():
    assert validate("Mira [la guía](https://www.openmp.org/spec-html/5.2/openmp.html).") == []


def test_la_imagen_dentro_de_codigo_en_linea_es_solo_texto():
    assert validate("Se escribe así: `![x](https://evil.example/p.png)`") == []


# ═════════════════════════ endpoint POST /admin/images ═══════════════════════


def escribir_clave(tmp_path: Path, *, modo: int = 0o600) -> Path:
    datos = {
        "type": "service_account",
        "project_id": "reliable-banner-470503-j7",
        "client_email": "publicador@ejemplo.iam.gserviceaccount.com",
        "private_key": "-----BEGIN PRIVATE KEY-----\nfalsa\n-----END PRIVATE KEY-----\n",
    }
    ruta = tmp_path / "clave.json"
    ruta.write_text(json.dumps(datos), encoding="utf-8")
    os.chmod(ruta, modo)
    return ruta


def hacer_settings(tmp_path: Path, *, clave: Path | None, raiz: Path) -> Settings:
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


def app_admin(ajustes: Settings, docker):
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


def subir(c: TestClient, datos: bytes, nombre: str = "captura.png", tipo: str = "image/png"):
    return c.post("/api/v1/admin/images", files={"file": (nombre, datos, tipo)})


def test_sube_la_imagen_y_devuelve_la_url_para_el_markdown(cliente, raiz):
    datos = png(12, 8)
    r = subir(cliente, datos)
    assert r.status_code == 201, r.text
    d = r.json()["data"]
    esperado = object_path_for(datos, "png")
    assert d["object_path"] == esperado
    assert d["url"] == f"https://storage.googleapis.com/{BUCKET}/{esperado}"
    assert (d["width"], d["height"], d["content_type"], d["bytes"]) == (12, 8, "image/png", len(datos))
    # Quedó en el «bucket» con exactamente los mismos bytes.
    assert (raiz / esperado).read_bytes() == datos
    # Y la URL que devuelve es una que el markdown ACEPTA (el ciclo cierra).
    assert validate(f"![captura]({d['url']})") == []


def test_subir_dos_veces_la_misma_imagen_no_duplica_ni_falla(cliente, raiz):
    datos = png(5, 5)
    a = subir(cliente, datos)
    b = subir(cliente, datos, nombre="otro-nombre.png")
    assert a.status_code == b.status_code == 201
    assert a.json()["data"]["url"] == b.json()["data"]["url"]
    assert len(list((raiz / "imagenes").iterdir())) == 1


def test_el_nombre_del_archivo_subido_no_decide_nada(cliente, raiz):
    r = subir(cliente, jpg(9, 9), nombre="../../etc/passwd.png", tipo="image/png")
    assert r.status_code == 201
    d = r.json()["data"]
    assert d["object_path"].endswith(".jpg")  # lo decide el contenido, no el nombre
    assert d["object_path"].startswith("imagenes/")


def test_un_svg_es_422_con_un_mensaje_claro(cliente):
    r = subir(cliente, b'<svg xmlns="http://www.w3.org/2000/svg"/>', "dibujo.svg", "image/svg+xml")
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "INVALID_IMAGE"
    assert "SVG" in r.json()["error"]["message"]


def test_demasiado_pesada_es_413(cliente):
    r = subir(cliente, png() + b"\x00" * (image_upload.MAX_IMAGE_BYTES + 10))
    assert r.status_code == 413
    assert r.json()["error"]["code"] == "INVALID_IMAGE"


def test_sin_credencial_no_se_sube_nada(tmp_path, raiz, fake_docker, real_content):
    ajustes = hacer_settings(tmp_path, clave=None, raiz=raiz)
    with TestClient(app_admin(ajustes, fake_docker)) as c:
        r = subir(c, png())
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "CATALOG_CREDENTIALS_INVALID"
    assert not (raiz / "imagenes").exists()


def test_una_clave_legible_por_otros_tampoco_sirve(tmp_path, raiz, fake_docker, real_content):
    ajustes = hacer_settings(tmp_path, clave=escribir_clave(tmp_path, modo=0o644), raiz=raiz)
    with TestClient(app_admin(ajustes, fake_docker)) as c:
        r = subir(c, png())
    assert r.status_code == 403
    assert not (raiz / "imagenes").exists()
