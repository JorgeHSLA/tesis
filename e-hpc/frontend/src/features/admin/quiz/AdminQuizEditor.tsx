// AdminQuizEditor — editor del quiz de una lección (#/admin/quiz/:lessonId).
// getAdminQuiz (el GET admin SÍ trae correct_key/explanation); lista de
// QuestionEditorCard con add/remove/reorder INMUTABLES que recomputan `order`.
// Guardar → putAdminQuiz (reemplazo total). `pass_threshold` editable como %.
// fase4-autoria-design §9.F.4.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ApiError } from '../../../api/client'
import { getAdminQuiz, putAdminQuiz } from '../../../api/admin'
import type { AdminQuizDto, AdminQuizQuestionDto } from '../../../api/admin-types'
import { Button } from '../../../components/ui/Button'
import { EmptyState } from '../../../components/ui/EmptyState'
import { ErrorState } from '../../../components/ui/ErrorState'
import { Field } from '../../../components/ui/Field'
import { Skeleton } from '../../../components/ui/Skeleton'
import { IconHelp, IconPlus } from '../../../components/icons/icons'
import { AdminSaveBar } from '../../../components/admin/AdminSaveBar'
import { useAdminResource } from '../../../hooks/useAdminResource'
import { parseContentErrors } from '../field-errors'
import { QuestionEditorCard } from './QuestionEditorCard'

/** Fila local: la pregunta del contrato + una clave estable para React. */
interface QRow extends AdminQuizQuestionDto {
  _cid: string
}

let cidSeq = 0
function nextCid(): string {
  cidSeq += 1
  return `q-${cidSeq}-${Math.random().toString(36).slice(2, 8)}`
}

function newQuestion(): QRow {
  return {
    _cid: nextCid(),
    id: '',
    order: 0,
    text: '',
    options: [
      { key: 'a', text: '' },
      { key: 'b', text: '' },
    ],
    correct_key: 'a',
    explanation: '',
  }
}

/** Serializa las filas a preguntas del contrato con `order` 1..N. */
function toQuestions(rows: QRow[]): AdminQuizQuestionDto[] {
  return rows.map(({ _cid: _drop, ...q }, i) => ({ ...q, order: i + 1 }))
}

export default function AdminQuizEditor() {
  const { lessonId = '' } = useParams()
  const { data, loading, error, reload } = useAdminResource<AdminQuizDto>(
    () => getAdminQuiz(lessonId),
    [lessonId],
  )

  const [rows, setRows] = useState<QRow[] | null>(null)
  const [threshold, setThreshold] = useState(0.8)
  const [initial, setInitial] = useState<string>('') // snapshot serializado
  const [saving, setSaving] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)

  useEffect(() => {
    if (data == null) return
    const loaded: QRow[] = [...data.questions]
      .sort((a, b) => a.order - b.order)
      .map((q) => ({ ...q, _cid: nextCid() }))
    setRows(loaded)
    setThreshold(data.pass_threshold)
    setInitial(JSON.stringify({ t: data.pass_threshold, q: toQuestions(loaded) }))
    setBanner(null)
  }, [data])

  const current = useMemo(
    () => (rows ? JSON.stringify({ t: threshold, q: toQuestions(rows) }) : ''),
    [rows, threshold],
  )
  const dirty = rows != null && current !== initial

  const patchQuestion = useCallback((index: number, patch: Partial<AdminQuizQuestionDto>) => {
    setRows((prev) => (prev ? prev.map((r, i) => (i === index ? { ...r, ...patch } : r)) : prev))
  }, [])
  const move = useCallback((index: number, delta: number) => {
    setRows((prev) => {
      if (prev == null) return prev
      const target = index + delta
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }, [])
  const remove = useCallback((index: number) => {
    setRows((prev) => (prev ? prev.filter((_, i) => i !== index) : prev))
  }, [])
  const add = useCallback(() => {
    setRows((prev) => (prev ? [...prev, newQuestion()] : [newQuestion()]))
  }, [])

  const discard = useCallback(() => {
    if (data == null) return
    const loaded: QRow[] = [...data.questions]
      .sort((a, b) => a.order - b.order)
      .map((q) => ({ ...q, _cid: nextCid() }))
    setRows(loaded)
    setThreshold(data.pass_threshold)
    setBanner(null)
  }, [data])

  const save = useCallback(async () => {
    if (rows == null || saving || !dirty) return
    setSaving(true)
    setBanner(null)
    try {
      const body = { pass_threshold: threshold, questions: toQuestions(rows) }
      await putAdminQuiz(lessonId, body)
      setInitial(JSON.stringify({ t: threshold, q: body.questions }))
      reload()
    } catch (err) {
      // C1: no descartar error.details — el 422 CONTENT_VALIDATION_ERROR nombra
      // la(s) pregunta(s) inválida(s); se muestran en el banner (los `field` de
      // quiz son por-id, no por-índice → no hay control único donde anclarlos).
      const parsed = parseContentErrors(err, [])
      setBanner(parsed.banner ?? 'No se pudo guardar el quiz.')
    } finally {
      setSaving(false)
    }
  }, [rows, saving, dirty, threshold, lessonId, reload])

  if (loading && data == null) {
    return (
      <section className="screen">
        <Skeleton width={240} height={28} />
        <div className="col" style={{ gap: 14, marginTop: 20 }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={180} radius="var(--r-lg)" />
          ))}
        </div>
      </section>
    )
  }

  if (error != null && data == null) {
    return (
      <section className="screen">
        <ErrorState
          message="No se pudo cargar el quiz."
          detail={error instanceof ApiError ? `${error.code}: ${error.message}` : String(error)}
          onRetry={reload}
        />
      </section>
    )
  }

  if (rows == null) return null

  const pct = Math.round(threshold * 100)

  return (
    <section className="screen">
      <header className="screen-head">
        <div>
          <div className="eyebrow">Autoría · Quiz</div>
          <h2 className="display-lg">Preguntas del quiz</h2>
          <p className="mono-small muted" style={{ margin: '6px 0 0' }}>
            Lección {lessonId} · {rows.length} {rows.length === 1 ? 'pregunta' : 'preguntas'}
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={add}>
          <IconPlus size={15} />
          Añadir pregunta
        </Button>
      </header>

      <div style={{ maxWidth: 280, marginBottom: 20 }}>
        <Field label="Umbral para aprobar" htmlFor="quiz-threshold" value={`${pct}%`}>
          <input
            id="quiz-threshold"
            className="input"
            type="number"
            min={1}
            max={100}
            value={String(pct)}
            onChange={(e) => {
              const n = Number.parseInt(e.currentTarget.value, 10)
              if (Number.isFinite(n)) setThreshold(Math.min(Math.max(1, n), 100) / 100)
            }}
          />
        </Field>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<IconHelp size={28} />}
          title="Este quiz no tiene preguntas"
          body="Añade la primera pregunta para empezar."
          action={
            <Button variant="primary" size="sm" onClick={add}>
              <IconPlus size={15} />
              Añadir pregunta
            </Button>
          }
        />
      ) : (
        <div className="col" style={{ gap: 14 }}>
          {rows.map((row, index) => (
            <QuestionEditorCard
              key={row._cid}
              question={row}
              index={index}
              total={rows.length}
              onChange={(patch) => patchQuestion(index, patch)}
              onMoveUp={() => move(index, -1)}
              onMoveDown={() => move(index, 1)}
              onRemove={() => remove(index)}
            />
          ))}
        </div>
      )}

      <AdminSaveBar
        dirty={dirty}
        saving={saving}
        error={banner ?? undefined}
        onSave={save}
        onDiscard={discard}
        saveLabel="Guardar quiz"
      />
    </section>
  )
}
