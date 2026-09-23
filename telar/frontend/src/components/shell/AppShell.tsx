// AppShell — grid raíz del handoff §3.1: sidebar + main (topbar + Outlet).
// El rail es FIJO (--sidebar-w en components.css): el colapso 220⇄60px del
// prototipo se retiró junto con su botón (2026-07-26).
// Conserva el scrollTo top smooth de `.main` al navegar (handoff §0.3);
// con prefers-reduced-motion → behavior 'auto' (frontend-spec §2).
import { useEffect, useRef } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
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
