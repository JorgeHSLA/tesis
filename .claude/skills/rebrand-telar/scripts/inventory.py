#!/usr/bin/env python3
"""Fase A — inventario. La ÚNICA fuente de verdad del ancho del fan-out.

Recorre los ficheros rastreados por git, clasifica CADA ocurrencia de marca en
su capa (C1..C5) y su área (docs/backend/frontend/desktop/runner/mock/…), y
emite el mapa {capa -> área -> ficheros}. El workflow lee esto para decidir
cuántos agentes lanzar: el ancho sale del repo, no de una constante escrita a
mano que se queda obsoleta al primer commit.

Una ocurrencia se clasifica por PATRÓN, no por fichero: `compose.yaml` aparece
en C2 (EHPC_*), C3 (volúmenes) y C5 (rutas) a la vez, y debe tocarse en las
tres capas por razones distintas.

Uso:
    python3 inventory.py                 # resumen legible
    python3 inventory.py --json          # manifiesto JSON (lo consume el workflow)
    python3 inventory.py --layer C3      # detalle de una capa, con fichero:línea
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections import defaultdict

# ── Áreas ────────────────────────────────────────────────────────────────────
AREA_RULES: list[tuple[str, str]] = [
    ("e-hpc/docs/", "docs"),
    ("e-hpc/frontend/", "frontend"),
    ("e-hpc/backend/", "backend"),
    ("e-hpc/desktop/", "desktop"),
    ("e-hpc/runner/", "runner"),
    ("e-hpc/scripts/", "scripts"),
    ("mock/", "mock"),
    ("simuladores/", "simuladores"),
]

# ── Capas ────────────────────────────────────────────────────────────────────
# El ORDEN importa: la primera regla que casa gana, y las capas de mayor riesgo
# van primero para que una ocurrencia como `EHPC_SUBMISSIONS_VOLUME: ehpc_submissions`
# no se cuele como "prosa".
#
# C4 antes que C3 y C2: el contrato Electron es el más frágil y sus símbolos
# (`EhpcApi`, `window.ehpc`) son inconfundibles.
LAYER_RULES: list[tuple[str, str, str]] = [
    # (capa, nombre del patrón, regex)
    ("C4", "window.ehpc", r"window\.ehpc\b"),
    # Los tests acceden al MISMO global con un cast, no con notación de punto:
    #   delete (window as { ehpc?: unknown }).ehpc
    # Sin esta regla caían en C1 "prosa" y el fan-out de C4 no los veía, aunque
    # son consumidores de pleno derecho del contrato (hooks.test.tsx).
    ("C4", "window casteado a { ehpc }", r"window\s+as\s*\{[^}]*\behpc\b"),
    ("C4", "EhpcApi (símbolo TS)", r"\bEhpcApi\b"),
    ("C4", "exposeInMainWorld", r"exposeInMainWorld\(\s*['\"]ehpc['\"]"),
    ("C4", "ehpc-api.d.ts / ehpc.d.ts", r"ehpc(-api)?\.d\.ts"),
    ("C4", "Window { ehpc? }", r"interface\s+Window\s*\{\s*ehpc"),

    # Etiquetas Docker: el REAPER de huérfanos filtra por ellas
    # (docker_service.py §4.15). Renombrarlas deja inalcanzables los
    # contenedores creados por el build anterior. Ver SKILL.md C3.
    ("C3", "etiqueta Docker ehpc.runner/ehpc.job", r"\behpc\.(runner|job)\b"),

    # NOMBRE DE PROYECTO de Compose. `ehpc` a secas no casa con ninguna otra
    # regla C3 (todas piden un punto o un guion alrededor), así que sin esto
    # caía en C1 "prosa" — justo el cubo SIN smoke test. Y es el nombre que
    # gobierna el prefijo de todo lo que no lleve `name:` explícito: es el
    # mecanismo del bug BL-02, el mismo que C3 existe para blindar.
    ("C3", "nombre de proyecto Compose", r"^\s*name:\s*ehpc\s*$|COMPOSE_PROJECT_NAME\s*=\s*['\"]ehpc['\"]"),

    ("C3", "volumen ehpc_submissions", r"\behpc_submissions\b"),
    ("C3", "volumen ehpc_data", r"\behpc_data\b"),
    ("C3", "SQLite ehpc.db", r"\behpc\.db\b"),
    ("C3", "imagen runner", r"\behpc-runner\b"),
    ("C3", "appId edu.ehpc.*", r"\bedu\.ehpc\b"),
    ("C3", "imagen ghcr.io/*/ehpc-*", r"ghcr\.io/[^/\s]+/ehpc-"),
    ("C3", "clave localStorage", r"['\"]ehpc-(sidebar-expanded|last-lesson|theme|learn-side)['\"]"),
    ("C3", "home dir ~/.ehpc*", r"\.ehpc(-build|-verify)?\b(?!\.db)"),
    ("C3", "nombre de contenedor/tarea", r"\behpc-(job|worker|run|head|frontend|backend|desktop|variant|drainer|logs|stats|retain|runner-test)\b"),

    ("C2", "variable de entorno EHPC_*", r"\bEHPC_[A-Z0-9_]+"),

    # La marca en prosa se escribe `E-HPC`; en minúscula-con-guion sólo aparece
    # como RUTA o SLUG (`~/dev/e-hpc`, `.../e-hpc/desktop`, la URL del repo).
    # Por eso todo `e-hpc` en minúscula cae en C5.
    ("C5", "ruta / slug del proyecto", r"e-hpc"),

    # Marca en prosa / texto de UI. Última: sólo lo que no casó arriba.
    ("C1", "marca en prosa", r"E-HPC"),
    # Restos que no son ninguno de los anteriores (ids de diagrama, slugs…).
    ("C1", "resto ehpc/EHPC", r"\bEHPC\b|\behpc\b"),
]

COMPILED = [(layer, name, re.compile(rx)) for layer, name, rx in LAYER_RULES]

# Ficheros que NO se rebrandean (falsos positivos intencionales). Ver SKILL.md.
DEFAULT_EXCLUDE = (
    "mock/e-hpc-handoff/",
    # La propia skill. Sus ficheros hablan DEL rebrand: contienen la marca
    # vieja en los patrones del detector, en la allowlist de T6 y en la prosa
    # que explica el mapeo. Rebrandearlos destruiría la herramienta que hace
    # el rebrand (el neutralizador dejaría de reconocer `ehpc`).
    ".claude/",
)


def area_of(path: str) -> str:
    for prefix, area in AREA_RULES:
        if path.startswith(prefix):
            return area
    if path.startswith("e-hpc/"):
        return "ehpc-root"
    return "repo-root"


def tracked_files() -> list[str]:
    """Ficheros versionados MÁS los nuevos sin añadir (respetando .gitignore).

    `--others --exclude-standard` es deliberado: durante el rebrand se crean
    ficheros renombrados que aún no se han hecho `git add`. Sin esto serían
    invisibles para el inventario y para T6, y un fichero sin verificar daría
    un OK limpio.
    """
    out = subprocess.run(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        check=True, capture_output=True, text=True, errors="surrogateescape",
    ).stdout
    return [p for p in out.split("\0") if p]


def classify_line(line: str) -> list[tuple[str, str]]:
    """Devuelve [(capa, patrón)] para las reglas que casan, sin doble conteo.

    Se consume la línea: cada tramo casado se tacha para que una regla
    posterior y más laxa (C1 'resto ehpc') no lo vuelva a contar.
    """
    hits: list[tuple[str, str]] = []
    remaining = line
    for layer, name, rx in COMPILED:
        if rx.search(remaining):
            hits.append((layer, name))
            remaining = rx.sub("\x00", remaining)
    return hits


def build() -> dict:
    excluded_files: list[str] = []
    # capa -> área -> {fichero -> nº ocurrencias}
    layers: dict[str, dict[str, dict[str, int]]] = defaultdict(lambda: defaultdict(dict))
    patterns: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    details: dict[str, list[dict]] = defaultdict(list)

    brand = re.compile(r"E-HPC|e-hpc|EHPC|ehpc|Ehpc")

    for path in tracked_files():
        try:
            with open(path, encoding="utf-8", errors="surrogateescape") as fh:
                content = fh.read()
        except (OSError, UnicodeDecodeError):
            continue
        if not brand.search(content):
            continue

        excluded = any(path.startswith(p) for p in DEFAULT_EXCLUDE)
        if excluded:
            excluded_files.append(path)
            continue

        area = area_of(path)
        per_file: dict[str, int] = defaultdict(int)
        for lineno, line in enumerate(content.splitlines(), 1):
            if not brand.search(line):
                continue
            for layer, name in classify_line(line):
                per_file[layer] += 1
                patterns[layer][name] += 1
                details[layer].append(
                    {"file": path, "line": lineno, "pattern": name, "text": line.strip()[:160]}
                )
        for layer, count in per_file.items():
            layers[layer][area][path] = count

    # Renombrados de fichero/directorio (C5 + C4).
    renames = [p for p in tracked_files()
               if re.search(r"e-?hpc", p, re.I)
               and not any(p.startswith(x) for x in DEFAULT_EXCLUDE)]

    return {
        "layers": {k: {a: dict(f) for a, f in v.items()} for k, v in layers.items()},
        "patterns": {k: dict(v) for k, v in patterns.items()},
        "details": dict(details),
        "renames": renames,
        "excluded_files": excluded_files,
    }


def summarize(inv: dict) -> None:
    order = ["C1", "C2", "C3", "C4", "C5"]
    titles = {
        "C1": "Prosa y marca                (riesgo BAJO)",
        "C2": "Variables de entorno         (riesgo MEDIO)",
        "C3": "Estado persistido / runtime  (riesgo ALTO)",
        "C4": "Contrato Electron↔frontend   (riesgo ALTO)",
        "C5": "Rutas y directorio raíz      (riesgo ALTO)",
    }
    print("═══ INVENTARIO — ancho real del fan-out ═══\n")
    grand_files: set[str] = set()
    for layer in order:
        areas = inv["layers"].get(layer, {})
        if not areas:
            print(f"{layer} · {titles[layer]}\n    (sin ocurrencias)\n")
            continue
        occ = sum(sum(f.values()) for f in areas.values())
        files = {p for f in areas.values() for p in f}
        grand_files |= files
        print(f"{layer} · {titles[layer]}")
        print(f"    {occ} ocurrencias · {len(files)} ficheros · {len(areas)} áreas -> "
              f"{len(areas)} agentes en paralelo")
        for area in sorted(areas, key=lambda a: -sum(areas[a].values())):
            n_occ = sum(areas[area].values())
            print(f"      · {area:<12} {n_occ:>4} occ  {len(areas[area]):>3} ficheros")
        top = sorted(inv["patterns"].get(layer, {}).items(), key=lambda kv: -kv[1])
        print(f"      patrones: {', '.join(f'{k} ({v})' for k, v in top[:6])}")
        print()

    print(f"Total: {len(grand_files)} ficheros distintos tocados por alguna capa.")
    print(f"Renombrados de ruta: {len(inv['renames'])} (incluye el árbol e-hpc/).")
    if inv["excluded_files"]:
        print(f"Excluidos (falsos positivos intencionales): {len(inv['excluded_files'])} ficheros "
              f"bajo {', '.join(DEFAULT_EXCLUDE)}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Fase A — inventario del rebrand")
    ap.add_argument("--json", action="store_true", help="manifiesto JSON para el workflow")
    ap.add_argument("--layer", help="detalle fichero:línea de una capa (C1..C5)")
    args = ap.parse_args()

    inv = build()

    if args.layer:
        for d in inv["details"].get(args.layer.upper(), []):
            print(f"{d['file']}:{d['line']}: [{d['pattern']}] {d['text']}")
        return 0

    if args.json:
        # `details` se omite: abulta mucho y el workflow sólo necesita el mapa.
        print(json.dumps({k: v for k, v in inv.items() if k != "details"},
                         indent=2, ensure_ascii=False))
        return 0

    summarize(inv)
    return 0


if __name__ == "__main__":
    sys.exit(main())
