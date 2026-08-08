// AdminExampleEditor — uploader/editor de un ejemplo (#/admin/ejemplos/:exampleId).
// Grid 2col: izq CodeDropzone (.py, lib/pyfile), der ExampleMetaFields. Guardar
// discrimina: metadatos → updateExample; código → uploadExampleCode (los dos si
// ambos cambiaron). "Probar en simulador" (si habilitado y sin cambios) navega a
// #/simulador?ejemplo={id} y reusa el pipeline existente. fase4-autoria §9.F.5.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../../../api/client'
import { getAdminExample, updateExample, uploadExampleCode } from '../../../api/admin'
import { getSystem } from '../../../api/system'
import type { AdminExampleBaseDto, AdminExampleDto } from '../../../api/admin-types'
import type { PickedFile } from '../../../lib/pyfile'
import { useAdminResource } from '../../../hooks/useAdminResource'
import { Button } from '../../../components/ui/Button'
import { ErrorState } from '../../../components/ui/ErrorState'
import { Skeleton } from '../../../components/ui/Skeleton'
import { AdminSaveBar } from '../../../components/admin/AdminSaveBar'
import { parseContentErrors } from '../field-errors'
import { CodeDropzone } from './CodeDropzone'
import { ExampleMetaFields } from './ExampleMetaFields'

const KNOWN_FIELDS = [
  'title', 'filename', 'difficulty', 'teaches', 'directives', 'threads_configurable',
  'fixed_threads', 'fixed_threads_note', 'sweeps_threads', 'self_measures', 'parser_id',
  'default_timeout_s', 'est_run_seconds', 'enabled', 'requires_gpu', 'expected_output_note',
  'takeaways', 'source_code',
] as const

interface FormState {
  meta: AdminExampleBaseDto
  source_code: string
}

/** Proyecta el detalle a {meta, source_code} (descarta id/module_id/order). */
function toForm(dto: AdminExampleDto): FormState {
  const { id: _id, module_id: _m, order: _o, source_code, ...base } = dto
  return { meta: base, source_code }
}

export default function AdminExampleEditor() {
  const { exampleId = '' } = useParams()
  const navigate = useNavigate()

  const { data, loading, error, reload } = useAdminResource<AdminExampleDto>(
    () => getAdminExample(exampleId),
    [exampleId],
  )
  const [maxTimeoutS, setMaxTimeoutS] = useState(120)
  useEffect(() => {
    let alive = true
    getSystem()
      .then((s) => alive && setMaxTimeoutS(s.limits.max_timeout_s))
      .catch(() => {}) // el input queda con el default; el backend acota igual
    return () => {
      alive = false
    }
  }, [])

  const [form, setForm] = useState<FormState | null>(null)
  const [initial, setInitial] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({})

  // Rehidrata el formulario cuando llega/recarga el recurso.
  useEffect(() => {
    if (data != null) {
      const f = toForm(data)
      setForm(f)
      setInitial(f)
      setBanner(null)
      setFieldErrors({})
    }
  }, [data])

  const metaChanged = useMemo(
    () => (form && initial ? JSON.stringify(form.meta) !== JSON.stringify(initial.meta) : false),
    [form, initial],
  )
  const codeChanged = form != null && initial != null && form.source_code !== initial.source_code
  const dirty = metaChanged || codeChanged

  const patchMeta = useCallback((patch: Partial<AdminExampleBaseDto>) => {
    setForm((prev) => (prev ? { ...prev, meta: { ...prev.meta, ...patch } } : prev))
  }, [])
  const onCodeChange = useCallback((source_code: string) => {
    setForm((prev) => (prev ? { ...prev, source_code } : prev))
  }, [])
  const onFile = useCallback((file: PickedFile) => {
    setForm((prev) =>
      prev ? { ...prev, source_code: file.code, meta: { ...prev.meta, filename: file.filename } } : prev,
    )
  }, [])

  const discard = useCallback(() => {
    if (initial) setForm(initial)
    setBanner(null)
    setFieldErrors({})
  }, [initial])

  const save = useCallback(async () => {
    if (form == null || saving || !dirty) return
    setSaving(true)
    setBanner(null)
    setFieldErrors({})
    try {
      if (metaChanged) await updateExample(exampleId, form.meta)
      if (codeChanged) {
        await uploadExampleCode(exampleId, { filename: form.meta.filename, source_code: form.source_code })
      }
      setInitial(form) // baja el dirty sin recargar
      reload()
    } catch (err) {
      const parsed = parseContentErrors(err, KNOWN_FIELDS)
      setFieldErrors(parsed.byField)
      setBanner(parsed.banner ?? (err instanceof ApiError ? err.message : 'No se pudo guardar el ejemplo.'))
    } finally {
      setSaving(false)
    }
  }, [form, saving, dirty, metaChanged, codeChanged, exampleId, reload])

  if (loading && data == null) {
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

  if (error != null && data == null) {
    return (
      <section className="screen">
        <ErrorState
          message="No se pudo cargar el ejemplo."
          detail={error instanceof ApiError ? `${error.code}: ${error.message}` : String(error)}
          onRetry={reload}
        />
      </section>
    )
  }

  if (form == null || data == null) return null

  const canTest = data.enabled && !dirty

  return (
    <section className="screen">
      <header className="screen-head">
        <div>
          <div className="eyebrow">Autoría · Ejemplo</div>
          <h2 className="display-lg">{data.title || 'Ejemplo'}</h2>
          <p className="mono-small muted" style={{ margin: '6px 0 0' }}>
            {data.id} · módulo {data.module_id}
          </p>
        </div>
        <div className="admin-topbar-actions">
          <Button variant="ghost" size="sm" onClick={() => navigate('/admin')}>
            Volver al panel
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!canTest}
            title={
              !data.enabled
                ? 'Habilita el ejemplo para probarlo'
                : dirty
                  ? 'Guarda los cambios antes de probar'
                  : undefined
            }
            onClick={() => navigate(`/simulador?ejemplo=${encodeURIComponent(data.id)}`)}
          >
            Probar en simulador
          </Button>
        </div>
      </header>

      <div
        className="grid"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))', gap: 20, alignItems: 'start' }}
      >
        <CodeDropzone
          filename={form.meta.filename}
          code={form.source_code}
          edited={codeChanged}
          error={fieldErrors.source_code}
          onCodeChange={onCodeChange}
          onFile={onFile}
        />
        <ExampleMetaFields value={form.meta} onChange={patchMeta} maxTimeoutS={maxTimeoutS} errors={fieldErrors} />
      </div>

      <AdminSaveBar
        dirty={dirty}
        saving={saving}
        error={banner ?? undefined}
        onSave={save}
        onDiscard={discard}
        saveLabel="Guardar ejemplo"
      />
    </section>
  )
}
