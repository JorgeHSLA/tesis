// ResultsCompare — /resultados/comparar?ids=a,b,… (CU-30). Solo GET
// /jobs/{id} por job (sin endpoint propio). Comparables = mismo example_id o,
// sin ejemplo, el mismo código (lib/compare); si no, se explica y se deja
// quitar jobs. Un job que falla al cargar → ErrorState con Reintentar y
// «Quitar de la comparación»; el resto de la vista sigue en pie.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { getJob } from '../../api/jobs'
import type { JobDetailDto } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { Card, CardHead, CardPad } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorState } from '../../components/ui/ErrorState'
import { Skeleton } from '../../components/ui/Skeleton'
import { StatusChip } from '../../components/ui/StatusChip'
import { IconResults, IconTerminal, IconZap } from '../../components/icons/icons'
import { WallTimeChart, type WallTimePoint } from '../../components/viz/WallTimeChart'
import { checkComparable, jobSpeedup, parseCompareIds } from '../../lib/compare'
import { fmtBytes, fmtTimeMs } from '../../lib/format'
import '../../styles/screens/results.css'

type Entry = { state: 'loading' } | { state: 'ok'; job: JobDetailDto } | { state: 'error'; message: string }

const DASH = '—'

function fmtTimeout(s: number): string {
  return s === 0 ? 'sin timeout' : `${s} s`
}

export default function ResultsCompare() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const ids = useMemo(() => parseCompareIds(params.get('ids')), [params])
  const [entries, setEntries] = useState<Record<string, Entry>>({})
  const requested = useRef(new Set<string>())

  const load = useCallback((id: string) => {
    requested.current.add(id)
    setEntries((prev) => ({ ...prev, [id]: { state: 'loading' } }))
    getJob(id)
      .then((job) => setEntries((prev) => ({ ...prev, [id]: { state: 'ok', job } })))
      .catch((err: unknown) =>
        setEntries((prev) => ({ ...prev, [id]: { state: 'error', message: err instanceof Error ? err.message : String(err) } })),
      )
  }, [])

  useEffect(() => {
    ids.filter((id) => !requested.current.has(id)).forEach(load)
  }, [ids, load])

  const remove = (id: string) => {
    const next = ids.filter((x) => x !== id)
    // Comas literales (no %2C): la URL queda legible y compartible.
    navigate(next.length > 0 ? `?ids=${next.map(encodeURIComponent).join(',')}` : '', { replace: true })
  }

  const head = (
    <header className="screen-head">
      <div>
        <div className="eyebrow">Resultados</div>
        <h2 className="display-lg">Comparar ejecuciones</h2>
        <p className="muted" style={{ maxWidth: 640 }}>
          Configuración, resultados y métricas de varias ejecuciones del mismo ejemplo (o del mismo código) lado a lado.
        </p>
      </div>
      <div className="screen-actions">
        <Link className="btn btn-outline" to="/resultados">
          Volver al historial
        </Link>
      </div>
    </header>
  )

  if (ids.length < 2) {
    return (
      <section className="screen results-screen">
        {head}
        <EmptyState
          icon={<IconResults size={22} />}
          title="Selecciona al menos dos ejecuciones"
          body="Marca dos o más ejecuciones en el historial y pulsa «Comparar»."
          action={
            <Link className="btn btn-primary" to="/resultados">
              Ir al historial
            </Link>
          }
        />
      </section>
    )
  }

  const loaded = ids.flatMap((id) => {
    const e = entries[id]
    return e?.state === 'ok' ? [e.job] : []
  })
  const failed = ids.filter((id) => entries[id]?.state === 'error')
  const loading = ids.some((id) => entries[id] == null || entries[id].state === 'loading')
  const comparable = checkComparable(loaded)
  const points: WallTimePoint[] = loaded.flatMap((j) =>
    j.wall_time_ms != null ? [{ id: j.job_id, threads: j.threads, wallTimeMs: j.wall_time_ms }] : [],
  )

  return (
    <section className="screen results-screen">
      {head}

      {failed.map((id) => {
        const e = entries[id]
        return (
          <ErrorState
            key={id}
            title={`No se pudo cargar la ejecución #${id.slice(0, 8)}`}
            message="Puede que ya no exista o que el backend Telar no responda."
            detail={e?.state === 'error' ? e.message : undefined}
            onRetry={() => load(id)}
          >
            <Button variant="outline" size="sm" onClick={() => remove(id)}>
              Quitar de la comparación
            </Button>
          </ErrorState>
        )
      })}

      {!comparable.ok && (
        <div className="compare-warning" role="status">
          <b>Estas ejecuciones no son comparables.</b> {comparable.reason} Quita ejecuciones hasta que todas sean del
          mismo ejemplo o del mismo código propio.
        </div>
      )}

      <Card>
        <CardHead icon={<IconTerminal size={16} />} title="Configuración y resultados" sub={`${ids.length} ejecuciones`} />
        <div className="compare-table-wrap">
          <table className="compare-table" aria-label="Comparación de ejecuciones">
            <thead>
              <tr>
                <th scope="col">Ejecución</th>
                <th scope="col">Estado</th>
                <th scope="col">Hilos</th>
                <th scope="col">Timeout</th>
                <th scope="col">Tiempo total</th>
                <th scope="col">CPU prom.</th>
                <th scope="col">Memoria pico</th>
                <th scope="col">Speedup</th>
                <th scope="col" aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {loaded.map((j) => {
                const m = j.metrics_summary
                const s = jobSpeedup(j)
                return (
                  <tr key={j.job_id}>
                    <td>
                      <Link to={`/resultados/${j.job_id}`} className="compare-job">
                        <span className="results-filename">{j.filename}</span>
                        <span className="mono-small">#{j.job_id.slice(0, 8)}</span>
                      </Link>
                    </td>
                    <td>
                      <StatusChip phase={j.status} />
                    </td>
                    <td className="mono-small">{j.threads}</td>
                    <td className="mono-small">{fmtTimeout(j.timeout_s)}</td>
                    <td className="mono-small">{j.wall_time_ms != null ? fmtTimeMs(j.wall_time_ms) : DASH}</td>
                    <td className="mono-small">{m != null ? `${Math.round(m.cpu_percent_avg)}%` : DASH}</td>
                    <td className="mono-small">{m != null ? fmtBytes(m.mem_used_bytes_max) : DASH}</td>
                    <td className="mono-small">{s != null ? `${s.toFixed(1)}×` : DASH}</td>
                    <td style={{ textAlign: 'right' }}>
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Quitar ${j.job_id.slice(0, 8)}`}
                        onClick={() => remove(j.job_id)}
                      >
                        Quitar
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {loading && (
            <div style={{ padding: 'var(--sp-3) var(--card-pad)' }} aria-busy="true">
              <Skeleton height={34} />
            </div>
          )}
        </div>
      </Card>

      {comparable.ok && !loading && loaded.length >= 2 && (
        <Card style={{ marginTop: 20 }}>
          <CardHead icon={<IconZap size={16} />} title="Tiempo total frente a hilos" sub="wall time de cada ejecución" />
          <CardPad>
            {points.length > 0 ? (
              <WallTimeChart points={points} />
            ) : (
              <p className="muted">Ninguna de estas ejecuciones tiene tiempo total medido.</p>
            )}
          </CardPad>
        </Card>
      )}
    </section>
  )
}
