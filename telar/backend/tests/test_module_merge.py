"""``services/module_merge`` — la doctrina de CU-39, congelada en tests puros.

Aquí no hay DB, ni red, ni cliente HTTP: ``build_plan`` es una función pura, así
que la tabla de casos borde entera de ``algoritmoMerge.md`` §6 cabe como tests
unitarios. Cada uno se llama por **lo que defiende**, no por el mecanismo que
usa, porque lo que hay que poder leer de un vistazo es la promesa: *actualizar
un módulo nunca le quita al estudiante lo que ya hizo*.

El invariante que resume el fichero está al final
(``test_ninguna_actualizacion_baja_un_completed``): si alguna vez se pone rojo,
el mecanismo de módulos distribuibles dejó de ser aceptable y hay que parar.
"""

from __future__ import annotations

import pytest

from app.schemas.catalog import ModuleBundle
from app.services.module_merge import (
    AVISO_DOWNGRADE,
    AVISO_LECCION_RETIRADA,
    AVISO_POSIBLE_RENOMBRADO,
    AVISO_PROGRESO_PURGADO,
    AVISO_RECOMENDADA_PODADA,
    CONFLICTO_EJEMPLO_DE_OTRO_MODULO,
    CONFLICTO_LECCION_DE_MODULO_LOCAL,
    CONFLICTO_PREGUNTA_DE_OTRA_LECCION,
    LocalAttempt,
    LocalLesson,
    LocalModuleState,
    LocalProgress,
    LocalQuestion,
    LocalRecommended,
    MergeOptions,
    MergeRechazado,
    build_plan,
    calificar_intento,
    id_pregunta,
    plan_progress,
    preguntas_del_bundle,
    umbral_efectivo,
)

CHECKSUM_A = "a" * 64
CHECKSUM_B = "b" * 64
PUBLICADO = "2026-08-29T10:15:00.000Z"
MODULO = "m3"

# ─────────────────────────── Constructores de bundle ─────────────────────────


def _opciones(pares):
    return [{"key": k, "text": t} for k, t in pares]


def pregunta(
    qid,
    order=1,
    *,
    texto=None,
    opciones=(("a", "Sí"), ("b", "No")),
    correcta="a",
    explicacion="Porque el reparto es estático.",
):
    return {
        "id": qid,
        "order": order,
        "text": texto or f"Enunciado {order}",
        "options": _opciones(opciones),
        "correct_key": correcta,
        "explanation": explicacion,
    }


def quiz(preguntas, umbral=0.6):
    return {"pass_threshold": umbral, "questions": list(preguntas)}


def ejemplo(eid, *, codigo="print('hola')"):
    return {
        "id": eid,
        "filename": "demo.py",
        "title": "Demo",
        "difficulty": 2,
        "teaches": "Reparto de trabajo",
        "directives": ["parallel"],
        "threads_configurable": True,
        "fixed_threads": None,
        "fixed_threads_note": None,
        "sweeps_threads": False,
        "self_measures": False,
        "parser_id": "none",
        "default_timeout_s": 30,
        "est_run_seconds": 5,
        "enabled": True,
        "requires_gpu": False,
        "expected_output_note": "Imprime hola",
        "takeaways": ["Se reparte por hilos"],
        "source_code": codigo,
    }


def leccion(
    lid,
    order=1,
    *,
    titulo=None,
    markdown=None,
    minutos=10,
    video=None,
    habilitada=True,
    regla="quiz",
    umbral=0.6,
    recomendadas=(),
    ejemplo_=None,
    quiz_=None,
):
    return {
        "id": lid,
        "order": order,
        "title": titulo or f"Lección {lid}",
        "estimated_minutes": minutos,
        "content_markdown": markdown or f"# {lid}\n\nTexto.",
        "video_url": video,
        "enabled": habilitada,
        "completion_rule": regla,
        "pass_threshold": umbral,
        "recommended": [
            {"lesson_id": r, "label": "Ver", "tag": "Práctica"} for r in recomendadas
        ],
        "example": ejemplo_,
        "quiz": quiz_,
    }


def paquete(*lecciones, module_id=MODULO, version=2, checksum=CHECKSUM_A, hint=3):
    return ModuleBundle.model_validate(
        {
            "bundle_format": 1,
            "checksum": checksum,
            "module": {
                "id": module_id,
                "order_hint": hint,
                "title": "SPMD",
                "description": "Reparto manual del trabajo",
                "level": "Intermedio",
                "version": version,
                "published_at": PUBLICADO,
            },
            "lessons": list(lecciones),
        }
    )


# ─────────────────────────── Constructores de estado ─────────────────────────


def como_instalado(
    bundle,
    *,
    progreso=None,
    intentos=None,
    jobs=frozenset(),
    version=None,
    checksum=None,
    order=7,
    ajenas=(),
    origenes=None,
):
    """El estado que dejaría instalar ``bundle`` tal cual: instalador de mentira.

    Existe para que los tests de idempotencia sean honestos —el plan se calcula
    contra lo que de verdad quedaría escrito, no contra una maqueta a mano— y
    para que el resto de casos partan de un estado coherente y solo muevan la
    pieza que están probando.
    """
    lecciones = {}
    for entrante in bundle.lessons:
        preguntas = preguntas_del_bundle(entrante)
        lecciones[entrante.id] = LocalLesson(
            id=entrante.id,
            module_id=bundle.module.id,
            order=entrante.order,
            title=entrante.title,
            estimated_minutes=entrante.estimated_minutes,
            content_markdown=entrante.content_markdown,
            video_url=entrante.video_url,
            enabled=entrante.enabled,
            completion_rule=entrante.completion_rule,
            pass_threshold=entrante.pass_threshold,
            recommended=tuple(
                LocalRecommended(r.lesson_id, r.label, r.tag)
                for r in entrante.recommended
            ),
            example_id=entrante.example.id if entrante.example else None,
            example_source_code=(
                entrante.example.source_code if entrante.example else None
            ),
            questions=tuple(
                LocalQuestion(
                    id=qid,
                    order=q.order,
                    text=q.text,
                    options=tuple((o.key, o.text) for o in q.options),
                    correct_key=q.correct_key,
                    explanation=q.explanation,
                )
                for qid, q in preguntas.items()
            ),
        )
    for otra in ajenas:
        lecciones[otra.id] = otra

    origen = {bundle.module.id: "remote"}
    origen.update({otra.module_id: "remote" for otra in ajenas})
    origen.update(origenes or {})

    return LocalModuleState(
        module_id=bundle.module.id,
        version=bundle.module.version if version is None else version,
        checksum=bundle.checksum if checksum is None else checksum,
        order=order,
        lessons=lecciones,
        progress={p.lesson_id: p for p in (progreso or ())},
        attempts=dict(intentos or {}),
        lesson_ids_con_jobs=frozenset(jobs),
        module_origin=origen,
        example_owner={
            leccion_.example_id: leccion_.module_id
            for leccion_ in lecciones.values()
            if leccion_.example_id
        },
        question_owner={
            q.id: leccion_.id
            for leccion_ in lecciones.values()
            for q in leccion_.questions
        },
    )


def op_de(plan, lesson_id):
    return next((op for op in plan.progress_ops if op.lesson_id == lesson_id), None)


def avisos_de(plan, code):
    return [a for a in plan.warnings if a.code == code]


# ─────────── Quiz de 5 preguntas reutilizable (los casos B viven aquí) ────────


def quiz_de_cinco(umbral=0.6, correctas="aaaaa", textos=None):
    return quiz(
        [
            pregunta(
                f"spmd-q{i}",
                i,
                texto=(textos or {}).get(f"spmd-q{i}"),
                correcta=correctas[i - 1],
            )
            for i in range(1, 6)
        ],
        umbral=umbral,
    )


#: Tres aciertos sobre cinco: la evidencia con la que se prueban los umbrales.
INTENTO_TRES_DE_CINCO = LocalAttempt(
    answers={
        "spmd-q1": "a",
        "spmd-q2": "a",
        "spmd-q3": "a",
        "spmd-q4": "b",
        "spmd-q5": "b",
    },
    score=3,
    total=5,
)


# ═══════════════════ A · Ciclo de vida de la lección ═════════════════════════


def test_actualizar_sin_cambios_no_toca_el_progreso():
    """A1/C1 — reaplicar el mismo bundle es un no-op absoluto sobre el avance."""
    bundle = paquete(leccion("spmd", 1, quiz_=quiz_de_cinco()))
    local = como_instalado(
        bundle,
        progreso=[
            LocalProgress("spmd", viewed=True, completed=True, best_quiz_score=3,
                          completed_via="quiz")
        ],
        intentos={"spmd": [INTENTO_TRES_DE_CINCO]},
    )

    plan = build_plan(local, bundle)

    assert plan.unchanged == ["spmd"]
    assert plan.revised == plan.added == plan.removed == plan.archived == []
    op = op_de(plan, "spmd")
    assert op.effect == "preserved"
    assert (op.viewed, op.completed, op.best_quiz_score) == (True, True, 3)


def test_cambiar_el_texto_marca_revisada_pero_no_toca_lo_hecho():
    """A2 — el estudiante merece SABER que el texto cambió, no PERDER lo hecho."""
    v1 = paquete(leccion("spmd", 1, markdown="# SPMD\n\nv1", quiz_=quiz_de_cinco()))
    v2 = paquete(
        leccion("spmd", 1, markdown="# SPMD\n\nreescrito", quiz_=quiz_de_cinco()),
        version=3,
        checksum=CHECKSUM_B,
    )
    local = como_instalado(
        v1,
        progreso=[
            LocalProgress("spmd", viewed=True, completed=True, best_quiz_score=3,
                          completed_via="quiz", last_job_id="job1")
        ],
        intentos={"spmd": [INTENTO_TRES_DE_CINCO]},
    )

    plan = build_plan(local, v2)

    assert plan.revised == ["spmd"] and plan.unchanged == []
    op = op_de(plan, "spmd")
    assert (op.viewed, op.completed, op.best_quiz_score, op.last_job_id) == (
        True, True, 3, "job1",
    )


def test_una_leccion_nueva_nace_en_cero_y_no_se_le_inventa_avance():
    """A3 — jamás se fabrica progreso; el agregado baja porque creció el total."""
    v1 = paquete(leccion("spmd", 1))
    v2 = paquete(leccion("spmd", 1), leccion("tareas", 2), version=3,
                 checksum=CHECKSUM_B)
    local = como_instalado(v1, progreso=[LocalProgress("spmd", viewed=True)])

    plan = build_plan(local, v2)

    assert plan.added == ["tareas"]
    assert op_de(plan, "tareas") is None


def test_la_leccion_que_desaparece_se_archiva_y_conserva_su_avance():
    """A4/P1 — el autor retira SU contenido; no borra la biografía de nadie."""
    v1 = paquete(leccion("spmd", 1), leccion("spmdViejo", 2, quiz_=quiz_de_cinco()))
    v2 = paquete(leccion("spmd", 1), version=3, checksum=CHECKSUM_B)
    local = como_instalado(
        v1,
        progreso=[
            LocalProgress("spmdViejo", viewed=True, completed=True,
                          best_quiz_score=5, completed_via="quiz")
        ],
    )

    plan = build_plan(local, v2)

    assert plan.archived == ["spmdViejo"] and plan.removed == []
    op = op_de(plan, "spmdViejo")
    assert op.effect == "archived"
    assert (op.viewed, op.completed, op.best_quiz_score) == (True, True, 5)
    assert avisos_de(plan, AVISO_LECCION_RETIRADA)[0].lesson_id == "spmdViejo"


def test_la_leccion_que_nadie_toco_se_borra_limpia():
    """A5 — archivar lo que nadie tocó solo acumula basura: no hubo hecho."""
    v1 = paquete(leccion("spmd", 1), leccion("nadieLaVio", 2))
    v2 = paquete(leccion("spmd", 1), version=3, checksum=CHECKSUM_B)

    plan = build_plan(como_instalado(v1), v2)

    assert plan.removed == ["nadieLaVio"] and plan.archived == []
    assert plan.warnings == []


@pytest.mark.parametrize(
    "rastro",
    [
        {"progreso": [LocalProgress("nadieLaVio", viewed=True)]},
        {"intentos": {"nadieLaVio": [LocalAttempt(answers={}, score=0, total=1)]}},
        {"jobs": {"nadieLaVio"}},
    ],
    ids=["progreso", "intento", "job"],
)
def test_cualquier_rastro_del_estudiante_basta_para_archivar_en_vez_de_borrar(rastro):
    """A4 — «tocada» es progreso ∨ intentos ∨ jobs: los tres son hechos suyos."""
    v1 = paquete(leccion("spmd", 1), leccion("nadieLaVio", 2))
    v2 = paquete(leccion("spmd", 1), version=3, checksum=CHECKSUM_B)

    plan = build_plan(como_instalado(v1, **rastro), v2)

    assert plan.archived == ["nadieLaVio"] and plan.removed == []


def test_la_leccion_que_reaparece_recupera_su_progreso():
    """A6 — es LA razón de archivar en vez de borrar: la vuelta sale gratis."""
    v3 = paquete(leccion("spmd", 1), leccion("resucitada", 2), version=3,
                 checksum=CHECKSUM_B)
    local = como_instalado(
        paquete(leccion("spmd", 1)),
        progreso=[LocalProgress("resucitada", viewed=True, completed=True)],
    )
    local.lessons["resucitada"] = LocalLesson(
        id="resucitada", module_id=MODULO, order=2, archived_at="2026-01-01T00:00:00Z"
    )

    plan = build_plan(local, v3)

    assert plan.restored == ["resucitada"] and "resucitada" in plan.updated
    assert op_de(plan, "resucitada").completed is True


def test_la_leccion_movida_de_modulo_se_lleva_su_progreso_y_no_nace_de_nuevo():
    """A7/D1 — el ancla es el `lesson_id`, no la ruta: el traslado es barato."""
    ajena = LocalLesson(
        id="compartida", module_id="m9", order=1, content_markdown="# vieja",
        questions=(LocalQuestion("c-q1", 1, "¿?", (("a", "Sí"), ("b", "No")), "a"),),
    )
    v2 = paquete(
        leccion("spmd", 1),
        leccion("compartida", 2, quiz_=quiz([pregunta("c-q1", 1)])),
        version=3,
        checksum=CHECKSUM_B,
    )
    local = como_instalado(
        paquete(leccion("spmd", 1)),
        ajenas=[ajena],
        progreso=[LocalProgress("compartida", viewed=True, completed=True,
                                best_quiz_score=1, completed_via="quiz")],
        intentos={"compartida": [LocalAttempt(answers={"c-q1": "a"}, score=1, total=1)]},
    )

    plan = build_plan(local, v2)

    assert [m.model_dump() for m in plan.moved_in] == [
        {"lesson_id": "compartida", "from_module_id": "m9"}
    ]
    assert "compartida" in plan.updated and "compartida" not in plan.added
    assert op_de(plan, "compartida").completed is True


def test_un_bundle_remoto_no_puede_reclamar_una_leccion_de_un_modulo_local():
    """A9/D2 — frontera de confianza: lo remoto no roba lo autorado aquí."""
    ajena = LocalLesson(id="miaPropia", module_id="mLocal", order=1)
    v2 = paquete(leccion("spmd", 1), leccion("miaPropia", 2), version=3,
                 checksum=CHECKSUM_B)
    local = como_instalado(
        paquete(leccion("spmd", 1)),
        ajenas=[ajena],
        origenes={"mLocal": "local"},
    )

    plan = build_plan(local, v2)

    assert [(c.code, c.field, c.id, c.owner_module_id) for c in plan.conflicts] == [
        (CONFLICTO_LECCION_DE_MODULO_LOCAL, "lesson_id", "miaPropia", "mLocal")
    ]
    assert plan.moved_in == []


def test_deshabilitar_una_leccion_es_cosa_del_autor_y_no_toca_el_progreso():
    """A10 — `enabled` es del autor; el avance, del estudiante."""
    v1 = paquete(leccion("spmd", 1, habilitada=True, quiz_=quiz_de_cinco()))
    v2 = paquete(leccion("spmd", 1, habilitada=False, quiz_=quiz_de_cinco()),
                 version=3, checksum=CHECKSUM_B)
    local = como_instalado(
        v1,
        progreso=[LocalProgress("spmd", viewed=True, completed=True,
                                best_quiz_score=3, completed_via="quiz")],
        intentos={"spmd": [INTENTO_TRES_DE_CINCO]},
    )

    op = op_de(build_plan(local, v2), "spmd")

    assert (op.viewed, op.completed, op.best_quiz_score) == (True, True, 3)


def test_perder_o_ganar_el_ejemplo_no_afecta_al_avance():
    """A12/A13 — E1 hace del ejemplo un dato opcional, no una excepción."""
    con = paquete(leccion("spmd", 1, ejemplo_=ejemplo("spmdDemo")))
    sin = paquete(leccion("spmd", 1), version=3, checksum=CHECKSUM_B)
    progreso = [LocalProgress("spmd", viewed=True, completed=True,
                              completed_via="run", last_job_id="job7")]

    perdido = build_plan(como_instalado(con, progreso=progreso), sin)
    ganado = build_plan(como_instalado(sin, progreso=progreso, version=1), con)

    for plan in (perdido, ganado):
        op = op_de(plan, "spmd")
        assert (op.completed, op.completed_via, op.last_job_id) == (
            True, "run", "job7",
        )


# ═══════════════════ B · Quiz y progreso derivado ════════════════════════════


def _local_con_quiz(bundle_v1, *, completed=True, best=3, via="quiz"):
    return como_instalado(
        bundle_v1,
        progreso=[
            LocalProgress("spmd", viewed=True, completed=completed,
                          best_quiz_score=best, completed_via=via)
        ],
        intentos={"spmd": [INTENTO_TRES_DE_CINCO]},
    )


def test_un_quiz_que_crece_invalida_la_nota_pero_conserva_el_aprobado():
    """B1 — reescalar el 3/5 a 5/7 inventaría respuestas que nadie dio."""
    v1 = paquete(leccion("spmd", 1, quiz_=quiz_de_cinco()))
    v2 = paquete(
        leccion("spmd", 1, quiz_=quiz(
            quiz_de_cinco()["questions"] + [pregunta("spmd-q6", 6),
                                            pregunta("spmd-q7", 7)])),
        version=3, checksum=CHECKSUM_B,
    )

    op = op_de(build_plan(_local_con_quiz(v1), v2), "spmd")

    assert op.best_quiz_score is None
    assert op.completed is True and op.completed_via == "quiz"
    assert (op.previous_best_score, op.previous_total) == (3, 5)


def test_un_quiz_que_encoge_tambien_invalida_la_nota():
    """B3 — el conjunto cambió: la evidencia deja de ser interpretable."""
    v1 = paquete(leccion("spmd", 1, quiz_=quiz_de_cinco()))
    v2 = paquete(
        leccion("spmd", 1, quiz_=quiz(quiz_de_cinco()["questions"][:3])),
        version=3, checksum=CHECKSUM_B,
    )

    op = op_de(build_plan(_local_con_quiz(v1), v2), "spmd")

    assert op.best_quiz_score is None and op.completed is True


def test_mismo_total_distinto_conjunto_invalida_la_nota():
    """B9 — LA trampa: comparar `total` da 5 == 5 y corrige otra evaluación.

    El predicado es por CONJUNTO DE IDS. Cinco preguntas distintas también son
    cinco, y una nota calculada sobre otras preguntas no es la misma nota.
    """
    v1 = paquete(leccion("spmd", 1, quiz_=quiz_de_cinco()))
    nuevas = quiz_de_cinco()["questions"][:4] + [pregunta("spmd-q9", 5)]
    v2 = paquete(leccion("spmd", 1, quiz_=quiz(nuevas)), version=3,
                 checksum=CHECKSUM_B)

    op = op_de(build_plan(_local_con_quiz(v1), v2), "spmd")

    assert len(nuevas) == 5, "el total NO cambia: ahí está la trampa"
    assert op.best_quiz_score is None
    assert op.completed is True


def test_reescribir_el_enunciado_invalida_la_nota():
    """B2 — el enunciado forma parte de la IDENTIDAD de la pregunta.

    Este test decía lo contrario y era un defecto: el servidor no puede
    distinguir «arreglé una errata» de «cambié la pregunta». Con la regla
    anterior, corregir «¿cuánto es 2+2?» a «¿cuánto es 3+3?» dejando las mismas
    opciones recalificaba la respuesta vieja contra la clave nueva y le
    concedía al estudiante un acierto que nunca tuvo — y como `completed` es
    monótono, sin vuelta atrás.

    La asimetría decide: no recalificar solo anula una nota en caché y el
    estudiante puede reintentar; recalificar mal regala un aprobado para siempre.
    """
    v1 = paquete(leccion("spmd", 1, quiz_=quiz_de_cinco()))
    v2 = paquete(
        leccion("spmd", 1, quiz_=quiz_de_cinco(
            textos={"spmd-q1": "El mismo concepto, mejor redactado"})),
        version=3, checksum=CHECKSUM_B,
    )

    op = op_de(build_plan(_local_con_quiz(v1), v2), "spmd")

    assert op.best_quiz_score is None and op.effect == "rescored"


def test_reescribir_las_opciones_si_invalida_la_nota():
    """B10 — responder «b» ya no significa lo mismo: corregirlo sería inventar."""
    v1 = paquete(leccion("spmd", 1, quiz_=quiz_de_cinco()))
    otras = [
        pregunta(f"spmd-q{i}", i, opciones=(("a", "Otra cosa"), ("b", "Y otra")))
        for i in range(1, 6)
    ]
    v2 = paquete(leccion("spmd", 1, quiz_=quiz(otras)), version=3,
                 checksum=CHECKSUM_B)

    op = op_de(build_plan(_local_con_quiz(v1), v2), "spmd")

    assert op.best_quiz_score is None


def test_quitar_el_quiz_conserva_el_aprobado_que_ya_se_gano():
    """B4 — retirar el examen no deshace el examen aprobado."""
    v1 = paquete(leccion("spmd", 1, quiz_=quiz_de_cinco()))
    v2 = paquete(leccion("spmd", 1, regla="viewed"), version=3, checksum=CHECKSUM_B)

    op = op_de(build_plan(_local_con_quiz(v1, best=5), v2), "spmd")

    assert op.completed is True and op.completed_via == "quiz"
    assert op.best_quiz_score is None
    assert op.previous_best_score == 5


def test_una_leccion_sin_quiz_que_gana_quiz_conserva_su_completado_manual():
    """B5 — monotonía: el logro autodeclarado sigue, con su procedencia visible."""
    v1 = paquete(leccion("spmd", 1, regla="viewed"))
    v2 = paquete(leccion("spmd", 1, quiz_=quiz_de_cinco()), version=3,
                 checksum=CHECKSUM_B)
    local = como_instalado(
        v1,
        progreso=[LocalProgress("spmd", viewed=True, completed=True,
                                completed_via="manual")],
    )

    op = op_de(build_plan(local, v2), "spmd")

    assert op.completed is True and op.completed_via == "manual"
    assert op.best_quiz_score is None


def test_bajar_el_umbral_concede_el_completado_desde_el_historico():
    """B6 — la política nueva se aplica a la evidencia que ya existe.

    El 3/5 que con 0.8 no aprobaba, con 0.6 aprueba. Resetear a ciegas revocaría
    a alguien a quien la política nueva aprueba.
    """
    v1 = paquete(leccion("spmd", 1, umbral=0.8, quiz_=quiz_de_cinco(umbral=0.8)))
    v2 = paquete(leccion("spmd", 1, umbral=0.6, quiz_=quiz_de_cinco(umbral=0.6)),
                 version=3, checksum=CHECKSUM_B)
    local = _local_con_quiz(v1, completed=False, best=3, via=None)

    op = op_de(build_plan(local, v2), "spmd")

    assert op.completed is True and op.completed_via == "quiz"
    assert op.best_quiz_score == 3 and op.effect == "rescored"


@pytest.mark.parametrize("regla", ["run", "viewed"])
def test_recalificar_no_completa_una_leccion_cuya_regla_no_es_quiz(regla):
    """S2 (diseño A): la recalificación predice lo que haría el servidor, y el
    quiz solo completa lecciones `quiz`. La nota sí se recalcula."""
    v1 = paquete(leccion("spmd", 1, umbral=0.8, quiz_=quiz_de_cinco(umbral=0.8)))
    v2 = paquete(leccion("spmd", 1, umbral=0.6, regla=regla,
                         quiz_=quiz_de_cinco(umbral=0.6)),
                 version=3, checksum=CHECKSUM_B)
    local = _local_con_quiz(v1, completed=False, best=3, via=None)

    op = op_de(build_plan(local, v2), "spmd")

    assert op.completed is False and op.completed_via is None
    assert op.best_quiz_score == 3


def test_subir_el_umbral_no_revoca_el_completado():
    """B7 — P2 en su forma más pura: si subir el listón te quita lo ganado,

    el estudiante deja de actualizar y el mecanismo entero se cae.
    """
    v1 = paquete(leccion("spmd", 1, umbral=0.6, quiz_=quiz_de_cinco(umbral=0.6)))
    v2 = paquete(leccion("spmd", 1, umbral=0.9, quiz_=quiz_de_cinco(umbral=0.9)),
                 version=3, checksum=CHECKSUM_B)

    op = op_de(build_plan(_local_con_quiz(v1), v2), "spmd")

    assert op.completed is True
    assert op.best_quiz_score == 3


def test_corregir_una_clave_equivocada_recalifica_los_intentos():
    """B8 — el estudiante penalizado por una clave mal puesta recupera su punto.

    `quiz_attempts.answers` guarda la respuesta pregunta a pregunta, así que se
    puede volver a corregir con precisión total y sin pedirle nada a nadie.
    """
    v1 = paquete(leccion("spmd", 1, quiz_=quiz_de_cinco(correctas="aaaaa")))
    v2 = paquete(leccion("spmd", 1, quiz_=quiz_de_cinco(correctas="aaabb")),
                 version=3, checksum=CHECKSUM_B)
    local = _local_con_quiz(v1, completed=False, best=3, via=None)

    op = op_de(build_plan(local, v2), "spmd")

    assert op.best_quiz_score == 5, "las cinco respuestas eran correctas de verdad"
    assert op.completed is True and op.previous_best_score == 3


def test_una_nota_puede_bajar_porque_es_una_medida_no_un_logro():
    """B8/B11 — `best_quiz_score` es una caché recalculable; `completed`, no."""
    v1 = paquete(leccion("spmd", 1, quiz_=quiz_de_cinco(correctas="aaaaa")))
    v2 = paquete(leccion("spmd", 1, quiz_=quiz_de_cinco(correctas="bbbbb")),
                 version=3, checksum=CHECKSUM_B)

    op = op_de(build_plan(_local_con_quiz(v1), v2), "spmd")

    assert op.best_quiz_score == 2, "solo acertó las dos que respondió «b»"
    assert op.completed is True, "lo ganado no se revoca"


def test_cambiar_el_codigo_no_toca_el_completado_por_ejecucion():
    """B13 — el job guarda su propio snapshot: la evidencia es autocontenida."""
    v1 = paquete(leccion("spmd", 1, regla="run", ejemplo_=ejemplo("d", codigo="v1")))
    v2 = paquete(leccion("spmd", 1, regla="run", ejemplo_=ejemplo("d", codigo="v2")),
                 version=3, checksum=CHECKSUM_B)
    local = como_instalado(
        v1,
        progreso=[LocalProgress("spmd", viewed=True, completed=True,
                                completed_via="run", last_job_id="job9")],
        jobs={"spmd"},
    )

    op = op_de(build_plan(local, v2), "spmd")

    assert (op.completed, op.completed_via, op.last_job_id) == (True, "run", "job9")


def test_sin_fila_de_progreso_no_se_escribe_nada():
    """P1 — escribir una fila que no existía inventaría avance donde no lo hubo."""
    entrante = paquete(leccion("spmd", 1)).lessons[0]
    anterior = LocalLesson(id="spmd", module_id=MODULO)

    assert plan_progress("spmd", None, [], old=anterior, new=entrante) is None


def test_sin_intentos_que_recalificar_la_nota_no_se_anula():
    """A1 — anular la caché sin evidencia que lo justifique sería destruir un dato."""
    bundle = paquete(leccion("spmd", 1, quiz_=quiz_de_cinco()))
    local = como_instalado(
        bundle, progreso=[LocalProgress("spmd", viewed=True, best_quiz_score=4)]
    )

    op = op_de(build_plan(local, bundle), "spmd")

    assert op.best_quiz_score == 4 and op.effect == "preserved"


# ═══════════════ C · Versiones: idempotencia, manipulación, downgrade ════════


def test_reaplicar_el_mismo_par_version_checksum_es_idempotente():
    """C1 — el bundle es un ESTADO completo, así que reaplicarlo no cambia nada."""
    bundle = paquete(leccion("spmd", 1, quiz_=quiz_de_cinco()), leccion("otra", 2))
    local = como_instalado(bundle)

    primero = build_plan(local, bundle)
    segundo = build_plan(local, bundle)

    assert primero.model_dump() == segundo.model_dump()
    assert sorted(primero.unchanged) == ["otra", "spmd"]


def test_la_misma_version_con_otro_contenido_se_rechaza():
    """C2 — una versión publicada es INMUTABLE; si no, «¿hay actualización?»

    deja de ser decidible por versión, que es el eje de todo el mecanismo.
    """
    local = como_instalado(paquete(leccion("spmd", 1)), version=2, checksum=CHECKSUM_A)
    manipulado = paquete(leccion("spmd", 1, markdown="# otro"), version=2,
                         checksum=CHECKSUM_B)

    with pytest.raises(MergeRechazado) as exc:
        build_plan(local, manipulado)

    assert exc.value.code == "VERSION_CONFLICT" and exc.value.motivo == "tampered"


def test_el_downgrade_se_rechaza_por_defecto():
    """C3 — mecánicamente es una actualización más; lo peligroso es la semántica."""
    local = como_instalado(paquete(leccion("spmd", 1), version=5), version=5)
    vieja = paquete(leccion("spmd", 1), version=3, checksum=CHECKSUM_B)

    with pytest.raises(MergeRechazado) as exc:
        build_plan(local, vieja)

    assert exc.value.code == "VERSION_CONFLICT" and exc.value.motivo == "downgrade"


def test_el_downgrade_autorizado_avisa_y_sigue_sin_perder_progreso():
    """C3 — se permite a mano, y aun así archiva en vez de borrar."""
    v5 = paquete(leccion("spmd", 1), leccion("soloEnV5", 2), version=5)
    v3 = paquete(leccion("spmd", 1), version=3, checksum=CHECKSUM_B)
    local = como_instalado(
        v5, progreso=[LocalProgress("soloEnV5", viewed=True, completed=True)]
    )

    plan = build_plan(local, v3, MergeOptions(allow_downgrade=True))

    assert avisos_de(plan, AVISO_DOWNGRADE)
    assert plan.archived == ["soloEnV5"]
    assert op_de(plan, "soloEnV5").completed is True


def test_el_bundle_es_un_estado_completo_no_un_parche():
    """C11 — v2→v5 y v4→v5 recorren el mismo código: no hay cadena de migraciones."""
    v5 = paquete(leccion("spmd", 1), leccion("tareas", 2), version=5,
                 checksum=CHECKSUM_B)
    base = paquete(leccion("spmd", 1))

    desde_v2 = build_plan(como_instalado(base, version=2), v5).model_dump()
    desde_v4 = build_plan(como_instalado(base, version=4), v5).model_dump()

    desde_v2.pop("from_version"), desde_v4.pop("from_version")
    assert desde_v2 == desde_v4


def test_no_se_pueden_fusionar_dos_modulos_distintos():
    """Error de programación, no de datos: se detecta antes de mirar nada."""
    local = como_instalado(paquete(leccion("spmd", 1)))
    otro = paquete(leccion("spmd", 1), module_id="m9", version=3,
                   checksum=CHECKSUM_B)

    with pytest.raises(ValueError, match="no se pueden fusionar"):
        build_plan(local, otro)


# ═══════════════ D · Identidad, colisiones y orden ═══════════════════════════


def test_una_pregunta_de_una_leccion_AJENA_da_conflicto_no_500():
    """D3/CW-02 — `quiz_questions.id` es PK global: sin esto, IntegrityError → 500.

    El conflicto legítimo es con una lección que NO viene en el bundle: nadie va
    a borrar sus preguntas, así que el INSERT chocaría de verdad.
    """
    # La pregunta la POSEE una lección de otro módulo, que no viene en el bundle:
    # sus filas nadie las borra, así que el INSERT chocaría de verdad contra la
    # PK global de `quiz_questions`.
    ajena = LocalLesson(
        id="deOtroModulo",
        module_id="m9",
        order=1,
        example_id=None,
        questions=(
            LocalQuestion(
                id="compartida",
                order=1,
                text="Enunciado 1",
                options=(("a", "Sí"), ("b", "No")),
                correct_key="a",
                explanation="Porque el reparto es estático.",
            ),
        ),
    )
    v2 = paquete(
        leccion("spmd", 1, quiz_=quiz([pregunta("compartida", 1)])),
        version=3, checksum=CHECKSUM_B,
    )
    local = como_instalado(paquete(leccion("spmd", 1)), ajenas=[ajena])

    plan = build_plan(local, v2)

    assert [(c.code, c.field, c.id) for c in plan.conflicts] == [
        (CONFLICTO_PREGUNTA_DE_OTRA_LECCION, "question_id", "compartida")
    ]


def test_mover_una_pregunta_entre_lecciones_del_bundle_NO_es_conflicto():
    """El autor reorganiza su propio módulo: eso no puede bloquear al estudiante.

    Antes se marcaba conflicto con solo ver que la pregunta pertenecía a otra
    lección, sin mirar si esa lección venía en el bundle. Pero
    `_reemplazar_quizzes` borra las preguntas de TODAS las lecciones entrantes
    antes de insertar ninguna, así que la colisión es imposible. El resultado
    era un 409 permanente: el módulo quedaba imposible de actualizar, y el
    estudiante no tenía forma de resolverlo.

    La asimetría lo delataba: mover un EJEMPLO entre lecciones nunca dio
    conflicto y el aplicador lo resolvía bien.
    """
    v1 = paquete(
        leccion("l1", 1, quiz_=quiz([pregunta("compartida", 1)])),
        leccion("l2", 2, quiz_=quiz([pregunta("l2-q1", 1)])),
    )
    v2 = paquete(
        leccion("l1", 1, quiz_=quiz([pregunta("l1-q9", 1)])),
        leccion("l2", 2, quiz_=quiz([pregunta("compartida", 1)])),
        version=3, checksum=CHECKSUM_B,
    )

    plan = build_plan(como_instalado(v1), v2)

    assert plan.conflicts == []


def test_un_ejemplo_de_otro_modulo_da_conflicto():
    """D4 — riesgo NUEVO que abre E1: `examples.id` pasa a ser PK independiente."""
    ajena = LocalLesson(id="deM9", module_id="m9", order=1, example_id="demoCompartida")
    v2 = paquete(leccion("spmd", 1, ejemplo_=ejemplo("demoCompartida")), version=3,
                 checksum=CHECKSUM_B)
    local = como_instalado(paquete(leccion("spmd", 1)), ajenas=[ajena])

    plan = build_plan(local, v2)

    assert [(c.code, c.id, c.owner_module_id) for c in plan.conflicts] == [
        (CONFLICTO_EJEMPLO_DE_OTRO_MODULO, "demoCompartida", "m9")
    ]


def test_actualizar_no_reordena_el_curso_del_estudiante():
    """D5 — la posición del módulo en SU ruta es una decisión local."""
    v2 = paquete(leccion("spmd", 1), version=3, checksum=CHECKSUM_B, hint=1)
    local = como_instalado(paquete(leccion("spmd", 1)), order=7)

    plan = build_plan(local, v2)

    assert plan.local_order == 7 and plan.order_reassigned is False


@pytest.mark.parametrize(
    ("hint", "ocupados", "esperado", "reasignado"),
    [(3, {1, 2}, 3, False), (3, {1, 2, 3}, 4, True), (9, {1, 2, 3}, 9, False)],
)
def test_al_instalar_el_order_sugerido_cede_ante_el_que_ya_existe(
    hint, ocupados, esperado, reasignado
):
    """D5 — `modules."order"` es UNIQUE global: dos autores pueden sugerir el 3."""
    bundle = paquete(leccion("spmd", 1), hint=hint)
    local = LocalModuleState(module_id=MODULO, orders_ocupados=frozenset(ocupados))

    plan = build_plan(local, bundle)

    assert (plan.local_order, plan.order_reassigned) == (esperado, reasignado)
    assert plan.from_version is None and plan.added == ["spmd"]


def test_una_recomendada_a_una_leccion_no_instalada_se_poda_con_aviso():
    """D7 — un «te recomendamos X» que no resuelve es un enlace muerto en la UI."""
    v2 = paquete(
        leccion("spmd", 1, recomendadas=["deOtroCurso"]), version=3,
        checksum=CHECKSUM_B,
    )

    plan = build_plan(como_instalado(paquete(leccion("spmd", 1))), v2)

    assert [(p.lesson_id, p.target_lesson_id) for p in plan.pruned_recommended] == [
        ("spmd", "deOtroCurso")
    ]
    assert avisos_de(plan, AVISO_RECOMENDADA_PODADA)


def test_una_recomendada_a_una_leccion_del_propio_bundle_no_se_poda():
    """D7 — la referencia se resuelve contra el estado POSTERIOR al merge."""
    v2 = paquete(
        leccion("spmd", 1, recomendadas=["tareas"]), leccion("tareas", 2),
        version=3, checksum=CHECKSUM_B,
    )

    plan = build_plan(como_instalado(paquete(leccion("spmd", 1))), v2)

    assert plan.pruned_recommended == []


def test_renombrar_un_lesson_id_avisa_y_no_transfiere_el_progreso():
    """D8 — el ÚNICO caso en que se pierde el vínculo, y por eso se avisa.

    Dos lecciones con el mismo título pueden ser cosas distintas. Transferir el
    avance por parecido tipográfico le atribuiría a alguien un logro que no
    obtuvo, y eso ya no habría forma de detectarlo después.
    """
    v1 = paquete(leccion("spmd", 1), leccion("viejoId", 2, titulo="SPMD paso a paso"))
    v2 = paquete(
        leccion("spmd", 1), leccion("nuevoId", 2, titulo="SPMD paso a paso"),
        version=3, checksum=CHECKSUM_B,
    )
    local = como_instalado(
        v1, progreso=[LocalProgress("viejoId", viewed=True, completed=True,
                                    best_quiz_score=4)]
    )

    plan = build_plan(local, v2)

    aviso = avisos_de(plan, AVISO_POSIBLE_RENOMBRADO)[0]
    assert (aviso.lesson_id, aviso.related_lesson_id) == ("viejoId", "nuevoId")
    assert plan.archived == ["viejoId"] and plan.added == ["nuevoId"]
    assert op_de(plan, "nuevoId") is None, "el progreso NO viaja al id nuevo"
    assert op_de(plan, "viejoId").completed is True, "y el viejo lo conserva"


def test_el_aviso_de_renombrado_empareja_uno_a_uno():
    """D8 — con dos archivadas del mismo título no se emiten avisos cruzados."""
    v1 = paquete(
        leccion("viejoA", 1, titulo="Barreras"), leccion("viejoB", 2, titulo="Barreras")
    )
    v2 = paquete(
        leccion("nuevoA", 1, titulo="Barreras"), leccion("nuevoB", 2, titulo="Barreras"),
        version=3, checksum=CHECKSUM_B,
    )
    local = como_instalado(
        v1,
        progreso=[LocalProgress("viejoA", viewed=True),
                  LocalProgress("viejoB", viewed=True)],
    )

    avisos = avisos_de(build_plan(local, v2), AVISO_POSIBLE_RENOMBRADO)

    assert [(a.lesson_id, a.related_lesson_id) for a in avisos] == [
        ("viejoA", "nuevoA"), ("viejoB", "nuevoB")
    ]


# ═══════════════ Purga: el único camino que sí destruye ══════════════════════


def test_purgar_es_explicito_y_se_avisa_leccion_por_leccion():
    """§11.6.3 — el default conserva; el valor destructivo hay que pedirlo."""
    v1 = paquete(leccion("spmd", 1), leccion("retirada", 2))
    v2 = paquete(leccion("spmd", 1), version=3, checksum=CHECKSUM_B)
    local = como_instalado(
        v1, progreso=[LocalProgress("retirada", viewed=True, completed=True)]
    )

    plan = build_plan(local, v2, MergeOptions(on_removed_lessons="purge"))

    assert plan.on_removed_lessons == "purge"
    assert plan.removed == ["retirada"] and plan.archived == []
    assert avisos_de(plan, AVISO_PROGRESO_PURGADO)[0].lesson_id == "retirada"
    assert op_de(plan, "retirada") is None


# ═══════════════ Utilidades puras ════════════════════════════════════════════


def test_el_id_de_pregunta_se_autogenera_como_lo_hace_el_writer():
    """BL-18 — sin resolver el `None`, dos quizzes idénticos parecerían distintos."""
    entrante = paquete(
        leccion("spmd", 1, quiz_=quiz([{**pregunta("x", 2), "id": None}]))
    ).lessons[0]

    assert list(preguntas_del_bundle(entrante)) == ["spmd-q2"]
    assert id_pregunta("spmd", entrante.quiz.questions[0]) == "spmd-q2"


def test_el_umbral_efectivo_es_el_mas_exigente_de_los_dos_declarados():
    """Conceder de menos es recuperable; conceder de más, no."""
    incoherente = paquete(
        leccion("spmd", 1, umbral=0.6, quiz_=quiz_de_cinco(umbral=0.9))
    ).lessons[0]
    sin_quiz = paquete(leccion("spmd", 1, umbral=0.7, regla="viewed")).lessons[0]

    assert umbral_efectivo(incoherente) == 0.9
    assert umbral_efectivo(sin_quiz) == 0.7


def test_un_intento_incompleto_no_se_califica():
    """Un intento parcial nunca fue válido, así que no es evidencia de nada.

    `QuizService._validate_answers` exige respuesta a TODAS las preguntas. El
    merge contaba solo las respondidas y dividía por el total NUEVO, así que un
    2/2 sobre un quiz que luego creció a 3 preguntas se recalificaba como
    2/3 = 0,667 y APROBABA una lección cuya tercera pregunta el estudiante no
    vio jamás.
    """
    preguntas = preguntas_del_bundle(
        paquete(leccion("spmd", 1, quiz_=quiz_de_cinco())).lessons[0]
    )
    completo = {f"spmd-q{i}": "a" for i in range(1, 6)}

    assert calificar_intento(completo, preguntas) == 5
    # Parcial, sobrante, y vacío: todos None, no una nota inventada.
    assert calificar_intento({"spmd-q1": "a", "spmd-q2": "a"}, preguntas) is None
    assert calificar_intento({"spmd-q1": "a", "borrada": "a"}, preguntas) is None
    assert calificar_intento({}, preguntas) is None
    # Un intento con respuestas de MÁS sí se califica: cubre todo lo que hay.
    assert calificar_intento({**completo, "borrada": "a"}, preguntas) == 5


def test_una_url_de_youtube_equivalente_no_cuenta_como_cambio():
    """El instalador guarda la URL reconstruida: comparar la cruda mentiría."""
    canonica = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    v1 = paquete(leccion("spmd", 1, video=canonica))
    v2 = paquete(
        leccion("spmd", 1, video="https://youtu.be/dQw4w9WgXcQ"), version=3,
        checksum=CHECKSUM_B,
    )

    assert build_plan(como_instalado(v1), v2).unchanged == ["spmd"]


def test_una_url_de_video_invalida_no_rompe_el_plan():
    """Decidir que una URL es inaceptable es del validador, no del plan.

    El plan solo compara: si no puede normalizarla, la compara cruda y sigue.
    Que un dato feo tumbe el merge sería cambiar un 422 explicativo por un 500.
    """
    v1 = paquete(leccion("spmd", 1, video="ftp://no-es-youtube/x"))
    v2 = paquete(leccion("spmd", 1, video="ftp://no-es-youtube/x"), version=3,
                 checksum=CHECKSUM_B)

    assert build_plan(como_instalado(v1), v2).unchanged == ["spmd"]


# ═══════════════ El invariante que define CU-39 ══════════════════════════════


def _bateria():
    """Una v2 con progreso en todo, y cinco v3 que la maltratan de formas distintas."""
    v2 = paquete(
        leccion("spmd", 1, quiz_=quiz_de_cinco()),
        leccion("critica", 2, regla="viewed"),
        leccion("retirada", 3, quiz_=quiz([pregunta("ret-q1", 1)])),
    )
    local = como_instalado(
        v2,
        progreso=[
            LocalProgress("spmd", viewed=True, completed=True, best_quiz_score=3,
                          completed_via="quiz"),
            LocalProgress("critica", viewed=True, completed=True,
                          completed_via="manual"),
            LocalProgress("retirada", viewed=True, completed=True,
                          best_quiz_score=1, completed_via="quiz"),
        ],
        intentos={
            "spmd": [INTENTO_TRES_DE_CINCO],
            "retirada": [LocalAttempt(answers={"ret-q1": "a"}, score=1, total=1)],
        },
        jobs={"critica"},
    )

    crece = quiz(quiz_de_cinco()["questions"] + [pregunta("spmd-q6", 6)])
    reemplaza = quiz(
        quiz_de_cinco()["questions"][:4] + [pregunta("spmd-q9", 5)]
    )
    variantes = {
        "quiz_crece": [leccion("spmd", 1, quiz_=crece), leccion("critica", 2)],
        "quiz_reemplazado": [leccion("spmd", 1, quiz_=reemplaza)],
        "quiz_retirado": [leccion("spmd", 1, regla="viewed")],
        "umbral_arriba": [leccion("spmd", 1, umbral=1.0,
                                  quiz_=quiz_de_cinco(umbral=1.0))],
        "todo_renombrado": [leccion("spmdNuevo", 1, quiz_=quiz_de_cinco())],
    }
    for nombre, lecciones in variantes.items():
        yield nombre, local, paquete(*lecciones, version=3, checksum=CHECKSUM_B)


@pytest.mark.parametrize(("nombre", "local", "v3"), list(_bateria()),
                         ids=lambda v: v if isinstance(v, str) else "")
def test_ninguna_actualizacion_baja_un_completed(nombre, local, v3):
    """EL invariante de CU-39, en sus dos mitades:

    · ningún `completed` pasa de True a False —ni recalificando, ni archivando,
      ni cuando la lección entera desaparece—, y
    · ninguna lección con avance se queda sin fila: o sigue viniendo, o se
      archiva. Nunca se borra, que es lo que la haría desaparecer de verdad.
    """
    plan = build_plan(local, v3)

    for op in plan.progress_ops:
        previo = local.progress[op.lesson_id]
        assert op.completed >= previo.completed, f"{nombre}: {op.lesson_id} degradada"
        assert op.viewed == previo.viewed, f"{nombre}: lo observado se conserva"

    con_avance = {p.lesson_id for p in local.progress.values()}
    assert not (con_avance & set(plan.removed)), (
        f"{nombre}: borrar una lección con avance es exactamente lo prohibido"
    )
    entrantes = {leccion_.id for leccion_ in v3.lessons}
    assert con_avance <= entrantes | set(plan.archived), (
        f"{nombre}: toda lección con avance sigue viniendo o queda archivada"
    )


# ─────────────────── Regresiones de la auditoría adversarial ─────────────────
#
# Los tres de esta sección los encontró una verificación adversarial: no eran
# casos que nadie hubiera escrito, eran casos que el código resolvía MAL con la
# suite en verde. Cada uno lleva el escenario mínimo que lo reproducía.


def test_reordenar_preguntas_sin_id_no_intercambia_sus_identidades():
    """CRÍTICO — el peor fallo que encontró la auditoría.

    BL-18 deja omitir el `id` de una pregunta: el id efectivo pasa a ser
    `{lesson_id}-q{order}`. Si el autor solo REORDENA las preguntas, esos ids se
    INTERCAMBIAN. El conjunto de ids no cambia, y en un quiz de verdadero/falso
    —donde todas las preguntas comparten las mismas opciones— la comprobación
    anterior daba «recalificable» y corregía cada respuesta contra OTRA pregunta.

    El escenario real: el estudiante falla las dos preguntas (0/2), el autor las
    reordena, y el estudiante acaba con 2/2 y la lección APROBADA. Y como
    `completed` es monótono, ese aprobado no se revoca nunca.

    Lo que lo cierra es incluir el ENUNCIADO en la identidad de la pregunta.
    """
    vf = (("a", "Verdadero"), ("b", "Falso"))
    v1 = paquete(leccion("l1", 1, quiz_=quiz([
        pregunta(None, 1, texto="static reparte en bloques", opciones=vf, correcta="a"),
        pregunta(None, 2, texto="OpenMP usa procesos", opciones=vf, correcta="b"),
    ])))
    # Las MISMAS dos preguntas, en el orden contrario.
    v2 = paquete(leccion("l1", 1, quiz_=quiz([
        pregunta(None, 1, texto="OpenMP usa procesos", opciones=vf, correcta="b"),
        pregunta(None, 2, texto="static reparte en bloques", opciones=vf, correcta="a"),
    ])), version=3, checksum=CHECKSUM_B)

    # Falló las dos: respondió justo al revés de lo correcto en cada una.
    fallo_ambas = LocalAttempt(answers={"l1-q1": "b", "l1-q2": "a"}, score=0, total=2)
    local = como_instalado(
        v1,
        progreso=[LocalProgress(lesson_id="l1", viewed=True, completed=False,
                                best_quiz_score=0)],
        intentos={"l1": [fallo_ambas]},
    )

    op = op_de(build_plan(local, v2), "l1")

    assert op.completed is False, "un reordenamiento no puede aprobar a quien falló"
    assert op.best_quiz_score is None, "la nota deja de ser interpretable, no sube"
    assert op.effect == "rescored"


def test_un_intento_parcial_no_aprueba_al_crecer_el_quiz():
    """ALTO — evidencia fabricada a partir de un intento que nunca fue válido.

    `QuizService` exige responder TODAS las preguntas, así que un intento parcial
    no existe. El merge contaba solo lo respondido y dividía por el total nuevo:
    un 2/2 sobre un quiz que después crece a 3 preguntas se recalificaba como
    2/3 = 0,667 y aprobaba una lección cuya tercera pregunta nadie contestó.
    """
    dos = [pregunta(f"l1-q{i}", i) for i in (1, 2)]
    tres = dos + [pregunta("l1-q3", 3)]
    v1 = paquete(leccion("l1", 1, quiz_=quiz(dos), umbral=0.6))
    v2 = paquete(leccion("l1", 1, quiz_=quiz(tres), umbral=0.6),
                 version=3, checksum=CHECKSUM_B)

    acerto_las_dos = LocalAttempt(
        answers={"l1-q1": "a", "l1-q2": "a"}, score=2, total=2
    )
    local = como_instalado(
        v1,
        progreso=[LocalProgress(lesson_id="l1", viewed=True, completed=False,
                                best_quiz_score=2)],
        intentos={"l1": [acerto_las_dos]},
    )

    op = op_de(build_plan(local, v2), "l1")

    assert op.completed is False
    assert op.best_quiz_score is None
