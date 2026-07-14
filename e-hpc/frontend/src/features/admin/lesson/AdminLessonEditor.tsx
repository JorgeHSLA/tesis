// AdminLessonEditor — editor de lección (#/admin/lecciones/:lessonId y /nueva).
// Grid 2col: izq MarkdownEditor (WYSIWYG con renderMarkdown), der LessonMetaFields.
// En /nueva se crea la unidad completa (lección + ejemplo pareado + source_code,
// invariante C7) vía createLesson; en edición updateLesson (solo la faceta
// lección). AdminSaveBar sticky + bloqueo de navegación con cambios sin guardar.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useBlocker, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ApiError } from '../../../api/client'
import { createLesson, getAdminLesson, getAdminModules, updateLesson } from '../../../api/admin'
import { getSystem } from '../../../api/system'
import type {
  AdminExampleBaseDto,
  AdminLessonDetailDto,
  AdminModuleDto,
} from '../../../api/admin-types'
import type { PickedFile } from '../../../lib/pyfile'
import { Button } from '../../../components/ui/Button'
import { ErrorState } from '../../../components/ui/ErrorState'
import { Skeleton } from '../../../components/ui/Skeleton'
import { AdminSaveBar } from '../../../components/admin/AdminSaveBar'
import { ConfirmDialog } from '../../../components/admin/ConfirmDialog'
import { parseContentErrors } from '../field-errors'
import { CodeDropzone } from '../example/CodeDropzone'
import { ExampleMetaFields } from '../example/ExampleMetaFields'
import { MarkdownEditor } from './MarkdownEditor'
import { LessonMetaFields, type LessonMeta } from './LessonMetaFields'

const LESSON_FIELDS = ['id', 'module_id', 'order', 'title', 'estimated_minutes', 'content_markdown', 'recommended']
const EXAMPLE_FIELDS = [
  'title', 'filename', 'difficulty', 'teaches', 'directives', 'threads_configurable', 'fixed_threads',
  'fixed_threads_note', 'sweeps_threads', 'self_measures', 'parser_id', 'default_timeout_s', 'est_run_seconds',
  'enabled', 'requires_gpu', 'expected_output_note', 'takeaways',
]

const DEFAULT_EXAMPLE: AdminExampleBaseDto = {
  title: '',
  filename: 'main.py',
  difficulty: 1,
  teaches: '',
  directives: [],
  threads_configurable: true,
  fixed_threads: null,
  fixed_threads_note: null,
  sweeps_threads: false,
  self_measures: false,
  parser_id: 'none',
  default_timeout_s: 60,
  est_run_seconds: 5,
  enabled: true,
  requires_gpu: false,
  expected_output_note: '',
  takeaways: [],
}

interface LessonForm {
  meta: LessonMeta
  content_markdown: string
  /** Solo /nueva: ejemplo pareado + su código (C7). */
  example: AdminExampleBaseDto
  source_code: string
}

function blankForm(moduleId: string): LessonForm {
  return {
    meta: { id: '', module_id: moduleId, order: '', title: '', estimated_minutes: '', recommended: [] },
    content_markdown: '',
    example: DEFAULT_EXAMPLE,
    source_code: 'from numba import njit\n\n# Tu código PyOMP aquí\n',
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
      recommended: dto.recommended,
    },
    content_markdown: dto.content_markdown,
    example: DEFAULT_EXAMPLE,
    source_code: '',
  }
}

export default function AdminLessonEditor() {
  const { lessonId } = useParams()
  const isEdit = lessonId != null && lessonId !== ''
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const moduloParam = searchParams.get('modulo') ?? ''

  const [modules, setModules] = useState<AdminModuleDto[] | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [maxTimeoutS, setMaxTimeoutS] = useState(120)
  const [form, setForm] = useState<LessonForm | null>(null)
  const [initial, setInitial] = useState<LessonForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({})
  const bypassBlock = useRef(false)

  const loadAll = useCallback(() => {
    setLoadError(null)
    getAdminModules()
      .then((res) => setModules(res.modules))
      .catch((err: unknown) => setLoadError(err))
    if (isEdit) {
      getAdminLesson(lessonId!)
        .then((dto) => {
          const f = fromDetail(dto)
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

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !bypassBlock.current && currentLocation.pathname !== nextLocation.pathname,
  )

  const patchMeta = useCallback((patch: Partial<LessonMeta>) => {
    setForm((prev) => (prev ? { ...prev, meta: { ...prev.meta, ...patch } } : prev))
  }, [])
  const patchExample = useCallback((patch: Partial<AdminExampleBaseDto>) => {
    setForm((prev) => (prev ? { ...prev, example: { ...prev.example, ...patch } } : prev))
  }, [])
  const setMarkdown = useCallback((content_markdown: string) => {
    setForm((prev) => (prev ? { ...prev, content_markdown } : prev))
  }, [])
  const onFile = useCallback((file: PickedFile) => {
    setForm((prev) =>
      prev ? { ...prev, source_code: file.code, example: { ...prev.example, filename: file.filename } } : prev,
    )
  }, [])

  const discard = useCallback(() => {
    if (initial) setForm(initial)
    setBanner(null)
    setFieldErrors({})
  }, [initial])

  const save = useCallback(async () => {
    if (form == null || saving || !dirty) return
    const orderNum = Number.parseInt(form.meta.order, 10)
    const minNum = Number.parseInt(form.meta.estimated_minutes, 10)
    if (!Number.isInteger(orderNum) || orderNum < 1) {
      setBanner('El orden debe ser un entero mayor o igual que 1.')
      return
    }
    if (!Number.isInteger(minNum) || minNum < 0) {
      setBanner('Los minutos estimados deben ser un entero mayor o igual que 0.')
      return
    }
    const base = {
      module_id: form.meta.module_id,
      order: orderNum,
      title: form.meta.title.trim(),
      estimated_minutes: minNum,
      content_markdown: form.content_markdown,
      recommended: form.meta.recommended.filter((r) => r.lesson_id.trim() !== ''),
    }

    setSaving(true)
    setBanner(null)
    setFieldErrors({})
    try {
      if (isEdit) {
        await updateLesson(lessonId!, base)
        setInitial(form) // baja el dirty
      } else {
        await createLesson({
          id: form.meta.id.trim(),
          ...base,
          example: form.example,
          source_code: form.source_code,
        })
        bypassBlock.current = true
        setInitial(form)
        navigate('/admin')
      }
    } catch (err) {
      const known = isEdit ? LESSON_FIELDS : [...LESSON_FIELDS, ...EXAMPLE_FIELDS.map((f) => `example.${f}`), 'source_code']
      const parsed = parseContentErrors(err, known)
      setFieldErrors(parsed.byField)
      setBanner(parsed.banner ?? (err instanceof ApiError ? err.message : 'No se pudo guardar la lección.'))
    } finally {
      setSaving(false)
    }
  }, [form, saving, dirty, isEdit, lessonId, navigate])

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
          <p className="mono-small muted" style={{ margin: '6px 0 0' }}>
            {isEdit ? `${form.meta.id}` : 'Se creará junto con su ejemplo y código (unidad completa).'}
          </p>
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
          <LessonMetaFields mode={isEdit ? 'edit' : 'create'} value={form.meta} modules={modules} errors={fieldErrors} onChange={patchMeta} />

          {!isEdit && (
            <div className="col" style={{ gap: 14 }}>
              <div className="section-head" style={{ margin: 0 }}>
                <h3 className="display-md">Ejemplo pareado</h3>
                <p className="mono-small muted" style={{ margin: '4px 0 0' }}>
                  Toda lección nace con su ejemplo ejecutable y su código.
                </p>
              </div>
              <CodeDropzone
                filename={form.example.filename}
                code={form.source_code}
                error={fieldErrors.source_code}
                onCodeChange={(source_code) => setForm((prev) => (prev ? { ...prev, source_code } : prev))}
                onFile={onFile}
              />
              <ExampleMetaFields
                value={form.example}
                onChange={patchExample}
                maxTimeoutS={maxTimeoutS}
                errors={fieldErrors}
                errorPrefix="example."
              />
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

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        tone="danger"
        title="Cambios sin guardar"
        body="Si sales ahora perderás los cambios que no has guardado. ¿Quieres salir de todos modos?"
        confirmLabel="Salir sin guardar"
        cancelLabel="Seguir editando"
        onConfirm={() => blocker.proceed?.()}
        onCancel={() => blocker.reset?.()}
      />
    </section>
  )
}
