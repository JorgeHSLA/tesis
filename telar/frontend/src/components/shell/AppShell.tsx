// AppShell — grid raíz del handoff §3.1: sidebar + main (topbar + Outlet).
// El ancho sigue el estado del Sidebar mediante components.css; en pantallas
// pequeñas el menú expandido se superpone sin estrechar el contenido.
// Conserva el scrollTo top smooth de `.main` al navegar (handoff §0.3);
// con prefers-reduced-motion → behavior 'auto' (frontend-spec §2).
import { useEffect, useRef } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useCourseSync } from '../../hooks/useCourseSync'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { DraftBanner } from './DraftBanner'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

export function AppShell() {
  const mainRef = useRef<HTMLElement>(null)
  const { pathname } = useLocation()
  const reduced = useReducedMotion()
  const reducedRef = useRef(reduced)
  reducedRef.current = reduced
  // El curso vive en la nube: al arrancar se descarga lo que falte.
  useCourseSync()

  useEffect(() => {
    const main = mainRef.current
    if (main && typeof main.scrollTo === 'function') {
      main.scrollTo({ top: 0, behavior: reducedRef.current ? 'auto' : 'smooth' })
    }
  }, [pathname])

  return (
    <div className="app">
      <Sidebar />
      <main className="main" ref={mainRef}>
        <TopBar />
        <DraftBanner />
        <Outlet />
      </main>
    </div>
  )
}
