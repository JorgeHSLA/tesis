#!/usr/bin/env python3
"""T1 — Test de invariancia de marca. La puerta más fuerte y más barata.

Un rebrand puramente NOMINAL no cambia la FORMA de nada: ni un campo, ni un
tipo, ni un endpoint, ni una línea de lógica. Sólo cambia cómo se escribe el
nombre de la marca.

Este script lo comprueba mecánicamente: *neutraliza* la marca en ambos árboles
(el viejo y el nuevo) reemplazando toda grafía de marca — de CUALQUIERA de las
dos marcas — por un token único por clase de mayúsculas, y exige que los dos
árboles neutralizados sean byte a byte idénticos, rutas incluidas.

    neutralize(árbol_viejo)  ==  neutralize(árbol_nuevo)

Cualquier diferencia = un cambio de forma que se coló. Falla la capa.

## Por qué neutralizar y no "sustituir al revés"

La formulación ingenua ("aplica telar→ehpc al árbol nuevo y compáralo con el
viejo") tiene un falso positivo garantizado en este repo: `telar` YA EXISTE
antes del rebrand como nombre del CLI (compose.yaml, launch-wsl.sh). La
sustitución inversa convertiría esas ocurrencias preexistentes en `ehpc` y
reportaría un diff que no es un error. Neutralizar es simétrico: `telar` cae
en el mismo token en los dos árboles, venga de donde venga.

## Qué NO comprueba

Que el rebrand esté COMPLETO. Un `ehpc` sin tocar neutraliza igual que un
`telar`, así que T1 lo da por bueno. Esa mitad la cubre T6 (grep final).
    T1 = "no cambió la forma"   ·   T6 = "el rename está completo"
Juntas son estancas; por separado, ninguna basta.

## Uso

    # tras cada capa: árbol de la capa anterior vs. el de trabajo
    python3 brand-invariance.py --old HEAD --new :worktree

    # dos commits cualesquiera (p.ej. el baseline vs. la capa C3 ya commiteada)
    python3 brand-invariance.py --old pre-rebrand --new HEAD

Exit 0 = invariante (sólo cambió la marca). Exit 1 = se coló un cambio de forma.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from brand_invariance_lib import neutralize, neutralize_path  # noqa: E402

WORKTREE = ":worktree"


def run(*args: str) -> str:
    return subprocess.run(
        args, check=True, capture_output=True, text=True, errors="surrogateescape"
    ).stdout


def list_files(ref: str) -> list[str]:
    if ref == WORKTREE:
        # Incluye los nuevos SIN añadir al índice: durante el rebrand se crean
        # ficheros renombrados antes del `git add`, y si no se comparan, T1 da
        # un OK sobre contenido que nadie ha verificado.
        out = run("git", "ls-files", "-z", "--cached", "--others", "--exclude-standard")
    else:
        out = run("git", "ls-tree", "-r", "-z", "--name-only", ref)
    return [p for p in out.split("\0") if p]


def read_file(ref: str, path: str) -> bytes:
    if ref == WORKTREE:
        return Path(path).read_bytes()
    return subprocess.run(
        ["git", "show", f"{ref}:{path}"], check=True, capture_output=True
    ).stdout


def build_index(ref: str) -> tuple[dict[str, bytes], dict[str, str], list[str]]:
    """{ruta neutralizada: contenido neutralizado}, {ruta neutralizada: ruta real}, colisiones."""
    index: dict[str, bytes] = {}
    origin: dict[str, str] = {}
    collisions: list[str] = []

    for path in list_files(ref):
        key = neutralize_path(path)
        if key in index:
            collisions.append(f"{origin[key]} y {path} colapsan a la misma ruta")
            continue
        try:
            index[key] = neutralize(read_file(ref, path))
        except (subprocess.CalledProcessError, FileNotFoundError, OSError) as exc:
            # Un fichero listado pero ilegible es en sí mismo un hallazgo.
            index[key] = f"<<ILEGIBLE: {exc}>>".encode()
        origin[key] = path

    return index, origin, collisions


def main() -> int:
    ap = argparse.ArgumentParser(description="T1 — invariancia de marca")
    ap.add_argument("--old", required=True, help="ref git del árbol ANTES")
    ap.add_argument(
        "--new", default=WORKTREE, help=f"ref git del árbol DESPUÉS ({WORKTREE} = working tree)"
    )
    ap.add_argument(
        "--max-report", type=int, default=40, help="máximo de diferencias a listar"
    )
    args = ap.parse_args()

    old, old_src, old_col = build_index(args.old)
    new, new_src, new_col = build_index(args.new)

    problems: list[str] = []
    problems += [f"[colisión de ruta en --old] {c}" for c in old_col]
    problems += [f"[colisión de ruta en --new] {c}" for c in new_col]

    only_old = sorted(set(old) - set(new))
    only_new = sorted(set(new) - set(old))
    problems += [f"[borrado] existía en --old y no en --new: {old_src[p]}" for p in only_old]
    problems += [f"[añadido] existe en --new y no en --old: {new_src[p]}" for p in only_new]

    changed = sorted(p for p in set(old) & set(new) if old[p] != new[p])
    for p in changed:
        # Se reporta la ruta REAL de cada lado: tras C5 difieren (e-hpc/ -> telar/).
        where = new_src[p] if new_src[p] == old_src[p] else f"{old_src[p]} -> {new_src[p]}"
        problems.append(f"[forma alterada] el contenido difiere más allá de la marca: {where}")

    total_old, total_new = len(old), len(new)
    print(f"T1 invariancia de marca:  --old={args.old} ({total_old} ficheros)  "
          f"--new={args.new} ({total_new} ficheros)")

    if not problems:
        print(f"  OK — los {total_old} ficheros son idénticos tras neutralizar la marca.")
        print("  El rebrand es puramente NOMINAL: cero cambios de forma.")
        return 0

    print(f"  FALLO — {len(problems)} diferencia(s) que la marca NO explica:\n")
    for line in problems[: args.max_report]:
        print(f"    {line}")
    if len(problems) > args.max_report:
        print(f"    … y {len(problems) - args.max_report} más.")
    print("\n  Cada línea es un cambio que este rebrand no debía introducir.")
    print("  Revísalo con:  git diff --  <ruta real>")
    return 1


if __name__ == "__main__":
    sys.exit(main())
