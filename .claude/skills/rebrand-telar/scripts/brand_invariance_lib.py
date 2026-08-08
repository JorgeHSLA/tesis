"""Neutralizador de marca — núcleo compartido por T1 y su auto-test.

Colapsa toda grafía de marca (de las DOS marcas) a un token por clase de
mayúsculas, de modo que `neutralize` sea invariante ante un rebrand puramente
nominal y sensible a cualquier otro cambio.

Vive en su propio módulo porque `brand-invariance.py` lleva guion en el nombre
y no es importable.
"""

from __future__ import annotations

# Toda grafía de marca -> token por CLASE DE MAYÚSCULAS. Las dos marcas caen en
# el mismo token, que es lo que hace la comprobación simétrica: `telar` ya
# existía antes del rebrand (nombre del CLI) y no debe generar diff.
#
# La clase importa: si alguien escribe `Telar_ADMIN_MODE` donde tocaba
# `TELAR_ADMIN_MODE`, los tokens difieren (\x00T\x00 vs \x00U\x00) y T1 lo caza.
#
# Ninguna clave es subcadena de otra (comparación sensible a mayúsculas), así
# que el orden no altera el resultado; se ordena por longitud igualmente, por
# si se añade una grafía nueva sin pensarlo.
BRAND_TOKENS: dict[bytes, bytes] = {
    # clase Título:  E-HPC / Ehpc / Telar
    b"E-HPC": b"\x00T\x00",
    b"Ehpc": b"\x00T\x00",  # EhpcApi -> TelarApi (símbolo TS del contrato)
    b"Telar": b"\x00T\x00",
    # clase MAYÚSCULAS: EHPC_ / TELAR_
    b"EHPC": b"\x00U\x00",
    b"TELAR": b"\x00U\x00",
    # clase minúsculas: ehpc / e-hpc / telar
    b"e-hpc": b"\x00t\x00",
    b"ehpc": b"\x00t\x00",
    b"telar": b"\x00t\x00",
}

_ORDERED = sorted(BRAND_TOKENS.items(), key=lambda kv: -len(kv[0]))


def neutralize(data: bytes) -> bytes:
    """Colapsa toda grafía de marca a su token de clase."""
    for needle, token in _ORDERED:
        data = data.replace(needle, token)
    return data


def neutralize_path(path: str) -> str:
    """Igual que `neutralize`, para rutas: `e-hpc/` y `telar/` colapsan igual."""
    return neutralize(path.encode()).decode("utf-8", "surrogateescape")
