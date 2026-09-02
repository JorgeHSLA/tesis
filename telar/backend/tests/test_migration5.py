"""Migración 5 (Fase 5 — módulos publicables): backfill e invariantes nuevos.

Es la migración más delicada del proyecto: reconstruye `lessons` y `examples`,
que son las tablas de las que cuelga todo el contenido. Un error aquí no rompe un
test, rompe la suite entera —`apply_schema` corre sobre la DB en memoria de todos
los fixtures—, así que estas pruebas verifican el bloque de forma AISLADA, sobre
una DB construida a mano, antes de que nadie dependa de él.

Lo que se defiende:

- **Backfill de E1**: `examples.lesson_id = id` reproduce exactamente la relación
  que antes daba `examples.id PK REFERENCES lessons(id)`. Es la propiedad que
  permite que la migración entre sin tocar una línea de código de lectura.
- **`enabled` heredado**: hasta ahora se derivaba de `examples.enabled`; pasa a
  columna propia de la lección con el mismo valor, o el conteo de lecciones
  habilitadas cambiaría de golpe.
- **E2 con índice PARCIAL**: dos módulos pueden tener una lección con el mismo
  `order`; archivar libera el hueco; y la colisión entre lecciones VIVAS se
  sigue rechazando. Si el índice fuera total, archivar sería imposible.
- **El progreso sobrevive**: es la promesa de CU-39 y la razón de que
  `lesson_progress`/`quiz_attempts` no tengan FK a `lessons` (data-model §8.3).
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

SCHEMA = Path(__file__).resolve().parents[1] / "app" / "schema.sql"

#: Baseline mínimo que imita la forma real del contenido de Fase 4: un módulo,
#: dos lecciones con su ejemplo pareado (una deshabilitada, como la GPU), y una
#: lección con progreso y un intento de quiz.
SEMILLA_FASE4 = """
INSERT INTO modules (id,"order",title,description,level)
  VALUES ('m1',1,'Fundamentos','Región paralela e identidad de hilo','Básico');
INSERT INTO lessons (id,module_id,"order",title,estimated_minutes,content_markdown,pass_threshold)
  VALUES ('primerEjemplo','m1',1,'Hola mundo paralelo',15,'# Hola',0.8),
         ('sumaVectoresGPU','m1',2,'Suma en GPU',20,'# GPU',0.8);
INSERT INTO examples (id,filename,title,difficulty,teaches,threads_configurable,
  sweeps_threads,self_measures,parser_id,default_timeout_s,est_run_seconds,enabled,
  requires_gpu,expected_output_note,source_code)
  VALUES ('primerEjemplo','helloOpenMP.py','Hola mundo paralelo',1,'identidad de hilo',
          1,0,0,'none',30,5,1,0,'8 líneas','print(1)'),
         ('sumaVectoresGPU','sumaGPU.py','Suma en GPU',4,'map/target',
          1,0,0,'none',90,10,0,1,'ok','print(2)');
INSERT INTO quiz_questions (id,lesson_id,"order",text,options_json,correct_key,explanation)
  VALUES ('primerEjemplo-q1','primerEjemplo',1,'¿Qué hace @njit?',
          '[{"key":"a","text":"x"},{"key":"b","text":"y"}]','b','Compila a nativo.');
INSERT INTO lesson_progress (lesson_id,viewed,completed,best_quiz_score)
  VALUES ('primerEjemplo',1,1,4);
INSERT INTO quiz_attempts (id,lesson_id,answers,score,total,passed)
  VALUES ('att1','primerEjemplo','{"primerEjemplo-q1":"b"}',4,4,1);
"""


def _partir_esquema(texto: str) -> tuple[str, list[tuple[int, str]]]:
    """Separa el bloque base de los `-- migration N`, como hace ``db._split_schema``."""
    import re

    marcas = list(re.finditer(r"^--\s*migration\s+(\d+)\s*$", texto, re.MULTILINE))
    base = texto[: marcas[0].start()] if marcas else texto
    bloques = [
        (int(m.group(1)), texto[m.start() : (marcas[i + 1].start() if i + 1 < len(marcas) else len(texto))])
        for i, m in enumerate(marcas)
    ]
    return base, bloques


@pytest.fixture
def db_migrada() -> sqlite3.Connection:
    """DB en Fase 4 (base + migraciones 2-4), sembrada, y luego migrada a la 5."""
    texto = SCHEMA.read_text(encoding="utf-8")
    base, bloques = _partir_esquema(texto)
    assert [n for n, _ in bloques] == [2, 3, 4, 5], "cambió el juego de migraciones"

    db = sqlite3.connect(":memory:")
    db.executescript(base)
    for numero, bloque in bloques:
        if numero == 5:
            continue  # se aplica DESPUÉS de sembrar, que es el caso real
        db.executescript(bloque)
    db.executescript(SEMILLA_FASE4)
    db.commit()

    bloque_5 = next(b for n, b in bloques if n == 5)
    db.executescript(bloque_5)
    db.commit()
    yield db
    db.close()


def _filas(db: sqlite3.Connection, sql: str, *args: object) -> list[tuple]:
    return db.execute(sql, args).fetchall()


# ────────────────────────────── E1 · backfill ────────────────────────────────


def test_backfill_lesson_id_reproduce_la_relacion_anterior(db_migrada):
    """`examples.lesson_id = id` es exactamente lo que valía `examples.id PK FK`."""
    assert _filas(db_migrada, 'SELECT id, lesson_id FROM examples ORDER BY id') == [
        ("primerEjemplo", "primerEjemplo"),
        ("sumaVectoresGPU", "sumaVectoresGPU"),
    ]


def test_lesson_id_admite_null_una_lección_puede_no_tener_ejemplo(db_migrada):
    """E1: el ejemplo deja de estar atado. Es lo que desbloquea el track teórico."""
    db_migrada.execute(
        """INSERT INTO examples (id,lesson_id,filename,title,difficulty,teaches,
             threads_configurable,sweeps_threads,self_measures,parser_id,
             default_timeout_s,est_run_seconds,enabled,requires_gpu,
             expected_output_note,source_code)
           VALUES ('huerfano',NULL,'x.py','Suelto',1,'t',1,0,0,'none',30,5,1,0,'n','c')"""
    )
    assert _filas(db_migrada, "SELECT lesson_id FROM examples WHERE id='huerfano'") == [(None,)]


def test_un_ejemplo_no_puede_pertenecer_a_dos_lecciones(db_migrada):
    """`lesson_id UNIQUE`: la relación es 0..1, no 0..N."""
    db_migrada.execute(
        """INSERT INTO lessons (id,module_id,"order",title,estimated_minutes,
             content_markdown,pass_threshold)
           VALUES ('teoria','m1',3,'Qué es un hilo',10,'# Hilos',0.8)"""
    )
    with pytest.raises(sqlite3.IntegrityError, match="lesson_id"):
        db_migrada.execute(
            """INSERT INTO examples (id,lesson_id,filename,title,difficulty,teaches,
                 threads_configurable,sweeps_threads,self_measures,parser_id,
                 default_timeout_s,est_run_seconds,enabled,requires_gpu,
                 expected_output_note,source_code)
               VALUES ('otro','primerEjemplo','y.py','Otro',1,'t',1,0,0,'none',
                       30,5,1,0,'n','c')"""
        )


def test_lecciones_teoricas_sin_ejemplo_son_representables(db_migrada):
    """El caso que la Fase 4 hacía imposible: lección con markdown y sin código."""
    db_migrada.execute(
        """INSERT INTO lessons (id,module_id,"order",title,estimated_minutes,
             content_markdown,pass_threshold,completion_rule,video_url)
           VALUES ('queEsUnHilo','m1',3,'¿Qué es un hilo?',5,'# Hilos',0.8,'viewed',
                   'https://www.youtube.com/watch?v=dQw4w9WgXcQ')"""
    )
    fila = _filas(
        db_migrada,
        """SELECT l.id, l.completion_rule, l.video_url, e.id
           FROM lessons l LEFT JOIN examples e ON e.lesson_id = l.id
           WHERE l.id='queEsUnHilo'""",
    )
    assert fila == [("queEsUnHilo", "viewed", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", None)]


# ───────────────────────── E4 · enabled y completion_rule ────────────────────


def test_enabled_se_hereda_del_ejemplo(db_migrada):
    """Antes se derivaba de `examples.enabled`; el valor no puede cambiar al migrar."""
    assert _filas(db_migrada, 'SELECT id, enabled FROM lessons ORDER BY id') == [
        ("primerEjemplo", 1),
        ("sumaVectoresGPU", 0),  # la GPU venía deshabilitada
    ]


def test_completion_rule_arranca_en_quiz(db_migrada):
    """El baseline se completa aprobando el quiz: la migración no cambia semántica."""
    assert {r[0] for r in _filas(db_migrada, "SELECT completion_rule FROM lessons")} == {"quiz"}


def test_completion_rule_rechaza_valores_fuera_del_catalogo(db_migrada):
    with pytest.raises(sqlite3.IntegrityError):
        db_migrada.execute(
            """INSERT INTO lessons (id,module_id,"order",title,estimated_minutes,
                 content_markdown,pass_threshold,completion_rule)
               VALUES ('x','m1',9,'X',5,'# X',0.8,'inventado')"""
        )


# ───────────────────────────── E2 · orden por módulo ─────────────────────────


def test_dos_modulos_pueden_tener_una_leccion_con_el_mismo_order(db_migrada):
    """Es el bloqueo que impedía anteponer módulos: antes el order era UNIQUE global."""
    db_migrada.execute(
        """INSERT INTO modules (id,"order",title,description,level)
           VALUES ('f1',2,'Fundamentos de paralelismo','Track conceptual','Básico')"""
    )
    db_migrada.execute(
        """INSERT INTO lessons (id,module_id,"order",title,estimated_minutes,
             content_markdown,pass_threshold)
           VALUES ('porQueNoVaMasRapido','f1',1,'¿Por qué no va más rápido?',4,'# t',0.8)"""
    )
    assert _filas(db_migrada, 'SELECT COUNT(*) FROM lessons WHERE "order"=1') == [(2,)]


def test_colision_de_order_entre_lecciones_vivas_del_mismo_modulo_se_rechaza(db_migrada):
    with pytest.raises(sqlite3.IntegrityError, match="lessons.module_id"):
        db_migrada.execute(
            """INSERT INTO lessons (id,module_id,"order",title,estimated_minutes,
                 content_markdown,pass_threshold)
               VALUES ('choque','m1',1,'Choca',5,'# t',0.8)"""
        )


def test_archivar_libera_el_hueco_de_order(db_migrada):
    """El motivo de que el índice sea PARCIAL.

    Con un UNIQUE de tabla, la lección archivada seguiría ocupando su slot y la
    que la sustituye reventaría: archivar sería inviable y el caso «una lección
    desaparece en la versión nueva» quedaría sin solución.
    """
    db_migrada.execute(
        "UPDATE lessons SET archived_at='2026-08-29T00:00:00.000Z' WHERE id='primerEjemplo'"
    )
    db_migrada.execute(
        """INSERT INTO lessons (id,module_id,"order",title,estimated_minutes,
             content_markdown,pass_threshold)
           VALUES ('primerEjemploV2','m1',1,'Hola mundo paralelo (v2)',15,'# Hola v2',0.8)"""
    )
    vivas = _filas(
        db_migrada,
        'SELECT id FROM lessons WHERE module_id=\'m1\' AND "order"=1 AND archived_at IS NULL',
    )
    assert vivas == [("primerEjemploV2",)]


# ──────────────────── La promesa: el progreso sobrevive ──────────────────────


def test_el_progreso_y_los_intentos_sobreviven_a_la_migracion(db_migrada):
    assert _filas(
        db_migrada,
        "SELECT completed, best_quiz_score, completed_via FROM lesson_progress WHERE lesson_id='primerEjemplo'",
    ) == [(1, 4, None)]
    assert _filas(db_migrada, "SELECT COUNT(*) FROM quiz_attempts") == [(1,)]


def test_archivar_una_leccion_no_toca_su_progreso(db_migrada):
    """CU-39: una lección que desaparece se archiva, y el avance ganado se queda."""
    db_migrada.execute(
        "UPDATE lessons SET archived_at='2026-08-29T00:00:00.000Z' WHERE id='primerEjemplo'"
    )
    assert _filas(
        db_migrada,
        "SELECT completed, best_quiz_score FROM lesson_progress WHERE lesson_id='primerEjemplo'",
    ) == [(1, 4)]


def test_completed_via_acepta_las_tres_vias_y_rechaza_el_resto(db_migrada):
    for via in ("quiz", "manual", "run"):
        db_migrada.execute(
            "UPDATE lesson_progress SET completed_via=? WHERE lesson_id='primerEjemplo'", (via,)
        )
    with pytest.raises(sqlite3.IntegrityError):
        db_migrada.execute(
            "UPDATE lesson_progress SET completed_via='inventado' WHERE lesson_id='primerEjemplo'"
        )


# ───────────────────── Manifiesto de selección y versión ─────────────────────


def test_modules_arranca_como_local_version_1(db_migrada):
    """Los módulos del baseline no vienen del bucket y no se actualizan desde él."""
    assert _filas(db_migrada, "SELECT version, origin, checksum FROM modules") == [(1, "local", None)]


def test_installed_modules_es_el_manifiesto_y_cae_con_su_modulo(db_migrada):
    db_migrada.execute("PRAGMA foreign_keys = ON")
    db_migrada.execute(
        """INSERT INTO installed_modules (module_id,object_path,installed_version,installed_checksum)
           VALUES ('m1','modulos/m1/v1.json',1,'abc123')"""
    )
    assert _filas(db_migrada, "SELECT COUNT(*) FROM installed_modules") == [(1,)]
    db_migrada.execute("DELETE FROM modules WHERE id='m1'")
    assert _filas(db_migrada, "SELECT COUNT(*) FROM installed_modules") == [(0,)]


def test_installed_modules_exige_version_positiva(db_migrada):
    with pytest.raises(sqlite3.IntegrityError):
        db_migrada.execute(
            """INSERT INTO installed_modules (module_id,object_path,installed_version,installed_checksum)
               VALUES ('m1','modulos/m1/v0.json',0,'abc')"""
        )


def test_module_update_log_guarda_el_informe_como_json_valido(db_migrada):
    db_migrada.execute(
        """INSERT INTO module_update_log (id,module_id,from_version,to_version,report_json)
           VALUES ('log1','m1',1,2,'{"progress":{"lost":[]}}')"""
    )
    assert _filas(db_migrada, "SELECT to_version FROM module_update_log") == [(2,)]
    with pytest.raises(sqlite3.IntegrityError):
        db_migrada.execute(
            """INSERT INTO module_update_log (id,module_id,from_version,to_version,report_json)
               VALUES ('log2','m1',1,2,'no soy json')"""
        )


# ───────────────────────────── Idempotencia ──────────────────────────────────


def test_el_bloque_base_sigue_siendo_re_ejecutable_tras_la_migracion(db_migrada):
    """`apply_schema` ejecuta el bloque base en CADA arranque: no puede chocar."""
    base, _ = _partir_esquema(SCHEMA.read_text(encoding="utf-8"))
    db_migrada.executescript(base)  # no debe lanzar
    assert _filas(db_migrada, "SELECT COUNT(*) FROM lessons") == [(2,)]


def test_borrar_la_leccion_arrastra_su_ejemplo_por_lesson_id(db_migrada):
    """La cascada cuelga de `lesson_id`, no del `id` compartido de antes.

    Regresión real: el escritor admin insertaba el ejemplo SIN `lesson_id`. La
    fila nacía con `lesson_id = NULL`, el `ON DELETE CASCADE` no la alcanzaba al
    borrar la lección, y el ejemplo huérfano bloqueaba por PRIMARY KEY cualquier
    recreación con ese mismo id (500 en `POST /admin/lessons`). Lo detectó
    `test_bl01_borrar_y_recrear_id_no_resucita_progreso`, pero desde allí la
    causa no se ve; este test la fija donde sí se ve.
    """
    db_migrada.execute("PRAGMA foreign_keys = ON")
    assert _filas(db_migrada, "SELECT COUNT(*) FROM examples WHERE lesson_id='primerEjemplo'") == [(1,)]

    db_migrada.execute("DELETE FROM lessons WHERE id='primerEjemplo'")

    assert _filas(db_migrada, "SELECT COUNT(*) FROM examples WHERE id='primerEjemplo'") == [(0,)]
    # Y el id queda libre: se puede recrear la lección con su ejemplo.
    db_migrada.execute(
        """INSERT INTO lessons (id,module_id,"order",title,estimated_minutes,
             content_markdown,pass_threshold)
           VALUES ('primerEjemplo','m1',1,'Hola otra vez',15,'# Hola',0.8)"""
    )
    db_migrada.execute(
        """INSERT INTO examples (id,lesson_id,filename,title,difficulty,teaches,
             threads_configurable,sweeps_threads,self_measures,parser_id,
             default_timeout_s,est_run_seconds,enabled,requires_gpu,
             expected_output_note,source_code)
           VALUES ('primerEjemplo','primerEjemplo','h.py','Hola',1,'t',1,0,0,'none',
                   30,5,1,0,'n','print(1)')"""
    )
    assert _filas(db_migrada, "SELECT lesson_id FROM examples WHERE id='primerEjemplo'") == [
        ("primerEjemplo",)
    ]


def test_un_ejemplo_huerfano_no_impide_crear_su_leccion(db_migrada):
    """El reverso: `lesson_id` nullable permite que exista un ejemplo suelto."""
    db_migrada.execute("PRAGMA foreign_keys = ON")
    db_migrada.execute(
        """INSERT INTO examples (id,lesson_id,filename,title,difficulty,teaches,
             threads_configurable,sweeps_threads,self_measures,parser_id,
             default_timeout_s,est_run_seconds,enabled,requires_gpu,
             expected_output_note,source_code)
           VALUES ('suelto',NULL,'s.py','Suelto',1,'t',1,0,0,'none',30,5,1,0,'n','c')"""
    )
    db_migrada.execute(
        """INSERT INTO lessons (id,module_id,"order",title,estimated_minutes,
             content_markdown,pass_threshold)
           VALUES ('suelto','m1',3,'Lección con el mismo id',5,'# t',0.8)"""
    )
    # Ids en tablas distintas: no colisionan. Emparejarlos es un UPDATE, no un choque.
    db_migrada.execute("UPDATE examples SET lesson_id='suelto' WHERE id='suelto'")
    assert _filas(db_migrada, "SELECT lesson_id FROM examples WHERE id='suelto'") == [("suelto",)]


# ─────────────── El snapshot leído desde DB (C4) ─────────────────────────────


@pytest.mark.asyncio
async def test_snapshot_lee_la_relacion_por_lesson_id_y_el_enabled_propio(tmp_path):
    """`ContentRepository.load` sobre una DB con la migración 5 aplicada.

    Fija los tres cambios de C4 a la vez: `example_id` sale de
    `examples.lesson_id` (no de la igualdad de ids), `enabled` sale de la
    columna de la lección, y una lección sin ejemplo es un `example_id = None`
    perfectamente válido en vez de un error.
    """
    import aiosqlite

    from app.db import apply_schema
    from app.repositories.content import ContentRepository

    async with aiosqlite.connect(tmp_path / "t.db") as db:
        db.row_factory = aiosqlite.Row
        await apply_schema(db)
        await db.executescript(SEMILLA_FASE4)
        # La migración 5 ya la aplicó apply_schema; hay que rellenar lo nuevo.
        await db.execute("UPDATE examples SET lesson_id = id")
        await db.execute(
            "UPDATE lessons SET enabled = 0 WHERE id = 'sumaVectoresGPU'"
        )
        # Lección conceptual: sin ejemplo, se completa leyéndola.
        await db.execute(
            """INSERT INTO lessons (id,module_id,"order",title,estimated_minutes,
                 content_markdown,pass_threshold,enabled,completion_rule,video_url)
               VALUES ('queEsUnHilo','m1',3,'¿Qué es un hilo?',5,'# Hilos',0.8,1,
                       'viewed','https://www.youtube.com/watch?v=dQw4w9WgXcQ')"""
        )
        await db.commit()

        repo = await ContentRepository.load(db)

    con_codigo = repo.lesson("primerEjemplo")
    assert con_codigo is not None
    assert con_codigo.example_id == "primerEjemplo"
    assert con_codigo.enabled is True
    assert con_codigo.completion_rule == "quiz"

    gpu = repo.lesson("sumaVectoresGPU")
    assert gpu is not None and gpu.enabled is False

    teorica = repo.lesson("queEsUnHilo")
    assert teorica is not None
    assert teorica.example_id is None, "una lección puede no tener ejemplo (E1)"
    assert teorica.enabled is True, "y aun así estar habilitada (E4)"
    assert teorica.completion_rule == "viewed"
    assert teorica.video_url == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    assert teorica.has_quiz is False


@pytest.mark.asyncio
async def test_snapshot_poda_recommended_a_modulos_no_instalados(tmp_path):
    """R6: el enlace colgante se descarta, NO tumba la carga.

    Sin esta regla, instalar el m1 del propio repo en una base vacía reventaría
    con `ContentError` dentro de `_persist` → 500, porque sus `recommended`
    apuntan a m2, m4 y m6. Sería un fallo garantizado del primer caso de uso.
    """
    import aiosqlite

    from app.db import apply_schema
    from app.repositories.content import ContentRepository

    async with aiosqlite.connect(tmp_path / "t.db") as db:
        db.row_factory = aiosqlite.Row
        await apply_schema(db)
        await db.executescript(SEMILLA_FASE4)
        await db.execute("UPDATE examples SET lesson_id = id")
        await db.execute(
            """UPDATE lessons SET recommended_json =
                 '[{"lesson_id":"sumaVectoresGPU","label":"GPU","tag":"Avanzado"},
                   {"lesson_id":"spmd","label":"SPMD","tag":"Práctica"}]'
               WHERE id = 'primerEjemplo'"""
        )
        await db.commit()

        repo = await ContentRepository.load(db)  # no debe lanzar

    leccion = repo.lesson("primerEjemplo")
    assert leccion is not None
    destinos = [r.lesson_id for r in leccion.recommended]
    assert destinos == ["sumaVectoresGPU"], "el enlace a 'spmd' (no instalado) se poda"


@pytest.mark.asyncio
async def test_la_ruta_lineal_salta_las_lecciones_archivadas(tmp_path):
    """Una lección archivada es legible, pero «Siguiente» no lleva a ella."""
    import aiosqlite

    from app.db import apply_schema
    from app.repositories.content import ContentRepository

    async with aiosqlite.connect(tmp_path / "t.db") as db:
        db.row_factory = aiosqlite.Row
        await apply_schema(db)
        await db.executescript(SEMILLA_FASE4)
        await db.execute("UPDATE examples SET lesson_id = id")
        await db.execute(
            """INSERT INTO lessons (id,module_id,"order",title,estimated_minutes,
                 content_markdown,pass_threshold)
               VALUES ('tercera','m1',3,'Tercera',5,'# t',0.8)"""
        )
        await db.execute(
            "UPDATE lessons SET archived_at='2026-08-29T00:00:00.000Z' "
            "WHERE id='sumaVectoresGPU'"
        )
        await db.commit()

        repo = await ContentRepository.load(db)

    primera = repo.lesson("primerEjemplo")
    archivada = repo.lesson("sumaVectoresGPU")
    assert primera is not None and archivada is not None
    # Salta la archivada, que estaba justo en medio.
    assert primera.next_lesson_id == "tercera"
    assert archivada.archived is True
    assert (archivada.prev_lesson_id, archivada.next_lesson_id) == (None, None)


@pytest.mark.asyncio
async def test_un_ejemplo_sin_leccion_no_entra_al_snapshot_publico(tmp_path):
    """Su module_id/order serían NULL y harían reventar el orden de /examples."""
    import aiosqlite

    from app.db import apply_schema
    from app.repositories.content import ContentRepository

    async with aiosqlite.connect(tmp_path / "t.db") as db:
        db.row_factory = aiosqlite.Row
        await apply_schema(db)
        await db.executescript(SEMILLA_FASE4)
        await db.execute("UPDATE examples SET lesson_id = id")
        await db.execute(
            """INSERT INTO examples (id,lesson_id,filename,title,difficulty,teaches,
                 threads_configurable,sweeps_threads,self_measures,parser_id,
                 default_timeout_s,est_run_seconds,enabled,requires_gpu,
                 expected_output_note,source_code)
               VALUES ('suelto',NULL,'s.py','Suelto',1,'t',1,0,0,'none',30,5,1,0,'n','c')"""
        )
        await db.commit()

        repo = await ContentRepository.load(db)  # no debe lanzar TypeError

    assert repo.example("suelto") is None
    assert {e.id for e in repo.examples()} == {"primerEjemplo", "sumaVectoresGPU"}
