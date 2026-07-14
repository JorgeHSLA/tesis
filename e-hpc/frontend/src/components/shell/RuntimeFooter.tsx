// RuntimeFooter — footer del sidebar (frontend-spec §6.7, §6.0):
//  - desktop: estado de window.ehpc.dockerStatus() con poll 10 s; caído →
//    botón `Levantar` (dockerUp + re-check).
//  - web: GET /health cada 30 s → `Backend E-HPC` / `conectado · N núcleos`.
// El texto se oculta colapsado (solo dot), como el prototipo.
import { useDockerStatus } from '../../hooks/useDockerStatus'
import { usePlatform } from '../../hooks/usePlatform'
import { useSystemInfo } from '../../hooks/useSystemInfo'
import { Button } from '../ui/Button'

export function RuntimeFooter() {
  const platform = usePlatform()
  const docker = useDockerStatus()
  const { data: system } = useSystemInfo()

  const title = platform === 'desktop' ? 'Docker runtime' : 'Backend E-HPC'

  let dotClass = 'status-dot'
  let detail: string
  if (docker.state === 'checking') {
    dotClass = 'status-dot status-dot--amber'
    detail = 'verificando…'
  } else if (docker.state === 'ok') {
    detail =
      platform === 'desktop'
        ? `${docker.containers ?? 0} contenedores activos`
        : system
          ? `conectado · ${system.cores} núcleos`
          : 'conectado'
  } else {
    dotClass = 'status-dot status-dot--red'
    detail = platform === 'desktop' ? 'servicios detenidos' : 'sin conexión'
  }

  return (
    <div className="sidebar-footer" role="status" aria-live="polite" aria-label={`${title}: ${detail}`}>
      <span className={dotClass} aria-hidden="true" />
      <div className="sidebar-footer-text">
        <div>{title}</div>
        <div>{detail}</div>
        {platform === 'desktop' && docker.state === 'down' && (
          <div style={{ marginTop: 6 }}>
            <Button variant="outline" size="sm" onClick={() => void docker.up()} disabled={docker.lifting}>
              {docker.lifting ? 'Levantando…' : 'Levantar'}
            </Button>
            {docker.liftError != null && (
              <div className="field-hint error" role="alert">
                {docker.liftError}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
