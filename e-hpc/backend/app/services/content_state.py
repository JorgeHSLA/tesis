"""Reload atómico del snapshot de contenido (Fase 4, design §4).

``reload_content(app)`` reconstruye un ``ContentRepository`` COMPLETO desde la
DB y solo entonces reemplaza la referencia ``app.state.content`` (build-then-
swap). Correcto en un único event loop porque:

1. el snapshot es inmutable (``frozen`` + tuplas);
2. los 8 lectores de ``ContentRepository`` son síncronos y no ceden el loop;
3. los handlers ligan ``content = request.app.state.content`` una sola vez al
   inicio del request (patrón ``get_content``).

**Invariante**: un handler NO debe re-leer ``app.state.content`` entre
``await``s — debe ligarlo una vez. Así ningún GET concurrente ve estado a
medias durante un reload.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.repositories.content import ContentRepository

if TYPE_CHECKING:
    from fastapi import FastAPI


async def reload_content(app: "FastAPI") -> None:
    """Reconstruye el snapshot desde ``app.state.db`` y hace swap atómico."""
    new_content = await ContentRepository.load(app.state.db)  # build completo
    app.state.content = new_content  # swap atómico (asignación única)
