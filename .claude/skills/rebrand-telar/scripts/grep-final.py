#!/usr/bin/env python3
"""T6 — grep final. Cero ocurrencias de marca vieja, salvo las autorizadas.

T1 demuestra que no cambió la forma; T6 demuestra que el rename está COMPLETO.
Hacen falta las dos: T1 acepta un fichero sin tocar (`ehpc` y `telar`
neutralizan igual), y T6 acepta un fichero destrozado. Juntas son estancas.

Todo lo que quede se contrasta con la lista de FALSOS POSITIVOS INTENCIONALES
de abajo. Un resto no listado hace fallar la puerta; si es legítimo, se añade
aquí con su motivo — la lista es la documentación de por qué sobrevive.

Uso:
    python3 grep-final.py             # falla si hay restos no autorizados
    python3 grep-final.py --list      # enseña TODO lo que queda, autorizado o no
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys

BRAND = re.compile(r"E-HPC|e-hpc|EHPC|ehpc|Ehpc")

# ── Falsos positivos INTENCIONALES ───────────────────────────────────────────
# (patrón de ruta o de contenido, motivo). Se documentan aquí, no se silencian.
ALLOWED_PATHS: list[tuple[str, str]] = [
    (
        "mock/e-hpc-handoff/",
        "Export literal de claude.ai/design. Es un artefacto de PROCEDENCIA: "
        "el bundle se llamaba así cuando se exportó. Reescribirlo falsearía "
        "el registro histórico de la fase de diseño de la tesis.",
    ),
    (
        ".claude/",
        "La propia skill. Habla DEL rebrand: la marca vieja aparece en los "
        "patrones del detector, en esta misma allowlist y en la prosa que "
        "explica el mapeo. Rebrandearla romperia la herramienta.",
    ),
]

ALLOWED_CONTENT: list[tuple[re.Pattern, str]] = [
    (
        re.compile(r"ghcr\.io/python-for-hpc/"),
        "Imagen de TERCEROS (proyecto PyOMP upstream). No es nuestra marca.",
    ),
    (
        re.compile(r"E-HPC\.html|e-hpc-handoff"),
        "CITA del nombre real de un fichero dentro del bundle congelado del "
        "handoff (D5). El fichero se sigue llamando E-HPC.html: renombrar la "
        "cita dejaría la documentación apuntando a algo que no existe. "
        "Aparece en docs/analysis/handoff-design.md, fuera de mock/.",
    ),
    # OJO: no hay regla comodín para URLs, y es deliberado. Por D7 el
    # repositorio remoto SÍ se renombra, así que
    # `github.com/jorgesierra/e-hpc` (electron-builder.yml:15) tiene que
    # aparecer como hallazgo hasta que se renombre: no es un falso positivo.
    # Sólo se exceptúan URLs de TERCEROS, como la de PyOMP de arriba.
]


def tracked() -> list[str]:
    """Versionados MÁS los nuevos sin añadir: un fichero renombrado al que se
    le olvidó el `git add` no puede escaparse de la puerta final."""
    out = subprocess.run(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        check=True, capture_output=True, text=True, errors="surrogateescape").stdout
    return [p for p in out.split("\0") if p]


def path_allowed(path: str) -> str | None:
    for prefix, reason in ALLOWED_PATHS:
        if path.startswith(prefix):
            return reason
    return None


def line_allowed(line: str) -> str | None:
    for rx, reason in ALLOWED_CONTENT:
        if rx.search(line):
            return reason
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description="T6 — grep final del rebrand")
    ap.add_argument("--list", action="store_true", help="listar TODO lo que queda")
    args = ap.parse_args()

    offenders: list[str] = []
    allowed_count = 0
    allowed_by_reason: dict[str, int] = {}

    for path in tracked():
        reason = path_allowed(path)
        try:
            with open(path, encoding="utf-8", errors="surrogateescape") as fh:
                content = fh.read()
        except (OSError, UnicodeDecodeError):
            continue

        hits = [(i, ln) for i, ln in enumerate(content.splitlines(), 1) if BRAND.search(ln)]
        # Una RUTA que aún contiene la marca es un hallazgo por sí misma.
        if BRAND.search(path) and not reason:
            offenders.append(f"{path}: la RUTA todavía lleva la marca vieja")

        for lineno, line in hits:
            why = reason or line_allowed(line)
            if why:
                allowed_count += 1
                allowed_by_reason[why] = allowed_by_reason.get(why, 0) + 1
                if args.list:
                    print(f"  [ok] {path}:{lineno}: {line.strip()[:110]}")
            else:
                offenders.append(f"{path}:{lineno}: {line.strip()[:110]}")

    print(f"\nT6 grep final — {allowed_count} ocurrencia(s) autorizada(s), "
          f"{len(offenders)} sin autorizar.")
    for why, n in sorted(allowed_by_reason.items(), key=lambda kv: -kv[1]):
        print(f"  · {n:>4} × {why[:96]}")

    if offenders:
        print(f"\nFALLO — {len(offenders)} resto(s) de marca vieja sin justificar:\n")
        for o in offenders[:60]:
            print(f"    {o}")
        if len(offenders) > 60:
            print(f"    … y {len(offenders) - 60} más.")
        print("\n  O los renombras, o los añades a ALLOWED_* con su motivo.")
        return 1

    print("\n  OK — no queda marca vieja fuera de lo autorizado.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
