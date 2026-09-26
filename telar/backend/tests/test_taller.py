"""S6 · CU-28 — el taller guiado como tipo de lección.

Un taller (``kind='taller'``) es una lección con pasos ordenados y una casilla
«Lo hice» por paso. Al marcar el último, la lección queda completada
(``completed_via='manual'``) y cuenta en el progreso del módulo como cualquier
otra. Lo que se fija aquí:

* ``taller_completo`` es una función PURA: todos los pasos marcados, y un taller
  sin pasos nunca está completo.
* ``PUT /progress/lessons/{id}/steps/{idx}`` es idempotente, ``completed`` es
  monótono (desmarcar no descompleta) y respeta la regla única de
  disponibilidad: un taller deshabilitado o archivado no se completa.
* El endpoint genérico de progreso NO completa un taller: solo los pasos.
* Autoría: crear, editar, reordenar y borrar pasos; un taller no lleva quiz ni
  video; borrar la lección purga también sus casillas.

El taller de ejemplo vive SOLO en estas fixtures: el contenido base no cambia.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.repositories.content import WorkshopStep
from app.routers import admin
from app.services.content_state import reload_content
from app.services.taller import taller_completo

from conftest import build_app

TALLER = "tallerHilos"
OTRA = "spmd"  # lección base con quiz y ejemplo pareado
EJEMPLO = "primerEjemplo"

_BASE = (
    "module_id", "order", "title", "estimated_minutes", "content_markdown",
    "video_url", "enabled", "completion_rule", "recommended", "kind",
)


@pytest.fixture
def cliente(tmp_path, fake_docker):
    settings = Settings(
        db_path=str(tmp_path / "telar.db"),
        jobs_dir=str(tmp_path / "jobs"),
        allowed_origins="http://localhost:5173,null",
        code_delivery="bind",
        runner_image="telar-runner:0.5.1",
        max_timeout_s=120,
        max_concurrent_jobs=2,
        max_code_bytes=262144,
        max_output_bytes=262144,
        admin_mode=True,
    )
    app = build_app(settings=settings, docker=fake_docker)
    app.include_router(admin.router)
    with TestClient(app) as c:
        yield c


# ─────────────────────────────── helpers ─────────────────────────────────────


def _ok(respuesta, status: int = 200) -> dict:
    assert respuesta.status_code == status, respuesta.text
    return respuesta.json()["data"]


def _error(respuesta, status: int, code: str) -> dict:
    assert respuesta.status_code == status, respuesta.text
    cuerpo = respuesta.json()
    assert cuerpo["success"] is False
    assert cuerpo["error"]["code"] == code, cuerpo
    return cuerpo["error"]


def crear_taller(cliente, lid: str = TALLER, *, pasos: int = 3, **over) -> dict:
    cuerpo = {
        "id": lid,
        "module_id": "m1",
        "order": 50,
        "title": "Taller: tus primeros hilos",
        "estimated_minutes": 20,
        "content_markdown": "# Taller\n\nSigue los pasos.\n",
        "completion_rule": "viewed",
        "kind": "taller",
    }
    cuerpo.update(over)
    _ok(cliente.post("/api/v1/admin/lessons", json=cuerpo), 201)
    for n in range(pasos):
        _ok(
            cliente.post(
                f"/api/v1/admin/lessons/{lid}/steps",
                json={
                    "title": f"Paso {n + 1}",
                    "body_markdown": f"Haz la cosa {n + 1}.\n",
                    "example_id": EJEMPLO if n == 0 else None,
                },
            ),
            201,
        )
    return _ok(cliente.get(f"/api/v1/admin/lessons/{lid}"))


def marcar(cliente, idx: int, done: bool = True, lid: str = TALLER):
    return cliente.put(
        f"/api/v1/progress/lessons/{lid}/steps/{idx}", json={"done": done}
    )


def _progreso(cliente, lesson_id: str) -> dict | None:
    return _ok(cliente.get("/api/v1/progress"))["lessons"].get(lesson_id)


def _ajustar(cliente, lesson_id: str, **cambios) -> None:
    detalle = _ok(cliente.get(f"/api/v1/admin/lessons/{lesson_id}"))
    cuerpo = {k: detalle[k] for k in _BASE} | cambios
    _ok(cliente.put(f"/api/v1/admin/lessons/{lesson_id}", json=cuerpo))


def _archivar(cliente, lesson_id: str) -> None:
    app = cliente.app

    async def _hazlo() -> None:
        await app.state.db.execute(
            "UPDATE lessons SET archived_at='2026-09-26T00:00:00.000Z' WHERE id=?",
            (lesson_id,),
        )
        await app.state.db.commit()
        await reload_content(app)

    cliente.portal.call(_hazlo)


def _filas(cliente, sql: str, *args) -> list[tuple]:
    app = cliente.app

    async def _leer():
        cursor = await app.state.db.execute(sql, args)
        return [tuple(r) for r in await cursor.fetchall()]

    return cliente.portal.call(_leer)


# ─────────────────────────── función pura ────────────────────────────────────


def _pasos(n: int) -> tuple[WorkshopStep, ...]:
    return tuple(
        WorkshopStep(idx=i, title=f"P{i}", body_markdown="b", example_id=None)
        for i in range(n)
    )


def test_taller_completo_exige_todos_los_pasos():
    assert taller_completo(_pasos(3), {0, 1, 2}) is True
    assert taller_completo(_pasos(3), {0, 2}) is False


def test_taller_completo_ignora_marcas_de_pasos_que_ya_no_existen():
    """Una marca vieja en un idx retirado no suple a un paso sin marcar."""
    assert taller_completo(_pasos(2), {0, 5}) is False
    assert taller_completo(_pasos(2), {0, 1, 5}) is True


def test_un_taller_sin_pasos_nunca_esta_completo():
    assert taller_completo((), set()) is False


# ─────────────────────── lectura: /lessons y /modules ────────────────────────


def test_la_leccion_normal_es_leccion_y_no_trae_pasos(cliente):
    detalle = _ok(cliente.get(f"/api/v1/lessons/{OTRA}"))
    assert detalle["kind"] == "leccion"
    assert detalle["steps"] == []


def test_el_taller_expone_kind_y_sus_pasos_con_su_estado(cliente):
    crear_taller(cliente)
    _ok(marcar(cliente, 1))
    detalle = _ok(cliente.get(f"/api/v1/lessons/{TALLER}"))
    assert detalle["kind"] == "taller"
    assert detalle["has_quiz"] is False and detalle["video_url"] is None
    assert [(p["idx"], p["title"], p["example_id"], p["done"]) for p in detalle["steps"]] == [
        (0, "Paso 1", EJEMPLO, False),
        (1, "Paso 2", None, True),
        (2, "Paso 3", None, False),
    ]
    assert detalle["steps"][0]["body_markdown"] == "Haz la cosa 1.\n"


def test_modules_lista_el_kind_de_cada_leccion(cliente):
    crear_taller(cliente)
    lecciones = {
        l["id"]: l
        for m in _ok(cliente.get("/api/v1/modules"))["modules"]
        for l in m["lessons"]
    }
    assert lecciones[TALLER]["kind"] == "taller"
    assert lecciones[OTRA]["kind"] == "leccion"


# ─────────────────────── casillas: el endpoint idempotente ───────────────────


def test_marcar_un_paso_lo_guarda_y_no_completa_todavia(cliente):
    crear_taller(cliente)
    resultado = _ok(marcar(cliente, 0))
    assert resultado == {
        "lesson_id": TALLER,
        "idx": 0,
        "done": True,
        "steps_done": 1,
        "steps_total": 3,
        "completed": False,
    }
    progreso = _progreso(cliente, TALLER)
    assert progreso is not None and progreso["completed"] is False
    # Marcar deja el taller como «visto»: tocado, así una actualización del
    # módulo lo archiva en vez de borrarlo con sus casillas.
    assert progreso["viewed"] is True


def test_marcar_el_ultimo_paso_completa_el_taller_como_manual(cliente):
    crear_taller(cliente)
    _ok(marcar(cliente, 0))
    _ok(marcar(cliente, 2))
    resultado = _ok(marcar(cliente, 1))
    assert resultado["completed"] is True
    assert resultado["steps_done"] == 3
    progreso = _progreso(cliente, TALLER)
    assert progreso["completed"] is True
    assert progreso["completed_via"] == "manual"


def test_marcar_dos_veces_es_idempotente(cliente):
    crear_taller(cliente, pasos=2)
    primera = _ok(marcar(cliente, 0))
    segunda = _ok(marcar(cliente, 0))
    assert primera == segunda
    assert _filas(
        cliente, "SELECT COUNT(*) FROM workshop_step_progress WHERE lesson_id=?", TALLER
    ) == [(1,)]


def test_desmarcar_quita_la_casilla_pero_no_descompleta(cliente):
    """`completed` es monótono: lo ganado no se revoca (api-contract §12)."""
    crear_taller(cliente, pasos=2)
    _ok(marcar(cliente, 0))
    _ok(marcar(cliente, 1))
    resultado = _ok(marcar(cliente, 1, done=False))
    assert resultado["done"] is False
    assert resultado["steps_done"] == 1
    assert resultado["completed"] is True
    assert _progreso(cliente, TALLER)["completed"] is True
    # Y desmarcar lo no marcado también es idempotente.
    assert _ok(marcar(cliente, 1, done=False))["steps_done"] == 1


def test_el_taller_completado_cuenta_en_el_progreso_del_modulo(cliente):
    crear_taller(cliente, pasos=1)
    antes = _ok(cliente.get("/api/v1/progress"))["summary"]["lessons_completed"]
    _ok(marcar(cliente, 0))
    despues = _ok(cliente.get("/api/v1/progress"))["summary"]
    assert despues["lessons_completed"] == antes + 1
    modulos = _ok(cliente.get("/api/v1/modules"))
    assert modulos["summary"]["lessons_completed"] == antes + 1


def test_paso_inexistente_da_404_step_not_found(cliente):
    crear_taller(cliente, pasos=2)
    _error(marcar(cliente, 2), 404, "STEP_NOT_FOUND")


def test_una_leccion_normal_no_tiene_pasos_que_marcar(cliente):
    _error(marcar(cliente, 0, lid=OTRA), 404, "STEP_NOT_FOUND")


def test_leccion_inexistente_da_404(cliente):
    _error(marcar(cliente, 0, lid="noExiste"), 404, "LESSON_NOT_FOUND")


def test_el_cuerpo_exige_done_booleano(cliente):
    crear_taller(cliente, pasos=1)
    respuesta = cliente.put(
        f"/api/v1/progress/lessons/{TALLER}/steps/0", json={"done": "sí"}
    )
    assert respuesta.status_code == 422


def test_el_put_generico_no_completa_un_taller(cliente):
    """En un taller la `completion_rule` guardada es 'viewed', pero la única vía
    que lo completa son sus pasos."""
    crear_taller(cliente)
    _ok(
        cliente.put(
            f"/api/v1/progress/lessons/{TALLER}",
            json={"viewed": True, "completed": True},
        )
    )
    assert _progreso(cliente, TALLER)["completed"] is False


@pytest.mark.parametrize("estado", ["deshabilitado", "archivado"])
def test_un_taller_no_disponible_guarda_la_casilla_pero_no_se_completa(cliente, estado):
    crear_taller(cliente, pasos=1)
    if estado == "deshabilitado":
        _ajustar(cliente, TALLER, enabled=False)
    else:
        _archivar(cliente, TALLER)
    resultado = _ok(marcar(cliente, 0))
    assert resultado["done"] is True
    assert resultado["completed"] is False
    progreso = _progreso(cliente, TALLER)
    assert progreso is None or progreso["completed"] is False


# ─────────────────────────── autoría de pasos ────────────────────────────────


def test_el_detalle_admin_trae_kind_y_pasos(cliente):
    detalle = crear_taller(cliente)
    assert detalle["kind"] == "taller"
    assert detalle["completion_rule"] == "viewed"
    assert [p["idx"] for p in detalle["steps"]] == [0, 1, 2]
    assert detalle["steps"][0]["example_id"] == EJEMPLO


def test_la_regla_de_un_taller_se_guarda_como_viewed(cliente):
    """La regla se ignora en talleres: pida lo que pida el cliente, queda 'viewed'."""
    detalle = crear_taller(cliente, completion_rule="quiz", pasos=0)
    assert detalle["completion_rule"] == "viewed"


def test_editar_un_paso(cliente):
    crear_taller(cliente)
    datos = _ok(
        cliente.put(
            f"/api/v1/admin/lessons/{TALLER}/steps/1",
            json={"title": "Paso dos", "body_markdown": "Otro texto.\n", "example_id": EJEMPLO},
        )
    )
    assert datos["lesson_id"] == TALLER
    assert datos["steps"][1] == {
        "idx": 1, "title": "Paso dos", "body_markdown": "Otro texto.\n", "example_id": EJEMPLO,
    }


def test_reordenar_pasos_mueve_tambien_sus_casillas(cliente):
    crear_taller(cliente)
    _ok(marcar(cliente, 0))  # «Paso 1» hecho
    datos = _ok(
        cliente.put(
            f"/api/v1/admin/lessons/{TALLER}/steps/reorder", json={"order": [2, 0, 1]}
        )
    )
    assert [p["title"] for p in datos["steps"]] == ["Paso 3", "Paso 1", "Paso 2"]
    pasos = _ok(cliente.get(f"/api/v1/lessons/{TALLER}"))["steps"]
    assert [(p["title"], p["done"]) for p in pasos] == [
        ("Paso 3", False), ("Paso 1", True), ("Paso 2", False),
    ]


def test_reordenar_exige_una_permutacion_exacta(cliente):
    crear_taller(cliente)
    for orden in ([0, 1], [0, 0, 1], [0, 1, 3]):
        _error(
            cliente.put(
                f"/api/v1/admin/lessons/{TALLER}/steps/reorder", json={"order": orden}
            ),
            422,
            "CONTENT_VALIDATION_ERROR",
        )


def test_borrar_un_paso_compacta_los_indices_y_sus_casillas(cliente):
    crear_taller(cliente)
    _ok(marcar(cliente, 2))  # «Paso 3» hecho
    datos = _ok(cliente.delete(f"/api/v1/admin/lessons/{TALLER}/steps/0"))
    assert [(p["idx"], p["title"]) for p in datos["steps"]] == [(0, "Paso 2"), (1, "Paso 3")]
    pasos = _ok(cliente.get(f"/api/v1/lessons/{TALLER}"))["steps"]
    assert [(p["title"], p["done"]) for p in pasos] == [("Paso 2", False), ("Paso 3", True)]


def test_borrar_un_paso_inexistente_da_404(cliente):
    crear_taller(cliente, pasos=1)
    _error(cliente.delete(f"/api/v1/admin/lessons/{TALLER}/steps/4"), 404, "STEP_NOT_FOUND")


def test_pasos_solo_en_talleres(cliente):
    _error(
        cliente.post(
            f"/api/v1/admin/lessons/{OTRA}/steps",
            json={"title": "X", "body_markdown": "x"},
        ),
        422,
        "CONTENT_VALIDATION_ERROR",
    )


def test_el_ejemplo_de_un_paso_tiene_que_existir(cliente):
    crear_taller(cliente, pasos=0)
    error = _error(
        cliente.post(
            f"/api/v1/admin/lessons/{TALLER}/steps",
            json={"title": "X", "body_markdown": "x", "example_id": "fantasma"},
        ),
        422,
        "CONTENT_VALIDATION_ERROR",
    )
    assert error["details"][0]["field"] == "example_id"


def test_el_markdown_del_paso_se_valida_como_el_de_la_leccion(cliente):
    crear_taller(cliente, pasos=0)
    error = _error(
        cliente.post(
            f"/api/v1/admin/lessons/{TALLER}/steps",
            json={"title": "X", "body_markdown": "<script>alert(1)</script>\n"},
        ),
        422,
        "CONTENT_VALIDATION_ERROR",
    )
    assert error["details"][0]["field"] == "body_markdown"


def test_pasos_de_leccion_inexistente_dan_404(cliente):
    _error(
        cliente.post(
            "/api/v1/admin/lessons/noExiste/steps",
            json={"title": "X", "body_markdown": "x"},
        ),
        404,
        "LESSON_NOT_FOUND",
    )


def test_un_taller_no_lleva_video(cliente):
    error = _error(
        cliente.post(
            "/api/v1/admin/lessons",
            json={
                "id": TALLER, "module_id": "m1", "order": 50, "title": "T",
                "estimated_minutes": 5, "content_markdown": "# T\n",
                "kind": "taller", "video_url": "https://youtu.be/dQw4w9WgXcQ",
            },
        ),
        422,
        "CONTENT_VALIDATION_ERROR",
    )
    assert error["details"][0]["field"] == "video_url"


def test_un_taller_no_lleva_quiz(cliente):
    """Convertir en taller una lección con quiz, o darle quiz a un taller, se rechaza."""
    error = _error(
        cliente.put(
            f"/api/v1/admin/lessons/{OTRA}",
            json={
                k: v
                for k, v in _ok(cliente.get(f"/api/v1/admin/lessons/{OTRA}")).items()
                if k in _BASE
            }
            | {"kind": "taller"},
        ),
        422,
        "CONTENT_VALIDATION_ERROR",
    )
    assert error["details"][0]["field"] == "kind"

    crear_taller(cliente, pasos=1)
    _error(
        cliente.put(
            f"/api/v1/admin/lessons/{TALLER}/quiz",
            json={
                "pass_threshold": 0.6,
                "questions": [
                    {
                        "order": 1, "text": "¿?",
                        "options": [{"key": "a", "text": "A"}, {"key": "b", "text": "B"}],
                        "correct_key": "a", "explanation": "Porque sí.",
                    }
                ],
            },
        ),
        422,
        "CONTENT_VALIDATION_ERROR",
    )


def test_borrar_la_leccion_purga_pasos_y_casillas(cliente):
    """La cascada se lleva los pasos; las casillas (sin FK) las purga delete_lesson."""
    crear_taller(cliente)
    _ok(marcar(cliente, 0))
    _ok(cliente.delete(f"/api/v1/admin/lessons/{TALLER}"))
    assert _filas(cliente, "SELECT COUNT(*) FROM workshop_steps") == [(0,)]
    assert _filas(cliente, "SELECT COUNT(*) FROM workshop_step_progress") == [(0,)]
    # Recrear el id NO resucita las casillas del taller anterior.
    crear_taller(cliente)
    pasos = _ok(cliente.get(f"/api/v1/lessons/{TALLER}"))["steps"]
    assert all(p["done"] is False for p in pasos)
