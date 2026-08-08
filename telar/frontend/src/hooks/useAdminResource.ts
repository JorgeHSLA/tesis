// hooks/useAdminResource.ts — carga genérica de un recurso admin con
// {data, loading, error, reload}. Cancela de forma segura al desmontar o al
// cambiar las dependencias (evita setState sobre un componente desmontado).
import { useCallback, useEffect, useRef, useState } from 'react'

export interface AdminResource<T> {
  data: T | null
  loading: boolean
  /** `unknown` para narrowing seguro (típicamente `ApiError`). */
  error: unknown
  /** Fuerza una recarga (re-ejecuta el fetcher). */
  reload: () => void
}

interface InternalState<T> {
  data: T | null
  loading: boolean
  error: unknown
}

/**
 * @param fetcher función sin argumentos que resuelve el recurso.
 * @param deps    dependencias que, al cambiar, disparan una recarga.
 */
export function useAdminResource<T>(
  fetcher: () => Promise<T>,
  deps: readonly unknown[],
): AdminResource<T> {
  // El fetcher se lee por ref para no forzarlo dentro de `deps`.
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const [state, setState] = useState<InternalState<T>>({ data: null, loading: true, error: null })
  const [nonce, setNonce] = useState(0)
  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    let alive = true
    setState((prev) => ({ data: prev.data, loading: true, error: null }))
    fetcherRef
      .current()
      .then((data) => {
        if (alive) setState({ data, loading: false, error: null })
      })
      .catch((error: unknown) => {
        if (alive) setState((prev) => ({ data: prev.data, loading: false, error }))
      })
    return () => {
      alive = false
    }
  }, [...deps, nonce])

  return { data: state.data, loading: state.loading, error: state.error, reload }
}
