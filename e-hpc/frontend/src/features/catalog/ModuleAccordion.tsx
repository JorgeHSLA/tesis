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
  kind: 'example' | 'quiz'
  index: number
}

/** Filas visibles del módulo según filtro + búsqueda (título lección/módulo). */
export function visibleRows(module: ModuleDto, filter: CatalogFilter, query: string): LessonRowSpec[] {
  const q = query.trim().toLowerCase()
  const moduleMatches = q === '' || module.title.toLowerCase().includes(q)
  const lessons = [...module.lessons].sort((a, b) => a.order - b.order)
  return lessons.flatMap((lesson, i) => {
    if (!moduleMatches && !lesson.title.toLowerCase().includes(q)) return []
    const rows: LessonRowSpec[] = []
    if (filter !== 'quiz') rows.push({ lesson, kind: 'example', index: i + 1 })
    if (filter !== 'example' && lesson.has_quiz) rows.push({ lesson, kind: 'quiz', index: i + 1 })
    return rows
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
  const requiresGpu = module.lessons.some(
    (l) => examplesIndex?.get(l.example_id)?.requires_gpu ?? !l.enabled,
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
          {rows.map(({ lesson, kind, index }) => (
            <LessonRow
              key={`${lesson.id}-${kind}`}
              lesson={lesson}
              kind={kind}
              index={index}
              estRunSeconds={examplesIndex?.get(lesson.example_id)?.est_run_seconds}
              current={lesson.id === lastLessonId}
              disabled={!lesson.enabled || (gpuLocked && (examplesIndex?.get(lesson.example_id)?.requires_gpu ?? true))}
            />
          ))}
        </div>
      )}
    </div>
  )
}
