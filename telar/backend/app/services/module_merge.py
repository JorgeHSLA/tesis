"""Plan de merge de una actualización de módulo — CU-39. Función PURA.

``build_plan(local, bundle, opts) -> MergePlan`` decide **qué le pasa a cada
lección y a cada progreso** cuando llega una versión nueva de un módulo. No toca
la base, no sale a la red y no sabe qué es FastAPI: recibe el estado local ya
leído y el bundle ya validado, y devuelve un plan.

Que sea pura compra tres cosas concretas: la **vista previa** de §11.6.2 muestra
el mismo plan que luego se aplica (un preview que mienta es peor que no tenerlo);
el **error se decide antes de escribir** (``plan.conflicts`` no vacío ⇒ el
aplicador ni arranca, y sale un 409/422 limpio en vez de un ``IntegrityError`` a
mitad de transacción convertido en 500); y la doctrina se congela en **tests
baratos**, sin DB ni red.

LAS REGLAS QUE NO SE NEGOCIAN (algoritmoMerge.md §0, P1–P5):

* **El contenido es del autor; el progreso es del estudiante.** Jamás se ejecuta
  ``DELETE FROM lesson_progress`` ni ``DELETE FROM quiz_attempts``. La lección
  que desaparece se **archiva** (``archived_at``): conserva su avance y su
  historial de jobs y sale de la ruta lineal. Solo se borra lo que nadie tocó.
* **``completed`` es MONÓTONO.** Actualizar nunca puede empeorarte; si pudiera,
  nadie actualizaría y el mecanismo entero muere. Bajar el ``pass_threshold``
  puede **conceder** desde el histórico; subirlo **no revoca**.
* **Lo observado se conserva; lo derivado se recalcula.** ``viewed`` y
  ``last_job_id`` son hechos. ``best_quiz_score`` es una **caché** de
  ``quiz_attempts``: se recalifica con la clave nueva mientras la evidencia sea
  interpretable, y se anula cuando no. Anularla no pierde nada — el 4/4 sigue en
  ``quiz_attempts``, con su fecha.
* **El quiz se compara por CONJUNTO DE IDS, jamás por número de preguntas.**
  Quitar una y añadir otra deja el total en 5: comparar totales es la trampa.
* **Un ``lesson_id`` que cambia NO es un renombrado**, es una lección nueva más
  otra perdida. Se **avisa** y NO se transfiere progreso: adivinar mal por
  parecido de título atribuye un logro que nadie obtuvo, y ya no se detecta.

Vocabulario: el de R3/R4 (``rescored``/``archived``), el mismo de
``schemas/updates.py``. La traducción al del cable congelado
es el MISMO desde que §11 se corrigió: no hay traducción que hacer.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal, NamedTuple

from ..schemas.catalog import BundleLesson, BundleQuizQuestion, ModuleBundle
from ..schemas.updates import (
    LessonMove,
    MergeConflict,
    MergePlan,
    MergeWarning,
    OnRemovedLessons,
    ProgressOp,
    RecommendedPrune,
)
from .youtube import VideoUrlError
from .youtube import normalizar as normalizar_video

# ── Códigos ──────────────────────────────────────────────────────────────────
# Los de conflicto son la causa que el router copia a ``details`` del
# ``409 DUPLICATE_ID`` (§11.6.1); los de aviso se muestran, no bloquean. Los
# tres son colisiones sobre claves GLOBALES: sin detectarlas antes de escribir
# saldrían como ``IntegrityError`` → 500, no como un 4xx que explica qué sobra.

#: Frontera de confianza: lo remoto nunca sobrescribe lo autorado aquí (D2/A9).
CONFLICTO_LECCION_DE_MODULO_LOCAL = "LESSON_OWNED_BY_LOCAL_MODULE"
#: ``examples.id`` es PK global desde E1 (ya no es el ``lesson_id``): D4.
CONFLICTO_EJEMPLO_DE_OTRO_MODULO = "EXAMPLE_OWNED_BY_OTHER_MODULE"
#: ``quiz_questions.id`` es PK global (D3, el detector CW-02 ya existe).
CONFLICTO_PREGUNTA_DE_OTRA_LECCION = "QUESTION_OWNED_BY_OTHER_LESSON"

#: Código del contrato (§11.6.2 ``warnings``) para la lección que se archiva.
AVISO_LECCION_RETIRADA = "LESSON_ID_REMOVED"
#: Misma cabecera, id distinto: se ve y se dice, no se adivina (D8).
AVISO_POSIBLE_RENOMBRADO = "POSIBLE_RENOMBRADO"
#: ``recommended`` que apunta a una lección que no estará instalada (D7).
AVISO_RECOMENDADA_PODADA = "RECOMMENDED_PRUNED"
#: El ÚNICO camino que destruye avance, y hay que pedirlo explícitamente.
AVISO_PROGRESO_PURGADO = "PROGRESS_PURGED"
#: Downgrade autorizado a mano: archiva lecciones donde ya se avanzó (C3).
AVISO_DOWNGRADE = "DOWNGRADE"

#: Procedencia del logro (``lesson_progress.completed_via``, migración 5).
CompletedVia = Literal["quiz", "manual", "run"]


# ── Estado local (entrada del plan) ──────────────────────────────────────────
# Tipos propios y mínimos a propósito: el plan no debe depender de aiosqlite ni
# de los modelos del snapshot de contenido. El lector (``module_updater``) los
# llena con una lectura DENTRO del write_lock; los tests, a mano.


class LocalRecommended(NamedTuple):
    """Una entrada de ``lessons.recommended_json`` ya deserializada."""

    lesson_id: str
    label: str
    tag: str


class LocalQuestion(NamedTuple):
    """Una fila de ``quiz_questions`` de la versión INSTALADA.

    ``options`` va como tupla ``(key, text)`` en su orden de presentación: ese
    orden importa para detectar «no cambió nada», pero **no** para decidir si un
    intento es recalificable (ahí se comparan como mapa key→texto, porque
    reordenar las opciones no cambia lo que significó responder «b»).
    """

    id: str
    order: int
    text: str
    options: tuple[tuple[str, str], ...]
    correct_key: str
    explanation: str = ""


@dataclass(frozen=True, slots=True)
class LocalLesson:
    """Una fila de ``lessons`` instalada, con su quiz y su ejemplo resumidos.

    Se incluyen TODAS las instaladas, sean de este módulo o no: una lección
    reclamada desde otro módulo (A7/D1) necesita su estado anterior para
    recalificar, y sin él el 4/4 obsoleto viajaría con ella.
    """

    id: str
    module_id: str
    order: int = 1
    title: str = ""
    estimated_minutes: int = 1
    content_markdown: str = ""
    video_url: str | None = None
    enabled: bool = True
    completion_rule: str = "quiz"
    #: ``lessons.pass_threshold``: el umbral con el que el servidor califica hoy.
    pass_threshold: float = 0.6
    #: ``None`` = viva. Con valor, retirada por una versión anterior (A4).
    archived_at: str | None = None
    recommended: tuple[LocalRecommended, ...] = ()
    example_id: str | None = None
    example_source_code: str | None = None
    questions: tuple[LocalQuestion, ...] = ()
    #: S6: ``leccion`` | ``taller`` y la firma ``(title, body, example_id)`` de
    #: sus pasos. Solo alimentan el reporte («sin cambios»), como el resto.
    kind: str = "leccion"
    steps: tuple[tuple[str, str, str | None], ...] = ()


@dataclass(frozen=True, slots=True)
class LocalProgress:
    """Una fila de ``lesson_progress``. Lo que este plan existe para no romper."""

    lesson_id: str
    viewed: bool = False
    completed: bool = False
    best_quiz_score: int | None = None
    completed_via: CompletedVia | None = None
    last_job_id: str | None = None


@dataclass(frozen=True, slots=True)
class LocalAttempt:
    """Una fila de ``quiz_attempts``: EVIDENCIA inmutable, nunca se borra.

    ``answers`` (id de pregunta → opción elegida) permite recalificar con la
    clave nueva sin pedirle nada al estudiante: si el docente arregla una
    ``correct_key`` equivocada, el punto se recupera solo.
    """

    answers: Mapping[str, str]
    score: int = 0
    total: int = 0


@dataclass(frozen=True, slots=True)
class LocalModuleState:
    """Todo lo que el plan necesita saber de la máquina del estudiante."""

    module_id: str
    #: ``None`` ⇒ instalación inicial (CU-36): no hay versión previa que comparar.
    version: int | None = None
    checksum: str | None = None
    #: ``modules."order"`` local. Una actualización JAMÁS lo toca (D5).
    order: int | None = None
    #: TODAS las lecciones instaladas por id, de cualquier módulo, vivas y archivadas.
    lessons: Mapping[str, LocalLesson] = field(default_factory=dict)
    progress: Mapping[str, LocalProgress] = field(default_factory=dict)
    attempts: Mapping[str, Sequence[LocalAttempt]] = field(default_factory=dict)
    #: Lecciones con al menos un job en el historial (parte de «tocada»).
    lesson_ids_con_jobs: frozenset[str] = frozenset()
    #: Lecciones con al menos una fila en ``quiz_attempts``, **aunque su
    #: ``answers`` no se pueda leer**. Va aparte de ``attempts`` a propósito:
    #: ``attempts`` es la evidencia UTILIZABLE para recalificar, y esto es el
    #: HECHO de que el estudiante intentó el quiz. Confundir las dos hacía que
    #: un `answers` corrupto borrase la lección como si nunca la hubiera tocado.
    lesson_ids_con_intentos: frozenset[str] = frozenset()
    #: ``module_id`` → ``'local'`` | ``'remote'``.
    module_origin: Mapping[str, str] = field(default_factory=dict)
    #: ``example_id`` → ``module_id`` dueño hoy (incluye ejemplos sin lección).
    example_owner: Mapping[str, str] = field(default_factory=dict)
    #: ``question_id`` → ``lesson_id`` dueña hoy.
    question_owner: Mapping[str, str] = field(default_factory=dict)
    #: ``modules."order"`` ya ocupados por OTROS módulos (UNIQUE global).
    orders_ocupados: frozenset[int] = frozenset()


@dataclass(frozen=True, slots=True)
class MergeOptions:
    """Las dos decisiones del estudiante sobre el merge. El default conserva;
    el valor destructivo y el peligroso hay que pedirlos a mano."""

    #: ``archive`` (default) conserva progreso e historial; ``purge`` los borra.
    on_removed_lessons: OnRemovedLessons = "archive"
    #: Mecánicamente el downgrade es una actualización más (el bundle es un
    #: estado completo, no un parche); lo peligroso es la semántica.
    allow_downgrade: bool = False


class MergeRechazado(Exception):
    """El plan no se puede construir: política de versión violada.

    Se lanza ANTES de mirar una sola lección, y por tanto antes de que el
    aplicador exista. ``code`` es el del contrato congelado (§11.3) para que el
    router lo traduzca sin tabla intermedia; ``motivo`` distingue los dos casos
    que ese único código cubre.
    """

    def __init__(self, code: str, motivo: str, mensaje: str) -> None:
        super().__init__(mensaje)
        self.code = code
        self.motivo = motivo


# ── Utilidades puras sobre el bundle ─────────────────────────────────────────


def id_pregunta(lesson_id: str, pregunta: BundleQuizQuestion) -> str:
    """Id efectivo de una pregunta del bundle (BL-18: ``id`` es opcional).

    Misma regla que ``content_writer._assign_question_ids``: sin id se
    autogenera ``{lesson_id}-q{order}``. Comparar conjuntos de ids sin resolver
    antes los ``None`` haría que dos quizzes idénticos parecieran distintos.
    """
    return pregunta.id or f"{lesson_id}-q{pregunta.order}"


def preguntas_del_bundle(leccion: BundleLesson) -> dict[str, BundleQuizQuestion]:
    """``{id efectivo: pregunta}`` de la lección; vacío si no trae quiz."""
    if leccion.quiz is None:
        return {}
    return {id_pregunta(leccion.id, q): q for q in leccion.quiz.questions}


def umbral_efectivo(leccion: BundleLesson) -> float:
    """Umbral con el que el servidor calificará esta lección tras instalarla.

    El que manda es ``lessons.pass_threshold`` (es la columna que lee
    ``QuizService``). El bundle declara además uno dentro del quiz; si los dos
    discrepan —incoherencia que el validador de contenido rechaza— se toma el
    **más exigente**, para no conceder aquí un ``completed`` que el servidor
    luego no reconocería. Conceder de menos es recuperable; de más, no.
    """
    if leccion.quiz is None:
        return leccion.pass_threshold
    return max(leccion.pass_threshold, leccion.quiz.pass_threshold)


def calificar_intento(
    respuestas: Mapping[str, str], preguntas: Mapping[str, BundleQuizQuestion]
) -> int | None:
    """Aciertos de un intento pasado corregido con la clave NUEVA.

    Devuelve ``None`` si el intento **no cubre todas** las preguntas del quiz
    nuevo, y entonces no se usa para nada.

    El porqué: ``QuizService._validate_answers`` EXIGE respuesta a todas las
    preguntas, así que un intento parcial nunca fue un intento válido. Contar
    solo lo respondido y dividir luego por el total nuevo fabricaba evidencia:
    un intento de 2/2 sobre un quiz que después creció a 3 preguntas se
    recalificaba como 2/3 = 0,667 y APROBABA una lección cuya tercera pregunta
    el estudiante no vio nunca. Un aprobado así es además irreversible, porque
    ``completed`` es monótono.
    """
    if not set(preguntas).issubset(respuestas):
        return None
    return sum(
        1
        for qid, pregunta in preguntas.items()
        if respuestas[qid] == pregunta.correct_key
    )


def _opciones_bundle(pregunta: BundleQuizQuestion) -> dict[str, str]:
    return {o.key: o.text for o in pregunta.options}


def _firma_bundle(pregunta: BundleQuizQuestion) -> tuple:
    """Identidad COMPLETA de una pregunta entrante: enunciado + opciones."""
    return (pregunta.text, tuple(sorted(_opciones_bundle(pregunta).items())))


def _firma_local(pregunta: Any) -> tuple:
    """Idem para la pregunta ya instalada (mismo orden de campos)."""
    return (pregunta.text, tuple(sorted(dict(pregunta.options).items())))


def _video(url: str | None) -> str | None:
    """Forma canónica de la URL, para comparar el bundle crudo con lo guardado.

    El instalador guarda la URL **reconstruida** por ``services/youtube``; sin
    normalizar aquí, un bundle idéntico al instalado parecería haber cambiado.
    Si la URL no es válida, se compara cruda: decidir eso es del validador.
    """
    try:
        return normalizar_video(url)
    except VideoUrlError:
        return url


# ── El corazón: el progreso de UNA lección (algoritmoMerge.md §4.2) ──────────


def plan_progress(
    lesson_id: str,
    progreso: LocalProgress | None,
    intentos: Sequence[LocalAttempt],
    *,
    old: LocalLesson,
    new: BundleLesson,
) -> ProgressOp | None:
    """Qué se escribe en ``lesson_progress`` de una lección que sigue viniendo.

    Devuelve ``None`` sin fila previa: escribir una inventaría avance donde no
    lo hubo. El ``ProgressOp`` que sí devuelve es un **SET absoluto**
    (``best_quiz_score`` puede quedar en ``None``), y por eso el aplicador no
    puede pasarlo por ``ProgressRepository.upsert``, cuyo SQL aplica
    ``MAX(best_quiz_score, :nuevo)`` y ``COALESCE``: es incapaz de bajar el valor
    y de escribir NULL, y un 4/4 obsoleto se quedaría pegado para siempre.

    La decisión clave es una sola: **¿la evidencia pasada sigue siendo
    interpretable contra el quiz nuevo?** Se responde comparando el CONJUNTO DE
    IDS de pregunta y los textos de las opciones, nunca el número de preguntas.
    """
    if progreso is None:
        return None

    viejas = {q.id: q for q in old.questions}
    nuevas = preguntas_del_bundle(new)

    mismo_conjunto = set(viejas) == set(nuevas)
    # La firma incluye el ENUNCIADO, no solo las opciones. Sin él se colaban dos
    # fallos distintos con la misma raíz:
    #
    #  · BL-18 deja omitir el `id` de una pregunta, y entonces el id efectivo es
    #    `{lesson_id}-q{order}`. Si el autor solo REORDENA las preguntas, los ids
    #    se INTERCAMBIAN: el conjunto no cambia, y en un quiz de verdadero/falso
    #    —donde todas comparten opciones— cada respuesta se corregía contra otra
    #    pregunta. Un estudiante que falló las dos acababa aprobado.
    #  · Corregir el enunciado dejando las mismas opciones («¿cuánto es 2+2?» →
    #    «¿cuánto es 3+3?») recalificaba respuestas que ya no significan lo mismo.
    #
    # La regla conservadora es la correcta aquí por asimetría de costes: no
    # recalificar solo anula una nota caché y el estudiante puede reintentar;
    # recalificar mal concede un `completed` que nunca se ganó, y como
    # `completed` es monótono, no hay vuelta atrás.
    mismas_preguntas = mismo_conjunto and all(
        _firma_local(viejas[qid]) == _firma_bundle(nuevas[qid]) for qid in nuevas
    )
    # `bool(nuevas)`: si el quiz desapareció no hay nada contra lo que corregir.
    recalificable = bool(nuevas) and mismas_preguntas

    if recalificable:
        total = len(nuevas)
        umbral = umbral_efectivo(new)
        # Los intentos parciales devuelven None y quedan fuera: no eran intentos
        # válidos, así que no son evidencia de nada.
        notas = [
            nota
            for nota in (calificar_intento(i.answers, nuevas) for i in intentos)
            if nota is not None
        ]
        # Sin intentos no hay recálculo posible: anular la caché sería destruir
        # un dato sin evidencia que lo justifique, y A1 exige que actualizar sin
        # cambios sea un no-op absoluto sobre el progreso.
        mejor = max(notas, default=progreso.best_quiz_score)
        # Misma expresión que `QuizService.submit_attempt`, a propósito: el plan
        # debe predecir exactamente el veredicto que dará el servidor después.
        # S2 (diseño A): igual que el servidor, el quiz solo completa si la
        # regla de la lección es `quiz` y la lección está habilitada.
        ganado = (
            new.completion_rule == "quiz"
            and new.enabled
            and any((nota / total) >= umbral for nota in notas)
        )
    else:
        # Evidencia no interpretable (creció, encogió, cambió el set o las
        # opciones, o el quiz desapareció): se anula la CACHÉ. El histórico
        # queda intacto en `quiz_attempts` y sigue siendo mostrable.
        mejor, ganado = None, False

    # MONOTONÍA: `completed` solo puede subir. Un cambio del autor no revoca un
    # logro del estudiante; solo él lo revoca, con el PUT de §6.2.
    completado = progreso.completed or ganado
    sin_efecto = mejor == progreso.best_quiz_score and completado == progreso.completed

    return ProgressOp(
        lesson_id=lesson_id,
        effect="preserved" if sin_efecto else "rescored",
        viewed=progreso.viewed,  # observado ⇒ intacto
        completed=completado,
        completed_via=progreso.completed_via or ("quiz" if ganado else None),
        best_quiz_score=mejor,
        last_job_id=progreso.last_job_id,  # observado ⇒ intacto
        previous_best_score=progreso.best_quiz_score,
        previous_total=len(viejas),
    )


# ── El plan completo (algoritmoMerge.md §4.1) ────────────────────────────────


def build_plan(
    local: LocalModuleState,
    bundle: ModuleBundle,
    opts: MergeOptions | None = None,
) -> MergePlan:
    """Plan de instalar o actualizar ``bundle`` sobre el estado ``local``.

    PURA: mismas entradas, mismo plan, cero efectos. Lanza
    :class:`MergeRechazado` si la política de versión no se cumple, y acumula en
    ``plan.conflicts`` las colisiones de identidad — con conflictos, el
    aplicador **no se ejecuta** y no se escribe nada.
    """
    opts = opts or MergeOptions()
    if local.module_id != bundle.module.id:
        raise ValueError(
            f"el estado local es del módulo '{local.module_id}' y el bundle del "
            f"módulo '{bundle.module.id}': no se pueden fusionar"
        )

    orden, reasignado = _resolver_order(local, bundle)
    plan = MergePlan(
        module_id=bundle.module.id,
        from_version=local.version,
        to_version=bundle.module.version,
        to_checksum=bundle.checksum,
        on_removed_lessons=opts.on_removed_lessons,
        local_order=orden,
        order_reassigned=reasignado,
    )
    plan.warnings.extend(_verificar_version(local, bundle, opts))

    entrantes = {leccion.id: leccion for leccion in bundle.lessons}
    propias = {
        lid: leccion
        for lid, leccion in local.lessons.items()
        if leccion.module_id == bundle.module.id
    }

    _detectar_conflictos(plan, local, bundle, entrantes)
    _planificar_entrantes(plan, local, bundle, entrantes)
    _planificar_desaparecidas(plan, local, opts, entrantes, propias)
    _avisar_posibles_renombrados(plan, local, entrantes)
    _podar_recomendadas(plan, local, entrantes)
    return plan


def _resolver_order(local: LocalModuleState, bundle: ModuleBundle) -> tuple[int, bool]:
    """``modules."order"`` del módulo: local en la actualización, sugerido al instalar.

    En la ACTUALIZACIÓN no se toca (D5): la posición del módulo en la ruta es
    una decisión del estudiante, y reordenarle el curso sin pedir permiso es un
    efecto lateral inaceptable. En la INSTALACIÓN el ``order_hint`` del autor es
    solo una sugerencia; si está tomado se asigna ``MAX + 1``, porque la columna
    es UNIQUE global y dos autores pueden publicar ambos con ``order_hint: 3``.
    """
    if local.order is not None:
        return local.order, False
    sugerido = bundle.module.order_hint
    if sugerido not in local.orders_ocupados:
        return sugerido, False
    return max(local.orders_ocupados) + 1, True


def _verificar_version(
    local: LocalModuleState, bundle: ModuleBundle, opts: MergeOptions
) -> list[MergeWarning]:
    """Política de versión (C1/C2/C3). Sin versión previa no hay nada que exigir."""
    if local.version is None:
        return []

    nueva, instalada = bundle.module.version, local.version
    if nueva > instalada:
        return []

    if nueva == instalada:
        # Una versión publicada es INMUTABLE: si el contenido cambia bajo el
        # mismo número, «¿hay actualización?» deja de ser decidible por versión,
        # que es el eje del mecanismo. Mismo par ⇒ reaplicar es idempotente.
        if local.checksum is not None and local.checksum != bundle.checksum:
            raise MergeRechazado(
                "VERSION_CONFLICT",
                "tampered",
                f"La versión {nueva} ya instalada tiene otro contenido "
                f"(checksum distinto): una versión publicada es inmutable.",
            )
        return []

    if not opts.allow_downgrade:
        raise MergeRechazado(
            "VERSION_CONFLICT",
            "downgrade",
            f"La versión ofrecida ({nueva}) es anterior a la instalada "
            f"({instalada}); el downgrade hay que pedirlo explícitamente.",
        )
    return [
        MergeWarning(
            code=AVISO_DOWNGRADE,
            message=(
                f"Vas a volver de la versión {instalada} a la {nueva}: las "
                f"lecciones que solo existían en la {instalada} se archivarán "
                f"con su avance."
            ),
        )
    ]


def _detectar_conflictos(
    plan: MergePlan,
    local: LocalModuleState,
    bundle: ModuleBundle,
    entrantes: Mapping[str, BundleLesson],
) -> None:
    """Colisiones de identidad sobre claves GLOBALES (D1–D4). Abortan el merge."""
    for lid, entrante in entrantes.items():
        anterior = local.lessons.get(lid)
        if anterior is not None and anterior.module_id != bundle.module.id:
            if local.module_origin.get(anterior.module_id) == "local":
                # A9/D2: lo remoto no le roba contenido a lo autorado aquí.
                plan.conflicts.append(
                    MergeConflict(
                        code=CONFLICTO_LECCION_DE_MODULO_LOCAL,
                        field="lesson_id",
                        id=lid,
                        owner_module_id=anterior.module_id,
                    )
                )
            else:
                # D1/A7: re-parenting declarado. El progreso viaja gratis porque
                # está anclado al `lesson_id` y no sabe de módulos.
                plan.moved_in.append(
                    LessonMove(lesson_id=lid, from_module_id=anterior.module_id)
                )

        if entrante.example is not None:
            duenio = local.example_owner.get(entrante.example.id)
            if duenio is not None and duenio != bundle.module.id:
                plan.conflicts.append(
                    MergeConflict(
                        code=CONFLICTO_EJEMPLO_DE_OTRO_MODULO,
                        field="example_id",
                        id=entrante.example.id,
                        owner_module_id=duenio,
                    )
                )

        for qid in preguntas_del_bundle(entrante):
            duenia = local.question_owner.get(qid)
            if duenia is None or duenia == lid:
                continue
            # La pregunta pertenece a otra lección QUE TAMBIÉN VIENE en este
            # bundle: el autor la movió de sitio dentro de su propio módulo.
            # No es conflicto, porque `_reemplazar_quizzes` borra las preguntas
            # de TODAS las lecciones entrantes antes de insertar ninguna. Sin
            # esta salida, mover una pregunta de l1 a l2 dejaba el módulo
            # imposible de actualizar para siempre, con un 409 que el estudiante
            # no puede resolver. (El mismo movimiento con un EJEMPLO nunca dio
            # conflicto: la asimetría era el síntoma.)
            if any(l.id == duenia for l in bundle.lessons):
                continue
            leccion_duenia = local.lessons.get(duenia)
            plan.conflicts.append(
                MergeConflict(
                    code=CONFLICTO_PREGUNTA_DE_OTRA_LECCION,
                    field="question_id",
                    id=qid,
                    owner_module_id=(
                        leccion_duenia.module_id if leccion_duenia else None
                    ),
                )
            )


def _planificar_entrantes(
    plan: MergePlan,
    local: LocalModuleState,
    bundle: ModuleBundle,
    entrantes: Mapping[str, BundleLesson],
) -> None:
    """Las lecciones que trae la versión nueva.

    ``added`` son las que **nacen** en cero. Una lección que ya existe en otro
    módulo no nace: se re-parenta (``moved_in``) y entra por ``updated``, para
    que su progreso se recalifique igual que el de cualquier otra. Si entrara
    como ``added`` su nota obsoleta viajaría intacta con ella.

    ``revised`` y ``unchanged`` son SUBCONJUNTOS de ``updated``, no alternativas:
    el aplicador hace UPSERT de todo lo entrante pase lo que pase, así que una
    clasificación imprecisa afea el reporte pero no puede perder contenido.
    """
    for lid, entrante in entrantes.items():
        anterior = local.lessons.get(lid)
        if anterior is None:
            plan.added.append(lid)
            continue

        plan.updated.append(lid)
        if anterior.archived_at is not None:
            plan.restored.append(lid)  # A6: vuelve a la vida con su progreso
        if anterior.content_markdown != entrante.content_markdown:
            plan.revised.append(lid)
        elif anterior.module_id == bundle.module.id and _sin_cambios(
            anterior, entrante
        ):
            plan.unchanged.append(lid)

        operacion = plan_progress(
            lid,
            local.progress.get(lid),
            local.attempts.get(lid, ()),
            old=anterior,
            new=entrante,
        )
        if operacion is not None:
            plan.progress_ops.append(operacion)


def _planificar_desaparecidas(
    plan: MergePlan,
    local: LocalModuleState,
    opts: MergeOptions,
    entrantes: Mapping[str, BundleLesson],
    propias: Mapping[str, LocalLesson],
) -> None:
    """Las lecciones de este módulo que la versión nueva ya no trae (A4/A5).

    Tocada (progreso, intentos o jobs) ⇒ se **archiva**: fila y avance se
    conservan, y el historial de jobs sigue resolviendo su título en vez de
    mostrar «lección desconocida». Intacta ⇒ borrado limpio. Ya archivada ⇒ no
    se toca, o el reporte mentiría en cada actualización siguiente.
    """
    for lid, anterior in propias.items():
        if lid in entrantes or anterior.archived_at is not None:
            continue

        tocada = _tocada(local, lid)
        if opts.on_removed_lessons == "purge":
            plan.removed.append(lid)
            if tocada:
                plan.warnings.append(
                    MergeWarning(
                        code=AVISO_PROGRESO_PURGADO,
                        message=(
                            "Pediste borrar el avance de las lecciones "
                            "retiradas: el de esta se pierde y no se recupera."
                        ),
                        lesson_id=lid,
                    )
                )
            continue

        if not tocada:
            plan.removed.append(lid)
            continue

        plan.archived.append(lid)
        plan.warnings.append(
            MergeWarning(
                code=AVISO_LECCION_RETIRADA,
                message=(
                    f"La versión {plan.to_version} ya no incluye esta lección; "
                    "tu avance se conserva y deja de contar en la ruta."
                ),
                lesson_id=lid,
            )
        )
        progreso = local.progress.get(lid)
        if progreso is not None:
            # Archivar NO recalcula nada: el quiz por el que se aprobó sigue en
            # la fila archivada, así que la nota conserva su denominador.
            plan.progress_ops.append(
                ProgressOp(
                    lesson_id=lid,
                    effect="archived",
                    viewed=progreso.viewed,
                    completed=progreso.completed,
                    completed_via=progreso.completed_via,
                    best_quiz_score=progreso.best_quiz_score,
                    last_job_id=progreso.last_job_id,
                    previous_best_score=progreso.best_quiz_score,
                    previous_total=len(anterior.questions),
                )
            )


def _avisar_posibles_renombrados(
    plan: MergePlan, local: LocalModuleState, entrantes: Mapping[str, BundleLesson]
) -> None:
    """«n archivadas + n nuevas con el mismo título» ⇒ sospecha de rename (D8).

    Es el único caso en que el estudiante pierde el vínculo con su avance, y el
    plan **no lo arregla adivinando**: dos lecciones con el mismo título pueden
    ser cosas distintas, y transferir progreso por parecido tipográfico le
    atribuiría a alguien un logro que no obtuvo. Lo que sí puede es verlo y
    decirlo. El emparejamiento es 1:1 y por orden, para no llenar el reporte de
    avisos cruzados cuando hay varias homónimas.
    """
    candidatas = list(plan.added)
    for archivada in plan.archived:
        titulo = _titulo(local.lessons[archivada].title)
        gemela = next(
            (lid for lid in candidatas if _titulo(entrantes[lid].title) == titulo), None
        )
        if gemela is None:
            continue
        candidatas.remove(gemela)
        plan.warnings.append(
            MergeWarning(
                code=AVISO_POSIBLE_RENOMBRADO,
                message=(
                    f"'{gemela}' tiene el mismo título que '{archivada}' pero "
                    "otro id: se trata como lección nueva y el avance NO se "
                    "transfiere."
                ),
                lesson_id=archivada,
                related_lesson_id=gemela,
            )
        )


def _podar_recomendadas(
    plan: MergePlan, local: LocalModuleState, entrantes: Mapping[str, BundleLesson]
) -> None:
    """``recommended`` que apunta a una lección que no quedará instalada (D7).

    El snapshot ya poda estas referencias al cargarse, así que no hay riesgo de
    500; podarlas aquí es para poder **decirlo** en el reporte, en vez de que un
    enlace desaparezca de la UI sin explicación.
    """
    resolubles = (set(local.lessons) - set(plan.removed)) | set(entrantes)
    for lid, entrante in entrantes.items():
        for recomendada in entrante.recommended:
            if recomendada.lesson_id in resolubles:
                continue
            plan.pruned_recommended.append(
                RecommendedPrune(lesson_id=lid, target_lesson_id=recomendada.lesson_id)
            )
            plan.warnings.append(
                MergeWarning(
                    code=AVISO_RECOMENDADA_PODADA,
                    message=(
                        f"La lección recomendada '{recomendada.lesson_id}' no "
                        "está instalada: el enlace se oculta hasta que lo esté."
                    ),
                    lesson_id=lid,
                    related_lesson_id=recomendada.lesson_id,
                )
            )


def _tocada(local: LocalModuleState, lesson_id: str) -> bool:
    """¿Hay hecho biográfico en esta lección? Progreso ∨ intentos ∨ jobs.

    Los intentos se miran por ``lesson_ids_con_intentos``, no por ``attempts``:
    lo que decide si una lección se archiva en vez de borrarse es que el
    estudiante la HAYA intentado, no que sus respuestas sigan siendo legibles.
    """
    return (
        lesson_id in local.progress
        or lesson_id in local.lesson_ids_con_intentos
        or bool(local.attempts.get(lesson_id))
        or lesson_id in local.lesson_ids_con_jobs
    )


def _titulo(texto: str) -> str:
    """Título normalizado para la sospecha de rename (aviso, no decisión)."""
    return " ".join(texto.split()).casefold()


def _firma_quiz_local(anterior: LocalLesson) -> tuple:
    return tuple(
        sorted(
            (q.id, q.order, q.text, tuple(q.options), q.correct_key, q.explanation)
            for q in anterior.questions
        )
    )


def _firma_quiz_bundle(entrante: BundleLesson) -> tuple:
    if entrante.quiz is None:
        return ()
    return tuple(
        sorted(
            (
                id_pregunta(entrante.id, q),
                q.order,
                q.text,
                tuple((o.key, o.text) for o in q.options),
                q.correct_key,
                q.explanation,
            )
            for q in entrante.quiz.questions
        )
    )


def _sin_cambios(anterior: LocalLesson, entrante: BundleLesson) -> bool:
    """¿La lección llega idéntica a la instalada? Solo para el reporte.

    Del ejemplo se comparan ``id`` y ``source_code``, no sus metadatos: es lo
    que el estado local transporta, y equivocarse aquí a lo sumo dice «no
    cambió» de un cambio cosmético — el UPSERT reescribe el ejemplo entero
    igualmente, así que la clasificación nunca decide qué se guarda.
    """
    return (
        anterior.archived_at is None
        and anterior.order == entrante.order
        and anterior.title == entrante.title
        and anterior.estimated_minutes == entrante.estimated_minutes
        and anterior.content_markdown == entrante.content_markdown
        and _video(anterior.video_url) == _video(entrante.video_url)
        and anterior.enabled == entrante.enabled
        and anterior.completion_rule == entrante.completion_rule
        and anterior.pass_threshold == entrante.pass_threshold
        and tuple(anterior.recommended)
        == tuple((r.lesson_id, r.label, r.tag) for r in entrante.recommended)
        and anterior.example_id == (entrante.example.id if entrante.example else None)
        and anterior.example_source_code
        == (entrante.example.source_code if entrante.example else None)
        and _firma_quiz_local(anterior) == _firma_quiz_bundle(entrante)
        and anterior.kind == (entrante.kind or "leccion")
        and anterior.steps
        == tuple((p.title, p.body_markdown, p.example_id) for p in entrante.steps or ())
    )


__all__ = [
    "CONFLICTO_LECCION_DE_MODULO_LOCAL",
    "CONFLICTO_EJEMPLO_DE_OTRO_MODULO",
    "CONFLICTO_PREGUNTA_DE_OTRA_LECCION",
    "AVISO_LECCION_RETIRADA",
    "AVISO_POSIBLE_RENOMBRADO",
    "AVISO_RECOMENDADA_PODADA",
    "AVISO_PROGRESO_PURGADO",
    "AVISO_DOWNGRADE",
    "CompletedVia",
    "LocalRecommended",
    "LocalQuestion",
    "LocalLesson",
    "LocalProgress",
    "LocalAttempt",
    "LocalModuleState",
    "MergeOptions",
    "MergeRechazado",
    "id_pregunta",
    "preguntas_del_bundle",
    "umbral_efectivo",
    "calificar_intento",
    "plan_progress",
    "build_plan",
]
