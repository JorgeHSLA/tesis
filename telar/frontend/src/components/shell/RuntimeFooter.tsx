// RuntimeFooter — pie del sidebar (frontend-spec §6.7, §6.0):
//  - desktop: estado de window.telar.dockerStatus() con poll 10 s; el panel
//    ofrece `Levantar` (dockerUp) y `Detener` (dockerStop), con re-check.
//  - web: GET /health cada 30 s → `Backend Telar` / `conectado · N núcleos`.
//
// 2026-08-26 — el punto de estado pasa a ser un DISPARADOR y las acciones viven
// en un panel. Antes el botón `Levantar` se renderizaba dentro de
// `.sidebar-footer-text`, que el rediseño del rail (2026-07-26) dejó en
// `display: none` PERMANENTE: el control existía en el DOM pero era imposible
// de ver o pulsar en las dos plataformas. El único camino para arrancar los
// servicios era provocar el error del simulador y usar su CTA — nada evidente
// para un estudiante que abre la app por primera vez.
//
// Decisiones de interacción:
//  - Se abre con CLIC, no solo con hover: un panel con botones que aparece al
//    pasar el ratón obliga a perseguirlo con el cursor y deja fuera al teclado
//    y a las pantallas táctiles. El hover sí muestra el tooltip de ESTADO
//    (mismo patrón `data-tip` que los items del rail), que antes tampoco
//    existía: el punto no comunicaba nada.
//  - Va en un PORTAL porque `.sidebar` tiene `overflow: hidden` y recortaría
//    cualquier panel que salga del rail de 56 px (precedente: QuizResultOverlay).
//  - Cierra con Escape (devolviendo el foco al disparador) y con clic fuera.
//
// 2026-09-22 — el panel dice POR QUÉ no está listo (CU-27.4: Docker ausente,
// permisos…) y, en desktop, avisa si falta la imagen del runner con
// «Reintentar preparación» (CU-27.3). Tras cada preparación `/system` se
// vuelve a consultar: su `runner_image_present` es de antes de la descarga.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDockerStatus } from '../../hooks/useDockerStatus'
import { usePlatform } from '../../hooks/usePlatform'
import { useSystemInfo } from '../../hooks/useSystemInfo'
import { Button } from '../ui/Button'

/** Separación del panel respecto al borde derecho del rail (igual que los tooltips). */
const GAP_PX = 10
/** Margen mínimo con el borde inferior del viewport. */
const EDGE_PX = 8

/** Ancla el panel al borde derecho del RAIL, no al del punto: el disparador
 *  mide 28 px dentro de un rail de 56, así que anclarlo al punto dejaba el
 *  panel montado sobre la propia barra. */
function anchorFor(trigger: HTMLElement): { left: number; bottom: number } {
  const rail = trigger.closest('.sidebar')
  const railRect = rail?.getBoundingClientRect()
  const triggerRect = trigger.getBoundingClientRect()
  const left = (railRect?.right ?? triggerRect.right) + GAP_PX
  // Alineado por abajo con el disparador, sin salirse del viewport.
  const bottom = Math.max(EDGE_PX, window.innerHeight - triggerRect.bottom)
  return { left, bottom }
}

export function RuntimeFooter() {
  const platform = usePlatform()
  const docker = useDockerStatus()
  const { data: system, retry: retrySystem } = useSystemInfo()

  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const title = platform === 'desktop' ? 'Docker runtime' : 'Backend Telar'
  const runnerMissing =
    platform === 'desktop' && docker.state === 'ok' && system?.runner_image_present === false

  // Al terminar una preparación (auto o manual), la imagen puede haber llegado.
  const wasLifting = useRef(false)
  useEffect(() => {
    if (wasLifting.current && !docker.lifting) retrySystem()
    wasLifting.current = docker.lifting
  }, [docker.lifting, retrySystem])

  let dotClass = 'status-dot'
  let detail: string
  if (docker.lifting) {
    // Prioridad sobre el estado: durante el autoarranque los servicios siguen
    // «down», y un punto rojo inmóvil mientras se descargan ~1 GB parece que
    // la app se colgó. En ámbar se lee como «trabajando».
    dotClass = 'status-dot status-dot--amber'
    detail = 'preparando entorno…'
  } else if (docker.stopping) {
    dotClass = 'status-dot status-dot--amber'
    detail = 'deteniendo…'
  } else if (docker.state === 'checking') {
    dotClass = 'status-dot status-dot--amber'
    detail = 'verificando…'
  } else if (runnerMissing) {
    dotClass = 'status-dot status-dot--amber'
    detail = 'falta la imagen del runner'
  } else if (docker.state === 'ok') {
    detail =
      platform === 'desktop'
        ? `${docker.containers ?? 0} contenedores activos`
        : system
          ? `conectado · ${system.cores} núcleos`
          : 'conectado'
  } else {
    dotClass = 'status-dot status-dot--red'
    if (platform === 'desktop') detail = docker.statusError != null ? 'Docker no disponible' : 'servicios detenidos'
    else detail = docker.statusError ?? 'sin conexión'
  }

  const close = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [])

  // Posición en coordenadas de viewport: el panel vive en un portal, así que no
  // hereda el sistema de coordenadas del rail.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    setPos(anchorFor(triggerRef.current))
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpen(false) // clic fuera: NO se devuelve el foco (el usuario ya está en otro sitio)
    }
    // El reposicionado en resize evita que el panel quede flotando lejos del
    // punto si la ventana cambia con el panel abierto.
    const reposition = () => {
      if (triggerRef.current) setPos(anchorFor(triggerRef.current))
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointerDown)
    window.addEventListener('resize', reposition)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('resize', reposition)
    }
  }, [open, close])

  const busy = docker.lifting || docker.stopping
  const showActions = platform === 'desktop'

  const panel =
    open && pos != null
      ? createPortal(
          <div
            ref={panelRef}
            className="runtime-panel"
            role="dialog"
            aria-label={`${title}: ${detail}`}
            style={{ left: pos.left, bottom: pos.bottom }}
          >
            <div className="runtime-panel-title">{title}</div>
            <div className="runtime-panel-detail">{detail}</div>

            {showActions && (
              <div className="runtime-panel-actions">
                {docker.state === 'ok' ? (
                  <Button variant="outline" size="sm" onClick={() => void docker.stop()} disabled={busy}>
                    {docker.stopping ? 'Deteniendo…' : 'Detener'}
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => void docker.up()} disabled={busy}>
                    {docker.lifting ? 'Levantando…' : 'Levantar'}
                  </Button>
                )}
              </div>
            )}

            {/* El primer arranque baja ~1 GB de imágenes: sin este aviso el
                usuario cree que se colgó (electron-spec §8). */}
            {docker.lifting && (
              <div className="runtime-panel-hint">
                Preparando el entorno. La primera vez descarga cerca de 1 GB y tarda varios minutos.
              </div>
            )}

            {runnerMissing && !busy && (
              <div className="runtime-panel-hint">
                Sin la imagen del runner todavía no se puede ejecutar código.
                <div className="runtime-panel-actions">
                  <Button variant="outline" size="sm" onClick={() => void docker.up()}>
                    Reintentar preparación
                  </Button>
                </div>
              </div>
            )}

            {docker.statusError != null && docker.state !== 'ok' && (
              <div className="field-hint error" role="alert">
                {docker.statusError}
              </div>
            )}

            {docker.liftError != null && (
              <div className="field-hint error" role="alert">
                {docker.liftError}
              </div>
            )}
          </div>,
          document.body,
        )
      : null

  return (
    <div className="sidebar-footer">
      <button
        ref={triggerRef}
        type="button"
        className="runtime-trigger"
        aria-label={`${title}: ${detail}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-tip={detail}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={dotClass} aria-hidden="true" />
      </button>

      {/* Se conserva para lectores de pantalla y para el modo web/expandido:
          `.sidebar-footer-text` está oculta por CSS en el rail. */}
      <div className="sidebar-footer-text" role="status" aria-live="polite">
        <div>{title}</div>
        <div>{detail}</div>
      </div>

      {panel}
    </div>
  )
}
