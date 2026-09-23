// RemoteModuleDetailScreen — `/modulos/:moduleId`, el detalle de UNA
// publicación del catálogo (CU-34.1, §11.5.2) antes de decidir incorporarla.
//
// El backend descarga y valida el bundle sin escribir nada, y lee el índice
// FRESCO (CU-34.2): lo que se ve aquí es la versión vigente, no la de la caché
// de 15 minutos. Por eso esta pantalla tiene un estado que las demás no:
// «ya no está disponible» (`404 REMOTE_MODULE_NOT_FOUND`), que no es un error
// que se arregle reintentando sino una publicación retirada o sustituida.
import '../../styles/screens/modules.css'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getRemoteModule } from '../../api/catalog'
import type { RemoteLessonPreviewDto, RemoteModuleDetailDto } from '../../api/catalog-types'
import { ApiError } from '../../api/client'
import { IconAlert } from '../../components/icons/icons'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Chip, type ChipTone } from '../../components/ui/Chip'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorState } from '../../components/ui/ErrorState'
import { Skeleton } from '../../components/ui/Skeleton'
import { fmtBytes, fmtRelative } from '../../lib/format'
import { catalogErrorText } from './ModuleCard'

type Carga =
  | { tipo: 'cargando' }
  | { tipo: 'listo'; detalle: RemoteModuleDetailDto }
  | { tipo: 'retirado' }
  | { tipo: 'error'; code: string; message: string }

const REGLA: Record<RemoteLessonPreviewDto['completion_rule'], string> = {
  quiz: 'Se completa aprobando el quiz',
  viewed: 'Se completa al leerla',
  run: 'Se completa ejecutando el ejemplo',
}

const ESTADO_LECCION: Record<RemoteLessonPreviewDto['status'], { label: string; tone: ChipTone }> = {
  new: { label: 'Nueva', tone: 'blue' },
  present: { label: 'Sin cambios', tone: 'neutral' },
  changed: { label: 'Cambia', tone: 'amber' },
}

export default function RemoteModuleDetailScreen() {
  const { moduleId = '' } = useParams()
  const navigate = useNavigate()
  const [carga, setCarga] = useState<Carga>({ tipo: 'cargando' })

  const cargar = useCallback(() => {
    let vivo = true
    setCarga({ tipo: 'cargando' })
    getRemoteModule(moduleId)
      .then((detalle) => vivo && setCarga({ tipo: 'listo', detalle }))
      .catch((err: unknown) => {
        if (!vivo) return
        if (err instanceof ApiError && err.code === 'REMOTE_MODULE_NOT_FOUND') {
          setCarga({ tipo: 'retirado' })
        } else if (err instanceof ApiError) {
          setCarga({ tipo: 'error', code: err.code, message: err.message })
        } else {
          setCarga({ tipo: 'error', code: 'UNKNOWN', message: 'No se pudo cargar el módulo.' })
        }
      })
    return () => {
      vivo = false
    }
  }, [moduleId])

  useEffect(() => cargar(), [cargar])

  const volver = () => navigate('/modulos')

  if (carga.tipo === 'cargando') {
    return (
      <section className="screen store" aria-busy="true" data-testid="remote-detail-loading">
        <Skeleton width={220} height={14} />
        <Skeleton width="60%" height={32} style={{ marginTop: 12 }} />
        <Skeleton height={120} style={{ marginTop: 24 }} />
      </section>
    )
  }

  if (carga.tipo === 'retirado') {
    return (
      <section className="screen store">
        <EmptyState
          icon={<IconAlert size={28} />}
          title="Esta publicación ya no está disponible"
          body="Se retiró del catálogo o se sustituyó por otra versión. Vuelve a la lista para ver lo que hay publicado ahora."
          action={
            <Button variant="primary" size="sm" onClick={volver}>
              Volver a los módulos
            </Button>
          }
        />
      </section>
    )
  }

  if (carga.tipo === 'error') {
    return (
      <section className="screen store">
        <ErrorState
          title="No se pudo cargar el módulo"
          message={catalogErrorText({ code: carga.code, message: carga.message })}
          detail={carga.code}
          onRetry={cargar}
        >
          <Button variant="ghost" size="sm" onClick={volver}>
            Volver a los módulos
          </Button>
        </ErrorState>
      </section>
    )
  }

  const d = carga.detalle
  const lecciones = [...d.lessons].sort((a, b) => a.order - b.order)
  return (
    <section className="screen store">
      <div className="screen-head">
        <div>
          <div className="eyebrow">
            <Link to="/modulos">Módulos disponibles</Link> · Publicación
          </div>
          <h2 className="display-lg">{d.title}</h2>
          {d.description !== '' && <p className="muted">{d.description}</p>}
          <ul className="mods-card-meta">
            <li>{d.level}</li>
            <li className="mono-small">v{d.version}</li>
            <li>publicada {fmtRelative(d.published_at)}</li>
            {d.author_label !== '' && <li>{d.author_label}</li>}
            <li>~{d.estimated_minutes_total} min</li>
            <li>{fmtBytes(d.size_bytes)}</li>
          </ul>
        </div>
      </div>

      {d.content_warnings.length > 0 && (
        <ul className="publish-warnings" aria-label="Avisos">
          {d.content_warnings.map((w, i) => (
            <li key={`${w.code}-${w.lesson_id ?? i}`} className="grave">
              {w.message}
            </li>
          ))}
        </ul>
      )}

      <Card className="mods-card">
        <div className="mods-card-body">
          <h3 className="mods-card-title">
            {lecciones.length === 1 ? '1 lección' : `${lecciones.length} lecciones`}
          </h3>
          <ol className="remote-detail-lessons">
            {lecciones.map((l) => (
              <li key={l.lesson_id}>
                <div className="mods-card-head">
                  <span>
                    <span className="mono-small muted">{l.order}. </span>
                    {l.title}
                  </span>
                  {d.state !== 'available' && (
                    <Chip tone={ESTADO_LECCION[l.status].tone}>{ESTADO_LECCION[l.status].label}</Chip>
                  )}
                </div>
                <ul className="mods-card-meta">
                  <li>~{l.estimated_minutes} min</li>
                  {l.has_example && <li>con ejemplo</li>}
                  {l.has_quiz && (
                    <li>
                      {l.quiz_question_count === 1
                        ? 'quiz de 1 pregunta'
                        : `quiz de ${l.quiz_question_count} preguntas`}
                    </li>
                  )}
                  {l.requires_gpu && <li>requiere GPU</li>}
                  <li>{REGLA[l.completion_rule]}</li>
                </ul>
              </li>
            ))}
          </ol>
        </div>
      </Card>

      <div style={{ marginTop: 16 }}>
        <Button variant="ghost" size="sm" onClick={volver}>
          Volver a los módulos
        </Button>
      </div>
    </section>
  )
}
