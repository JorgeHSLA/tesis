// ExampleMetaFields — formulario de metadatos del ejemplo (autoría §9.F.5).
// Reutilizable: lo usa el editor de ejemplo (edición) y el editor de lección en
// `/nueva` (ejemplo pareado, invariante C7). `default_timeout_s` se acota al
// `max_timeout_s` de /system; la UI mantiene la coherencia threads/GPU (si el
// ejemplo es de hilos configurables no hay `fixed_threads`, y viceversa). El
// backend re-valida (422 CONTENT_VALIDATION_ERROR); los errores por campo se
// posicionan vía `errors[<prefix><campo>]`.
import { useId } from 'react'
import type { AdminExampleBaseDto } from '../../../api/admin-types'
import type { ParserId } from '../../../api/types'
import { Field } from '../../../components/ui/Field'
import { TakeawaysEditor } from './TakeawaysEditor'

const PARSER_OPTIONS: { id: ParserId; label: string }[] = [
  { id: 'none', label: 'Ninguno (sin métricas parseadas)' },
  { id: 'sweep_pi', label: 'Barrido · π (sweep_pi)' },
  { id: 'sweep_transporte', label: 'Barrido · transporte (sweep_transporte)' },
  { id: 'pair_openmp_numpy', label: 'Par · OpenMP vs NumPy' },
  { id: 'pair_openmp_blas', label: 'Par · OpenMP vs BLAS' },
  { id: 'pair_parallel_serial', label: 'Par · paralelo vs serie' },
]

export interface ExampleMetaFieldsProps {
  value: AdminExampleBaseDto
  onChange: (patch: Partial<AdminExampleBaseDto>) => void
  /** Tope de `default_timeout_s` (limits.max_timeout_s de /system). */
  maxTimeoutS: number
  /** Errores por campo del backend (opcionalmente con `prefix`). */
  errors?: Readonly<Record<string, string>>
  /** Prefijo para las claves de error (p. ej. `example.` en /nueva). */
  errorPrefix?: string
}

function toInt(raw: string, fallback: number): number {
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) ? n : fallback
}

export function ExampleMetaFields({
  value,
  onChange,
  maxTimeoutS,
  errors = {},
  errorPrefix = '',
}: ExampleMetaFieldsProps) {
  const uid = useId()
  const err = (field: string): string | undefined => errors[`${errorPrefix}${field}`]

  return (
    <div className="col" style={{ gap: 14 }}>
      <Field label="Título" htmlFor={`${uid}-title`} error={err('title')}>
        <input
          id={`${uid}-title`}
          className="input"
          value={value.title}
          onChange={(e) => onChange({ title: e.currentTarget.value })}
        />
      </Field>

      <div className="grid" style={{ gridTemplateColumns: '1.4fr 90px', gap: 12 }}>
        <Field label="Nombre de archivo" htmlFor={`${uid}-filename`} hint="Debe terminar en .py" error={err('filename')}>
          <input
            id={`${uid}-filename`}
            className="input"
            value={value.filename}
            spellCheck={false}
            onChange={(e) => onChange({ filename: e.currentTarget.value })}
          />
        </Field>
        <Field label="Dificultad" htmlFor={`${uid}-difficulty`} hint="1–5" error={err('difficulty')}>
          <input
            id={`${uid}-difficulty`}
            className="input"
            type="number"
            min={1}
            max={5}
            value={String(value.difficulty)}
            onChange={(e) => onChange({ difficulty: toInt(e.currentTarget.value, value.difficulty) })}
          />
        </Field>
      </div>

      <Field label="Qué enseña" htmlFor={`${uid}-teaches`} error={err('teaches')}>
        <input
          id={`${uid}-teaches`}
          className="input"
          value={value.teaches}
          onChange={(e) => onChange({ teaches: e.currentTarget.value })}
        />
      </Field>

      <TakeawaysEditor
        label="Directivas OpenMP"
        items={value.directives}
        onChange={(directives) => onChange({ directives })}
        placeholder="p. ej. parallel for"
        addLabel="Añadir directiva"
      />

      <Field label="Parser de métricas" htmlFor={`${uid}-parser`} error={err('parser_id')}>
        <select
          id={`${uid}-parser`}
          className="select"
          value={value.parser_id}
          onChange={(e) => onChange({ parser_id: e.currentTarget.value as ParserId })}
        >
          {PARSER_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
      </Field>

      {/* ── Ejecución: hilos + GPU (coherencia en UI) ─────────────────────── */}
      <div className="col" style={{ gap: 8 }}>
        <div className="field-label">Ejecución</div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={value.threads_configurable}
            onChange={(e) => {
              const on = e.currentTarget.checked
              // Coherencia: hilos configurables ⇒ sin fixed_threads/nota.
              onChange(
                on
                  ? { threads_configurable: true, fixed_threads: null, fixed_threads_note: null }
                  : { threads_configurable: false, fixed_threads: value.fixed_threads ?? 1 },
              )
            }}
          />
          <span>El estudiante elige el número de hilos</span>
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={value.sweeps_threads}
            onChange={(e) => onChange({ sweeps_threads: e.currentTarget.checked })}
          />
          <span>El ejemplo barre por sí mismo el número de hilos</span>
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={value.self_measures}
            onChange={(e) => onChange({ self_measures: e.currentTarget.checked })}
          />
          <span>El ejemplo mide sus propios tiempos</span>
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={value.requires_gpu}
            onChange={(e) => onChange({ requires_gpu: e.currentTarget.checked })}
          />
          <span>Requiere GPU (se deshabilita en equipos sin GPU)</span>
        </label>
      </div>

      {!value.threads_configurable && (
        <div className="grid" style={{ gridTemplateColumns: '90px 1fr', gap: 12 }}>
          <Field label="Hilos fijos" htmlFor={`${uid}-fixed`} error={err('fixed_threads')}>
            <input
              id={`${uid}-fixed`}
              className="input"
              type="number"
              min={1}
              value={value.fixed_threads == null ? '' : String(value.fixed_threads)}
              onChange={(e) =>
                onChange({ fixed_threads: e.currentTarget.value === '' ? null : toInt(e.currentTarget.value, 1) })
              }
            />
          </Field>
          <Field label="Nota sobre los hilos fijos" htmlFor={`${uid}-fixednote`} error={err('fixed_threads_note')}>
            <input
              id={`${uid}-fixednote`}
              className="input"
              value={value.fixed_threads_note ?? ''}
              onChange={(e) =>
                onChange({ fixed_threads_note: e.currentTarget.value === '' ? null : e.currentTarget.value })
              }
            />
          </Field>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field
          label="Timeout por defecto"
          htmlFor={`${uid}-timeout`}
          hint={`Segundos (máx. ${maxTimeoutS})`}
          error={err('default_timeout_s')}
        >
          <input
            id={`${uid}-timeout`}
            className="input"
            type="number"
            min={1}
            max={maxTimeoutS}
            value={String(value.default_timeout_s)}
            onChange={(e) => {
              const n = toInt(e.currentTarget.value, value.default_timeout_s)
              onChange({ default_timeout_s: Math.min(Math.max(1, n), maxTimeoutS) })
            }}
          />
        </Field>
        <Field label="Duración estimada" htmlFor={`${uid}-est`} hint="Segundos" error={err('est_run_seconds')}>
          <input
            id={`${uid}-est`}
            className="input"
            type="number"
            min={0}
            value={String(value.est_run_seconds)}
            onChange={(e) => onChange({ est_run_seconds: toInt(e.currentTarget.value, value.est_run_seconds) })}
          />
        </Field>
      </div>

      <Field label="Salida esperada (nota)" htmlFor={`${uid}-expected`} error={err('expected_output_note')}>
        <textarea
          id={`${uid}-expected`}
          className="textarea"
          rows={2}
          value={value.expected_output_note}
          onChange={(e) => onChange({ expected_output_note: e.currentTarget.value })}
        />
      </Field>

      <TakeawaysEditor
        label="Lo que vas a aprender"
        items={value.takeaways}
        onChange={(takeaways) => onChange({ takeaways })}
        placeholder="Una idea clave por línea"
        addLabel="Añadir aprendizaje"
        hint="3–4 bullets se muestran en la card del simulador."
      />

      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(e) => onChange({ enabled: e.currentTarget.checked })}
        />
        <span>Ejemplo habilitado (visible para el estudiante)</span>
      </label>
    </div>
  )
}
