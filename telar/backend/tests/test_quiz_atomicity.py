"""BL-04 (auditoría §3) — atomicidad REAL de ``QuizService.submit_attempt``.

El contrato (data-model §2/§5) exige que intento→progreso sea UNA unidad de
escritura: statements + UN solo ``commit()``/``rollback()`` dentro de
``write_lock``. Antes del fix, ``QuizAttemptRepository.create`` y
``ProgressRepository.upsert`` comiteaban cada uno por su cuenta: un fallo
entre ambos commits dejaba el intento persistido (incluso aprobado) sin
actualizar jamás ``best_quiz_score``/``completed`` para ese intento.

Escenario del reporte: crash simulado entre los dos pasos con un repo de
progreso que lanza en el upsert.
"""

from __future__ import annotations

import pytest

from app import db as db_module
from app.repositories.progress import ProgressRepository
from app.repositories.quiz_attempts import QuizAttemptRepository
from app.services.quiz_service import QuizService
from app.tools.seed_content import seed_content_into


class ExplodingProgressRepo:
    """Progreso que falla SIEMPRE al escribir (simula crash a mitad de unidad).

    Cubre tanto la firma congelada (``upsert``) como cualquier variante
    sin-commit que el servicio use internamente tras el fix.
    """

    async def upsert(self, lesson_id, **kwargs):
        raise RuntimeError("boom en upsert")

    async def upsert_no_commit(self, lesson_id, **kwargs):
        raise RuntimeError("boom en upsert")


def _service(db, real_content, progress) -> QuizService:
    return QuizService(
        content=real_content,
        attempts=QuizAttemptRepository(db),
        progress=progress,
        write_lock=db_module.write_lock,
        db=db,
    )


def _correct_answers(real_content, lesson_id: str) -> dict[str, str]:
    quiz = real_content.quiz(lesson_id)
    return {q.id: q.correct_key for q in quiz.questions}


async def _count_attempts(db, lesson_id: str) -> int:
    cur = await db.execute(
        "SELECT COUNT(*) FROM quiz_attempts WHERE lesson_id = ?", (lesson_id,)
    )
    return int((await cur.fetchone())[0])


async def test_fallo_en_upsert_no_persiste_el_intento(db, real_content):
    """BL-04: si el paso 2 (progreso) falla, el paso 1 (intento) se revierte."""
    await seed_content_into(db)  # producción: contenido y estado, misma conexión
    service = _service(db, real_content, ExplodingProgressRepo())
    answers = _correct_answers(real_content, "spmd")

    with pytest.raises(RuntimeError, match="boom"):
        await service.submit_attempt("spmd", answers)

    # La unidad entera se revirtió: ni intento ni progreso.
    assert await _count_attempts(db, "spmd") == 0
    assert await ProgressRepository(db).get("spmd") is None
    # El lock quedó liberado (depth 0) — la unidad no envenena el proceso.
    assert db_module.write_lock.locked() is False


async def test_tras_fallo_un_intento_sano_funciona(db, real_content):
    """La conexión no queda con una transacción a medias tras el rollback."""
    await seed_content_into(db)
    answers = _correct_answers(real_content, "spmd")
    broken = _service(db, real_content, ExplodingProgressRepo())
    with pytest.raises(RuntimeError):
        await broken.submit_attempt("spmd", answers)

    healthy = _service(db, real_content, ProgressRepository(db))
    result = await healthy.submit_attempt("spmd", answers)
    assert result.passed is True
    assert await _count_attempts(db, "spmd") == 1
    record = await ProgressRepository(db).get("spmd")
    assert record is not None
    assert record.completed is True
    assert record.best_quiz_score == result.score


async def test_unidad_feliz_intento_y_progreso_persisten(db, real_content):
    """GREEN de referencia: la unidad completa persiste ambos pasos."""
    await seed_content_into(db)
    service = _service(db, real_content, ProgressRepository(db))
    answers = _correct_answers(real_content, "spmd")
    result = await service.submit_attempt("spmd", answers)

    assert result.score == result.total == len(answers)
    assert await _count_attempts(db, "spmd") == 1
    record = await ProgressRepository(db).get("spmd")
    assert record.completed is True
    assert record.best_quiz_score == len(answers)


# ─── F1 (review DB de la S2): snapshot obsoleto vs escrituras admin ──────────
#
# El intento se puntúa contra el snapshot en memoria ANTES de tomar el lock.
# Si un admin reemplazó/borró el quiz (o borró la lección) y su commit ya está
# en la DB, la unidad del intento debe ABORTAR dentro del lock — de lo
# contrario pisaría la purga de BL-01 o el reset de BL-06 (y el MAX-ratchet de
# best_quiz_score haría permanente la nota imposible).


async def test_quiz_reducido_en_vuelo_aborta_el_intento(db, real_content):
    from app.services.quiz_service import QuizValidationError
    from app.tools.seed_content import seed_content_into

    await seed_content_into(db)
    service = _service(db, real_content, ProgressRepository(db))
    answers = _correct_answers(real_content, "spmd")

    # el admin redujo el quiz a 1 pregunta; su commit llegó ANTES de que el
    # intento (puntuado con el snapshot viejo de 5) tomara el lock
    await db.execute(
        "DELETE FROM quiz_questions WHERE lesson_id = 'spmd' AND id != 'spmd-q1'"
    )
    await db.commit()

    with pytest.raises(QuizValidationError):
        await service.submit_attempt("spmd", answers)
    assert await _count_attempts(db, "spmd") == 0
    assert await ProgressRepository(db).get("spmd") is None


async def test_umbral_cambiado_en_vuelo_aborta_el_intento(db, real_content):
    from app.services.quiz_service import QuizValidationError
    from app.tools.seed_content import seed_content_into

    await seed_content_into(db)
    service = _service(db, real_content, ProgressRepository(db))
    answers = _correct_answers(real_content, "spmd")

    await db.execute("UPDATE lessons SET pass_threshold = 0.99 WHERE id = 'spmd'")
    await db.commit()

    with pytest.raises(QuizValidationError):
        await service.submit_attempt("spmd", answers)
    assert await _count_attempts(db, "spmd") == 0


async def test_leccion_borrada_en_vuelo_aborta_el_intento(db, real_content):
    from app.services.quiz_service import LessonNotFoundError
    from app.tools.seed_content import seed_content_into

    await seed_content_into(db)
    service = _service(db, real_content, ProgressRepository(db))
    answers = _correct_answers(real_content, "spmd")

    # borrado admin ya commiteado (CASCADE elimina ejemplo y quiz; la purga
    # de BL-01 ya limpió progreso/intentos)
    await db.execute("DELETE FROM lessons WHERE id = 'spmd'")
    await db.commit()

    with pytest.raises(LessonNotFoundError):
        await service.submit_attempt("spmd", answers)
    # el intento obsoleto NO resucita filas para el id borrado (BL-01)
    assert await _count_attempts(db, "spmd") == 0
    assert await ProgressRepository(db).get("spmd") is None
