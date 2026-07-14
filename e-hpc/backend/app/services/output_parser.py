"""Parsers de stdout — architecture.md §7.2 (formatos reales de examples-content §6).

Reglas congeladas:
1. Se aplican AL FINAL del job sobre el stdout completo; si el output fue
   truncado NO se parsea (``parsed_timings = None``).
2. Jamás asumir orden de líneas (scripts que imprimen desde ``@njit``).
3. ``speedup(n) = t(1)/t(n)``; ``eficiencia(n) = speedup(n)/n``.
4. ``pair``: ``speedup_vs_reference = reference_time_s / parallel_time_s``.

Shapes de salida = ``jobs.parsed_timings`` de data-model.md §3.1 /
api-contract.md §7.4. Devuelve ``dict | None`` (el repo lo serializa a JSON).
"""

from __future__ import annotations

import re

#: Los 6 parser_id válidos (data-model §4.4 valida los fixtures contra esto).
PARSER_IDS = frozenset(
    {
        "none",
        "sweep_pi",
        "sweep_transporte",
        "pair_openmp_numpy",
        "pair_openmp_blas",
        "pair_parallel_serial",
    }
)

# Regex POR LÍNEA — literales de architecture.md §7.2.
_RE_SWEEP_PI = re.compile(r"hilos = (\d+) \| pi = ([\d.]+) \| tiempo = ([\d.]+) s")
_RE_SWEEP_TRANSPORTE = re.compile(
    r"hilos = (\d+) \| tiempo = ([\d.]+) s \| transmitidas: ([\d.]+) % "
    r"\| reflejadas: ([\d.]+) % \| absorbidas: ([\d.]+) %"
)
_RE_PAIR = {
    # parser_id -> (regex paralelo, regex referencia, regex correct, label)
    "pair_openmp_numpy": (
        re.compile(r"tiempo openmp: ([\d.]+) s"),
        re.compile(r"tiempo numpy\s*: ([\d.]+) s"),
        re.compile(r"correcto\? (True|False)"),
        "numpy",
    ),
    "pair_openmp_blas": (
        re.compile(r"tiempo openmp\s*: ([\d.]+) s"),
        re.compile(r"tiempo np\.dot\s*: ([\d.]+) s"),
        re.compile(r"correcto\? (True|False)"),
        "blas",
    ),
    "pair_parallel_serial": (
        re.compile(r"tiempo paralelo: ([\d.]+) s"),
        re.compile(r"tiempo serial\s*: ([\d.]+) s"),
        re.compile(r"paralelo == serial\? (True|False)"),
        "serial",
    ),
}


def parse_output(parser_id: str, stdout: str | None, *, truncated: bool = False) -> dict | None:
    """Punto de entrada único: aplica el parser declarado por el fixture.

    Devuelve el documento ``parsed_timings`` o ``None`` (parser ``none``,
    output truncado/vacío, o formato que no casa — jamás lanza).
    """
    if truncated or not stdout or parser_id == "none":
        return None
    if parser_id == "sweep_pi":
        return _parse_sweep_pi(stdout)
    if parser_id == "sweep_transporte":
        return _parse_sweep_transporte(stdout)
    if parser_id in _RE_PAIR:
        return _parse_pair(parser_id, stdout)
    return None  # parser_id desconocido: no romper el finish del job


# ────────────────────────────── kind = sweep ────────────────────────────────


def _sweep_series(points: list[tuple[int, float]]) -> list[dict] | None:
    """Construye la serie con speedup/eficiencia; requiere baseline t(1)."""
    if not points:
        return None
    baseline = next((t for n, t in points if n == 1), None)
    if baseline is None or baseline <= 0:
        return None
    series = []
    for threads, time_s in points:
        if time_s <= 0:
            return None
        speedup = round(baseline / time_s, 2)
        series.append(
            {
                "threads": threads,
                "time_s": time_s,
                "speedup": speedup,
                "efficiency": round(speedup / threads, 2),
            }
        )
    return series


def _parse_sweep_pi(stdout: str) -> dict | None:
    points: list[tuple[int, float]] = []
    for line in stdout.splitlines():
        match = _RE_SWEEP_PI.search(line)
        if match:
            points.append((int(match.group(1)), float(match.group(3))))
    series = _sweep_series(points)
    if series is None:
        return None
    return {
        "parser_id": "sweep_pi",
        "kind": "sweep",
        "series": series,
        "extra": {},
        "correct": None,
    }


def _parse_sweep_transporte(stdout: str) -> dict | None:
    points: list[tuple[int, float]] = []
    extra: dict[str, float] = {}
    for line in stdout.splitlines():
        match = _RE_SWEEP_TRANSPORTE.search(line)
        if match:
            points.append((int(match.group(1)), float(match.group(2))))
            if not extra:  # física de la 1ª línea casada (ejemplo del contrato)
                extra = {
                    "transmitidas_pct": float(match.group(3)),
                    "reflejadas_pct": float(match.group(4)),
                    "absorbidas_pct": float(match.group(5)),
                }
    series = _sweep_series(points)
    if series is None:
        return None
    return {
        "parser_id": "sweep_transporte",
        "kind": "sweep",
        "series": series,
        "extra": extra,
        "correct": None,
    }


# ─────────────────────────────── kind = pair ────────────────────────────────


def _parse_pair(parser_id: str, stdout: str) -> dict | None:
    re_parallel, re_reference, re_correct, label = _RE_PAIR[parser_id]
    parallel_s: float | None = None
    reference_s: float | None = None
    correct: bool | None = None
    for line in stdout.splitlines():
        if parallel_s is None:
            match = re_parallel.search(line)
            if match:
                parallel_s = float(match.group(1))
                continue
        if reference_s is None:
            match = re_reference.search(line)
            if match:
                reference_s = float(match.group(1))
                continue
        if correct is None:
            match = re_correct.search(line)
            if match:
                correct = match.group(1) == "True"
    if parallel_s is None or reference_s is None or parallel_s <= 0:
        return None
    return {
        "parser_id": parser_id,
        "kind": "pair",
        "parallel_time_s": parallel_s,
        "reference_time_s": reference_s,
        "reference_label": label,
        "speedup_vs_reference": round(reference_s / parallel_s, 2),
        "correct": correct,
    }
