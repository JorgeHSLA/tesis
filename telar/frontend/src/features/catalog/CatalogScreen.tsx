// CatalogScreen — catálogo de contenidos (frontend-spec §6.5): ContinueCard,
// stats del `summary`, toolbar búsqueda/fpills y 8 ModuleAccordion con el
// progreso REAL del servidor (progress fusionado de GET /modules, caché en
// progressStore). Carga → skeleton de 8 cards; error → ErrorState con retry.
import '../../styles/screens/catalog.css'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { ExampleSummaryDto } from '../../api/types'
import { loadExamplesIndex } from '../../api/content'
import type { CatalogNavState } from '../../components/shell/TopBar'
import { ErrorState } from '../../components/ui/ErrorState'
import { Skeleton } from '../../components/ui/Skeleton'
import { useSystemInfo } from '../../hooks/useSystemInfo'
import { useProgressStore } from '../../stores/progressStore'
import { CatalogStats } from './CatalogStats'
import { CatalogToolbar, type CatalogFilter } from './CatalogToolbar'
import { ContinueCard } from './ContinueCard'
import { ModuleAccordion } from './ModuleAccordion'

export default function CatalogScreen() {
  const modules = useProgressStore((s) => s.modules)
  const summary = useProgressStore((s) => s.summary)
  const lastLessonId = useProgressStore((s) => s.lastLessonId)
  const storeError = useProgressStore((s) => s.error)
  const hydrate = useProgressStore((s) => s.hydrate)
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

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  // location.key cambia en CADA navegación, también /cursos → /cursos: pulsar
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
        {sorted.map((mod) => (
          <ModuleAccordion
            key={mod.id}
            module={mod}
            open={effectiveOpenId === mod.id}
            onToggle={() => setOpenId(effectiveOpenId === mod.id ? '' : mod.id)}
            filter={filter}
            query={query}
            examplesIndex={examplesIndex}
            lastLessonId={lastLessonId}
            gpuEnabled={system.data?.gpu_examples_enabled ?? false}
          />
        ))}
      </div>
    </section>
  )
}
