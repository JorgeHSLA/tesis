// AdminLessonEditor — editor de lección (#/admin/lecciones/:lessonId y /nueva).
// Grid 2col: izq MarkdownEditor (WYSIWYG con renderMarkdown), der LessonMetaFields.
// En /nueva se crea la lección con o sin ejemplo (CU-17.1) vía createLesson; en
// edición updateLesson (solo la faceta lección) y, si no tiene ejemplo, «Agregar
// ejemplo» (CU-18.2). Cambiar módulo u orden recoloca las demás lecciones con
// un PUT /admin/lessons/reorder (CU-19.1). AdminSaveBar sticky + guarda de
// cambios sin guardar para toda navegación y la recarga (useUnsavedChangesGuard).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ApiError } from '../../../api/client'
import { createLesson, getAdminLesson, getAdminModules, reorderLessons, updateLesson } from '../../../api/admin'
import { getSystem } from '../../../api/system'
import type { AdminLessonDetailDto, AdminLessonUpdateDto, AdminModuleDto } from '../../../api/admin-types'
import { Button } from '../../../components/ui/Button'
import { Chip } from '../../../components/ui/Chip'
import { ErrorState } from '../../../components/ui/ErrorState'
import { Skeleton } from '../../../components/ui/Skeleton'
import { AdminSaveBar } from '../../../components/admin/AdminSaveBar'
import { useUnsavedChangesGuard } from '../../../hooks/useUnsavedChangesGuard'
import { isPositionTaken, planLessonMove } from '../../../lib/lessonMove'
import { parseContentErrors } from '../field-errors'
import { AddExamplePanel } from './AddExamplePanel'
import { blankDraft, EXAMPLE_FIELDS, type ExampleDraft } from './exampleDraft'
import { ExampleDraftFields } from './ExampleDraftFields'
import { MarkdownEditor } from './MarkdownEditor'
import { LessonMetaFields, completionRuleIssue, type LessonMeta } from './LessonMetaFields'

const LESSON_FIELDS = [
  'id', 'module_id', 'order', 'title', 'estimated_minutes', 'content_markdown', 'recommended',
  'video_url', 'enabled', 'completion_rule',
]

interface LessonForm {
  meta: LessonMeta
  content_markdown: string
  /** Solo /nueva (CU-17.1): `false` ⇒ lección teórica, sin ejemplo ni código. */
  withExample: boolean
  /** Solo /nueva: el ejemplo y su código, si `withExample`. */
  draft: ExampleDraft
}

/** El reorden ya se aplicó en el servidor, pero el PUT de la lección falló. */
class MovedButNotSavedError extends Error {
  constructor(
    readonly position: number,
    readonly cause: unknown,
  ) {
    super('moved-but-not-saved')
  }
}

/** Aviso que el editor recibe al navegar (p. ej. «creada, pero no se movió»). */
interface EditorLocationState {
  aviso?: string
}

function blankForm(moduleId: string): LessonForm {
  return {
    meta: {
      id: '', module_id: moduleId, order: '', title: '', estimated_minutes: '',
      video_url: '', enabled: true, completion_rule: 'quiz', recommended: [],
    },
    content_markdown: '',
    withExample: false,
    draft: blankDraft(),
  }
}

function fromDetail(dto: AdminLessonDetailDto): LessonForm {
  return {
    meta: {
      id: dto.id,
      module_id: dto.module_id,
      order: String(dto.order),
      title: dto.title,
      estimated_minutes: String(dto.estimated_minutes),
      video_url: dto.video_url ?? '',
      enabled: dto.enabled,
      completion_rule: dto.completion_rule,
      recommended: dto.recommended,
    },
    content_markdown: dto.content_markdown,
    withExample: false,
    draft: blankDraft(),
  }
}

/** Entero ≥ `min` escrito tal cual: «2.5», «1e2» o «» no valen (CU-19.3). */
function parseIntAtLeast(raw: string, min: number): number | null {
  const text = raw.trim()
  if (!/^\d+$/.test(text)) return null
  const n = Number(text)
  return n >= min ? n : null
}

/** Siguiente posición libre al final del módulo (ignora huecos intermedios). */
function endOf(modules: readonly AdminModuleDto[], moduleId: string): number {
  const lessons = modules.find((m) => m.id === moduleId)?.lessons ?? []
  return lessons.reduce((max, l) => Math.max(max, l.order), 0) + 1
}

/** `modules` con una lección recién creada añadida a su módulo (inmutable). */
function withLesson(modules: readonly AdminModuleDto[], moduleId: string, id: string, order: number) {
  return modules.map((m) => (m.id === moduleId ? { ...m, lessons: [...m.lessons, { id, order }] } : m))
}

export default function AdminLessonEditor() {
  const { lessonId } = useParams()
  const isEdit = lessonId != null && lessonId !== ''
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const moduloParam = searchParams.get('modulo') ?? ''
  const abrirEjemplo = searchParams.get('ejemplo') === 'nuevo'

  const [modules, setModules] = useState<AdminModuleDto[] | null>(null)
  const [detail, setDetail] = useState<AdminLessonDetailDto | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [maxTimeoutS, setMaxTimeoutS] = useState(120)
  const [form, setForm] = useState<LessonForm | null>(null)
  const [initial, setInitial] = useState<LessonForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [banner, setBanner] = useState<string | null>(
    () => (location.state as EditorLocationState | null)?.aviso ?? null,
  )
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({})
  const [exampleDraftDirty, setExampleDraftDirty] = useState(false)

  const loadAll = useCallback(() => {
    setLoadError(null)
    getAdminModules()
      .then((res) => setModules(res.modules))
      .catch((err: unknown) => setLoadError(err))
    if (isEdit) {
      getAdminLesson(lessonId!)
        .then((dto) => {
          const f = fromDetail(dto)
          setDetail(dto)
          setForm(f)
          setInitial(f)
        })
        .catch((err: unknown) => setLoadError(err))
    } else {
      const f = blankForm(moduloParam)
      setForm(f)
      setInitial(f)
    }
  }, [isEdit, lessonId, moduloParam])

  useEffect(loadAll, [loadAll])
  useEffect(() => {
    let alive = true
    getSystem()
      .then((s) => alive && setMaxTimeoutS(s.limits.max_timeout_s))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const dirty = useMemo(
    () => (form && initial ? JSON.stringify(form) !== JSON.stringify(initial) : false),
    [form, initial],
  )

  const guard = useUnsavedChangesGuard(dirty || exampleDraftDirty)

  const hasExample = isEdit ? detail?.example != null : (form?.withExample ?? false)
  const hasQuiz = isEdit ? (detail?.has_quiz ?? false) : false

  const patchMeta = useCallback((patch: Partial<LessonMeta>) => {
    setForm((prev) => (prev ? { ...prev, meta: { ...prev.meta, ...patch } } : prev))
  }, [])
  const setMarkdown = useCallback((content_markdown: string) => {
    setForm((prev) => (prev ? { ...prev, content_markdown } : prev))
  }, [])
  const setDraft = useCallback((draft: ExampleDraft) => {
    setForm((prev) => (prev ? { ...prev, draft } : prev))
  }, [])

  const discard = useCallback(() => {
    if (initial) setForm(initial)
    setBanner(null)
    setFieldErrors({})
  }, [initial])

  /** Edición: recoloca si cambió el módulo o el orden, y guarda la lección. */
  const saveEdit = async (f: LessonForm, base: AdminLessonUpdateDto) => {
    const moved = initial == null || base.module_id !== initial.meta.module_id || String(base.order) !== initial.meta.order
    let finalBase = base
    // GET /admin/modules incluye las archivadas: entran en el lote y reciben un
    // número propio. Es inocuo (el índice único solo cubre las vivas); como
    // mucho deja huecos en la numeración visible de un módulo actualizado.
    if (moved && modules != null) {
      const plan = planLessonMove(modules, lessonId!, base.module_id, base.order)
      const res = await reorderLessons(plan.items)
      setModules(res.modules)
      finalBase = { ...base, order: plan.order }
      // El movimiento ya es un hecho: `initial` lo refleja para que un fallo
      // del PUT de abajo no aparente que nada cambió.
      setInitial((prev) =>
        prev ? { ...prev, meta: { ...prev.meta, module_id: base.module_id, order: String(plan.order) } } : prev,
      )
      setForm((prev) => (prev ? { ...prev, meta: { ...prev.meta, order: String(plan.order) } } : prev))
    }
    let saved: AdminLessonDetailDto
    try {
      saved = await updateLesson(lessonId!, finalBase)
    } catch (err) {
      throw moved ? new MovedButNotSavedError(finalBase.order, err) : err
    }
    const next = { ...f, meta: { ...f.meta, order: String(finalBase.order) } }
    setDetail(saved)
    setForm(next)
    setInitial(next) // baja el dirty
  }

  /** Creación: en una posición ocupada crea al final y luego inserta (CU-19.1). */
  const saveCreate = async (f: LessonForm, base: AdminLessonUpdateDto) => {
    const id = f.meta.id.trim()
    const all = modules ?? []
    const taken = isPositionTaken(all, base.module_id, base.order)
    const createOrder = taken ? endOf(all, base.module_id) : base.order
    await createLesson({
      id,
      ...base,
      order: createOrder,
      example: f.withExample ? f.draft.example : null,
      source_code: f.withExample ? f.draft.source_code : null,
    })
    guard.allowNavigation()
    setInitial(f)
    if (!taken) {
      navigate('/admin')
      return
    }
    try {
      const plan = planLessonMove(withLesson(all, base.module_id, id, createOrder), id, base.module_id, base.order)
      await reorderLessons(plan.items)
      navigate('/admin')
    } catch (err) {
      // La lección YA existe: quedarse en /nueva invitaría a crearla otra vez.
      const motivo = err instanceof ApiError ? err.message : 'error desconocido'
      const aviso = `La lección se creó al final del módulo, pero no se pudo mover a la posición ${base.order}: ${motivo}`
      navigate(`/admin/lecciones/${encodeURIComponent(id)}`, { state: { aviso } satisfies EditorLocationState })
    }
  }

  const save = useCallback(async () => {
    if (form == null || saving || !dirty) return
    const orderNum = parseIntAtLeast(form.meta.order, 1)
    const minNum = parseIntAtLeast(form.meta.estimated_minutes, 0)
    if (orderNum == null) {
      setBanner('La posición debe ser un número entero mayor o igual que 1.')
      return
    }
    if (minNum == null) {
      setBanner('Los minutos estimados deben ser un número entero mayor o igual que 0.')
      return
    }
    const ruleIssue = completionRuleIssue(form.meta.completion_rule, { hasExample, hasQuiz })
    if (ruleIssue?.level === 'error') {
      // El porqué ya está junto al selector y se va al corregirlo.
      setBanner('Corrige la regla de completitud antes de guardar.')
      return
    }
    const base: AdminLessonUpdateDto = {
      module_id: form.meta.module_id,
      order: orderNum,
      title: form.meta.title.trim(),
      estimated_minutes: minNum,
      content_markdown: form.content_markdown,
      video_url: form.meta.video_url.trim() || null,
      enabled: form.meta.enabled,
      completion_rule: form.meta.completion_rule,
      recommended: form.meta.recommended.filter((r) => r.lesson_id.trim() !== ''),
    }

    setSaving(true)
    setBanner(null)
    setFieldErrors({})
    try {
      await (isEdit ? saveEdit(form, base) : saveCreate(form, base))
    } catch (caught) {
      const partial = caught instanceof MovedButNotSavedError ? caught : null
      const err = partial ? partial.cause : caught
      const withExampleFields = !isEdit && form.withExample
      const known = withExampleFields
        ? [...LESSON_FIELDS, ...EXAMPLE_FIELDS.map((f) => `example.${f}`), 'source_code']
        : LESSON_FIELDS
      const parsed = parseContentErrors(err, known)
      const detalle = parsed.banner ?? (err instanceof ApiError ? err.message : 'No se pudo guardar la lección.')
      setFieldErrors(parsed.byField)
      setBanner(
        partial
          ? `La lección ya se movió a la posición ${partial.position} (y se recolocaron las demás), pero no se guardaron los otros cambios: ${detalle}`
          : detalle,
      )
    } finally {
      setSaving(false)
    }
    // saveEdit/saveCreate se recrean en cada render y leen el mismo estado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, saving, dirty, isEdit, hasExample, hasQuiz, modules, initial, lessonId, navigate])

  if (loadError != null && form == null) {
    return (
      <section className="screen">
        <ErrorState
          message="No se pudo cargar la lección."
          detail={loadError instanceof ApiError ? `${loadError.code}: ${loadError.message}` : String(loadError)}
          onRetry={loadAll}
        />
      </section>
    )
  }

  if (form == null || modules == null) {
    return (
      <section className="screen">
        <Skeleton width={260} height={28} />
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 20 }}>
          <Skeleton height={420} radius="var(--r-lg)" />
          <Skeleton height={420} radius="var(--r-lg)" />
        </div>
      </section>
    )
  }

  return (
    <section className="screen">
      <header className="screen-head">
        <div>
          <div className="eyebrow">Autoría · Lección</div>
          <h2 className="display-lg">{isEdit ? form.meta.title || 'Lección' : 'Nueva lección'}</h2>
          <div className="row" style={{ gap: 8, alignItems: 'center', marginTop: 6 }}>
            <p className="mono-small muted" style={{ margin: 0 }}>
              {isEdit ? `${form.meta.id}` : 'Con ejemplo ejecutable o solo teoría.'}
            </p>
            {detail?.archived && <Chip tone="amber">Archivada</Chip>}
          </div>
          {detail?.archived && (
            <p className="mono-small muted" style={{ margin: '6px 0 0' }}>
              Una versión posterior del curso la retiró: no aparece en la ruta del estudiante, pero conserva su progreso.
            </p>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={() => navigate('/admin')}>
          Volver al panel
        </Button>
      </header>

      <div
        className="grid"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))', gap: 20, alignItems: 'start' }}
      >
        <MarkdownEditor
          value={form.content_markdown}
          onChange={setMarkdown}
          error={fieldErrors.content_markdown}
        />
        <div className="col" style={{ gap: 18 }}>
          <LessonMetaFields
            mode={isEdit ? 'edit' : 'create'}
            value={form.meta}
            modules={modules}
            hasExample={hasExample}
            hasQuiz={hasQuiz}
            errors={fieldErrors}
            onChange={patchMeta}
          />

          {isEdit && detail != null && (
            <AddExamplePanel
              lessonId={detail.id}
              exampleId={detail.example?.id ?? null}
              maxTimeoutS={maxTimeoutS}
              startOpen={abrirEjemplo}
              key={detail.id}
              onAdded={(example) => setDetail((prev) => (prev ? { ...prev, example } : prev))}
              onDraftDirtyChange={setExampleDraftDirty}
            />
          )}

          {!isEdit && (
            <div className="col" style={{ gap: 14 }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={form.withExample}
                  onChange={(e) => {
                    const withExample = e.currentTarget.checked
                    setForm((prev) => (prev ? { ...prev, withExample } : prev))
                  }}
                />
                <span>Esta lección tiene ejemplo ejecutable</span>
              </label>
              {form.withExample && (
                <ExampleDraftFields
                  value={form.draft}
                  onChange={setDraft}
                  maxTimeoutS={maxTimeoutS}
                  errors={fieldErrors}
                />
              )}
            </div>
          )}
        </div>
      </div>

      <AdminSaveBar
        dirty={dirty}
        saving={saving}
        error={banner ?? undefined}
        onSave={save}
        onDiscard={discard}
        saveLabel={isEdit ? 'Guardar lección' : 'Crear lección'}
      />

      {guard.dialog}
    </section>
  )
}
