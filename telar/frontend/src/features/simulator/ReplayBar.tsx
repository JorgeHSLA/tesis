// ReplayBar — controles de la ejecución «como un editor de video»: pausar,
// retroceder, adelantar, saltar a un momento (arrastrando la línea de tiempo) y
// cambiar la velocidad con un deslizante.
//
// Es SOLO visual (lib/replay.ts): mueve lo que se MUESTRA, nunca lo que se
// MIDIÓ. Primero la ejecución corre de verdad; mientras corre, la línea de
// tiempo marca «en vivo» y solo se puede pausar la ilustración o cambiar su
// velocidad. Al terminar se desbloquea el resto.
import { Icon, IconPause, IconPlay } from '../../components/icons/icons'
import { Help } from '../../components/ui/helpTexts'
import { SPEED_MAX, SPEED_MIN, SPEED_STEP, fmtClock, fmtSpeed } from '../../lib/replay'

const IconToStart = (p: { size?: number }) => (
  <Icon {...p}>
    <path d="M5 5v14" />
    <path d="M19 5l-10 7 10 7z" />
  </Icon>
)
const IconBack = (p: { size?: number }) => (
  <Icon {...p}>
    <path d="M11 6l-6 6 6 6" />
    <path d="M19 6l-6 6 6 6" />
  </Icon>
)
const IconForward = (p: { size?: number }) => (
  <Icon {...p}>
    <path d="M13 6l6 6-6 6" />
    <path d="M5 6l6 6-6 6" />
  </Icon>
)

/** Cuánto saltan «retroceder» y «adelantar». */
export const STEP_MS = 1000

export interface ReplayBarProps {
  /** La ejecución sigue corriendo: la línea de tiempo marca «en vivo» y no se mueve. */
  live: boolean
  /** Instante mostrado y duración total, en ms. */
  time: number
  duration: number
  playing: boolean
  speed: number
  onToggle: () => void
  onSeek: (ms: number) => void
  onStep: (deltaMs: number) => void
  onRestart: () => void
  onSpeed: (speed: number) => void
  /** No hay nada que reproducir (el job terminó sin datos con hora). */
  empty?: boolean
}

export function ReplayBar({
  live,
  time,
  duration,
  playing,
  speed,
  onToggle,
  onSeek,
  onStep,
  onRestart,
  onSpeed,
  empty = false,
}: ReplayBarProps) {
  const locked = live || empty
  return (
    <section className="replay-bar" aria-label="Reproductor de la ejecución">
      <div className="replay-transport" role="group" aria-label="Controles">
        <button type="button" className="replay-btn" onClick={onRestart} disabled={locked} aria-label="Ir al principio" title="Ir al principio">
          <IconToStart size={15} />
        </button>
        <button
          type="button"
          className="replay-btn"
          onClick={() => onStep(-STEP_MS)}
          disabled={locked}
          aria-label="Retroceder 1 segundo"
          title="Retroceder 1 s"
        >
          <IconBack size={15} />
        </button>
        <button
          type="button"
          className="replay-btn replay-btn--main"
          onClick={onToggle}
          disabled={empty}
          aria-label={playing ? 'Pausar' : live ? 'Reanudar la ilustración' : 'Reproducir'}
          aria-pressed={playing}
          title={live ? 'Pausa solo la ilustración; la ejecución real sigue corriendo' : playing ? 'Pausar' : 'Reproducir'}
        >
          {playing ? <IconPause size={16} /> : <IconPlay size={16} />}
        </button>
        <button
          type="button"
          className="replay-btn"
          onClick={() => onStep(STEP_MS)}
          disabled={locked}
          aria-label="Adelantar 1 segundo"
          title="Adelantar 1 s"
        >
          <IconForward size={15} />
        </button>
      </div>

      <div className="replay-timeline">
        <input
          type="range"
          className="replay-scrubber"
          min={0}
          max={Math.max(1, duration)}
          step={10}
          value={Math.min(time, Math.max(1, duration))}
          disabled={locked}
          aria-label="Momento de la ejecución"
          aria-valuetext={live ? `en vivo, ${fmtClock(time)}` : `${fmtClock(time)} de ${fmtClock(duration)}`}
          onChange={(e) => onSeek(Number(e.currentTarget.value))}
          style={{ ['--pct' as string]: `${duration > 0 ? Math.min(100, (time / duration) * 100) : 0}%` }}
        />
        <span className="replay-clock" aria-hidden="true">
          {live ? (
            <>
              <span className="replay-live">● en vivo</span> {fmtClock(time)}
            </>
          ) : (
            <>
              {fmtClock(time)} / {fmtClock(duration)}
            </>
          )}
        </span>
      </div>

      <label className="replay-speed">
        <span className="replay-speed-label">Velocidad</span>
        <input
          type="range"
          min={SPEED_MIN}
          max={SPEED_MAX}
          step={SPEED_STEP}
          value={speed}
          aria-label="Velocidad de la ilustración"
          aria-valuetext={fmtSpeed(speed)}
          onChange={(e) => onSpeed(Number(e.currentTarget.value))}
        />
        <span className="replay-speed-value">{fmtSpeed(speed)}</span>
      </label>
      <span className="replay-help">{Help.reproductor}</span>
    </section>
  )
}
