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
