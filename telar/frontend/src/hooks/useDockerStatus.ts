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
import { useCallback, useEffect, useRef, useState } from 'react'
import { getHealth } from '../api/system'
import { getPlatform } from './usePlatform'

const DESKTOP_POLL_MS = 10_000
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
  /** Desktop: `docker compose up -d` + re-check. No-op en web. */
  up: () => Promise<void>
  /** Desktop: `docker compose stop` + re-check. No-op en web. */
  stop: () => Promise<void>
  refresh: () => void
}

export function useDockerStatus(): DockerStatusState {
  const platform = getPlatform()
  const [state, setState] = useState<RuntimeHealth>('checking')
  const [containers, setContainers] = useState<number | null>(null)
  const [lifting, setLifting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [liftError, setLiftError] = useState<string | null>(null)
  const alive = useRef(true)

  const check = useCallback(async () => {
    try {
      if (platform === 'desktop' && window.telar) {
        const res = await window.telar.dockerStatus()
        if (!alive.current) return
        const running = res.services.filter((s) => s.state === 'running').length
        setContainers(running)
        setState(res.ok && running > 0 ? 'ok' : 'down')
      } else {
        await getHealth()
        if (!alive.current) return
        setContainers(null)
        setState('ok')
      }
    } catch {
      if (!alive.current) return
      setState('down')
    }
  }, [platform])

  useEffect(() => {
    alive.current = true
    void check()
    const every = platform === 'desktop' ? DESKTOP_POLL_MS : WEB_POLL_MS
    const id = window.setInterval(() => void check(), every)
    return () => {
      alive.current = false
      window.clearInterval(id)
    }
  }, [check, platform])

  const up = useCallback(async () => {
    if (platform !== 'desktop' || !window.telar || lifting) return
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

  // Simétrico a up(). Los servicios NO se detienen al cerrar la app (decisión
  // de electron-spec §8): esta es la vía manual para pararlos.
  const stop = useCallback(async () => {
    if (platform !== 'desktop' || !window.telar || stopping) return
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

  const refresh = useCallback(() => {
    setState('checking')
    void check()
  }, [check])

  return { state, containers, lifting, stopping, liftError, up, stop, refresh }
}
