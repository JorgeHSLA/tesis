// themeColors.ts — lectura en RUNTIME de los tokens de color de tokens.css.
//
// Las animaciones de `components/viz/*` que pintan sobre <canvas> NO pueden
// usar `var(--token)` (el canvas no resuelve custom properties), pero tokens.css
// sigue siendo la ÚNICA fuente de color: aquí se leen los tokens con
// getComputedStyle y se derivan las sombras/mezclas que la escena necesita.
// Al cambiar `data-theme` en <html> el hook re-lee y la animación se repinta
// sola — sin hex hardcodeados en ningún componente.
//
// Los componentes SVG/DOM (HomeMasterWorkers) NO usan este módulo: consumen
// `var(--token)` directamente, que es lo idiomático y ya es reactivo al tema.

export interface Rgb {
  readonly r: number
  readonly g: number
  readonly b: number
}

/** Mapa `rol de la escena` → `nombre del token` (sin `var()`). */
export type TokenMap = Readonly<Record<string, string>>

/** Colores resueltos: mismo juego de claves que el TokenMap de entrada. */
export type ResolvedColors<T extends TokenMap> = Readonly<Record<keyof T, string>>

const HEX_RE = /^#([0-9a-f]{3,8})$/i
const RGB_RE = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i

const BLACK: Rgb = { r: 0, g: 0, b: 0 }

const parseCache = new Map<string, Rgb>()

const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v))

/** Canvas 1×1 para colores exóticos (oklch/color-mix/nombres). null en jsdom. */
let probeCtx: CanvasRenderingContext2D | null | undefined

function getProbeCtx(): CanvasRenderingContext2D | null {
  if (probeCtx === undefined) {
    try {
      const canvas = document.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      probeCtx = canvas.getContext('2d', { willReadFrequently: true })
    } catch {
      probeCtx = null
    }
  }
  return probeCtx
}

function parseViaCanvas(css: string): Rgb | null {
  const ctx = getProbeCtx()
  if (ctx === null) return null
  try {
    ctx.clearRect(0, 0, 1, 1)
    // Un valor inválido deja `fillStyle` intacto: partir de negro hace que un
    // color no reconocido caiga en el fallback en vez de heredar el anterior.
    ctx.fillStyle = '#000000'
    ctx.fillStyle = css
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    return { r, g, b }
  } catch {
    return null
  }
}

/** Convierte cualquier color CSS a RGB. Devuelve negro si no se puede parsear. */
export function toRgb(css: string): Rgb {
  const key = css.trim()
  const cached = parseCache.get(key)
  if (cached !== undefined) return cached

  let out: Rgb | null = null

  const hex = HEX_RE.exec(key)
  if (hex) {
    const h = hex[1]
    if (h.length === 3 || h.length === 4) {
      out = {
        r: parseInt(h[0] + h[0], 16),
        g: parseInt(h[1] + h[1], 16),
        b: parseInt(h[2] + h[2], 16),
      }
    } else if (h.length === 6 || h.length === 8) {
      out = {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
      }
    }
  }

  if (out === null) {
    const rgb = RGB_RE.exec(key)
    if (rgb) {
      out = { r: clamp255(Number(rgb[1])), g: clamp255(Number(rgb[2])), b: clamp255(Number(rgb[3])) }
    }
  }

  out ??= parseViaCanvas(key)
  out ??= BLACK

  parseCache.set(key, out)
  return out
}

/** `#rrggbb` a partir de un Rgb. */
export function toHex({ r, g, b }: Rgb): string {
  const h = (v: number) => clamp255(v).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

/** Mezcla lineal `a`→`b`; `t=0` devuelve `a`, `t=1` devuelve `b`. */
export function mix(a: string, b: string, t: number): string {
  const k = t < 0 ? 0 : t > 1 ? 1 : t
  const ca = toRgb(a)
  const cb = toRgb(b)
  return toHex({
    r: ca.r + (cb.r - ca.r) * k,
    g: ca.g + (cb.g - ca.g) * k,
    b: ca.b + (cb.b - ca.b) * k,
  })
}

/** Aclara (`amount > 0`) u oscurece (`amount < 0`) un color; rango [-1, 1]. */
export function shade(css: string, amount: number): string {
  return amount >= 0 ? mix(css, '#ffffff', amount) : mix(css, '#000000', -amount)
}

/** `rgba(...)` a partir de un color CSS y un alfa en [0, 1]. */
export function withAlpha(css: string, alpha: number): string {
  const { r, g, b } = toRgb(css)
  const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

/**
 * Resuelve un TokenMap contra los estilos calculados de `element`
 * (por defecto `<html>`, donde viven `:root` y `[data-theme]`).
 * Un token ausente cae en `fallback` para no pintar transparente.
 */
export function readThemeColors<T extends TokenMap>(
  tokens: T,
  element?: Element | null,
  fallback = '#808080',
): ResolvedColors<T> {
  const target = element ?? (typeof document === 'undefined' ? null : document.documentElement)
  const out = {} as Record<keyof T, string>
  if (target === null || typeof getComputedStyle !== 'function') {
    for (const role of Object.keys(tokens) as (keyof T)[]) out[role] = fallback
    return out
  }
  const style = getComputedStyle(target)
  for (const role of Object.keys(tokens) as (keyof T)[]) {
    const value = style.getPropertyValue(tokens[role] as string).trim()
    out[role] = value === '' ? fallback : value
  }
  return out
}
