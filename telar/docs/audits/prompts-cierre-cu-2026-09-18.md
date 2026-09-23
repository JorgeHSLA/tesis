# Prompts para cerrar la auditoría de CU (2026-09-18)

Salida de `/prompt-optimize` sobre el borrador de Jorge. Tres piezas:

1. **Prompt 0 — Sesión de blueprint** (una sola sesión, sin código).
2. **Plantilla por tema** (una sesión por tema T1..T13).
3. **Versión rápida** (para temas pequeños o cuando ya existe el blueprint).

---

## Prompt 0 — Blueprint y decisiones de arquitectura

```
# Sesión 0 — Blueprint para cerrar la auditoría de casos de uso de Telar

Usa el skill `blueprint`. Esta sesión NO implementa código: produce ADRs y un plan por sesiones que un agente fresco pueda ejecutar en frío. Modelo recomendado: Opus.

## Lee primero, en este orden
1. `telar/CLAUDE.md`, `telar/backend/CLAUDE.md`, `telar/frontend/CLAUDE.md`, `telar/desktop/CLAUDE.md`.
2. `telar/docs/architecture/api-contract.md`, `data-model.md`, `architecture.md`, `fase4-autoria-design.md`, `electron-spec.md`.
3. `telar/docs/audits/auditoria-cu-2026-09-18.md` — FUENTE DE VERDAD: 41 CU, cada uno con "Por qué" (lo que YA funciona y debe conservarse) y faltantes numerados ("Cómo está ahora" / "Cómo debería estar"). Su numeración NO coincide con `telar/docs/casos-de-uso.md` (34 CU, numeración vieja); manda la auditoría.
4. Código clave: `backend/app/schema.sql`, `backend/app/repositories/`, `backend/app/services/{content_state,content_writer,module_installer,module_updater,module_merge,catalog_import,catalog_publish,catalog_publisher,job_runner,docker_service}.py`, `backend/app/routers/{admin,admin_catalog,catalog,progress,ws}.py`, `frontend/src/{stores,features/admin,features/learn,features/simulator,features/results,ws}`, `desktop/src/{main,ipc-docker}.ts`, `backend/tests/test_migration5.py` (cómo se numeran las migraciones).

## Decisiones ya tomadas (respétalas; si el código da una razón fuerte en contra, documéntala en el ADR y sigue)
- D1 Contratos congelados → se enmiendan contract-first, solo de forma aditiva y retrocompatible (campos opcionales nuevos, endpoints nuevos, mensajes WS nuevos; nunca renombrar ni cambiar semántica de lo existente). Orden obligatorio: editar `api-contract.md`/`data-model.md`/`electron-spec.md` → en el MISMO commit actualizar `backend/app/schemas/*`, `frontend/src/api/types.ts`, `frontend/src/ws/messages.ts`, `frontend/src/types/telar.d.ts` y `desktop/types/telar-api.d.ts` (`npm run check:contract`).
- D2 Curso es la unidad publicable. `modules.course_id` obligatorio. Bundle v2 = curso; el lector acepta bundles v1 (un módulo) como curso de un módulo. Bundles ya publicados en GCS y bases SQLite existentes siguen cargando (la migración crea un curso por módulo legado).
- D3 Draft/published local: Autoría lee/escribe la versión de trabajo; `/api/v1/modules`, `/lessons`, `/examples`, `/quizzes`, `/progress` y `/aprender` leen SOLO la versión publicada; CU-37 promueve draft→published localmente además de subir a GCS. El ADR elige la representación (snapshot inmutable vs columna de estado) con estos criterios: promoción en una transacción dentro de `write_lock`; coste de lectura del estudiante ≈ actual; progreso, intentos y jobs referencian contenido publicado; las pruebas admin (CU-22) corren contra el draft sin tocar progreso.
- D4 Requisitos de lección: `completion_rule` se generaliza a un conjunto de requisitos (`viewed`, `quiz`, `run`, `workshop`) con marca por requisito y completitud derivada (completa ⇔ todos los requeridos cumplidos). Migración: `quiz`→{quiz}, `viewed`→{viewed}, `run`→{run}. Taller = actividad opcional de la lección con estado propio, retomable, y ejecuciones asociadas por `workshop_id` (una ejecución suelta del simulador no lo completa).
- D5 Progreso identificado por (publicación, `lesson_id`), no solo `lesson_id` (cierra CU-35 nota y CU-38.2).

## Entregables de esta sesión
1. `telar/docs/architecture/adr/ADR-001-enmienda-contratos.md` … `ADR-005-identidad-progreso.md` (skill `architecture-decision-records`): contexto, opciones, decisión, consecuencias y el DIFF exacto propuesto a `api-contract.md`/`data-model.md` (secciones, campos, endpoints, mensajes WS).
2. `telar/docs/audits/blueprint-cierre-cu.md`: un paso por tema T1..T13 con brief AUTOCONTENIDO para un agente frío: CU y faltantes que cierra (por número, p. ej. CU-18.1), archivos a tocar, migraciones, cambios de contrato permitidos por ADR, tests a escribir primero (nombre + qué prueban), comandos de verificación, criterio de "hecho", riesgos y qué conservar del "Por qué". Grafo de dependencias, grupos paralelizables y estimación por paso.
3. Gate adversarial del skill `blueprint` sobre el plan (busca: faltante de la auditoría sin dueño, dependencia circular, cambio de contrato no aditivo, regresión de algo listado en "Por qué").
4. Commit en rama `feat/cierre-auditoria-cu` (solo docs). NO push.

## Temas y dependencias propuestas (corrígelas si el código dice otra cosa)
- Cadena A: T1 Curso + `course_id` (CU-39, 40, 41.1) → T2 draft/published + publicación local (cierra "separar edición de publicación" en CU-13, 14, 15, 16, 17, 18, 19, 20, 21, 22.1, 36.1, 39.3, 40.3) → T10 catálogo remoto (CU-34, 36.2-3, 37, 38, 41).
- Cadena B: T3 requisitos de lección + regla única de disponibilidad (CU-02.2-5, 03, 12, 29.1, 38.1) → T4 taller (CU-28, 02.1) → T5 Autoría UX (CU-13.1, 13.3, 14.1, 14.3, 15.1, 16.1-2, 17.1-4, 18.1-5, 19.1-3, 20.1, 21.1-3, 22.2; nota: `PUT /admin/lessons/{id}` reemplaza completo → es la causa de CU-18.1/19.2).
- Independientes (paralelizables en worktrees; Docker es compartido): T6 simulador (CU-04, 05, 06, 22.3, 32), T7 en vivo/cancelación/resultados/descarga (CU-07, 08, 09, 10), T8 sandbox/recuperación/salud (CU-24, 25, 26), T9 escritorio (CU-27), T11 comparar/exportar (CU-30, 31), T12 CLI contenido base (CU-23), T13 catálogo del estudiante (CU-01, 29.2).
- Cierre: T14 alinear `docs/casos-de-uso.md` a los 41 CU (reescribir mapa e índice; conservar el detalle de flujos que siga vigente) y marcar estados finales en la auditoría.

## Restricciones de entorno (no obvias)
- Node 22 vía nvm en cada shell: `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"`. npm/builds en ext4 (`~/.telar-build/<pkg>/`), nunca en `/mnt/d`. `make` no existe: `docker compose` directo.
- Docker y `~/.ehpc-verify/e2e` son compartidos con otros jobs: nunca borrar contenedores por filtro ni asumir que toda la suite e2e es tuya. Las dos suites e2e van separadas; `leccion.spec` exige preparación manual.
- No push a origin; merges a `main` solo locales.
```

---

## Plantilla — Sesión por tema Tn

```
# Sesión Tn — <nombre del tema>

Ejecuta el paso Tn de `telar/docs/audits/blueprint-cierre-cu.md`. Lee su brief completo, los ADR que cita (`telar/docs/architecture/adr/`) y SOLO las secciones de `telar/docs/audits/auditoria-cu-2026-09-18.md` de los CU <lista>. Lee `telar/CLAUDE.md` y el `CLAUDE.md` de cada paquete que toques.

## Alcance exacto
- Cierra los faltantes: <CU-xx.n, CU-yy.m, ...>.
- Conserva TODO lo descrito en "Por qué" de esos CU: es comportamiento vigente. Si no tiene test de regresión, escríbelo antes de tocar el código.
- Fuera de alcance: <faltantes que pertenecen a otros temas>. No los arregles "de paso"; anótalos.

## Reglas del repo que aplican
- Contratos: solo cambios aditivos autorizados por <ADR-00x>, contract-first (doc → `backend/app/schemas/*` → `frontend/src/api/types.ts` / `ws/messages.ts` / `types/telar.d.ts`, mismo commit; `npm run check:contract` en desktop si tocas `window.telar`).
- Backend: repository pattern con firmas de `data-model.md` §5; toda escritura dentro de `write_lock`; `docker_service` es la única frontera con Docker (tests con `FakeRunner`); un solo worker uvicorn (registro de jobs en memoria).
- Frontend: feature-first; `EmptyState`/`ErrorState`/`Skeleton` son la única forma de estados vacío/carga/error; gráficas SVG a mano (sin librerías); `progressStore` es caché de `GET /modules`; HashRouter; textos en español.
- Migraciones SQLite: numeradas e idempotentes (patrón de `tests/test_migration5.py`), conservan progreso, intentos de quiz y jobs; una base existente debe abrir y funcionar.

## Método (TDD obligatorio)
1. `/plan` corto: archivos, migración, cambio de contrato. Continúa sin esperar confirmación salvo que el plan difiera del brief del blueprint.
2. RED: tests primero. Backend `cd backend && DOCKER_HOST=tcp://127.0.0.1:1 pytest tests/<área> -x`; frontend `cd frontend && npx vitest run <área>`; e2e Playwright solo para los flujos que el brief marque.
3. GREEN + refactor.
4. `/code-review` con `python-reviewer` / `typescript-reviewer` según capa; `security-reviewer` si tocas sandbox, cancelación, catálogo remoto o validación de filenames.
5. Verificación completa antes de cerrar: backend `pytest --cov=app --cov-fail-under=80`; frontend `npx tsc --noEmit && npm run build && npx vitest run --coverage`; desktop `npm run typecheck && npm run build && npm run check:contract` si lo tocaste.
6. Commits conventional en español, uno por faltante o grupo coherente, en rama `feat/cierre-cu-Tn` creada desde `feat/cierre-auditoria-cu`. NO push.

## Cierre de la sesión
- En `auditoria-cu-2026-09-18.md`, marca cada faltante cerrado con `✅ <hash>`. Cambia el estado del CU a 🟢 solo si no le queda ningún faltante (si depende de otro tema, anota "pendiente Tm").
- Resumen final: faltantes cerrados / pendientes con motivo, tests añadidos, cambios de contrato aplicados.
- Si algo bloquea, termina el resto y repórtalo con el motivo. No reduzcas el alcance en silencio.
```

### Ejemplo relleno — T7 (buen primer tema: sin dependencias)

```
# Sesión T7 — Ejecución en vivo, cancelación, resultados y descarga

Ejecuta el paso T7 de `telar/docs/audits/blueprint-cierre-cu.md`. Lee su brief, los ADR que cita y SOLO las secciones CU-07, CU-08, CU-09 y CU-10 de `telar/docs/audits/auditoria-cu-2026-09-18.md`. Lee `telar/CLAUDE.md`, `telar/backend/CLAUDE.md` y `telar/frontend/CLAUDE.md`.

## Alcance exacto
- CU-07.1 fase "Ejecutando" por evento real del runner (no por primer print); 07.2 flush de stdout sin `\n`; 07.3 al reconectar, recuperar todo lo disponible del ring-buffer o marcar hueco explícito (`seq` faltante → aviso en terminal); 07.4 tiempo desde `started_at` real; 07.5 detalle por hilo etiquetado como ilustrativo.
- CU-08.1 cancel no pisa un job ya terminal (guard existente `status NOT IN terminales` + comprobar orden de eventos); 08.2 y 08.5 UI: si el WS está caído, no cerrar el modal como éxito; mostrar "No fue posible solicitar la cancelación. La ejecución puede continuar activa." y permitir reintentar; 08.3 distinguir detenido / ya terminado / no pudo detenerse (propagar error de Docker); 08.4 solo emitir estado terminal a la UI después de persistir en SQLite.
- CU-09.1 mostrar timeout configurado y origen del código; 09.2 stderr completo + causa registrada para failed/cancelled/timeout; 09.3 métricas ausentes = `null` → "—", nunca 0; 09.4 renombrar "Hilos (PIDs)" a lo que mide (tareas del contenedor).
- CU-10.1 descarga con `fetch` + manejo de error + reintento; resultados siguen visibles.
- Conservar: todo lo listado en "Por qué" de CU-07..10 (reconexión, cola de cancelación, truncamiento marcado, historial).
- Fuera de alcance: exportación estructurada (T11), origen ejemplo/lección al re-ejecutar (T6).

## Reglas del repo que aplican
- Contratos: cambios aditivos autorizados por ADR-001 (p. ej. mensaje WS de fase, campos `timeout_seconds`/`source` en el detalle del job, `stderr` completo, `cancel_ack`). Contract-first, mismo commit.
- Backend: `job_runner.py` (drainer, ring-buffer+seq, `kill_reason` cancel>output_limit>timeout, orden de terminación estricto), `docker_service.py` única frontera con Docker; tests con `FakeRunner` en `tests/test_job_runner.py`, `test_ws.py`, `test_routers_jobs.py`.
- Frontend: `features/simulator`, `features/results`, `ws/`, `stores/`; `ErrorState` para el error de descarga; SVG a mano.

## Método
(idéntico a la plantilla: /plan → RED → GREEN → /code-review → verificación completa → commits en `feat/cierre-cu-T7`, sin push)

## Cierre
(idéntico a la plantilla)
```

### Ejemplo relleno — T2 (el tema transversal más grande; requiere T1 hecho)

```
# Sesión T2 — Versión de trabajo vs versión publicada del curso local

Prerrequisito: T1 fusionado en `feat/cierre-auditoria-cu`. Ejecuta el paso T2 de `telar/docs/audits/blueprint-cierre-cu.md`. Lee ADR-002 (draft/published) y ADR-003 (curso como unidad publicable) completos, y SOLO el faltante "separar edición de publicación" de CU-13.2, 14.2, 15.2, 16.3, 17.5, 18.6, 19.4, 20.2, 21.4, 22.1, 36.1, 39.3, 40.3 en la auditoría.

## Alcance exacto
- Implementar la representación elegida en ADR-002 (migración numerada; una base existente queda con published = contenido actual y draft = copia).
- Autoría (`routers/admin.py`, `admin_catalog.py`, `services/content_writer.py`, `content_state.py`) lee/escribe SOLO draft. Estudiante (`routers/modules,lessons,examples,quizzes,progress`) lee SOLO published.
- Nueva acción "Publicar" local (parte de CU-37) que promueve draft→published en una transacción dentro de `write_lock`, y expone en Autoría "hay cambios sin publicar" (diff por checksum draft vs published).
- Pruebas admin (CU-22.1) ejecutan ejemplos del draft.
- Test de aceptación obligatorio (backend, e2e si el brief lo marca): editar título A→B en Autoría, guardar, `GET /api/v1/modules` sigue devolviendo A; publicar; devuelve B.
- Conservar: import remoto (CU-36) sigue siendo transaccional; rollback de guardado (CU-14); `/aprender` sin reiniciar.
- Fuera de alcance: validación del bundle al publicar, ensayo atado a checksum y recuperación de índice (CU-37.1-4 → T10); guards de cambios sin guardar y errores por campo (T5).

## Reglas del repo que aplican
- Contratos: aditivo según ADR-001/002 (endpoint de publicación local, campo de estado de publicación en respuestas admin). Contract-first, mismo commit.
- Backend: repositorios con firmas de data-model §5 (actualizadas por ADR); `write_lock`; migración idempotente; `tests/test_admin_content.py`, `test_content.py`, `test_routers_content.py`, `test_module_update.py` deben seguir en verde o adaptarse con justificación explícita.
- Frontend: `features/admin` muestra estado "borrador con cambios" y botón Publicar; `features/learn` no cambia de contrato.

## Método y cierre
(idénticos a la plantilla; rama `feat/cierre-cu-T2`, sin push)
```

---

## Versión rápida

Para un tema ya descrito en el blueprint:

```
Ejecuta el paso Tn de telar/docs/audits/blueprint-cierre-cu.md (lee su brief, sus ADR y solo los CU que cita en telar/docs/audits/auditoria-cu-2026-09-18.md). Cierra exactamente los faltantes <CU-xx.n,...>; conserva lo listado en "Por qué". Contratos solo aditivos y contract-first (doc → schemas → types.ts/messages.ts/telar.d.ts, mismo commit). TDD: tests primero (pytest con DOCKER_HOST=tcp://127.0.0.1:1 / vitest), luego código, /code-review, y verificación completa (cov ≥80 backend, tsc+build+vitest front, check:contract si tocas desktop). Node 22 vía nvm, builds en ~/.telar-build, Docker compartido (no borres contenedores por filtro). Commits conventional en español en feat/cierre-cu-Tn; NO push. Al terminar marca cada faltante con ✅ <hash> en la auditoría y resume cerrados/pendientes con motivo. Si algo bloquea, termina el resto y repórtalo.
```

Para el blueprint sin ADRs (si prefieres que la sesión 0 decida sola):

```
Usa el skill blueprint sobre telar/docs/audits/auditoria-cu-2026-09-18.md (41 CU; su numeración manda sobre docs/casos-de-uso.md). Sin código. Produce docs/audits/blueprint-cierre-cu.md con un paso autocontenido por tema (T1 curso+course_id, T2 draft/published, T3 requisitos de lección, T4 taller, T5 Autoría UX, T6 simulador, T7 en vivo/cancelar/resultados, T8 sandbox/recuperación/salud, T9 escritorio, T10 catálogo remoto, T11 comparar/exportar, T12 CLI contenido base, T13 catálogo estudiante, T14 alinear casos-de-uso.md), grafo de dependencias y grupos paralelos. Los contratos congelados se enmiendan contract-first y solo de forma aditiva: documenta cada enmienda como ADR en docs/architecture/adr/. Commit solo docs en feat/cierre-auditoria-cu; no push.
```
