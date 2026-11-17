// lib/searchIndex.ts — arma la lista de cosas buscables a partir de lo que ya
// sirve la API (cursos, ejemplos, ejecuciones, configuraciones, módulos
// remotos) más las páginas fijas de la app. PURO: sin red ni DOM, para poder
// probarlo. La carga de datos vive en hooks/useGlobalSearchIndex.ts.
import type { RemoteModuleSummaryDto } from '../api/catalog-types'
import type { ExampleSummaryDto, JobSummaryDto, ModuleDto } from '../api/types'
import type { SearchItem } from './globalSearch'
import type { SavedConfig } from './savedConfigs'

export interface SearchSources {
  modules?: readonly ModuleDto[]
  examples?: readonly ExampleSummaryDto[]
  jobs?: readonly JobSummaryDto[]
  configs?: readonly SavedConfig[]
  remote?: readonly RemoteModuleSummaryDto[]
  /** Hay bucket de catálogo → existe /modulos. */
  catalogEnabled: boolean
  /** Build de autoría. */
  admin: boolean
}

const STATUS_LABEL: Readonly<Record<string, string>> = {
  queued: 'en cola',
  running: 'en curso',
  completed: 'completada',
  failed: 'con error',
  timeout: 'se agotó el tiempo',
  cancelled: 'cancelada',
}

const hilos = (n: number): string => `${n} ${n === 1 ? 'hilo' : 'hilos'}`

function pagesIndex(catalogEnabled: boolean, admin: boolean): SearchItem[] {
  const pages: SearchItem[] = [
    { id: 'inicio', kind: 'pagina', title: 'Inicio', subtitle: 'Resumen y accesos rápidos', to: '/', keywords: 'home principal' },
    {
      id: 'simulador',
      kind: 'pagina',
      title: 'Simulador',
      subtitle: 'Configura y lanza una ejecución',
      to: '/simulador',
      keywords: 'ejecutar correr codigo hilos openmp',
    },
    {
      id: 'resultados',
      kind: 'pagina',
      title: 'Resultados',
      subtitle: 'Historial de ejecuciones',
      to: '/resultados',
      keywords: 'historial speedup metricas comparar',
    },
    {
      id: 'aprender',
      kind: 'pagina',
      title: 'Aprender',
      subtitle: 'Catálogo de cursos y lecciones',
      to: '/aprender',
      keywords: 'cursos lecciones quiz video',
    },
  ]
  if (catalogEnabled) {
    pages.push({
      id: 'modulos',
      kind: 'pagina',
      title: 'Módulos disponibles',
      subtitle: 'Descargar o actualizar cursos',
      to: '/modulos',
      keywords: 'instalar actualizar catalogo nube',
    })
  }
  if (admin) {
    pages.push({
      id: 'admin',
      kind: 'pagina',
      title: 'Autoría',
      subtitle: 'Editar el contenido del curso',
      to: '/admin',
      keywords: 'admin autor publicar lecciones',
    })
  }
  return pages
}

export function buildSearchIndex(src: SearchSources): SearchItem[] {
  const out: SearchItem[] = pagesIndex(src.catalogEnabled, src.admin)

  for (const mod of src.modules ?? []) {
    const lessons = mod.lessons.filter((l) => l.enabled)
    const first = lessons[0]
    if (first !== undefined) {
      out.push({
        id: `curso:${mod.id}`,
        kind: 'curso',
        title: mod.title,
        subtitle: `${mod.level} · ${lessons.length} ${lessons.length === 1 ? 'lección' : 'lecciones'}`,
        to: `/aprender/${encodeURIComponent(first.id)}`,
        keywords: mod.description,
      })
    }
    for (const l of lessons) {
      const extras = [l.has_video ? 'video' : '', l.has_quiz ? 'quiz' : '', l.example_id != null ? 'ejemplo' : '']
        .filter(Boolean)
        .join(' · ')
      out.push({
        id: `leccion:${l.id}`,
        kind: 'leccion',
        title: l.title,
        subtitle: extras === '' ? mod.title : `${mod.title} · ${extras}`,
        to: `/aprender/${encodeURIComponent(l.id)}`,
        keywords: `${mod.title} ${extras}`,
      })
    }
  }

  for (const ex of src.examples ?? []) {
    if (!ex.enabled) continue
    out.push({
      id: `ejemplo:${ex.id}`,
      kind: 'ejemplo',
      title: ex.title,
      subtitle: ex.teaches,
      to: `/simulador?ejemplo=${encodeURIComponent(ex.id)}`,
      keywords: `${ex.filename} ${ex.directives.join(' ')}`,
    })
  }

  for (const job of src.jobs ?? []) {
    const status = STATUS_LABEL[job.status] ?? job.status
    const live = job.status === 'queued' || job.status === 'running'
    out.push({
      id: `ejecucion:${job.job_id}`,
      kind: 'ejecucion',
      title: job.filename,
      subtitle: `${hilos(job.threads)} · ${status} · ${job.created_at.slice(0, 16).replace('T', ' ')}`,
      to: live ? `/simulador/${job.job_id}` : `/resultados/${job.job_id}`,
      keywords: `${job.job_id} ${job.status} ${job.example_id ?? ''}`,
    })
  }

  for (const cfg of src.configs ?? []) {
    out.push({
      id: `config:${cfg.id}`,
      kind: 'configuracion',
      title: cfg.name,
      subtitle: `${cfg.filename} · ${hilos(cfg.threads)}`,
      to: '/simulador',
      // El simulador ya sabe precargar esta forma (la misma de «Re-ejecutar»).
      state: {
        example_id: cfg.example_id,
        code: cfg.code,
        filename: cfg.filename,
        threads: cfg.threads,
        timeout_s: cfg.timeout_s,
        edited: cfg.edited,
      },
      keywords: cfg.example_id ?? '',
    })
  }

  if (src.catalogEnabled) {
    for (const m of src.remote ?? []) {
      out.push({
        id: `modulo:${m.id}`,
        kind: 'modulo',
        title: m.title,
        subtitle: `${m.level} · ${m.lessons_count} lecciones · v${m.version}`,
        to: `/modulos/${encodeURIComponent(m.id)}`,
        keywords: m.description,
      })
    }
  }

  return out
}
