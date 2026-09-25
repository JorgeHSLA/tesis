// ResultsList — historial /resultados (frontend-spec §6.4): tabla de
// GET /api/v1/jobs?limit=50 con chips terminales de la tabla §6.3 (StatusChip)
// y botón Ver → detalle. Vacío → EmptyState con link al simulador.
// CU-30.1: selección múltiple de jobs terminales → «Comparar (n)» (≥2).
// CU-11: páginas de 50 con offset (meta.total); la selección se conserva
// entre páginas.
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { listJobs, type JobsPage } from '../../api/jobs'
import { Button } from '../../components/ui/Button'
import { Card, CardHead } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorState } from '../../components/ui/ErrorState'
import { Skeleton } from '../../components/ui/Skeleton'
import { StatusChip } from '../../components/ui/StatusChip'
import { IconResults, IconTerminal } from '../../components/icons/icons'
import { fmtRelative, fmtTimeMs } from '../../lib/format'
import '../../styles/screens/results.css'

const TERMINAL = ['completed', 'failed', 'timeout', 'cancelled']
const PAGE_SIZE = 50

export default function ResultsList() {
  const navigate = useNavigate()
  const [page, setPage] = useState<JobsPage | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [offset, setOffset] = useState(0)
  // Orden de selección = orden de la comparación.
  const [selected, setSelected] = useState<string[]>([])

  const toggle = (jobId: string) =>
    setSelected((prev) => (prev.includes(jobId) ? prev.filter((id) => id !== jobId) : [...prev, jobId]))

  const load = useCallback(() => {
    setError(null)
    setPage(null)
    listJobs({ limit: PAGE_SIZE, offset })
      .then(setPage)
      .catch((err: unknown) => setError(err instanceof Error ? err : new Error(String(err))))
  }, [offset])
  useEffect(load, [load])

  const total = page?.meta?.total ?? page?.jobs.length ?? 0

  return (
    <section className="screen results-screen">
      <header className="screen-head">
        <div>
          <div className="eyebrow">Resultados</div>
          <h2 className="display-lg">Historial de ejecuciones</h2>
          <p className="muted" style={{ maxWidth: 640 }}>
            Tus últimas ejecuciones en el simulador. Abre cualquiera para ver métricas, gráficas de speedup y el output
            completo.
          </p>
        </div>
      </header>

      {error != null ? (
        <ErrorState
          message="No se pudo cargar el historial. ¿Está corriendo el backend Telar?"
          detail={error.message}
          onRetry={load}
        />
      ) : page == null ? (
        <Card aria-busy="true">
          <div style={{ padding: 20, display: 'grid', gap: 12 }}>
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} height={34} />
            ))}
          </div>
        </Card>
      ) : page.jobs.length === 0 && offset === 0 ? (
        <EmptyState
          icon={<IconResults size={22} />}
          title="Aún no has lanzado ninguna ejecución"
          body="Lanza tu primer ejemplo desde el simulador y aparecerá aquí con sus métricas y su curva de speedup."
          action={
            <Link className="btn btn-primary" to="/simulador">
              Ir al simulador
            </Link>
          }
        />
      ) : (
        <Card>
          <CardHead
            icon={<IconTerminal size={16} />}
            title="Jobs recientes"
            sub={`${total} en total`}
            right={
              <Button
                size="sm"
                variant="primary"
                disabled={selected.length < 2}
                title={selected.length < 2 ? 'Marca al menos dos ejecuciones terminadas' : undefined}
                onClick={() => navigate(`/resultados/comparar?ids=${selected.map(encodeURIComponent).join(',')}`)}
              >
                Comparar ({selected.length})
              </Button>
            }
          />
          <div className="results-table" role="table" aria-label="Historial de jobs">
            <div className="results-table-head" role="row">
              <span role="columnheader" aria-label="seleccionar" />
              <span role="columnheader">Archivo</span>
              <span role="columnheader">Estado</span>
              <span role="columnheader">Hilos</span>
              <span role="columnheader">Duración</span>
              <span role="columnheader">Cuándo</span>
              <span role="columnheader" aria-label="acciones" />
            </div>
            {page.jobs.map((j) => {
              const isTerminal = TERMINAL.includes(j.status)
              const href = isTerminal ? `/resultados/${j.job_id}` : `/simulador/${j.job_id}`
              return (
                <div key={j.job_id} className="results-table-row" role="row">
                  <span role="cell">
                    {isTerminal && (
                      <input
                        type="checkbox"
                        className="results-select"
                        aria-label={`Seleccionar ${j.filename} #${j.job_id.slice(0, 8)} para comparar`}
                        checked={selected.includes(j.job_id)}
                        onChange={() => toggle(j.job_id)}
                      />
                    )}
                  </span>
                  <span role="cell" className="mono-small results-filename" title={j.filename}>
                    {j.filename}
                  </span>
                  <span role="cell">
                    <StatusChip phase={j.status} label={isTerminal ? undefined : 'EN VIVO'} />
                  </span>
                  <span role="cell" className="mono-small">
                    {j.threads}
                  </span>
                  <span role="cell" className="mono-small">
                    {j.wall_time_ms != null ? fmtTimeMs(j.wall_time_ms) : '—'}
                  </span>
                  <span role="cell" className="mono-small">
                    {fmtRelative(j.created_at)}
                  </span>
                  <span role="cell" style={{ textAlign: 'right' }}>
                    <Link className="btn btn-sm btn-outline" to={href}>
                      Ver
                    </Link>
                  </span>
                </div>
              )
            })}
          </div>
          {total > PAGE_SIZE && (
            <nav className="results-pager" aria-label="Páginas del historial">
              <span className="mono-small">
                {page.jobs.length === 0
                  ? `0 de ${total}`
                  : `${offset + 1}–${offset + page.jobs.length} de ${total}`}
              </span>
              <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                Anterior
              </Button>
              <Button size="sm" variant="outline" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
                Siguiente
              </Button>
            </nav>
          )}
        </Card>
      )}
    </section>
  )
}
