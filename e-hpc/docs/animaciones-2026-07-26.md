# Integración de las 3 animaciones (2026-07-26)

Registro de la decisión técnica y de la verificación. Capturas en
`docs/assets/animaciones-2026-07-26/`.

## 1. Qué eran realmente los archivos entregados

Los 5 HTML («Bundled Page», 0,25–1,1 MB cada uno) **no son sketches de p5.js**.
Cada archivo es un desempaquetador que:

1. lleva un manifiesto gzip+base64 con todos los recursos incrustados,
2. reconstruye la página con `DOMParser` y la inyecta,
3. carga **React 18 UMD** y **`@babel/standalone` (3,1 MB)** para compilar JSX
   **en tiempo de ejecución**.

Contenido real, una vez extraído:

| Archivo | Qué contiene de verdad | Tamaño del fuente |
|---|---|---|
| `Master y Workers.html` | HTML posicionado + `@keyframes` CSS. Sin canvas ni bucle JS. | 12,7 KB |
| `Estudiante Pixel Art.html` | `draw(t, rain)` sobre un canvas 240×135, servido como dataURL | 8,6 KB |
| `Quiz Celebration/Regular/Mal` | **Un solo** componente `QuizCelebration`; la variante la elegía `window.QUIZ_VARIANT` (`perfect`/`regular`/`bad`) | 15,9 KB (idéntico en los 3) |

Los tres bundles del quiz son **byte-idénticos** en su lógica (mismo md5 de
`celebration.js` y `animEngine.js`); solo cambiaban las variables de `window`.

## 2. Decisión: PORTAR (opción A), no embeber en iframe (opción B)

**Se portan las tres.** Motivos, en orden de peso:

1. **CSP.** Los bundles compilan JSX en runtime, así que embeberlos exigiría
   `script-src 'unsafe-eval' 'unsafe-inline'` más `frame-src`. Eso destruye la
   garantía que hoy tiene la app de escritorio. El port **no toca la CSP**.
2. **Peso.** ~4,5 MB de bundles frente a ~15 KB de fuente portado.
3. **Color.** Un iframe está aislado: habría que inyectar los tokens por
   `postMessage` y re-parametrizar la animación. Portado, el SVG consume
   `var(--token)` directamente y el tema lo conmuta el CSS sin JavaScript.
4. **Dependencias.** `p5` nunca hizo falta: no había ningún sketch de p5.

`Master y Workers` se porta a **SVG a mano**, no a HTML absoluto, porque esa es
la convención de `components/viz/*` («gráficas SVG sin librerías») y porque un
`viewBox` escala solo, sin `ResizeObserver`.

## 3. Color: tokens.css sigue siendo la única fuente

- **SVG** (`HomeMasterWorkers`): pinta con `var(--viz-node-master)`,
  `var(--viz-node)`, `var(--viz-grid)`, `var(--viz-packet)`, `var(--viz-label)`,
  `var(--viz-on-node)`. Reactivo al tema **sin JavaScript**.
- **Canvas** (`PixelStudyScene`, `QuizResultAnimation`): un canvas no resuelve
  `var()`, así que `lib/themeColors` + `hooks/useThemeColors` leen los tokens con
  `getComputedStyle` y **vuelven a leerlos** ante cualquier cambio de
  `data-theme` (`MutationObserver` sobre `<html>`) o del esquema del SO. Las
  variantes de cada material (sombras, mezclas) se derivan con `mix`/`shade`.
- Se añaden **7 tokens `--scene-*`** para roles REPRESENTACIONALES que no tienen
  equivalente semántico: `ink`, `skin`, `hair`, `wood`, `night`, `device`,
  `screen`. Todo lo demás (pared, suelo, libros, lámpara, póster, confeti)
  reutiliza los semánticos y los `--viz-*`. En `[data-theme="dark"]` se suben de
  luminancia los que deben separarse del muro oscuro (`hair`, `device`) y se
  baja la tinta, que se dibuja **encima de la piel**, no sobre el fondo.

**Cero hex en los componentes.**

## 4. Mapa de roles de color

| Rol de la animación original | Token de E-HPC |
|---|---|
| master / nodo principal | `--viz-node-master` |
| workers / hilos | `--viz-node` |
| conexiones, codos punteados | `--viz-grid` |
| paquetes, pulsos, corazón | `--viz-packet` |
| etiquetas `master`, `t0..t3` | `--viz-label` |
| caritas | `--viz-on-node` |
| quiz · celebración | `--success` (+ serie `--accent`/`--warn`/`--viz-mem`/`--primary`) |
| quiz · aprobado justo | `--warn` (+ misma serie) |
| quiz · reprobado | `--danger` en el rótulo; nube `--border`/`--border-strong`, lluvia `--viz-mem` |

## 5. `prefers-reduced-motion`: el póster sale gratis

No hace falta reutilizar el thumbnail SVG del bundle:

- el **SVG** cae en su pose estática correcta, porque la regla global de
  `base.css` §5.3 deja los `@keyframes` en su fotograma final (que es, a
  propósito, la pose de reposo) y los pulsos SMIL se ocultan con
  `useReducedMotion`;
- los **canvas** pintan **un** fotograma y no arrancan `requestAnimationFrame`.

El póster de la viñeta es, por tanto, la escena completa —no un thumbnail
degradado—. Verificado byte a byte: dos capturas separadas en el tiempo son
idénticas (`scene-reduced-motion.png`).

## 6. Umbrales del quiz

```
!passed                    → "bad"          (¡OTRA VEZ!, nube de lluvia)
passed y ratio >= 0.90     → "celebration"  (¡PERFECTO!, fuegos + confeti + globos)
passed y ratio <  0.90     → "regular"      (¡CASI!, confeti suave)
```

El aprobado/suspenso lo dicta **`passed`**, que corrige el servidor y es la
fuente de verdad del umbral; el ratio solo separa el aprobado holgado del justo.
`total === 0` no divide por cero.

**Se descartó la tarjeta de puntaje ficticia** que traían los tres bundles
(«QUIZ · UNIDAD 04», 7/10, 02:14). El puntaje real ya lo pinta `QuizRunner`;
mostrar cifras inventadas al lado habría sido incorrecto. La banda va **antes**
del resumen y **fuera** del `aria-live`, así que no tapa ni duplica el puntaje,
el chip ni «corregido por el servidor». El rótulo se apoya en una placa sólida
para mantener AA aunque le pase confeti por detrás.

## 7. Verificación

| Comprobación | Resultado |
|---|---|
| `tsc --noEmit` (frontend, tests, desktop) | limpio |
| Vitest | **268/268** |
| Cobertura (los 4 dirs con criterio) | lib 94,4 % · hooks 95,7 % · stores 97,3 % · ws 94,4 % |
| E2E Playwright (`:8080`) | **16/16** |
| Errores de consola | **0** (web y Electron) |
| Violaciones de CSP | **0** |
| Requests de red nuevas | **0** (solo el backend local) |
| Electron `file://` | las 3 animaciones montan, pintan y animan |
| Cambio de tema | SVG `#664930 ↔ #CCBEB1`; canvas muro claro ↔ oscuro |
| `prefers-reduced-motion` | póster estático, idéntico entre capturas |

### Contraste AA (calculado, no estimado)

| Elemento | Claro | Oscuro |
|---|---|---|
| Rótulo celebración (`--success-ink`) | 7,07:1 | 6,39:1 |
| Rótulo regular (`--warn-ink`) | 5,32:1 | 11,57:1 |
| Rótulo reprobado (`--danger-ink`) | 9,29:1 | 8,60:1 |
| Etiquetas del hero (`--viz-label`) | 6,92:1 | 9,43:1 |
| Rombo maestro (UI, ≥3:1) | 8,20:1 | 9,43:1 |
| Rombos de hilos (UI, ≥3:1) | 5,30:1 | 4,51:1 |

### La CSP sigue vigente sobre `file://`

Comprobado en Electron, no asumido: con la app cargada y funcionando, un
`<script>` inline se bloquea (`Executing inline script violates … script-src
'self'`) y un `fetch('https://example.com')` se bloquea por `connect-src`.
`onHeadersReceived` sí dispara para URLs `file://`.

> Nota metodológica: `new Function()` **sí** se ejecuta desde
> `page.evaluate()` de Playwright, pero eso no indica que falte `unsafe-eval`:
> el código inyectado por CDP no pasa por las reglas de `eval` de la CSP. La
> prueba válida es la del `<script>` inline y la del `fetch` externo.

## 8. Cambios de UI

- **Hero**: `HomeMasterWorkers` sustituye a `HomeThreadsDiagram` en el mismo
  hueco y con el mismo `role="img"`.
- **Home, parte inferior**: se retira la sección «¿Qué quieres hacer ahora?» y
  todo lo que iba debajo. `QuickCards`, `RecentJobs` y `SuggestedLessons`
  quedaban sin referencias y se borran junto con su CSS (`.two-col` se conserva:
  la comparte Resultados). En su lugar, `PixelStudyScene` a ancho completo.
- **Quiz**: banda animada según el puntaje, encima del resumen.

## 9. E2E actualizados en el mismo commit

- `pages/HomePage.ts`: el localizador pasa de `getByRole('img', { name: 'Modelo
  fork-join…' })` a `getByTestId('home-fork-join-anim')` (estable frente a
  cambios de copy) y se añade `pixelScene`.
- `tests/c-home.spec.ts`: asserta que sigue siendo `<svg role="img">` con
  `aria-label` de fork-join, que están las etiquetas `master`/`t0..t3`, que el
  `fill` sale de `var(--viz-*)` (no de un hex), que el canvas **pinta de verdad**
  (>1000 píxeles opacos) y que «¿Qué quieres hacer ahora?» ya no existe.
- `tests/b-learn.spec.ts` (B3): comprueba que `4/4`, «Aprobado» y «corregido por
  el servidor» siguen visibles, que la banda no duplica el puntaje y que **no lo
  solapa** (comparación de `boundingBox`).
