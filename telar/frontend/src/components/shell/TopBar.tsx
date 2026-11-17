// TopBar — layout del handoff §3.3 (rediseño 2026-07): crumbs / título sans / spacer /
// botones Buscar y Ayuda / divisor / usuario `ES · estudiante` (frontend-spec §6.0).
// El switch v1/v2 (§2.8) se retiró: la app quedó fija en la variante v2.
// Títulos y crumbs por ruta: tabla de frontend-spec §2.
//
// 2026-07-26 — el modo autoría YA NO usa login: se decide en BUILD (VITE_ADMIN →
// config.ts ADMIN_BUILD). Por eso este TopBar vuelve a la etiqueta de usuario
// ESTÁTICA (sin menú ni sesión): `ES · estudiante` en el build estudiante y
// `AD · autor` en el build admin. Los dos botones NO son maqueta:
//   · Buscar → abre el buscador GLOBAL (GlobalSearch): páginas, cursos,
//     lecciones, ejemplos, ejecuciones, configuraciones y módulos. También con
//     Ctrl/⌘ + K. (Antes llevaba al buscador del catálogo, que solo filtraba
//     cursos; ese sigue existiendo dentro de /aprender.)
//   · Ayuda  → abre el diálogo «Acerca de» (versión, entorno, documentación).
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { IconChevronLeft, IconChevronRight, IconHelp, IconSearch } from '../icons/icons'
import { AboutDialog } from './AboutDialog'
import { GlobalSearch } from './GlobalSearch'
import { ADMIN_BUILD } from '../../config'

interface RouteMeta {
  title: string
  crumbs: string[]
}

/** Tabla título/crumbs por ruta (frontend-spec §2). Más específica primero.
 *  Para /aprender/:leccionId los crumbs dinámicos (módulo/lección) los aporta
 *  WP7 dentro de la pantalla; el topbar usa el literal del handoff §0.4.
 *  Las entradas «Autoría · …» solo se ejercitan en el build admin (las rutas
 *  /admin/* únicamente existen ahí), pero se dejan siempre en la tabla. */
export function routeMeta(pathname: string): RouteMeta {
  if (pathname === '/') return { title: 'Inicio', crumbs: ['Telar'] }
  if (/^\/simulador\/.+/.test(pathname)) return { title: 'Simulador · En vivo', crumbs: ['Simulador', 'En vivo'] }
  if (pathname.startsWith('/simulador')) return { title: 'Simulador · Configurar', crumbs: ['Simulador', 'Configurar'] }
  if (pathname.startsWith('/resultados')) return { title: 'Resultados', crumbs: ['Simulador', 'Resultados'] }
  if (/^\/aprender\/.+/.test(pathname)) return { title: 'Aprender', crumbs: ['Aprendizaje', 'Módulo', 'Lección'] }
  if (pathname.startsWith('/aprender')) return { title: 'Aprendizaje · Catálogo', crumbs: ['Aprendizaje', 'Catálogo'] }
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

/** Posición de la entrada actual en el historial de ESTA sesión (la guarda React Router). */
export function historyIndex(): number {
  return (window.history.state as { idx?: number } | null)?.idx ?? 0
}

/**
 * ¿Hay a dónde volver / avanzar? Atrás existe si no estamos en la primera entrada.
 * Adelante, solo si ya habíamos llegado más lejos (`furthest`): `history.length` no
 * sirve porque cuenta también páginas anteriores a la app (en el navegador del
 * modo Autoría, la pestaña trae su propio historial) y daría «adelante» sin haber
 * vuelto atrás.
 */
export function historyAvailability(idx: number, furthest: number): { canBack: boolean; canForward: boolean } {
  return { canBack: idx > 0, canForward: idx < furthest }
}

export function TopBar() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const navType = useNavigationType()
  const location = useLocation()
  // Hasta dónde se ha avanzado en esta sesión: un clic o redirección nuevo (PUSH/REPLACE)
  // borra lo de «adelante»; volver o avanzar (POP) lo conserva.
  const idx = historyIndex()
  const furthest = useRef(idx)
  const lastKey = useRef<string | null>(null)
  if (lastKey.current !== location.key) {
    lastKey.current = location.key
    furthest.current = navType === 'POP' ? Math.max(furthest.current, idx) : idx
  }
  const { canBack, canForward } = historyAvailability(idx, furthest.current)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const searchBtnRef = useRef<HTMLButtonElement>(null)

  // Ctrl/⌘ + K abre el buscador desde cualquier pantalla.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const closeSearch = () => {
    setSearchOpen(false)
    // El foco vuelve al botón, salvo que la búsqueda ya haya llevado a otra pantalla.
    searchBtnRef.current?.focus()
  }
  const meta = routeMeta(pathname)

  return (
    <header className="topbar" role="banner">
      {/* Navegación del historial: volver / avanzar desde cualquier pantalla. */}
      <div className="topbar-nav" role="group" aria-label="Navegación del historial">
        <button
          type="button"
          className="topbar-nav-btn"
          onClick={() => navigate(-1)}
          disabled={!canBack}
          aria-label="Volver a la pantalla anterior"
          title="Volver"
        >
          <IconChevronLeft size={16} />
        </button>
        <button
          type="button"
          className="topbar-nav-btn"
          onClick={() => navigate(1)}
          disabled={!canForward}
          aria-label="Avanzar a la pantalla siguiente"
          title="Avanzar"
        >
          <IconChevronRight size={16} />
        </button>
      </div>
      <span className="topbar-crumb">{meta.crumbs.join(' / ')}</span>
      <span className="topbar-title">{meta.title}</span>
      <span className="topbar-spacer" />

      <button
        ref={searchBtnRef}
        type="button"
        className="btn btn-ghost btn-sm"
        aria-haspopup="dialog"
        aria-keyshortcuts="Control+K Meta+K"
        title="Buscar en todo Telar (Ctrl+K)"
        onClick={() => setSearchOpen(true)}
      >
        <IconSearch size={14} /> Buscar
      </button>
      <GlobalSearch open={searchOpen} onClose={closeSearch} />
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
