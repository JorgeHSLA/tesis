"""Directorios de código de los jobs (architecture §3.1) — sin importar ``docker``.

Vive aparte de ``docker_service`` para que el arranque pueda barrer los
directorios huérfanos aunque no haya cliente Docker (CU-25.1).
"""

from __future__ import annotations

import logging
import shutil
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover
    from ..config import Settings

logger = logging.getLogger("telar.code_dirs")

#: Punto de montaje del volumen de submissions en modo ``volume`` (compose).
VOLUME_BASE_DIR = Path("/submissions")


def code_base_dir(settings: "Settings") -> Path:
    """bind: ``TELAR_JOBS_DIR`` del host · volume: el volumen montado."""
    if settings.code_delivery == "bind":
        return settings.jobs_dir_expanded
    return VOLUME_BASE_DIR


def sweep_code_dirs(base: Path) -> int:
    """Borra cada subdirectorio de ``base``; cuenta solo los que ya no existen
    (CU-25.2: un borrado fallido se registra y no se da por hecho)."""
    if not base.is_dir():
        return 0
    removed = 0
    for child in base.iterdir():
        if not child.is_dir():
            continue
        try:
            shutil.rmtree(child)
        except OSError:
            logger.warning("barrido: no se pudo borrar %s", child, exc_info=True)
        if not child.exists():
            removed += 1
    return removed
