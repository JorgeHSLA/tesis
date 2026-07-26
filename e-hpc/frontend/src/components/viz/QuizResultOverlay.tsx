// QuizResultOverlay — celebración del resultado del quiz A PANTALLA COMPLETA.
// Port de «Quiz Celebration / Regular / Mal» (un único componente DC con
// `window.QUIZ_VARIANT`; aquí la variante la decide el puntaje real).
//
// LA TARJETA DE PUNTAJE ES REAL. Los bundles originales pintaban cifras
// inventadas («QUIZ · UNIDAD 04», 7/10, cronómetro 02:14). Aquí se conserva el
// MISMO lenguaje visual (marco grueso, sombra dura, casillas ✓/✗ pixeladas)
// pero alimentado por el intento: una fila por pregunta real y el puntaje que
// devolvió el servidor. Nada inventado, ni el cronómetro (se elimina).
//
// COLOR: cero hex. La tarjeta es DOM y usa var(--token); solo las partículas
// van a <canvas>, que no resuelve var() y por eso lee los tokens en runtime.
// MOTION: con prefers-reduced-motion no hay partículas ni cierre automático —
// se muestra la tarjeta quieta y el usuario cierra cuando quiere.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { useThemeColors } from '../../hooks/useThemeColors'
import { withAlpha } from '../../lib/themeColors'

/** Espacio de diseño del original (1280×720), escalado a «cover» del viewport. */
const W = 1280
const H = 720

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

/* ── Guion temporal (ms desde que se abre el overlay) ──────────────────────── */
/** La tarjeta entra y sus filas se revelan escalonadas antes de los efectos. */
const ROW_STAGGER_MS = 110
const ROWS_START_MS = 340
const BANNER_LEAD_MS = 180
/** Duración de las partículas por variante. */
const FX_MS: Record<QuizResultVariant, number> = { celebration: 4000, regular: 3600, bad: 3400 }
/** Desvanecido final antes de cerrar. */
const FADE_MS = 420

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

/** Marcas pixeladas de la tarjeta, calcadas del bundle (9×8). */
const CHECK = [
  '       oo',
  '      ooo',
  '     ooo ',
  'o   ooo  ',
  'oo ooo   ',
  ' ooooo   ',
  '  ooo    ',
  '   o     ',
] as const

const CROSS = [
  'oo     oo',
  ' oo   oo ',
  '  oo oo  ',
  '   ooo   ',
  '   ooo   ',
  '  oo oo  ',
  ' oo   oo ',
  'oo     oo',
] as const

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

/** Instantes y posiciones de los estallidos (espacio 1280×720 del original). */
const BURSTS = [
  { t: 0.02, x: 250, y: 170 },
  { t: 0.14, x: 1010, y: 130 },
  { t: 0.3, x: 600, y: 90 },
  { t: 0.44, x: 160, y: 300 },
  { t: 0.55, x: 1120, y: 300 },
  { t: 0.66, x: 430, y: 150 },
  { t: 0.76, x: 880, y: 210 },
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
      const y = lerp(H - 130, b.y, ease(lt))
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
      const py = b.y + Math.sin(angle) * d * 0.85 + 260 * et * et
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

function drawRainCloud(cx: CanvasRenderingContext2D, p: number, c: QuizColors): void {
  const px = 14
  const cxPos = W / 2 - (14 * px) / 2
  const cyPos = lerp(-220, 70, ease(clamp(p / 0.16, 0, 1)))
  const r = rnd(71)
  const active = clamp((p - 0.14) / 0.08, 0, 1) * clamp((0.98 - p) / 0.1, 0, 1)

  drawSprite(cx, CLOUD, { c: c.border, d: c.borderStrong }, px, cxPos, cyPos)

  cx.fillStyle = c.vizMem
  for (let i = 0; i < 30; i++) {
    const dx = r() * 12 * px
    const phase = r()
    const speed = 2 + r() * 1.6
    const cycle = (p * speed + phase) % 1
    cx.globalAlpha = 0.85 * (1 - cycle * 0.6) * active
    cx.fillRect(q(cxPos + px + dx), q(cyPos + 5 * px + 14 + cycle * 420), 6, 16)
  }
  cx.globalAlpha = 1
}

function drawSadBalloon(cx: CanvasRenderingContext2D, p: number, c: QuizColors): void {
  if (p <= 0.06 || p >= 0.92) return
  const up = clamp(p / 0.4, 0, 1)
  const down = clamp((p - 0.45) / 0.42, 0, 1)
  const restY = 300
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

  drawRainCloud(cx, p, c)
  drawSadBalloon(cx, p, c)
}

/* ── Tarjeta de puntaje (DOM: texto real, tokens, accesible) ──────────────── */

/** Dibuja una marca pixelada del bundle como SVG de 1×1 por píxel. */
function PixGlyph({ rows, className }: { rows: readonly string[]; className: string }) {
  const cells: { x: number; y: number }[] = []
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] !== ' ') cells.push({ x, y })
  })
  return (
    <svg className={className} viewBox={`0 0 ${rows[0].length} ${rows.length}`} aria-hidden="true">
      {cells.map((c) => (
        <rect key={`${c.x}:${c.y}`} x={c.x} y={c.y} width={1.02} height={1.02} />
      ))}
    </svg>
  )
}

interface ScoreCardProps {
  lessonTitle: string
  marks: readonly boolean[]
  score: number
  total: number
  animate: boolean
}

function ScoreCard({ lessonTitle, marks, score, total, animate }: ScoreCardProps) {
  // Dos columnas solo cuando hay bastantes preguntas; si no, una sola lee mejor.
  const columns = marks.length > 6 ? 2 : 1
  return (
    <div className="qr-card">
      <p className="qr-card-head">Quiz · {lessonTitle}</p>
      <ul className="qr-rows" style={{ ['--qr-cols' as string]: String(columns) }}>
        {marks.map((ok, i) => (
          <li
            key={i}
            className={`qr-row ${ok ? 'is-ok' : 'is-bad'}`}
            style={animate ? { animationDelay: `${ROWS_START_MS + i * ROW_STAGGER_MS}ms` } : undefined}
          >
            <span className="qr-mark">
              <PixGlyph rows={ok ? CHECK : CROSS} className="qr-glyph" />
            </span>
            <span className="qr-bar" />
          </li>
        ))}
      </ul>
      <p className="qr-score">
        <span className="qr-score-label">Puntaje</span>
        <span className="qr-score-value">
          {score}
          <span className="qr-score-total">/{total}</span>
        </span>
      </p>
    </div>
  )
}

/* ── Overlay ──────────────────────────────────────────────────────────────── */

export interface QuizResultOverlayProps {
  score: number
  total: number
  passed: boolean
  lessonTitle: string
  /** Aciertos por pregunta, EN EL ORDEN del quiz. */
  marks: readonly boolean[]
  /** Se llama al desvanecerse solo, al pulsar Saltar o al pulsar Escape. */
  onClose: () => void
}

export function QuizResultOverlay({
  score,
  total,
  passed,
  lessonTitle,
  marks,
  onClose,
}: QuizResultOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const skipRef = useRef<HTMLButtonElement | null>(null)
  const reduced = useReducedMotion()
  const colors = useThemeColors(QUIZ_TOKENS)
  const variant = resolveQuizVariant(score, total, passed)
  const [closing, setClosing] = useState(false)

  // Un solo cierre, venga de donde venga (auto, Saltar o Escape).
  const closedRef = useRef(false)
  const close = useCallback(() => {
    if (closedRef.current) return
    closedRef.current = true
    setClosing(true)
    window.setTimeout(onClose, FADE_MS)
  }, [onClose])

  // El rótulo se estampa cuando ya se revelaron todas las filas; las
  // partículas arrancan justo después.
  const bannerDelayMs = useMemo(
    () => ROWS_START_MS + marks.length * ROW_STAGGER_MS + BANNER_LEAD_MS,
    [marks.length],
  )
  const fxStartMs = bannerDelayMs + 320

  // Escape cierra; Tab no escapa del overlay (solo hay un control).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      } else if (e.key === 'Tab') {
        e.preventDefault()
        skipRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [close])

  // El foco entra al overlay al abrirse (es modal).
  useEffect(() => {
    skipRef.current?.focus()
  }, [])

  // Bloquea el scroll del fondo mientras está abierto.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  // Partículas + cierre automático.
  useEffect(() => {
    // Con reduced-motion no hay partículas NI cierre por tiempo: el usuario
    // decide cuándo cerrar (nada desaparece solo sin que pueda controlarlo).
    if (reduced) return

    const canvas = canvasRef.current
    if (canvas === null) return
    const cx = canvas.getContext('2d')
    if (cx === null) return

    const fxMs = FX_MS[variant]
    let raf = 0
    let start: number | null = null

    /** Escala «cover»: el lienzo de diseño 1280×720 cubre todo el viewport. */
    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const vw = window.innerWidth
      const vh = window.innerHeight
      canvas.width = Math.round(vw * dpr)
      canvas.height = Math.round(vh * dpr)
      canvas.style.width = `${vw}px`
      canvas.style.height = `${vh}px`
      const scale = Math.max(vw / W, vh / H) * dpr
      cx.setTransform(scale, 0, 0, scale, (vw * dpr - W * scale) / 2, (vh * dpr - H * scale) / 2)
    }

    const tick = (now: number) => {
      start ??= now
      const elapsed = now - start
      const p = (elapsed - fxStartMs) / fxMs
      // Limpiar en coordenadas de dispositivo: la transformada es de «cover».
      cx.save()
      cx.setTransform(1, 0, 0, 1, 0, 0)
      cx.clearRect(0, 0, canvas.width, canvas.height)
      cx.restore()
      if (p > 0) drawFrame(cx, Math.min(p, 1), variant, colors)
      if (p >= 1) {
        close()
        return
      }
      raf = requestAnimationFrame(tick)
    }

    fit()
    window.addEventListener('resize', fit)
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', fit)
    }
  }, [colors, reduced, variant, fxStartMs, close])

  const verdict = passed ? 'Aprobado' : 'No aprobado'
  const overlay = (
    <div
      className={`quiz-overlay${closing ? ' is-closing' : ''}`}
      data-variant={variant}
      data-testid="quiz-result-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Resultado del quiz: ${score} de ${total}. ${verdict}.`}
      onClick={close}
    >
      {!reduced && <canvas ref={canvasRef} className="quiz-overlay-fx" aria-hidden="true" />}

      {/* stopPropagation: hacer clic EN la tarjeta no cierra, hacer clic fuera sí. */}
      <div
        className="quiz-overlay-stage"
        style={{ ['--qr-banner-delay' as string]: `${bannerDelayMs}ms` }}
        onClick={(e) => e.stopPropagation()}
      >
        <ScoreCard
          lessonTitle={lessonTitle}
          marks={marks}
          score={score}
          total={total}
          animate={!reduced}
        />
        <p className="quiz-overlay-banner">{BANNERS[variant]}</p>
      </div>

      <button ref={skipRef} type="button" className="quiz-overlay-skip" onClick={close}>
        {reduced ? 'Cerrar' : 'Saltar'}
      </button>
    </div>
  )

  return createPortal(overlay, document.body)
}
