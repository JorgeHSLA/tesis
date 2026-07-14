"""Routers de ejemplos (api-contract §3) — WP3.

- ``GET /api/v1/examples`` — listado SIN código fuente (§3.1).
- ``GET /api/v1/examples/{example_id}`` — detalle con ``source_code``,
  ``lesson_id``, ``expected_output_note`` y ``takeaways`` (§3.2). El detalle
  NO incluye el quiz (eso es de ``/lessons/{id}/quiz``).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.repositories.content import ContentRepository, Example
from app.routers.modules import envelope_error, envelope_ok, get_content
from app.schemas import ExampleDetail, ExamplesList, ExampleSummary

router = APIRouter(prefix="/api/v1", tags=["examples"])


def _summary(example: Example) -> ExampleSummary:
    return ExampleSummary(
        id=example.id,
        title=example.title,
        module_id=example.module_id,
        order=example.order,
        filename=example.filename,
        difficulty=example.difficulty,
        teaches=example.teaches,
        directives=list(example.directives),
        threads_configurable=example.threads_configurable,
        fixed_threads=example.fixed_threads,
        fixed_threads_note=example.fixed_threads_note,
        sweeps_threads=example.sweeps_threads,
        self_measures=example.self_measures,
        parser_id=example.parser_id,  # type: ignore[arg-type]
        default_timeout_s=example.default_timeout_s,
        est_run_seconds=example.est_run_seconds,
        enabled=example.enabled,
        requires_gpu=example.requires_gpu,
    )


@router.get("/examples")
async def list_examples(
    content: ContentRepository = Depends(get_content),
) -> JSONResponse:
    """§3.1 — los 14 presets, ordenados por ``order``, sin ``source_code``."""
    return envelope_ok(
        ExamplesList(examples=[_summary(e) for e in content.examples()])
    )


@router.get("/examples/{example_id}")
async def get_example(
    example_id: str,
    content: ContentRepository = Depends(get_content),
) -> JSONResponse:
    """§3.2 — detalle con código; 404 EXAMPLE_NOT_FOUND si no existe."""
    example = content.example(example_id)
    if example is None:
        return envelope_error(
            404, "EXAMPLE_NOT_FOUND", f"No existe el ejemplo {example_id}"
        )
    detail = ExampleDetail(
        **_summary(example).model_dump(),
        source_code=example.source_code,
        lesson_id=example.lesson_id,
        expected_output_note=example.expected_output_note,
        takeaways=list(example.takeaways),
    )
    return envelope_ok(detail)
