# CU-39 — Algoritmo de actualización de un módulo preservando el progreso

Raíz del repo: `/mnt/d/universidad/tesis/telar`. Todas las rutas relativas a `/mnt/d/universidad/tesis/telar/backend/`.

---

## 0. Los cinco principios que gobiernan todas las decisiones

Cada caso borde de §6 se resuelve aplicando estos cinco principios en orden. Si dos chocan, gana el de número menor.

**P1 · El contenido es del autor; el progreso es del estudiante.**
Una actualización es un acto del *autor*, ejecutado sobre el equipo del *estudiante*. Ningún acto del autor puede destruir el registro biográfico de otra persona. El instalador **jamás** ejecuta `DELETE FROM lesson_progress` ni `DELETE FROM quiz_attempts`. `content_admin.delete_lesson` (`app/repositories/content_admin.py:376-391`) purga ambas tablas a propósito (BL-01): **está prohibido en toda ruta del actualizador.**

**P2 · Compatibilidad de incentivos: actualizar nunca puede empeorar tu estado.**
Si actualizar puede bajarte el avance, el estudiante racional no actualiza — y el mecanismo entero de módulos distribuibles muere. De aquí sale la **monotonía de `completed`**: un logro concedido no se revoca por un cambio de contenido. Solo lo revoca el propio estudiante (`PUT /progress/lessons/{id}` con `completed:false`, §6.2).

**P3 · Lo observado se conserva; lo derivado se recalcula.**
- *Observado* (inmutable): `viewed`, `last_job_id`, y **toda** fila de `quiz_attempts` (score, total, passed, answers, created_at). Son hechos: el estudiante realmente vio, realmente ejecutó, realmente respondió eso.
- *Derivado* (recalculable): `completed` y `best_quiz_score`. Son una función de (evidencia observada × contenido vigente). Cuando el contenido cambia, se **recalculan desde la evidencia**, nunca se borran a ciegas.

Corolario que resuelve BL-06 sin pérdida: `lesson_progress.best_quiz_score` es una **caché** de `quiz_attempts`. Poner la caché a `NULL` **no pierde nada** — el 4/4 sigue en `quiz_attempts` para siempre, con su fecha. La UI puede decir *"tu mejor resultado en la versión anterior: 4/4 (12 mar)"*.

**P4 · El progreso se ancla en `lesson_id`, y el instalador no adivina renombres.**
No hay heurística de similitud de títulos. Un `lesson_id` que cambia **es otra lección**. Es preferible perder el vínculo de forma ruidosa y avisada que inventar uno silencioso y equivocado. De aquí sale el invariante central del trabajo, y de aquí sale que el instalador debe *detectar y reportar* el patrón "n archivadas + n nuevas" como sospecha de rename (§6.D8).

**P5 · El bundle es DECLARATIVO (un estado completo), no un parche.**
Aplicar v5 sobre v2 es idéntico a aplicarlo sobre v4. No hay migraciones encadenadas, no hay orden de aplicación, no hay estado intermedio. Consecuencias: idempotencia por construcción (los mismos UPSERT por PK del seeder, `app/tools/seed_content.py:59-123`), reinstalación = reparación, y el "downgrade" es mecánicamente una actualización más (lo que lo hace peligroso es la semántica, no la mecánica).

---

## 1. E4 — criterio de "completado" (incluidas las lecciones sin quiz)

Hoy `completed` solo lo escribe un quiz aprobado (`app/services/quiz_service.py:150-152`); una lección sin quiz es **incompletable** salvo por el `PUT` manual de §6.2. E4 se cierra convirtiendo el criterio en un **dato del contenido**, declarado por el autor por lección: `lessons.completion_rule ∈ {'quiz','viewed','run'}`.

| Regla | `completed` se concede cuando | Quién lo escribe | Invariante que exige |
|---|---|---|---|
| `quiz` | existe un intento con `score/total ≥ pass_threshold` | servidor, en `QuizService.submit_attempt` (ya existe) | `≥1` pregunta; si no, el bundle se rechaza |
| `viewed` | el estudiante lo **declara explícitamente** (`PUT §6.2 completed:true`), botón habilitado en la UI solo si `viewed=true` | el estudiante | ninguno |
| `run` | existe un job con `lesson_id = l.id` y `status='completed'` | servidor, en el mismo upsert BL-05 de `app/services/job_runner.py:675-690` | `example_id IS NOT NULL` |

**Por qué `viewed` no se auto-concede al abrir la lección.** Abrir ≠ leer. Auto-completar al renderizar convierte la métrica en un contador de clics y destruye su valor informativo — y con ella el `modules_completed` del `ProgressSummary`. La autodeclaración explícita es honesta: la plataforma no puede medir comprensión sin evaluación, así que **no finge medirla**; delega y lo dice en la UI. Además da continuidad exacta con lo que hoy ya existe (el `PUT` manual), sin inventar semántica nueva.

**Procedencia.** `lesson_progress` gana `completed_via ∈ {'quiz','viewed','run','manual'}` y `completed_at`. Sin esto la UI no puede distinguir *"aprobado 5/6"* de *"marcada como completada por ti"*, y el caso B4 (quiz eliminado, lección sigue completada) es indefendible ante el estudiante. `PUT §6.2` sigue siendo permisivo (es una app local monousuario: el estudiante ya puede editar su SQLite), pero deja `completed_via='manual'`.

**Un cambio de `completion_rule` en N+1 nunca revoca** (P2): solo puede conceder.

---

## 2. Δ sobre la migración 5 que este algoritmo exige

Añadidos a lo ya diseñado en la fase anterior. Los tres primeros son **bloqueantes**: sin ellos el algoritmo no es implementable.

```sql
-- ── (1) BLOQUEANTE · corrección al DDL de E2 ────────────────────────────────
-- En lessons_m5, `UNIQUE (module_id,"order")` como CONSTRAINT DE TABLA hace
-- IMPOSIBLE archivar: una lección archivada seguiría ocupando su slot de orden
-- y la lección nueva que llegue en ese mismo orden reventaría con IntegrityError
-- (→ 500). El UNIQUE debe ser un ÍNDICE PARCIAL sobre las lecciones vivas:
CREATE UNIQUE INDEX IF NOT EXISTS idx_lessons_order_vivas
    ON lessons (module_id, "order") WHERE archived_at IS NULL;

-- ── (2) BLOQUEANTE · archivado (P1) ─────────────────────────────────────────
ALTER TABLE lessons  ADD COLUMN archived_at TEXT;   -- ISO-8601 UTC | NULL = viva
ALTER TABLE modules  ADD COLUMN archived_at TEXT;   -- desinstalar = archivar

-- ── (3) BLOQUEANTE · E4 + procedencia del logro ─────────────────────────────
--    (completion_rule ya estaba en lessons_m5)
ALTER TABLE lesson_progress ADD COLUMN completed_via TEXT
     CHECK (completed_via IS NULL OR completed_via IN ('quiz','viewed','run','manual'));
ALTER TABLE lesson_progress ADD COLUMN completed_at  TEXT;

-- ── (4) RECOMENDADO · el módulo remoto editado en local ─────────────────────
ALTER TABLE installed_modules ADD COLUMN locally_modified INTEGER NOT NULL DEFAULT 0
     CHECK (locally_modified IN (0,1));

-- ── (5) OPCIONAL · diario de actualizaciones (auditoría + pantalla "qué cambió")
CREATE TABLE IF NOT EXISTS module_update_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    module_id    TEXT NOT NULL,
    from_version INTEGER, to_version INTEGER NOT NULL,
    report_json  TEXT NOT NULL CHECK (json_valid(report_json)),
    applied_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
```

`archived_at` es **ortogonal a `enabled`**: `enabled` es el interruptor del autor ("no publicada todavía"), `archived_at` es "ya no viene en la versión instalada". Confundirlos hace imposible distinguir las dos causas al depurar. La condición de "activa" es `enabled = 1 AND archived_at IS NULL`; como en el baseline `archived_at` es siempre `NULL`, **ningún test actual cambia de resultado**.

Actualizar **antes** de tocar código: `docs/architecture/data-model.md` §3 y §5, y `docs/architecture/api-contract.md` §4.1 (`ModuleLesson.archived`), §6.1 (`ProgressEntry.completed_via`/`completed_at`) y la sección nueva de endpoints de catálogo remoto.

---

## 3. Arquitectura: plan puro + aplicador transaccional

```
app/services/bucket.py           BucketPort (typing.Protocol) — espeja DockerServicePort
                                 (app/services/docker_service.py:108-131)
app/services/module_merge.py     PURO: sin DB, sin red, sin FastAPI.
                                 build_plan(local, bundle, opts) -> MergePlan
app/services/module_installer.py Instalación inicial (fase previa)
app/services/module_updater.py   update_module(): red → validación → plan → _persist
app/schemas/bundle.py            ModuleBundle, CatalogEntry (pydantic v2)
app/schemas/updates.py           MergePlan, UpdateReport
tests/fakes/fake_bucket.py       FakeBucket inyectado en app.state (como fake_docker.py)
```

Separar el **plan** (función pura) del **aplicador** compra tres cosas:

1. Toda la tabla de casos borde de §6 se testea como **unit tests sin DB y sin red** — decenas de casos a coste cero, que es justo lo que exige `--cov-fail-under=80` sobre código nuevo.
2. **Vista previa gratis**: `POST /api/v1/modules/{id}/update?preview=true` devuelve el plan sin escribir. El estudiante *ve qué va a pasar con su progreso antes de aceptar*. Ese consentimiento informado es la mitad pedagógica de CU-39.
3. El error se decide **antes** de tocar la DB (4xx limpio), no dentro de `_persist` donde un `ContentError` se convierte en `500 INTERNAL_ERROR` (`app/services/content_writer.py:243-249`).

---

## 4. Pseudocódigo — orquestador

```python
# app/services/module_updater.py

async def update_module(app, module_id, *, preview=False, opts=UpdateOptions()) -> UpdateReport:
    """CU-39. La RED va FUERA del write_lock; la DB va dentro, en UNA transacción."""

    # ── F0 · catálogo remoto (fuera del lock) ────────────────────────────────
    bucket: BucketPort = app.state.bucket
    entry = (await bucket.list_catalog()).get(module_id)          # anónimo, público
    if entry is None:
        raise ApiException("MODULE_NOT_IN_CATALOG", ...)

    inst = await installed.get(app.state.db, module_id)           # tabla installed_modules
    if inst is None:
        raise ApiException("MODULE_NOT_INSTALLED", ...)           # esto es update, no install

    # Camino rápido (idempotencia, caso C1): mismo par (version, checksum) ⇒ no-op.
    if (entry.version, entry.checksum) == (inst.installed_version, inst.installed_checksum) \
       and not opts.repair:
        await installed.touch_checked(app, module_id, entry)      # solo last_checked_at
        return UpdateReport(status="up_to_date", ...)

    # Monotonía de versión (C2/C3).
    if entry.version == inst.installed_version and entry.checksum != inst.installed_checksum:
        raise ApiException("MODULE_VERSION_TAMPERED", ...)        # v inmutable: publicación rota
    if entry.version < inst.installed_version and not opts.allow_downgrade:
        raise ApiException("MODULE_VERSION_CONFLICT", ...)

    if inst.locally_modified and not opts.overwrite_local:
        raise ApiException("MODULE_LOCALLY_MODIFIED", ...)        # E1 de §6.E

    # ── F1 · descarga + integridad (fuera del lock; nada toca la DB) ─────────
    raw = await bucket.fetch(entry.object_path, max_bytes=settings.max_bundle_bytes)
    if sha256(raw).hexdigest() != entry.checksum:                 # C4: truncada/corrupta
        raise ApiException("BUNDLE_CHECKSUM_MISMATCH", ...)

    # ── F2 · parseo + validación en memoria (fuera del lock) ────────────────
    bundle = ModuleBundle.model_validate_json(raw)                # C6
    _assert_bundle_shape(bundle, module_id, entry.version)        # ids únicos, orders únicos,
                                                                  # ≥1 lección (C10), reglas E4
    issues  = validate_markdown_all(bundle)                       # markdown_validator.validate
    issues += example_coherence_all(bundle)                       # content_writer:91-122
    issues += quiz_issues_all(bundle)                             # content_writer:166-213
    issues += code_size_all(app, bundle)                          # content_writer:82-88
    if issues:
        raise _content_error(issues)     # CONTENT_VALIDATION_ERROR + details[{field,reason}]
                                         # contenido remoto = entrada no confiable: MISMO rigor

    # ── F3..F5 · DB (dentro del lock; UNA unidad, UN commit) ────────────────
    async with app.state.write_lock:                              # reentrante (db.py:26-77)
        local = await read_local_state(app.state.db, module_id)   # F3: se relee DENTRO del lock
        plan  = build_plan(local, bundle, opts)                   # F4: PURO
        if plan.conflicts:
            raise _conflict_error(plan.conflicts)                 # 409/422 ANTES de escribir
        if preview:
            return UpdateReport.from_plan(plan, status="preview") # no escribe nada
        await _persist(app, lambda: apply_plan(app.state.db, plan, entry))   # F5
        # _persist: write() → ContentRepository.load() valida el grafo COMPLETO sobre los
        # cambios sin commitear → commit() → swap de app.state.content.
        # Cualquier fallo ⇒ rollback ⇒ el estudiante se queda EXACTAMENTE en la versión N.

    return UpdateReport.from_plan(plan, status="updated")
```

## 4.1 Pseudocódigo — el plan (función pura, donde vive toda la doctrina)

```python
# app/services/module_merge.py

def build_plan(local: LocalModuleState, bundle: ModuleBundle, opts) -> MergePlan:
    plan = MergePlan(module_id=bundle.module_id,
                     from_version=local.version, to_version=bundle.version)

    # ── módulo ───────────────────────────────────────────────────────────────
    # "order" del módulo es LOCAL: una actualización JAMÁS lo toca (D5).
    plan.module = ModuleUpsert(title=bundle.title, description=..., level=...,
                               order=local.order,          # ← intacto
                               version=bundle.version, checksum=bundle.checksum,
                               origin="remote", archived_at=None)

    incoming = {l.id: l for l in bundle.lessons}
    present  = local.lessons                     # {lesson_id: LocalLesson} del módulo
                                                 # (incluye archivadas de versiones previas)

    # ── 1 · identidad: conflictos que abortan ANTES de escribir ─────────────
    for lid, l in incoming.items():
        owner = local.global_lesson_owner.get(lid)          # module_id dueño hoy, o None
        if owner not in (None, bundle.module_id):
            if local.origin_of(owner) == "local":
                plan.conflict("LESSON_OWNED_BY_LOCAL_MODULE", lid, owner)   # D2: nunca
            else:
                plan.moved_in.append((lid, owner))          # D1: re-parenting declarado
    plan.conflicts += question_id_conflicts(bundle, local)  # D3 (CW-02, ya existe)
    plan.conflicts += example_id_conflicts(bundle, local)   # D4 (riesgo NUEVO que abre E1)

    # ── 2 · lecciones que llegan ────────────────────────────────────────────
    for lid, l in incoming.items():
        prev = present.get(lid)
        if prev is None:
            plan.added.append(LessonUpsert(l, progress=None))       # A3: nace en cero
        else:
            if prev.archived_at is not None:
                plan.restored.append(lid)                           # A6: vuelve a la vida
            plan.updated.append(LessonUpsert(l, unarchive=True))
            plan.progress_ops.append(
                plan_progress(lid, local.progress.get(lid), local.attempts.get(lid, []),
                              old=prev, new=l))                     # ← §4.2
            if prev.content_markdown != l.content_markdown:
                plan.revised.append(lid)                            # A2: solo para el reporte

    # ── 3 · lecciones que ya no vienen ──────────────────────────────────────
    for lid, prev in present.items():
        if lid in incoming:            continue
        if prev.module_id != bundle.module_id: continue   # A7: ya la reclamó otro módulo
        if local.touched(lid):                            # progreso ∨ intentos ∨ jobs
            plan.archived.append(lid)                     # A4 · P1
        else:
            plan.removed.append(lid)                      # A5: nunca tocada ⇒ borrar limpio
                                                          #     (+ _clean_dangling_recommended)

    # ── 4 · sospecha de rename (P4): se AVISA, no se adivina ────────────────
    for lid in plan.archived:
        twin = next((n for n in plan.added
                     if incoming[n].title == present[lid].title), None)
        if twin:
            plan.warn("POSIBLE_RENOMBRADO", archived=lid, added=twin,
                      msg="mismo título, id distinto: el progreso NO se transfiere")  # D8

    # ── 5 · recommended colgantes (D7) ──────────────────────────────────────
    plan.pruned_recommended = prune_unresolvable(bundle, local)     # poda + warning

    return plan
```

## 4.2 El corazón: recálculo del progreso de una lección

```python
def plan_progress(lid, prog, attempts, *, old: LocalLesson, new: BundleLesson) -> ProgressOp:
    """P2 (completed monótono) + P3 (best_quiz_score = caché recalculable)."""
    if prog is None:
        return ProgressOp.NOOP                       # sin fila ⇒ nada que preservar

    old_ids  = {q.id: q for q in old.questions}
    new_ids  = {q.id: q for q in new.questions}

    # ¿La evidencia pasada sigue siendo interpretable contra el quiz nuevo?
    # OJO: la comparación es POR CONJUNTO DE IDS, jamás por `total` (trampa B9).
    same_set  = set(old_ids) == set(new_ids)
    same_opts = same_set and all(
        {o.key: o.text for o in old_ids[qid].options} ==
        {o.key: o.text for o in new_ids[qid].options} for qid in new_ids)
    regradable = bool(new_ids) and same_set and same_opts

    if regradable:
        # RECALIFICACIÓN EXACTA: quiz_attempts.answers guarda la respuesta del
        # estudiante pregunta por pregunta, así que se puede volver a corregir
        # con la clave NUEVA. Esto recupera con justicia el caso "el docente
        # arregló una correct_key equivocada" (B8) sin pedirle nada al estudiante.
        scored = [(sum(1 for qid, sel in a.answers.items()
                       if new_ids[qid].correct_key == sel), a.total) for a in attempts]
        best   = max((s for s, _ in scored), default=None)
        gained = any(s / t >= new.pass_threshold for s, t in scored)
    else:
        # Evidencia no interpretable (creció, encogió, cambió el set, cambiaron
        # las opciones, o desapareció el quiz). La CACHÉ se anula; el HISTÓRICO
        # en quiz_attempts queda intacto y sigue siendo mostrable por la UI.
        best, gained = None, False

    return ProgressOp(
        lesson_id       = lid,
        viewed          = prog.viewed,                    # observado ⇒ intacto
        last_job_id     = prog.last_job_id,               # observado ⇒ intacto
        best_quiz_score = best,                           # SET ABSOLUTO (puede ser NULL)
        completed       = prog.completed or gained,       # ← MONOTONÍA (P2)
        completed_via   = prog.completed_via or ("quiz" if gained else None),
        previous_best   = (prog.best_quiz_score, len(old_ids)),   # → reporte/UI
    )
```

> **Trampa de implementación (silenciosa y fatal).** El recálculo **no puede** pasar por `ProgressRepository.upsert` (`app/repositories/progress.py`): su `_UPSERT_SQL` aplica `MAX(best_quiz_score, :best_quiz_score)` y `COALESCE(:x, x)`, así que es **incapaz de bajar el valor y de escribir NULL** — el 4/4 obsoleto sobreviviría al merge y quedaría pegado para siempre. El actualizador necesita un `UPDATE` absoluto nuevo en `app/repositories/content_admin.py` (`rescore_progress_no_commit`), hermano de `reset_quiz_progress` (`:501-514`) pero con valor, no con `NULL` fijo.

## 4.3 Aplicación (dentro de `_persist`, un solo `commit`)

```python
async def apply_plan(db, plan, entry):
    # 1. APARCADO de orders (imprescindible): SQLite valida el UNIQUE por statement,
    #    no al final. Una v N+1 que intercambia l2↔l3 revienta a mitad de transacción.
    #    Se reutiliza el truco de dos fases de content_admin._reorder (:225-251):
    #    aparcar por encima del MAX global y luego escribir los orders finales.
    await park_orders(db, plan.touched_lesson_ids)

    # 2. Contenido, en el orden ya resuelto por el seeder (seed_content:206-308):
    #    modules → lessons → examples → quiz_questions.  TODO por UPSERT ON CONFLICT(id):
    #    idempotente por PK y, sobre todo, SIN pasar por delete_lesson (P1).
    await upsert_module(db, plan.module)
    for up in plan.added + plan.updated:  await upsert_lesson(db, up)   # archived_at = NULL
    await sync_examples(db, plan)          # ejemplo huérfano ⇒ DELETE del ejemplo, no de la lección
    await replace_quizzes(db, plan)        # DELETE+INSERT por lección (content_admin.replace_quiz)

    # 3. Archivado / borrado limpio
    for lid in plan.archived: await archive_lesson(db, lid)     # UPDATE archived_at = now
    for lid in plan.removed:                                    # nunca tocada por el estudiante
        await _clean_dangling_recommended(db, lid)
        await db.execute("DELETE FROM lessons WHERE id = ?", (lid,))   # CASCADE: ejemplo+quiz

    # 4. Progreso: SOLO UPDATE de campos derivados. Cero DELETE. Cero INSERT.
    for op in plan.progress_ops: await rescore_progress_no_commit(db, op)

    # 5. Manifiesto de selección
    await installed.mark_updated(db, plan.module_id, entry)      # installed_version/checksum,
                                                                # available_*, updated_at,
                                                                # locally_modified = 0
    await log_update(db, plan)                                  # module_update_log (opcional)
```

---

## 5. Reporte devuelto (y mostrado antes de aceptar)

```jsonc
{ "module_id": "m3", "from_version": 4, "to_version": 5, "status": "updated",
  "lessons": { "added": ["m3.tareas"], "revised": ["m3.spmd"], "archived": ["m3.viejo"],
               "removed": [], "restored": [], "moved_in": [] },
  "progress": { "preserved": 7, "completed_kept": 5, "completed_gained": ["m3.reduccion"],
                "scores_invalidated": [ {"lesson_id":"m3.spmd","previous":"4/4"} ],
                "lost": [] },                       // ← SIEMPRE debe poder ser [] (P1)
  "warnings": [ {"code":"POSIBLE_RENOMBRADO","archived":"m3.viejo","added":"m3.tareas"} ] }
```

`progress.lost` existe en el esquema del reporte **precisamente para que un test afirme que siempre está vacío**. Es el canario de CU-39.

---

## 6. Tabla de casos borde

`T:` = test que lo defiende. Ficheros nuevos: `backend/tests/test_module_merge_plan.py` (unitario, puro, sin DB) y `backend/tests/test_module_update.py` (integración sobre `client` + `FakeBucket`).

### A · Ciclo de vida de la lección

| # | Caso | Comportamiento decidido | Justificación | Test |
|---|---|---|---|---|
| A1 | Mismo `id`, contenido idéntico | No-op absoluto sobre el progreso | Idempotencia por UPSERT de PK, igual que `test_seed_idempotente` | `T: test_actualizacion_sin_cambios_no_toca_progreso` |
| A2 | Mismo `id`, **el texto cambia** | `viewed`, `completed`, `best_quiz_score`, `last_job_id` **intactos**. La lección entra en `report.lessons.revised` y la UI la marca "revisada" | Resetear `viewed` haría que "continuar donde ibas" saltara hacia atrás; `viewed` es ayuda de navegación, no logro. El estudiante merece *saber* que el texto cambió, no *perder* lo hecho | `T: test_texto_cambia_progreso_intacto_y_marcada_revisada` |
| A3 | **Lección nueva** en N+1 | Sin fila de progreso (defaults `viewed=false/completed=false`). Entra en la ruta lineal en su `order`. Los **agregados bajan**: un módulo que estaba al 100 % pasa a 90 % | Jamás se fabrica progreso. Y hay que distinguir dos cosas: **ningún logro individual se revoca** (P2), pero los agregados sí pueden bajar porque el denominador creció. La UI debe decir "el módulo creció: 2 lecciones nuevas", o el estudiante culpará a la actualización | `T: test_leccion_nueva_sin_progreso_y_agregado_baja_con_aviso` |
| A4 | **Desaparece** en N+1 y el estudiante la tocó | **Archivar**: `archived_at = now`, fila conservada, progreso conservado. Fuera de denominadores y de la ruta lineal; accesible por id con bandera `archived` | Ver argumento largo abajo (§6-bis) | `T: test_leccion_desaparecida_se_archiva_conserva_progreso` |
| A5 | Desaparece y **nunca fue tocada** (sin progreso, sin intentos, sin jobs) | `DELETE` limpio + `_clean_dangling_recommended` | Archivar lo que nadie tocó solo acumula basura y ensucia la UI. No hay nada que preservar: no hubo hecho biográfico | `T: test_leccion_desaparecida_intacta_se_borra_y_limpia_recommended` |
| A6 | Reaparece en N+2 (retirada por error) | Se **desarchiva** (`archived_at = NULL`) y el progreso sigue ahí, sin coste | Es *la* razón por la que A4 archiva en vez de borrar: la reversibilidad sale gratis | `T: test_leccion_reaparece_recupera_progreso` |
| A7 | **Se mueve a otro módulo** (ambos remotos e instalados) | Re-parenting: `module_id` cambia, `order` es el del bundle nuevo. **El progreso viaja gratis** porque está anclado a `lesson_id` y no sabe de módulos. El módulo origen no la archiva (ve `module_id != él`) | Es el dividendo de P4: la reorganización curricular es barata precisamente porque el ancla no es la ruta sino el id. `lesson_progress` no tiene FK a `lessons` — esa ausencia deliberada es lo que lo hace posible | `T: test_leccion_movida_entre_modulos_conserva_progreso` |
| A8 | Se mueve a un módulo **no instalado** | En el módulo origen se archiva (A4). Si el destino se instala después, se desarchiva y se re-parenta | Convergente sea cual sea el orden de instalación (P5) | `T: test_movida_a_modulo_no_instalado_se_archiva_y_luego_converge` |
| A9 | El bundle reclama una lección de un módulo **`origin='local'`** | `409 LESSON_OWNED_BY_LOCAL_MODULE`, nada se escribe | Contenido remoto nunca puede robar contenido autorado localmente. Es la frontera de confianza | `T: test_bundle_no_puede_robar_leccion_local` |
| A10 | El autor pone `enabled=0` en N+1 | Se aplica (es contenido). El progreso queda intacto; la lección sale de `lessons_enabled` y de `questions_enabled_total` | `enabled` es del autor; el progreso, del estudiante. Se tocan cosas distintas | `T: test_enabled_off_no_toca_progreso` |
| A11 | Cambian los `order` (p. ej. l2↔l3) | Se aplican, con **aparcado en dos fases** | El `UNIQUE(module_id,"order")` se valida por statement: sin aparcar, el swap revienta a mitad de transacción → `IntegrityError` → 500. Ya resuelto en `content_admin._reorder:225-251` | `T: test_swap_de_orders_no_viola_unique` |
| A12 | La lección **pierde su ejemplo** (E1) | Se borra la fila de `examples`; la lección sobrevive. Los jobs históricos siguen legibles | `jobs` guarda `source_code` en snapshot y no tiene FK a `examples`: el historial es inmune | `T: test_leccion_pierde_ejemplo_historial_de_jobs_intacto` |
| A13 | La lección **gana** ejemplo | Alta del ejemplo. Cero efecto en progreso | E1 hace que esto sea una operación normal, no una excepción | `T: test_leccion_gana_ejemplo` |
| A14 | Cambian `title` / `estimated_minutes` | Se aplican. Cero efecto | Cosmético | cubierto por A2 |

### 6-bis · Por qué archivar y no borrar (argumento de A4)

1. **Propiedad del registro (P1).** El autor puede retirar *su* contenido; no puede borrar la biografía de aprendizaje de otra persona. Un `DELETE` aquí es exactamente lo que hace `content_admin.delete_lesson` (purga `lesson_progress` y `quiz_attempts`), y es la operación que este trabajo existe para no ejecutar.
2. **Reversibilidad asimétrica.** Archivar es reversible a coste cero (A6); borrar es irreversible. Ante dos opciones con la misma información, se elige la que no cierra puertas — y una retirada de contenido es tan a menudo un error de publicación como una decisión.
3. **Integridad de los hechos.** `quiz_attempts.lesson_id` y `jobs.lesson_id` **no tienen FK** (`app/schema.sql:66-89`). Si se borra la lección, esas filas quedan huérfanas y el historial de jobs pasa a mostrar "lección desconocida". Con la fila archivada el título sigue resolviéndose: *"piSpmd.py · Introducción a SPMD (archivada)"*.
4. **Métrica honesta.** Archivada ⇒ fuera del denominador: no penaliza el porcentaje. Pero sigue visible en una sección "archivadas" si el estudiante tiene progreso allí. Ni castiga ni miente.
5. **Coste.** Una fila de texto. Despreciable frente al coste de destruir evidencia.

### B · Quiz y progreso derivado

| # | Caso | Comportamiento decidido | Justificación | Test |
|---|---|---|---|---|
| B1 | **Quiz crece 4→6** (las 4 originales se conservan) | `best_quiz_score → NULL`; `quiz_total` pasa a 6; **`completed` se conserva**; `quiz_attempts` intactos. El reporte lleva `previous: "4/4"` y la UI lo muestra | Es BL-06 resuelto sin pérdida. Reescalar a 6/6 sería *inventar* respuestas correctas a preguntas que el estudiante nunca vio (fraude); dejarlo en 4/6 sería *castigarlo* por preguntas que nunca vio (injusto). La única salida honesta es no publicar una nota sobre un denominador que nadie contestó — y como el histórico es inmutable, el 4/4 no se pierde: se reubica de "nota vigente" a "resultado de la versión anterior". `completed` no se toca porque un cambio del autor no revoca un logro del estudiante (P2) | `T: test_quiz_crece_invalida_nota_conserva_completed_y_historial` |
| B2 | Mismas preguntas (ids, opciones y claves), solo cambian **redacciones de enunciado** | Recalificación: mismo resultado. Nada cambia. No aborta intentos en vuelo | Espeja la regla que ya existe en `_ensure_content_current` (`quiz_service.py:187-221`): los cambios cosméticos no invalidan | `T: test_quiz_cosmetico_no_invalida_nota` |
| B3 | **Quiz encoge 6→4** (subconjunto) | Igual que B1: `best → NULL`, `completed` conservado | El conjunto de ids cambió ⇒ la evidencia no es interpretable contra el quiz nuevo | `T: test_quiz_encoge_invalida_nota` |
| B4 | **Quiz eliminado** en N+1, la lección estaba `completed` por haberlo aprobado | `quiz_total = 0`, `best → NULL`, **`completed` se conserva** con `completed_via='quiz'`, `quiz_attempts` intactos. La regla pasa a la que declare el bundle (típicamente `viewed`) | El estudiante *aprobó* ese quiz: el hecho ocurrió y está registrado con fecha. Retirar el examen no deshace el examen aprobado. Aquí el actualizador **diverge deliberadamente** de `content_writer.delete_quiz:561-579`, que hace reset incondicional: el admin editando *su propio* curso y una actualización que le *llega* al estudiante son actos distintos, y solo el primero tiene autoridad para degradar el estado local. `completed_via` es lo que permite a la UI explicarlo ("completada en su día por quiz, ya retirado") en lugar de mostrar un `completed` sin causa aparente | `T: test_quiz_eliminado_conserva_completed_y_attempts` |
| B5 | Lección **sin quiz gana quiz** (regla `viewed`→`quiz`) | `completed` conservado con `completed_via='manual'`; `best = NULL`; el quiz queda disponible para intentarlo | Monotonía (P2). La UI muestra "completada (autodeclarada) · ahora tiene evaluación" — honesto sobre la procedencia del logro | `T: test_leccion_gana_quiz_conserva_completado_manual` |
| B6 | **`pass_threshold` baja** (0.8 → 0.6) | Recalificación sobre los intentos comparables: quien tenía 0.7 **gana `completed`** ahora. `best` sin cambios | Estrictamente mejor que el reset ciego actual de BL-06, que *revocaba* a alguien a quien la nueva política aprueba. La política del docente se aplica a la evidencia que ya existe | `T: test_umbral_baja_concede_completed_desde_historico` |
| B7 | **`pass_threshold` sube** (0.6 → 0.8) | **No revoca** nada. La política nueva rige los intentos futuros | P2 en su forma más pura: si subir el listón puede quitarte lo ganado, el estudiante evita actualizar y el mecanismo entero se cae. El histórico deja constancia de bajo qué umbral se aprobó | `T: test_umbral_sube_no_revoca_completed` |
| B8 | Mismas preguntas y opciones, **cambia una `correct_key`** (el docente arregla la clave) | **Recalificación exacta** con la clave nueva: `best` puede subir o bajar; `completed` solo puede subir | `quiz_attempts.answers` guarda la respuesta del estudiante pregunta a pregunta: se puede volver a corregir con precisión total, sin pedirle nada. Un estudiante penalizado por una clave errónea recupera su punto automáticamente. Que `best` pueda bajar es coherente: es una **medida**, no un logro (P3) | `T: test_correct_key_corregida_recalifica_intentos` |
| B9 | Se **quita una pregunta y se añade otra** (total 5→5) | `best → NULL` (no comparable) | **Trampa clásica**: un implementador compara `attempt.total == quiz_total`, ve 5==5 y da por buena una nota calculada sobre otras preguntas. El predicado es **por conjunto de ids**, nunca por conteo | `T: test_mismo_total_distinto_set_invalida_la_nota` |
| B10 | Cambian los **textos de las opciones** con las mismas keys | `best → NULL` | La respuesta "b" ya no significa lo mismo: recalificar sería corregir una respuesta a otra pregunta | `T: test_opciones_reescritas_invalidan_la_nota` |
| B11 | El recálculo debe **bajar o anular** `best_quiz_score` | `UPDATE` absoluto vía `rescore_progress_no_commit` | `ProgressRepository._UPSERT_SQL` aplica `MAX` y `COALESCE`: es *incapaz* de bajar o de escribir NULL. Un merge que pase por ahí falla en silencio y deja la nota obsoleta pegada para siempre | `T: test_rescore_puede_anular_best_score` (y un test que afirma que el upsert normal **no** puede: `test_upsert_no_puede_bajar_best_score`) |
| B12 | **Intento de quiz en vuelo** durante la actualización | El intento aborta con `422 QuizValidationError` ("el quiz cambió, recarga") | Ya lo garantiza `_ensure_content_current` dentro del `write_lock`. Sin él, un intento obsoleto reescribiría la nota justo después del merge y el `MAX` haría la corrupción permanente | `T: test_actualizacion_concurrente_aborta_intento_en_vuelo` (extiende `tests/test_quiz_atomicity.py`) |
| B13 | Lección con `completion_rule='run'` cuyo ejemplo cambia de código | `completed` conservado (el job ocurrió); `last_job_id` intacto | El job guarda su propio snapshot de `source_code`: la evidencia es autocontenida | `T: test_regla_run_conserva_completed_al_cambiar_el_codigo` |

### C · Versiones, red y atomicidad

| # | Caso | Comportamiento decidido | Justificación | Test |
|---|---|---|---|---|
| C1 | **Reinstalar la misma versión** (mismo `version` + `checksum`) | Camino rápido: no-op de contenido, solo se refresca `last_checked_at`. Con `mode='repair'` se re-aplica el bundle completo (idempotente por PK) | La idempotencia es una propiedad *estructural* (UPSERT por PK, P5), no un caso especial; el camino rápido es solo una optimización. `repair` sirve para volver a un estado conocido tras una edición local | `T: test_reinstalar_misma_version_es_noop` · `T: test_repair_reaplica_y_es_idempotente` |
| C2 | Misma `version`, **checksum distinto** | `409 MODULE_VERSION_TAMPERED`. No se escribe nada | Una versión publicada es inmutable. Si cambia el contenido bajo la misma versión, o la publicación está rota o el objeto fue manipulado: en ambos casos "hay actualización" deja de ser decidible por versión, que es el eje de todo el mecanismo | `T: test_misma_version_distinto_checksum_se_rechaza` |
| C3 | **Downgrade** (catálogo v3, instalado v5) | Rechazado por defecto (`409 MODULE_VERSION_CONFLICT`). Permitido solo con `allow_downgrade` explícito (admin/depuración); entonces recorre **el mismo merge**: las lecciones de v5 ausentes en v3 se archivan (no se borran) y el progreso sobrevive | Mecánicamente un downgrade no es peligroso (P5: el bundle es un estado). Lo peligroso es la *semántica*: archiva lecciones donde el estudiante ya avanzó y confunde "hay actualización". Se bloquea por defecto y se documenta la salida | `T: test_downgrade_rechazado_por_defecto` · `T: test_downgrade_forzado_no_pierde_progreso` |
| C4 | **Descarga interrumpida / truncada** | El sha256 no cuadra → `BUNDLE_CHECKSUM_MISMATCH`. **La DB no se tocó**: no hubo ni una sentencia | La red vive entera en F1, antes de abrir el `write_lock`. La atomicidad no requiere staging en disco porque no hay escritura parcial posible | `T: test_descarga_truncada_no_toca_la_db` |
| C5 | **Bucket caído / sin internet** | `503 BUCKET_UNAVAILABLE`. El módulo instalado sigue funcionando íntegro | Lo instalado vive en SQLite; el bucket solo hace falta para *cambiar* de versión. Telar sigue siendo usable offline, que es un requisito del despliegue de escritorio | `T: test_bucket_caido_no_degrada_el_contenido_instalado` |
| C6 | JSON malformado, demasiado grande o demasiado anidado | `422 BUNDLE_MALFORMED` / `413 BUNDLE_TOO_LARGE` antes de tocar la DB | Contenido remoto = entrada no confiable: límites de tamaño y de forma antes de parsear | `T: test_bundle_malformado_o_enorme` |
| C7 | Bundle que **viola reglas de contenido** (markdown fuera del subset, `correct_key` fuera de opciones, `requires_gpu` con `enabled=true`, código > `max_code_bytes`) | `422 CONTENT_VALIDATION_ERROR` con `details=[{field, reason}]`. DB intacta | Se **reutilizan literalmente** las validaciones del CRUD admin (`content_writer:82-213`, `markdown_validator.validate`). El contenido remoto se somete al mismo rigor que el del propio autor; escribir un validador aparte sería duplicar la superficie de fallo | `T: test_bundle_invalido_devuelve_details_y_no_escribe` |
| C8 | Fallo a mitad de la escritura (`IntegrityError`, grafo inconsistente) | `_persist` hace `rollback`: la versión N queda **exactamente** como estaba, `installed_modules` incluido, y `app.state.content` no se cambia | Es la garantía CW-01/CW-03 que ya existe y ya está testeada. El actualizador no inventa atomicidad: la hereda | `T: test_fallo_a_mitad_deja_la_version_n_intacta` |
| C9 | **Corte de luz durante el commit** | WAL revierte la transacción incompleta al reabrir; al arrancar, `app.state.content` se reconstruye desde la DB | `PRAGMA journal_mode=WAL` + `synchronous=NORMAL` (`app/db.py:88-96`) | `T: test_db_reabierta_tras_commit_incompleto` (simulado sobre fichero) |
| C10 | Bundle con **0 lecciones** | `422 MODULE_EMPTY` | Un módulo publicado sin lecciones no es contenido, y aceptarlo archivaría el módulo entero por un error de publicación | `T: test_bundle_vacio_se_rechaza` |
| C11 | **Salto de versiones**: instalado v2, catálogo v5 | Se aplica v5 directamente. No hay cadena de migraciones | P5: el bundle es un estado completo, no un parche. 2→5 y 4→5 recorren exactamente el mismo código, así que no hay caminos poco probados | `T: test_salto_v2_a_v5_equivale_a_v4_a_v5` |
| C12 | Actualización concurrente con un job terminando o un progreso guardándose | El `write_lock` serializa; la red queda **fuera** del lock | Si la descarga se hiciera dentro del lock, un bucket lento congelaría cada `finish()` de job y cada `PUT` de progreso. Ese es el error de diseño que la separación F1/F3 evita | `T: test_red_fuera_del_lock_no_bloquea_jobs` |
| C13 | **Vista previa** (`preview=true`) | Devuelve el plan; no escribe nada. Al aplicar se revalida el checksum: si cambió, se avisa y se recalcula | Consentimiento informado antes de tocar el progreso. Un `preview` que mienta es peor que no tenerlo, de ahí la revalidación | `T: test_preview_no_escribe_y_coincide_con_lo_aplicado` |

### D · Identidad y colisiones (PKs globales)

| # | Caso | Comportamiento decidido | Justificación | Test |
|---|---|---|---|---|
| D1 | Un **`lesson_id` del bundle pertenece a otro módulo remoto instalado** | Se acepta como *move* (A7), se registra en `report.lessons.moved_in` y se recomienda revisar el módulo origen | Rechazar obligaría al estudiante a razonar sobre el orden de actualización de módulos ajenos. El progreso viaja con el id, así que el movimiento es seguro | `T: test_lesson_id_reclamada_desde_otro_modulo_remoto` |
| D2 | El dueño actual es un módulo **local** | `409`, nada se escribe (= A9) | Frontera de confianza: lo remoto no sobrescribe lo autorado localmente | A9 |
| D3 | **`question_id` colisiona** con una pregunta de otra lección | `422` con `details` por pregunta | `quiz_questions.id` es PK **global** (`schema.sql:157`): sin este chequeo sería `IntegrityError` → 500. El detector ya existe: `content_admin.question_ids_in_other_lessons:155-171` (CW-02) | `T: test_colision_de_question_id_da_422_limpio` |
| D4 | **`example_id` colisiona** con un ejemplo de otro módulo | `422` con `details` | Riesgo **nuevo** que abre E1: al dejar `examples.id` de ser el `lesson_id`, pasa a ser una PK global independiente y colisionable. Necesita su propio `example_ids_in_other_modules` | `T: test_colision_de_example_id_da_422_limpio` |
| D5 | **`modules."order"` colisiona** | En la **instalación**: se reasigna a `MAX(order)+1` y el `suggested_order` del bundle solo se usa si está libre. En la **actualización**: el `order` local **nunca se toca** | `modules."order"` sigue siendo UNIQUE global. Que una actualización reordenara el curso del estudiante sin pedir permiso sería un efecto lateral inaceptable: la posición del módulo en *su* ruta es una decisión local | `T: test_actualizacion_no_cambia_el_order_del_modulo` · `T: test_instalacion_reasigna_order_en_colision` |
| D6 | Ids duplicados **dentro del propio bundle**, u `order` repetido dentro del módulo | `422` en F2, antes de mirar la DB | Validación estructural pura; es barata y evita diagnósticos confusos más adelante | `T: test_bundle_con_ids_duplicados` |
| D7 | `recommended` apunta a una lección **no instalada** | La referencia se **poda** con warning en el reporte; se reevalúa en cada instalación posterior | Si no se poda, `ContentRepository.load` lanza `ContentError` dentro de `_persist` y sale como `500 INTERNAL_ERROR` — un bundle legítimo que referencia otro módulo tumbaría la actualización con un error opaco. Limitación conocida: el enlace no se restaura solo hasta que se reinstale/repare el módulo que lo declara | `T: test_recommended_a_modulo_no_instalado_se_poda_sin_500` |
| D8 | El autor **renombra un `lesson_id`** (mismo título, id nuevo) | Se procesa como archivar + crear: la vieja se archiva con su progreso, la nueva nace en cero. Se emite `warning: POSIBLE_RENOMBRADO` con ambos ids | **Este es el único caso en que el estudiante "pierde" el avance**, y por eso el invariante de ids estables es la piedra angular del trabajo. El actualizador no adivina (P4): dos lecciones con el mismo título pueden ser cosas distintas, y transferir progreso por parecido tipográfico es peor que no transferirlo. Lo que sí puede y debe hacer es **verlo y decirlo** — al estudiante en el reporte, y al autor en el validador de publicación, que debe rechazar un cambio de id entre versiones del mismo módulo | `T: test_rename_de_id_avisa_y_no_transfiere_progreso` + `T: test_publicar_cambiando_un_lesson_id_se_rechaza` (lado admin) |

### E · Entorno, UX y ciclo de vida del módulo

| # | Caso | Comportamiento decidido | Justificación | Test |
|---|---|---|---|---|
| E1 | El admin local **editó** una lección de un módulo remoto | `installed_modules.locally_modified = 1`. La actualización pide confirmación (`409 MODULE_LOCALLY_MODIFIED`, se supera con `overwrite_local`) | Sobrescribir en silencio el trabajo del docente es la misma clase de error que borrar el progreso del estudiante, un nivel más arriba | `T: test_modulo_modificado_localmente_exige_confirmacion` |
| E2 | El estudiante **desinstala** un módulo | Se archiva el módulo y sus lecciones y se borra la fila de `installed_modules`. El progreso **se conserva**. Purgarlo es una acción separada y explícita ("borrar también mi progreso") | Coherente con A4. Desinstalar suele ser "liberar espacio / limpiar la ruta", no "renunciar a lo aprendido". Además, borrar el módulo cascadearía a `lessons` y dejaría `quiz_attempts` huérfanos | `T: test_desinstalar_archiva_y_conserva_progreso` |
| E3 | El estudiante tenía abierta (o marcada) una lección **archivada** | `GET /lessons/{id}` responde `200` con `archived: true` y banner; queda fuera de la ruta lineal (`prev`/`next` la saltan) y de los denominadores | Un enlace guardado no debe dar 404: la lección existe en *su* historia. Pero no debe reaparecer en la navegación como si siguiera vigente | `T: test_leccion_archivada_accesible_pero_fuera_de_la_ruta` |
| E4 | Historial de jobs de una lección archivada o borrada | Sigue legible: `jobs` guarda `source_code`, `filename` y métricas en snapshot y no tiene FK a `lessons`/`examples` | El historial de ejecución es evidencia autocontenida; nunca depende de que el contenido siga existiendo | `T: test_historial_de_jobs_sobrevive_al_archivado` |
| E5 | Actualización mientras la UI muestra el módulo | Los lectores ven N o N+1, nunca una mezcla | `_persist` hace el swap de `app.state.content` **después** del commit, bajo `content_read_lock` (BL-19) | `T: test_lectores_nunca_ven_estado_mixto` |

---

## 7. Alternativas rechazadas (y por qué)

| Alternativa | Por qué se descarta |
|---|---|
| **Reescalar** `best_quiz_score` 4/4 → 6/6 al crecer el quiz | Inventa respuestas correctas a preguntas que el estudiante nunca vio. Es fabricar evidencia |
| Dejar 4/6 tal cual | Publica una nota calculada sobre un denominador que el estudiante nunca contestó. Es la mentira que BL-06 detectó |
| Añadir `lesson_progress.best_quiz_total` y mostrar "4/4 (v. anterior)" como nota vigente | Innecesario: `quiz_attempts` ya guarda `score`, `total`, `passed` y `created_at` por intento. Además obligaría a cambiar el `MAX` de `_UPSERT_SQL` por una comparación de ratios en SQL — más superficie de fallo en un fichero congelado, a cambio de datos ya disponibles |
| **Reset ciego** `best=NULL, completed=0` (lo que hace hoy `reset_quiz_progress`) en la ruta de actualización | Revoca logros por un acto ajeno (viola P2) y desperdicia evidencia perfectamente interpretable (viola P3). Se conserva **solo** en la ruta admin, donde el autor manda sobre su propia máquina |
| **Borrar** las lecciones que desaparecen | Destruye progreso, es irreversible y deja `quiz_attempts`/`jobs` huérfanos (§6-bis) |
| Transferir progreso por **similitud de títulos** al detectar un rename | Adivinar mal es peor que no adivinar: asigna a otra persona un logro que no obtuvo, sin forma de detectarlo después (P4) |
| Aplicar **parches incrementales** (diff v4→v5) en vez de estados completos | Obliga a aplicar versiones en cadena, multiplica los caminos y hace que "instalado v2, disponible v5" sea un caso distinto de v4→v5. El estado completo colapsa todos esos caminos en uno (P5) |
| Descargar **dentro** del `write_lock` | Un bucket lento congelaría cada `finish()` de job, cada intento de quiz y cada `PUT` de progreso |
| Reutilizar `content_admin.delete_lesson` para "actualizar = borrar y recrear" | Purga `lesson_progress` y `quiz_attempts` (BL-01). Es exactamente el fallo que CU-39 existe para impedir |

---

## 8. Orden de implementación

1. `docs/architecture/data-model.md` §3/§5 y `api-contract.md` §4.1/§6.1 + endpoints nuevos — **spec antes que código** (contratos congelados).
2. Bloque `-- migration 5` con el Δ de §2, verificado con `tests/test_repositories.py` + test de backfill. Un error de sintaxis aquí tumba las 205 pruebas de golpe (la migración corre sobre la DB `:memory:` de todos los fixtures).
3. `app/services/module_merge.py` **puro** y `tests/test_module_merge_plan.py`: toda la tabla de §6 como unit tests, sin DB ni red. Es donde se gana la cobertura y donde se congela la doctrina.
4. `rescore_progress_no_commit` en `content_admin` + el test que demuestra que `ProgressRepository.upsert` **no** sirve para esto (B11).
5. `BucketPort` + `FakeBucket` + `module_updater` sobre `_persist`, y `tests/test_module_update.py` de extremo a extremo.
6. Extender `tests/test_quiz_atomicity.py` con la actualización concurrente (B12).

**El test que define CU-39** — el que debe existir antes que el código y no puede fallar nunca:

```python
async def test_cu39_actualizar_nunca_pierde_progreso(client, fake_bucket):
    """Con progreso sembrado en TODAS las lecciones de m3, aplicar v2..v6 (que
    añaden, quitan, mueven, renumeran y reescriben quizzes) deja invariante:
      · ninguna fila de lesson_progress desaparece,
      · ninguna fila de quiz_attempts desaparece,
      · ningún `completed` pasa de True a False,
      · report.progress.lost == [] en las cuatro actualizaciones."""
```