// LiveTerminalCard — terminal del live (frontend-spec §6.3): logs REALES del
// WS con formato [HH:MM:SS] stream texto. Estado vacío dirigido por la FASE
// del WS (sin heurísticas de tiempo): creating → «Creando contenedor…»;
// compiling → «Compilando con Numba…». Auto-scroll con pausa por scroll
// manual y botón «↓ seguir salida» (§5.3). logsTruncated → línea fija ámbar.
// logsGap (CU-07.3) → aviso ámbar al principio: faltan líneas intermedias.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Card } from '../../components/ui/Card'
import { Terminal, TermLine } from '../../components/ui/Terminal'
import type { LogLine, UiPhase } from '../../stores/jobStore'
import { useReducedMotion } from '../../hooks/useReducedMotion'

const FOLLOW_THRESHOLD_PX = 30

export interface LiveTerminalCardProps {
  jobId: string
  phase: UiPhase
  logs: LogLine[]
  logsTruncated: boolean
  /** CU-07.3: hubo un salto de seq (líneas perdidas en el vivo). */
  logsGap?: boolean
}

function tsToClock(ts: string): string {
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('es', { hour12: false })
}

function placeholderFor(phase: UiPhase): string | null {
  switch (phase) {
    case 'idle':
    case 'connecting':
      return 'Conectando con el job…'
    case 'queued':
    case 'creating':
      return 'Creando contenedor…'
    case 'compiling':
      return 'Compilando con Numba (la primera vez tarda unos segundos)…'
    default:
      return null
  }
}

export function LiveTerminalCard({ jobId, phase, logs, logsTruncated, logsGap = false }: LiveTerminalCardProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const [follow, setFollow] = useState(true)
  const reducedMotion = useReducedMotion()

  // Auto-scroll mientras `follow` esté activo (§5.3).
  useEffect(() => {
    const el = bodyRef.current
    if (el != null && follow) el.scrollTop = el.scrollHeight
  }, [logs, follow])

  const onScroll = useCallback(() => {
    const el = bodyRef.current
    if (el == null) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_THRESHOLD_PX
    setFollow(atBottom)
  }, [])

  const resumeFollow = useCallback(() => {
    setFollow(true)
    const el = bodyRef.current
    if (el != null) el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion ? 'auto' : 'smooth' })
  }, [reducedMotion])

  const placeholder = logs.length === 0 ? placeholderFor(phase) : null

  return (
    <Card className="terminal-card">
      <div style={{ position: 'relative', height: '100%' }}>
        <Terminal
          ref={bodyRef}
          title={`docker logs -f telar-job-${jobId} · en vivo`}
          label="Salida en vivo de la ejecución"
          bodyClassName="live-terminal-body"
        >
          {logsGap && (
            <TermLine
              tagClass="term-amber"
              tag="— Parte de la salida no se pudo recuperar; el output completo queda en Resultados —"
            />
          )}
          {placeholder != null && <TermLine tagClass="term-dim" tag={placeholder} />}
          {logs.map((line, i) => (
            <TermLine
              key={`${line.seq}-${i}`}
              time={tsToClock(line.ts)}
              tagClass={line.stream === 'stderr' ? 'term-red' : 'term-green'}
              tag={line.stream}
            >
              {line.text}
            </TermLine>
          ))}
          {logsTruncated && <TermLine tagClass="term-amber" tag="— salida truncada (límite 256 KB) —" />}
        </Terminal>
        {/* Captura del scroll manual: listener sobre el body del terminal */}
        <ScrollWatcher targetRef={bodyRef} onScroll={onScroll} />
        {!follow && (
          <button type="button" className="follow-btn" onClick={resumeFollow}>
            ↓ seguir salida
          </button>
        )}
      </div>
    </Card>
  )
}

/** Adjunta el listener de scroll al body del Terminal (que expone solo ref). */
function ScrollWatcher({
  targetRef,
  onScroll,
}: {
  targetRef: React.RefObject<HTMLDivElement | null>
  onScroll: () => void
}) {
  useEffect(() => {
    const el = targetRef.current
    if (el == null) return
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [targetRef, onScroll])
  return null
}
