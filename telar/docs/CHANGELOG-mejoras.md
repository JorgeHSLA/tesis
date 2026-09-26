# CHANGELOG — Mejoras de los 41 casos de uso (S1–S8)

Lo entregado entre el 2026-09-22 y el 2026-09-26 para cerrar los faltantes de la
[auditoría de casos de uso](audits/auditoria-cu-2026-09-18.md), según el plan del
[informe de evaluación de mejoras](audits/informe-evaluacion-mejoras-2026-09-22.md).
El detalle de cada ítem, con sus commits, está en la tabla §4 del informe; el
catálogo resultante, en [`casos-de-uso.md`](casos-de-uso.md).

**Resultado:** de 20 🟢 / 15 🟡 / 6 🔴 (clasificación del director) a **39 🟢 /
0 🟡 / 2 🔴?**. CU-39 y CU-40 dependen solo de que el director acepte «curso =
módulo publicable».

## Criterios que se mantuvieron en todas las sesiones

- **Siempre la opción simple** que cierra el faltante. Se descartaron tablas
  espejo, snapshots publicados, requisitos múltiples por lección y la entidad
  curso (informe §3.1, §3.2 y §3.10).
- **Contratos congelados, solo enmiendas aditivas y contract-first**, en el mismo
  commit: `api-contract.md` → `backend/app/schemas*` → `frontend/src/api/types.ts`
  / `ws/messages.ts`. `window.telar` no cambió.
- **TDD y revisión** en cada sesión; cada rama con su worktree, commits
  convencionales en español y fusión local a `main` con `--no-ff`, sin push.

## Sesiones

Los «tests nuevos» cuentan las definiciones de test añadidas en la rama
(`def test_` en el backend, `it(`/`test(` en frontend y desktop): son una
aproximación, porque no restan los que se reescribieron ni cuentan los casos
parametrizados.

### S1 — Verificación y arreglos rápidos (`feat/mejoras-s1`, a959567)

- En vivo: rótulo «Preparando · sin salida aún» para `compiling` y cronómetro
  desde el `started_at` del servidor (CU-07.1, 07.4).
- El drainer vacía cada ~100 ms aunque sigan llegando datos, y un parser que
  lanza ya no convierte un éxito en fallo (§2.3 #4, CU-24.1).
- Descarga de la salida por `fetch` → `Blob`, con error y «Reintentar»
  (CU-10.1); «Hilos (PIDs)» pasa a «Tareas del contenedor» (CU-09.4).
- `site/release.json` apunta a la v1.0.5 con sus checksums (CU-33.1, parcial).
- Tests nuevos: ≈2 backend, ≈14 frontend.

### S2 — PUT de lección, completitud por regla y disponibilidad (`feat/mejoras-s2`, e6f2ce5)

- El editor de lección conserva `video_url`, `enabled` y `completion_rule` al
  guardar o mover (CU-18.1, 19.2).
- **Diseño A de completitud**: el quiz completa solo lecciones `quiz`;
  «Marcar como leída» para `viewed`; `run` se completa con un job `completed`
  del ejemplo de la lección, y `POST /jobs` valida que el ejemplo sea el de la
  lección (CU-02.3–02.5, 03.1, 12.1, 12.2, 22.2).
- **Una sola regla de disponibilidad** (`enabled and not archived`) en
  `/modules`, `/progress`, Anterior/Siguiente, búsqueda y «Continuar/Empezar»
  (CU-01.1–01.3, 12.4, 29.1, 29.2, 38.1).
- La completitud se decide al escribir el progreso, contra la base.
- Tests nuevos: ≈20 backend, ≈28 frontend.

### S3 — UI de Autoría de lecciones completa (`feat/mejoras-s3`, 1da1177)

- Lección sin ejemplo, regla de completitud, video y «habilitada» en el editor
  (CU-17.1, 17.2); «Agregar ejemplo» (CU-18.2); «Eliminar quiz» (CU-18.3).
- Mover una lección recoloca las demás con el reorden por lotes (CU-19.1) y la
  posición solo acepta enteros ≥ 1 (CU-19.3).
- Tests nuevos: ≈32 frontend.

### S4 — Re-ejecutar, configuraciones guardadas, exportar y comparar (`feat/mejoras-s4`, ef27628)

- Re-ejecutar recupera ejemplo, lección, código, hilos y timeout, sin perder el
  parser (CU-04.1, 32.2, 32.3).
- «Mis configuraciones» en localStorage (CU-32.1).
- «Exportar JSON» con los ausentes como `null` (CU-31.1–31.3).
- Comparar ejecuciones con reglas de comparabilidad y gráfica SVG hecha a mano
  (CU-30.1–30.4).
- Tests nuevos: ≈49 frontend.

### S5 — Publicación con garantías y borrador visible, D+ (`feat/mejoras-s5`, 5aad9c7)

- Publicar valida con las reglas del importador, también en el ensayo (CU-37.1).
- **D+**: `content_hash` sin fecha ni versión y `GET …/publish/status`; el
  diálogo de Publicar detecta si hay cambios; distintivo «cambios sin publicar»
  en el dashboard; aviso de vista previa en `/aprender` del build de autoría.
  Reclasifica y cierra los 13 ítems «separar edición de publicación».
- Reintento idempotente de publicar y reconciliación del estado local
  (CU-37.3, 37.4).
- Pantalla de detalle de una publicación con índice fresco (CU-34.1, 34.2);
  actualizar revalida el índice sin caché (CU-41.2).
- Tests nuevos: ≈22 backend, ≈19 frontend.

### S6 — El taller guiado como tipo de lección (`feat/mejoras-s6`, e00b2ee)

- Migración 6: `lessons.kind`, `workshop_steps` y `workshop_step_progress`.
- Casilla «Lo hice» por paso (`PUT /progress/lessons/{id}/steps/{idx}`),
  idempotente y monótona; al marcar el último paso el taller se completa y cuenta
  en el módulo (CU-28.1–28.6).
- Vista de pasos para el estudiante, editor de pasos en Autoría y
  `bundle_format: 2` solo para bundles con talleres.
- Tests nuevos: ≈65 backend, ≈27 frontend.

### S7a — UX transversal de Autoría (`feat/mejoras-s7a`, 8e2aabc)

- Aviso único de cambios sin guardar (`useUnsavedChangesGuard`, también con
  diálogo nativo en Electron) (CU-13.1, 14.1, 17.3, 18.4, 21.2, 39.4, 40.2).
- Errores de validación junto a su campo, incluidos los 422 de pydantic, y
  validación del cliente igual a la del schema (CU-06.3, 13.3, 14.3, 17.4, 18.5,
  21.1, 21.3).
- Respuestas tardías en archivos y en el reorden de módulos (CU-05.2, 06.1,
  15.1, 22.3).
- Borrar un módulo con sus lecciones, `?cascade=true` (CU-16.1, 16.2); requisito
  visible para completar (CU-12.3); aviso real al borrar una lección (CU-20.1).
- Tests nuevos: ≈7 backend, ≈64 frontend.

### S7b — Simulador, en vivo y robustez de ejecución (`feat/mejoras-s7b`, e525b70)

- Cancelar no pisa un fin natural, propaga el fallo del kill (`503`,
  `CANCEL_FAILED`) y reintenta; «Cancelando…» y cancelar sin socket (CU-08.1,
  08.2, 08.3, 08.5).
- Métricas sin ceros inventados (CU-09.3); timeout frente a Docker caído
  (CU-24.6); limpieza de directorios sin Docker (CU-24.3, 25.1, 25.2).
- Aviso de huecos de salida y topología de hilos honesta (CU-07.3, 07.5).
- Resultados con causa, configuración y paginación (CU-09.1, 09.2, CU-11); el
  simulador sigue usable si falla `/modules` (CU-05.1, 06.2).
- Tests nuevos: ≈18 backend, ≈29 frontend.

### S7c — Salud, escritorio y CLI del contenido base (`feat/mejoras-s7c`, 88b03b7)

- `/health` y `/system` no bloquean el event loop y distinguen imagen ausente de
  no comprobada; reintento del cliente Docker (CU-26.1–26.3).
- Escritorio: «listo» = backend sano, autoarranque pendiente, aviso del runner,
  causa real y página de error con «Reintentar» (CU-27.1–27.5).
- CLI: `--check` en solo lectura, órdenes en dos fases y `--prune` que
  restablece de verdad (CU-23.1–23.3).
- Tests nuevos: ≈29 backend, ≈15 frontend.

### S7d — Resto del catálogo (`feat/mejoras-s7d`, a3745c3)

- «Retirar del catálogo» (CU-41.1) y manifiesto del autor alineado al publicar
  (§2.3 #14, #15).
- El preview de actualización anuncia el efecto real sobre el progreso
  (CU-38.3); conflicto con un módulo local visible (CU-34.3); importar con la
  versión vista (CU-36.2).
- Tests nuevos: ≈18 backend, ≈7 frontend.

### S8 — Cierre: documentación y verificación global (`feat/mejoras-s8`)

- `casos-de-uso.md` reescrito con los 41 CU, las decisiones transversales
  (taller como tipo de lección, diseño A, regla única de disponibilidad, D+,
  «curso = módulo») y las limitaciones conocidas (a26fee9). Con ello CU-02.1
  queda reclasificado a CU-28.
- Estados de los 41 CU en el informe y en la auditoría según los ✅ reales
  (ab68f55).
- `CLAUDE.md` con el estado y el número de tests; este CHANGELOG.
- Verificación completa en verde (ver abajo). Sin cambios de código.

## Rondas de revisión

| Rama | Merge | Qué cerró |
|---|---|---|
| `fix/revision-cierre` | af1aeac | Revisión de S2 y S7c: «Marcar como leída» respeta la disponibilidad; la regla de disponibilidad en SQL sale de una constante; `POST /jobs` también reintenta el cliente Docker. ≈2 tests backend. |
| `fix/revision-s5` | 89d2d76 | Revisión de S5: los diálogos de Autoría no se cierran con la operación en vuelo; el estado de publicación comprueba la identidad del bundle vigente. ≈3 backend, ≈4 frontend. |
| `fix/revision-r3` | 7f3c543 | Hallazgos menores de S3/S7b/S7d: `module_id` validado en las rutas de publicación; «Borrar módulo» no se cierra con el DELETE en vuelo; «¿Detener el job?» se descarta al perder la conexión; test de `?ejemplo=X` con `/modules` caído. ≈5 backend, ≈7 frontend. |

Además, cada sesión incluyó su propia revisión de código antes de fusionar (los
commits «revisión de SN» dentro de cada rama).

**Fuera del plan:** `fix/video-youtube` (c1464d7) — el video de YouTube de las
lecciones se reproduce en la app de escritorio: la CSP ya no se inyecta en el
iframe y se añade el `Referer` que `file://` no envía. ≈15 tests de desktop
(`npm test`).

## Verificación final (S8, 2026-09-26, sobre `main` + S8)

| Paquete | Comandos | Resultado |
|---|---|---|
| backend | `pytest --cov=app --cov-fail-under=80` (sin daemon Docker) | 1160 passed, 1 xfailed, 2 deselected; cobertura **95,43 %** |
| frontend | `npm ci` · `tsc --noEmit` (app y tests) · `vitest run` · `npm run build` | 81 archivos, **777 tests** en verde; build OK |
| desktop | `npm ci` · `typecheck` · `build` · `check:contract` · `npm test` | OK; `window.telar` idéntico en ambos lados; 15 tests |

`scripts/smoke.sh` y los E2E (Playwright) no se corrieron en S8: usan el Docker
compartido y necesitan preparación manual.

## Pendiente

- **Decisión del director:** «curso = módulo publicable» (CU-39.1, 39.2, 40.1).
- **Parcial:** QA de instalación versionada (CU-33.1).
- **Hallazgos sin cerrar del informe §2.3:** #17 (el checksum del ensayo no
  coincide con el publicado; D+ lo sortea con `content_hash`) y #25 (versiones
  internas descuadradas: `BACKEND_VERSION = "1.0.1"` y la imagen
  `telar-backend:1.0.2` del compose empaquetado frente a la app 1.0.5).
- **Limitaciones conocidas (NO HACER):** ver `casos-de-uso.md` §6.
