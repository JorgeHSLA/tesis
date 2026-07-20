# CHANGELOG — Rediseño visual "plataforma de curso" (2026-07-16)

Rediseño integral del look del frontend: de "revista cálida" (crema + serif Fraunces, denso)
a **plataforma de e-learning** estilo Coursera/Udemy (fondo neutro clarísimo, tarjetas blancas
flotantes, un acento naranja para CTAs, teal = progreso, mucho whitespace). Dirección aprobada
por mockup (paleta #1 "Teal de progreso + Naranja de logro") antes de tocar la app.

## Qué cambió

### Base (fundación)
- **`styles/tokens.css` reescrito** — ÚNICA fuente de color/espaciado/tipografía:
  - Escalas nuevas `--teal-*` / `--orange-*` / `--slate-*` + semánticos (`--bg`, `--surface`,
    `--surface-2`, `--border`, `--border-accent`, `--text`, `--text-muted`,
    `--text-muted-strong`, `--accent*`, `--primary*`, `--ring`, `--success*`, `--warn*`,
    `--danger*`).
  - Tokens de gráficas `--viz-*` (observed/ideal/grid/axis/label/cpu/mem/node/master/packet)
    y de terminal `--term-*` (bg/head/border/text/dim/accent) — los SVG y el terminal ya no
    hardcodean color.
  - Espaciado 4/8pt: `--sp-1..--sp-10` + semánticos `--screen-pad-x/y`, `--section-gap` (44px),
    `--card-pad` (24px), `--grid-gap` (18px). Radios `--r-sm..--r-xl` (8/12/16/20). Sombras
    suaves de "tarjeta que flota" + `--shadow-cta`.
  - **v2 "compacto"** (antes "local app"): misma paleta, densidad reducida vía tokens.
    **Dark** queda definido y armonizado, sin toggle (igual que antes).
- **Fuentes**: `@fontsource/ibm-plex-sans` 400/500/600/700 (UI) + `@fontsource/jetbrains-mono`
  (datos/código/terminal). Fraunces e Instrument Sans **retiradas** de package.json y main.tsx.
  Self-hosted, cero requests de red (verificado en runtime: 0 requests externas en 3 rutas).
- **`base.css`**: display-xl/lg/md ahora IBM Plex Sans 700/600 (la jerarquía la dan tamaño y
  peso, no un cambio de familia); `.eyebrow` sans 600 uppercase teal (antes mono naranja);
  `.mono-small` 12px con `tabular-nums`; focus ring `--ring`; `prefers-reduced-motion` global
  intacto.

### Pantallas y componentes (migración completa a tokens)
- `components.css`: botones (CTA naranja con sombra y hover -1px; outline/ghost limpios),
  cards blancas `--r-lg` + `--shadow-md` con icon-tiles teal en el head, MetricCard como
  "stat tile" aireado (valor 30px/700 tabular), chips pill por tono (soft + ink), sidebar/topbar
  claros con item activo teal + barra indicadora, inputs con focus teal, Terminal a familia
  slate `--term-*`, skeleton/empty/error suaves.
- `home.css` + `catalog.css`: hero como tarjeta blanca (sin degradado cálido) con chip teal,
  pasos y qcards blancas aireadas (acentos green/blue convergidos a teal — un solo acento
  fuerte), listas con hover suave y tiles de 34px; catálogo con ContinueCard destacada,
  stats como tiles, progreso y filtros teal.
- `learn.css` + `results.css`: CodeShowcase sobre `--term-bg`, sidebar tipo playlist (actual
  teal, completada check, pendiente neutral), markdown con medida 70ch y line-height 1.68,
  quiz con opciones como cards seleccionables; resultados con observaciones en cards suaves
  (`--warn-soft`/`--primary-soft`) y tabla del historial aireada.
- `simulator.css` + `admin.css`: dropzone/casos activos en patrón teal, topología sobre blanco
  limpio, banners semánticos (`threads-note` teal suave, errores danger-soft), tablas con th
  sans 600 uppercase y `tabular-nums`; admin con la misma familia visual (login card, CTAs
  naranja, avisos como chips).
- **Gráficas SVG a mano "de-junkeadas"** (sin librerías, API/textos/aria intactos):
  SpeedupChart con 3 líneas de grid sólidas (antes 5 punteadas), ideal punteado slate,
  observado naranja 2.4px con **área suave** y último punto enfatizado; ComparisonBars/
  LiveMetricsChart/Sparkline en teal/naranja de los tokens; topologías (Home/Live/Thread)
  con rombos teal planos (fuera gradientes verdes), pulsos naranja.
- TSX tocados solo para color/limpieza: viz/*, NodeDiamond, MiniBar, Terminal, StatusChip,
  SweepProgressCard, ThreadsTable, QuizRunner (inline colors → tokens), TopBar (labels del
  switcher: `v1 · curso` / `v2 · compacto`).

### Accesibilidad (verificada, no solo declarada)
- **Contraste AA**: auditoría automatizada sobre páginas renderizadas (todos los nodos de
  texto visibles, 4 rutas) → **0 fallos**. Fixes destacables:
  - `--accent: #CC4A0B` elegido por cálculo (el mockup proponía `#EA580C`, 3.56:1): da
    4.61:1 con blanco en ambos sentidos (fondo de CTA y texto naranja sobre blanco); el
    `#EA580C` queda en la escala como naranja UI/decorativo (≥ 3:1).
  - Token nuevo `--text-muted-strong` (slate-600) para texto secundario sobre superficies
    teñidas (`--surface-2`, `*-soft`), donde `--text-muted` solo daba 4.1–4.3:1.
  - Fondos con texto blanco pasan de `--primary` (3.74:1) a `--primary-ink`/`--success-ink`
    (5.47:1): fpill activa, num-badges, brand mark (naranja del mockup, 4.61:1).
  - Terminal: `--term-dim` 5.54:1; gráfica: `--viz-ideal` 3.45:1 (≥3:1 para UI).
- `prefers-reduced-motion`: verificado en runtime (emulación `reduce` → 0 animaciones activas).

## Qué NO cambió (invariantes)
- Contratos congelados intactos: `api/types.ts`, `api/admin-types.ts`, `ws/messages.ts`,
  `types/ehpc.d.ts`, `schemas.py`, `docs/architecture/api-contract.md`.
- Semántica accesible EXACTA (roles, textos, aria-labels): la suite E2E de 15 tests pasa
  **sin modificar un solo assert**.
- Gráficas SVG a mano (cero librerías), HashRouter + `base:'./'`, theming `data-variant`,
  EmptyState/ErrorState/Skeleton como únicos estados, progreso = servidor.

## Verificación (todo verde)
| Gate | Resultado |
|---|---|
| `tsc --noEmit` | limpio |
| Vitest | 206/206 |
| E2E Playwright (stack Docker real) | **15/15** |
| Contraste AA renderizado (4 rutas) | 0 fallos |
| Requests externas (fonts/CSP) | 0 |
| `prefers-reduced-motion` | animaciones suprimidas |
| Electron (xvfb + Playwright `_electron`, carga por `file://`) | OK — título, h1, `window.ehpc`, Plex cargada, 0 errores de consola (primera verificación gráfica real del proyecto) |
| Vars CSS sin definir / restos de paleta vieja | 0 (grep + cross-check usadas vs definidas) |

Capturas: "antes" en `~/.ehpc-verify/e2e/artifacts/shots-before-redesign/`, "después"
regeneradas por la suite en `~/.ehpc-verify/e2e/artifacts/shots/`.

## Proceso
Mockup (3 pantallas, 3 paletas conmutables) → aprobación de paleta #1 → tokens.css + fuentes
(lead) → workflow de 5 agentes con propiedad exclusiva de archivos (components / home+catalog /
learn+results / simulator+admin / viz-TSX) → barrido de restos → verificación central →
auditoría AA renderizada con fixes → E2E final.

---

# Refactor de la lección — feedback de usuario (2026-07-20)

Seis ajustes concretos sobre la pantalla de lección (`/#/cursos/:leccionId`) tras revisión
del usuario, más el cierre del sistema de variantes. **Solo capa visual/UI**: contratos
congelados (`api/types.ts`, `ws/messages.ts`, `ehpc.d.ts`, `schemas.py`) intactos.

## Qué cambió
1. **Switch v1/v2 retirado; app fija en v2.** `TopBar.tsx` sin el `variant-switch`;
   `themeStore.ts` pasó de store zustand persistido a módulo plano (`FIXED_VARIANT`/
   `applyFixedVariant`) que siempre aplica `data-variant="v2"` e **ignora un `'v1'` heredado**
   en localStorage. `index.html` → `data-variant="v2"`. CSS `.variant-switch`/`.vs-btn`
   eliminado. **Auditoría v2:** el hero de Home recuperó su diagrama fork-join (los overrides
   `[data-variant="v2"]` lo ocultaban en v2 y dejaban medio hero vacío).
2. **Responsive — sin hueco muerto a la derecha.** `.screen.learn` ensanchado (max-width
   1680px); `.learn-grid` a **una columna por defecto** (contenido a ancho completo), dos
   columnas solo con el drawer abierto. `.code-screen` con `max-height` para no gigantizar a
   ancho completo.
3. **Descripción colapsada por defecto** (`LessonInfo` `useState(false)`); conserva
   `aria-expanded` y labels (de lo que dependen los E2E).
4. **"Recomendado para ti" eliminado** del render de la lección (en un path de aprendizaje la
   recomendación es la siguiente lección, ya cubierta por "Siguiente"). El componente queda sin
   uso.
5. **Panel "módulo + progreso" como drawer a la derecha, OCULTO por defecto**, con botón
   toggle (`aria-expanded`/`aria-controls`, chevron animado, entrada suave respetando
   `prefers-reduced-motion`), estado persistido en `localStorage['ehpc-learn-side']`. Al
   ocultarse, el contenido ocupa el ancho completo.
6. **Botones neutros con subtono azul claro** (tokens `--btn-neutral-*` ~ `#EEF4FF`) en
   `.btn`/`.btn-outline`; texto slate oscuro (contraste AA holgado). Los CTA (`.btn-primary`/
   `.btn-accent`) siguen naranja. Equivalentes dark definidos.

## Verificación
| Check | Resultado |
| --- | --- |
| `tsc --noEmit` | limpio |
| `vitest run` | **224/224** (26 archivos; +3 `LessonInfo.test.tsx`, `themeStore.test.ts` reescrito) |
| `npm run build` (web + Electron) | OK; dist con `data-variant="v2"` |
| E2E Playwright (stack Docker real) | **15/15** (`b-learn` B1/B4 y `d-admin` ADM5 expanden la descripción vía helper `LearnPage.expandDescription`; `c-home` sigue viendo el diagrama fork-join) |
| Capturas 1440/768 (Home, lección, drawer abierto, descripción) | OK |
| Code review (typescript-reviewer) | HIGH (guard localStorage en `readSidePref`) + MEDIUM (skeleton refleja drawer, test de colapso) aplicados |

## Video de la lección (queja #3, frontend-only)

El bloque grande de la lección deja de ser el preview de código y pasa a ser un
**reproductor de video** (`LessonMedia`, sustituye a `CodeShowcase`). Se resolvió
en **frontend, sin tocar contratos congelados**.

- **Dos formas de fuente** (`src/features/learn/lessonVideos.ts`, keyed por
  `example_id`): (1) **URL externa** con esquema (`https://…`); (2) **.mp4 en
  disco** — ruta relativa a `public/` (bundleada en `dist/`), servida por nginx
  en web y por `file://` en Electron. `resolveVideoSrc` devuelve la URL tal cual
  o resuelve la ruta contra `BASE_URL` (base `./`). El `.mp4` se coloca en
  `frontend/public/media/videos/` y se referencia desde el mapa.
- **Placeholder "Video próximamente"** cuando la lección no tiene fuente (el mapa
  arranca vacío → todas las lecciones lo muestran hasta que haya videos).
- **CTA secundario chico** "Ejecutar en el simulador" debajo del reproductor →
  `/simulador?ejemplo=<exampleId>`. El CTA primario naranja "Probar en el
  simulador" sigue **intacto** en `LessonInfo` (lo usa el E2E B4).
- **Reproductor**: `<video controls preload="metadata" playsInline>`, **sin
  autoplay** (nunca con sonido), `aria-label`, marco 16:9 que llena el ancho
  (letterbox). Captions (`<track>`, WCAG 1.2.2) quedan como TODO para cuando haya
  videos reales (el valor del mapa puede evolucionar sin tocar contratos).
- `highlightDirectives` (tab "Código") se extrajo a `codeHighlight.tsx` al
  eliminar `CodeShowcase`.

Verificación: `tsc` limpio, **vitest 232/232** (+`LessonMedia.test.tsx`: resolver
+ placeholder/video/CTA/navegación), build OK (`media/` en `dist/`), **E2E 16/16**
(nuevo `b-learn` B5: placeholder + CTA al simulador). Review typescript-reviewer:
sin CRITICAL/HIGH; MEDIUM aplicados (footgun del doble slash, aserciones de
atributos del `<video>` y de navegación del CTA, nota de captions).
