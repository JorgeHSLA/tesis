"""Imágenes de las lecciones — validación y rutas (solo modo admin).

Las lecciones pueden llevar imágenes (pedido de las pruebas de usabilidad: «que
se puedan cargar imágenes en vez de diagramas ASCII»). Se siguen las mismas
reglas que el resto del contenido de Telar:

* **Viven en la nube**, en el mismo bucket que el catálogo, no dentro del
  módulo: el texto de la lección solo lleva un enlace
  (``![texto](https://storage.googleapis.com/<bucket>/imagenes/<hash>.png)``),
  igual que el video es un enlace a YouTube. Así el bundle de un módulo sigue
  pesando kilobytes, no megabytes, y las imágenes se descargan solo al leer.
* **Direccionadas por contenido**: el nombre es el SHA-256 de los bytes. Subir
  la misma imagen dos veces no duplica nada, y una URL jamás cambia de
  contenido (se puede cachear para siempre, igual que un bundle publicado).
* **Se valida el CONTENIDO, no la extensión**: se leen los bytes mágicos y las
  dimensiones. Un ``.png`` que es otra cosa se rechaza. SVG queda fuera a
  propósito: puede llevar scripts.

Este módulo NO viaja a la imagen del estudiante (``Dockerfile`` con
``TELAR_ADMIN_BUILD=0``): el estudiante solo *lee* esas URLs.
"""

from __future__ import annotations

import hashlib
import struct
from dataclasses import dataclass

#: Tope de tamaño por imagen. Una captura o un diagrama caben de sobra; más que
#: esto es una foto sin recomprimir que hará lenta la lección.
MAX_IMAGE_BYTES = 2 * 1024 * 1024
#: Tope por lado, en píxeles (evita «bombas» de descompresión en el navegador).
MAX_IMAGE_SIDE = 4096
#: Prefijo de objeto en el bucket (hermano de ``modulos/``).
IMAGE_PREFIX = "imagenes"
#: Largo del hash usado como nombre: 32 hex = 128 bits, de sobra contra colisiones.
HASH_CHARS = 32
#: Base pública de GCS, la misma desde donde el estudiante descarga el catálogo.
GCS_PUBLIC_BASE = "https://storage.googleapis.com"

_TIPOS = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "gif": "image/gif",
    "webp": "image/webp",
}


class ImageRejected(ValueError):
    """La imagen no cumple las reglas. El mensaje se muestra tal cual al admin."""


@dataclass(frozen=True, slots=True)
class ImageInfo:
    ext: str  # png | jpg | gif | webp
    content_type: str
    width: int
    height: int


def _png(data: bytes) -> tuple[int, int] | None:
    if data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR" or len(data) < 24:
        return None
    return struct.unpack(">II", data[16:24])


def _gif(data: bytes) -> tuple[int, int] | None:
    if data[:6] not in (b"GIF87a", b"GIF89a") or len(data) < 10:
        return None
    return struct.unpack("<HH", data[6:10])


def _jpeg(data: bytes) -> tuple[int, int] | None:
    if data[:3] != b"\xff\xd8\xff":
        return None
    i = 2
    n = len(data)
    while i + 9 < n:
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker == 0xFF:  # relleno
            i += 1
            continue
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:  # sin longitud
            i += 2
            continue
        (largo,) = struct.unpack(">H", data[i + 2 : i + 4])
        # SOF0..SOF15 (salvo DHT 0xC4, JPG 0xC8 y DAC 0xCC) llevan las dimensiones.
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            alto, ancho = struct.unpack(">HH", data[i + 5 : i + 9])
            return ancho, alto
        i += 2 + largo
    return None


def _webp(data: bytes) -> tuple[int, int] | None:
    if data[:4] != b"RIFF" or data[8:12] != b"WEBP" or len(data) < 30:
        return None
    kind = data[12:16]
    if kind == b"VP8 ":  # con pérdida
        ancho, alto = struct.unpack("<HH", data[26:30])
        return ancho & 0x3FFF, alto & 0x3FFF
    if kind == b"VP8L":  # sin pérdida
        b0, b1, b2, b3 = data[21:25]
        ancho = 1 + (((b1 & 0x3F) << 8) | b0)
        alto = 1 + (((b3 & 0xF) << 10) | (b2 << 2) | ((b1 & 0xC0) >> 6))
        return ancho, alto
    if kind == b"VP8X":  # extendido
        ancho = 1 + int.from_bytes(data[24:27], "little")
        alto = 1 + int.from_bytes(data[27:30], "little")
        return ancho, alto
    return None


def inspect_image(data: bytes) -> ImageInfo:
    """Valida los bytes y devuelve su tipo y dimensiones, o lanza ``ImageRejected``."""
    if not data:
        raise ImageRejected("El archivo está vacío.")
    if len(data) > MAX_IMAGE_BYTES:
        mb = MAX_IMAGE_BYTES // (1024 * 1024)
        raise ImageRejected(
            f"La imagen pesa {len(data) / 1024 / 1024:.1f} MB y el máximo es {mb} MB. "
            "Redúcela o expórtala como PNG/JPG más comprimido."
        )
    for ext, leer in (("png", _png), ("jpg", _jpeg), ("gif", _gif), ("webp", _webp)):
        dims = leer(data)
        if dims is None:
            continue
        ancho, alto = dims
        if ancho < 1 or alto < 1:
            raise ImageRejected("La imagen no tiene dimensiones válidas.")
        if ancho > MAX_IMAGE_SIDE or alto > MAX_IMAGE_SIDE:
            raise ImageRejected(
                f"La imagen mide {ancho}×{alto} px y el máximo es "
                f"{MAX_IMAGE_SIDE}×{MAX_IMAGE_SIDE}. Redúcela antes de subirla."
            )
        return ImageInfo(ext=ext, content_type=_TIPOS[ext], width=ancho, height=alto)
    raise ImageRejected(
        "Formato no admitido. Usa PNG, JPG, GIF o WebP "
        "(SVG no se permite: puede contener scripts)."
    )


def object_path_for(data: bytes, ext: str) -> str:
    """Ruta del objeto en el bucket, derivada del CONTENIDO (SHA-256)."""
    digest = hashlib.sha256(data).hexdigest()[:HASH_CHARS]
    return f"{IMAGE_PREFIX}/{digest}.{ext}"


def public_url(bucket: str, object_path: str) -> str:
    """URL pública del objeto, la que se escribe en el markdown de la lección."""
    return f"{GCS_PUBLIC_BASE}/{bucket}/{object_path}"
