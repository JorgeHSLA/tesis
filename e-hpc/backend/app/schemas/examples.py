"""DTOs pydantic (v2) del contrato de API de Telar — §3 Catálogo de ejemplos.

TRANSCRIPCIÓN LITERAL de ``docs/architecture/api-contract.md`` (CONGELADO).
Provee ``ParserId``, reutilizado por §7 (jobs) y §10 (admin).
No añadir, quitar ni renombrar campos sin actualizar el contrato primero.
"""

from typing import Literal

from pydantic import BaseModel

# ──────────────────────── §3 Catálogo de ejemplos ───────────────────────────

#: Los 6 parser_id válidos (architecture.md §7.2).
ParserId = Literal[
    "none",
    "sweep_pi",
    "sweep_transporte",
    "pair_openmp_numpy",
    "pair_openmp_blas",
    "pair_parallel_serial",
]


class ExampleSummary(BaseModel):
    """§3.1 — item de ``GET /api/v1/examples`` (sin código fuente)."""

    id: str
    title: str
    module_id: str
    order: int
    filename: str
    difficulty: int
    teaches: str
    directives: list[str]
    threads_configurable: bool
    fixed_threads: int | None
    fixed_threads_note: str | None
    sweeps_threads: bool
    self_measures: bool
    parser_id: ParserId
    default_timeout_s: int
    est_run_seconds: int
    enabled: bool
    requires_gpu: bool


class ExamplesList(BaseModel):
    examples: list[ExampleSummary]


class ExampleDetail(ExampleSummary):
    """§3.2 ``GET /api/v1/examples/{example_id}`` — detalle con código."""

    source_code: str
    lesson_id: str
    expected_output_note: str
    takeaways: list[str]  # 3-4 bullets («Lo que vas a aprender»)


__all__ = [
    "ParserId",
    "ExampleSummary",
    "ExamplesList",
    "ExampleDetail",
]
