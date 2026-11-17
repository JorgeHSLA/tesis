// hooks/useGlobalSearchIndex.ts — reúne, al abrir el buscador, todo lo que se
// puede buscar. Cada fuente falla por su lado (allSettled): si el historial no
// carga, siguen funcionando cursos y ejemplos. Se vuelve a pedir en cada
// apertura porque las ejecuciones y el progreso cambian entre una y otra.
import { useEffect, useState } from 'react'
import { getRemoteCatalog } from '../api/catalog'
import { getModules, loadExamplesIndex } from '../api/content'
import { listJobs } from '../api/jobs'
import { ADMIN_BUILD } from '../config'
import type { SearchItem } from '../lib/globalSearch'
import { listSavedConfigs } from '../lib/savedConfigs'
import { buildSearchIndex } from '../lib/searchIndex'
import { useSystemInfo } from './useSystemInfo'

export interface GlobalSearchIndex {
  items: SearchItem[]
  loading: boolean
  /** Alguna fuente no respondió: los resultados pueden estar incompletos. */
  partial: boolean
}

const JOBS_LIMIT = 100

function valueOf<T>(r: PromiseSettledResult<T>): T | undefined {
  return r.status === 'fulfilled' ? r.value : undefined
}

export function useGlobalSearchIndex(open: boolean): GlobalSearchIndex {
  const { data: system } = useSystemInfo()
  const catalogEnabled = system?.catalog?.enabled ?? false
  const [state, setState] = useState<GlobalSearchIndex>(() => ({
    items: buildSearchIndex({ catalogEnabled, admin: ADMIN_BUILD }),
    loading: false,
    partial: false,
  }))

  useEffect(() => {
    if (!open) return
    let alive = true
    // Mientras llega lo demás ya se puede buscar entre las páginas.
    setState((prev) => ({ ...prev, loading: true }))
    void (async () => {
      const [modules, examples, jobs, remote] = await Promise.allSettled([
        getModules(),
        loadExamplesIndex(),
        listJobs({ limit: JOBS_LIMIT }),
        catalogEnabled ? getRemoteCatalog() : Promise.resolve(null),
      ])
      if (!alive) return
      const examplesMap = valueOf(examples)
      setState({
        items: buildSearchIndex({
          modules: valueOf(modules)?.modules,
          examples: examplesMap ? Array.from(examplesMap.values()) : undefined,
          jobs: valueOf(jobs)?.jobs,
          configs: listSavedConfigs(),
          remote: valueOf(remote)?.modules,
          catalogEnabled,
          admin: ADMIN_BUILD,
        }),
        loading: false,
        partial: [modules, examples, jobs].some((r) => r.status === 'rejected'),
      })
    })()
    return () => {
      alive = false
    }
  }, [open, catalogEnabled])

  return state
}
