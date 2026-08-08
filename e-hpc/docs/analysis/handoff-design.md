# Telar — Especificación completa del handoff de diseño (Claude Design)

> **Fuente:** `/mnt/d/universidad/tesis/e-hpc-handoff/e-hpc/` (bundle exportado de claude.ai/design).
> **Objetivo:** este documento es autosuficiente — un agente puede implementar la UI en React + Vite + TS **sin leer el handoff**. Todos los valores (hex, px, ms, textos en español) son literales del prototipo.
> **Idioma de la UI:** español (`<html lang="es">`). Título del documento: `Telar — Simulador educativo de clusters`.

---

## 0. Arquitectura del prototipo y qué es código vivo vs. muerto

### 0.1 Archivos del bundle

| Archivo | Rol | ¿Se recrea en producción? |
|---|---|---|
| `project/E-HPC.html` | Entry point. Carga fuentes de Google, 3 CSS, React 18.3.1 UMD + Babel standalone, y los JSX en orden | Sí (como app Vite) |
| `project/styles.css` (519 líneas) | Tokens de diseño v1 + tema dark + shell + componentes base | Sí |
| `project/screens.css` (1281 líneas) | Estilos por pantalla + overrides `.v2` puntuales | Sí |
| `project/v2.css` (307 líneas) | Tokens y overrides del tema v2 ("local app") | Sí |
| `project/icons.jsx` | 29 iconos SVG stroke estilo Lucide + wrapper `Icon` | Sí |
| `project/shell.jsx` | `Sidebar`, `TopBar`, `NAV_ITEMS` | Sí |
| `project/app.jsx` | Root: router por estado, selector de variante, acciones del topbar | Sí |
| `project/screens/home.jsx` | Pantalla Inicio + `HomeClusterDiagram` | Sí |
| `project/screens/simulator.jsx` | Pantalla unificada Simulador (idle + live) | Sí |
| `project/screens/cluster-config.jsx` | **Pantalla legacy NO enrutada**, pero define `ClusterTopology` y `SAMPLE_CODE` que SÍ usa simulator.jsx | Solo los compartidos |
| `project/screens/running.jsx` | **Pantalla legacy NO enrutada**, pero define `MetricCard`, `MiniBar`, `NodeDiamond`, `LiveTopology`, `genLogLine` que SÍ usan simulator.jsx y results.jsx | Solo los compartidos |
| `project/screens/results.jsx` | Pantalla Resultados + `WorkDistributionChart` | Sí |
| `project/screens/catalog.jsx` | Pantalla Catálogo (ZINE) | Sí |
| `project/screens/learn.jsx` | Pantalla Lección (ZINE player) | Sí |
| `project/tweaks-panel.jsx` | Infraestructura de "edit mode" de Claude Design. **NO está incluido en E-HPC.html** (no se carga) | No (ver §12) |
| `project/uploads/*.png` | Capturas/dibujos de referencia del usuario durante el diseño | No |

### 0.2 Orden de carga en E-HPC.html (dependencias implícitas vía `window`)

```
icons.jsx → shell.jsx → screens/home.jsx → screens/cluster-config.jsx →
screens/running.jsx → screens/simulator.jsx → screens/results.jsx →
screens/catalog.jsx → screens/learn.jsx → app.jsx
```

Cada archivo exporta a `window` con `Object.assign(window, {...})`. En producción: módulos ES + imports explícitos.

### 0.3 Router y estado global (app.jsx)

- `variant: 'v1' | 'v2'` — persistido en `localStorage['telar-variant']` (default `'v1'`). Efecto: `document.documentElement.dataset.variant = variant` (habilita `:root[data-variant="v2"]` de v2.css) **y** clase en el contenedor raíz: `<div className={'app ' + variant}>` (habilita selectores `.v2 .xxx`).
- `screen: 'home' | 'simulator' | 'results' | 'catalog' | 'learn'` (default `'home'`).
- `simStatus: 'idle' | 'running' | 'finished'` (default `'idle'`).
- `mode: 'sim' | 'learn'` — se actualiza con la pantalla (`learn|catalog → 'learn'`; `simulator|results → 'sim'`) pero **nunca se renderiza** (vestigial; existe CSS `.v2 .mode-switch` sin JSX que lo use).
- `config` (estado del simulador):
  ```js
  { workers: 4, workerPct: 18, headPct: 15,
    framework: 'Slurm (sbatch)', codeFile: 'heat-diffusion-2d.py', code: null }
  ```
- `activeLesson: 'mpi-comm'` (default). `openLesson(id)` fija la lección y navega a `learn`.
- `nav(id)`: cambia pantalla y hace `document.querySelector('.main')?.scrollTo({ top: 0, behavior: 'smooth' })`.
- Al pulsar "Ver resultados" en el simulador: `setSimStatus('finished')` + `nav('results')`.

### 0.4 Títulos y breadcrumbs por pantalla (literales)

| screen | `title` (topbar) | `crumbs` |
|---|---|---|
| home | `Inicio` | `['Telar']` |
| simulator (idle) | `Simulador · Configurar` | `['Simulador', 'Configurar']` |
| simulator (running/finished) | `Simulador · En vivo` | `['Simulador', 'En vivo']` |
| results | `Resultados` | `['Simulador', 'Resultados']` |
| catalog | `Aprendizaje · Catálogo` | `['Aprendizaje', 'Catálogo']` |
| learn | `ZINE · Aprender` | `['Aprendizaje', 'Módulo', 'Lección']` |

Separador de crumbs: `' / '` (texto plano entre spans).

---

## 1. Sistema de tokens

### 1.1 Carga de fuentes (Google Fonts, en `<head>`)

```html
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap"/>
```

- **Fraunces** (display/serif): eje óptico 9..144, pesos 400/500/600. Uso dominante: peso **500** (títulos display, card-title, metric-value, topbar-title), 600 en `sidebar-brand-text`.
- **Instrument Sans** (sans): 400/500/600. Base del cuerpo.
- **JetBrains Mono** (mono): 400/500/600 (700 se usa en `sidebar-brand-mark` — el navegador lo sintetiza; en producción cargar 700 o usar 600).
- Producción recomendada: self-host con `@fontsource` (Fraunces variable opsz+wght, Instrument Sans, JetBrains Mono) para evitar dependencia de red.

Stacks (tokens):
```css
--font-sans:    'Instrument Sans', 'Inter', system-ui, -apple-system, sans-serif;
--font-display: 'Fraunces', Georgia, serif;
--font-mono:    'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, monospace;
```

Base tipográfica global (html/body/#root): `font-family: var(--font-sans); font-size: 15px; line-height: 1.5; -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;`

### 1.2 Paleta v1 (`:root` de styles.css) — "v1 · cálido"

```css
/* Naranjas */
--orange-50:  #FFF4EC;   --orange-100: #FFE4D1;   --orange-200: #FFCFA8;
--orange-300: #FFB078;   --orange-400: #FF914D;   --orange-500: #F57324;
--orange-600: #D75A12;   --orange-700: #A3430C;

/* Cremas */
--cream-50: #FDF8EE;   --cream-100: #F9EFD9;   --cream-200: #F3E3BF;

/* Tintas (marrones/negros cálidos) */
--ink-900: #1A1410;   --ink-800: #2A2219;   --ink-700: #3D3125;
--ink-600: #5C4A39;   --ink-500: #7A6549;   --ink-400: #A08B6E;

/* Verdes */
--green-500: #3F7A2E;   --green-600: #2F5E21;   --green-400: #6BA850;

/* Otros */
--red-500: #C94A2B;   --amber-500: #E8A317;   --blue-500: #2E6EA8;

/* Semánticos */
--bg: var(--cream-50);            /* #FDF8EE */
--surface: #FFFFFF;
--surface-2: var(--cream-100);    /* #F9EFD9 */
--border: #E9DFC9;
--border-strong: #D4C4A0;
--text: var(--ink-900);           /* #1A1410 */
--text-muted: var(--ink-500);     /* #7A6549 */
--accent: var(--orange-500);      /* #F57324 */
--accent-hover: var(--orange-600);/* #D75A12 */
```

### 1.3 Radios, sombras y motion (v1)

```css
--r-sm: 6px;  --r-md: 10px;  --r-lg: 14px;  --r-xl: 20px;

--shadow-sm: 0 1px 2px rgba(26,20,16,.06), 0 1px 1px rgba(26,20,16,.04);
--shadow-md: 0 6px 20px -8px rgba(26,20,16,.18), 0 2px 6px -2px rgba(26,20,16,.08);
--shadow-lg: 0 24px 48px -16px rgba(26,20,16,.22), 0 8px 16px -8px rgba(26,20,16,.12);
--shadow-inner: inset 0 1px 0 rgba(255,255,255,.6), inset 0 -1px 0 rgba(26,20,16,.04);

--ease: cubic-bezier(.2,.7,.2,1);   /* easing única de toda la app */
```

### 1.4 Tema oscuro (`[data-theme="dark"]`) — definido pero SIN toggle en el prototipo

```css
[data-theme="dark"] {
  --bg: #14100C;         --surface: #1F1913;      --surface-2: #2A2219;
  --border: #3A2E22;     --border-strong: #5C4A39;
  --text: #F9EFD9;       --text-muted: #A08B6E;
  --cream-50: #1F1913;   --cream-100: #2A2219;    --cream-200: #3A2E22;
  --orange-50: #3A2416;  --orange-100: #4F2F1A;
}
```
Nada en el JSX pone `data-theme`. Conservarlo como capacidad futura (o descartarlo con decisión explícita).

### 1.5 Tokens v2 (`:root[data-variant="v2"]` en v2.css) — "v2 · local app"

Filosofía declarada en el propio archivo: *"App local, neutra, densa. Naranja solo como acento."*

```css
--bg: #F5F3EE;        --surface: #FFFFFF;      --surface-2: #EFECE4;
--surface-3: #E6E2D7; /* definido, no usado */
--border: #DDD7C8;    --border-strong: #C5BDA8;
--text: #1A1812;      --text-muted: #6E6858;
--accent: #D75A12;    --accent-hover: #A3430C;
--accent-soft: #F5E4D4; /* definido, no usado */
--green-500: #3F7A2E; --green-soft: #E4ECD9;
--amber-500: #B17A0A; --red-500: #B84226;

--r-sm: 4px;  --r-md: 6px;  --r-lg: 10px;   /* radios más pequeños que v1 */

--shadow-sm: 0 1px 0 rgba(26,24,18,.04);
--shadow-md: 0 4px 12px -4px rgba(26,24,18,.1);
```

En v2 los títulos display cambian a `--font-sans` con weight 600 (ver §2.9 y las tablas por pantalla).

### 1.6 Colores hardcodeados (fuera de tokens) que hay que respetar

- Terminal (siempre oscuro, en ambas variantes): fondo `#14100C`, texto `#F9EFD9`, borde `#3A2E22`, header fondo `#1F1913` texto `#A08B6E`.
- Colores de texto de terminal: `.term-dim #7A6549`, `.term-green #6BA850`, `.term-orange #FF914D`, `.term-red #E85A3A`, `.term-blue #5FA8D4`, `.term-amber #E8A317`.
- Dots del header de terminal: `#E85A3A`, `#E8A317`, `#6BA850` (10px, circulares).
- Gradientes de nodos SVG: head `#3F7A2E → #2F5E21` (vertical), worker `#6BA850 → #3F7A2E`, warn `#E8A317 → #A56F0A`.
- Líneas de topología: `#D4C4A0` (== border-strong v1).
- Paquetes animados: naranja `#F57324`, verde `#6BA850`.
- Barras del gráfico de resultados: compute `#3F7A2E`, comm `#F57324`, idle `#E9DFC9` (texto `--ink-700`).
- Tags de nivel (catálogo): `principiante #E8F3E4/#4A7F3A`, `intermedio #FFF0DB/#A85A1B`, `avanzado #F5DEDE/#8F3838`.
- Tags de recomendación (learn): `intermedio #F4E4CE/#8B5A1A`, `práctica #E4F0D9/#3F7A2E`, `fundamentos #E4E8F0/#3A5B8E`.
- Badge done (catálogo): fondo `#E8F3E4`, borde `#B8DAA8`, texto `#4A7F3A`.
- Toggle iOS del tweaks panel: `#34c759` (irrelevante para producción).

### 1.7 Scrollbar global

```css
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 10px; }
::-webkit-scrollbar-thumb:hover { background: var(--ink-500); }
```

---

## 2. Componentes base (styles.css)

### 2.1 Escalas display / eyebrow

| Clase | font | size | weight | letter-spacing | line-height | v2 override |
|---|---|---|---|---|---|---|
| `.display-xl` | Fraunces | 44px | 500 | -.025em | 1.05 | sans 26px/600, ls -.015em |
| `.display-lg` | Fraunces | 30px | 500 | -.02em | 1.15 | sans 20px/600, ls -.01em |
| `.display-md` | Fraunces | 22px | 500 | -.01em | — | sans 15px/600 |
| `.eyebrow` | mono | 11px | 500 | .12em, uppercase | — color `--orange-600` | v2: color `--text-muted` |

Extra en Home v1: `.home .display-xl { font-size: 56px; }`; en v2: `.v2 .home .display-xl { font-family sans; 38px; 600 }` (definido en screens.css) — pero nota que v2.css también define 26px genérico; el de screens.css gana por especificidad en Home.

### 2.2 Botones

```css
.btn         padding 9px 14px; radius var(--r-md); font 14px/500; bg var(--surface-2);
             border 1px transparent; transition all .15s var(--ease);
.btn:hover   bg var(--cream-200);
.btn-primary bg var(--orange-500); color white;
             box-shadow: 0 1px 0 rgba(255,255,255,.3) inset, 0 -2px 0 rgba(0,0,0,.12) inset,
                         0 1px 2px rgba(214,90,18,.3);      /* look "embossed" */
.btn-primary:hover bg var(--orange-600);
.btn-ghost   bg transparent;  hover bg var(--surface-2);
.btn-outline bg var(--surface); border-color var(--border-strong); hover bg var(--surface-2);
.btn-sm      padding 6px 10px; 13px;
.btn-lg      padding 12px 20px; 15px;
.btn-xl      padding 14px 22px; 16px; weight 600; radius 12px;   /* screens.css */
```
V2: `.v2 .btn` 6px 11px/13px radius `--r-md`(6px); `.v2 .btn-lg` 8px 14px/13.5px; `.v2 .btn-primary` **negro** (`bg var(--text)`, color `var(--surface)`, sin sombra, hover `#000`); `.v2 .btn-accent` bg `--accent` hover `--accent-hover` (clase disponible, no usada en JSX); `.v2 .btn-xl` 10px 16px/14px.

### 2.3 Cards

```css
.card       bg var(--surface); border 1px var(--border); radius var(--r-lg); shadow var(--shadow-sm);
.card-pad   padding 20px;
.card-head  padding 16px 20px; border-bottom 1px var(--border); flex align-center gap 10px;
.card-title Fraunces 17px/500 ls -.01em;
.card-sub   12.5px color var(--text-muted);
```
V2: `.v2 .card` radius 10px sin sombra; `.v2 .card-head` padding 10px 14px con **fondo `--surface-2`**; `.v2 .card-title` sans 13px/600; `.v2 .card-pad` 14px.

### 2.4 Chips

```css
.chip        inline-flex gap 6px; padding 3px 9px; radius 999px; mono 11px ls .02em;
             bg var(--surface-2); color var(--text-muted); border 1px var(--border);
.chip-green  bg rgba(107,168,80,.12); color var(--green-600); border rgba(107,168,80,.3);
.chip-orange bg var(--orange-50); color var(--orange-700); border var(--orange-200);
.chip-red    bg rgba(201,74,43,.1); color var(--red-500); border rgba(201,74,43,.3);
.chip-amber  bg rgba(232,163,23,.12); color #8A5E0E; border rgba(232,163,23,.3);
.chip-blue   bg rgba(46,110,168,.1); color var(--blue-500); border rgba(46,110,168,.25);
```
V2: `.v2 .chip` padding 2px 7px, 10.5px, radius 4px, weight 500.

### 2.5 Inputs

```css
.field-label 12.5px/500 margin-bottom 6px;
.field-hint  mono 11px muted margin-top 4px;
.input,.select,.textarea  width 100%; padding 9px 12px; radius var(--r-md);
             border 1px var(--border-strong); bg var(--surface); 14px;
:focus       border-color var(--orange-400); box-shadow 0 0 0 3px rgba(245,115,36,.15);
.textarea    mono 13px; resize vertical;
input[type="range"]  width 100%; accent-color var(--orange-500);  /* slider nativo */
```

### 2.6 Terminal (compartido por simulador y resultados)

```css
.terminal        bg #14100C; color #F9EFD9; radius var(--r-lg); mono 12.5px lh 1.55;
                 border 1px #3A2E22; overflow hidden;
.terminal-header flex gap 8px; padding 10px 14px; bg #1F1913; border-bottom 1px #3A2E22;
                 11.5px color #A08B6E ls .05em;
.terminal-dot    10px círculo;
.terminal-body   padding 14px 16px; max-height 380px; overflow auto;
.term-line       white-space: pre-wrap;
```
V2: `.v2 .terminal` radius 6px; `.v2 .terminal-body` 11.5px max-height 320px.

### 2.7 Utilidades

`.row` flex gap 12 align-center · `.col` column gap 12 · `.grid` grid gap 16 · `.muted` color muted · `.mono-small` mono 11.5px muted ls .02em · `kbd` (2px 6px, borde border-strong con bottom 2px, radius 5, mono 11px).

### 2.8 Variant switcher (en el topbar)

```css
.variant-switch inline-flex; padding 2px; bg var(--surface-2); radius 7px;
                border 1px var(--border); gap 2px; margin-right 8px;
.vs-btn         padding 4px 10px; mono 11.5px/500 muted; radius 5px;
.vs-btn.active  bg var(--surface); color var(--text); shadow var(--shadow-sm);
```
Labels de los botones: `v1 · cálido` y `v2 · local app`. En producción: mantener este switcher (persistencia en localStorage) como selector de tema.

### 2.9 Regla de conmutación de variantes (crítica para implementar)

1. `<html data-variant="v2">` → activa el bloque de tokens `:root[data-variant="v2"]`.
2. `<div class="app v2">` → activa todos los selectores `.v2 .xxx` de screens.css y v2.css.
3. **Bug del prototipo:** `v2.css` declara `.v2 .app { grid-template-columns: 52px 1fr; }` pero el div raíz es `.app.v2` (no descendiente), así que esa regla **nunca aplica**; el ancho real del sidebar v2 lo termina dando la lógica de colapso (60px). En producción usar `.app.v2 { grid-template-columns: 52px 1fr; }` si se quiere la intención (sidebar rail de 52px) — verificar visualmente contra el prototipo (60px real).

---

## 3. Shell: sidebar + topbar + main

### 3.1 Grid raíz

```css
.app  display grid; grid-template-columns var(--sidebar-w, 220px) 1fr; height 100vh;
      overflow hidden; transition grid-template-columns .22s var(--ease);
.app:has(.sidebar.collapsed) { --sidebar-w: 60px; }
.app:has(.sidebar.expanded)  { --sidebar-w: 220px; }
.main overflow auto; position relative;
```

### 3.2 Sidebar — estructura exacta (shell.jsx)

Estado: `expanded` persistido en `localStorage['telar-sidebar-expanded']`; **default: colapsado** (`saved === null → false`).

Estructura DOM:
```
aside.sidebar.(expanded|collapsed)
 ├ .sidebar-brand
 │   ├ .sidebar-brand-mark        → "E"
 │   └ .sidebar-brand-textwrap
 │       ├ .sidebar-brand-text    → "Telar"
 │       └ .sidebar-brand-sub     → "v0.4 · local"
 ├ button.sidebar-toggle  (IconChevronLeft si expandido / IconChevronRight si colapsado)
 │   └ span.nav-label → "Colapsar"   (title="Colapsar menú"/"Expandir menú")
 ├ .sidebar-nav  — por sección: div.nav-section-label + botones .nav-item
 └ .sidebar-footer
     ├ span.status-dot   (verde, pulsante)
     └ .sidebar-footer-text
         ├ "Docker runtime"        (color --text, weight 500)
         └ "3 contenedores activos"
```

Items de navegación (`NAV_ITEMS`):

| Sección (label) | id | Label | Icono |
|---|---|---|---|
| `General` | home | `Inicio` | IconHome |
| `Simulador` | simulator | `Simulador` | IconCluster |
| `Simulador` | results | `Resultados` | IconResults |
| `Aprendizaje` | catalog | `Aprender (ZINE)` | IconBook |

CSS clave:
```css
.sidebar          bg var(--surface); border-right 1px var(--border); flex column;
                  padding 20px 10px; gap 4px; overflow hidden;
.sidebar.collapsed padding 20px 8px;  /* labels/section/footer-text display:none */
.sidebar-brand    flex gap 10px; padding 6px 8px 18px; border-bottom 1px var(--border); mb 12px;
.sidebar-brand-mark  32×32px; radius 8px; bg var(--orange-500); color white; mono 700 13px
                  ls -.02em; box-shadow inset 0 -3px 0 rgba(0,0,0,.15);
.sidebar-brand-text  Fraunces 20px/600 ls -.02em;
.sidebar-brand-sub   10.5px mono uppercase ls .08em muted; margin-top -2px;
.nav-section-label   mono 10.5px uppercase ls .1em muted; padding 10px 10px 4px;
.nav-item         flex gap 10px; padding 8px 10px; radius var(--r-md); 14px;
                  transition background .15s var(--ease);
.nav-item:hover   bg var(--surface-2);
.nav-item.active  bg var(--orange-50); color var(--orange-700); weight 600;
.nav-icon         18×18; color muted;  .active → color var(--orange-600);
.sidebar-footer   margin-top auto; padding 12px 10px; border-top 1px var(--border);
                  flex gap 10px; 12px muted;
.status-dot       8px círculo; bg var(--green-400); box-shadow 0 0 0 3px rgba(107,168,80,.2);
                  animation pulse 2s var(--ease) infinite;
@keyframes pulse { 50% { transform: scale(1.2); } }
```

Tooltip en colapsado (pseudo-elemento `::after` con `content: attr(data-tip)`):
posición `left: calc(100% + 10px)`, centro vertical, bg `var(--ink-800, #2a2a2a)` texto blanco, padding 5px 9px, radius 6px, 12px, sombra `0 4px 12px rgba(0,0,0,.15)`; animación de entrada opacity 0→1 + translateX(-4px)→0 en .15s var(--ease); z-index 100.

**Sidebar v2** (rail fijo, sin expandir): fondo `--surface-2`, padding 12px 8px, todo centrado; brand-mark 32×32 radius 7px **negro** (`bg var(--text)`), sin texto de marca ni labels; items 36×36 radius 7px centrados; item activo: bg `--surface` + shadow-sm + barra izquierda `::before` de 2px `--accent` (left -8px, top/bottom 6px, radius 2px); tooltip siempre visible al hover (left calc(100%+8px), bg `--text` color `--surface`, 4px 8px radius 4px, 11.5px, transition opacity .15s); footer solo el dot.

### 3.3 Topbar

```
div.topbar
 ├ .topbar-crumb   → crumbs unidos con " / "  (mono 12px muted)
 ├ .topbar-title   → título (Fraunces 18px/500 ls -.01em)
 ├ .topbar-spacer  (flex:1)
 └ actions:
     ├ .variant-switch (v1/v2, §2.8)
     ├ botón ghost sm: [IconSearch 14] "Buscar"
     ├ botón ghost sm: [IconHelp 14]
     ├ divisor vertical 1×22px bg var(--border), margin 0 4px
     └ usuario: avatar 28×28 círculo bg var(--orange-200) color var(--orange-700)
                12px/600 texto "MV"  +  span 13px "estudiante"
```
CSS: `padding 14px 28px; border-bottom 1px var(--border); bg var(--surface); position sticky; top 0; z-index 10; gap 16px`.
V2: `padding 9px 20px; bg var(--bg)`; título sans 14px/600 ls 0; crumb sans 12px.

### 3.4 Contenedor de pantalla

`.screen { padding: 28px; max-width: 1280px; }` (sin centrado). V2: `padding 20px 24px`.
`.screen-head` (cabecera compartida de pantalla): flex, `align-items flex-end`, `justify-content space-between`, gap 20px, margin-bottom 28px, padding-bottom 20px, border-bottom 1px var(--border). V2: pb 14px, mb 18px.

---

## 4. Pantalla: Home (`home.jsx`, clase `.screen.home`)

### 4.1 Layout

```
.hero (grid 1.15fr 1fr, gap 48px, padding 40px 8px 48px, border-bottom, mb 36px)
 ├ .hero-left   (eyebrow + h1 + sub + botones)
 └ .hero-right  (tarjeta con HomeClusterDiagram)
.section-head  ("Cómo funciona")
.tutorial-tabs.static  (grid 3 col, gap 10px, mb 32px)
.tutorial-callout      (banner "¿Primera vez aquí?", mb 32px)
.section-head  ("Acciones rápidas")
.quick-grid    (grid 3 col, gap 16px, mb 32px)
.two-col       (grid 1.15fr 1fr, gap 20px) → cards "Jobs recientes" y "Lecciones sugeridas"
```

**⚠ Defecto del prototipo:** screens.css empieza con `// Screen-specific styles...` (comentario JS inválido en CSS). Por la recuperación de errores CSS, el navegador **descarta la regla `.home .hero`** (el grid del hero) y también `.hero-stats` (por otro bloque huérfano, ver §14). La intención de diseño es clara (grid 2 columnas con diagrama a la derecha); implementarla y validar visualmente. En v2 el hero es 1 columna y `.hero-right` está oculto (`display:none`), padding `8px 0 20px`, mb 20px, gap 20px.

### 4.2 Textos EXACTOS del hero

- Eyebrow: `Bienvenido de vuelta`
- H1 (`.display-xl`, 56px en v1 / 38px sans en v2, con `<br/>`): `Aprende HPC` ⏎ `sin necesitar un HPC.`
- Sub (`.hero-sub`, 18px lh 1.55 muted max-width 540px; v2: 14.5px max-width 640px): `Simulamos un cluster en tu computadora con contenedores Docker. Escribe código, configura nodos, ejecútalo — y aprende por qué funciona (o por qué no).`
- Botones (row gap 10, margin-top 20):
  - `.btn.btn-primary.btn-xl` → [IconZap 18] `Empezar simulación` → nav('simulator')
  - `.btn.btn-outline.btn-xl` → [IconBook 18] `Explorar lecciones` → nav('learn')

### 4.3 Hero-right (tarjeta del diagrama, solo v1)

```css
.hero-right  bg linear-gradient(135deg, var(--orange-50) 0%, var(--cream-100) 100%);
             border 1px var(--orange-200); radius var(--r-xl); padding 24px;
             flex column justify-center; min-height 320px; overflow hidden;
.hero-right::before  dos radial-gradients decorativos:
             circle at 20% 10% rgba(245,115,36,.08)→transparent 40%,
             circle at 80% 80% rgba(63,122,46,.08)→transparent 40%;
.hero-diagram-caption  flex gap 10px; margin-top 12px; padding-top 14px;
             border-top 1px dashed var(--border-strong);
```
Caption: `<span class="chip chip-orange">MPI_Send</span>` + `<span class="mono-small">4 workers · simulando</span>`.

### 4.4 `HomeClusterDiagram` — SVG animado del hero (espec exacta)

- `<svg viewBox="0 0 440 260" width="100%" height="100%">`.
- Gradientes: `hg-head` (#3F7A2E→#2F5E21 vertical), `hg-w` (#6BA850→#3F7A2E).
- **Head node**: grupo `translate(220,60) rotate(45)` con `<rect x=-22 y=-22 w=44 h=44 rx=4 fill=url(#hg-head)>` (rombo). Label `head-node` en (220,35), mono 10px, fill `#5C4A39`, text-anchor middle.
- **Workers** (4 fijos): centros (70,180), (170,180), (270,180), (370,180); rombos 36×36 rx4 `url(#hg-w)`; labels `w0..w3` en (x, y+42) mono 10px `#5C4A39`.
- **Líneas de conexión** (una por worker): path en codo `M220 80 L220 130 L{x} 130 L{x} 175`, `stroke #D4C4A0`, width 1.5, `stroke-dasharray 3 4`, fill none.
- **Paquetes viajeros** (uno por worker): `<circle r=4 fill=#F57324>` con dos animaciones SMIL:
  - `<animate attributeName="opacity" values="0;1;1;0" dur="0.9s" repeatCount="indefinite" begin="{i*0.9}s"/>`
  - `<animateMotion dur="0.9s" repeatCount="indefinite" begin="{i*0.9}s" path="M220 80 L220 130 L{x} 130 L{x} 175"/>`
  - Efecto: un pulso naranja recorre head→worker_i secuencialmente, ciclo total 3.6s.
- El componente además corre `setInterval` de **900ms** rotando `pulse (0..3)` en estado React, pero el atributo `opacity={active?1:0}` queda anulado por el `<animate>`; en producción basta el SMIL (o replicar con CSS `offset-path`/JS RAF).

### 4.5 Tutorial "Cómo funciona"

Section-head: eyebrow `Cómo funciona`, h2 `.display-lg` `3 pasos para simular tu primer cluster` (margin-top 4). `.section-head { margin: 28px 0 16px; }`

`.tutorial-tabs.static` — grid 3 columnas gap 10px mb 32px; cada `.tut-tab.active` (los 3 llevan `active`, navegan a `simulator`):

| # | Icono | `.tut-tab-title` | `.tut-tab-short` |
|---|---|---|---|
| 01 | IconUpload | `Sube tu código` | `Arrastra un archivo y listo.` |
| 02 | IconCluster | `Configura el cluster` | `Decide cuántos workers quieres.` |
| 03 | IconPlay | `Ejecuta y aprende` | `Observa todo en vivo.` |

CSS `.tut-tab`: flex gap 10, padding 12px 14px, radius `--r-md`, transition all .15s; `.active` bg surface + border --border + shadow-sm; num mono 11px/600 (active → orange-600; v2 → --text); icon 28×28 radius 7 (active → bg orange-50 color orange-600; v2 → bg surface-2 color --accent); title 14px/600; short 12px muted ellipsis. Variante `.static`: fondo surface siempre, hover `translateY(-1px)` + shadow-md.

`.tutorial-callout` (flex gap 14, gradiente `135deg orange-50→cream-100`, border orange-200, radius r-lg, padding 14px 18px, mb 32px; v2: bg surface-2 border --border):
- Icono: `.tut-callout-icon` 36×36 radius 10 bg white color orange-600 (v2: color --accent), IconHelp 18.
- `<b>¿Primera vez aquí?</b>`
- Párrafo (13.5px muted): `Te recomendamos empezar por el tutorial en video "¿Qué es un cluster HPC?" — 8 minutos y te da todo el contexto que necesitas para entender qué estás simulando.` (el título del video en cursiva `<i>`).
- Botón primary sm: [IconPlay 12] `Ver tutorial` → nav('learn').

### 4.6 Acciones rápidas

Section-head: eyebrow `Acciones rápidas`, h2 `¿Qué quieres hacer ahora?`.

`.quick-grid` (3 col, gap 16): `QuickCard` = `<button class="qcard" data-accent="...">` con `.qcard-icon` (40×40 radius 10; icono size 22 stroke 1.75), `.qcard-title` (Fraunces 19px/500), `.qcard-desc` (13.5px muted lh 1.5, flex 1), `.qcard-cta` (13px/500 orange-600, border-top dashed, gap 4→**8 al hover**; icono IconArrowRight 14).

| accent | Icono | Título | Desc | CTA | destino |
|---|---|---|---|---|---|
| orange | IconCluster | `Configurar un cluster` | `Define head, workers y reparto de cómputo. Sube tu código para ejecutarlo.` | `Configurar` | simulator |
| green | IconPlay | `Ver cluster en vivo` | `Observa los nodos, métricas CPU/memoria y mensajes MPI en tiempo real.` | `Abrir monitor` | simulator |
| blue | IconBook | `Continuar aprendiendo` | `Retomas en: Comunicación entre workers. Te faltan 2 quizzes para completar el track.` | `Continuar` | learn |

Acentos del icono: orange → bg orange-50/color orange-600; green → bg rgba(107,168,80,.12)/color green-600; blue → bg rgba(46,110,168,.1)/color blue-500. Hover card: `translateY(-2px)` + shadow-md + border-strong (v2: sin translate, solo shadow-md). V2: qcard padding 14, icon 32×32 radius 7 bg surface-2 (color accent/green/text según data-accent), title sans 14.5/600, desc 12.5, cta color --text 12px sin borde.

### 4.7 Jobs recientes (card izquierda)

Card-head: IconClock 16 + título `Jobs recientes` + botón ghost sm `Ver todos` (→ results) alineado a la derecha.
`.recent-row`: grid `28px 1.5fr auto auto auto`, gap 12, padding 10px 14px, radius r-md, hover bg surface-2. `.recent-icon` 26×26 círculo bg surface-2 muted.

Datos (literales):

| archivo (mono 13px) | estado → icono + chip | detalle | cuándo |
|---|---|---|---|
| `heat-diffusion-2d.py` | completed → IconCheck + chip-green `OK` | `4 nodos · 2m 14s` | `hace 5 min` |
| `matmul-mpi.c` | running → IconPlay + chip-orange `EN VIVO` | `8 nodos · 0m 47s` | `ahora` |
| `pagerank-worker-test.py` | failed → IconAlert + chip-red `ERROR` | `3 nodos · 0m 12s` | `hace 1 h` |

### 4.8 Lecciones sugeridas (card derecha)

Card-head: IconBook 16 + `Lecciones sugeridas`.
`.lesson-row`: flex gap 12, padding 10px 14px, hover surface-2. `.lesson-thumb` 56×40 radius 6, gradiente `135deg orange-300→orange-500`, con `.lesson-thumb-play` 22×22 círculo blanco (rgba(255,255,255,.95)) color orange-600 con IconPlay 12. Título 13.5px/500 ellipsis + meta mono-small. Chevron derecho IconChevronRight 16 muted.

| Título | meta |
|---|---|
| `¿Qué es un cluster HPC?` | `Fundamentos · 8 min` |
| `Tu primer script de Slurm` | `Práctico · 12 min` |
| `Comunicación entre workers` | `MPI · 10 min` |

### 4.9 Código muerto en home.jsx

`TutVisualUpload` y `TutVisualCluster` están definidos pero **no se renderizan** (eran paneles del tutorial en una iteración previa; su CSS `.tutorial-panel`, `.tut-visual`, `.tut-dz`, `.tut-file-chip` sigue en screens.css). Textos por si se rescatan: dropzone `Suelta tu archivo aquí` / `.py · .c · .cpp · .sbatch`; chip de archivo `heat-diffusion-2d.py` + chip-green `listo`.

---

## 5. Pantalla: Simulador (`simulator.jsx`, clase `.screen.simulator-screen`)

Una sola pantalla con dos cuerpos según `status`: `idle` → configuración; `running|finished` → vivo. (Las pantallas legacy cluster-config.jsx y running.jsx son el mismo contenido separado; **no** enrutar).

### 5.1 Header en `idle` (`.screen-head`)

- Eyebrow: `Simulador`
- H2 display-lg: `Configura y lanza tu cluster`
- Párrafo muted (max-width 640): `Define tu topología, sube tu código y pulsa **Lanzar simulación** para ver cómo se ejecuta en vivo. Cada nodo es un contenedor Docker en tu máquina.` (negrita en "Lanzar simulación")
- Acciones: `.btn.btn-outline` `Cargar preset` · `.btn.btn-primary.btn-lg` [IconPlay 14] `Lanzar simulación` → `setStatus('running')`.

### 5.2 Header en `running/finished`

- Eyebrow: `Ejecución en vivo`
- H2: `{config.codeFile}` (default `heat-diffusion-2d.py`)
- Row (gap 8, mt 6):
  - chip-orange con dot: `<span class="status-dot" style="background:var(--orange-500)">` + texto `Finalizado` (finished) / `En pausa` (paused) / `Ejecutando`
  - mono-small: `job #a3f9c2 · {workers} workers · {framework}`
- Acciones: outline [IconPause 14] `Pausar` ⇄ [IconPlay 14] `Reanudar` (estado local `paused`; **nota:** en simulator.jsx el paused del header no detiene el tick — bug menor del prototipo; en running.jsx legacy sí lo hacía. En producción: pausar debe congelar la simulación) · outline [IconStop 14] `Detener` → status 'idle' · primary `Ver resultados` [IconArrowRight 14] → finished + nav results.

### 5.3 Cuerpo IDLE — `.config-grid` (grid 1fr 1fr, gap 20)

**Card izquierda "Tu código"** (`.card.code-upload`):
- Head: IconCode 16 + `Tu código` + card-sub a la derecha `{config.codeFile || 'sin archivo'}`.
- `.code-upload-body` (grid rows auto 1fr, gap 14, padding 16):
  - `.dropzone` (label con `<input type=file accept=".py,.c,.cpp,.f90,.sh,.sbatch" hidden>`): borde 2px dashed border-strong, radius r-md, bg cream-50, padding 24, centrado, muted; hover → borde orange-400, bg orange-50, texto orange-700. Contenido: IconUpload 22; `.dz-title` `Arrastra tu archivo aquí` (14px/500, color --text, mt 8); `.dz-sub.mono-small` `.py · .c · .cpp · .sh · .sbatch`; botón outline sm (mt 10) `O selecciónalo`.
  - Lector: `FileReader.readAsText` → guarda `codeFile` y `code` en config.
  - `.code-preview` (borde --border radius r-md, fondo #14100C): head (8px 12px, bg #1F1913, border-bottom #3A2E22, color #A08B6E, space-between) con mono-small `{codeFile}` + `chip chip-orange` `Slurm · MPI`; body `<pre>` mono 11.5px lh 1.55 color #F9EFD9, padding 12px 14px, max-height 260px, overflow auto, pre-wrap. V2: body 11px max-height 220px.

**Contenido por defecto del preview (`SAMPLE_CODE`, literal):**
```python
#!/usr/bin/env python3
# heat-diffusion-2d.py — ejemplo MPI
from mpi4py import MPI
import numpy as np

comm = MPI.COMM_WORLD
rank = comm.Get_rank()
size = comm.Get_size()

N = 512
local_N = N // size
u = np.zeros((local_N + 2, N))

for step in range(1000):
    # exchange ghost rows with neighbors
    if rank > 0:
        comm.Send(u[1], dest=rank-1)
        comm.Recv(u[0], source=rank-1)
    if rank < size - 1:
        comm.Send(u[-2], dest=rank+1)
        comm.Recv(u[-1], source=rank+1)
    # update interior
    u[1:-1] = 0.25 * (u[:-2] + u[2:] + np.roll(u[1:-1], 1, 1) + np.roll(u[1:-1], -1, 1))
```

**Card derecha "Topología del cluster"**:
- Head: IconCluster 16 + `Topología del cluster`.
- `.topology-viz` (padding 20px 20px 4px, bg `linear-gradient(180deg, var(--cream-50), transparent)`, border-bottom): componente `ClusterTopology` (ver §5.4).
- `.config-fields` (padding 20, column gap 16; v2: 14/12):
  1. Campo `Cantidad de workers` — `.field-row` (space-between baseline, mb 6) con label + mono-small `{workers} nodos`; slider `min=1 max=12`; `.field-hint`: `Más workers = más paralelismo, pero también más overhead de comunicación.`
  2. Campo `% cómputo por worker` — mono-small `{workerPct}%`; slider `min=5 max=50`.
  3. Campo `% cómputo del head` — mono-small `{headPct}%`; slider `min=5 max=40`.
  4. `.allocation-bar` (flex gap 2px, height 28px → v2 20px, radius 6 → v2 4, overflow hidden, bg surface-2, border --border, mt 8; clase `.over` si total>100 → `box-shadow 0 0 0 2px rgba(201,74,43,.3)`). Segmentos `.alloc-segment` (mono 10px blanco, min-width 24, centrado): `head` gradiente 180deg `#3F7A2E→#2F5E21` con texto `head {headPct}%`; N × `worker` gradiente `#6BA850→#3F7A2E` con texto `w{i}`; anchos = pct como % del contenedor. V2: colores planos `#3F7A2E` / `#6BA850`.
  5. Row space-between: mono-small `Asignación total` + chip con lógica: `total > 100 → chip-red`, `> 85 → chip-amber`, si no `chip-green`; texto `{total}% del host` donde `total = workerPct*workers + headPct`.

**Card "Opciones avanzadas"** (mt 20): head IconSettings 16 + `Opciones avanzadas`; `.adv-grid` grid 3 col gap 14 padding 20:

| Label | Control | Opciones/valor |
|---|---|---|
| `Framework` | select (controlado por config.framework) | `Slurm (sbatch)` · `MPI (mpirun)` · `Python · mpi4py` · `OpenMP` |
| `Imagen base` | select (no controlado) | `ubuntu:22.04 + openmpi` · `rockylinux:9 + slurm` · `python:3.11 + mpi4py` |
| `Timeout` | input text | defaultValue `10 min` |

### 5.4 `ClusterTopology` (SVG estático de configuración — cluster-config.jsx)

- `viewBox 0 0 560 200`, width 100%, height 200.
- Gradientes `tg-h` (#3F7A2E→#2F5E21) y `tg-w` (#6BA850→#3F7A2E).
- Head: rombo en (280,40), rect 40×40 rx4 rotado 45°. Label encima (y−26): `head · {headPct}%`, mono 10, `#5C4A39`.
- Workers: fila en y=140; `spacing = min(80, (560-80)/workers)`; `startX = 280 - (workers-1)*spacing/2`. **Tamaño reactivo al slider:** semi-lado `size = 14 + (workerPct/50)*8` → rect `2·size` (28px a 5% hasta ~44px a 50%), rx 3.
- Labels: `w{i}` en (x, y+34) mono 9.5 `#5C4A39`; `{workerPct}%` en (x, y+46) mono 9 `#A08B6E`.
- Conexiones en codo: `M{280} {62} L{280} {100} L{x} {100} L{x} {122}` (head+22 → wy−40 → wy−18), stroke `#D4C4A0` 1.2, dash `3 3`. Sin animación aquí.

### 5.5 Cuerpo LIVE — motor de simulación (idéntico en simulator.jsx y running.jsx legacy)

- **Tick:** `setInterval` cada **700ms**. `progress = min(100, tick*2)` (100% a los 50 ticks ≈ 35s). Al llegar a 100 se detiene el intervalo.
- **Nodos:** array de `workers+1`: índice 0 = head (`id:'head'`, cpu inicial 15, mem 20), resto `w0..w{n-1}` (cpu inicial 70+rand·20, mem 40+rand·30), `msgs: 0`, `status:'running'`.
- **Jitter por tick:** `jitter(v,j) = clamp(5..98, v + (rand-0.5)*j)`; cpu jitter 8, mem jitter 3; `msgs += round(rand*12)`.
- **Worker idle simulado:** el nodo con índice **3** del array (es decir `w2`) entra en `warning` cuando `tick > 8`: cpu decae (`jitter(cpu*0.3, 5)`), msgs congelados. *(El banner dice "w3" — inconsistencia del prototipo, ver §14.)*
- **Logs:** se apilan con `genLogLine`, cap `slice(-40)`.
- **Tiempo:** `elapsed` +1 por tick; formato `fmtTime(s) = "{floor(s*0.7/60)}m {floor((s*0.7)%60):02d}s"`. Estimado: `fmtTime(50)` = `0m 35s`.

### 5.6 LIVE — fila de métricas (`.metrics-row`: grid 4 col, gap 14, mb 20)

`MetricCard` (running.jsx): `.metric-card` flex gap 12 padding 16 card-style; `.metric-icon` 32×32 radius 8 bg orange-50 color orange-600 (v2: 28×28 radius 6 bg surface-2 color text); `.metric-label` mono 10.5 uppercase ls .08em muted; `.metric-value` Fraunces 22px/500 ls -.015em (v2: sans 18/600); hint `.mono-small`; barra opcional `.metric-progress` (height 4, bg surface-2, radius 999; fill gradiente 90deg orange-400→orange-500, `transition width .6s var(--ease)`).

| Icono | Label | Value | Hint |
|---|---|---|---|
| IconClock | `Tiempo transcurrido` | `fmtTime(elapsed)` | `de ~0m 35s estimado` |
| IconCpu | `Progreso` | `{progress}%` | (barra de progreso) |
| IconNet | `Mensajes MPI` | suma de msgs (toLocaleString) | `MPI_Send + MPI_Recv` |
| IconZap | `Speedup estimado` | `(1 + workers*0.7).toFixed(1)×` | `vs 1 nodo` |

### 5.7 LIVE — `.running-grid` (grid **1.3fr 1fr**, gap 20)

**Card izquierda "Nodos en vivo"**: head IconCluster 16 + `Nodos en vivo` + mono-small derecha `docker ps · {n} contenedores`. Contiene `LiveTopology` y condicionalmente el warn-banner.

`LiveTopology` (SVG animado, running.jsx):
- Contenedor `.live-topology`: padding 10px 16px; bg `radial-gradient(circle at 50% 0%, rgba(245,115,36,.06), transparent 60%), linear-gradient(180deg, var(--cream-50), transparent)`.
- `viewBox 0 0 800 280`, height 280. Head en (400,60); workers en y=190, `spacing = min(100, 720/n)`, centrados.
- Gradientes: `lg-h` #3F7A2E→#2F5E21; `lg-w` #6BA850→#3F7A2E; `lg-warn` #E8A317→#A56F0A.
- Conexiones codo: `M400 84 L400 140 L{x} 140 L{x} 168` (hy+24 → wy−50 → wy−22), stroke #D4C4A0 1.5 dash `3 4`.
- **Paquetes bidireccionales** (por worker NO-warning):
  - ida: `<circle r=3.5 fill=#F57324><animateMotion dur="1.8s" repeatCount="indefinite" begin="{i*0.25}s" path={elbow}/>`
  - vuelta: `<circle r=3 fill=#6BA850><animateMotion dur="1.8s" ... begin="{i*0.25+0.9}s" keyPoints="1;0" keyTimes="0;1"/>` (recorre el path al revés).
- **Halo pulsante del head:** `<circle cx=400 cy=60 r=38 fill="rgba(63,122,46,0.08)"><animate attributeName="r" values="30;42;30" dur="2s" repeatCount="indefinite"/></circle>`.
- Head: rombo 44×44 rx5 `url(#lg-h)`; texto `head` centrado (y+5) mono 10 `#F9EFD9`; encima (y−32) `{cpu}% cpu` mono 11 `#3D3125`.
- Workers: rombos 36×36 rx4, fill `url(#lg-w)` o `url(#lg-warn)` si warning; texto id dentro (y+4) mono 9 `#F9EFD9`; debajo (y+42) `{cpu}% · {msgs}` mono 10 `#3D3125`.
- Badge de warning: círculo r7 `#E8A317` en (x+16, y−16) con `!` blanco 10px bold.

**Warn banner** (aparece cuando existe algún nodo warning, es decir a partir de tick 9):
```
.warn-banner  flex align-start gap 12; margin 0 20px 18px; padding 12px 14px;
              bg rgba(232,163,23,.1); border 1px rgba(232,163,23,.35); radius r-md;
              color var(--ink-800); 13px;  icono color var(--amber-500);
              code → bg rgba(0,0,0,.05) padding 1px 5px radius 4;
```
Texto: `**Worker `w3` está idle.** Su CPU cayó por debajo del 25%. Puede ser un bug en la partición de datos — revisa el `MPI_Scatter`.` + botón sm outline `Ver en código`.
V2: bg rgba(177,122,10,.08), border rgba(177,122,10,.3), margin 0 14px 14px, 12.5px.

**Card derecha — terminal** (`.card.terminal-card` sin padding, terminal sin borde/radius):
- Header con 3 dots (#E85A3A, #E8A317, #6BA850) + texto `docker logs -f head-node --tail 40` (margin-left 8).
- Body con auto-scroll (`ref → el.scrollTop = el.scrollHeight`).
- Estado vacío: línea `term-dim`: `Iniciando contenedores...`
- Formato de línea: `<span class="term-dim">[{HH:MM:SS}]</span> <span class="term-{color}">{tag}</span> <span>{msg}</span>` (hora `toLocaleTimeString('es', {hour12:false})`).

**Generador de logs (`genLogLine(tick, w)`) — plantillas literales (elección aleatoria):**

| tag | color | msg |
|---|---|---|
| `[INFO]` | blue | `rank {0..w-1} entering MPI_Barrier` |
| `[MPI] ` | green | `MPI_Send(rank={r}, count={64·(1..8)}, dest={d})` |
| `[MPI] ` | green | `MPI_Recv(src={s}, tag={0..9}) ok` |
| `[STEP]` | amber | `iteration {tick·4} / 1000  residual={(0.01/(tick+1)).toFixed(5)}` |
| `[DOCK]` | orange | `{nodo} cpu={60..90}% mem={300..500}MB` |

### 5.8 LIVE — tabla "Detalle por nodo" (card mt 20)

Head: IconLayers 16 + `Detalle por nodo`.
Grid de columnas: `120px 180px 1fr 1fr 100px 100px`, gap 14, padding filas 10px 20px (v2: 8px 14px, 12.5px). Cabecera mono 10.5 uppercase ls .06em muted border-bottom. Fila warning: bg `rgba(232,163,23,.05)`.

Columnas (cabecera literal): `Nodo` · `Contenedor` · `CPU` · `Memoria` · `Msgs MPI` · `Estado`.

- **Nodo:** `NodeDiamond` (div 18×18 rotado 45°, radius 3; color: warn `#E8A317`, head `#2F5E21`, worker `#3F7A2E`) + id en mono.
- **Contenedor:** mono-small — head → `telar-head-01`; workers → `telar-worker-w{i}` (el código concatena `telar-worker-${n.id}` y el id ya es `w0`… → literal `telar-worker-w0`).
- **CPU:** `MiniBar` color `#3F7A2E` (warning → `#E8A317`).
- **Memoria:** `MiniBar` color `#F57324`.
- **Msgs MPI:** número mono.
- **Estado:** chip-amber `idle` o chip-green `activo`.

`MiniBar`: contenedor 18px alto (v2 14px) bg surface-2 radius 4; `.mini-bar-fill` con `transition width .6s var(--ease)`; label a la derecha dentro (`{n}%`, 10.5px color ink-800).

---

## 6. Pantalla: Resultados (`results.jsx`)

### 6.1 Header

- Eyebrow: `Job completado`
- H2: `Resultados · heat-diffusion-2d.py`
- Row: `chip chip-green` [IconCheck 12] `Exit 0 · éxito` + mono-small `job #a3f9c2 · completado en 2m 14s · {workers} workers`
- Acciones: outline [IconDownload 14] `Descargar output` · outline `Re-ejecutar` (→ simulator) · primary `Siguiente lección` [IconArrowRight 14] (→ learn).

### 6.2 Métricas (metrics-row, 4 col)

| Icono | Label | Value | Hint |
|---|---|---|---|
| IconClock | `Tiempo total` | `2m 14s` | `~{(47·workers·0.75).toFixed(0)}s en 1 nodo` (con 4 workers: `~141s en 1 nodo`) |
| IconZap | `Speedup observado` | `{(workers·0.78).toFixed(1)}×` (4 → `3.1×`) | `eficiencia 78%` |
| IconNet | `Mensajes MPI` | `14,862` | `~ 6.6k/s pico` |
| IconCpu | `CPU host promedio` | `62%` | `máx 89% en w1` |

### 6.3 `.two-col` (1.15fr 1fr, gap 20)

**Card "Distribución del trabajo"** (head: IconLayers 16): `WorkDistributionChart`
- Contenedor padding `8px 20px 20px`.
- `.legend-row` (mono 11 muted, mb 12) con `.lg-dot` 10×10 radius 2: `#3F7A2E` `Cómputo` · `#F57324` `Comunicación` (ml 14) · `#E9DFC9` `Idle` (ml 14).
- `.bar-chart` column gap 10; fila = grid `40px 1fr` gap 12; label mono `w{i}`; track flex height 26 radius 4 bg surface-2; segmentos `.bar` (mono 10px blanco, centrado, `transition width .4s var(--ease)`): compute `#3F7A2E`, comm `#F57324`, idle `#E9DFC9` (texto ink-700, solo se muestra % si >15).
- Datos demo por worker: compute `70+rand·20`, comm `20+rand·15`, idle `i===3 ? 25 : 5+rand·6` (por eso w3 destaca en idle). Anchos = valor/100.

**Card "Observaciones del simulador"** (head: IconAlert 16): `.observations` (padding 16, column gap 10). Cada `.obs` = flex gap 12, padding 12px 14px, radius r-md, borde y fondo según tipo:
- `.obs-warn` bg rgba(232,163,23,.07) borde rgba(232,163,23,.3), icono amber;
- `.obs-ok` bg rgba(107,168,80,.07) borde rgba(107,168,80,.3), icono green-600;
- `.obs-info` bg cream-50 borde --border, icono orange-600.
Tipografía interna: `b` 13.5px; `p` 13px muted margin `4px 0 8px`.

Contenido literal (workers=4):
1. **warn** [IconAlert 16] — `**w3 tuvo 24% menos carga que el resto.**` / `Tu MPI_Scatter reparte 128 filas entre 4 workers — el último recibe el resto. En clusters reales esto se nota más.` + botón sm outline `Ver sugerencia`.
2. **ok** [IconCheck 16] — `**Comunicación balanceada.**` / `Todos los workers enviaron/recibieron dentro del 10% entre sí — la topología está bien pensada.`
3. **info** [IconZap 16] — `**Speedup del 3.1× es razonable para este tamaño.**` / `La ley de Amdahl predice ~3.4× para un código con 95% paralelizable.`

### 6.4 Card "Output" (mt 20)

Head: IconTerminal 16 + `Output (stdout · últimas 12 líneas)` + botón ghost sm derecha [IconDownload 12] `log completo`. Cuerpo: padding 16 con `.terminal` dentro (sin header de dots). Líneas literales:

```
[verde] [MPI] Initialized with 4 ranks
[azul ] [head] distributing 512x512 grid...
[ámbar] [iter 100/1000] residual=1.24e-02
[ámbar] [iter 500/1000] residual=3.11e-04
[ámbar] [iter 1000/1000] residual=8.72e-06  converged ✓
[verde] [head] gathering results from workers...
[azul ] [head] writing heat_final.npy (1.02 MB)
[verde] [MPI] finalized
[dim  ] (línea vacía)
[dim  ] real    2m14.032s
[dim  ] user    8m47.122s
[dim  ] sys     0m09.441s
```

---

## 7. Pantalla: Catálogo (`catalog.jsx`, clase `.screen.catalog`)

Estado local: `filter: 'all'|'video'|'quiz'`, `query: string`, `openMod` (acordeón de un solo módulo abierto; default `'mpi'`).

### 7.1 Header (`.catalog .screen-head` con align-items flex-start)

- Eyebrow: `ZINE · Aprendizaje`; H2: `Catálogo de contenidos`
- Párrafo muted (max 620): `Todos los videos, quizzes y retos prácticos organizados por módulos. Elige por dónde empezar o continúa donde lo dejaste.`
- **Card "continuar"** a la derecha (`.catalog-continue.card`: min-width 280, padding 16px 18px, bg gradiente `135deg orange-50→surface`, borde orange-200; v2: bg surface-2 borde --border):
  - eyebrow `Continuar donde lo dejaste`
  - `.continue-title` Fraunces 19/500: `Comunicación entre workers`
  - `.continue-meta.mono-small`: [IconLayers 11] `MPI desde cero · ` [IconPlay 9] `10:14`
  - botón primary sm (mt 10): [IconPlay 13] `Reanudar` → `onOpenLesson('mpi-comm')`.

### 7.2 Stats strip (`.catalog-stats`: grid 4 col gap 14 mb 20)

`.cstat` card-like (padding 14px 16px, radius r-md); `.cstat-n` Fraunces 24/500; `.cstat-l` 12px muted mt 4. Los números se **computan** de los datos de módulos (no hardcodear): `{done}/{all}` = `9/28`, `Videos` = `23`, `Quizzes` = `5`, `Módulos` = `4`. Etiquetas literales: `Lecciones completadas`, `Videos`, `Quizzes`, `Módulos`.

### 7.3 Toolbar (`.catalog-toolbar` flex gap 14 mb 18 wrap)

- `.catalog-search` (flex 1, min-width 280, padding 10px 14px, card-like, radius r-md): IconSearch 14 + input placeholder `Buscar lección, quiz o tema...` (filtra por título, case-insensitive).
- `.catalog-filters` (gap 6) — `.fpill` píldoras (padding 8px 14px, radius 999, 13px muted, borde --border; hover color text + borde text-muted; active bg orange-600 blanco — v2: bg `var(--ink)` **variable indefinida, bug**, usar `--text`):
  - `Todo` + `.fpill-n` 28
  - [IconPlay 11] `Videos` + 23
  - [IconHelp 11] `Quizzes` + 5
  - `.fpill-n`: mono 11, padding 1px 6px, bg rgba(0,0,0,.08) radius 4 (active: rgba(255,255,255,.2)).

### 7.4 Módulos (acordeón `.catalog-modules` column gap 12) — DATOS COMPLETOS LITERALES

`.cat-module.card` (overflow hidden; `.open` → borde orange-300 + shadow-md; v2 open → borde text-muted). Cabecera `.cat-module-head` (flex gap 18, padding 18px 22px, hover surface-2; open → bg gradiente `180deg cream-50→surface` + border-bottom; v2 open → surface-2): número `.cat-module-n` (26px/500 orange-500, min-width 44; v2 muted) + info + progreso + chevron (rota 90° en .2s al abrir).

`.cat-module-title` Fraunces 19/500; `.cat-module-desc` 13.5 muted mt 4; `.cat-module-meta` (gap 10 mt 8): `.level-tag` + mono-small [IconPlay 10] duración + mono-small `{n} lecciones`. `.cat-module-progress` min-width 140 text-right: `.cat-prog-n` 15px/500 mono + barra 4px (bg --border, fill orange-500; v2 fill --accent).

**Módulo 01 — `Fundamentos de HPC`** — desc: `Qué es un cluster, head vs workers, paralelismo de datos vs tareas.` — nivel `Principiante`, `1h 12m`, progreso 80%:

| tipo | título | dur/q | done |
|---|---|---|---|
| video | `¿Qué es HPC y por qué importa?` | 8:20 | ✓ |
| video | `Anatomía de un cluster` | 10:04 | ✓ |
| video | `Paralelismo: datos vs tareas` | 11:30 | ✓ |
| video | `Speedup y ley de Amdahl` | 9:45 | ✓ |
| quiz | `Quiz: conceptos básicos` | 6 preguntas | ✓ |
| video | `Tu primer job en Telar` | 12:40 | — |

**Módulo 02 — `MPI desde cero`** — desc: `Message Passing Interface: comunicación entre procesos distribuidos.` — `Intermedio`, `1h 58m`, 45% (abierto por defecto):

| tipo | título | dur/q | estado |
|---|---|---|---|
| video | `¿Qué es MPI?` | 6:32 | done |
| video | `Hello world con MPI` | 7:18 | done |
| video | `Ranks, size y comunicadores` | 9:05 | done |
| video | `Comunicación entre workers` (id `mpi-comm`) | 10:14 | **current** |
| quiz | `Quiz: MPI_Send vs MPI_Isend` | 5 | — |
| video | `Operaciones colectivas` | 14:22 | — |
| video | `Barriers y sincronización` | 8:03 | — |
| video | `Deadlocks y cómo evitarlos` | 12:47 | — |
| quiz | `Quiz final del módulo` | 8 | — |
| video | `Proyecto: cálculo de π en paralelo` | 18:20 | — |

**Módulo 03 — `Slurm y scheduling`** — desc: `El planificador de trabajos más usado en HPC. sbatch, srun, squeue.` — `Intermedio`, `1h 34m`, 20%:

| tipo | título | dur/q |
|---|---|---|
| video | `Introducción a Slurm` (done) | 7:44 |
| video | `Tu primer sbatch` | 12:10 |
| video | `Recursos: --ntasks, --cpus, --mem` | 11:08 |
| video | `Arrays de jobs` | 9:55 |
| quiz | `Quiz: sbatch scripts` | 7 |
| video | `Prioridades y colas` | 13:22 |
| video | `Debug: cuando un job falla` | 10:18 |

**Módulo 04 — `Debugging y profiling`** — desc: `Encontrar cuellos de botella, race conditions y errores en código paralelo.` — `Avanzado`, `1h 21m`, 0%:

| tipo | título | dur/q |
|---|---|---|
| video | `Perfilar con gprof y perf` | 14:30 |
| video | `Race conditions en MPI` | 11:12 |
| video | `Load balancing visual` | 12:05 |
| quiz | `Quiz: identificar bottlenecks` | 6 |
| video | `Cuando un worker queda idle` | 9:48 |

### 7.5 Filas de lección dentro del módulo abierto

`.cat-lesson-list` padding 8px 12px 12px. `.cat-lesson` (flex gap 14, padding 12px 14px, radius r-md, hover surface-2; `.current` bg orange-50 — v2: surface-2 + `inset 3px 0 0 var(--accent)`):
- `num-badge` 26×26 círculo (surface-2 + borde --border + muted); `done` → bg #E8F3E4 borde #B8DAA8 color #4A7F3A con IconCheck 11; `current` → bg orange-500 borde orange-600 blanco; número `01..` mono-small.
- `.cat-lesson-icon` 32×32 radius 8: `video` bg orange-100 color orange-700 IconPlay 13 (v2 bg surface-2 color accent); `quiz` bg #E8F3E4 color #4A7F3A IconHelp 13.
- Título 14/500; si current añade `chip chip-orange` `En curso` (ml 8, 10px).
- Meta mono-small: `Video · {dur}` o `Quiz · {q} preguntas`; si done añade ` · Completado` con `color: var(--success)` — **variable no definida (bug)**, usar green.
- Chevron final IconChevronRight 14 muted.
- Filtro sin resultados: `.cat-empty` (padding 20, centrado, muted): `Sin resultados para este filtro.`

---

## 8. Pantalla: Learn / ZINE (`learn.jsx`, clase `.screen.learn`)

### 8.1 Header

- Botón ghost sm (mb 10, pl 6): [IconChevronLeft 14] `Volver al catálogo` → onBackToCatalog.
- Eyebrow: `ZINE · Aprender`; H2: `Comunicación entre workers`
- Row: `chip chip-orange` `MPI desde cero` · `chip` `Módulo 3 · Lección 2` · mono-small `Progreso: 4/10`
- Acciones: outline [IconChevronLeft 14] `Anterior` · primary `Siguiente` [IconChevronRight 14].

### 8.2 Layout: `.learn-grid` grid **1.5fr 1fr** gap 20

**Columna principal** (col gap 20):

**(a) Video player** (`.video-player` card):
- `.video-screen` aspect-ratio 16/9, bg #14100C, grid center. SVG ilustrativo (viewBox 200×120, posición absoluta inset 0):
  - fondo gradiente diag `vbg` #1F1913→#3D3125;
  - rombo verde 18×18 `#6BA850` en (100,35); dos rombos naranjas 16×16 `#F57324` en (60,85) y (140,85);
  - líneas `M100 50 L60 75` y `M100 50 L140 75`, stroke `#F9EFD9` width .6 dash `2 2` opacity .5;
  - texto `MPI_Send / MPI_Recv` en (100,110), mono 6px, `#F9EFD9`, opacity .7.
- Botón play central `.video-play-btn`: 72×72 (v2 56×56) círculo `rgba(255,255,255,.95)`, color orange-600, IconPlay 28, padding-left 4, sombra `0 8px 24px rgba(0,0,0,.3)`, hover `scale(1.06)` en .2s.
- `.video-controls` (padding 12px 16px): `.video-scrubber` 4px bg surface-2 radius 999 con `.video-scrubber-fill` **36%** orange-500 y `.video-scrubber-dot` 12×12 en left 36% con halo `0 0 0 4px rgba(245,115,36,.2)`. Row inferior (mt 8, space-between): izquierda botón ghost sm IconPlay 14 + mono-small `3:42 / 10:14`; derecha botones ghost sm `1×`, `CC`, `⛶`.

**(b) Card descripción colapsable**:
- `.collapse-head` (flex gap 10, padding 16px 20px, hover surface-2; chevron `.collapse-chev` rota 90° cuando `.open`, .2s): IconChevronRight 16 + h3 display-md `De qué va esta lección` + mono-small derecha `ocultar`/`mostrar`. Abierto por defecto.
- Cuerpo (card-pad, pt 0): párrafo muted: `Cuando varios workers colaboran en un cálculo, necesitan intercambiar información. En MPI las dos primitivas básicas son MPI_Send y MPI_Recv. En esta lección verás cuándo usar cada una, por qué MPI_Send puede bloquear tu programa, y cómo evitarlo con versiones no-bloqueantes (MPI_Isend).` (los nombres MPI en `<code class="mono">`).
- `.tabs` (border-bottom, margin 20px 0 18px): `Descripción` (active) · `Código ejemplo` · `Recursos` · `Transcripción`. Tab: padding 8px 14px, 13.5/500 muted, border-bottom 2px transparent (active: color text + border orange-500; v2: border --text).
- `.takeaways` (bg cream-50, borde, radius r-md, padding 16px 18px; v2 bg surface-2): `.takeaway-title` mono 10.5 uppercase ls .08em orange-600 (v2 --text): `Lo que vas a aprender`. Lista (13.5px, gap 8, IconCheck 14 verde):
  1. `La diferencia entre comunicación *point-to-point* y *colectiva*.`
  2. `Por qué MPI_Send puede causar deadlocks.`
  3. `Cuándo usar MPI_Isend/Irecv + MPI_Wait.`
  4. `Cómo depurar mensajes usando el simulador local de Telar.`
  - `code` dentro de takeaways: bg surface, 1px 5px, radius 4, borde --border.
- Row final (mt 18, gap 10): primary [IconPlay 14] `Probar en el simulador` · outline [IconDownload 14] `Slides (PDF)`.

**(c) Quiz teaser** (`.card.quiz-teaser`: gradiente `135deg orange-50→cream-100`, borde orange-200, padding 20; v2: bg `--green-soft` borde #C4D4A8):
- `.quiz-badge` 48×48 radius 12 bg white color orange-600 (v2 color green-500) con IconHelp 20.
- eyebrow `Pon a prueba`; h3 display-md `¿Listo para el quiz?`; p muted `5 preguntas rápidas sobre MPI_Send vs MPI_Isend.`
- Botón primary: `Empezar quiz` [IconArrowRight 14].

**Columna lateral** (`.col.learn-side` gap 16):

**(d) Card módulo** (`.module-card`):
- `.module-head-btn` colapsable (abierto por defecto; padding 18px 18px 14px, bg gradiente `180deg cream-50→surface`; v2 bg surface): `.module-eyebrow` mono 10.5 uppercase [IconLayers 12] `Módulo 3 · 10 lecciones`; `.module-title` Fraunces 20/500 `MPI desde cero` (v2: sans 17/600); `.module-progress-row`: barra 5px (fill gradiente orange-400→orange-500) al **45%** + mono-small `4/10`; chevron 18 rota 90° `.open`.
- `.lesson-sidebar` (padding 8, gap 1px, max-height 420, overflow-y auto). Ítems `.lesson-side` (flex gap 12, padding 10px 12px, radius 8):
  - `.current`: bg orange-50 + barra izquierda `::before` 3px orange-500 (top/bottom 8, radius 0 2 2 0); título orange-700/600. V2: bg surface-2, barra --accent, título --text.
  - `.done`: badge verde (bg green-400, blanco), título muted.
  - `.lesson-num-badge` 28×28 círculo surface-2 muted 11px/600 (current → orange-500 blanco; done → IconCheck 11).
  - Meta mono-small: [IconPlay 9] `{dur}` o [IconHelp 9] `{q} preguntas`.
  - Ítem current lleva `.now-dot` al final: 8px círculo orange-500, halo `0 0 0 3px rgba(245,115,36,.2)`, `animation pulse 2s infinite` (v2: bg --accent, halo rgba(0,0,0,.08)).

Lecciones del sidebar (9 ítems, literales): `¿Qué es MPI?` 6:32 done · `Hello world con MPI` 7:18 done · `Ranks, size y comunicadores` 9:05 done · `Comunicación entre workers` 10:14 (current) · `Quiz: MPI_Send vs MPI_Isend` 5 preguntas · `Operaciones colectivas` 14:22 · `Barriers y sincronización` 8:03 · `Deadlocks y cómo evitarlos` 12:47 · `Quiz final del módulo` 8 preguntas.

**(e) Card recomendados** (`.reco-card`): head `.reco-eyebrow` [IconBook 12] `Recomendado para ti` + `.reco-title` Fraunces 18/500 `Sigue explorando` (v2: sans 15/600). Lista `.reco-item` (flex gap 12, padding 10px 12px, radius 8, hover surface-2) con `.reco-thumb` 34×34 radius 8 blanco (video → gradiente orange-500→orange-600 IconPlay 13; challenge → gradiente #6BA850→#3F7A2E IconZap 13):

| Título | tag (`.reco-tag-*`) | meta |
|---|---|---|
| `Deadlocks clásicos en MPI` | `Intermedio` | `8 min` |
| `Simular un cluster de 16 nodos` | `Práctica` (challenge) | `Reto práctico` |
| `Slurm: tu primer sbatch` | `Fundamentos` | `12 min` |

`.reco-tag`: mono 10 uppercase ls .06em, 2px 6px radius 4 (colores §1.6; ojo con la clase generada `reco-tag-práctica`, lleva tilde).

**(f) Card progreso** (`.tracks-card` con card-pad): eyebrow `Tu progreso`; filas `.track-row` (padding 12px 0, border-bottom dashed salvo última): título 14/500 + mono-small `{p}%`; `.track-bar` 6px radius 999 fill gradiente orange-400→orange-500; mono-small `{hechas} de {n} lecciones`:

| Track | % | lecciones |
|---|---|---|
| `Fundamentos de HPC` | 80% | `5 de 6 lecciones` |
| `MPI desde cero` | 45% | `5 de 10 lecciones` (round(4.5)=5 — el texto del header dice 4/10; inconsistencia menor) |
| `Slurm y scheduling` | 20% | `1 de 7 lecciones` |

---

## 9. Iconos (`icons.jsx`) — inventario completo

Wrapper base:
```jsx
const Icon = ({ children, size = 18, stroke = 1.75, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    {children}
  </svg>
);
```

| Icono | Contenido SVG (paths literales) | Uso |
|---|---|---|
| IconHome | `M3 11l9-8 9 8` + `M5 10v10h14V10` | nav Inicio |
| IconCluster | circles (12,5)(5,19)(12,19)(19,19) r2.2 + `M12 7.5v4M12 11.5l-6.5 5.5M12 11.5l0 5.5M12 11.5l6.5 5.5` | nav Simulador, cards topología |
| IconPlay | `M6 4l14 8-14 8V4z` | play/CTA/estados running |
| IconResults | `M4 4h16v16H4z` + `M8 14v4M12 10v8M16 6v12` | nav Resultados |
| IconBook | `M4 4.5A2.5 2.5 0 0 1 6.5 2H20v16H6.5A2.5 2.5 0 0 0 4 20.5v-16z` + `M4 20.5A2.5 2.5 0 0 0 6.5 23H20` | nav Aprender, lecciones |
| IconTerminal | `M4 17l5-5-5-5` + `M12 19h8` + rect(2,3,20,18,rx2) | card Output |
| IconUpload | `M12 3v13` + `M7 8l5-5 5 5` + `M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2` | dropzone, tutorial |
| IconFile | `M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6z` + `M14 3v6h6` | chip de archivo (dead code) |
| IconCpu | rect(5,5,14,14,rx2) + rect(9,9,6,6) + pines `M9 1v4M15 1v4M9 19v4M15 19v4M1 9h4M1 15h4M19 9h4M19 15h4` | métrica Progreso/CPU |
| IconMemory | rect(3,8,18,10,rx1.5) + `M7 8V5M12 8V5M17 8V5M6 12v2M10 12v2M14 12v2M18 12v2` | **no usado** |
| IconNet | `M12 3a9 9 0 0 0 0 18M12 3a9 9 0 0 1 0 18M3 12h18` | métrica Mensajes |
| IconPause | rect(6,4,4,16) + rect(14,4,4,16) | Pausar |
| IconStop | rect(5,5,14,14,rx2) | Detener |
| IconCheck | `M4 12l5 5 11-11` | done/éxito |
| IconAlert | `M12 8v5M12 17h.01` + triángulo `M10.3 3.9L2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z` | warnings |
| IconSearch | circle(11,11,r7) + `M21 21l-4.3-4.3` | topbar, catálogo |
| IconUser | circle(12,8,r4) + `M4 21a8 8 0 0 1 16 0` | **no usado** |
| IconArrowRight | `M5 12h14M13 5l7 7-7 7` | CTAs |
| IconPlus | `M12 5v14M5 12h14` | **no usado** |
| IconDownload | `M12 3v13` + `M7 11l5 5 5-5` + base igual a Upload | descargas |
| IconClock | circle(12,12,r9) + `M12 7v5l3 2` | jobs recientes, tiempo |
| IconSettings | circle(12,12,r3) + engranaje largo (path completo en icons.jsx L31) | Opciones avanzadas |
| IconServer | rect(3,3,18,8,rx1.5) + rect(3,13,18,8,rx1.5) + `M7 7h.01M7 17h.01` | **no usado** |
| IconZap | `M13 2L4 14h7l-1 8 9-12h-7l1-8z` | speedup, retos, CTA hero |
| IconCode | `M16 18l6-6-6-6M8 6l-6 6 6 6` | card Tu código |
| IconChevronRight | `M9 6l6 6-6 6` | chevrons/acordeones |
| IconChevronLeft | `M15 6l-6 6 6 6` | volver/colapsar |
| IconHelp | circle(12,12,r9) + `M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01` | quiz, ayuda |
| IconLayers | `M12 3l9 5-9 5-9-5 9-5z` + `M3 13l9 5 9-5M3 18l9 5 9-5` | módulos, detalle por nodo |

Recomendación producción: sustituir por `lucide-react` (los diseños son deliberadamente "consistent with Lucide style") **o** portar este archivo tal cual como componentes TSX para fidelidad exacta. Para pixel-perfect: portar tal cual.

---

## 10. Inventario consolidado de animaciones y micro-interacciones

| # | Elemento | Mecanismo | Valores exactos |
|---|---|---|---|
| 1 | `@keyframes pulse` | CSS keyframe (única de la app) | `50% { transform: scale(1.2); }` |
| 2 | `.status-dot` (sidebar footer + chip de estado del simulador) | `animation: pulse 2s var(--ease) infinite` | dot 8px, halo `0 0 0 3px rgba(107,168,80,.2)` |
| 3 | `.now-dot` (lección actual) | igual pulse 2s | naranja + halo rgba(245,115,36,.2) |
| 4 | Colapso de sidebar | transition `grid-template-columns .22s var(--ease)` en `.app` + `:has()` | 220px ⇄ 60px |
| 5 | Tooltip sidebar colapsado | `::after` opacity+translateX .15s var(--ease) | translateX(-4px)→0 |
| 6 | Hero SVG (Home) | SMIL: `animate opacity "0;1;1;0" dur .9s begin i*0.9s` + `animateMotion dur .9s` por path en codo | ciclo total 3.6s, paquete r4 #F57324 |
| 7 | Live topology — paquetes ida | SMIL `animateMotion dur 1.8s begin i*0.25s` | r3.5 #F57324 |
| 8 | Live topology — paquetes vuelta | SMIL con `keyPoints="1;0" keyTimes="0;1"` begin `i*0.25+0.9s` | r3 #6BA850 |
| 9 | Live topology — halo del head | SMIL `animate r "30;42;30" dur 2s` | fill rgba(63,122,46,0.08) |
| 10 | Tick de simulación | `setInterval 700ms`; progress = tick·2; logs cap 40; jitter cpu ±4/mem ±1.5; msgs +0..12 | idle en nodo idx 3 a partir de tick 9 |
| 11 | Rotación de pulso hero (React) | `setInterval 900ms` (redundante con SMIL — omitible) | — |
| 12 | Terminal auto-scroll | ref callback `el.scrollTop = el.scrollHeight` | — |
| 13 | `.metric-progress > div` | transition `width .6s var(--ease)` | gradiente orange-400→500 |
| 14 | `.mini-bar-fill` | transition `width .6s var(--ease)` | — |
| 15 | `.bar` (chart resultados) | transition `width .4s var(--ease)` | — |
| 16 | `.qcard:hover` | `translateY(-2px)` + shadow-md + border-strong; CTA `gap 4→8px` | transition all .2s var(--ease) |
| 17 | `.tut-tab` / `.tutorial-tabs.static .tut-tab:hover` | translateY(-1px) + shadow-md | .15s |
| 18 | `.video-play-btn:hover` | `scale(1.06)` | transform .2s var(--ease) |
| 19 | Chevrons de acordeón (`.module-chev`, `.collapse-chev`, `.cat-module-chev`) | `rotate(90deg)` | transform .2s var(--ease) |
| 20 | Botones/inputs/hover genéricos | transition .15s var(--ease) (background, border, box-shadow) | — |
| 21 | Navegación entre pantallas | `.main.scrollTo({top:0, behavior:'smooth'})` | — |
| 22 | Slider de asignación | segmentos de `.allocation-bar` cambian de ancho en vivo; sin transition explícita | — |
| 23 | Tamaño de workers en ClusterTopology | reactivo al slider: semi-lado `14 + (workerPct/50)*8` | — |

Nota SMIL: `animateMotion`/`animate` funcionan en todos los navegadores modernos menos casos raros; en React+TS se pueden renderizar tal cual dentro del JSX (usar atributos camelCase `attributeName`, `keyPoints`, `keyTimes`, `repeatCount`). Alternativa equivalente: CSS `offset-path: path(...)` con keyframes de `offset-distance` (ida) y reverso (vuelta).

---

## 11. Tema v2 — resumen de diferencias visuales (checklist)

1. Tokens neutros (§1.5), radios 4/6/10, sombras planas.
2. Sidebar = rail de iconos (52px intencional / 60px real por bug §2.9), marca negra, indicador activo con barra accent de 2px, tooltips siempre.
3. Topbar compacto (9px 20px), títulos en sans.
4. Botón primary **negro**; naranja `#D75A12` reservado a acentos.
5. Display headings en Instrument Sans 600 (26/20/15) y Home 38px.
6. Cards con head gris (`--surface-2`), sin sombra.
7. Hero de Home sin diagrama (1 columna), qcards compactas.
8. Quiz teaser en verde (`--green-soft`); tabs con subrayado negro.
9. Componentes densos: métricas 12px padding, tabla 8px 14px, terminal 11.5px.
10. Existe CSS para un "mode switcher" con pestañas (`.v2 .mode-switch`, `.mode-btn`, dots sim=accent/learn=verde) que **no se renderiza** — decidir si implementarlo o eliminarlo.

---

## 12. tweaks-panel.jsx — qué es y qué conservar

- Es el **runtime de "edit mode" de Claude Design**: un panel flotante arrastrable (280px, glassmorphism `rgba(250,249,247,.78)` + `backdrop-filter blur(24px)`) con controles genéricos (`TweakSlider`, `TweakToggle`, `TweakRadio` segmentado, `TweakSelect`, `TweakText`, `TweakNumber` con scrub, `TweakColor`, `TweakButton`, `TweakSection`) y un hook `useTweaks` que persiste vía `postMessage` al host (`__edit_mode_available`, `__activate_edit_mode`, `__deactivate_edit_mode`, `__edit_mode_set_keys`, `__edit_mode_dismissed`) reescribiendo bloques `/*EDITMODE-BEGIN*/.../*EDITMODE-END*/` en disco.
- **NO está incluido en E-HPC.html** (ningún `<script>` lo carga) y **ningún componente del prototipo lo usa**. No controla el selector v1/v2 (eso lo hace `variant-switch` de app.jsx).
- **Decisión para producción: no portar.** Lo único que debe conservarse funcionalmente es:
  1. El **switcher de variantes v1/v2** del topbar (§2.8) con persistencia en `localStorage['telar-variant']`.
  2. El doble mecanismo de theming (`data-variant` en `<html>` + clase en `.app`) — o unificarlo en producción en un solo atributo `data-variant` y reescribir los selectores `.v2 ...` como `[data-variant="v2"] ...`.
- Si se quisiera un panel de dev-tweaks interno, este archivo sirve de referencia de UX, pero no es parte del diseño de Telar.

---

## 13. Inventario MPI/cluster/Slurm → adaptación a OpenMP/hilos

El prototipo está escrito alrededor de MPI + Slurm + Docker (cluster simulado). La tesis lo adaptará a **OpenMP/hilos**. Mapa término→reemplazo sugerido (mantener tono y longitud para no romper el layout):

### 13.1 Conceptos y modelo

| Actual (prototipo) | Reemplazo sugerido (OpenMP) |
|---|---|
| cluster / cluster HPC | equipo de hilos / CPU multinúcleo (o mantener "máquina virtual de práctica") |
| nodo / nodos | hilo / hilos (o núcleo/núcleos) |
| head node / `head-node` / "head" | hilo maestro (master thread) / `master` |
| worker / workers / `w0..wN` | hilo trabajador / hilos / `t0..tN` |
| contenedor Docker / `docker ps` / `3 contenedores activos` | proceso con N hilos / `omp_get_num_threads()` / `N hilos activos` (si el backend real sigue siendo Docker, mantener "Docker runtime" solo en el footer) |
| rank / ranks | thread id (`omp_get_thread_num()`) |
| size / comunicadores | número de hilos (`omp_get_num_threads()`) / equipos (teams) |
| paso de mensajes | memoria compartida |
| topología del cluster | reparto de trabajo entre hilos |

### 13.2 Primitivas y APIs

| Actual | Reemplazo |
|---|---|
| `MPI_Send` / `MPI_Recv` | escritura/lectura en memoria compartida; para el rol didáctico equivalente: `#pragma omp critical` / variables compartidas |
| `MPI_Isend` / `MPI_Irecv` + `MPI_Wait` | operaciones sin bloqueo → `#pragma omp atomic`, `nowait`, tasks + `taskwait` |
| `MPI_Barrier` | `#pragma omp barrier` |
| `MPI_Scatter` (partición de datos) | `#pragma omp for schedule(static|dynamic|guided)` (reparto de iteraciones) |
| operaciones colectivas (`MPI_Reduce`, gather) | `reduction(+:...)` / recolección al final del parallel |
| `mpirun` | `OMP_NUM_THREADS=N ./programa` |
| `mpi4py` | C/C++ con OpenMP (Python threading no da paralelismo real por el GIL) |
| `sbatch` / `srun` / `squeue` | ejecución local / (si se mantiene scheduling: políticas `schedule(...)` de OpenMP) |
| `--ntasks, --cpus, --mem` | `OMP_NUM_THREADS`, `proc_bind`, `OMP_SCHEDULE` |

### 13.3 Textos de UI concretos a cambiar (ubicación exacta)

| Pantalla · elemento | Texto actual | Sugerencia |
|---|---|---|
| Home · hero H1 | `Aprende HPC sin necesitar un HPC.` | mantener o `Aprende programación paralela sin un supercomputador.` |
| Home · hero sub | `Simulamos un cluster en tu computadora con contenedores Docker. Escribe código, configura nodos, ejecútalo…` | `Simulamos una CPU multinúcleo en tu computadora. Escribe código, configura hilos, ejecútalo…` |
| Home · caption diagrama | chip `MPI_Send` · `4 workers · simulando` | chip `omp parallel` · `4 hilos · simulando` |
| Home · qcard 1 | `Configurar un cluster` / `Define head, workers y reparto de cómputo…` | `Configurar la ejecución` / `Define hilos y reparto de trabajo…` |
| Home · qcard 2 | `…métricas CPU/memoria y mensajes MPI en tiempo real.` | `…métricas CPU/memoria y sincronizaciones en tiempo real.` |
| Home · jobs recientes | `matmul-mpi.c`, `pagerank-worker-test.py`, `{n} nodos` | `matmul-omp.c`, `pagerank-threads.c`, `{n} hilos` |
| Home · lecciones sugeridas | `¿Qué es un cluster HPC?` / `Tu primer script de Slurm` / `Comunicación entre workers` (tag `MPI`) | `¿Qué es el paralelismo?` / `Tu primer #pragma omp parallel` / `Sincronización entre hilos` (tag `OpenMP`) |
| Home · tut-steps | `Configura el cluster` / `Decide cuántos workers quieres.` | `Configura los hilos` / `Decide cuántos hilos quieres.` |
| Simulador · header idle | `Configura y lanza tu cluster` / `Define tu topología… Cada nodo es un contenedor Docker en tu máquina.` | `Configura y lanza tu ejecución` / `Define tus hilos… Cada hilo corre en un núcleo de tu máquina.` |
| Simulador · card topología | `Topología del cluster` | `Reparto de trabajo` |
| Simulador · sliders | `Cantidad de workers` / `% cómputo por worker` / `% cómputo del head` | `Cantidad de hilos` / `% trabajo por hilo` / `% trabajo del maestro` |
| Simulador · hint | `Más workers = más paralelismo, pero también más overhead de comunicación.` | `Más hilos = más paralelismo, pero también más overhead de sincronización.` |
| Simulador · framework select | `Slurm (sbatch)` / `MPI (mpirun)` / `Python · mpi4py` / `OpenMP` | dejar `OpenMP (gcc -fopenmp)` como default; valorar quitar el resto o dejar `OpenMP` + `pthreads` |
| Simulador · imagen base | `ubuntu:22.04 + openmpi` etc. | `gcc:13 + OpenMP` etc. (según backend real) |
| Simulador · chip preview | `Slurm · MPI` | `C · OpenMP` |
| Simulador · SAMPLE_CODE | heat-diffusion mpi4py | versión C/OpenMP de heat-diffusion (mismo tamaño ~22 líneas para no romper el preview) |
| Live · card head | `Nodos en vivo` / `docker ps · {n} contenedores` | `Hilos en vivo` / `{n} hilos activos` |
| Live · métricas | `Mensajes MPI` / `MPI_Send + MPI_Recv` | `Sincronizaciones` / `barriers + criticals` |
| Live · terminal título | `docker logs -f head-node --tail 40` | `./heat_omp — salida en vivo` (o el comando real del backend) |
| Live · logs genLogLine | `rank {r} entering MPI_Barrier`, `MPI_Send(...)`, `MPI_Recv(...)` | `thread {t} entering omp barrier`, `critical(sum) acquired by t{t}`, `chunk {a}-{b} → t{t}` |
| Live · warn banner | `Worker w3 está idle… revisa el MPI_Scatter.` | `Hilo t3 está idle… revisa el schedule(static) — prueba dynamic.` |
| Live · tabla | columnas `Contenedor` / `Msgs MPI`; valores `telar-head-01`, `telar-worker-w{i}` | `Núcleo` / `Syncs`; `core-0`, `core-{i}` |
| Resultados · métricas | `Mensajes MPI 14,862` | `Sincronizaciones 14,862` |
| Resultados · obs 1 | `Tu MPI_Scatter reparte 128 filas entre 4 workers…` | `Tu schedule(static) reparte 128 filas entre 4 hilos…` |
| Resultados · obs 2 | `Todos los workers enviaron/recibieron dentro del 10%…` | `Todos los hilos trabajaron dentro del 10% entre sí…` |
| Resultados · output | `[MPI] Initialized with 4 ranks` … `[MPI] finalized` | `[OMP] parallel region with 4 threads` … `[OMP] region end` |
| Catálogo · módulo 02 | `MPI desde cero` — todas sus lecciones (`¿Qué es MPI?`, `Ranks, size y comunicadores`, `Quiz: MPI_Send vs MPI_Isend`, `Deadlocks…`, `π en paralelo`) | `OpenMP desde cero` — (`¿Qué es OpenMP?`, `Threads, teams y regiones paralelas`, `Quiz: critical vs atomic`, `Race conditions…`, `π en paralelo` se mantiene) |
| Catálogo · módulo 03 | `Slurm y scheduling` + lecciones sbatch/srun | `Scheduling en OpenMP` (`static vs dynamic vs guided`, `chunk sizes`, `balanceo de carga`) o eliminar |
| Catálogo · módulo 04 | `Race conditions en MPI` | `Race conditions y data races` (encaja aún mejor con hilos) |
| Learn · header/chips | `Comunicación entre workers`, chip `MPI desde cero`, `Quiz: MPI_Send vs MPI_Isend` | `Sincronización entre hilos`, chip `OpenMP desde cero`, `Quiz: critical vs atomic` |
| Learn · descripción/takeaways | primitivas MPI_Send/Recv/Isend/Wait, deadlocks | critical/atomic/barrier/nowait, data races y deadlocks con locks |
| Learn · video SVG | texto `MPI_Send / MPI_Recv` | `#pragma omp parallel` |
| Learn · recomendados | `Deadlocks clásicos en MPI`, `Simular un cluster de 16 nodos`, `Slurm: tu primer sbatch` | `Data races clásicos`, `Ejecutar con 16 hilos`, `Schedule: static vs dynamic` |
| Sidebar footer | `Docker runtime` / `3 contenedores activos` | según backend: `Runtime local` / `8 hilos disponibles` |
| Speedup hints | `vs 1 nodo`, `~{...}s en 1 nodo` | `vs 1 hilo`, `~{...}s en 1 hilo` |

**Conceptos que se conservan sin cambio:** speedup, eficiencia, ley de Amdahl, load balancing, worker idle (→ hilo idle), profiling (gprof/perf siguen aplicando), la metáfora visual maestro-arriba/trabajadores-abajo del SVG (master/fork-join encaja perfectamente con el rombo head + rombos workers).

---

## 14. Defectos/inconsistencias del prototipo (corregir en producción)

1. **screens.css línea 1** usa comentario `//` (inválido en CSS) → el navegador descarta la regla `.home .hero` (grid 1.15fr/1fr). Implementar el grid intencional.
2. **screens.css líneas 29–34**: bloque huérfano (cola duplicada de `.hero-sub`) que además se traga la regla `.hero-stats`. `.hero-stats`/`.hstat-*`/`.hsep` no se usan en el JSX actual (código muerto de una iteración con estadísticas en el hero).
3. **v2.css `.v2 .app`** nunca aplica (el nodo es `.app.v2`, no descendiente) → usar `.app.v2` para el rail de 52px.
4. **`var(--ink)`** en `.v2 .fpill.active` no existe → usar `var(--text)`.
5. **`var(--success)`** en catalog.jsx (texto `· Completado`) no existe → definir token o usar `--green-500`.
6. **Inconsistencia w2/w3**: el nodo que entra en idle es el índice 3 del array (id `w2`), pero el banner y las observaciones hablan de `w3`. Unificar (recomendado: hacer idle a `w3` = índice 4, o parametrizar).
7. **Pausa sin efecto** en simulator.jsx: `paused` vive en el header y no congela el tick (en running.jsx legacy sí). En producción, pausar debe detener la simulación.
8. **`mode`/`.mode-switch`** definidos y estilados pero nunca renderizados. Decidir: implementar las pestañas de modo v2 o eliminar.
9. `--surface-3`, `--accent-soft` (v2), `--shadow-lg`, `--shadow-inner`, `.hero-stats`, `.tutorial-panel`, `.tut-visual`, `IconMemory`, `IconServer`, `IconUser`, `IconPlus`, `TutVisualUpload`, `TutVisualCluster`: definidos y no usados. Conservar tokens; eliminar componentes muertos.
10. `RunningScreen` y `ClusterConfigScreen` son legacy no enrutados; extraer de ellos los compartidos (`MetricCard`, `MiniBar`, `NodeDiamond`, `LiveTopology`, `genLogLine`, `ClusterTopology`, `SAMPLE_CODE`) a módulos propios y borrar las pantallas.
11. `sidebar-brand-mark` pide `font-weight:700` en JetBrains Mono pero solo se cargan 400/500/600 → cargar 700 o bajar a 600.
12. Los datos de todas las pantallas son **mock hardcodeado** (jobs, catálogo, progreso, logs) — en producción separarlos en fixtures/JSON tipados desde el día 1.

---

## 15. Guía de implementación en React + Vite + TS (estructura sugerida)

```
src/
  styles/tokens.css        (§1.2–1.5: v1 + dark + v2 en data-variant)
  styles/base.css          (§1.1, 1.7, 2.x)
  styles/screens.css       (§4–8, corregido)
  theme/VariantContext.tsx (variant + localStorage 'telar-variant'; setea data-variant en <html>)
  components/icons/        (§9, portados literal)
  components/ui/           (Button, Card, Chip, Terminal, MetricCard, MiniBar, NodeDiamond…)
  components/shell/        (Sidebar, TopBar; localStorage 'telar-sidebar-expanded', default colapsado)
  components/viz/          (HomeClusterDiagram, ClusterTopology, LiveTopology, WorkDistributionChart)
  screens/                 (Home, Simulator, Results, Catalog, Learn)
  sim/                     (useSimulation: tick 700ms, jitter, genLogLine, progreso)
  data/                    (catalog.ts, lessons.ts, recentJobs.ts, sampleCode.ts)
```

- Router: el prototipo usa estado (`screen`); en producción puede mapearse 1:1 a rutas (`/`, `/simulador`, `/resultados`, `/aprender`, `/aprender/:leccionId`) manteniendo el scroll-to-top smooth de `.main`.
- SMIL en JSX/TS: los atributos `attributeName`, `repeatCount`, `keyPoints`, `keyTimes`, `begin`, `dur` son válidos en TSX sobre `<animate>`/`<animateMotion>`.
- Respetar `prefers-reduced-motion`: desactivar pulse/paquetes SMIL (el prototipo no lo contempla; añadirlo).
