// RecentJobs — card "Jobs recientes" del Home (frontend-spec §6.1):
// GET /api/v1/jobs?limit=3, chips por status según la parte terminal de la
// tabla §6.3 (completed→OK, en curso→EN VIVO, failed/timeout→ERROR,
// cancelled→Cancelado). Fila → /resultados/{id} (o /simulador/{id} si el job
// no es terminal).
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { listJobs } from '../../api/jobs'
import type { JobStatus, JobSummaryDto } from '../../api/types'
import {
  IconAlert,
  IconCheck,
  IconClock,
  IconPlay,
  IconStop,
} from '../../components/icons/icons'
import { Card, CardHead } from '../../components/ui/Card'
import { Chip, type ChipTone } from '../../components/ui/Chip'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorState } from '../../components/ui/ErrorState'
import { Skeleton } from '../../components/ui/Skeleton'
import { Button } from '../../components/ui/Button'
import { fmtRelative, fmtTimeMs } from '../../lib/format'

const TERMINAL: readonly JobStatus[] = ['completed', 'failed', 'timeout', 'cancelled']

interface StatusSpec {
  label: string
  tone: ChipTone
}

/** Mapeo compacto del Home (§6.1, derivado de la tabla única §6.3). */
function statusSpec(status: JobStatus): StatusSpec {
  switch (status) {
    case 'completed':
      return { label: 'OK', tone: 'green' }
    case 'failed':
    case 'timeout':
      return { label: 'ERROR', tone: 'red' }
    case 'cancelled':
      return { label: 'Cancelado', tone: 'amber' }
    default:
      // queued | creating | compiling | running
      return { label: 'EN VIVO', tone: 'orange' }
  }
}

function rowIcon(status: JobStatus) {
  switch (status) {
    case 'completed':
      return <IconCheck size={14} />
    case 'failed':
    case 'timeout':
      return <IconAlert size={14} />
    case 'cancelled':
      return <IconStop size={14} />
    default:
      return <IconPlay size={14} />
  }
}

export function RecentJobs() {
  const navigate = useNavigate()
  const [jobs, setJobs] = useState<JobSummaryDto[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)

  const load = useCallback(() => {
    setError(null)
    listJobs({ limit: 3 })
      .then(({ jobs: list }) => {
        if (alive.current) setJobs(list)
      })
      .catch((err: unknown) => {
        if (alive.current) setError(err instanceof Error ? err.message : String(err))
      })
  }, [])

  useEffect(() => {
    alive.current = true
    load()
    return () => {
      alive.current = false
    }
  }, [load])

  const open = (job: JobSummaryDto) => {
    const terminal = TERMINAL.includes(job.status)
    navigate(terminal ? `/resultados/${job.job_id}` : `/simulador/${job.job_id}`)
  }

  return (
    <Card>
      <CardHead
        icon={<IconClock size={16} />}
        title="Jobs recientes"
        right={
          <Button variant="ghost" size="sm" onClick={() => navigate('/resultados')}>
            Ver todos
          </Button>
        }
      />
      <div className="recent-list">
        {error !== null && (
          <ErrorState message="No se pudieron cargar los jobs recientes." detail={error} onRetry={load} />
        )}
        {error === null && jobs === null && (
          <div className="col" style={{ gap: 8, padding: 8 }} aria-hidden="true">
            <Skeleton height={38} />
            <Skeleton height={38} />
            <Skeleton height={38} />
          </div>
        )}
        {error === null && jobs !== null && jobs.length === 0 && (
          <EmptyState
            title="Aún no has ejecutado nada."
            action={<Link to="/simulador">Lanza tu primera ejecución →</Link>}
          />
        )}
        {error === null &&
          jobs !== null &&
          jobs.map((job) => {
            const spec = statusSpec(job.status)
            return (
              <button key={job.job_id} type="button" className="recent-row" onClick={() => open(job)}>
                <span className="recent-icon">{rowIcon(job.status)}</span>
                <span className="recent-name mono">{job.filename}</span>
                <Chip tone={spec.tone}>{spec.label}</Chip>
                <span className="mono-small">
                  {job.threads} hilos · {job.wall_time_ms != null ? fmtTimeMs(job.wall_time_ms) : '—'}
                </span>
                <span className="mono-small" style={{ marginLeft: 'auto' }}>
                  {fmtRelative(job.created_at)}
                </span>
              </button>
            )
          })}
      </div>
    </Card>
  )
}
