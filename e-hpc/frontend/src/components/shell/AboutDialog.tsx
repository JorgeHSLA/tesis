// AboutDialog — destino real del botón de ayuda del TopBar (antes no llevaba
// a ninguna parte). Muestra qué es la app, su versión y dónde está la
// documentación.
//
// OFFLINE por diseño: no hay enlaces http(s) ni ningún destino de red. En
// escritorio existe `window.telar.openExternal`, pero la app se instala y se usa
// sin conexión y la documentación viaja EN el repositorio, así que la ruta se
// da como texto seleccionable. Así el diálogo no añade ningún origen nuevo a la
// CSP ni una petición de red que romperia el criterio de «cero requests».
//
// A11y: role="dialog" + aria-modal, foco al abrir, Escape y clic en el fondo
// cierran, y el foco vuelve al botón que lo abrió.
import { useEffect, useRef } from 'react'
import { API_BASE, APP_VERSION } from '../../config'
import { usePlatform } from '../../hooks/usePlatform'
import { IconHelp } from '../icons/icons'

export interface AboutDialogProps {
  onClose: () => void
}

export function AboutDialog({ onClose }: AboutDialogProps) {
  const platform = usePlatform()
  const closeRef = useRef<HTMLButtonElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const opener = openerRef.current
    return () => opener?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const backend = platform === 'desktop' ? API_BASE : `${location.origin} (proxy nginx)`

  return (
    <div
      className="dialog-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="card dialog" role="dialog" aria-modal="true" aria-labelledby="about-title">
        <div className="card-head">
          <IconHelp size={16} />
          <div>
            <div className="card-title" id="about-title">Acerca de Telar</div>
            <div className="card-sub">Simulador educativo de OpenMP · PyOMP</div>
          </div>
        </div>

        <div className="dialog-body">
          <p className="dialog-lead">
            Plataforma para aprender paralelismo con OpenMP vía PyOMP: lecciones y quizzes con un simulador que
            ejecuta tu código de verdad en contenedores aislados.
          </p>

          <dl className="about-grid">
            <dt>Versión</dt>
            <dd className="mono-small">{APP_VERSION}</dd>

            <dt>Entorno</dt>
            <dd className="mono-small">{platform === 'desktop' ? 'Escritorio (Electron)' : 'Web (navegador)'}</dd>

            <dt>Backend</dt>
            <dd className="mono-small">{backend}</dd>

            <dt>Documentación</dt>
            <dd className="mono-small">
              <code>README.md</code> y <code>docs/</code> en el repositorio del proyecto
            </dd>
          </dl>

          <p className="dialog-note">
            La aplicación funciona <b>sin conexión</b>: no realiza ninguna petición a Internet.
          </p>
        </div>

        <div className="dialog-actions">
          {/* <button> nativo (no el componente Button): necesita ref para
              recibir el foco al abrir, y Button no reenvía refs. */}
          <button ref={closeRef} type="button" className="btn btn-primary" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}
