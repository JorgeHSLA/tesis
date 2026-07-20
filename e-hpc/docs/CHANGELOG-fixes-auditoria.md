# CHANGELOG — Fixes de la auditoría de lógica de negocio

Correcciones derivadas de [`audits/business-logic-audit.md`](audits/business-logic-audit.md),
aplicadas por sesiones de alcance cerrado. Cada entrada referencia el hallazgo
(BL-nn) de la auditoría.

## Sesión 1 (2026-07-19) — Hotfix del desktop empaquetado · rama `fix/auditoria-s1-desktop`

Regresión crítica: el compose empaquetado del desktop
(`desktop/resources/compose/compose.yaml`) reintrodujo dos bugs de infra ya
corregidos en el compose raíz y marcados como "no re-introducir" en
`CLAUDE.md`.

### BL-02 (critical) — volumen `ehpc_submissions` sin `name:` explícito

- **Causa:** el compose empaquetado fija `name: ehpc` como proyecto pero
  declaraba el volumen `ehpc_submissions:` sin `name:` explícito. Compose
  creaba `ehpc_ehpc_submissions` mientras el runner monta el literal de
  `EHPC_SUBMISSIONS_VOLUME` (`ehpc_submissions`) → el runner montaba un
  volumen vacío autocreado y **todos los jobs del simulador fallaban** con
  "no such file or directory" en Modo A (instalador con imágenes GHCR).
- **Fix:** `name: ehpc_submissions` en el volumen, igual que el compose raíz
  (con comentario explicando el porqué, espejo del raíz).

### BL-12 (high) — `EHPC_ALLOWED_ORIGINS` sin variantes `127.0.0.1`

- **Causa:** el compose empaquetado conservaba la lista vieja de orígenes
  (`localhost` + `null`); el navegador manda `Origin: http://127.0.0.1:8080`
  → CORS/WS bloqueados para quien abra la URL publicada en su navegador.
- **Fix:** lista igualada a la del compose raíz (variantes `localhost` y
  `127.0.0.1` para 5173 y 8080, más `null` para Electron `file://`).

### Test de paridad (nuevo) — `backend/tests/test_compose_parity.py`

6 tests que comparan los campos críticos entre `compose.yaml` raíz y
`desktop/resources/compose/compose.yaml`: `name:` explícito del volumen
`ehpc_submissions` en ambos, `EHPC_ALLOWED_ORIGINS` idéntica, y
`EHPC_SUBMISSIONS_VOLUME` idéntica entre composes **y** coincidente con el
`name:` real del volumen (paridad env↔volumen). Escrito RED contra la
regresión (TDD) y verde tras el fix: esta desincronización ya no puede volver
a pasar silenciosa.

### BL-39 (low) — spec de CSP desactualizada (**actualización deliberada de spec**)

`docs/architecture/electron-spec.md` §7.1 (CONGELADO) declaraba
`font-src 'self'`, pero el código correcto (`desktop/src/security.ts`) usa
`font-src 'self' data:` porque Vite inlinea los subsets pequeños de fuentes
@fontsource (< `assetsInlineLimit`) como `data:font/woff2` dentro del CSS —
sin `data:` la CSP los bloquea al cargar por `file://`. Se actualiza la spec
para reflejar el comportamiento correcto del código (el código NO cambia).
En la misma edición, el compose de ejemplo de §6.1 incorpora el
`name: ehpc_submissions` del fix BL-02 para no volver a documentar el compose
defectuoso.

### Verificación

- `tests/test_compose_parity.py`: RED antes del fix (3 failed), verde después
  (6 passed); revierte a rojo si se revierte el fix.
- Suite backend completa verde sin daemon Docker (`DOCKER_HOST` inválido +
  fakes), cobertura ≥ 80 % mantenida.
- `docker compose -f desktop/resources/compose/compose.yaml config` parsea
  sin errores tras el fix.
