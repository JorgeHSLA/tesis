// QuickRerun — «Probar con otros hilos»: cambiar el número de hilos y volver a
// ejecutar SIN volver a la pantalla inicial del simulador.
//
// Salió de las pruebas de usabilidad (E03, E17, y varios más con «¿cómo vuelvo
// para cambiar los hilos?»): para comparar 1 hilo contra 2 había que salir de la
// pantalla de la ejecución, regresar a «Configurar», mover el control y lanzar.
//
// Dos piezas:
//  · `useRerun(job)`    — la lógica (hilos elegidos, lanzar el job nuevo).
//  · `RerunControls`    — el deslizante de hilos (y, opcionalmente, su botón).
// Solo vive en la pantalla de ejecución: el botón «Re-ejecutar este ejemplo» va en
// la cabecera, junto a «Ver resultados», y el deslizante queda solo. En Resultados
// ya no hay panel (no aportaba: ahí se ve el resultado, no se configura).
//
// Lanza un job NUEVO con el mismo código, nombre y límite de tiempo que el
// original; solo cambian los hilos. El payload sigue la misma regla que el
// lanzamiento normal (SimulatorIdle): con ejemplo sin editar se manda solo su
// id; con código propio o editado, el código. Si el ejemplo fija sus hilos
// (entornoDatos…) o barre 1·2·4·8 por su cuenta, NO hay deslizante (no
// cambiaría nada) y el job se repite tal cual, sin enviar `threads`.
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { getExample } from '../../api/content'
import { createJob } from '../../api/jobs'
import type { ExampleDetailDto, JobCreateRequestDto, JobDetailDto } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { RangeField } from '../../components/ui/RangeField'
import { IconPlay } from '../../components/icons/icons'
import { useSystemInfo } from '../../hooks/useSystemInfo'

export type RerunSource = Pick<
  JobDetailDto,
  'example_id' | 'lesson_id' | 'source_code' | 'source_kind' | 'filename' | 'threads' | 'timeout_s'
>

/**
 * Cuerpo del POST /jobs para repetir `job`. `threads = null` ⇒ no se envía (el
 * ejemplo fija o barre sus hilos). Puro: se prueba aparte.
 */
export function rerunRequest(job: RerunSource, threads: number | null): JobCreateRequestDto {
  const edited = job.source_kind === 'editor' && job.example_id != null
  return {
    ...(job.example_id != null
      ? { example_id: job.example_id, ...(job.lesson_id != null ? { lesson_id: job.lesson_id } : null) }
      : { filename: job.filename }),
    ...(job.example_id == null || edited ? { code: job.source_code } : null),
    ...(threads != null ? { threads } : null),
    // 0 = sin límite en el job original; el POST exige 5..120, así que se omite.
    ...(job.timeout_s > 0 ? { timeout_s: job.timeout_s } : null),
  }
}

export interface Rerun {
  /** ¿Se puede elegir el número de hilos? (no si el ejemplo los fija o los barre). */
  adjustable: boolean
  /** Ya se sabe todo lo necesario (equipo y ejemplo consultados). */
  ready: boolean
  max: number
  threads: number
  setThreads: (n: number) => void
  /** Hilos del job original. */
  originalThreads: number
  /** El job original sigue corriendo: se espera a que termine para no competir por CPU. */
  running: boolean
  launching: boolean
  error: string | null
  /** Puede lanzarse ya (listo, sin ejecución en curso ni otra lanzándose). */
  canLaunch: boolean
  launch: () => Promise<void>
}

export function useRerun(job: RerunSource | null, running = false): Rerun {
  const navigate = useNavigate()
  const { data: system } = useSystemInfo()
  const exampleId = job?.example_id ?? null
  const [example, setExample] = useState<ExampleDetailDto | null>(null)
  const [exampleReady, setExampleReady] = useState(exampleId == null)
  const [threads, setThreads] = useState(job?.threads ?? 1)
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Los hilos del job original son el punto de partida (y se reajustan si cambia el job).
  const originalThreads = job?.threads ?? 1
  useEffect(() => {
    setThreads(originalThreads)
  }, [originalThreads])

  // Se necesita saber si el ejemplo deja elegir los hilos.
  useEffect(() => {
    if (exampleId == null) {
      setExample(null)
      setExampleReady(true)
      return
    }
    let alive = true
    setExampleReady(false)
    getExample(exampleId)
      .then((d) => alive && setExample(d))
      .catch(() => alive && setExample(null)) // sin metadata se asume configurable
      .finally(() => alive && setExampleReady(true))
    return () => {
      alive = false
    }
  }, [exampleId])

  const adjustable = example == null || example.threads_configurable
  const max = Math.max(1, system?.max_threads ?? 1)
  const value = Math.min(Math.max(1, threads), max)
  const ready = job != null && system != null && exampleReady

  const launch = useCallback(async () => {
    if (job == null || !ready || launching || running) return
    setLaunching(true)
    setError(null)
    try {
      const data = await createJob(rerunRequest(job, adjustable ? value : null))
      navigate(`/simulador/${data.job_id}`, {
        state: {
          wsUrl: data.ws_url,
          threadsNote: data.threads_note,
          filename: job.filename,
          threads: data.threads_effective,
        },
      })
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : 'No se pudo lanzar la ejecución.')
      setLaunching(false)
    }
  }, [job, ready, launching, running, adjustable, value, navigate])

  return {
    adjustable,
    ready,
    max,
    threads: value,
    setThreads,
    originalThreads,
    running,
    launching,
    error,
    canLaunch: ready && !launching && !running,
    launch,
  }
}

const hilos = (n: number): string => `${n} ${n === 1 ? 'hilo' : 'hilos'}`

export interface RerunControlsProps {
  rerun: Rerun
  /** Muestra su propio botón «Ejecutar con N hilos» (Resultados). En la pantalla de ejecución va en la cabecera. */
  showButton?: boolean
}

export function RerunControls({ rerun, showButton = false }: RerunControlsProps) {
  if (!rerun.ready || !rerun.adjustable) return null
  const { threads, originalThreads, running } = rerun
  return (
    <section className="quick-rerun" aria-label="Probar con otros hilos">
      <div className="quick-rerun-field">
        <RangeField
          label="Probar con otros hilos"
          valueText={hilos(threads)}
          min={1}
          max={rerun.max}
          value={threads}
          onChange={rerun.setThreads}
          ariaValueText={hilos(threads)}
          hint={
            running
              ? 'Podrás repetir con otros hilos cuando esta ejecución termine.'
              : threads === originalThreads
                ? `Esta ejecución usó ${hilos(originalThreads)}. Mueve el control para compararla con otra.`
                : undefined
          }
        />
      </div>
      {showButton && (
        <Button variant="primary" onClick={() => void rerun.launch()} disabled={!rerun.canLaunch}>
          <IconPlay size={14} /> {rerun.launching ? 'Lanzando…' : `Ejecutar con ${hilos(threads)}`}
        </Button>
      )}
      {rerun.error != null && (
        <div className="field-hint error" role="alert">
          {rerun.error}
        </div>
      )}
    </section>
  )
}

