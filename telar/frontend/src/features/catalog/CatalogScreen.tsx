// CatalogScreen — catálogo de contenidos (frontend-spec §6.5): ContinueCard,
// stats del `summary`, toolbar búsqueda/fpills y 8 ModuleAccordion con el
// progreso REAL del servidor (progress fusionado de GET /modules, caché en
// progressStore). Carga → skeleton de 8 cards; error → ErrorState con retry.
//
// FASE 5 — aviso de actualizaciones (§11.0.8). Esta pantalla consulta el
// catálogo, pero NO DEPENDE de él: el único `ErrorState` que puede pintar
// sigue siendo el de `GET /modules`. Si el bucket está caído, si no hay bucket
// configurado o si no hay red, `/aprender` se pinta EXACTAMENTE igual que hoy y
// simplemente se queda sin chips ni tira. Esa degradación silenciosa es el
// requisito de escritorio, no un descuido: hay un test que la defiende.
import '../../styles/screens/catalog.css'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import type { ExampleSummaryDto } from '../../api/types'
import { loadExamplesIndex } from '../../api/content'
import { IconArrowRight, IconDownload } from '../../components/icons/icons'
import type { CatalogNavState } from '../../components/shell/TopBar'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorState } from '../../components/ui/ErrorState'
import { Skeleton } from '../../components/ui/Skeleton'
import { useSystemInfo } from '../../hooks/useSystemInfo'
import { pendingUpdates } from '../../lib/catalogDiff'
import { useCatalogStore } from '../../stores/catalogStore'
import { useProgressStore } from '../../stores/progressStore'
import { CatalogStats } from './CatalogStats'
import { CatalogToolbar, type CatalogFilter } from './CatalogToolbar'
import { ContinueCard } from './ContinueCard'
import { ModuleAccordion, visibleRows } from './ModuleAccordion'

export default function CatalogScreen() {
  const modules = useProgressStore((s) => s.modules)
  const summary = useProgressStore((s) => s.summary)
  const lastLessonId = useProgressStore((s) => s.lastLessonId)
  const storeError = useProgressStore((s) => s.error)
  const hydrate = useProgressStore((s) => s.hydrate)
  // Del catálogo solo se lee el `status` (§11.4.1: SQLite, 200 siempre). Ni
  // `remoteError` ni `loadingRemote` entran aquí: el bucket no pinta nada en
  // esta pantalla, ni siquiera un skeleton.
  const catalogStatus = useCatalogStore((s) => s.status)
  const hydrateCatalogStatus = useCatalogStore((s) => s.hydrateStatus)
  const system = useSystemInfo()
  const location = useLocation()
  const navigate = useNavigate()

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<CatalogFilter>('all')
  const [examplesIndex, setExamplesIndex] = useState<Map<string, ExampleSummaryDto> | null>(null)
  // Acordeón de UN módulo abierto: default el del lastLessonId, si no M1.
  const [openId, setOpenId] = useState<string | null>(null)
  // Petición de foco del botón «Buscar» del TopBar. Se guarda en estado porque
  // la toolbar aún no existe mientras el catálogo carga (skeleton): la bandera
  // espera y la consume la toolbar al montarse.
  const [focusSearch, setFocusSearch] = useState(false)
  // S2 (CU-01.1): con búsqueda o filtro activos se abren TODOS los módulos con
  // coincidencias; aquí se guardan los que el usuario cierre a mano. Se vacía
  // al cambiar la búsqueda o el filtro.
  // La clave búsqueda+filtro va junto al set: si cambian, el set deja de valer
  // en el mismo render (sin efecto ni frame intermedio con el set viejo).
  const filterKey = `${query}\u0000${filter}`
  const [closedState, setClosedState] = useState<{ key: string; ids: ReadonlySet<string> }>(() => ({
    key: filterKey,
    ids: new Set(),
  }))
  const closedWhileFiltering = closedState.key === filterKey ? closedState.ids : NO_IDS

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  // Aviso de actualizaciones — EFECTO NO BLOQUEANTE (§11.4.2). Dos pasos:
  //   1. `GET /catalog/status`, que lee SOLO SQLite y responde 200 siempre;
  //   2. `POST /catalog/refresh`, la ÚNICA llamada de esta pantalla que sale a
  //      la red, y solo si este despliegue tiene bucket.
  // El fallo de cualquiera de las dos significa «hoy no hay chips» y nada más:
  // el store lo guarda en `statusError`, que esta pantalla NO lee a propósito.
  // Renderizarlo como `ErrorState` convertiría un bucket caído en un catálogo
  // de contenidos inaccesible, que es justo lo que §11.0.8 prohíbe.
  useEffect(() => {
    let alive = true
    const avisarDeActualizaciones = async (): Promise<void> => {
      await hydrateCatalogStatus()
      if (!alive) return
      const catalog = useCatalogStore.getState()
      // Sin bucket configurado el refresh solo podría devolver 503
      // CATALOG_DISABLED; y si ya hay uno en vuelo, no se duplica.
      if (catalog.status?.catalog_enabled !== true || catalog.refreshing) return
      await catalog.refreshStatus()
    }
    // Defensivo: hoy ninguna de las dos acciones rechaza (capturan dentro),
    // pero un `unhandledrejection` aquí sería un fallo invisible.
    void avisarDeActualizaciones().catch(() => undefined)
    return () => {
      alive = false
    }
  }, [hydrateCatalogStatus])

  // location.key cambia en CADA navegación, también /aprender → /aprender: pulsar
  // «Buscar» estando ya en el catálogo vuelve a enfocar.
  //
  // Tras consumirla, la bandera se BORRA del history state. Si no, la entrada
  // del historial se queda marcada para siempre y volver ATRÁS a esta pantalla
  // (p. ej. desde una lección) robaría el foco otra vez sin que el usuario haya
  // pedido nada — un cambio de contexto inesperado (WCAG 3.2.1/3.2.2). El
  // `replace` no crea entrada nueva y el efecto vuelve a entrar una sola vez,
  // ya con state null, así que no hay bucle.
  useEffect(() => {
    if ((location.state as CatalogNavState | null)?.focusSearch !== true) return
    setFocusSearch(true)
    navigate(location.pathname, { replace: true, state: null })
  }, [location.key, location.state, location.pathname, navigate])

  const handleSearchFocused = useCallback(() => setFocusSearch(false), [])

  useEffect(() => {
    let alive = true
    loadExamplesIndex()
      .then((idx) => {
        if (alive) setExamplesIndex(idx)
      })
      .catch(() => {
        // metas `~{n}s` degradan a '—'; el catálogo sigue funcionando.
      })
    return () => {
      alive = false
    }
  }, [])

  const sorted = useMemo(() => (modules ? [...modules].sort((a, b) => a.order - b.order) : null), [modules])

  /**
   * `module_id → versión disponible`, con una regla de precedencia explícita:
   *
   *  · con `/catalog/status` en mano manda ÉL, porque es el único que también
   *    APAGA un chip cuando un módulo deja de tener versión nueva (el refresh
   *    reescribe `available_version` a `null` si el bucket lo despublicó);
   *  · mientras no haya llegado —aún cargando, o la llamada falló— se cae al
   *    `update_available` que `GET /modules` YA trajo. Es la misma SQLite
   *    local, así que el aviso sobrevive a un bucket caído en vez de
   *    parpadear.
   *
   * No hay tercera vía: si las dos fuentes callan, no hay chips y punto.
   */
  const updates = useMemo(() => {
    if (catalogStatus !== null) return pendingUpdates(catalogStatus.modules)
    const previo = new Map<string, number>()
    for (const mod of sorted ?? []) {
      if (mod.update_available != null && mod.update_available > mod.version) {
        previo.set(mod.id, mod.update_available)
      }
    }
    return previo
  }, [catalogStatus, sorted])

  const defaultOpenId = useMemo(() => {
    if (!sorted || sorted.length === 0) return null
    const withLast = lastLessonId ? sorted.find((m) => m.lessons.some((l) => l.id === lastLessonId)) : undefined
    return (withLast ?? sorted[0]).id
  }, [sorted, lastLessonId])

  const effectiveOpenId = openId ?? defaultOpenId

  if (modules === null && storeError !== null) {
    return (
      <section className="screen catalog">
        <ErrorState
          message="No se pudo cargar el catálogo de contenidos."
          detail={storeError}
          onRetry={() => void hydrate(true)}
        />
      </section>
    )
  }

  if (sorted === null || summary === null) {
    // Skeleton: silueta del layout con 8 cards de módulo (frontend-spec §6.5).
    return (
      <section className="screen catalog" aria-busy="true">
        <div className="screen-head">
          <div>
            <Skeleton width={140} height={12} style={{ marginBottom: 10 }} />
            <Skeleton width={360} height={30} />
          </div>
          <Skeleton width={280} height={120} radius="var(--r-lg)" />
        </div>
        <div className="catalog-stats" aria-hidden="true">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} height={72} radius="var(--r-md)" />
          ))}
        </div>
        <div className="catalog-skeleton" aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} height={96} radius="var(--r-lg)" />
          ))}
        </div>
      </section>
    )
  }

  // F2: los contadores cuentan LECCIONES, no artefactos. Antes `all` sumaba
  // lecciones + quizzes y decía 28 donde hay 14 cosas. Se derivan de los módulos
  // (no del `summary`) para que sigan siendo ciertos cuando una lección pueda
  // existir sin ejemplo.
  const allLessons = sorted.flatMap((m) => m.lessons)
  const totals = {
    all: allLessons.length,
    examples: allLessons.filter((l) => l.example_id !== null).length,
    quizzes: allLessons.filter((l) => l.has_quiz).length,
  }
  // La tira cuenta MÓDULOS VISIBLES, no filas del manifiesto: así su número y
  // la cantidad de chips pintados no pueden discrepar nunca (un módulo recién
  // instalado puede estar ya en `/catalog/status` y todavía no en esta caché).
  const conActualizacion = sorted.filter((mod) => updates.has(mod.id)).length
  // S2 (CU-01.1/01.2): con búsqueda o filtro activos se ocultan los módulos sin
  // coincidencias; si no queda ninguno, un único mensaje global.
  const filtering = query.trim() !== '' || filter !== 'all'
  const shown = filtering ? sorted.filter((mod) => visibleRows(mod, filter, query).length > 0) : sorted

  return (
    <section className="screen catalog">
      <div className="screen-head">
        <div>
          <div className="eyebrow">Aprendizaje</div>
          <h2 className="display-lg">Catálogo de contenidos</h2>
          <p className="muted" style={{ margin: '6px 0 0', maxWidth: 620 }}>
            Las lecciones y quizzes del curso de OpenMP con PyOMP, organizados en 8 módulos. Cada lección se
            ejecuta de verdad en el simulador.
          </p>
        </div>
        <ContinueCard modules={sorted} lastLessonId={lastLessonId} examplesIndex={examplesIndex} />
      </div>

      {/* Tira de aviso, hermana de `.gpu-banner`. `role="status"` (no `note`)
          porque aparece DESPUÉS del primer pintado, cuando responde el
          catálogo: así se anuncia una vez, en modo cortés, sin robar el foco. */}
      {conActualizacion > 0 && (
        <div className="catalog-updates" role="status">
          <IconDownload size={16} />
          <span>
            {conActualizacion} {conActualizacion === 1 ? 'módulo' : 'módulos'} con actualización
          </span>
          <span className="catalog-updates-sep" aria-hidden="true">
            ·
          </span>
          <Link className="catalog-updates-link" to="/modulos">
            Revisar
            <IconArrowRight size={14} />
          </Link>
        </div>
      )}

      <CatalogStats summary={summary} moduleCount={sorted.length} exampleCount={totals.examples} />

      <CatalogToolbar
        query={query}
        onQuery={setQuery}
        filter={filter}
        onFilter={setFilter}
        totals={totals}
        autoFocus={focusSearch}
        onFocused={handleSearchFocused}
      />

      <div className="catalog-modules">
        {filtering && shown.length === 0 && (
          <EmptyState title="No se encontraron resultados" body="Prueba con otro término o quita el filtro." />
        )}
        {shown.map((mod) => (
          <ModuleAccordion
            key={mod.id}
            module={mod}
            open={filtering ? !closedWhileFiltering.has(mod.id) : effectiveOpenId === mod.id}
            onToggle={() =>
              filtering
                ? setClosedState({ key: filterKey, ids: toggled(closedWhileFiltering, mod.id) })
                : setOpenId(effectiveOpenId === mod.id ? '' : mod.id)
            }
            filter={filter}
            query={query}
            examplesIndex={examplesIndex}
            lastLessonId={lastLessonId}
            updateVersion={updates.get(mod.id) ?? null}
            gpuEnabled={system.data?.gpu_examples_enabled ?? false}
          />
        ))}
      </div>
    </section>
  )
}

const NO_IDS: ReadonlySet<string> = new Set()

/** Copia de `set` con `id` alternado (sin mutar el original). */
function toggled(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}
