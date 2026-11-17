// useDockerStatus.ts — estado del runtime para el RuntimeFooter
// (frontend-spec §6.7):
//  - desktop: window.telar.dockerStatus() al montar y cada 10 s;
//    `Levantar` → window.telar.dockerUp() con re-check;
//    `Detener`  → window.telar.dockerStop() con re-check.
//  - web: GET /health cada 30 s.
//
// 2026-08-26: se añade `stop()`. `dockerStop` existía en el contrato de preload
// desde el principio (electron-spec §5.1) y la spec lo daba por expuesto en el
// pie (§8, «Detener servicios»), pero NINGÚN componente lo invocaba: era
// capacidad muerta. Ahora el panel del RuntimeFooter ofrece las dos acciones.
//
// 2026-09-22 (CU-27.1–27.4 y modo web):
//  - «listo» = el servicio `backend` corre y su healthcheck dice `healthy` (o
//    no declara healthcheck). Antes bastaba con cualquier contenedor corriendo.
//  - si Docker no estaba al abrir la app, el autoarranque queda PENDIENTE y se
//    hace en cuanto un sondeo lo encuentra; «Detener» o «Levantar» del usuario
//    lo dan por resuelto.
//  - `statusError` conserva la causa (el `error` saneado de dockerStatus en
//    desktop; en web, lo que dicen `checks.docker`/`checks.runner_image`).
import { useCallback, useEffect, useRef, useState } from 'react'
import { getHealth } from '../api/system'
import type { HealthChecksDto } from '../api/types'
import type { ComposeService } from '../types/telar'
import { getPlatform } from './usePlatform'

const DESKTOP_POLL_MS = 10_000
/** Mientras Docker no responde (se está abriendo solo, o el usuario lo abre), se sondea más a menudo para pasar a «listo» sin esperar 10 s. */
const DESKTOP_FAST_POLL_MS = 3_000
const WEB_POLL_MS = 30_000

export type RuntimeHealth = 'checking' | 'ok' | 'down'

export interface DockerStatusState {
  state: RuntimeHealth
  /** Contenedores compose en estado running (solo desktop; null en web). */
  containers: number | null
  /** true mientras corre dockerUp() (spinner del botón Levantar). */
  lifting: boolean
  /** true mientras corre dockerStop() (spinner del botón Detener). */
  stopping: boolean
  /** Error de la ÚLTIMA acción ejecutada (up o stop); null si fue bien. */
  liftError: string | null
  /** Por qué el runtime no está listo (Docker ausente, permisos, imagen…); null si nada que decir. */
  statusError: string | null
  /** Desktop: `docker compose up -d` + re-check. No-op en web. */
  up: () => Promise<void>
  /** Desktop: `docker compose stop` + re-check. No-op en web. */
  stop: () => Promise<void>
  /** Vuelve a comprobar (y reanuda el autoarranque si seguía pendiente). */
  refresh: () => Promise<void>
}

type CheckResult = RuntimeHealth | 'unavailable'

/** CU-27.1: el backend es lo que la app necesita; su healthcheck manda. */
function backendHealth(services: ComposeService[]): RuntimeHealth {
  const backend = services.find((s) => s.service === 'backend')
  if (backend?.state !== 'running') return 'down'
  if (backend.health === 'starting') return 'checking'
  return backend.health === undefined || backend.health === 'healthy' ? 'ok' : 'down'
}

/** Modo web: un /health 200 no basta si el servidor no puede ejecutar código. */
function webProblem(checks: HealthChecksDto | undefined): string | null {
  if (checks === undefined) return null // backend viejo sin checks: se da por bueno
  if (!checks.docker) return 'Docker no responde en el servidor.'
  if (checks.runner_image === false) return 'Falta la imagen del runner en el servidor.'
  if (checks.runner_image == null) return 'No se pudo comprobar la imagen del runner.'
  return null
}

export function useDockerStatus(): DockerStatusState {
  const platform = getPlatform()
  const [state, setState] = useState<RuntimeHealth>('checking')
  const [containers, setContainers] = useState<number | null>(null)
  const [lifting, setLifting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [liftError, setLiftError] = useState<string | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const alive = useRef(true)

  // Devuelve el resultado además de publicarlo en el estado: el autoarranque
  // necesita saber cómo fue la comprobación, y leerlo del estado recién
  // seteado no es fiable dentro del mismo tick.
  const check = useCallback(async (): Promise<CheckResult> => {
    try {
      if (platform === 'desktop' && window.telar) {
        const res = await window.telar.dockerStatus()
        if (!alive.current) return 'unavailable'
        setContainers(res.services.filter((s) => s.state === 'running').length)
        // `ok:false` = no hay daemon con el que hablar (Docker ausente, parado
        // o sin permisos). Se distingue de `down` para no intentar un
        // autoarranque que sólo puede fallar, y se conserva la causa (27.4).
        if (!res.ok) {
          setState('down')
          setStatusError(res.error ?? 'Docker no está disponible.')
          return 'unavailable'
        }
        const next = backendHealth(res.services)
        setState(next)
        setStatusError(null)
        return next
      }
      const health = await getHealth()
      if (!alive.current) return 'unavailable'
      const problem = webProblem(health.checks)
      setContainers(null)
      setState(problem == null ? 'ok' : 'down')
      setStatusError(problem)
      return problem == null ? 'ok' : 'down'
    } catch {
      if (!alive.current) return 'unavailable'
      setState('down')
      setStatusError(null)
      return 'unavailable'
    }
  }, [platform])

  // Autoarranque ya resuelto: hecho, o decidido por el usuario (up/stop).
  const autoStarted = useRef(false)

  const up = useCallback(async () => {
    if (platform !== 'desktop' || !window.telar || lifting) return
    autoStarted.current = true // ya se está preparando: no hace falta otro autoarranque
    setLifting(true)
    setLiftError(null)
    try {
      const res = await window.telar.dockerUp()
      if (alive.current && !res.ok) setLiftError(res.error ?? 'No se pudo levantar Docker.')
    } catch (err: unknown) {
      if (alive.current) setLiftError(err instanceof Error ? err.message : String(err))
    } finally {
      await check()
      if (alive.current) setLifting(false)
    }
  }, [check, lifting, platform])

  // Simétrico a up(). Al cerrar la app los servicios se detienen solos
  // (before-quit en main.ts, 2026-08-28); esta es la vía manual para pararlos
  // con la app abierta.
  const stop = useCallback(async () => {
    if (platform !== 'desktop' || !window.telar || stopping) return
    autoStarted.current = true // decisión explícita: no relanzar nunca en esta sesión
    setStopping(true)
    setLiftError(null)
    try {
      const res = await window.telar.dockerStop()
      if (alive.current && !res.ok) setLiftError(res.error ?? 'No se pudo detener Docker.')
    } catch (err: unknown) {
      if (alive.current) setLiftError(err instanceof Error ? err.message : String(err))
    } finally {
      await check()
      if (alive.current) setStopping(false)
    }
  }, [check, platform, stopping])

  // Arranque: comprobar y, si hace falta, LEVANTAR SOLO (§8 del electron-spec
  // describía un botón manual; con el autoarranque el estudiante no tiene que
  // saber que existe un control escondido en el rail).
  //
  // Sólo UNA VEZ por sesión de app, y por eso el guard `autoStarted`: si se
  // reintentara en cada sondeo, pulsar «Detener» no serviría de nada — el
  // siguiente poll (10 s) volvería a levantar los servicios y el botón sería
  // inservible. Detener es una decisión explícita del usuario y se respeta
  // hasta que vuelva a abrir la app.
  //
  // Si Docker no está disponible ('unavailable'), el autoarranque queda
  // PENDIENTE (CU-27.2): levantar sin daemon sólo daría un error, pero en
  // cuanto un sondeo lo encuentra (el usuario abrió Docker Desktop) se hace.
  // Mientras el backend arranca ('checking') tampoco se decide nada.
  //
  // `up` se lee por REFERENCIA: su identidad cambia al alternar `lifting`, así
  // que ponerlo en las dependencias del efecto desmontaría y recrearía el
  // intervalo (con su check extra) dos veces por cada arranque.
  const upRef = useRef(up)
  upRef.current = up

  // ¿El último sondeo no encontró daemon? Decide la cadencia del siguiente.
  const unavailable = useRef(false)

  const tick = useCallback(async () => {
    const result = await check()
    unavailable.current = result === 'unavailable'
    if (!alive.current || autoStarted.current) return
    if (result === 'unavailable' || result === 'checking') return
    autoStarted.current = true
    if (platform === 'desktop' && result === 'down') await upRef.current()
  }, [check, platform])

  useEffect(() => {
    alive.current = true
    let timer: number | undefined
    const loop = async () => {
      await tick()
      if (!alive.current) return
      const every =
        platform !== 'desktop' ? WEB_POLL_MS : unavailable.current ? DESKTOP_FAST_POLL_MS : DESKTOP_POLL_MS
      timer = window.setTimeout(() => void loop(), every)
    }
    void loop()
    return () => {
      alive.current = false
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [tick, platform])

  const refresh = useCallback(async () => {
    setState('checking')
    await tick()
  }, [tick])

  return { state, containers, lifting, stopping, liftError, statusError, up, stop, refresh }
}
