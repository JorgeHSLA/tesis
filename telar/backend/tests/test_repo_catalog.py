"""Repositorio del catálogo (Fase 5) contra ``:memory:`` + el schema.sql REAL.

Lo que se defiende aquí:

- **El manifiesto es la selección del estudiante.** Los módulos del baseline no
  tienen fila (`origin='local'` + ausencia = «no vino del catálogo»), y quien
  sí la tiene conserva su `installed_at` cuando se actualiza.
- **Refrescar el índice NO es actualizar.** `set_available_*` toca
  `available_*`/`last_checked_at` y deja `updated_at` quieto: en `/cursos` son
  dos fechas distintas y confundirlas mentiría.
- **La caché del índice es opcional por diseño.** Corrupta o ausente da lo
  mismo: `None`, nunca una excepción que se convierta en 500.
- **El PAR que justifica `rescore_progress_no_commit`**:
  `test_upsert_no_puede_bajar_best_score` demuestra que el camino normal
  (`ProgressRepository.upsert`, con `MAX()`/`COALESCE()`) es INCAPAZ de bajar la
  nota o de anularla, y `test_rescore_puede_bajar_y_anular_best_score` demuestra
  que la variante absoluta sí. Sin ese par, un 4/4 obsoleto se quedaría pegado
  para siempre y en silencio tras cada actualización (data-model §8.4).
"""

from __future__ import annotations

import asyncio
import json

import aiosqlite
import pytest

from app.repositories import catalog as repo
from app.repositories.progress import ProgressRepository

# ──────────────────────────────── semillas ──────────────────────────────────

#: Índice mínimo del bucket (§11.10), con acentos para vigilar el unicode.
INDICE = {
    "index_format": 1,
    "generated_at": "2026-08-29T10:12:00.000Z",
    "modules": [
        {
            "id": "m9",
            "title": "Tareas y dependencias",
            "description": "omp task, taskwait y el grafo de dependencias.",
            "version": 2,
            "checksum": "1a" * 32,
            "object_path": "modulos/m9/v2.json",
        }
    ],
}

CHECKSUM_V2 = "1a" * 32
CHECKSUM_V3 = "9f" * 32


async def _sembrar_modulo(
    db: aiosqlite.Connection, module_id: str = "m9", *, order: int = 9
) -> None:
    """Un módulo local; sin él la FK del manifiesto no resuelve."""
    await db.execute(
        'INSERT INTO modules (id, "order", title, description, level) '
        "VALUES (?, ?, ?, ?, ?)",
        (module_id, order, f"Módulo {module_id}", "descripción", "Avanzado"),
    )


async def _instalar(
    db: aiosqlite.Connection,
    module_id: str = "m9",
    *,
    version: int = 2,
    checksum: str = CHECKSUM_V2,
) -> None:
    await repo.upsert_installed_no_commit(
        db,
        module_id=module_id,
        object_path=f"modulos/{module_id}/v{version}.json",
        installed_version=version,
        installed_checksum=checksum,
    )


async def _progreso(
    db: aiosqlite.Connection,
    lesson_id: str = "task-intro",
    *,
    best: int | None = 4,
    completed: bool = True,
    via: str | None = "quiz",
) -> None:
    await db.execute(
        "INSERT INTO lesson_progress "
        "(lesson_id, viewed, completed, best_quiz_score, completed_via, completed_at) "
        "VALUES (?, 1, ?, ?, ?, ?)",
        (
            lesson_id,
            int(completed),
            best,
            via,
            "2026-03-12T10:00:00.000Z" if completed else None,
        ),
    )


# ─────────────────────── manifiesto: qué hay instalado ──────────────────────


async def test_baseline_no_tiene_manifiesto(db):
    """`origin='local'` + ausencia de fila = «no vino del catálogo» (§8.2)."""
    await _sembrar_modulo(db, "m1", order=1)

    assert await repo.get_installed(db, "m1") is None
    assert await repo.list_installed(db) == []


async def test_registrar_instalacion_y_leerla(db):
    await _sembrar_modulo(db)

    await _instalar(db)

    fila = await repo.get_installed(db, "m9")
    assert fila is not None
    assert fila.module_id == "m9"
    assert fila.object_path == "modulos/m9/v2.json"
    assert fila.installed_version == 2
    assert fila.installed_checksum == CHECKSUM_V2
    # Recién instalado: nadie ha mirado el bucket todavía y nadie ha editado.
    assert fila.available_version is None
    assert fila.available_checksum is None
    assert fila.locally_modified is False
    assert fila.last_checked_at is None
    assert fila.installed_at.endswith("Z")
    assert fila.updated_at.endswith("Z")


async def test_list_installed_ordenado_y_sin_baseline(db):
    for module_id, order in (("m9", 9), ("m2", 2), ("m1", 1)):
        await _sembrar_modulo(db, module_id, order=order)
    await _instalar(db, "m9")
    await _instalar(db, "m2")  # m1 es baseline: no se instala

    assert [f.module_id for f in await repo.list_installed(db)] == ["m2", "m9"]


async def test_actualizar_conserva_installed_at_y_refresca_updated_at(db):
    """`installed_at` es «desde cuándo lo tienes», no «cuándo se actualizó»."""
    await _sembrar_modulo(db)
    await _instalar(db, version=2)
    original = await repo.get_installed(db, "m9")
    assert original is not None

    await asyncio.sleep(0.01)  # el reloj de SQLite tiene milisegundos
    await _instalar(db, version=3, checksum=CHECKSUM_V3)

    fila = await repo.get_installed(db, "m9")
    assert fila is not None
    assert fila.installed_at == original.installed_at
    assert fila.updated_at > original.updated_at
    assert fila.installed_version == 3
    assert fila.installed_checksum == CHECKSUM_V3
    assert fila.object_path == "modulos/m9/v3.json"


async def test_upsert_es_absoluto_y_limpia_locally_modified(db):
    """Tras aplicar el bundle, el módulo local vuelve a ser el remoto."""
    await _sembrar_modulo(db)
    await _instalar(db, version=2)
    await repo.set_locally_modified_no_commit(db, "m9", True)
    await repo.set_available_no_commit(
        db, "m9", available_version=3, available_checksum=CHECKSUM_V3
    )

    await _instalar(db, version=3, checksum=CHECKSUM_V3)

    fila = await repo.get_installed(db, "m9")
    assert fila is not None
    assert fila.locally_modified is False
    assert fila.available_version is None  # ya no hay nada pendiente
    assert fila.available_checksum is None


async def test_manifiesto_de_modulo_inexistente_revienta(db):
    """La FK (foreign_keys=ON) impide un manifiesto sin módulo detrás."""
    with pytest.raises(aiosqlite.IntegrityError):
        await _instalar(db, "fantasma")


async def test_borrar_el_modulo_cascadea_al_manifiesto(db):
    await _sembrar_modulo(db)
    await _instalar(db)

    await db.execute("DELETE FROM modules WHERE id = ?", ("m9",))

    assert await repo.get_installed(db, "m9") is None


# ───────────────────── refresco del índice (§11.4.2) ────────────────────────


async def test_set_available_enciende_la_actualizacion_disponible(db):
    await _sembrar_modulo(db)
    await _instalar(db, version=2)

    afectada = await repo.set_available_no_commit(
        db, "m9", available_version=5, available_checksum=CHECKSUM_V3
    )

    fila = await repo.get_installed(db, "m9")
    assert afectada is True
    assert fila is not None
    assert fila.available_version == 5 > fila.installed_version
    assert fila.available_checksum == CHECKSUM_V3
    assert fila.last_checked_at is not None


async def test_set_available_apaga_lo_que_desaparece_del_indice(db):
    """ABSOLUTO: un COALESCE dejaría pegada una versión que ya no se publica."""
    await _sembrar_modulo(db)
    await _instalar(db, version=2)
    await repo.set_available_no_commit(
        db, "m9", available_version=5, available_checksum=CHECKSUM_V3
    )

    await repo.set_available_no_commit(
        db, "m9", available_version=None, available_checksum=None,
        checked_at="2026-08-29T10:12:00.000Z",
    )

    fila = await repo.get_installed(db, "m9")
    assert fila is not None
    assert fila.available_version is None
    assert fila.available_checksum is None
    assert fila.last_checked_at == "2026-08-29T10:12:00.000Z"


async def test_refrescar_no_toca_updated_at(db):
    """Mirar el bucket no es haber actualizado nada (§11.4.1)."""
    await _sembrar_modulo(db)
    await _instalar(db, version=2)
    antes = await repo.get_installed(db, "m9")
    assert antes is not None

    await asyncio.sleep(0.01)
    await repo.set_available_no_commit(
        db, "m9", available_version=5, available_checksum=CHECKSUM_V3
    )

    fila = await repo.get_installed(db, "m9")
    assert fila is not None
    assert fila.updated_at == antes.updated_at
    assert fila.last_checked_at is not None
    assert fila.last_checked_at > antes.updated_at


async def test_refrescar_un_modulo_sin_manifiesto_no_instala_nada(db):
    await _sembrar_modulo(db, "m1", order=1)

    afectada = await repo.set_available_no_commit(
        db, "m1", available_version=3, available_checksum=CHECKSUM_V3
    )

    assert afectada is False
    assert await repo.get_installed(db, "m1") is None


# ────────────────── edición local y desinstalación ──────────────────────────


async def test_marcar_y_desmarcar_locally_modified(db):
    await _sembrar_modulo(db)
    await _instalar(db)

    assert await repo.set_locally_modified_no_commit(db, "m9", True) is True
    marcado = await repo.get_installed(db, "m9")
    assert marcado is not None and marcado.locally_modified is True

    assert await repo.set_locally_modified_no_commit(db, "m9", False) is True
    limpio = await repo.get_installed(db, "m9")
    assert limpio is not None and limpio.locally_modified is False


async def test_marcar_un_modulo_sin_manifiesto_no_es_error(db):
    """El writer admin llama a ciegas: un módulo del baseline devuelve False."""
    await _sembrar_modulo(db, "m1", order=1)

    assert await repo.set_locally_modified_no_commit(db, "m1", True) is False


async def test_desinstalar_borra_solo_el_manifiesto(db):
    """Desinstalar es quitar la procedencia; el contenido y el progreso son
    del servicio (y el progreso se conserva, §8.4/E2)."""
    await _sembrar_modulo(db)
    await _instalar(db)
    await _progreso(db)

    assert await repo.delete_installed_no_commit(db, "m9") is True

    assert await repo.get_installed(db, "m9") is None
    cursor = await db.execute("SELECT COUNT(*) FROM modules WHERE id = 'm9'")
    assert (await cursor.fetchone())[0] == 1
    cursor = await db.execute("SELECT COUNT(*) FROM lesson_progress")
    assert (await cursor.fetchone())[0] == 1
    # Idempotente: desinstalar dos veces no revienta, solo devuelve False.
    assert await repo.delete_installed_no_commit(db, "m9") is False


# ───────────────────────── bitácora de actualizaciones ──────────────────────


async def test_log_update_guarda_el_informe_y_devuelve_su_id(db):
    informe = {"archived": ["taskloop"], "nota": "se conservó el avance"}

    entrada_id = await repo.log_update_no_commit(
        db, module_id="m9", from_version=2, to_version=3, report=informe
    )

    historial = await repo.list_update_log(db, "m9")
    assert len(historial) == 1
    entrada = historial[0]
    assert entrada.id == entrada_id
    assert entrada.from_version == 2
    assert entrada.to_version == 3
    assert entrada.report == informe  # ida y vuelta por JSON, acentos incluidos
    assert entrada.created_at.endswith("Z")


async def test_log_update_admite_instalacion_sin_version_previa(db):
    await repo.log_update_no_commit(
        db, module_id="m9", from_version=None, to_version=1, report={}
    )

    entrada = (await repo.list_update_log(db, "m9"))[0]
    assert entrada.from_version is None


async def test_list_update_log_del_mas_reciente_al_mas_viejo(db):
    for version in (2, 3, 4):
        await repo.log_update_no_commit(
            db, module_id="m9", from_version=version - 1, to_version=version,
            report={"v": version},
        )
    await repo.log_update_no_commit(
        db, module_id="m2", from_version=1, to_version=2, report={}
    )

    historial = await repo.list_update_log(db, "m9", limit=2)

    assert [e.to_version for e in historial] == [4, 3]  # ajeno a m2


# ──────────────────────── caché del índice remoto ───────────────────────────


async def test_cache_del_indice_ida_y_vuelta(db):
    guardado = await repo.save_index_cache_no_commit(
        db, bucket="telar-modulos", index=INDICE
    )

    leido = await repo.get_index_cache(db)
    assert leido == guardado
    assert leido is not None
    assert leido.bucket == "telar-modulos"
    assert leido.index == INDICE  # unicode y orden intactos
    assert leido.fetched_at.endswith("Z")


async def test_cache_ausente_es_none(db):
    assert await repo.get_index_cache(db) is None


async def test_cache_se_reemplaza_en_una_sola_fila(db):
    await repo.save_index_cache_no_commit(db, bucket="viejo", index=INDICE)

    await repo.save_index_cache_no_commit(
        db,
        bucket="telar-modulos",
        index={"index_format": 1, "generated_at": "x", "modules": []},
        fetched_at="2026-08-29T10:12:00.000Z",
    )

    cursor = await db.execute(
        "SELECT COUNT(*) FROM app_meta WHERE key = ?", (repo.INDEX_CACHE_KEY,)
    )
    assert (await cursor.fetchone())[0] == 1
    leido = await repo.get_index_cache(db)
    assert leido is not None
    assert leido.bucket == "telar-modulos"
    assert leido.fetched_at == "2026-08-29T10:12:00.000Z"
    assert leido.index["modules"] == []


async def test_cache_ilegible_es_cache_ausente(db):
    """Una caché corrupta degrada a 503, no revienta con un 500."""
    await db.execute(
        "INSERT INTO app_meta (key, value) VALUES (?, ?)",
        (repo.INDEX_CACHE_KEY, "{no es json"),
    )
    assert await repo.get_index_cache(db) is None

    await db.execute(
        "UPDATE app_meta SET value = ? WHERE key = ?",
        (json.dumps({"bucket": "b"}), repo.INDEX_CACHE_KEY),  # sin 'index'
    )
    assert await repo.get_index_cache(db) is None


async def test_clear_index_cache(db):
    await repo.save_index_cache_no_commit(db, bucket="b", index=INDICE)

    assert await repo.clear_index_cache_no_commit(db) is True
    assert await repo.get_index_cache(db) is None
    assert await repo.clear_index_cache_no_commit(db) is False


# ─────────────────────── disciplina de escritura ────────────────────────────


async def test_ninguna_escritura_confirma_por_su_cuenta(db):
    """Todo lo de aquí es pieza de una unidad compuesta: el commit es del
    servicio (``content_writer._persist``). Si el repo confirmara, un fallo
    posterior dejaría el manifiesto adelantado al contenido."""
    await _sembrar_modulo(db)
    await _instalar(db)
    await repo.log_update_no_commit(
        db, module_id="m9", from_version=None, to_version=2, report={}
    )
    await repo.save_index_cache_no_commit(db, bucket="b", index=INDICE)

    assert db.in_transaction is True
    await db.rollback()

    assert await repo.get_installed(db, "m9") is None
    assert await repo.list_update_log(db, "m9") == []
    assert await repo.get_index_cache(db) is None


# ══════════════ el PAR: por qué existe rescore_progress_no_commit ═══════════


async def test_upsert_no_puede_bajar_best_score(db):
    """El camino NORMAL es incapaz: `_UPSERT_SQL` aplica `MAX()`/`COALESCE()`.

    Pareja de `test_rescore_puede_bajar_y_anular_best_score`. Es correcto para
    el estudiante que reintenta un quiz (su mejor marca no baja), y por eso
    mismo NO sirve para una actualización que cambió las preguntas.
    """
    await _progreso(db, best=4)
    progreso = ProgressRepository(db)

    await progreso.upsert("task-intro", best_quiz_score=1)  # peor nota
    assert (await progreso.get("task-intro")).best_quiz_score == 4

    await progreso.upsert("task-intro", best_quiz_score=None)  # "anular"
    assert (await progreso.get("task-intro")).best_quiz_score == 4


async def test_rescore_puede_bajar_y_anular_best_score(db):
    """La variante ABSOLUTA sí: baja el valor y escribe NULL."""
    await _progreso(db, best=4)
    progreso = ProgressRepository(db)

    assert await repo.rescore_progress_no_commit(
        db, "task-intro", best_quiz_score=1
    ) is True
    assert (await progreso.get("task-intro")).best_quiz_score == 1

    assert await repo.rescore_progress_no_commit(
        db, "task-intro", best_quiz_score=None
    ) is True
    assert (await progreso.get("task-intro")).best_quiz_score is None


async def test_anular_la_nota_conserva_el_historico(db):
    """`best_quiz_score` es una CACHÉ de `quiz_attempts`: anularla no pierde
    nada, el 4/4 sigue ahí con su fecha (algoritmoMerge §P3)."""
    await _progreso(db, best=4)
    await db.execute(
        "INSERT INTO quiz_attempts (id, lesson_id, answers, score, total, passed) "
        "VALUES ('att1', 'task-intro', '{\"q1\":\"b\"}', 4, 4, 1)"
    )

    await repo.rescore_progress_no_commit(db, "task-intro", best_quiz_score=None)

    cursor = await db.execute(
        "SELECT score, total FROM quiz_attempts WHERE lesson_id = 'task-intro'"
    )
    assert tuple(await cursor.fetchone()) == (4, 4)


async def test_rescore_nunca_revoca_un_completed(db):
    """Monotonía (§8.4): subir el umbral no quita lo ya aprobado. Si actualizar
    pudiera empeorarte, nadie actualizaría."""
    await _progreso(db, best=4, completed=True, via="quiz")

    await repo.rescore_progress_no_commit(
        db, "task-intro", best_quiz_score=None, completed=False
    )

    fila = await ProgressRepository(db).get("task-intro")
    assert fila.completed is True
    assert fila.completed_via == "quiz"
    assert fila.best_quiz_score is None  # la nota sí se anula


async def test_rescore_puede_conceder_completed_y_sella_la_fecha(db):
    """Bajó el `pass_threshold`: el histórico ahora aprueba."""
    await _progreso(db, best=3, completed=False, via=None)

    await repo.rescore_progress_no_commit(
        db, "task-intro", best_quiz_score=3, completed=True, completed_via="quiz"
    )

    fila = await ProgressRepository(db).get("task-intro")
    assert fila.completed is True
    assert fila.completed_via == "quiz"
    assert fila.completed_at is not None and fila.completed_at.endswith("Z")


async def test_rescore_no_pisa_el_completed_at_original(db):
    await _progreso(db, best=4, completed=True, via="quiz")

    await repo.rescore_progress_no_commit(
        db, "task-intro", best_quiz_score=2, completed=True, completed_via="quiz"
    )

    fila = await ProgressRepository(db).get("task-intro")
    assert fila.completed_at == "2026-03-12T10:00:00.000Z"


async def test_rescore_sin_progreso_no_crea_fila(db):
    """UPDATE puro: una lección que nadie tocó no tiene nada que recalificar."""
    assert await repo.rescore_progress_no_commit(
        db, "task-intro", best_quiz_score=2
    ) is False

    cursor = await db.execute("SELECT COUNT(*) FROM lesson_progress")
    assert (await cursor.fetchone())[0] == 0
