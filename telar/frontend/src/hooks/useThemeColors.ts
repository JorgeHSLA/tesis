// useThemeColors — resuelve tokens de color de tokens.css y RE-LEE cuando el
// tema cambia (`data-theme`/`data-variant` en <html>, o el esquema del SO).
// Lo usan las animaciones sobre <canvas>, que no pueden consumir `var(--x)`.
import { useEffect, useMemo, useState } from 'react'
import { readThemeColors, type ResolvedColors, type TokenMap } from '../lib/themeColors'

const COLOR_SCHEME_QUERY = '(prefers-color-scheme: dark)'
/** Atributos de <html> que conmutan la paleta (frontend-spec §5.1 y §7). */
const THEME_ATTRS = ['data-theme', 'data-variant', 'class'] as const

/** Contador que se incrementa en cada cambio de tema; fuerza la re-lectura. */
function useThemeRevision(): number {
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (typeof document === 'undefined') return
    const bump = () => setRevision((n) => n + 1)

    let observer: MutationObserver | undefined
    if (typeof MutationObserver === 'function') {
      observer = new MutationObserver(bump)
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: [...THEME_ATTRS],
      })
    }

    let media: MediaQueryList | undefined
    if (typeof window.matchMedia === 'function') {
      media = window.matchMedia(COLOR_SCHEME_QUERY)
      media.addEventListener('change', bump)
    }

    return () => {
      observer?.disconnect()
      media?.removeEventListener('change', bump)
    }
  }, [])

  return revision
}

/**
 * Devuelve los colores resueltos del `tokens` dado. El objeto `tokens` debe ser
 * una constante a nivel de módulo (o memoizada): su identidad entra en las deps.
 */
export function useThemeColors<T extends TokenMap>(tokens: T): ResolvedColors<T> {
  const revision = useThemeRevision()
  // `revision` no se usa dentro: está en las deps para reejecutar la lectura.
  return useMemo(() => readThemeColors(tokens), [tokens, revision])
}
