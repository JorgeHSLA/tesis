"""ANOMALÍAS del app detectadas por WP9 — documentadas como tests.

Estos tests DEMUESTRAN bugs reales del código verificado de WP1-WP3 que WP9
no puede arreglar (regla de propiedad: se reportan a integración). Cuando
integración los arregle, estos tests fallarán a propósito y deben
eliminarse/invertirse junto con el workaround del conftest.

ANOMALÍA WP9-01 — CORREGIDA por integración: deadlock en
POST /api/v1/lessons/{id}/quiz/attempts:
- ``main.py`` publica ``app.state.write_lock = db.write_lock`` (la MISMA
  instancia que usan los repositorios de WP1 por dentro).
- ``QuizService.submit_attempt`` (WP3) adquiere ese lock para la unidad
  intento→progreso… y ``QuizAttemptRepository.create`` /
  ``ProgressRepository.upsert`` (WP1) lo RE-adquieren dentro.
- Antes: ``asyncio.Lock`` no era reentrante ⇒ la request quedaba colgada.
- Fix: ``db.write_lock`` es ahora ``db.ReentrantWriteLock`` (reentrante por
  task), así la unidad compuesta re-adquiere el lock sin autobloquearse y
  mantiene la exclusión mutua frente a otros escritores. El test WP9-01 se
  INVIRTIÓ para verificar que el wiring compartido REAL ya no se deadlockea.
- No lo detectó nadie antes porque la suite local de WP3 usa repos FAKE que
  solo INSPECCIONAN ``lock.locked()`` sin adquirirlo.

ANOMALÍA WP9-02 — CORREGIDA por integración (BL-05, auditoría §3):
api-contract §7.1 exige «al terminar bien el job se actualiza
``lesson_progress.last_job_id``». Antes ni ``job_runner`` ni ``routers/jobs``
tocaban ``ProgressRepository`` y el campo quedaba ``NULL`` para siempre.
- Fix: ``JobRunner`` recibe el ``ProgressRepository`` y ``start()`` propaga
  ``lesson_id`` al ``JobHandle``; al terminar ``completed`` un job con
  ``lesson_id``, el runner hace ``upsert(last_job_id)`` bajo ``write_lock``
  ANTES de confirmar el estado terminal — cualquier observador que ya vea
  ``completed`` ve también ``last_job_id``. El test WP9-02 se INVIRTIÓ para
  verificar el comportamiento correcto del contrato.
"""

from __future__ import annotations

import asyncio

import pytest

from app import db as db_module
from app.repositories.progress import ProgressRepository
from app.repositories.quiz_attempts import QuizAttemptRepository
from app.services.quiz_service import QuizService


async def test_ANOMALIA_WP9_01_quiz_attempt_wiring_real_ya_no_deadlockea(
    db, real_content
):
    """WP9-01 CORREGIDA: con el wiring de producción (lock COMPARTIDO, la MISMA
    instancia que los repos re-adquieren), ``submit_attempt`` ahora COMPLETA en
    milisegundos gracias a ``ReentrantWriteLock``. Antes se deadlockeaba."""
    assert isinstance(db_module.write_lock, db_module.ReentrantWriteLock)
    service = QuizService(
        content=real_content,
        attempts=QuizAttemptRepository(db),
        progress=ProgressRepository(db),
        write_lock=db_module.write_lock,  # ← la misma instancia que los repos
        db=db,
    )
    quiz = real_content.quiz("spmd")
    answers = {q.id: q.correct_key for q in quiz.questions}
    # ya NO debe colgar: si volviera el deadlock, wait_for lanzaría TimeoutError
    result = await asyncio.wait_for(service.submit_attempt("spmd", answers), 2.0)
    assert result.score == result.total == len(answers)
    assert result.passed is True
    # el lock quedó liberado tras la unidad (depth 0)
    assert db_module.write_lock.locked() is False
    record = await ProgressRepository(db).get("spmd")
    assert record.completed is True
    assert record.best_quiz_score == len(answers)


async def test_workaround_lock_separado_funciona(db, real_content):
    """El mismo flujo con un lock de servicio SEPARADO (workaround del
    conftest de WP9) termina y produce el resultado del contrato §5.2."""
    service = QuizService(
        content=real_content,
        attempts=QuizAttemptRepository(db),
        progress=ProgressRepository(db),
        write_lock=asyncio.Lock(),  # instancia distinta de db.write_lock
        db=db,
    )
    quiz = real_content.quiz("spmd")
    answers = {q.id: q.correct_key for q in quiz.questions}
    result = await asyncio.wait_for(service.submit_attempt("spmd", answers), 5.0)
    assert result.score == result.total == len(answers)
    assert result.passed is True
    record = await ProgressRepository(db).get("spmd")
    assert record.completed is True
    assert record.best_quiz_score == len(answers)


def test_WP9_02_corregida_last_job_id_se_actualiza(client, fake_docker):
    """§7.1 (WP9-02 CORREGIDA): un job con ``lesson_id`` que termina bien
    deja ``lesson_progress.last_job_id`` apuntando al job — y como el upsert
    ocurre antes del commit terminal, quien ve ``completed`` ya lo ve."""
    from conftest import wait_terminal

    response = client.post(
        "/api/v1/jobs",
        json={"code": "print('leccion')\n", "lesson_id": "primerEjemplo"},
    )
    assert response.status_code == 202
    job_id = response.json()["data"]["job_id"]
    detail = wait_terminal(client, job_id)
    assert detail["status"] == "completed"
    assert detail["lesson_id"] == "primerEjemplo"
    progress = client.get("/api/v1/progress").json()["data"]["lessons"]
    entry = progress.get("primerEjemplo")
    assert entry is not None, "el job completed debe crear la fila de progreso"
    assert entry["last_job_id"] == job_id
    # y NO toca los campos que gestiona el quiz/el estudiante
    assert entry["completed"] is False
    assert entry["best_quiz_score"] is None
    assert entry["viewed"] is False
