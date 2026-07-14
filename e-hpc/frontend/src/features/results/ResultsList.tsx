// ResultsList — historial /resultados (frontend-spec §6.4): tabla de
// GET /api/v1/jobs?limit=50 con chips terminales de la tabla §6.3 (StatusChip)
// y botón Ver → detalle. Vacío → EmptyState con link al simulador.
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listJobs, type JobsPage } from '../../api/jobs'
import { Card, CardHead } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorState } from '../../components/ui/ErrorState'
import { Skeleton } from '../../components/ui/Skeleton'
import { StatusChip } from '../../components/ui/StatusChip'
import { IconResults, IconTerminal } from '../../components/icons/icons'
import { fmtRelative, fmtTimeMs } from '../../lib/format'
import '../../styles/screens/results.css'

export default function ResultsList() {
  const [page, setPage] = useState<JobsPage | null>(null)
  const [error, setError] = useState<Error | null>(null)

  const load = useCallback(() => {
    setError(null)
    setPage(null)
    listJobs({ limit: 50 })
      .then(setPage)
      .catch((err: unknown) => setError(err instanceof Error ? err : new Error(String(err))))
  }, [])
  useEffect(load, [load])

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
          message="No se pudo cargar el historial. ¿Está corriendo el backend E-HPC?"
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
      ) : page.jobs.length === 0 ? (
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
          <CardHead icon={<IconTerminal size={16} />} title="Jobs recientes" sub={`${page.meta?.total ?? page.jobs.length} en total`} />
          <div className="results-table" role="table" aria-label="Historial de jobs">
            <div className="results-table-head" role="row">
              <span role="columnheader">Archivo</span>
              <span role="columnheader">Estado</span>
              <span role="columnheader">Hilos</span>
              <span role="columnheader">Duración</span>
              <span role="columnheader">Cuándo</span>
              <span role="columnheader" aria-label="acciones" />
            </div>
            {page.jobs.map((j) => {
              const isTerminal = ['completed', 'failed', 'timeout', 'cancelled'].includes(j.status)
              const href = isTerminal ? `/resultados/${j.job_id}` : `/simulador/${j.job_id}`
              return (
                <div key={j.job_id} className="results-table-row" role="row">
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
        </Card>
      )}
    </section>
  )
}
