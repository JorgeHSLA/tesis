// useSystemInfo.ts — GET /api/v1/system cacheado a nivel de módulo
// (promise memoizada; frontend-spec §3, sin react-query en MVP).
import { useCallback, useEffect, useRef, useState } from 'react'
import { getSystem } from '../api/system'
import type { SystemInfoDto } from '../api/types'

let cached: Promise<SystemInfoDto> | null = null

/** Promise memoizada; `force=true` re-consulta (retry). */
export function loadSystemInfo(force = false): Promise<SystemInfoDto> {
  if (!cached || force) {
    cached = getSystem().catch((err: unknown) => {
      cached = null // no cachear errores: el retry debe re-consultar
      throw err
    })
  }
  return cached
}

// En desktop el frontend carga desde disco al instante, pero el backend
// tarda unos segundos en levantar vía el autoarranque de Docker
// (electron-spec §8: healthcheck con start_period 15s). Sin reintento, una
// consulta que llega en esa ventana falla, y como el resultado no se
// vuelve a pedir solo, «Módulos disponibles» quedaba oculto hasta que algo
// forzara un retry() manual — en la práctica, cerrar y reabrir la app
// (reproducido 2026-09-02 instalando la v1.0.5 en limpio). 6 intentos cada
// 3s cubren ese arranque sin sondear para siempre si el backend está caído
// de verdad por otra razón.
const MAX_AUTO_RETRIES = 6
const AUTO_RETRY_DELAY_MS = 3_000

export interface SystemInfoState {
  data: SystemInfoDto | null
  error: Error | null
  loading: boolean
  retry: () => void
}

export function useSystemInfo(): SystemInfoState {
  const [data, setData] = useState<SystemInfoDto | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(true)
  const alive = useRef(true)
  const autoRetries = useRef(0)

  const run = useCallback((force: boolean) => {
    setLoading(true)
    setError(null)
    loadSystemInfo(force)
      .then((info) => {
        if (alive.current) {
          setData(info)
          setLoading(false)
          autoRetries.current = 0
        }
      })
      .catch((err: unknown) => {
        if (!alive.current) return
        setError(err instanceof Error ? err : new Error(String(err)))
        setLoading(false)
        if (autoRetries.current < MAX_AUTO_RETRIES) {
          autoRetries.current += 1
          window.setTimeout(() => {
            if (alive.current) run(true)
          }, AUTO_RETRY_DELAY_MS)
        }
      })
  }, [])

  useEffect(() => {
    alive.current = true
    autoRetries.current = 0
    run(false)
    return () => {
      alive.current = false
    }
  }, [run])

  // Reintento manual (p.ej. botón «Reintentar» de un ErrorState): repone el
  // contador para que también tenga su propia ventana de auto-reintentos si
  // vuelve a fallar, en vez de heredar los que ya se hubieran consumido.
  const retry = useCallback(() => {
    autoRetries.current = 0
    run(true)
  }, [run])

  return { data, error, loading, retry }
}
