"""Parseo ENDURECIDO del bundle del bucket (Fase 5, api-contract §11.10).

Este módulo es la **frontera** entre el bucket y la base de datos. Todo lo que
entra por aquí es entrada no confiable —el mismo rigor que el ``.py`` del
estudiante—, con un agravante: el ``.py`` del estudiante se ejecuta en un
contenedor aislado, mientras que un bundle se **persiste** y se le muestra a
todos los demás. Por eso el criterio es rechazar lo dudoso, no sanearlo.

``parse_bundle(raw, max_bytes=…)`` es la única puerta. Falla siempre con un
error TIPADO (:class:`BundleGuardError`) que el router traduce a 413/422:
**ningún camino de esta función puede acabar en un 500**, y de ahí que se
capture hasta ``RecursionError``.

Etapas, en orden (cada una asume que la anterior pasó):

1. **Tamaño** sobre los bytes RECIBIDOS → ``413 BUNDLE_TOO_LARGE``. El tope
   también se comprueba antes de descargar, con el ``size`` del índice (§11.1),
   pero el índice es una conveniencia y puede mentir.
2. **Decodificación** UTF-8 estricta y rechazo de BOM.
3. **Parseo JSON** con ``object_pairs_hook`` que rechaza **claves duplicadas**.
   Sin él, ``{"correct_key":"a","correct_key":"b"}`` se queda con la última en
   silencio: el validador vería una cosa y el escritor otra. Es el agujero
   clásico de todo formato de intercambio basado en JSON.
4. **Barrido de texto** del payload crudo: caracteres de control, marcas BIDI
   (Trojan Source) y formas peligrosas de id. Va ANTES del esquema para que el
   DTO no llegue a ver un NUL y para que el error señale la ruta exacta.
5. **Esquema** ``ModuleBundle.model_validate`` (``extra="forbid"``, patrones,
   rangos) → ``422 BUNDLE_INVALID``.
6. **Espacio de ids** ya tipado: nombres reservados y colisiones que solo
   difieren en mayúsculas → ``422 BUNDLE_INVALID``.
7. **Reglas de negocio de §10.6** aplicadas al bundle → ``422
   CONTENT_VALIDATION_ERROR``. Aquí se DELEGA: el subset de markdown lo decide
   ``services/markdown_validator`` y la URL de video ``services/youtube``, los
   mismos módulos que usa el camino admin. Dos validadores del mismo subset
   serían dos subsets.

El corte entre ``BUNDLE_INVALID`` y ``CONTENT_VALIDATION_ERROR`` (ambos 422,
§11.3) es: **forma** contra **contenido**. «Esto no es un bundle bien formado»
frente a «esto es un bundle bien formado que enseña algo incompletable».

Lo que este módulo NO hace, a propósito:

* **No verifica el checksum** ni la coincidencia de versión/ruta: eso necesita
  el índice y la serialización canónica de §11.8.2 (``catalog_hash``).
* **No normaliza** nada. Devuelve el modelo tal cual venía. Normalizar cambia
  bytes y el checksum se calcula sobre los originales; el instalador normaliza
  después de verificarlo.
* **No toca la DB**: las reglas referenciales de §10.6 (``recommended[]``
  existe, ids libres, coherencia threads/GPU con el resto del catálogo, orden
  global del módulo) las aplica el instalador dentro del ``write_lock``, que es
  donde puede leer. Aquí no hay red, ni DB, ni FastAPI: es una función pura.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterator
from typing import Any, ClassVar

from pydantic import ValidationError

from app.errors import sanitize_validation_errors
from app.schemas.catalog import BundleLesson, BundleQuiz, ModuleBundle
from app.services import youtube
from app.services.markdown_validator import validate as validate_markdown

# ─────────────────────────────── constantes ─────────────────────────────────

#: BOMs rechazados de entrada. §11.8.2 exige UTF-8 **sin** BOM: la marca cambia
#: los bytes sin cambiar el texto, así que dos publicaciones idénticas darían
#: checksums distintos. Se listan también los de UTF-16/32 porque un archivo así
#: decodifica como UTF-8 «válido» a base de basura, en vez de fallar limpio.
_BOMS: tuple[bytes, ...] = (b"\xef\xbb\xbf", b"\xff\xfe", b"\xfe\xff")

#: Controles C0 salvo ``\t`` (09) y ``\n`` (0A), más DEL (7F). Un NUL en un
#: ``title`` corta strings en C y ensucia SQLite; un ESC pinta secuencias ANSI
#: en cualquier consola que vuelque el contenido. El CR (0D) queda FUERA de los
#: permitidos a propósito: la serialización canónica de §11.8.2 emite LF, así
#: que un CR significa que el texto no salió del publicador canónico.
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")

#: Anulación bidireccional: embeddings/overrides (U+202A..U+202E) e isolates
#: (U+2066..U+2069). Esto es **Trojan Source**: reordenan la presentación del
#: texto sin cambiar los bytes, de modo que lo que el humano LEE no es lo que la
#: máquina EJECUTA. En Telar el estudiante lee ``source_code`` en el editor y
#: acto seguido lo manda a correr al contenedor: un override en ese campo
#: convierte la lección en un engaño con ejecución real detrás. No hay ningún
#: uso legítimo de estos caracteres en el contenido (el texto RTL de verdad se
#: escribe con sus propias letras, no con overrides), así que se prohíben en
#: TODO string del bundle y no solo en el código.
_BIDI_RE = re.compile(r"[\u202a-\u202e\u2066-\u2069]")

#: Ancho cero: dos ids visualmente idénticos con claves primarias distintas.
#: Solo se prohíben en ids, donde la identidad visual importa; en un ``title``
#: pueden formar parte de una secuencia de emoji legítima.
_ANCHO_CERO_RE = re.compile(r"[\u200b-\u200d\ufeff]")

#: Claves del JSON cuyo valor es un identificador (y por tanto se endurece).
_CLAVES_ID = frozenset({"id", "lesson_id", "module_id"})

#: Subcadenas que jamás pueden aparecer en un id. ``ID_PATTERN`` ya las excluye,
#: pero esta comprobación corre ANTES del esquema y sobrevive a que el patrón se
#: relaje: la ruta del objeto se DERIVA del id (``modulos/<id>/v<n>.json``), así
#: que un id con ``..`` o ``/`` es un intento de leer otro objeto.
_SOSPECHOSO_EN_ID: tuple[str, ...] = ("..", "/", "\\", "%", ":")

#: Nombres que no pueden ser id de módulo, lección ni ejemplo. Los de Windows
#: (``CON``, ``PRN``…) porque Telar se distribuye como app Electron y tanto el
#: publicador como ``app/content/`` materializan un directorio por id: crear una
#: carpeta ``CON`` es un fallo real, no teórico. Los del bucket (``catalog``,
#: ``index``, ``modulos``) porque colisionarían con el layout de §11.10.
_RESERVADOS: frozenset[str] = frozenset(
    {"con", "prn", "aux", "nul", "catalog", "index", "modulos"}
    | {f"com{n}" for n in range(1, 10)}
    | {f"lpt{n}" for n in range(1, 10)}
)

#: Un ``filename`` necesita al menos un alfanumérico en el tallo (lo anterior al
#: ``.py`` final). ``FILENAME_PATTERN`` acepta degenerados como ``..py`` o
#: ``----.py``: en el camino admin da igual porque lo escribe un humano
#: autenticado, en un bundle remoto no.
_ALFANUMERICO_RE = re.compile(r"[A-Za-z0-9]")

#: Caracteres admitidos en el ``field`` que se devuelve al cliente. La ruta se
#: construye con claves del JSON, que son texto del atacante: se sanea antes de
#: hacerle eco (no se devuelve nunca el VALOR rechazado, BL-22).
_RUTA_INSEGURA_RE = re.compile(r"[^A-Za-z0-9_.\[\]-]")

#: Tope de ``details``. Un bundle hostil con 100 lecciones rotas produciría una
#: respuesta enorme; el cliente no necesita más que las primeras para saber que
#: el bundle no sirve.
_MAX_DETALLES = 50
#: Tope del ``field`` y del ``reason`` devueltos.
_MAX_RUTA = 120
_MAX_RAZON = 200


# ──────────────────────────── errores tipados ───────────────────────────────


class BundleGuardError(Exception):
    """Rechazo del guard. ``code``/``status_code`` los traduce el router (§11.3).

    Existe para que ninguna ruta de §11 tenga que distinguir excepciones de
    ``json``, ``pydantic`` o ``UnicodeDecodeError``: un bundle malo siempre sale
    por aquí, con ``details = [{"field", "reason"}]`` listo para el envelope.
    """

    code: ClassVar[str] = "BUNDLE_INVALID"
    status_code: ClassVar[int] = 422

    def __init__(self, message: str, *, details: list[dict] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details: list[dict] = details or []


class BundleTooLarge(BundleGuardError):
    """§11.3 — el bundle supera ``TELAR_CATALOG_MAX_BUNDLE_BYTES`` (413)."""

    code = "BUNDLE_TOO_LARGE"
    status_code = 413


class BundleInvalid(BundleGuardError):
    """§11.3 — el bundle no está bien FORMADO: bytes, JSON, esquema o ids (422)."""

    code = "BUNDLE_INVALID"
    status_code = 422


class BundleContentInvalid(BundleGuardError):
    """§11.3/§10.6 — bien formado, pero rompe una regla de contenido (422)."""

    code = "CONTENT_VALIDATION_ERROR"
    status_code = 422


class _ClaveDuplicada(Exception):
    """Interna: el ``object_pairs_hook`` encontró la misma clave dos veces."""

    def __init__(self, clave: str) -> None:
        super().__init__(clave)
        self.clave = clave


# ─────────────────────────────── utilidades ─────────────────────────────────


def _ruta_segura(ruta: str) -> str:
    """Deja la ruta de un campo en algo que se puede devolver sin miedo."""
    return _RUTA_INSEGURA_RE.sub("?", ruta)[:_MAX_RUTA]


def _issue(campo: str, razon: str) -> dict:
    return {"field": _ruta_segura(campo), "reason": razon[:_MAX_RAZON]}


def _sin_repetidos(issues: list[dict]) -> list[dict]:
    """Quita issues idénticos (una misma causa puede disparar dos reglas)."""
    vistos: set[tuple] = set()
    unicos: list[dict] = []
    for issue in issues:
        clave = (issue.get("field"), issue.get("reason"))
        if clave not in vistos:
            vistos.add(clave)
            unicos.append(issue)
    return unicos


def _alzar_si_hay(
    clase: type[BundleGuardError], mensaje: str, issues: list[dict]
) -> None:
    if issues:
        raise clase(mensaje, details=_sin_repetidos(issues)[:_MAX_DETALLES])


# ─────────────────────── etapas 1-3: bytes, texto, JSON ─────────────────────


def decodificar_estricto(raw: bytes) -> str:
    """Bytes → texto UTF-8, sin BOM y sin ``errors="replace"``.

    Público porque el índice del bucket (``modulos/index.json``, §11.10) entra
    por la misma puerta y merece exactamente el mismo trato.
    """
    for bom in _BOMS:
        if raw.startswith(bom):
            raise BundleInvalid(
                "El contenido del bucket no puede empezar con BOM.",
                details=[
                    _issue("", "BOM inicial; se espera UTF-8 sin BOM (§11.8.2)")
                ],
            )
    try:
        return raw.decode("utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        raise BundleInvalid(
            "El contenido del bucket no es UTF-8 válido.",
            details=[_issue("", f"byte inválido en la posición {exc.start}")],
        ) from exc


def _sin_claves_duplicadas(pares: list[tuple[str, Any]]) -> dict:
    resultado: dict = {}
    for clave, valor in pares:
        if clave in resultado:
            raise _ClaveDuplicada(clave)
        resultado[clave] = valor
    return resultado


def cargar_json_sin_duplicados(texto: str) -> Any:
    """``json.loads`` que rechaza claves duplicadas y no explota por anidamiento.

    Público por el mismo motivo que :func:`decodificar_estricto`.
    """
    try:
        return json.loads(texto, object_pairs_hook=_sin_claves_duplicadas)
    except _ClaveDuplicada as exc:
        raise BundleInvalid(
            "El JSON trae una clave duplicada.",
            details=[
                _issue(
                    exc.clave,
                    "clave repetida en el mismo objeto: el parseo se quedaría "
                    "con la última en silencio",
                )
            ],
        ) from exc
    except RecursionError as exc:
        raise BundleInvalid(
            "El JSON está anidado demasiado profundamente.",
            details=[_issue("", "anidamiento por encima del límite del parser")],
        ) from exc
    except ValueError as exc:  # json.JSONDecodeError hereda de ValueError
        razon = getattr(exc, "msg", "JSON mal formado")
        linea = getattr(exc, "lineno", None)
        if linea is not None:
            razon = f"{razon} (línea {linea}, columna {getattr(exc, 'colno', 0)})"
        raise BundleInvalid(
            "El bundle no es JSON válido.", details=[_issue("", razon)]
        ) from exc


# ───────────────────── etapa 4: barrido del texto crudo ─────────────────────


def _recorrer_textos(nodo: Any, ruta: str = "") -> Iterator[tuple[str, str, str]]:
    """Genera ``(ruta, clave, texto)`` por cada string del payload."""
    if isinstance(nodo, dict):
        for clave, valor in nodo.items():
            hija = f"{ruta}.{clave}" if ruta else str(clave)
            if isinstance(valor, str):
                yield hija, str(clave), valor
            else:
                yield from _recorrer_textos(valor, hija)
    elif isinstance(nodo, list):
        for indice, valor in enumerate(nodo):
            hija = f"{ruta}[{indice}]"
            if isinstance(valor, str):
                yield hija, "", valor
            else:
                yield from _recorrer_textos(valor, hija)


def _issues_de_filename(campo: str, valor: str) -> list[dict]:
    """Tallo degenerado (``..py``, ``----.py``). El patrón lo comprueba el DTO."""
    if not valor.endswith(".py"):
        return []
    if _ALFANUMERICO_RE.search(valor[:-3]):
        return []
    return [
        _issue(
            campo,
            "el nombre del archivo debe llevar al menos un alfanumérico antes "
            "del '.py'",
        )
    ]


def _issues_de_texto(payload: Any) -> list[dict]:
    """Caracteres prohibidos y formas peligrosas de id, sobre el payload crudo."""
    issues: list[dict] = []
    for ruta, clave, texto in _recorrer_textos(payload):
        control = _CONTROL_RE.search(texto)
        if control:
            issues.append(
                _issue(
                    ruta,
                    f"carácter de control no permitido (U+{ord(control.group()):04X});"
                    " solo se admiten salto de línea y tabulador",
                )
            )
        bidi = _BIDI_RE.search(texto)
        if bidi:
            issues.append(
                _issue(
                    ruta,
                    f"marca de anulación bidireccional (U+{ord(bidi.group()):04X}): "
                    "el texto se leería en un orden distinto al que se ejecuta",
                )
            )
        if clave in _CLAVES_ID:
            ancho_cero = _ANCHO_CERO_RE.search(texto)
            if ancho_cero:
                issues.append(
                    _issue(
                        ruta,
                        "carácter de ancho cero "
                        f"(U+{ord(ancho_cero.group()):04X}) en un id",
                    )
                )
            for token in _SOSPECHOSO_EN_ID:
                if token in texto:
                    issues.append(
                        _issue(ruta, f"un id no puede contener {token!r}")
                    )
        elif clave == "filename":
            issues += _issues_de_filename(ruta, texto)
    return issues


# ────────────────────────── etapa 5: esquema §11.10 ─────────────────────────


def _detalles_de_pydantic(exc: ValidationError) -> list[dict]:
    """``ValidationError`` → ``details`` sin eco del valor rechazado (BL-22).

    ``sanitize_validation_errors`` quita ``input``/``ctx``/``url``; queda ``loc``,
    que con ``extra="forbid"`` contiene el NOMBRE de la clave desconocida —texto
    del atacante—, así que además se sanea la ruta.
    """
    detalles: list[dict] = []
    for err in sanitize_validation_errors(exc.errors()):
        ruta = ".".join(str(parte) for parte in err.get("loc", ()))
        detalles.append(_issue(ruta, str(err.get("msg", "valor inválido"))))
    return detalles[:_MAX_DETALLES]


def _validar_esquema(payload: dict) -> ModuleBundle:
    try:
        return ModuleBundle.model_validate(payload)
    except ValidationError as exc:
        raise BundleInvalid(
            "El bundle no cumple el esquema de §11.10.",
            details=_detalles_de_pydantic(exc),
        ) from exc


# ───────────────────────── etapa 6: espacio de ids ──────────────────────────


def _registrar_id(
    vistos: dict[str, tuple[str, str]],
    issues: list[dict],
    campo: str,
    valor: str,
) -> None:
    """Unicidad insensible a mayúsculas dentro de un espacio de nombres.

    SQLite trataría ``Hola`` y ``hola`` como PK distintas (colación ``BINARY``),
    pero colisionan en cuanto un id se materializa como carpeta en macOS o
    Windows, y son indistinguibles para el ojo del autor.
    """
    clave = valor.lower()
    previo = vistos.get(clave)
    if previo is None:
        vistos[clave] = (campo, valor)
        return
    campo_previo, valor_previo = previo
    if valor_previo == valor:
        razon = (
            f"id duplicado dentro del bundle: {valor!r} "
            f"(ya usado en {campo_previo})"
        )
    else:
        razon = (
            f"dos ids que solo difieren en mayúsculas: {valor!r} y "
            f"{valor_previo!r} ({campo_previo})"
        )
    issues.append(_issue(campo, razon))


def _issues_de_id_reservado(campo: str, valor: str) -> list[dict]:
    if valor.lower() not in _RESERVADOS:
        return []
    return [_issue(campo, f"id reservado y no utilizable como carpeta: {valor!r}")]


def _issues_espacio_de_ids(bundle: ModuleBundle) -> list[dict]:
    """Nombres reservados y colisiones por mayúsculas, ya sobre el modelo."""
    issues: list[dict] = []
    issues += _issues_de_id_reservado("module.id", bundle.module.id)

    # §10.6: lecciones y ejemplos comparten espacio de nombres.
    contenido: dict[str, tuple[str, str]] = {}
    preguntas: dict[str, tuple[str, str]] = {}
    for indice, leccion in enumerate(bundle.lessons):
        base = f"lessons[{indice}]"
        issues += _issues_de_id_reservado(f"{base}.id", leccion.id)
        _registrar_id(contenido, issues, f"{base}.id", leccion.id)
        if leccion.example is not None:
            campo = f"{base}.example.id"
            issues += _issues_de_id_reservado(campo, leccion.example.id)
            _registrar_id(contenido, issues, campo, leccion.example.id)
        if leccion.quiz is not None:
            for numero, pregunta in enumerate(leccion.quiz.questions):
                if pregunta.id is None:
                    continue  # se autogenera al escribir (BL-18)
                _registrar_id(
                    preguntas,
                    issues,
                    f"{base}.quiz.questions[{numero}].id",
                    pregunta.id,
                )
    return issues


# ──────────────────── etapa 7: reglas de negocio (§10.6) ────────────────────


def _issues_de_completion_rule(base: str, leccion: BundleLesson) -> list[dict]:
    """E4 — la regla de completitud tiene que ser alcanzable (§10.6, §11.10).

    A diferencia del camino admin —donde una lección nace sin quiz y el quiz se
    añade después, así que exigirlo en cada edición sería pelearse con el
    validador—, aquí el contenido ya está PUBLICADO y va derecho a un estudiante.
    Una lección con ``completion_rule="quiz"`` y sin quiz sería incompletable y
    bloquearía el progreso de su módulo entero.
    """
    if leccion.completion_rule == "quiz" and leccion.quiz is None:
        return [
            _issue(
                f"{base}.completion_rule",
                "'quiz' exige que la lección traiga quiz; sin él la lección "
                "sería incompletable",
            )
        ]
    if leccion.completion_rule == "run" and leccion.example is None:
        return [
            _issue(
                f"{base}.completion_rule",
                "'run' exige que la lección traiga ejemplo; sin código no hay "
                "nada que ejecutar",
            )
        ]
    return []


def _issues_de_quiz(base: str, quiz: BundleQuiz) -> list[dict]:
    """``correct_key`` ∈ opciones, keys de opción y ``order`` únicos (§10.6)."""
    issues: list[dict] = []
    ordenes: set[int] = set()
    for indice, pregunta in enumerate(quiz.questions):
        campo = f"{base}.questions[{indice}]"
        keys = [opcion.key for opcion in pregunta.options]
        if len(keys) != len(set(keys)):
            issues.append(_issue(f"{campo}.options", "keys de opción duplicadas"))
        if pregunta.correct_key not in keys:
            issues.append(
                _issue(
                    f"{campo}.correct_key",
                    f"la respuesta correcta {pregunta.correct_key!r} no está "
                    "entre las opciones",
                )
            )
        if pregunta.order in ordenes:
            issues.append(
                _issue(f"{campo}.order", f"order duplicado: {pregunta.order}")
            )
        ordenes.add(pregunta.order)
    return issues


def _issues_de_orden(bundle: ModuleBundle) -> list[dict]:
    """``lessons[].order`` contiguo ``1..n`` dentro del bundle (E2, §11.10).

    Más estricto que el ``UNIQUE(module_id, "order")`` del DDL: un hueco no
    rompe el índice, pero sí la navegación prev/next, que se deriva de
    ``(modules."order", lessons."order")``.
    """
    ordenes = [leccion.order for leccion in bundle.lessons]
    if sorted(ordenes) == list(range(1, len(ordenes) + 1)):
        return []
    return [
        _issue(
            "lessons[].order",
            f"el orden de las lecciones debe ser 1..{len(ordenes)} contiguo y "
            "sin repeticiones",
        )
    ]


def _issues_de_contenido(bundle: ModuleBundle) -> list[dict]:
    """Reglas de §10.6 aplicadas al bundle, delegando en los módulos que ya existen."""
    issues: list[dict] = _issues_de_orden(bundle)
    for indice, leccion in enumerate(bundle.lessons):
        base = f"lessons[{indice}]"
        # Subset de markdown: lo decide markdown_validator, el MISMO que usa el
        # camino admin. Se conserva su 'line' y solo se reubica el 'field'.
        for problema in validate_markdown(leccion.content_markdown):
            issues.append(
                {**problema, "field": _ruta_segura(f"{base}.content_markdown")}
            )
        # URL de video: la decide services/youtube (valida y normaliza).
        issues += youtube.issues(leccion.video_url, field=f"{base}.video_url")
        issues += _issues_de_completion_rule(base, leccion)
        if leccion.quiz is not None:
            issues += _issues_de_quiz(f"{base}.quiz", leccion.quiz)
    return issues


# ────────────────────────────── puerta única ────────────────────────────────


def parse_bundle(raw: bytes, *, max_bytes: int) -> ModuleBundle:
    """Bytes descargados del bucket → :class:`ModuleBundle` validado.

    Lanza :class:`BundleTooLarge` (413), :class:`BundleInvalid` (422) o
    :class:`BundleContentInvalid` (422). Nunca deja escapar otra excepción.
    """
    if max_bytes < 1:
        # Error de programación, no entrada hostil: el tope viene de la config.
        raise ValueError("max_bytes debe ser ≥ 1")
    if len(raw) > max_bytes:
        raise BundleTooLarge(
            f"El bundle supera el máximo de {max_bytes} bytes.",
            details=[_issue("", f"recibidos {len(raw)} bytes")],
        )

    texto = decodificar_estricto(raw)
    try:
        payload = cargar_json_sin_duplicados(texto)
        if not isinstance(payload, dict):
            raise BundleInvalid(
                "La raíz del bundle debe ser un objeto JSON.",
                details=[
                    _issue("", f"la raíz es de tipo {type(payload).__name__}")
                ],
            )
        _alzar_si_hay(
            BundleInvalid,
            "El bundle contiene caracteres o identificadores prohibidos.",
            _issues_de_texto(payload),
        )
        bundle = _validar_esquema(payload)
    except RecursionError as exc:
        # Un JSON hondo puede agotar la pila en el barrido o en pydantic, no
        # solo en el parser. Aquí se convierte en 422; jamás en un 500.
        raise BundleInvalid(
            "El bundle está anidado demasiado profundamente.",
            details=[_issue("", "anidamiento por encima del límite del parser")],
        ) from exc

    _alzar_si_hay(
        BundleInvalid,
        "El bundle usa identificadores no utilizables.",
        _issues_espacio_de_ids(bundle),
    )
    _alzar_si_hay(
        BundleContentInvalid,
        "El contenido del bundle no cumple las reglas de validación.",
        _issues_de_contenido(bundle),
    )
    return bundle


__all__ = [
    "BundleGuardError",
    "BundleTooLarge",
    "BundleInvalid",
    "BundleContentInvalid",
    "parse_bundle",
    "decodificar_estricto",
    "cargar_json_sin_duplicados",
]
