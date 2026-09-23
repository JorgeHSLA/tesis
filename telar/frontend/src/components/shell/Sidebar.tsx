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
import {
  IconBook,
  IconCluster,
  IconDownload,
  IconHome,
  IconLayers,
  IconResults,
  type IconProps,
} from '../icons/icons'
import { RuntimeFooter } from './RuntimeFooter'
import { ThemeToggle } from './ThemeToggle'
import { useSystemInfo } from '../../hooks/useSystemInfo'
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

/**
 * Secciones del rail. Es una FUNCIÓN, no una constante, porque un item depende
 * del despliegue: «Módulos disponibles» solo existe si este equipo tiene bucket
 * de catálogo (`GET /system` → `catalog.enabled`, §11.12.A). Sin bucket el item
 * se OCULTA —no se muestra deshabilitado ni roto—: `/modulos` no tendría nada
 * que ofrecer y su única acción posible sería explicar que no hay nada.
 */
function navSections(catalogEnabled: boolean): NavSection[] {
  return [
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
      items: [
        { to: '/aprender', label: 'Aprender', icon: IconBook, match: (p) => p.startsWith('/aprender') },
        // IconDownload y no IconLayers: las capas ya son «Autoría» en este mismo
        // rail, y dos items con el mismo icono en 56px son indistinguibles.
        ...(catalogEnabled
          ? [
              {
                to: '/modulos',
                label: 'Módulos disponibles',
                icon: IconDownload,
                match: (p: string) => p.startsWith('/modulos'),
              },
            ]
          : []),
      ],
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
}

export function Sidebar() {
  const { pathname } = useLocation()
  // `/system` está memoizado a nivel de módulo (useSystemInfo): esto no añade
  // una petición, reusa la que ya hace el footer del propio rail. Mientras no
  // se sepa, el item NO se pinta: es preferible que aparezca un instante tarde
  // a que aparezca y desaparezca al llegar la respuesta.
  const { data: system } = useSystemInfo()
  // `catalog?.`: un backend anterior a Fase 5 no manda el bloque, y leerlo sin
  // guarda tumbaba TODA la app (visto en Electron el 2026-09-22).
  const sections = navSections(system?.catalog?.enabled ?? false)

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-brand-mark" aria-hidden="true">T</div>
        <div className="sidebar-brand-textwrap">
          <div className="sidebar-brand-text">Telar</div>
          <div className="sidebar-brand-sub">v1.0 · local</div>
        </div>
      </div>

      <ThemeToggle />

      <nav className="sidebar-nav" aria-label="Navegación principal">
        {sections.map((section) => (
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
                  // El rail es de 56px: `.nav-label` está en `display: none` y
                  // el tooltip es un `::after` con `content: attr(data-tip)`.
                  // Ninguna de las dos cosas llega al árbol de accesibilidad,
                  // así que sin esto los enlaces de la navegación principal no
                  // tienen NOMBRE: un lector de pantalla anuncia «enlace» y ya
                  // (WCAG 2.4.4 y 4.1.2). Lo detectó el snapshot de Playwright.
                  aria-label={item.label}
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
