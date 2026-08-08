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

  const run = useCallback((force: boolean) => {
    setLoading(true)
    setError(null)
    loadSystemInfo(force)
      .then((info) => {
        if (alive.current) {
          setData(info)
          setLoading(false)
        }
      })
      .catch((err: unknown) => {
        if (alive.current) {
          setError(err instanceof Error ? err : new Error(String(err)))
          setLoading(false)
        }
      })
  }, [])

  useEffect(() => {
    alive.current = true
    run(false)
    return () => {
      alive.current = false
    }
  }, [run])

  const retry = useCallback(() => run(true), [run])

  return { data, error, loading, retry }
}
