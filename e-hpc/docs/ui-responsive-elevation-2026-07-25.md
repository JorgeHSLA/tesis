# Layout responsive + elevación/superficies — comparativa ANTES / DESPUÉS

**Fecha:** 2026-07-25 · **Alcance:** todo el frontend (shell, Home, Catálogo, Lección,
Simulador, Resultados, Admin) · **Spec:** `docs/architecture/frontend-spec.md` §5.0.1

Este documento recoge la evidencia medida de la corrección de dos defectos **sistémicos**.
No es un rediseño de marca: la paleta (teal + naranja), la tipografía y las gráficas SVG a
mano no cambian. Lo que cambia es el **sistema de tokens** del que cuelga todo lo demás.

Capturas: `docs/assets/ui-2026-07-25/{antes,despues}/<pantalla>-<ancho>.png`
(5 pantallas × 6 anchos, más admin y la ventana Electron en el DESPUÉS).

---

## Defecto 1 — «todo se ve blanco»: no se distinguían cards, módulos ni apartados

### Diagnóstico medido (antes)

| Síntoma | Valor medido |
|---|---|
| Contraste página↔tarjeta | `--bg #F8FAFC` vs `--surface #FFFFFF` = **1.05:1** (imperceptible) |
| Sombra de tarjeta | `--shadow-sm: 0 1px 0 rgba(15,23,42,.04)` — invisible sobre un fondo casi blanco |
| Sombra del CTA | `--shadow-cta: none` — el botón primario había perdido su elevación |
| Borde de tarjeta | `--slate-200` = **1.23:1** contra blanco: no se lee al 100 % de zoom |

Resultado: solo se percibían textos, botones naranjas y hovers. No había "cajas".

### Solución — escala de superficies + escala de elevación (capa *semantic*)

Cuatro niveles de superficie escalonados por luminancia, **sin recurrir al naranja de acento**:

| Token | Valor | Rol | Contraste vs blanco |
|---|---|---|---|
| `--surface` | `#FFFFFF` | tarjeta y chrome (sidebar, topbar) | — |
| `--surface-2` | `#EFF3F8` | sub-superficie dentro de la tarjeta (card-head, hovers, chips) | 1.11:1 |
| `--bg` | `#E8EDF4` | lienzo hundido (`.main`) | **1.18:1** |
| `--surface-3` | `#DFE6EE` | pozos: tracks de progreso, barras | 1.26:1 |

Escala de elevación semántica `--elevation-0..4` — cada nivel combina **superficie + borde +
sombra**, y los componentes consumen el nivel, nunca una sombra suelta:

| Nivel | Uso | Aplicado a |
|---|---|---|
| 0 | lienzo hundido | `.main`, `.app` |
| 1 | tarjeta en reposo | `.card`, `.metric-card`, `.qcard`, `.tut-tab`, `.cstat`, `.fpill`, `.terminal`, `.btn` neutro |
| 2 | tarjeta elevada / hover / destacada | `.card-raised`, `.qcard:hover`, `.cat-module.open`, `.hero-right`, `.catalog-continue`, `.quiz-teaser` |
| 3 | overlay | `.admin-auth-card`, `.admin-savebar`, tooltip del rail |
| 4 | sobre backdrop | `.admin-modal`, `.admin-toast` |

Otros cambios del mismo sistema:

- **`--shadow-cta` recuperada** (`0 1px 2px … , 0 6px 14px -6px …`): el CTA vuelve a elevarse,
  y `--shadow-cta-hover` refuerza el estado hover.
- **Bordes con dos pesos**: `--border #CFD8E3` estructural (**1.44:1**, antes 1.23:1) y
  `--border-strong #8294AA` cuando el borde **es la affordance** (inputs, select, buscador,
  dropzone, opciones de quiz) con **3.10:1 ⇒ cumple WCAG 1.4.11 (UI ≥ 3:1)**.
- **`--text-muted` sube a `--slate-600`**: al oscurecer el lienzo, el `--slate-500` anterior
  caía a 4.05:1 (por debajo de AA). Ahora da 6.44:1 sobre `--bg` y 7.58:1 sobre blanco.
- **Chrome blanco enmarcando lienzo hundido**: sidebar y topbar pasan a `--surface`; el área
  de contenido queda en `--bg`. Es lo que hace legible de un vistazo dónde empieza cada caja.

### Verificación

```
--surface    #FFFFFF  L=1.0000
--surface-2  #EFF3F8  L=0.8923      saltos: surface→surface-2 1.114:1
--bg         #E8EDF4  L=0.8426              surface-2→bg      1.056:1
--surface-3  #DFE6EE  L=0.7845              bg→surface-3      1.070:1

--border         vs blanco: 1.440:1   (antes 1.234:1)
--border-strong  vs blanco: 3.104:1   (WCAG 1.4.11 UI ≥ 3:1) ✅

.card  box-shadow → rgba(15,23,42,.04) 0 1px 1px, rgba(15,23,42,.08) 0 2px 4px -1px
CTA    box-shadow → rgba(124,45,18,.3) 0 1px 2px, rgba(124,45,18,.55) 0 6px 14px -6px
```

---

## Defecto 2 — la app no era responsive y no llenaba la pantalla

### Diagnóstico medido (antes)

Solo 13 `@media` en 9 hojas (2 de ellas `prefers-reduced-motion`) ⇒ **un único breakpoint real
(980px)**. `.screen { max-width: 1280px }` capaba TODAS las pantallas, con el parche puntual
`.screen.learn { max-width: 1680px }`. Sin `clamp()`, sin `auto-fit/minmax`, sin container
queries.

**Franja muerta a la derecha (px) — medida con Playwright:**

| Ventana | Home | Catálogo | Lección | Simulador | Resultados |
|---|---|---|---|---|---|
| 2560 | 1228 | 1228 | 828 | 1228 | 1228 |
| **1920** | **588** | **588** | **188** | **588** | **588** |
| **1440** | **108** | **108** | 0 | **108** | **108** |
| 1280 | 0 | 0 | 0 | 0 | 0 |

### Solución

- **Contenedor fluido global**: `.screen` es `width:100%; max-width: var(--screen-max /*2040px*/);
  margin-inline:auto`. Desaparecen el cap de 1280 **y** el parche de learn. La medida de lectura
  se acota aparte y **solo sobre columnas de texto** (`--measure: 70ch`, `--measure-narrow: 46ch`),
  nunca sobre el layout entero.
- **Ritmo y tipografía fluidos con `clamp()`** en tokens (px+vw, independientes del `font-size`
  raíz, que también es fluido 15px → 16.4px):
  `--screen-pad-x/y`, `--section-gap`, `--card-pad`, `--grid-gap`, y la escala
  `--fs-2xs … --fs-3xl`.
- **Grillas adaptativas**: `repeat(auto-fit, minmax(min(100%, var(--col-min-*)), 1fr))` en
  métricas, qcards, pasos del tutorial, stats del catálogo, opciones avanzadas y skeletons.
  Todos los `1fr` son `minmax(0,1fr)` y los hijos de grid llevan `min-width:0` — sin eso, el
  bloque de código (`white-space: pre`) impide encoger la columna y empuja el layout fuera del
  viewport.
- **Container queries** donde el reflow depende del ancho de la **propia tarjeta**, no del
  viewport: `.results-table` (760px), `.threads-table` (520px), `.cat-module-head` (620px),
  `.metric-card` (210px). Sustituyen a `@media` de viewport, que fallaban cuando la tabla vivía
  en una columna estrecha de una ventana ancha.
- **Set único de breakpoints** documentado en `tokens.css` §6 — **640 / 768 / 1024 / 1280 /
  1536**, enfoque *mobile-first* (`min-width`). Los sueltos **980 / 900 / 800 / 720** quedaron
  migrados; hoy solo se usan 1024, 1536, un 767.98 (frontera de `--bp-md`) y `pointer: coarse`.
- **Objetivos táctiles**: `@media (pointer: coarse)` sube botones, ítems de nav, pills e inputs
  a 44 px (guía Apple HIG / Material).

### Verificación

**Franja muerta a la derecha (px) — DESPUÉS:**

| Ventana | Home | Catálogo | Lección | Simulador | Resultados |
|---|---|---|---|---|---|
| 2560 | 232* | 232* | 232* | 232* | 232* |
| **1920** | **0** | **0** | **0** | **0** | **0** |
| **1440** | **0** | **0** | **0** | **0** | **0** |
| 1280 · 1024 · 768 · 375 | 0 | 0 | 0 | 0 | 0 |

\* A 2560 px actúa el tope `--screen-max: 2040px`, **centrado** (`margin-inline:auto`): son
232 px a cada lado, margen simétrico intencional por legibilidad, no franja muerta a un lado.

**Desbordamiento / scroll horizontal** (auditoría elemento a elemento, 6 anchos × 5 pantallas):

```
✅ CERO desbordamientos en los 6 anchos × 5 pantallas
```

Los tres desbordes reales que aparecieron al auditar quedaron corregidos en el sistema, no por
parche de pantalla:

1. `.screen-actions` tenía `flex-shrink: 0` + `min-width: auto` → se negaba a encoger y sacaba
   el select + CTA fuera del viewport a 375 px.
2. `ExamplePicker.tsx` llevaba un `minWidth: 210` **inline** (ancho mágico en TSX) → pasa a la
   clase `.select-compact` con `min-width: min(100%, 210px)`.
3. La utilidad `.row` no envolvía (`flex-wrap: nowrap`) → el CTA del quiz-teaser desbordaba la
   tarjeta. Ahora `.row` envuelve por defecto.

> **Nota de método:** un `overflow-x: hidden` en `body` haría que la auditoría diera "sin scroll
> horizontal" **enmascarando** el problema (el contenido seguiría recortado). Se descartó a
> propósito; el desbordamiento se resuelve dentro del componente que lo causa.

---

## Gráficas SVG — responsive sin librerías

Se mantiene el criterio verificado de la tesis: **cero recharts/d3/chart.js**.

| Componente | Antes | Ahora |
|---|---|---|
| `LiveTopology` (800×280) | `width="100%" height={280}` — con `preserveAspectRatio` "meet" el dibujo encogía y dejaba franja vertical vacía | alto derivado del `viewBox` (`height: auto`) |
| `ThreadTopology` (560×200) | ídem | ídem |
| `HomeThreadsDiagram` | `height="100%"` (dependía de que el contenedor tuviera alto propio) | alto derivado del `viewBox` |
| `Sparkline` (120×28) | `width={120}` fijo | `width="100%"` + `preserveAspectRatio="none"` + `vector-effect="non-scaling-stroke"` (estira en X sin engordar el trazo) |

---

## Electron

- `WINDOW_BACKGROUND_COLOR` pasa de `#FDF8EE` (crema de la variante v1, retirada) a `#E8EDF4`
  para seguir a `--bg`: la ventana ya no abre en crema y salta a azul-gris al pintar.
- `minWidth` de la ventana baja de **980** (el breakpoint único de cuando el CSS no era
  responsive) a **640** = `--bp-sm`, coherente con el set único.

Verificado sobre la ventana real (WSLg, conexión CDP):

```
window.ehpc presente · platform "linux" · data-variant "v2"
app 1908×972  ==  viewport 1908×972   → llena la ventana exacto ✅
scroll horizontal: false · fondo: rgb(232,237,244) = #E8EDF4
requests de red: solo localhost:8000 (API) → 0 requests de fuentes/CDN ✅
```

---

## Consolidación de la variante

La app quedó fija en v2, así que los dos bloques de tokens duplicados (`:root` cálido +
`:root[data-variant="v2"]`) se **consolidaron en un único `:root`**, y los overrides
`[data-variant="v2"] .x` que solo repetían densidad se fundieron en la regla base. El atributo
`data-variant="v2"` **sigue** en `<html>` (lo fijan `index.html` y `stores/themeStore`), así que
ningún selector existente se rompe.

Higiene resultante (verificada por grep):

- **0** colores literales fuera de `tokens.css`.
- **0** `box-shadow` de elevación fuera de la escala (los `0 0 0 3px var(--*)` restantes son
  halos de estado y el anillo de foco, ya tokenizado en `--focus-ring`).
- **0** anchos de layout mágicos fuera de tokens (los de diálogo pasan a `--dialog-w-sm/md` y
  `--auth-card-w`).

---

## Resultado de la verificación

| Comprobación | Resultado |
|---|---|
| `tsc --noEmit` | limpio |
| Vitest | **235/235** (27 ficheros) |
| `npm run build` | OK |
| E2E Playwright (suite de aceptación) | **16/16** |
| Contraste AA sobre el DOM renderizado | **508 nodos de texto, 0 incumplimientos** |
| `prefers-reduced-motion` | animaciones a `0s` bajo `reduce`, activas en `no-preference` |
| Desbordes @1920·1440·1280·1024·768·375 (5 pantallas + admin) | **0** |
| Electron (WSLg) | carga y llena la ventana exacto |
| Contratos congelados (`api/types.ts`, `ws/messages.ts`, `types/ehpc.d.ts`, `schemas.py`) | **sin tocar** |
| Semántica accesible de los E2E (roles/labels/textos) | **sin tocar** |

## Observación para seguimiento (fuera del alcance de este trabajo)

Al recuperar `--shadow-cta`, los CTA naranjas ganan presencia. En el **dashboard de admin** eso
deja ~10 botones naranjas simultáneos (`+ Lección` por módulo + `Nuevo módulo`), lo que choca
con la regla "un solo CTA primario por pantalla". Es una decisión de *variant* en
`ModuleGroup.tsx`, no de layout ni de elevación, así que **no se ha tocado** aquí: bajar
`+ Lección` a `variant="outline"` sería un cambio de una línea si se quiere alinear.
