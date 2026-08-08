// useReducedMotion.ts — matchMedia('(prefers-reduced-motion: reduce)').
// Complementa la regla CSS global de base.css: este hook suprime lo que el
// CSS no alcanza (SMIL <animate>/<animateMotion> por render condicional y
// smooth-scroll) — frontend-spec §5.3.
import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

function matches(): boolean {
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(QUERY).matches
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(matches)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(QUERY)
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return reduced
}
