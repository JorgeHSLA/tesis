// Sidebar — port literal del shell.jsx del handoff (§3.2), con NavLink en
// lugar de botones y RuntimeFooter real. Estado de colapso en sidebarStore
// (persist 'ehpc-sidebar-expanded', default colapsado). Tooltips en colapsado
// vía ::after + data-tip (CSS). brand-sub adaptado: `v1.0 · local` (§6.0).
import { NavLink, useLocation } from 'react-router-dom'
import { useSidebarStore } from '../../stores/sidebarStore'
import {
  IconBook,
  IconChevronLeft,
  IconChevronRight,
  IconCluster,
  IconHome,
  IconResults,
  type IconProps,
} from '../icons/icons'
import { RuntimeFooter } from './RuntimeFooter'

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
]

export function Sidebar() {
  const expanded = useSidebarStore((s) => s.expanded)
  const toggle = useSidebarStore((s) => s.toggle)
  const { pathname } = useLocation()

  return (
    <aside className={'sidebar ' + (expanded ? 'expanded' : 'collapsed')}>
      <div className="sidebar-brand">
        <div className="sidebar-brand-mark" aria-hidden="true">E</div>
        <div className="sidebar-brand-textwrap">
          <div className="sidebar-brand-text">E-HPC</div>
          <div className="sidebar-brand-sub">v1.0 · local</div>
        </div>
      </div>

      <button
        className="sidebar-toggle"
        onClick={toggle}
        title={expanded ? 'Colapsar menú' : 'Expandir menú'}
        aria-label={expanded ? 'Colapsar menú' : 'Expandir menú'}
        aria-expanded={expanded}
      >
        {expanded ? <IconChevronLeft size={14} /> : <IconChevronRight size={14} />}
        <span className="nav-label">Colapsar</span>
      </button>

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
