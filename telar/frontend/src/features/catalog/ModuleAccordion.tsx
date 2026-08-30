// ModuleAccordion — card acordeón de módulo (frontend-spec §6.5, handoff §7):
// head con número, título, descripción, level-tag y progreso REAL del
// servidor (progress fusionado de /modules); aria-expanded en el botón.
// M8 GPU: chip-amber `requiere GPU NVIDIA + gcc` + filas disabled + banner.
import type { ExampleSummaryDto, ModuleDto, ModuleLessonDto } from '../../api/types'
import { IconAlert, IconChevronRight, IconPlay } from '../../components/icons/icons'
import { Chip } from '../../components/ui/Chip'
import type { CatalogFilter } from './CatalogToolbar'
import { LessonRow } from './LessonRow'

export interface LessonRowSpec {
  lesson: ModuleLessonDto
  index: number
}

/**
 * Filas visibles del módulo según filtro + búsqueda (título de lección o de
 * módulo). UNA fila por lección.
 *
 * Antes cada lección generaba DOS filas —«Ejemplo» y «Quiz»— que navegaban a la
 * misma pantalla y solo se diferenciaban en el ancla, lo que inflaba el catálogo
 * al doble y hacía que el contador dijera 28 donde hay 14 cosas (hallazgo F2).
 * Ahora la fila es una y lleva ambas metas; el acceso directo al quiz lo da el
 * FILTRO: con `filter === 'quiz'` la fila ancla en la sección del quiz.
 */
export function visibleRows(module: ModuleDto, filter: CatalogFilter, query: string): LessonRowSpec[] {
  const q = query.trim().toLowerCase()
  const moduleMatches = q === '' || module.title.toLowerCase().includes(q)
  const lessons = [...module.lessons].sort((a, b) => a.order - b.order)
  return lessons.flatMap((lesson, i) => {
    if (!moduleMatches && !lesson.title.toLowerCase().includes(q)) return []
    // El filtro selecciona LECCIONES por lo que contienen, no artefactos sueltos.
    if (filter === 'quiz' && !lesson.has_quiz) return []
    if (filter === 'example' && lesson.example_id === null) return []
    return [{ lesson, index: i + 1 }]
  })
}

export interface ModuleAccordionProps {
  module: ModuleDto
  open: boolean
  onToggle: () => void
  filter: CatalogFilter
  query: string
  examplesIndex: Map<string, ExampleSummaryDto> | null
  lastLessonId: string | null
  /** gpu_examples_enabled de GET /system (M8). */
  gpuEnabled: boolean
}

export function ModuleAccordion({
  module,
  open,
  onToggle,
  filter,
  query,
  examplesIndex,
  lastLessonId,
  gpuEnabled,
}: ModuleAccordionProps) {
  const done = module.lessons.filter((l) => l.progress.completed).length
  const total = module.lessons.length
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const rows = visibleRows(module, filter, query)
  // Solo las lecciones CON ejemplo pueden requerir GPU: una conceptual se lee
  // en cualquier máquina. El `?? !l.enabled` es el respaldo de cuando el índice
  // de ejemplos aún no cargó.
  const requiresGpu = module.lessons.some((l) =>
    l.example_id == null
      ? false
      : (examplesIndex?.get(l.example_id)?.requires_gpu ?? !l.enabled),
  )
  const gpuLocked = requiresGpu && !gpuEnabled
  const bodyId = `module-body-${module.id}`

  return (
    <div className={`cat-module card ${open ? 'open' : ''}`}>
      <button type="button" className="cat-module-head" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
        <span className="cat-module-n mono">{String(module.order).padStart(2, '0')}</span>
        <span className="cat-module-info">
          <span className="cat-module-title" style={{ display: 'block' }}>
            {module.title}
          </span>
          <span className="cat-module-desc" style={{ display: 'block' }}>
            {module.description}
          </span>
          <span className="cat-module-meta">
            <span className={`level-tag level-${module.level.toLowerCase()}`}>{module.level}</span>
            <span className="mono-small">
              <IconPlay size={10} /> {total} {total === 1 ? 'lección' : 'lecciones'}
            </span>
            {requiresGpu && <Chip tone="amber">requiere GPU NVIDIA + gcc</Chip>}
          </span>
        </span>
        <span className="cat-module-progress">
          <span className="cat-prog-n mono" style={{ display: 'block' }}>
            {pct}%
          </span>
          <span className="cat-prog-bar" style={{ display: 'block' }}>
            <span style={{ display: 'block', width: `${pct}%`, height: '100%' }} />
          </span>
        </span>
        <IconChevronRight size={16} className="cat-module-chev" />
      </button>

      {open && (
        <div className="cat-lesson-list" id={bodyId}>
          {gpuLocked && (
            <div className="gpu-banner" role="note">
              <IconAlert size={16} />
              <span>
                Este módulo requiere GPU NVIDIA + gcc; en esta máquina sus ejemplos no se pueden ejecutar.
              </span>
            </div>
          )}
          {rows.length === 0 && <div className="cat-empty mono-small">Sin resultados para este filtro.</div>}
          {rows.map(({ lesson, index }) => (
            <LessonRow
              key={lesson.id}
              lesson={lesson}
              index={index}
              estRunSeconds={
                lesson.example_id != null
                  ? examplesIndex?.get(lesson.example_id)?.est_run_seconds
                  : undefined
              }
              current={lesson.id === lastLessonId}
              disabled={
                !lesson.enabled ||
                (gpuLocked &&
                  lesson.example_id != null &&
                  (examplesIndex?.get(lesson.example_id)?.requires_gpu ?? true))
              }
              /* Con el filtro en «Quizzes», la fila lleva directo a la sección
                 del quiz: el acceso que antes daba la fila duplicada. */
              anchorQuiz={filter === 'quiz'}
            />
          ))}
        </div>
      )}
    </div>
  )
}
