// useDockerStatus.ts — estado del runtime para el RuntimeFooter
// (frontend-spec §6.7):
//  - desktop: window.telar.dockerStatus() al montar y cada 10 s;
//    `Levantar` → window.telar.dockerUp() con re-check.
//  - web: GET /health cada 30 s.
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
  liftError: string | null
  /** Desktop: `docker compose up -d` + re-check. No-op en web. */
  up: () => Promise<void>
  refresh: () => void
}

export function useDockerStatus(): DockerStatusState {
  const platform = getPlatform()
  const [state, setState] = useState<RuntimeHealth>('checking')
  const [containers, setContainers] = useState<number | null>(null)
  const [lifting, setLifting] = useState(false)
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

  const refresh = useCallback(() => {
    setState('checking')
    void check()
  }, [check])

  return { state, containers, lifting, liftError, up, refresh }
}
