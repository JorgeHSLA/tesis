// SimulatorIdle — pantalla /simulador en reposo (frontend-spec §6.2).
// ConfigPanel (grid 1fr 1fr): CodePanel (izq) + card «Reparto de trabajo»
// (der: ExamplePicker + ThreadTopology + ThreadsField + fila --cpus) y card
// «Opciones avanzadas». Lanzar → POST /api/v1/jobs con la semántica de
// fuentes del contrato §7.1 (example_id/code según edición; threads OMITIDO
// en fixed/sweep — §9) → navigate('/simulador/{job_id}').
import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { getExample, getModules } from '../../api/content'
import { ApiError } from '../../api/client'
import { createJob } from '../../api/jobs'
import type { ExampleDetailDto, JobCreateRequestDto, ModuleDto } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { Card, CardHead } from '../../components/ui/Card'
import { Chip } from '../../components/ui/Chip'
import { ErrorState } from '../../components/ui/ErrorState'
import { Skeleton } from '../../components/ui/Skeleton'
import { IconCluster, IconPlay } from '../../components/icons/icons'
import { ThreadTopology } from '../../components/viz/ThreadTopology'
import { getPlatform } from '../../hooks/usePlatform'
import { useSystemInfo } from '../../hooks/useSystemInfo'
import { AdvancedOptions } from './AdvancedOptions'
import { CodePanel, type PickedFile } from './CodePanel'
import { ExamplePicker } from './ExamplePicker'
import { effectiveCpus, shouldSendThreads, ThreadsField } from './ThreadsField'

/** Precarga por navigate state (Re-ejecutar de un job con código propio). */
interface PreloadState {
  code?: string
  filename?: string
}

const LAUNCH_ERROR_TEXT: Record<string, string> = {
  CODE_TOO_LARGE: 'El código supera el límite de 256 KB.',
  EXAMPLE_DISABLED: 'Este ejemplo está deshabilitado en tu equipo (requiere GPU).',
  TOO_MANY_JOBS: 'Hay demasiadas ejecuciones en cola. Espera a que termine alguna.',
  DOCKER_UNAVAILABLE: 'Docker no está disponible: el backend no puede crear el contenedor.',
  RUNNER_IMAGE_MISSING: 'Falta la imagen ehpc-runner en tu Docker local.',
}

export function SimulatorIdle() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const preload = (location.state as PreloadState | null) ?? null
  const { data: system, error: sysError, loading: sysLoading, retry: sysRetry } = useSystemInfo()

  const [modules, setModules] = useState<ModuleDto[] | null>(null)
  const [modulesError, setModulesError] = useState<Error | null>(null)
  const [example, setExample] = useState<ExampleDetailDto | null>(null)
  const [code, setCode] = useState(preload?.code ?? '')
  const [filename, setFilename] = useState(preload?.filename ?? 'main.py')
  const [threads, setThreads] = useState(4)
  const [timeoutS, setTimeoutS] = useState(60)
  const [launchError, setLaunchError] = useState<ApiError | null>(null)
  const [launching, setLaunching] = useState(false)
  const [showInstructions, setShowInstructions] = useState(false)

  const loadModules = useCallback(() => {
    setModulesError(null)
    getModules()
      .then((res) => setModules(res.modules))
      .catch((err: unknown) => setModulesError(err instanceof Error ? err : new Error(String(err))))
  }, [])
  useEffect(loadModules, [loadModules])

  const selectExample = useCallback((exampleId: string) => {
    if (exampleId === '') {
      setExample(null)
      return
    }
    getExample(exampleId)
      .then((detail) => {
        setExample(detail)
        setCode(detail.source_code)
        setFilename(detail.filename)
        setTimeoutS(detail.default_timeout_s)
      })
      .catch((err: unknown) => {
        setLaunchError(err instanceof ApiError ? err : new ApiError('NETWORK_ERROR', String(err), 0))
      })
  }, [])

  // Precarga inicial: ?ejemplo={id} > navigate-state (código propio) >
  // primer ejemplo habilitado del catálogo (helloOpenMP — §6.2, sin hardcodear).
  const queryExample = searchParams.get('ejemplo')
  useEffect(() => {
    if (queryExample != null && queryExample !== '') {
      selectExample(queryExample)
      return
    }
    if (preload?.code != null) return // Re-ejecutar con código propio
    if (modules != null && modules.length > 0) {
      const first = modules
        .flatMap((m) => m.lessons)
        .find((l) => l.enabled && l.example_id !== '')
      if (first != null) selectExample(first.example_id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryExample, modules, selectExample])

  const edited = example != null && code !== example.source_code
  const cores = system?.cores ?? 4

  const onFile = useCallback((file: PickedFile) => {
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
      ...(example != null ? { example_id: example.id, lesson_id: example.lesson_id } : { filename }),
      ...(example == null || edited ? { code } : null),
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
  }, [system, launching, example, edited, code, filename, threads, timeoutS, navigate])

  if (sysError != null || modulesError != null) {
    return (
      <section className="screen simulator-screen">
        <ErrorState
          message="No se pudo cargar la configuración del simulador. ¿Está corriendo el backend E-HPC?"
          detail={(sysError ?? modulesError)?.message}
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
                void window.ehpc?.dockerUp().then(() => {
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

  if (sysLoading || system == null || modules == null) {
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
          <ExamplePicker
            compact
            modules={modules}
            value={example?.id ?? ''}
            onChange={selectExample}
          />
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
                ? '# Construye la imagen del runner:\nmake runner-image\n# (o) docker build -t ehpc-runner:0.5.1 runner/'
                : '# Arranca Docker Desktop / el daemon y verifica:\ndocker info\n# Luego reinicia el backend E-HPC.'}
            </pre>
          )}
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
            <ExamplePicker modules={modules} value={example?.id ?? ''} onChange={selectExample} />
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
    </section>
  )
}
