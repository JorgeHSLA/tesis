// PixelStudyScene — viñeta pixel-art de Home: un estudiante de madrugada, con
// lluvia en la ventana. Port a <canvas> + rAF de «Estudiante Pixel Art» (el
// bundle DC original ya dibujaba en un canvas 240×135 y lo servía como
// dataURL; aquí se pinta directo, sin @babel/standalone ni `unsafe-eval`).
//
// COLOR: ni un hex. Los ~20 roles salen de tokens.css en runtime
// (useThemeColors) porque el canvas no resuelve var(); las variantes de cada
// material se derivan con mix/shade. Al cambiar `data-theme` la paleta se
// recalcula y la escena se repinta.
// MOTION: con prefers-reduced-motion no se arranca el bucle — se pinta UN
// fotograma fijo, que es el póster estático.
import { useEffect, useRef } from 'react'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { useThemeColors } from '../../hooks/useThemeColors'
import { mix, shade, withAlpha } from '../../lib/themeColors'

/** Lienzo lógico: son PÍXELES de verdad, se escala con image-rendering. */
const W = 240
const H = 135
/** Duración del bucle y cadencia del pixel art (el original cuantiza a 30 fps). */
const LOOP_SECONDS = 10
const FPS = 30
/** Fotograma del póster con reduced-motion: la lámpara y el vapor se ven bien. */
const POSTER_TIME = 3.4

export type RainIntensity = 'suave' | 'normal' | 'fuerte'

const SCENE_TOKENS = {
  surface: '--surface',
  surface2: '--surface-2',
  surface3: '--surface-3',
  border: '--border',
  borderStrong: '--border-strong',
  textMuted: '--text-muted',
  accent: '--accent',
  warn: '--warn',
  success: '--success',
  danger: '--danger',
  vizMem: '--viz-mem',
  vizNode: '--viz-node',
  ink: '--scene-ink',
  skin: '--scene-skin',
  hair: '--scene-hair',
  wood: '--scene-wood',
  night: '--scene-night',
  device: '--scene-device',
  screen: '--scene-screen',
} as const

type SceneColors = Record<keyof typeof SCENE_TOKENS, string>

/** Paleta completa: tokens + las variantes de cada material. */
interface Palette {
  readonly wall: string
  readonly baseboard: string
  readonly seam: string
  readonly floor: string
  readonly floorEdge: string
  readonly floorLine: string
  readonly frame: string
  readonly frameLit: string
  readonly sill: string
  readonly sillDark: string
  readonly night: string
  readonly building: string
  readonly buildingFar: string
  readonly windowLit: string
  readonly cityLight: string
  readonly cityLightDim: string
  readonly rain: string
  readonly posterFrame: string
  readonly posterPaper: string
  readonly posterRed: string
  readonly posterBlue: string
  readonly posterPin: string
  readonly shirt: string
  readonly shirtDark: string
  readonly skin: string
  readonly skinDark: string
  readonly skinShut: string
  readonly mouth: string
  readonly hair: string
  readonly hairLit: string
  readonly eyes: string
  readonly deskTop: string
  readonly deskLit: string
  readonly deskFront: string
  readonly deskEdge: string
  readonly deskLeg: string
  readonly books: readonly string[]
  readonly pageMark: string
  readonly cup: string
  readonly cupBase: string
  readonly coffee: string
  readonly coffeeLit: string
  readonly steam: string
  readonly device: string
  readonly deviceLit: string
  readonly deviceDark: string
  readonly vent: string
  readonly ventDark: string
  readonly screen: string
  readonly screenSoft: string
  readonly lampArm: string
  readonly lampBase: string
  readonly lampShade: string
  readonly lampShadeDark: string
  readonly lampShadeLit: string
  readonly lampGlow: string
  readonly ink: string
}

function buildPalette(c: SceneColors): Palette {
  return {
    wall: c.surface,
    baseboard: c.surface2,
    seam: mix(c.surface2, c.border, 0.5),
    floor: c.surface3,
    floorEdge: c.border,
    floorLine: mix(c.surface3, c.border, 0.55),

    frame: c.borderStrong,
    frameLit: shade(c.borderStrong, 0.14),
    sill: c.borderStrong,
    sillDark: shade(c.borderStrong, -0.22),
    night: c.night,
    building: mix(c.night, c.screen, 0.12),
    buildingFar: mix(c.night, c.screen, 0.2),
    windowLit: mix(c.screen, c.night, 0.15),
    cityLight: c.warn,
    cityLightDim: shade(c.warn, -0.25),
    rain: mix(c.night, c.screen, 0.45),

    posterFrame: c.border,
    posterPaper: c.surface2,
    posterRed: c.accent,
    posterBlue: c.vizMem,
    posterPin: c.borderStrong,

    shirt: c.vizNode,
    shirtDark: shade(c.vizNode, -0.2),
    skin: c.skin,
    skinDark: shade(c.skin, -0.14),
    skinShut: shade(c.skin, -0.24),
    mouth: shade(c.skin, -0.3),
    hair: c.hair,
    hairLit: shade(c.hair, 0.1),
    eyes: c.ink,

    deskTop: c.wood,
    deskLit: shade(c.wood, 0.14),
    deskFront: shade(c.wood, -0.14),
    deskEdge: shade(c.wood, -0.24),
    deskLeg: shade(c.wood, -0.32),

    // Serie categórica de los lomos: reutiliza los colores de estado/gráfica.
    books: [c.danger, c.vizMem, c.warn, c.success, c.accent],
    pageMark: c.surface2,

    cup: c.surface2,
    cupBase: c.border,
    coffee: shade(c.wood, -0.3),
    coffeeLit: shade(c.wood, -0.1),
    steam: c.textMuted,

    device: c.device,
    deviceLit: shade(c.device, 0.14),
    deviceDark: shade(c.device, -0.18),
    vent: shade(c.device, 0.06),
    ventDark: shade(c.device, -0.1),
    screen: c.screen,
    screenSoft: mix(c.screen, c.surface, 0.25),

    lampArm: shade(c.device, 0.16),
    lampBase: c.device,
    lampShade: c.warn,
    lampShadeDark: shade(c.warn, -0.18),
    lampShadeLit: shade(c.warn, 0.6),
    lampGlow: shade(c.warn, 0.45),
    ink: c.ink,
  }
}

const TAU = Math.PI * 2
const RAIN_DROPS: Record<RainIntensity, number> = { suave: 8, normal: 16, fuerte: 26 }

/**
 * Pinta un fotograma. Port literal del `draw(t, rain)` original: la geometría
 * (coordenadas y tamaños) se conserva tal cual; SOLO cambian los colores, que
 * ahora vienen de la paleta de la app.
 */
function draw(cx: CanvasRenderingContext2D, t: number, rain: RainIntensity, p: Palette): void {
  const R = (color: string, x: number, y: number, w = 1, h = 1) => {
    cx.fillStyle = color
    cx.fillRect(x, y, w, h)
  }
  const A = (alpha: number) => {
    cx.globalAlpha = alpha
  }

  cx.globalAlpha = 1

  // ── pared / rodapié / suelo ──────────────────────────────────────────────
  R(p.wall, 0, 0, W, H)
  R(p.baseboard, 0, 96, W, 8)
  R(p.floor, 0, 104, W, 31)
  R(p.floorEdge, 0, 104, W, 1)
  R(p.floorLine, 0, 114, W, 1)
  R(p.floorLine, 0, 126, W, 1)
  A(0.5)
  R(p.seam, 0, 96, W, 1)
  A(1)

  // ── ventana con lluvia ───────────────────────────────────────────────────
  const wx = 26
  const wy = 12
  const ww = 48
  const wh = 50
  R(p.frame, wx - 3, wy - 3, ww + 6, wh + 6)
  R(p.frameLit, wx - 3, wy - 3, ww + 6, 1)
  R(p.night, wx, wy, ww, wh)
  R(p.buildingFar, wx + 33, wy + 5, 8, 7)
  R(p.windowLit, wx + 35, wy + 6, 4, 3)
  R(p.building, wx + 2, wy + 38, 10, 12)
  R(p.building, wx + 15, wy + 34, 8, 16)
  R(p.building, wx + 26, wy + 40, 9, 10)
  R(p.building, wx + 38, wy + 36, 8, 14)
  R(p.cityLightDim, wx + 5, wy + 41, 1, 1)
  R(p.cityLight, wx + 17, wy + 37, 1, 1)
  if (Math.sin((TAU * t) / 2.5) > 0) R(p.cityLight, wx + 40, wy + 39, 1, 1)

  const drops = RAIN_DROPS[rain]
  for (let i = 0; i < drops; i++) {
    const dx = wx + 2 + ((i * 37) % (ww - 5))
    const n = 12 + (i % 6)
    const y = (((i * 13) % wh) + t * ((n * wh) / 10)) % wh
    R(p.rain, dx, wy + y, 1, Math.min(3, wh - y))
  }
  R(p.frame, wx + ww / 2 - 1, wy, 2, wh)
  R(p.frame, wx, wy + wh / 2 - 1, ww, 2)
  R(p.sill, wx - 6, wy + wh + 3, ww + 12, 4)
  R(p.sillDark, wx - 6, wy + wh + 7, ww + 12, 2)

  // ── póster ───────────────────────────────────────────────────────────────
  R(p.posterFrame, 190, 8, 28, 30)
  R(p.posterPaper, 191, 9, 26, 28)
  R(p.posterRed, 195, 14, 18, 3)
  R(p.posterBlue, 195, 20, 12, 3)
  R(p.posterBlue, 195, 26, 16, 3)
  R(p.posterPin, 203, 10, 2, 2)
  A(0.12)
  R(p.ink, 190, 38, 29, 2)
  A(1)

  // ── estudiante ───────────────────────────────────────────────────────────
  const bob = Math.round(Math.sin((TAU * t) / 2))
  const a = Math.floor(t / 0.2) % 2
  const blink = (t > 2 && t < 2.18) || (t > 5.4 && t < 5.58) || (t > 8.2 && t < 8.38)
  R(p.shirt, 110, 63, 20, 4)
  R(p.shirt, 108, 67, 24, 25)
  R(p.shirtDark, 108, 85, 24, 7)
  const ly = 69 + a
  const ry = 69 + (1 - a)
  R(p.shirt, 102, ly, 6, 21)
  R(p.shirtDark, 102, ly + 15, 6, 6)
  R(p.shirt, 132, ry, 6, 21)
  R(p.shirtDark, 132, ry + 15, 6, 6)
  R(p.skinDark, 117, 59 + bob, 7, 5)
  const y0 = 43 + bob
  R(p.skin, 114, y0 + 8, 12, 12)
  R(p.hair, 113, y0 + 5, 15, 3)
  R(p.hairLit, 114, y0 + 5, 13, 1)
  R(p.hair, 113, y0 + 8, 2, 4)
  R(p.hair, 126, y0 + 8, 2, 4)
  R(p.hair, 115, y0 + 8, 11, 1)
  if (!blink) {
    R(p.eyes, 115, y0 + 13, 2, 2)
    R(p.eyes, 121, y0 + 13, 2, 2)
  } else {
    R(p.skinShut, 115, y0 + 14, 3, 1)
    R(p.skinShut, 120, y0 + 14, 3, 1)
  }
  R(p.mouth, 118, y0 + 18, 3, 1)
  // Reflejo azulado de la pantalla en la cara.
  const glow = 0.1 + 0.04 * Math.sin(TAU * 0.5 * t)
  A(glow)
  R(p.screen, 114, y0 + 12, 12, 8)
  A(1)

  // ── mesa ─────────────────────────────────────────────────────────────────
  R(p.deskTop, 22, 87, 200, 6)
  R(p.deskLit, 22, 87, 200, 1)
  R(p.deskFront, 22, 93, 200, 30)
  R(p.deskEdge, 22, 93, 200, 2)
  R(p.deskLeg, 30, 123, 6, 12)
  R(p.deskLeg, 208, 123, 6, 12)
  A(0.18)
  R(p.ink, 20, 123, 204, 4)
  A(1)

  // ── cuadernos ────────────────────────────────────────────────────────────
  const stack: readonly [string, number, number, number][] = [
    [p.books[0], 34, 83, 34],
    [p.books[1], 36, 79, 31],
    [p.books[2], 33, 75, 33],
    [p.books[3], 37, 71, 29],
  ]
  for (const [color, x, y, w] of stack) {
    R(color, x, y, w, 4)
    A(0.3)
    R(p.ink, x, y + 3, w, 1)
    A(1)
    R(p.pageMark, x + w - 2, y + 1, 2, 2)
  }
  R(p.books[1], 186, 83, 22, 4)
  A(0.3)
  R(p.ink, 186, 86, 22, 1)
  A(1)
  R(p.pageMark, 206, 84, 2, 2)
  R(p.books[0], 188, 79, 19, 4)
  A(0.3)
  R(p.ink, 188, 82, 19, 1)
  A(1)
  R(p.pageMark, 204, 80, 2, 2)

  // ── taza + vapor ─────────────────────────────────────────────────────────
  R(p.cup, 78, 78, 11, 9)
  R(p.cupBase, 78, 85, 11, 2)
  R(p.coffee, 79, 79, 9, 2)
  R(p.coffeeLit, 80, 79, 3, 1)
  R(p.cup, 89, 80, 3, 1)
  R(p.cup, 91, 81, 1, 3)
  R(p.cup, 89, 84, 3, 1)
  for (let k = 0; k < 3; k++) {
    const phase = (t * 0.7 + k / 3) % 1
    A(0.4 * (1 - phase))
    R(p.steam, 82 + Math.round(Math.sin((phase + k) * 6) * 2), 78 - phase * 12, 1, 2)
  }
  A(1)

  // ── portátil ─────────────────────────────────────────────────────────────
  R(p.device, 106, 71, 30, 17)
  R(p.deviceLit, 106, 71, 30, 1)
  R(p.deviceLit, 106, 71, 1, 17)
  R(p.deviceDark, 135, 71, 1, 17)
  A(0.45 + glow)
  R(p.screen, 119, 78, 4, 4)
  A(1)
  A(0.3 + glow)
  R(p.screenSoft, 105, 70, 32, 1)
  A(1)

  // ── segundo monitor (se ve por detrás) ───────────────────────────────────
  R(p.lampBase, 152, 84, 16, 3)
  R(p.lampArm, 158, 74, 4, 10)
  R(p.device, 141, 52, 40, 24)
  R(p.deviceLit, 141, 52, 40, 1)
  R(p.deviceDark, 141, 75, 40, 1)
  R(p.deviceDark, 180, 52, 1, 24)
  R(p.vent, 156, 62, 12, 8)
  R(p.ventDark, 157, 63, 10, 6)
  for (let i = 0; i < 5; i++) R(p.ventDark, 145, 56 + i * 2, 8, 1)
  for (let i = 0; i < 5; i++) R(p.ventDark, 170, 56 + i * 2, 7, 1)
  R(p.deviceDark, 168, 70, 10, 1)
  // Luz que escapa por los bordes del monitor hacia la pared.
  A(0.1 + glow * 0.4)
  R(p.screen, 140, 51, 42, 1)
  R(p.screen, 139, 52, 1, 24)
  R(p.screen, 182, 52, 1, 24)
  A(1)
  // Resplandor difuso escalonado (sin bordes rectos sobre la pared).
  for (let y = 76; y < 88; y += 2) {
    const k = (y - 76) / 12
    A((0.05 + glow * 0.35) * (1 - k * 0.7))
    const x0 = Math.round(146 - k * 8)
    const x1 = Math.round(176 + k * 8)
    R(p.screen, x0, y, x1 - x0, 2)
  }
  for (let y = 74; y < 88; y += 2) {
    const k = (y - 74) / 14
    A((0.06 + glow * 0.4) * (1 - k * 0.6))
    const x0 = Math.round(108 - k * 10)
    const x1 = Math.round(134 + k * 10)
    R(p.screen, x0, y, x1 - x0, 2)
  }
  A(1)

  // ── lámpara ──────────────────────────────────────────────────────────────
  R(p.lampBase, 196, 83, 22, 4)
  R(p.lampArm, 198, 82, 18, 1)
  R(p.lampArm, 210, 52, 3, 31)
  R(p.lampArm, 200, 48, 13, 3)
  R(p.lampShade, 188, 46, 18, 4)
  R(p.lampShade, 183, 50, 18, 4)
  R(p.lampShadeDark, 183, 53, 18, 1)
  R(p.lampShadeLit, 182, 52, 5, 3)
  const flicker = 0.1 + 0.02 * Math.sin(TAU * 0.8 * t) + 0.015 * Math.sin(TAU * 1.3 * t)
  for (let y = 58; y < 88; y += 2) {
    const k = (y - 58) / 30
    A(Math.max(0.02, flicker) * (1 - k) * 0.85)
    const x0 = Math.round(192 - k * 44)
    const x1 = Math.round(206 + k * 10)
    R(p.lampGlow, x0, y, x1 - x0, 2)
  }
  A(1)
  // Charco de luz sobre la mesa.
  for (let i = 0; i < 6; i++) {
    A(Math.max(0.05, flicker * 1.4) * (1 - i / 7))
    const x0 = Math.max(34, 152 - i * 8)
    const x1 = Math.min(220, 214 + i * 2)
    R(p.lampGlow, x0, 87 + i, x1 - x0, 1)
  }
  A(1)
  // Viñeta cálida sobre las esquinas: ata la escena a la paleta de la app.
  A(1)
  cx.fillStyle = withAlpha(p.ink, 0.06)
  cx.fillRect(0, 0, W, 6)
  cx.fillRect(0, H - 4, W, 4)
}

export interface PixelStudySceneProps {
  /** Densidad de lluvia en la ventana. */
  rain?: RainIntensity
  /** Nombre accesible del contenedor. */
  label?: string
  className?: string
}

export function PixelStudyScene({
  rain = 'normal',
  label = 'Ilustración animada: una estudiante repasando de madrugada mientras llueve',
  className,
}: PixelStudySceneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const reduced = useReducedMotion()
  const colors = useThemeColors(SCENE_TOKENS)

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const cx = canvas.getContext('2d')
    if (cx === null) return

    const palette = buildPalette(colors)

    if (reduced) {
      draw(cx, POSTER_TIME, rain, palette)
      return
    }

    let raf = 0
    let start: number | null = null
    let lastFrame = -1
    let visible = true

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      if (!visible) return
      start ??= now
      const elapsed = (now - start) / 1000
      // Cuantizar a 30 fps: el pixel art no gana nada a 60 y ahorra CPU.
      const frame = Math.round(elapsed * FPS)
      if (frame === lastFrame) return
      lastFrame = frame
      draw(cx, (frame / FPS) % LOOP_SECONDS, rain, palette)
    }

    // Pausar fuera de pantalla: es decoración, no debe quemar CPU en Electron.
    let observer: IntersectionObserver | undefined
    if (typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver(
        (entries) => {
          visible = entries.some((e) => e.isIntersecting)
        },
        { threshold: 0 },
      )
      observer.observe(canvas)
    }

    draw(cx, 0, rain, palette)
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      observer?.disconnect()
    }
  }, [colors, rain, reduced])

  return (
    <canvas
      ref={canvasRef}
      className={className === undefined ? 'pixel-scene' : `pixel-scene ${className}`}
      width={W}
      height={H}
      role="img"
      aria-label={label}
      data-testid="home-pixel-scene"
      style={{ aspectRatio: `${W} / ${H}` }}
    />
  )
}
