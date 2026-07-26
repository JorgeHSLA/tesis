// Sidebar — port del shell.jsx del handoff (§3.2), con NavLink en lugar de
// botones y RuntimeFooter real. Es un RAIL FIJO de 56px: los textos largos del
// menú viven en el tooltip (::after + data-tip).
//
// 2026-07-26: se retira el botón «Colapsar». El rediseño del rail lo dejó en
// `display: none` permanente y las clases .expanded/.collapsed que escribía ya
// no las lee ninguna hoja: era un control muerto. Con él se va sidebarStore,
// que no tenía más consumidores.
//
// Arriba, junto a la marca, va el conmutador de tema claro ⇄ oscuro.
import { NavLink, useLocation } from 'react-router-dom'
import { IconBook, IconCluster, IconHome, IconLayers, IconResults, type IconProps } from '../icons/icons'
import { RuntimeFooter } from './RuntimeFooter'
import { ThemeToggle } from './ThemeToggle'
import { ADMIN_BUILD } from '../../config'

interface NavItem {
  to: string
  label: string
  icon: (p: IconProps) => React.JSX.Element
  /** Prefijos extra que mantienen el item activo (p. ej. /simulador/:jobId). */
  match: (pathname: string) => boolean
}

interface NavSection {
  label: string
  items: NavItem[]
}

const NAV_SECTIONS: NavSection[] = [
  {
    label: 'General',
    items: [{ to: '/', label: 'Inicio', icon: IconHome, match: (p) => p === '/' }],
  },
  {
    label: 'Simulador',
    items: [
      { to: '/simulador', label: 'Simulador', icon: IconCluster, match: (p) => p.startsWith('/simulador') },
      { to: '/resultados', label: 'Resultados', icon: IconResults, match: (p) => p.startsWith('/resultados') },
    ],
  },
  {
    label: 'Aprendizaje',
    items: [{ to: '/cursos', label: 'Aprender (ZINE)', icon: IconBook, match: (p) => p.startsWith('/cursos') }],
  },
  // Autoría (admin) — SOLO en el build admin (VITE_ADMIN → ADMIN_BUILD). En el
  // build estudiante ADMIN_BUILD es una constante falsa y el bundler descarta
  // esta sección por tree-shaking. Es la única vía de acceso a /admin (no hay
  // login): el admin llega aquí y «ve el modo estudiante» con el resto del rail.
  ...(ADMIN_BUILD
    ? [
        {
          label: 'Autoría',
          items: [
            { to: '/admin', label: 'Autoría', icon: IconLayers, match: (p: string) => p.startsWith('/admin') },
          ],
        },
      ]
    : []),
]

export function Sidebar() {
  const { pathname } = useLocation()

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-brand-mark" aria-hidden="true">E</div>
        <div className="sidebar-brand-textwrap">
          <div className="sidebar-brand-text">E-HPC</div>
          <div className="sidebar-brand-sub">v1.0 · local</div>
        </div>
      </div>

      <ThemeToggle />

      <nav className="sidebar-nav" aria-label="Navegación principal">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label} style={{ display: 'contents' }}>
            <div className="nav-section-label">{section.label}</div>
            {section.items.map((item) => {
              const Ico = item.icon
              const active = item.match(pathname)
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={'nav-item ' + (active ? 'active' : '')}
                  data-tip={item.label}
                  aria-current={active ? 'page' : undefined}
                >
                  <span className="nav-icon">
                    <Ico size={17} />
                  </span>
                  <span className="nav-label">{item.label}</span>
                </NavLink>
              )
            })}
          </div>
        ))}
      </nav>

      <RuntimeFooter />
    </aside>
  )
}
