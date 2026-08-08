#!/usr/bin/env python3
"""Aplica UNA capa del rebrand, de forma determinista.

ESTADO: este script YA se usó para el rebrand E-HPC -> Telar (commits
rebrand(C1)..rebrand(C5)). Sus rutas y sus tablas describen el árbol de ANTES
del rebrand (`e-hpc/`, `ehpc-api.d.ts`…), así que hoy no encuentra nada: corre
`--dry-run` y verás 0 ocurrencias. Se conserva porque documenta exactamente qué
se cambió en cada capa, y porque es la plantilla para el siguiente rebrand: para
reutilizarlo basta cambiar LAYER_SUBS, C4_FILES y los renombrados.

Por qué un script y no agentes editando a mano: el rebrand es NOMINAL. Una
sustitución de token, acotada por capa y por fichero, cumple la invariante de T1
**por construcción** — no puede colar un cambio de forma porque sólo sabe
reemplazar grafías de marca. Un agente escribiendo 141 ficheros a mano sí puede,
y entonces T1 pasa de ser una red a ser el único obstáculo entre un despiste y
el commit.

El juicio (qué NO tocar) vive en las exclusiones de abajo, que son explícitas y
revisables, no en la atención de 23 agentes en paralelo.

Capas (el orden importa, ver SKILL.md):

  C1  E-HPC -> Telar                      prosa y marca
  C2  EHPC_ -> TELAR_                     variables de entorno
  C3  ehpc/EHPC/Ehpc -> telar/TELAR/Telar  en TODO salvo los ficheros de C4
  C4  lo mismo, SOLO en los ficheros del contrato Electron + renombrados
  C5  e-hpc -> telar + `git mv e-hpc telar`

Uso:
    python3 apply-layer.py C1 [--dry-run]
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

# ── Qué no se toca NUNCA ─────────────────────────────────────────────────────
EXCLUDE_PREFIXES = (
    "mock/e-hpc-handoff/",  # D5: export congelado de claude.ai/design
    ".claude/",             # la propia skill: rebrandearla rompe su detector
)

# Líneas que se saltan aunque estén en un fichero incluido.
SKIP_LINE = [
    (re.compile(r"ghcr\.io/python-for-hpc/"), "imagen de terceros (PyOMP upstream)"),
    (re.compile(r"E-HPC\.html"), "nombre real de fichero dentro del bundle congelado (D5)"),
    (re.compile(r"e-hpc-handoff"), "ruta del bundle congelado (D5)"),
]

# ── Ficheros del contrato Electron (capa C4) ─────────────────────────────────
# C3 los EXCLUYE y C4 los trata en exclusiva, para que preload + .d.ts +
# consumidores + sus tests viajen en un único commit. Si se parten, el build de
# Electron compila y revienta en runtime.
C4_FILES = {
    "e-hpc/desktop/src/preload.ts",
    "e-hpc/desktop/types/ehpc-api.d.ts",
    "e-hpc/desktop/scripts/check-contract.mjs",
    "e-hpc/desktop/CLAUDE.md",
    "e-hpc/frontend/src/types/ehpc.d.ts",
    "e-hpc/frontend/src/config.ts",
    "e-hpc/frontend/src/hooks/usePlatform.ts",
    "e-hpc/frontend/src/hooks/useDockerStatus.ts",
    "e-hpc/frontend/src/components/shell/AboutDialog.tsx",
    "e-hpc/frontend/src/components/shell/RuntimeFooter.tsx",
    "e-hpc/frontend/src/features/simulator/SimulatorIdle.tsx",
    "e-hpc/frontend/tests/hooks/hooks.test.tsx",
    "e-hpc/frontend/CLAUDE.md",
    "e-hpc/CLAUDE.md",
    "e-hpc/Makefile",
}

# Renombrados de fichero de C4 (el contrato exige que los dos sean idénticos).
C4_RENAMES = [
    ("e-hpc/desktop/types/ehpc-api.d.ts", "e-hpc/desktop/types/telar-api.d.ts"),
    ("e-hpc/frontend/src/types/ehpc.d.ts", "e-hpc/frontend/src/types/telar.d.ts"),
]

# ── Sustituciones por capa ───────────────────────────────────────────────────
# Se aplican en orden. `E-HPC` antes que `EHPC` no hace falta (no se solapan),
# pero el orden se fija igualmente para que el resultado sea reproducible.
LAYER_SUBS: dict[str, list[tuple[str, str]]] = {
    "C1": [("E-HPC", "Telar")],
    "C2": [("EHPC_", "TELAR_")],
    "C3": [("Ehpc", "Telar"), ("EHPC", "TELAR"), ("ehpc", "telar")],
    "C4": [("Ehpc", "Telar"), ("EHPC", "TELAR"), ("ehpc", "telar")],
    "C5": [("e-hpc", "telar")],
}


def tracked_files() -> list[str]:
    out = subprocess.run(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        check=True, capture_output=True, text=True, errors="surrogateescape",
    ).stdout
    return [p for p in out.split("\0") if p]


def target_files(layer: str) -> list[str]:
    files = []
    for p in tracked_files():
        if any(p.startswith(x) for x in EXCLUDE_PREFIXES):
            continue
        if layer == "C3" and p in C4_FILES:
            continue          # los toca C4, en su propio commit
        if layer == "C4" and p not in C4_FILES:
            continue
        files.append(p)
    return files


def apply_to_text(text: str, subs: list[tuple[str, str]]) -> tuple[str, int]:
    """Sustituye línea a línea, saltando las líneas de la lista de excepciones."""
    out_lines = []
    n = 0
    for line in text.splitlines(keepends=True):
        if any(rx.search(line) for rx, _ in SKIP_LINE):
            out_lines.append(line)
            continue
        new = line
        for needle, repl in subs:
            if needle in new:
                n += new.count(needle)
                new = new.replace(needle, repl)
        out_lines.append(new)
    return "".join(out_lines), n


def main() -> int:
    ap = argparse.ArgumentParser(description="Aplica una capa del rebrand")
    ap.add_argument("layer", choices=sorted(LAYER_SUBS))
    ap.add_argument("--dry-run", action="store_true", help="no escribe; sólo cuenta")
    args = ap.parse_args()

    subs = LAYER_SUBS[args.layer]
    files = target_files(args.layer)
    print(f"Capa {args.layer}: {', '.join(f'{a} -> {b}' for a, b in subs)}")
    print(f"Ámbito: {len(files)} ficheros"
          + (f" (los {len(C4_FILES)} del contrato)" if args.layer == "C4" else ""))

    touched, total = 0, 0
    for path in files:
        p = Path(path)
        try:
            raw = p.read_bytes()
            text = raw.decode("utf-8")
        except (OSError, UnicodeDecodeError):
            continue          # binarios: los iconos se tratan aparte (D6)
        new_text, n = apply_to_text(text, subs)
        if n:
            touched += 1
            total += n
            if not args.dry_run:
                p.write_bytes(new_text.encode("utf-8"))

    verb = "cambiaría" if args.dry_run else "cambiadas"
    print(f"{total} ocurrencia(s) {verb} en {touched} fichero(s).")

    if args.layer == "C4" and not args.dry_run:
        for old, new in C4_RENAMES:
            if Path(old).exists():
                subprocess.run(["git", "mv", old, new], check=True)
                print(f"  renombrado: {old} -> {new}")

    if args.layer == "C5" and not args.dry_run:
        if Path("e-hpc").is_dir():
            subprocess.run(["git", "mv", "e-hpc", "telar"], check=True)
            print("  renombrado: e-hpc/ -> telar/")

    return 0


if __name__ == "__main__":
    sys.exit(main())
