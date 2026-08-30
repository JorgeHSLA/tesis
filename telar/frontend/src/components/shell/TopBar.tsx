// TopBar — layout del handoff §3.3 (rediseño 2026-07): crumbs / título sans / spacer /
// botones Buscar y Ayuda / divisor / usuario `ES · estudiante` (frontend-spec §6.0).
// El switch v1/v2 (§2.8) se retiró: la app quedó fija en la variante v2.
// Títulos y crumbs por ruta: tabla de frontend-spec §2.
//
// 2026-07-26 — el modo autoría YA NO usa login: se decide en BUILD (VITE_ADMIN →
// config.ts ADMIN_BUILD). Por eso este TopBar vuelve a la etiqueta de usuario
// ESTÁTICA (sin menú ni sesión): `ES · estudiante` en el build estudiante y
// `AD · autor` en el build admin. Los dos botones NO son maqueta:
//   · Buscar → navega al catálogo y le pone el foco a SU buscador (el de
//     'Buscar lección, quiz o tema'). Se reutiliza ese buscador en vez de
//     duplicar la lógica de filtrado en una paleta de comandos aparte.
//   · Ayuda  → abre el diálogo «Acerca de» (versión, entorno, documentación).
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { IconHelp, IconSearch } from '../icons/icons'
import { AboutDialog } from './AboutDialog'
import { ADMIN_BUILD } from '../../config'

interface RouteMeta {
  title: string
  crumbs: string[]
}

/** Tabla título/crumbs por ruta (frontend-spec §2). Más específica primero.
 *  Para /cursos/:leccionId los crumbs dinámicos (módulo/lección) los aporta
 *  WP7 dentro de la pantalla; el topbar usa el literal del handoff §0.4.
 *  Las entradas «Autoría · …» solo se ejercitan en el build admin (las rutas
 *  /admin/* únicamente existen ahí), pero se dejan siempre en la tabla. */
export function routeMeta(pathname: string): RouteMeta {
  if (pathname === '/') return { title: 'Inicio', crumbs: ['Telar'] }
  if (/^\/simulador\/.+/.test(pathname)) return { title: 'Simulador · En vivo', crumbs: ['Simulador', 'En vivo'] }
  if (pathname.startsWith('/simulador')) return { title: 'Simulador · Configurar', crumbs: ['Simulador', 'Configurar'] }
  if (pathname.startsWith('/resultados')) return { title: 'Resultados', crumbs: ['Simulador', 'Resultados'] }
  if (/^\/cursos\/.+/.test(pathname)) return { title: 'Aprender', crumbs: ['Aprendizaje', 'Módulo', 'Lección'] }
  if (pathname.startsWith('/cursos')) return { title: 'Aprendizaje · Catálogo', crumbs: ['Aprendizaje', 'Catálogo'] }
  if (pathname.startsWith('/modulos')) return { title: 'Aprendizaje · Módulos disponibles', crumbs: ['Aprendizaje', 'Módulos'] }
  if (/^\/admin\/lecciones\b/.test(pathname)) return { title: 'Autoría · Lección', crumbs: ['Autoría', 'Lección'] }
  if (/^\/admin\/quiz\b/.test(pathname)) return { title: 'Autoría · Quiz', crumbs: ['Autoría', 'Quiz'] }
  if (/^\/admin\/ejemplos\b/.test(pathname)) return { title: 'Autoría · Ejemplo', crumbs: ['Autoría', 'Ejemplo'] }
  if (pathname.startsWith('/admin')) return { title: 'Autoría · Panel', crumbs: ['Autoría', 'Panel'] }
  return { title: 'Inicio', crumbs: ['Telar'] }
}

/** Estado de navegación que TopBar manda al catálogo para pedirle el foco del
 *  buscador. Va en el history state, no en la URL: es una intención puntual,
 *  no parte de la dirección de la pantalla. El catálogo lo BORRA en cuanto lo
 *  consume (CatalogScreen), para que ni recargar ni volver atrás vuelvan a
 *  mover el foco por su cuenta. */
export interface CatalogNavState {
  focusSearch?: boolean
}

export function TopBar() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [aboutOpen, setAboutOpen] = useState(false)
  const meta = routeMeta(pathname)

  return (
    <header className="topbar" role="banner">
      <span className="topbar-crumb">{meta.crumbs.join(' / ')}</span>
      <span className="topbar-title">{meta.title}</span>
      <span className="topbar-spacer" />

      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() =>
          navigate('/cursos', {
            state: { focusSearch: true } satisfies CatalogNavState,
            // Estando ya en el catálogo, `replace` evita apilar una entrada de
            // historial por cada pulsación (el usuario solo quiere el foco).
            replace: pathname === '/cursos',
          })
        }
      >
        <IconSearch size={14} /> Buscar
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        aria-label="Acerca de Telar"
        aria-haspopup="dialog"
        aria-expanded={aboutOpen}
        onClick={() => setAboutOpen(true)}
      >
        <IconHelp size={14} />
      </button>
      <span className="topbar-divider" aria-hidden="true" />
      <span className="topbar-avatar" aria-hidden="true">{ADMIN_BUILD ? 'AD' : 'ES'}</span>
      <span className="topbar-user">{ADMIN_BUILD ? 'autor' : 'estudiante'}</span>

      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
    </header>
  )
}
