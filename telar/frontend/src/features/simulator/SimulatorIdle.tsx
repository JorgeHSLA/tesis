// SimulatorIdle — pantalla /simulador en reposo (frontend-spec §6.2).
// ConfigPanel (grid 1fr 1fr): CodePanel (izq) + card «Reparto de trabajo»
// (der: ExamplePicker + ThreadTopology + ThreadsField + fila --cpus) y card
// «Opciones avanzadas». Lanzar → POST /api/v1/jobs con la semántica de
// fuentes del contrato §7.1 (example_id/code según edición; threads OMITIDO
// en fixed/sweep — §9) → navigate('/simulador/{job_id}').
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { getExample, getModules } from '../../api/content'
import { ApiError } from '../../api/client'
import { createJob } from '../../api/jobs'
import type { ExampleDetailDto, JobCreateRequestDto, ModuleDto, SystemInfoDto } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { Card, CardHead } from '../../components/ui/Card'
import { Chip } from '../../components/ui/Chip'
import { ErrorState } from '../../components/ui/ErrorState'
import { Skeleton } from '../../components/ui/Skeleton'
import { IconCluster, IconPlay } from '../../components/icons/icons'
import { ThreadTopology } from '../../components/viz/ThreadTopology'
import { getPlatform } from '../../hooks/usePlatform'
import { useSystemInfo } from '../../hooks/useSystemInfo'
import { clampThreads, type SimConfig } from '../../lib/simConfig'
import { AdvancedOptions } from './AdvancedOptions'
import { CodePanel, type PickedFile } from './CodePanel'
import { ExamplePicker } from './ExamplePicker'
import { SavedConfigs } from './SavedConfigs'
import { effectiveCpus, shouldSendThreads, ThreadsField } from './ThreadsField'

/** Nombre de archivo del simulador en blanco (y al pasar a «Código propio»). */
const DEFAULT_FILENAME = 'main.py'

/** navigate-state de Re-ejecutar (lib/simConfig RerunState). Se lee con
 *  valores por defecto: basta `code` (+ `filename`) para precargar código propio. */
function readPreload(state: unknown): SimConfig | null {
  if (state == null || typeof state !== 'object') return null
  const s = state as Partial<SimConfig>
  if (typeof s.code !== 'string') return null
  return {
    example_id: typeof s.example_id === 'string' ? s.example_id : null,
    code: s.code,
    filename: typeof s.filename === 'string' ? s.filename : DEFAULT_FILENAME,
    threads: typeof s.threads === 'number' ? s.threads : 4,
    timeout_s: typeof s.timeout_s === 'number' ? s.timeout_s : 60,
    edited: s.edited === true,
  }
}

/** Timeout recuperado dentro del tope actual del backend (0 = sin timeout). */
function fitTimeout(timeoutS: number, system: SystemInfoDto): number {
  const cap = system.limits.max_timeout_s
  return cap > 0 && (timeoutS <= 0 || timeoutS > cap) ? cap : timeoutS
}

const LAUNCH_ERROR_TEXT: Record<string, string> = {
  CODE_TOO_LARGE: 'El código supera el límite de 256 KB.',
  EXAMPLE_DISABLED: 'Este ejemplo está deshabilitado en tu equipo (requiere GPU).',
  TOO_MANY_JOBS: 'Hay demasiadas ejecuciones en cola. Espera a que termine alguna.',
  DOCKER_UNAVAILABLE: 'Docker no está disponible: el backend no puede crear el contenedor.',
  RUNNER_IMAGE_MISSING: 'Falta la imagen telar-runner en tu Docker local.',
}

export function SimulatorIdle() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const [preload] = useState(() => readPreload(location.state))
  const { data: system, error: sysError, loading: sysLoading, retry: sysRetry } = useSystemInfo()

  const [modules, setModules] = useState<ModuleDto[] | null>(null)
  const [modulesError, setModulesError] = useState<Error | null>(null)
  const [example, setExample] = useState<ExampleDetailDto | null>(null)
  const [code, setCode] = useState(preload?.code ?? '')
  const [filename, setFilename] = useState(preload?.filename ?? DEFAULT_FILENAME)
  const [threads, setThreads] = useState(4)
  const [timeoutS, setTimeoutS] = useState(60)
  const [launchError, setLaunchError] = useState<ApiError | null>(null)
  const [launching, setLaunching] = useState(false)
  const [showInstructions, setShowInstructions] = useState(false)
  // Avisos al recuperar una configuración (Re-ejecutar / Mis configuraciones).
  const [notices, setNotices] = useState<string[]>([])
  // Solo la última petición de ejemplo aplica su respuesta (una tardía no pisa).
  const exampleReq = useRef(0)

  // CU-05.1: tras un fallo de /modules el usuario ya pudo escribir código.
  // El error se limpia solo al recuperar (sin volver al skeleton, que
  // desmontaría el editor) y la recuperación no autoselecciona un ejemplo.
  const modulesFailed = useRef(false)
  const loadModules = useCallback(() => {
    getModules()
      .then((res) => {
        setModules(res.modules)
        setModulesError(null)
      })
      .catch((err: unknown) => {
        modulesFailed.current = true
        setModulesError(err instanceof Error ? err : new Error(String(err)))
      })
  }, [])
  useEffect(loadModules, [loadModules])

  const selectExample = useCallback((exampleId: string) => {
    const req = ++exampleReq.current
    setNotices([])
    if (exampleId === '') {
      setExample(null)
      // El nombre era el del ejemplo; el código escrito se conserva.
      setFilename(DEFAULT_FILENAME)
      return
    }
    getExample(exampleId)
      .then((detail) => {
        if (req !== exampleReq.current) return
        setExample(detail)
        setCode(detail.source_code)
        setFilename(detail.filename)
        setTimeoutS(detail.default_timeout_s)
      })
      .catch((err: unknown) => {
        if (req !== exampleReq.current) return
        setLaunchError(err instanceof ApiError ? err : new ApiError('NETWORK_ERROR', String(err), 0))
      })
  }, [])

  // Aplica una configuración recuperada: con ejemplo, primero lo carga (lección
  // y parser) y luego pone el código, hilos y timeout históricos encima.
  const applyConfig = useCallback((cfg: SimConfig, sys: SystemInfoDto, extra: string[] = []) => {
    const req = ++exampleReq.current
    const { threads: t, clampedFrom } = clampThreads(cfg.threads, sys.max_threads)
    const threadsNote =
      clampedFrom != null
        ? `La configuración pedía ${clampedFrom} hilos; se ajustó a ${t}, el máximo de este equipo.`
        : null
    const apply = (ex: ExampleDetailDto | null, notes: string[]) => {
      if (req !== exampleReq.current) return
      setExample(ex)
      setCode(cfg.code)
      setFilename(cfg.filename)
      setThreads(t)
      setTimeoutS(fitTimeout(cfg.timeout_s, sys))
      const sendsThreads = shouldSendThreads(ex)
      setNotices([...extra, ...notes, ...(sendsThreads && threadsNote != null ? [threadsNote] : [])])
    }
    if (cfg.example_id == null) {
      apply(null, [])
      return
    }
    const exampleId = cfg.example_id
    getExample(exampleId)
      .then((detail) =>
        apply(
          detail,
          !cfg.edited && detail.source_code !== cfg.code
            ? ['El ejemplo cambió desde esa ejecución: se cargó el código que se ejecutó entonces.']
            : [],
        ),
      )
      .catch((err: unknown) =>
        apply(null, [
          err instanceof ApiError && err.code === 'EXAMPLE_NOT_FOUND'
            ? `El ejemplo «${exampleId}» ya no existe: su código se cargó como código propio.`
            : `No se pudo cargar el ejemplo «${exampleId}»: su código se cargó como código propio.`,
        ]),
      )
  }, [])

  // Re-ejecutar: se aplica una sola vez, cuando ya se conoce el máximo de hilos.
  const preloadApplied = useRef(false)
  useEffect(() => {
    if (preload == null || system == null || preloadApplied.current) return
    preloadApplied.current = true
    applyConfig(preload, system)
  }, [preload, system, applyConfig])

  // CU-32.3: lo que se ve es lo que se envía — el slider nunca supera el máximo.
  useEffect(() => {
    if (system != null && threads > system.max_threads) setThreads(system.max_threads)
  }, [system, threads])

  // Precarga inicial: ?ejemplo={id} > navigate-state (código propio) >
  // primer ejemplo habilitado del catálogo (helloOpenMP — §6.2, sin hardcodear).
  const queryExample = searchParams.get('ejemplo')
  // S2 (CU-22.2): la prueba desde Autoría ejecuta el ejemplo SIN lesson_id, así
  // nunca toca el progreso de la lección (ni last_job_id ni la regla `run`).
  const adminTest = searchParams.get('prueba') === 'admin'
  useEffect(() => {
    if (modulesFailed.current) return // CU-05.1: no pisar el código escrito
    if (queryExample != null && queryExample !== '') {
      selectExample(queryExample)
      return
    }
    if (preload != null) return // Re-ejecutar: lo aplica applyConfig
    if (modules != null && modules.length > 0) {
      // E1: `example_id` pasó de '' a null para las lecciones sin código, así
      // que la comprobación es de nulidad. Sin esto, la autoselección elegiría
      // una lección conceptual y el simulador arrancaría sin nada que ejecutar.
      const first = modules
        .flatMap((m) => m.lessons)
        .find((l) => l.enabled && l.example_id != null)
      if (first?.example_id != null) selectExample(first.example_id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryExample, modules, selectExample])

  const edited = example != null && code !== example.source_code
  const cores = system?.cores ?? 4

  const onFile = useCallback((file: PickedFile) => {
    exampleReq.current++
    setNotices([])
    setExample(null)
    setCode(file.code)
    setFilename(file.filename)
    setTimeoutS(60)
  }, [])

  const launch = useCallback(async () => {
    if (system == null || launching) return
    setLaunchError(null)
    setLaunching(true)
    const sendThreads = shouldSendThreads(example)
    const req: JobCreateRequestDto = {
      ...(example != null
        ? { example_id: example.id, ...(adminTest ? null : { lesson_id: example.lesson_id }) }
        : { filename }),
      ...(example == null || edited ? { code } : null),
      // El effect de CU-32.3 ya mantiene `threads` ≤ max; el min es solo defensa.
      ...(sendThreads ? { threads: Math.min(threads, system.max_threads) } : null),
      timeout_s: timeoutS,
    }
    try {
      const data = await createJob(req)
      navigate(`/simulador/${data.job_id}`, {
        state: {
          wsUrl: data.ws_url,
          threadsNote: data.threads_note,
          filename: example != null ? example.filename : filename,
          threads: data.threads_effective,
        },
      })
    } catch (err: unknown) {
      setLaunchError(err instanceof ApiError ? err : new ApiError('NETWORK_ERROR', String(err), 0))
      setLaunching(false)
    }
  }, [system, launching, example, adminTest, edited, code, filename, threads, timeoutS, navigate])

  // CU-05.1/06.2: sin /modules solo falta el selector de ejemplos; el editor
  // propio y la subida de archivos siguen funcionando. /system sí es necesario
  // (hilos y núcleos del host), así que su fallo bloquea la pantalla.
  if (sysError != null) {
    return (
      <section className="screen simulator-screen">
        <ErrorState
          message="No se pudo cargar la configuración del simulador. ¿Está corriendo el backend Telar?"
          detail={sysError.message}
          onRetry={() => {
            sysRetry()
            loadModules()
          }}
        >
          {getPlatform() === 'desktop' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void window.telar?.dockerUp().then(() => {
                  sysRetry()
                  loadModules()
                })
              }}
            >
              Revisar servicios Docker
            </Button>
          )}
        </ErrorState>
      </section>
    )
  }

  if (sysLoading || system == null || (modules == null && modulesError == null)) {
    return (
      <section className="screen simulator-screen" aria-busy="true">
        <div className="screen-head">
          <div>
            <Skeleton width={90} height={12} style={{ marginBottom: 10 }} />
            <Skeleton width={380} height={30} />
          </div>
        </div>
        <div className="config-grid">
          <Skeleton height={420} radius="var(--r-lg)" />
          <Skeleton height={420} radius="var(--r-lg)" />
        </div>
      </section>
    )
  }

  const displayThreads =
    example != null && !example.threads_configurable
      ? example.sweeps_threads
        ? Math.min(8, cores)
        : (example.fixed_threads ?? 4)
      : threads
  const cpus = effectiveCpus(example, threads, cores)

  return (
    <section className="screen simulator-screen">
      <header className="screen-head">
        <div>
          <div className="eyebrow">Simulador</div>
          <h2 className="display-lg">Configura y lanza tu ejecución</h2>
          <p className="muted" style={{ maxWidth: 640 }}>
            Elige un ejemplo del curso o sube tu código, decide cuántos hilos y pulsa{' '}
            <b>Lanzar ejecución</b>. Tu código corre aislado en un contenedor Docker efímero de tu máquina.
          </p>
        </div>
        <div className="screen-actions">
          {modules != null && (
            <ExamplePicker
              compact
              modules={modules}
              value={example?.id ?? ''}
              onChange={selectExample}
            />
          )}
          <Button variant="primary" size="lg" onClick={() => void launch()} disabled={launching || code.trim() === ''}>
            <IconPlay size={14} /> {launching ? 'Lanzando…' : 'Lanzar ejecución'}
          </Button>
        </div>
      </header>

      {launchError != null && (
        <div className="launch-error" role="alert">
          <div>
            <b>{LAUNCH_ERROR_TEXT[launchError.code] ?? 'No se pudo lanzar la ejecución.'}</b>{' '}
            <span className="muted">{launchError.message}</span>
          </div>
          {(launchError.code === 'DOCKER_UNAVAILABLE' || launchError.code === 'RUNNER_IMAGE_MISSING') && (
            <Button variant="outline" size="sm" onClick={() => setShowInstructions((v) => !v)}>
              Ver instrucciones
            </Button>
          )}
          {showInstructions && (
            <pre className="launch-error-instructions">
              {launchError.code === 'RUNNER_IMAGE_MISSING'
                ? '# Construye la imagen del runner:\nmake runner-image\n# (o) docker build -t telar-runner:0.5.1 runner/'
                : '# Arranca Docker Desktop / el daemon y verifica:\ndocker info\n# Luego reinicia el backend Telar.'}
            </pre>
          )}
        </div>
      )}

      {notices.length > 0 && (
        <div className="sim-notices" role="status">
          {notices.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
      )}

      <div className="config-grid">
        <CodePanel filename={filename} code={code} edited={edited} onCodeChange={setCode} onFile={onFile} />

        <Card>
          <CardHead icon={<IconCluster size={16} />} title="Reparto de trabajo" />
          <div className="topology-viz">
            <ThreadTopology threads={displayThreads} />
          </div>
          <div className="config-fields">
            {modules != null ? (
              <ExamplePicker modules={modules} value={example?.id ?? ''} onChange={selectExample} />
            ) : (
              <ErrorState
                title="Ejemplos no disponibles"
                message="No se pudieron cargar los ejemplos del curso. Puedes escribir tu código o subir un archivo."
                detail={modulesError?.message}
                onRetry={loadModules}
              />
            )}
            <ThreadsField system={system} example={example} edited={edited} value={threads} onChange={setThreads} />
            <div className="field-row" style={{ marginTop: 4 }}>
              <span className="mono-small">Núcleos del host</span>
              <span style={{ display: 'flex', gap: 8 }}>
                <Chip>{cores} disponibles</Chip>
                <Chip tone={cpus <= cores ? 'green' : 'amber'}>--cpus = {cpus}</Chip>
              </span>
            </div>
            <div className="field-hint">
              El contenedor se limita a {cpus} CPU{cpus === 1 ? '' : 's'} (--cpus): el sistema operativo no le dará más
              aunque el código pida más hilos.
            </div>
          </div>
        </Card>
      </div>

      <AdvancedOptions
        system={system}
        exampleDefaultTimeout={example?.default_timeout_s ?? null}
        timeoutS={timeoutS}
        onTimeoutChange={setTimeoutS}
      />

      <SavedConfigs
        current={{ example_id: example?.id ?? null, code, filename, threads: displayThreads, timeout_s: timeoutS, edited }}
        onLoad={(cfg) => applyConfig(cfg, system, [`Configuración «${cfg.name}» cargada.`])}
      />
    </section>
  )
}
