"""Suite local de WP2 — AUTOSUFICIENTE (regla de la ola 1).

No importa módulos de WP1/WP3: los repositorios y el contenido se fakean
contra las firmas CONGELADAS de data-model.md §5. Si WP1 ya está mergeado se
usa su ``JobRecord`` real; si no, se inyecta un módulo fake byte-compatible.
"""

from __future__ import annotations

import sys
import types
from dataclasses import dataclass
from pathlib import Path

# `import app...` debe resolver contra backend/ (esta suite vive dentro).
_BACKEND_DIR = str(Path(__file__).resolve().parent.parent)
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)


def _install_fake_records() -> None:
    """Fake de ``app.repositories.records`` (firma EXACTA de data-model §5)."""
    try:
        import app.repositories.records  # noqa: F401 — WP1 ya mergeado
        return
    except ImportError:
        pass
    if "app.repositories.records" in sys.modules:
        return

    records = types.ModuleType("app.repositories.records")

    @dataclass(frozen=True)
    class JobRecord:
        id: str
        source_kind: str  # 'example' | 'editor' | 'upload'
        example_id: str | None
        lesson_id: str | None
        filename: str
        source_code: str
        threads: int
        timeout_s: int
        runner_image: str
        status: str
        container_id: str | None
        error_detail: str | None
        exit_code: int | None
        oom_killed: bool
        stdout: str | None
        stderr: str | None
        output_truncated: bool
        metrics_summary: dict | None
        parsed_timings: dict | None
        created_at: str
        started_at: str | None
        finished_at: str | None
        wall_time_ms: int | None

    records.JobRecord = JobRecord  # type: ignore[attr-defined]
    pkg = sys.modules.get("app.repositories")
    if pkg is None:
        pkg = types.ModuleType("app.repositories")
        pkg.__path__ = []  # type: ignore[attr-defined]
        sys.modules["app.repositories"] = pkg
    pkg.records = records  # type: ignore[attr-defined]
    sys.modules["app.repositories.records"] = records


_install_fake_records()
