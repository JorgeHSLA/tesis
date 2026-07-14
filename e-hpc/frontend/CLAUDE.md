# frontend/ — React 18 + Vite + TypeScript

El MISMO build sirve para web (nginx) y para Electron. Spec de diseño pixel-perfect en `../docs/architecture/frontend-spec.md` y `../docs/analysis/handoff-design.md`.

## Ejecutar / testear (SIEMPRE en ext4 si /mnt/d va lento)

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"   # Node 22 (v18 falla: EBADENGINE)
npm ci
npx tsc --noEmit && npm run build
npx vitest run --coverage           # ≥80% en src/ws, src/stores, src/lib, src/hooks
```

## Convenciones

- **`base: './'` + HashRouter** (no BrowserRouter): imprescindible para que Electron cargue por `file://`. La URL del API se resuelve en **runtime** en `src/config.ts` (`window.ehpc`/`file:` → `localhost:8000`; web → mismo origen). No hardcodear.
- **Detección de plataforma**: `window.ehpc` existe solo en Electron (hook `usePlatform`).
- **Theming por `data-variant`** en `<html>` (v1 cálido / v2 app), persistido en localStorage. Selectores `[data-variant="v2"] .x` (NO `.v2 .x`).
- **Gráficas SVG a mano, SIN librerías** (recharts/d3/etc. prohibidas — es un criterio verificado): `components/viz/*` (SpeedupChart, ComparisonBars, Sparkline, LiveTopology, HomeThreadsDiagram). Colores exactos del handoff §1.6.
- **Tokens pixel-perfect** del handoff (`styles/tokens.css`), fuentes self-hosted `@fontsource` (cero requests de red), 29 iconos portados literales.
- **Accesibilidad + motion**: `prefers-reduced-motion` respetado en toda animación decorativa; `EmptyState`/`ErrorState`/`Skeleton` son la única forma de estados vacío/carga/error.
- **Estructura feature-first**: `features/{home,catalog,learn,simulator,results}`, `components/{ui,shell,icons,viz}`, `stores/` (Zustand), `hooks/`, `ws/`, `api/`, `lib/`.
- **Progreso = servidor**: `progressStore` es caché de `GET /modules`; solo `lastLessonId`/tema/sidebar en localStorage. Quiz: modelo servidor (las respuestas correctas jamás viajan antes del intento).

## CONGELADO (no editar — el back se adapta al contrato, no al revés)

- `src/api/types.ts`, `src/ws/messages.ts` — transcripción de `api-contract.md` (snake_case, envelope `{success,data,error,meta}`, 8 fases del job).
- `src/types/ehpc.d.ts` — contrato `window.ehpc`, **byte-idéntico** a `desktop/types/ehpc-api.d.ts` (hay un check de igualdad).
