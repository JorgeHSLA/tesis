// QuizResultAnimation — banda decorativa que corona el resultado del quiz.
// Port a <canvas> + rAF de «Quiz Celebration / Regular / Mal» (un único
// componente DC con `window.QUIZ_VARIANT`; aquí la variante la decide el
// puntaje real del intento).
//
// QUÉ SE PORTA Y QUÉ NO: los tres bundles pintaban además una TARJETA DE
// PUNTAJE ficticia («QUIZ · UNIDAD 04», 7/10, 02:14). Se descarta a propósito:
// el puntaje real ya lo muestra QuizRunner, y duplicarlo con cifras inventadas
// sería incorrecto. Se portan los EFECTOS (fuegos, confeti, globos,
// serpentinas, nube de lluvia) y el rótulo, que sí acompañan al veredicto.
//
// COLOR: cero hex; todo sale de tokens.css en runtime (useThemeColors).
// MOTION: con prefers-reduced-motion se pinta un único fotograma (póster).
import { useEffect, useRef } from 'react'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { useThemeColors } from '../../hooks/useThemeColors'
import { withAlpha } from '../../lib/themeColors'

/** Espacio de diseño de la banda (el original era 1280×720 a pantalla completa). */
const W = 1280
const H = 260
/** Factor para reescalar a la banda las constantes verticales del original. */
const S = H / 720

export type QuizResultVariant = 'celebration' | 'regular' | 'bad'

/** A partir de este ratio el aprobado se celebra a lo grande. */
export const HIGH_SCORE_RATIO = 0.9

/**
 * Elige la variante. El aprobado/suspenso lo dicta `passed` (lo corrige el
 * servidor y es la fuente de verdad del umbral); el ratio solo separa el
 * aprobado holgado del justo.
 */
export function resolveQuizVariant(score: number, total: number, passed: boolean): QuizResultVariant {
  if (!passed) return 'bad'
  const ratio = total > 0 ? score / total : 0
  return ratio >= HIGH_SCORE_RATIO ? 'celebration' : 'regular'
}

const BANNERS: Record<QuizResultVariant, string> = {
  celebration: '¡Perfecto!',
  regular: '¡Casi!',
  bad: '¡Otra vez!',
}

const LABELS: Record<QuizResultVariant, string> = {
  celebration: 'Animación de celebración: fuegos artificiales y confeti por un puntaje sobresaliente',
  regular: 'Animación de ánimo: confeti suave por un quiz aprobado',
  bad: 'Animación de ánimo: una nube de lluvia que invita a reintentar el quiz',
}

/** Duración de la animación por variante, en segundos. */
const DURATION: Record<QuizResultVariant, number> = { celebration: 4.4, regular: 4, bad: 3.6 }
/** Fotograma del póster con reduced-motion (mitad de la animación). */
const POSTER_P = 0.45

const QUIZ_TOKENS = {
  success: '--success',
  warn: '--warn',
  danger: '--danger',
  accent: '--accent',
  primary: '--primary',
  vizMem: '--viz-mem',
  vizPacket: '--viz-packet',
  border: '--border',
  borderStrong: '--border-strong',
  textMuted: '--text-muted',
  ink: '--scene-ink',
  onNode: '--viz-on-node',
} as const

type QuizColors = Readonly<Record<keyof typeof QUIZ_TOKENS, string>>

/* ── utilidades del sketch original ───────────────────────────────────────── */
const TAU = Math.PI * 2
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const ease = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : 1 - Math.pow(1 - t, 3))
const easeIn = (t: number) => clamp(t, 0, 1) * clamp(t, 0, 1)
/** Rejilla de 4 px: da el aspecto pixel-art del original. */
const q = (v: number) => Math.round(v / 4) * 4

/** PRNG determinista: el mismo `p` siempre pinta el mismo fotograma. */
function rnd(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** Sprite del globo (9×15) del bundle original. */
const BALLOON = [
  '  ooooo  ',
  ' oohoooo ',
  'oohhooooo',
  'ooohooooo',
  'ooooooooo',
  'ooooooooo',
  ' ooooooo ',
  ' ooooooo ',
  '  ooooo  ',
  '   ooo   ',
  '    k    ',
  '   s     ',
  '    s    ',
  '   s     ',
  '    s    ',
] as const

/** Sprite de la nube (14×5). */
const CLOUD = ['    ccccc     ', '  ccccccccc   ', ' ccccccccccc  ', 'cccccccccccccc', ' dddddddddddd '] as const

type SpritePalette = Readonly<Record<string, string | undefined>>

function drawSprite(
  cx: CanvasRenderingContext2D,
  rows: readonly string[],
  palette: SpritePalette,
  px: number,
  left: number,
  top: number,
): void {
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y]
    for (let x = 0; x < row.length; x++) {
      const color = palette[row[x]]
      if (color === undefined) continue
      cx.fillStyle = color
      cx.fillRect(left + x * px, top + y * px, px + 0.5, px + 0.5)
    }
  }
}

/** Posiciones/instantes de los estallidos; las `y` ya vienen escaladas a la banda. */
const BURSTS = [
  { t: 0.02, x: 250, y: 170 * S },
  { t: 0.14, x: 1010, y: 130 * S },
  { t: 0.3, x: 600, y: 90 * S },
  { t: 0.44, x: 160, y: 300 * S },
  { t: 0.55, x: 1120, y: 300 * S },
  { t: 0.66, x: 430, y: 150 * S },
  { t: 0.76, x: 880, y: 210 * S },
] as const

function drawFireworks(
  cx: CanvasRenderingContext2D,
  p: number,
  intensity: number,
  bursts: readonly (typeof BURSTS)[number][],
  palette: readonly string[],
  ink: string,
): void {
  bursts.forEach((b, bi) => {
    const launch = 0.09
    const life = 0.19
    const colA = palette[bi % palette.length]
    const colB = palette[(bi + 2) % palette.length]

    const lt = (p - b.t) / launch
    if (lt > 0 && lt < 1) {
      const y = lerp(H - 130 * S, b.y, ease(lt))
      for (let k = 0; k < 4; k++) {
        cx.globalAlpha = (1 - k * 0.24) * (1 - lt * 0.3)
        cx.fillStyle = k === 0 ? ink : colA
        cx.fillRect(q(b.x + Math.sin(lt * 9 + k) * 3), q(y + k * 14), 8, 8)
      }
      cx.globalAlpha = 1
    }

    const et = (p - b.t - launch) / life
    if (et <= 0 || et >= 1) return

    if (et < 0.18) {
      const glow = cx.createRadialGradient(b.x, b.y, 0, b.x, b.y, 60)
      glow.addColorStop(0, withAlpha(colA, 0.5 * (1 - et / 0.18)))
      glow.addColorStop(1, withAlpha(colA, 0))
      cx.fillStyle = glow
      cx.fillRect(b.x - 60, b.y - 60, 120, 120)
    }

    const n = Math.round(26 * intensity)
    const r = rnd(bi * 13 + 5)
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * TAU + r() * 0.2
      const speed = 210 + r() * 190
      const d = speed * ease(et)
      const px = b.x + Math.cos(angle) * d
      const py = b.y + Math.sin(angle) * d * 0.85 * S + 260 * S * et * et
      const color = i % 3 === 0 ? colB : colA
      const fade = clamp((1 - et) * 1.6, 0, 1)
      const size = et < 0.4 ? 10 : 8
      cx.globalAlpha = fade
      cx.fillStyle = color
      cx.fillRect(q(px), q(py), size, size)
      if (et > 0.15) {
        cx.globalAlpha = fade * 0.45
        cx.fillRect(q(px - Math.cos(angle) * 22), q(py - Math.sin(angle) * 22), 6, 6)
      }
    }
    cx.globalAlpha = 1
  })
}

function drawConfetti(
  cx: CanvasRenderingContext2D,
  p: number,
  intensity: number,
  palette: readonly string[],
): void {
  const n = Math.round(90 * intensity)
  const r = rnd(97)
  for (let i = 0; i < n; i++) {
    const x0 = r() * W
    const delay = r() * 0.35
    const span = 0.34 + r() * 0.22
    const color = palette[Math.floor(r() * palette.length)]
    const size = r() > 0.7 ? 14 : 10
    const sway = 30 + r() * 70
    const spin = 1 + r() * 3
    const restY = lerp(H + 80, H + 180, r())
    const t = clamp((p - delay) / span, 0, 1)
    if (t <= 0 || t >= 1) continue
    const y = lerp(-60, restY, easeIn(t) * 0.35 + ease(t) * 0.65)
    const x = x0 + Math.sin(t * spin * TAU) * sway * (1 - t * 0.6)
    cx.fillStyle = color
    cx.fillRect(q(x), q(y), size, Math.max(4, size * Math.abs(Math.cos(t * spin * TAU))))
  }
}

function drawBalloons(
  cx: CanvasRenderingContext2D,
  p: number,
  count: number,
  palette: readonly string[],
  ink: string,
  onNode: string,
): void {
  const r = rnd(31)
  for (let i = 0; i < count; i++) {
    const x = 40 + r() * (W - 140)
    const delay = r() * 0.34
    const span = 0.52 + r() * 0.1
    const color = palette[i % palette.length]
    const px = 5 + Math.round(r() * 3)
    const sway = 20 + r() * 34
    const t = clamp((p - delay) / span, 0, 1)
    if (t <= 0 || t >= 1) continue
    const y = lerp(H + 120, -330, ease(t * 0.98))
    drawSprite(
      cx,
      BALLOON,
      { o: color, h: withAlpha(onNode, 0.85), k: ink, s: withAlpha(ink, 0.3) },
      px,
      q(x + Math.sin(t * 7 + i) * sway),
      q(y),
    )
  }
}

function drawStreamers(cx: CanvasRenderingContext2D, p: number, palette: readonly string[]): void {
  const r = rnd(53)
  for (let s = 0; s < 9; s++) {
    const x0 = 60 + r() * (W - 120)
    const delay = r() * 0.3
    const span = 0.5 + r() * 0.2
    const color = palette[s % palette.length]
    const amp = 26 + r() * 40
    const wl = 0.05 + r() * 0.03
    const len = 26 + Math.round(r() * 12)
    const t = clamp((p - delay) / span, 0, 1)
    if (t <= 0) continue
    const head = lerp(-120, H + 480, ease(t))
    cx.fillStyle = color
    for (let k = 0; k < len; k++) {
      const y = head - k * 12
      if (y < -20 || y > H + 20) continue
      cx.globalAlpha = k > len - 6 ? 0.35 : 1
      cx.fillRect(q(x0 + Math.sin(y * wl + s) * amp), q(y), 12, 12)
    }
    cx.globalAlpha = 1
  }
}

function drawRainCloud(cx: CanvasRenderingContext2D, p: number, c: QuizColors, exitY: number): void {
  const px = 10
  const cxPos = W / 2 - (14 * px) / 2
  const cyPos = lerp(-160, 46, ease(clamp(p / 0.16, 0, 1))) + exitY
  const r = rnd(71)
  const active = clamp((p - 0.14) / 0.08, 0, 1) * clamp((0.98 - p) / 0.1, 0, 1)

  drawSprite(cx, CLOUD, { c: c.border, d: c.borderStrong }, px, cxPos, cyPos)

  cx.fillStyle = c.vizMem
  for (let i = 0; i < 22; i++) {
    const dx = r() * 12 * px
    const phase = r()
    const speed = 2 + r() * 1.6
    const cycle = (p * speed + phase) % 1
    cx.globalAlpha = 0.85 * (1 - cycle * 0.6) * active
    cx.fillRect(q(cxPos + px + dx), q(cyPos + 5 * px + 14 + cycle * 150), 6, 14)
  }
  cx.globalAlpha = 1
}

function drawSadBalloon(cx: CanvasRenderingContext2D, p: number, c: QuizColors): void {
  if (p <= 0.06 || p >= 0.92) return
  const up = clamp(p / 0.4, 0, 1)
  const down = clamp((p - 0.45) / 0.42, 0, 1)
  const restY = 300 * S
  const y = down > 0 ? lerp(restY, H + 160, easeIn(down)) : lerp(H + 120, restY, ease(up))
  const x = 190 + Math.sin(p * 9) * 26 * (down > 0 ? 2 : 1)
  drawSprite(
    cx,
    BALLOON,
    { o: c.textMuted, h: withAlpha(c.onNode, 0.6), k: c.ink, s: withAlpha(c.ink, 0.3) },
    6,
    q(x),
    q(y),
  )
}

/** Series de color por variante: siempre tokens de la app, nunca hex sueltos. */
function paletteFor(variant: QuizResultVariant, c: QuizColors): readonly string[] {
  if (variant === 'celebration') return [c.success, c.accent, c.warn, c.vizMem, c.primary, c.vizPacket]
  if (variant === 'regular') return [c.warn, c.accent, c.success, c.vizMem, c.primary]
  return [c.textMuted, c.border, c.vizMem]
}

function drawFrame(
  cx: CanvasRenderingContext2D,
  p: number,
  variant: QuizResultVariant,
  c: QuizColors,
  intensity = 1,
): void {
  cx.clearRect(0, 0, W, H)
  cx.globalAlpha = 1
  const palette = paletteFor(variant, c)

  if (variant === 'celebration') {
    drawFireworks(cx, p * 1.05, intensity, BURSTS, palette, c.ink)
    drawBalloons(cx, p, Math.round(10 * intensity), palette, c.ink, c.onNode)
    drawStreamers(cx, p, palette)
    drawConfetti(cx, p, intensity, palette)
    return
  }

  if (variant === 'regular') {
    drawFireworks(cx, p * 1.05, intensity * 0.6, BURSTS.slice(0, 3), palette, c.ink)
    drawBalloons(cx, p, Math.max(2, Math.round(4 * intensity)), palette, c.ink, c.onNode)
    drawConfetti(cx, p, intensity * 0.4, palette)
    return
  }

  const exitY = p > 0.78 ? lerp(0, 780 * S, easeIn((p - 0.78) / 0.22)) : 0
  drawRainCloud(cx, p, c, exitY)
  drawSadBalloon(cx, p, c)
}

export interface QuizResultAnimationProps {
  score: number
  total: number
  passed: boolean
}

export function QuizResultAnimation({ score, total, passed }: QuizResultAnimationProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const reduced = useReducedMotion()
  const colors = useThemeColors(QUIZ_TOKENS)
  const variant = resolveQuizVariant(score, total, passed)

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const cx = canvas.getContext('2d')
    if (cx === null) return

    if (reduced) {
      drawFrame(cx, POSTER_P, variant, colors)
      return
    }

    let raf = 0
    let start: number | null = null
    const duration = DURATION[variant]

    const tick = (now: number) => {
      start ??= now
      const p = (now - start) / 1000 / duration
      if (p >= 1) {
        // Se reproduce UNA vez: al terminar la banda queda limpia y el
        // rótulo (que es HTML, no canvas) permanece.
        cx.clearRect(0, 0, W, H)
        return
      }
      drawFrame(cx, p, variant, colors)
      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [colors, reduced, variant])

  return (
    <div
      className="quiz-result-anim"
      data-variant={variant}
      data-testid="quiz-result-anim"
      role="img"
      aria-label={LABELS[variant]}
    >
      {/* El nombre accesible lo da el aria-label del contenedor. Marcar los
          hijos como decorativos NO depende de que el lector de pantalla
          aplane el subárbol de un role="img": así el veredicto se anuncia
          una sola vez, desde el resumen de QuizRunner. */}
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        aria-hidden="true"
        style={{ aspectRatio: `${W} / ${H}` }}
      />
      <p className="quiz-result-banner" aria-hidden="true">
        {BANNERS[variant]}
      </p>
    </div>
  )
}
