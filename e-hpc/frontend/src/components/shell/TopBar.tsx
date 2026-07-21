// TopBar — layout del handoff §3.3 (rediseño 2026-07): crumbs / título sans / spacer /
// botones Buscar y Ayuda / divisor / usuario `ES · estudiante` (frontend-spec §6.0).
// El switch v1/v2 (§2.8) se retiró: la app quedó fija en la variante v2.
// Títulos y crumbs por ruta: tabla de frontend-spec §2.
import { useLocation } from 'react-router-dom'
import { IconHelp, IconSearch } from '../icons/icons'

interface RouteMeta {
  title: string
  crumbs: string[]
}

/** Tabla título/crumbs por ruta (frontend-spec §2). Más específica primero.
 *  Para /cursos/:leccionId los crumbs dinámicos (módulo/lección) los aporta
 *  WP7 dentro de la pantalla; el topbar usa el literal del handoff §0.4. */
export function routeMeta(pathname: string): RouteMeta {
  if (pathname === '/') return { title: 'Inicio', crumbs: ['E-HPC'] }
  if (/^\/simulador\/.+/.test(pathname)) return { title: 'Simulador · En vivo', crumbs: ['Simulador', 'En vivo'] }
  if (pathname.startsWith('/simulador')) return { title: 'Simulador · Configurar', crumbs: ['Simulador', 'Configurar'] }
  if (pathname.startsWith('/resultados')) return { title: 'Resultados', crumbs: ['Simulador', 'Resultados'] }
  if (/^\/cursos\/.+/.test(pathname)) return { title: 'ZINE · Aprender', crumbs: ['Aprendizaje', 'Módulo', 'Lección'] }
  if (pathname.startsWith('/cursos')) return { title: 'Aprendizaje · Catálogo', crumbs: ['Aprendizaje', 'Catálogo'] }
  return { title: 'Inicio', crumbs: ['E-HPC'] }
}

export function TopBar() {
  const { pathname } = useLocation()
  const meta = routeMeta(pathname)

  return (
    <header className="topbar" role="banner">
      <span className="topbar-crumb">{meta.crumbs.join(' / ')}</span>
      <span className="topbar-title">{meta.title}</span>
      <span className="topbar-spacer" />

      <button type="button" className="btn btn-ghost btn-sm">
        <IconSearch size={14} /> Buscar
      </button>
      <button type="button" className="btn btn-ghost btn-sm" aria-label="Ayuda">
        <IconHelp size={14} />
      </button>
      <span className="topbar-divider" aria-hidden="true" />
      <span className="topbar-avatar" aria-hidden="true">ES</span>
      <span className="topbar-user">estudiante</span>
    </header>
  )
}
