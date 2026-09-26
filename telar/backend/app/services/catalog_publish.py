"""Publicar un módulo local en el bucket — api-contract §11.8.2 (CU-38, admin).

Lo que este módulo hace, en el orden en que importa:

1. **Construye el bundle** a partir del snapshot local (``app.state.content``),
   no de SQL. El snapshot ya es la verdad que sirve el resto de la API, así que
   publicar desde él garantiza que lo que sube es exactamente lo que el admin
   está viendo en su pantalla.
2. **Calcula los avisos** de §11.8.2 comparando con la versión ya publicada. El
   importante es ``LESSON_ID_REMOVED``: anuncia que **quien actualice perderá su
   avance** en esa lección. Publicar es irreversible (la versión es inmutable),
   así que el aviso tiene que llegar ANTES, y por eso existe ``dry_run``.
3. **Serializa y firma** con ``catalog_hash``, la única definición del checksum.
4. **Sube**: bundle inmutable primero, índice después. Ese orden no es
   arbitrario — ver `publish_module`.

Separado de ``catalog_publisher`` a propósito: allí vive el TRANSPORTE (puerto,
drivers, credencial) y aquí la REGLA. Así el driver local del E2E ejercita esta
lógica entera sin GCP.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from app.errors import ApiException
from app.schemas.admin_catalog import AdminPublishRequest, AdminPublishResult
from app.schemas.catalog import (
    BUNDLE_FORMAT,
    BUNDLE_FORMAT_TALLERES,
    INDEX_FORMAT,
    BundleExample,
    BundleLesson,
    BundleModule,
    BundleQuiz,
    BundleQuizOption,
    BundleQuizQuestion,
    BundleRecommended,
    BundleStep,
    CatalogIndex,
    CatalogIndexEntry,
    ContentWarning,
    ModuleBundle,
)
from app.services.bundle_guard import BundleGuardError, parse_bundle
from app.services.catalog_client import object_path_for
from app.services.catalog_hash import bundle_checksum, content_hash
from app.services.catalog_publisher import (
    BundleAlreadyPublished,
    CatalogWritePort,
    IndexCasFailed,
    PublisherUnavailable,
    _api,
)
from app.services.module_updater import validar_bundle, verificar_checksum

if TYPE_CHECKING:  # pragma: no cover - solo tipos
    from app.config import Settings
    from app.repositories.content import ContentRepository, Lesson, Module

logger = logging.getLogger("telar.catalog_publish")

#: §11.8.2 — códigos de aviso. No bloquean: el admin decide. Que no bloqueen es
#: deliberado — un autor puede querer retirar una lección a sabiendas—, pero
#: entonces DEBE verlo antes, que es lo que sostiene `dry_run`.
AVISO_LECCION_RETIRADA = "LESSON_ID_REMOVED"
AVISO_LECCION_NUEVA = "LESSON_ID_ADDED"
AVISO_QUIZ_CAMBIADO = "QUIZ_SHAPE_CHANGED"
#: §11.8.2 — el ejemplo tenía el id de su propia lección y se publica derivado.
AVISO_EJEMPLO_RENOMBRADO = "EXAMPLE_ID_RENAMED"

#: Sufijo del id derivado. Corto y legible: el admin tiene que reconocer el
#: ejemplo en el bundle publicado sin traducir nada.
SUFIJO_EJEMPLO = "-ej"


def _normalizar_saltos(valor: Any) -> Any:
    """CRLF y CR sueltos → LF, recursivamente por todo el bundle.

    No es cosmética: ``bundle_guard`` —el validador que corre en la máquina del
    ESTUDIANTE— rechaza cualquier carácter de control que no sea ``\n`` o
    ``\t``, así que un ``\r`` hace que el módulo publicado sea **imposible de
    instalar**. Y el ``\r`` no es hipotético: aparece en cuanto alguien edita un
    ejemplo en Windows, que es justo donde se escribe este contenido.

    Se normaliza en vez de rechazar porque el final de línea **no es semántico**:
    devolverle al autor un 422 por algo que puso su editor solo, y que además
    haría impublicable el contenido del propio repo, sería castigarle por una
    diferencia que a nadie le importa. Lo que sí es semántico —el resto de
    caracteres de control— lo sigue rechazando el guard.

    Se hace sobre el bundle YA construido y ANTES de firmarlo, para que el
    checksum sea el de los bytes normalizados: los mismos que se suben y los
    mismos que el estudiante volverá a hashear.
    """
    if isinstance(valor, str):
        return valor.replace("\r\n", "\n").replace("\r", "\n")
    if isinstance(valor, list):
        return [_normalizar_saltos(v) for v in valor]
    if isinstance(valor, dict):
        return {k: _normalizar_saltos(v) for k, v in valor.items()}
    return valor


def bytes_publicables(bundle: ModuleBundle) -> bytes:
    """Los bytes EXACTOS que se suben al bucket: el bundle COMPLETO.

    Ojo con la trampa: `canonical_bundle_bytes` NO sirve aquí. Esa serializa el
    bundle **sin** su campo ``checksum``, porque es la entrada del hash y meter
    el checksum dentro de su propio cálculo sería circular. Pero el archivo
    publicado sí lleva el checksum dentro (§11.10) — es lo que permite al
    estudiante verificar sin consultar el índice.

    Subir la forma canónica de hash en lugar de esta produce un JSON al que le
    falta ``checksum``: el instalador lo rechaza como bundle inválido y el
    módulo es impublicable en la práctica. Lo destapó
    ``test_lo_publicado_lo_puede_instalar_el_estudiante``.

    Mismo formato que `e2e/scripts/preparar-bucket.py`, para que el bucket falso
    del E2E y el publicador real produzcan bytes idénticos.
    """
    return json.dumps(
        bundle.model_dump(mode="json"),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _ahora_iso() -> str:
    """Mismo formato que ``schema.sql``: ISO-8601 UTC con milisegundos."""
    ahora = datetime.now(timezone.utc)
    return f"{ahora:%Y-%m-%dT%H:%M:%S}.{ahora.microsecond // 1000:03d}Z"


# ═════════════════════════ 1 · construir el bundle ═══════════════════════════


def _recomendadas(leccion: "Lesson") -> list[BundleRecommended]:
    return [
        BundleRecommended(lesson_id=r.lesson_id, label=r.label, tag=r.tag)
        for r in leccion.recommended
    ]


def _ejemplo(
    content: "ContentRepository", leccion: "Lesson", id_publicado: str | None = None
) -> BundleExample | None:
    """El ejemplo de la lección, o ``None`` si es teórica (E1).

    ``id_publicado`` permite subirlo con un id distinto del local: ver
    `_resolver_ids_de_ejemplo`.
    """
    if leccion.example_id is None:
        return None
    ej = content.example(leccion.example_id)
    if ej is None:  # pragma: no cover - el snapshot es coherente por construcción
        return None
    return BundleExample(
        id=id_publicado or ej.id,
        filename=ej.filename,
        title=ej.title,
        difficulty=ej.difficulty,
        teaches=ej.teaches,
        directives=list(ej.directives),
        threads_configurable=ej.threads_configurable,
        fixed_threads=ej.fixed_threads,
        fixed_threads_note=ej.fixed_threads_note,
        sweeps_threads=ej.sweeps_threads,
        self_measures=ej.self_measures,
        parser_id=ej.parser_id,
        default_timeout_s=ej.default_timeout_s,
        est_run_seconds=ej.est_run_seconds,
        enabled=ej.enabled,
        requires_gpu=ej.requires_gpu,
        expected_output_note=ej.expected_output_note,
        takeaways=list(ej.takeaways),
        source_code=ej.source_code,
    )


def _quiz(content: "ContentRepository", leccion: "Lesson") -> BundleQuiz | None:
    quiz = content.quiz(leccion.id)
    if quiz is None or not quiz.questions:
        return None
    return BundleQuiz(
        pass_threshold=quiz.pass_threshold,
        questions=[
            BundleQuizQuestion(
                id=q.id,
                order=q.order,
                text=q.text,
                options=[BundleQuizOption(key=o.key, text=o.text) for o in q.options],
                correct_key=q.correct_key,
                explanation=q.explanation,
            )
            for q in quiz.questions
        ],
    )


def _pasos(
    leccion: "Lesson", publicado_de: dict[str, str]
) -> list[BundleStep] | None:
    """S6 (§12.4): los pasos de un taller, con el ``example_id`` PUBLICADO.

    Un ejemplo renombrado por `_resolver_ids_de_ejemplo` viaja con otro id; el
    paso tiene que nombrarlo así o el bundle no se instalaría. Un ejemplo que no
    es de este módulo se deja tal cual y lo rechaza el guard antes de subir.
    ``None`` en una lección normal: el campo no se publica (bundle 1 intacto).
    """
    if not leccion.is_taller:
        return None
    return [
        BundleStep(
            title=paso.title,
            body_markdown=paso.body_markdown,
            example_id=(
                publicado_de.get(paso.example_id, paso.example_id)
                if paso.example_id is not None
                else None
            ),
        )
        for paso in leccion.steps
    ]


def _resolver_ids_de_ejemplo(
    content: "ContentRepository", lecciones: "list[Lesson]"
) -> tuple[dict[str, str], list[ContentWarning]]:
    """``{lesson_id: id_del_ejemplo_a_publicar}`` + los avisos del renombrado.

    Lecciones y ejemplos comparten espacio de nombres (§10.6), pero el contenido
    histórico del repo tiene ``examples.id == lessons.id`` (backfill de la
    migración 5). Un bundle con esa colisión lo rechaza `bundle_guard` en la
    máquina del ESTUDIANTE, así que sin resolverla aquí ninguno de los 8 módulos
    del baseline sería publicable — verificado, no supuesto.

    Se renombra solo lo que choca, y se avisa de cada caso: el renombrado afecta
    únicamente al bundle publicado (la base local no se toca), pero cambia lo que
    devolverá una reimportación, y eso el admin tiene que saberlo.
    """
    ids_de_leccion = {l.id for l in lecciones}
    resuelto: dict[str, str] = {}
    avisos: list[ContentWarning] = []
    for leccion in lecciones:
        if leccion.example_id is None:
            continue
        if leccion.example_id not in ids_de_leccion:
            resuelto[leccion.id] = leccion.example_id
            continue
        derivado = f"{leccion.id}{SUFIJO_EJEMPLO}"
        resuelto[leccion.id] = derivado
        avisos.append(
            ContentWarning(
                code=AVISO_EJEMPLO_RENOMBRADO,
                lesson_id=leccion.id,
                message=(
                    f"El ejemplo '{leccion.example_id}' usa el id de su propia "
                    f"lección; se publica como '{derivado}'."
                ),
            )
        )
    return resuelto, avisos


def construir_bundle(
    content: "ContentRepository",
    module_id: str,
    *,
    version: int,
    published_at: str,
    notes: str = "",
    author_label: str = "",
) -> tuple[ModuleBundle, list[ContentWarning]]:
    """Snapshot local → ``ModuleBundle`` de §11.10 ya firmado, + avisos de ids.

    Se excluyen las lecciones **archivadas**: una lección archivada es contenido
    que el autor retiró, y publicarla la resucitaría en la instalación de todos
    los estudiantes.

    El ``order`` se **renumera** a ``1..n`` respetando el orden local. En local
    basta con que sea único (archivar o borrar deja huecos: 1, 2, 5), pero el
    bundle exige ``1..n`` contiguo (§11.10, E2) y el guard del estudiante
    rechazaría el hueco: copiarlo tal cual hacía impublicable cualquier módulo
    al que se le hubiera quitado una lección.

    ``checksum`` se calcula al final, sobre el bundle SIN ese campo. Se pone un
    placeholder de 64 ceros para poder construir el modelo (el patrón lo exige) y
    se sustituye por el valor real: ``catalog_hash`` ignora el campo justamente
    para que este orden sea posible sin circularidad.
    """
    modulo = next((m for m in content.modules() if m.id == module_id), None)
    if modulo is None:
        raise _api("MODULE_NOT_FOUND", f"No existe el módulo '{module_id}'.")

    lecciones = sorted(
        (
            l
            for l in content.lessons()
            if l.module_id == module_id and not l.archived
        ),
        key=lambda l: l.order,
    )
    if not lecciones:
        # El esquema exige `min_length=1`; un 422 explicado es mejor que un
        # ValidationError de pydantic que el admin no puede interpretar.
        raise _api(
            "CONTENT_VALIDATION_ERROR",
            f"El módulo '{module_id}' no tiene lecciones publicables.",
            details=[{"module_id": module_id, "issue": "sin lecciones activas"}],
        )

    ids_ejemplo, avisos_ids = _resolver_ids_de_ejemplo(content, lecciones)
    # S6: id local del ejemplo → id con el que se publica (para los pasos).
    publicado_de = {
        l.example_id: ids_ejemplo[l.id]
        for l in lecciones
        if l.example_id is not None and l.id in ids_ejemplo
    }
    # S6 (§12.4): el formato 2 SOLO si hay talleres; sin ellos el bundle sale
    # byte a byte como antes y la v1.0.5 lo sigue instalando.
    formato = (
        BUNDLE_FORMAT_TALLERES if any(l.is_taller for l in lecciones) else BUNDLE_FORMAT
    )

    bundle = ModuleBundle(
        bundle_format=formato,
        checksum="0" * 64,
        module=BundleModule(
            id=modulo.id,
            order_hint=modulo.order,
            title=modulo.title,
            description=modulo.description,
            level=modulo.level,
            version=version,
            published_at=published_at,
            author_label=author_label,
            notes=notes,
        ),
        lessons=[
            BundleLesson(
                id=l.id,
                order=posicion,
                title=l.title,
                estimated_minutes=l.estimated_minutes,
                content_markdown=l.content_markdown,
                video_url=l.video_url,
                enabled=l.enabled,
                completion_rule=l.completion_rule,
                pass_threshold=(
                    q.pass_threshold if (q := _quiz(content, l)) is not None else 0.6
                ),
                recommended=_recomendadas(l),
                example=_ejemplo(content, l, ids_ejemplo.get(l.id)),
                quiz=_quiz(content, l),
                kind="taller" if l.is_taller else None,
                steps=_pasos(l, publicado_de),
            )
            for posicion, l in enumerate(lecciones, start=1)
        ],
    )
    # Normalizar ANTES de firmar: el checksum tiene que ser el de lo que se sube.
    bundle = ModuleBundle.model_validate(
        _normalizar_saltos(bundle.model_dump(mode="json"))
    )
    return bundle.model_copy(update={"checksum": bundle_checksum(bundle)}), avisos_ids


# ═══════════════ 1b · validar con las reglas del importador ══════════════════

#: ``lessons[3].example.fixed_threads`` → 3. Las rutas las produce el propio
#: servidor (guard y validador), no el cliente.
_RUTA_DE_LECCION = re.compile(r"^lessons\[(\d+)\]")


def _con_leccion(detalles: Any, bundle: ModuleBundle) -> Any:
    """Añade ``lesson_id`` a cada problema que señala una lección del bundle.

    El guard habla en posiciones del BUNDLE (``lessons[3]``), que el autor no
    ve en ningún sitio: la posición cambia al renumerar y al excluir archivadas.
    El id de la lección es lo que el diálogo puede enseñar y enlazar.
    """
    if not isinstance(detalles, list):
        return detalles
    enriquecidos: list[Any] = []
    for detalle in detalles:
        encaje = (
            _RUTA_DE_LECCION.match(str(detalle.get("field", "")))
            if isinstance(detalle, dict)
            else None
        )
        indice = int(encaje.group(1)) if encaje else -1
        if 0 <= indice < len(bundle.lessons):
            detalle = {**detalle, "lesson_id": bundle.lessons[indice].id}
        enriquecidos.append(detalle)
    return enriquecidos


async def validar_como_importador(
    bundle: ModuleBundle, datos: bytes, settings: "Settings"
) -> None:
    """CU-37.1 — el bundle tiene que pasar lo MISMO que pasará en el estudiante.

    ``parse_bundle`` sobre los bytes que se van a subir (guard completo:
    caracteres, esquema, espacio de ids, reglas de §10.6) y después
    ``validar_bundle``, lo que el guard deja fuera (coherencia threads/GPU,
    tope de código, umbrales, ids de pregunta efectivos). Es la misma pareja que
    corre al actualizar, así que un bundle que sale de aquí es instalable.

    Corre también con ``dry_run``: un ensayo que dijera «todo bien» de algo que
    el estudiante va a rechazar no ensayaría nada.
    """
    try:
        await asyncio.to_thread(
            parse_bundle, datos, max_bytes=int(settings.catalog_max_bundle_bytes)
        )
    except BundleGuardError as exc:
        raise ApiException(
            exc.code,
            exc.message,
            status_code=exc.status_code,
            details=_con_leccion(exc.details, bundle),
        ) from exc
    try:
        validar_bundle(bundle, max_code_bytes=int(settings.max_code_bytes))
    except ApiException as exc:
        raise ApiException(
            exc.code,
            exc.message,
            status_code=exc.status_code,
            details=_con_leccion(exc.details, bundle),
        ) from exc


# ══════════════════════════ 2 · los avisos de §11.8.2 ════════════════════════


def calcular_avisos(
    nuevo: ModuleBundle, publicado: ModuleBundle | None
) -> list[ContentWarning]:
    """Qué cambia respecto de lo YA publicado, en el vocabulario de §11.8.2.

    Sin ``publicado`` (primera versión) no hay avisos: no hay nadie aguas abajo
    a quien afectar todavía.
    """
    if publicado is None:
        return []

    antiguas = {l.id: l for l in publicado.lessons}
    nuevas = {l.id: l for l in nuevo.lessons}
    avisos: list[ContentWarning] = []

    for lid in antiguas.keys() - nuevas.keys():
        avisos.append(
            ContentWarning(
                code=AVISO_LECCION_RETIRADA,
                lesson_id=lid,
                message=(
                    f"La v{publicado.module.version} publicada incluía esta lección; "
                    "quien actualice perderá su avance en ella."
                ),
            )
        )
    for lid in nuevas.keys() - antiguas.keys():
        avisos.append(
            ContentWarning(
                code=AVISO_LECCION_NUEVA,
                lesson_id=lid,
                message="Lección nueva: aparecerá al actualizar.",
            )
        )
    for lid in antiguas.keys() & nuevas.keys():
        vieja, nueva = antiguas[lid], nuevas[lid]
        n_vieja = len(vieja.quiz.questions) if vieja.quiz else 0
        n_nueva = len(nueva.quiz.questions) if nueva.quiz else 0
        u_vieja = vieja.quiz.pass_threshold if vieja.quiz else None
        u_nueva = nueva.quiz.pass_threshold if nueva.quiz else None
        if n_vieja != n_nueva or u_vieja != u_nueva:
            # Cambiar el número de preguntas o el umbral RECALIFICA las notas
            # aguas abajo (§11.6.3): una nota guardada deja de significar lo
            # mismo, así que el autor tiene que saberlo antes de congelar.
            avisos.append(
                ContentWarning(
                    code=AVISO_QUIZ_CAMBIADO,
                    lesson_id=lid,
                    message=(
                        f"El quiz cambia ({n_vieja}→{n_nueva} preguntas, "
                        f"umbral {u_vieja}→{u_nueva}): las notas se recalifican."
                    ),
                )
            )
    return avisos


# ═════════════════════════ 3 · el índice, con CAS ════════════════════════════


def _entrada_de(bundle: ModuleBundle, object_path: str, tamano: int) -> CatalogIndexEntry:
    """La fila del índice que resume un bundle sin obligar a descargarlo."""
    return CatalogIndexEntry(
        id=bundle.module.id,
        title=bundle.module.title,
        description=bundle.module.description,
        level=bundle.module.level,
        order_hint=bundle.module.order_hint,
        version=bundle.module.version,
        checksum=bundle.checksum,
        object_path=object_path,
        size_bytes=tamano,
        published_at=bundle.module.published_at,
        author_label=bundle.module.author_label,
        lessons_count=len(bundle.lessons),
        questions_count=sum(len(l.quiz.questions) for l in bundle.lessons if l.quiz),
        estimated_minutes_total=sum(l.estimated_minutes for l in bundle.lessons),
        requires_gpu=any(
            l.example.requires_gpu for l in bundle.lessons if l.example is not None
        ),
    )


def _entradas_del_indice(crudo: bytes) -> list[CatalogIndexEntry]:
    """Las entradas del índice del bucket; ``[]`` solo si de verdad está vacío.

    Un índice ilegible **no** se sobrescribe en silencio. Si trae basura,
    preferimos fallar y que alguien lo mire a borrar el catálogo entero de los
    demás módulos.
    """
    if not crudo.strip():
        return []
    try:
        return list(CatalogIndex.model_validate_json(crudo).modules)
    except Exception as exc:
        logger.error("índice del bucket ilegible: %s", type(exc).__name__)
        raise _api(
            "CONTENT_VALIDATION_ERROR",
            "El índice publicado no es válido; revísalo antes de publicar.",
        ) from exc


def _indice_con(
    crudo: bytes,
    entrada: CatalogIndexEntry | None,
    generado_en: str,
    *,
    sin: str | None = None,
) -> bytes:
    """Índice existente + la entrada nueva, sustituyendo la del mismo módulo.

    Con ``entrada=None`` y ``sin=<module_id>`` solo QUITA la de ese módulo: es
    retirarlo del catálogo (CU-41.1) por el mismo camino que publicarlo.
    """
    quitar = entrada.id if entrada is not None else sin
    entradas = [e for e in _entradas_del_indice(crudo) if e.id != quitar]
    if entrada is not None:
        entradas.append(entrada)
    entradas.sort(key=lambda e: (e.order_hint, e.id))
    indice = CatalogIndex(
        index_format=INDEX_FORMAT, generated_at=generado_en, modules=entradas
    )
    return indice.model_dump_json(indent=2).encode("utf-8")


# ═══════════════════════════ 4 · la publicación ══════════════════════════════


async def publish_module(
    content: "ContentRepository",
    settings: "Settings",
    publisher: CatalogWritePort,
    module_id: str,
    body: AdminPublishRequest,
    *,
    version_publicada: int | None = None,
    bundle_publicado: ModuleBundle | None = None,
    leer_publicado: Callable[[int], Awaitable[bytes | None]] | None = None,
    completar_vigente: bool = False,
) -> AdminPublishResult:
    """§11.8.2 — publica ``module_id`` en el bucket.

    ``version`` por defecto es ``version_publicada + 1``, y debe ser
    ESTRICTAMENTE mayor: la versión es monótona, y una versión repetida sería un
    objeto que ya existe (inmutable) o, peor, contenido distinto bajo un número
    que alguien ya instaló.

    **Orden de escritura: bundle primero, índice después.** Si el proceso muere
    en medio, el índice viejo sigue apuntando a bundles que EXISTEN y el catálogo
    del estudiante sigue coherente — solo se pierde el anuncio de la versión
    nueva, que se arregla republicando. Al revés dejaría el índice anunciando una
    versión que nadie puede descargar: eso sí es un catálogo roto.

    **Republicar es idempotente (CU-37.3/37.4).** Si el bundle de esa versión ya
    está en el bucket —una publicación anterior subió el bundle y falló después,
    en el índice o en el estado local— y su `content_hash` es el del contenido
    local, no hay conflicto: es la MISMA publicación, y se completa lo que faltó
    usando el objeto que ya está subido (``leer_publicado`` lo trae). Con
    contenido distinto sigue siendo ``409 VERSION_CONFLICT``: la versión es
    inmutable.

    ``completar_vigente`` cubre el otro caso a medias: el índice YA anuncia
    ``version_publicada`` pero el estado local no lo registró (CU-37.4). Si ese
    bundle tiene el contenido local, «publicar» no sube nada: reescribe la misma
    entrada del índice y devuelve la versión vigente para que el router la
    registre. Si el contenido difiere, se publica la siguiente como siempre.
    """
    if not settings.catalog_enabled:
        raise _api("CATALOG_DISABLED", "Este despliegue no tiene catálogo remoto.")

    anterior = version_publicada or 0
    version = body.version if body.version is not None else anterior + 1
    if version <= anterior:
        raise _api(
            "VERSION_CONFLICT",
            f"La versión {version} no es mayor que la publicada ({anterior}).",
            details={"published_version": anterior, "requested_version": version},
        )

    publicado_en = _ahora_iso()
    bundle, avisos_ids = construir_bundle(
        content, module_id, version=version, published_at=publicado_en, notes=body.notes
    )
    datos = bytes_publicables(bundle)
    # El mismo tope que aplica el estudiante al DESCARGAR (§11.6.1): publicar algo
    # que nadie va a poder instalar es un fallo que hay que dar aquí, no allí.
    tope = int(settings.catalog_max_bundle_bytes)
    if len(datos) > tope:
        raise _api(
            "BUNDLE_TOO_LARGE",
            f"El bundle ocupa {len(datos)} bytes y el tope es {tope}.",
            details={"bytes": len(datos), "max_bytes": tope},
        )

    await validar_como_importador(bundle, datos, settings)

    avisos = avisos_ids + calcular_avisos(bundle, bundle_publicado)

    ya_subido: tuple[ModuleBundle, bytes] | None = None
    if completar_vigente and body.version is None and version_publicada is not None:
        ya_subido = await _misma_publicacion(
            bundle, version_publicada, leer_publicado, settings
        )
    if ya_subido is not None:
        # Nada nuevo que subir: la vigente ES este contenido.
        version = version_publicada
        bundle, datos = ya_subido
        avisos = []

    object_path = object_path_for(settings.catalog_prefix, module_id, version)
    lesson_ids = [l.id for l in bundle.lessons]

    if body.dry_run:
        # No se toca el bucket. Es la vía para ver LESSON_ID_REMOVED antes de que
        # la versión sea inmutable y ya no haya vuelta atrás.
        return AdminPublishResult(
            published=False,
            module_id=module_id,
            version=version,
            checksum=bundle.checksum,
            object_path=object_path,
            generation=None,
            bytes=len(datos),
            published_at=bundle.module.published_at,
            index_updated=False,
            lesson_ids=lesson_ids,
            warnings=avisos,
        )

    generation: int | None = None
    if ya_subido is None:
        try:
            subido = await publisher.upload_bundle(object_path, datos)
            generation = subido.generation
        except BundleAlreadyPublished as exc:
            ya_subido = await _misma_publicacion(
                bundle, version, leer_publicado, settings
            )
            if ya_subido is None:
                raise _api(
                    "VERSION_CONFLICT",
                    f"La versión {version} de '{module_id}' ya está publicada.",
                    details={"stage": "bundle", "requested_version": version},
                ) from exc
            logger.info(
                "v%s de %s ya estaba subida con el mismo contenido: se completa",
                version, module_id,
            )
            bundle, datos = ya_subido
        except PublisherUnavailable as exc:
            raise _traducir_transporte(exc) from exc

    indice_ok = await _actualizar_indice(publisher, bundle, object_path, len(datos))

    return AdminPublishResult(
        published=True,
        module_id=module_id,
        version=version,
        checksum=bundle.checksum,
        object_path=object_path,
        generation=generation,
        bytes=len(datos),
        published_at=bundle.module.published_at,
        index_updated=indice_ok,
        lesson_ids=lesson_ids,
        warnings=avisos,
    )


async def _misma_publicacion(
    local: ModuleBundle,
    version: int,
    leer_publicado: Callable[[int], Awaitable[bytes | None]] | None,
    settings: "Settings",
) -> tuple[ModuleBundle, bytes] | None:
    """El bundle YA subido de ``version``, si su contenido es el local.

    Devuelve el objeto del bucket (modelo + bytes), no el recién construido:
    el índice y el estado local tienen que anunciar el checksum y la fecha de
    lo que de verdad está publicado. ``None`` si no se puede leer o si el
    contenido difiere; en los dos casos no se puede afirmar que sea la misma
    publicación, y lo seguro es el conflicto.

    Lo que viene del bucket es entrada NO confiable aunque lo haya subido este
    mismo admin, y `content_hash` ignora a propósito ``checksum``, ``version``
    y ``published_at``: sin comprobarlos aparte, un objeto manipulado con el
    mismo contenido y otra versión u otro checksum acabaría anunciado en el
    índice público. Por eso: la puerta endurecida (``parse_bundle``), la
    versión declarada igual a la de la ruta y el checksum recalculado.
    """
    if leer_publicado is None:
        return None
    crudo = await leer_publicado(version)
    if crudo is None:
        return None
    try:
        remoto = await asyncio.to_thread(
            parse_bundle, crudo, max_bytes=int(settings.catalog_max_bundle_bytes)
        )
        verificar_checksum(crudo, remoto)
    except (BundleGuardError, ApiException) as exc:
        logger.warning(
            "la v%s ya subida no es un bundle válido (%s)", version, type(exc).__name__
        )
        return None
    if remoto.module.version != version or remoto.module.id != local.module.id:
        logger.warning("la v%s ya subida declara otra identidad", version)
        return None
    if content_hash(remoto) != content_hash(local):
        return None
    return remoto, crudo


async def _actualizar_indice(
    publisher: CatalogWritePort,
    bundle: ModuleBundle,
    object_path: str,
    tamano: int,
) -> bool:
    """CAS del índice con UN reintento (§11.8.2 paso 4).

    Un reintento y no más: si dos publicaciones compiten, la segunda relee y
    gana; si sigue fallando, es que hay contención real y reintentar en bucle
    solo la alargaría. El bundle **ya está publicado** a estas alturas, así que
    el fallo no se traga: se responde 409 diciendo que la etapa fue el índice,
    para que el admin sepa que republicar el índice basta.
    """
    entrada = _entrada_de(bundle, object_path, tamano)
    for intento in (1, 2):
        crudo, generation = await publisher.read_index()
        datos = _indice_con(crudo, entrada, bundle.module.published_at)
        try:
            await publisher.write_index(datos, if_generation_match=generation)
            return True
        except IndexCasFailed:
            logger.warning("CAS del índice falló (intento %d)", intento)
        except PublisherUnavailable as exc:
            raise _traducir_transporte(exc) from exc
    raise _api(
        "VERSION_CONFLICT",
        "El índice cambió mientras se publicaba; el módulo YA está subido, "
        "vuelve a publicar para actualizar el índice.",
        details={"stage": "index", "index_updated": False},
    )


def _traducir_transporte(exc: PublisherUnavailable) -> ApiException:
    """Fallo de transporte → error de §11.3, sin el texto crudo de Google."""
    if exc.forbidden:
        return _api(
            "CATALOG_CREDENTIALS_INVALID",
            "La cuenta de servicio no tiene permiso para escribir en el bucket.",
            details={"reason": "forbidden"},
        )
    return _api(
        "CATALOG_UNAVAILABLE",
        "El bucket no está disponible ahora mismo.",
        details={"reason": exc.reason, "retry_after_s": None},
    )
