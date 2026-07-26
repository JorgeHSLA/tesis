// themeStore.ts — DOS ejes de tema, independientes entre sí:
//
//   1. `data-variant` en <html>  → DENSIDAD. La app quedó FIJA en la variante
//      v2 ("app / compacto"); el switch v1/v2 del TopBar se retiró (2026-07).
//      Se conserva el atributo porque el CSS lo usa como selector
//      ([data-variant="v2"] .x). Ignoramos cualquier 'v1' que hubiera quedado
//      persistido en localStorage de sesiones previas: siempre se aplica v2.
//
//   2. `data-theme` en <html>    → CLARO / OSCURO. Eje nuevo (2026-07-26) que
//      COMPONE con el anterior sin tocarlo. La paleta oscura completa vive en
//      styles/tokens.css bajo [data-theme="dark"].
//
// Persistencia del tema: clave 'ehpc-theme' (nueva; no colisiona con la vieja
// 'ehpc-variant'). Valor por defecto = `prefers-color-scheme` del sistema.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const FIXED_VARIANT = 'v2' as const

export type Variant = typeof FIXED_VARIANT

/** Fija data-variant="v2" en <html> (única variante soportada). */
export function applyFixedVariant(): void {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.variant = FIXED_VARIANT
  }
}

// Aplicar ANTES del primer render (el import de este módulo en main.tsx es un
// side-effect intencional). index.html ya trae data-variant="v2"; esto lo
// reafirma de forma defensiva por si algo lo alteró.
applyFixedVariant()

/* ═══════════════════════ Eje CLARO / OSCURO (data-theme) ═══════════════════ */

export type Theme = 'light' | 'dark'

/** Clave de localStorage del eje de tema (distinta de la de variante). */
export const THEME_STORAGE_KEY = 'ehpc-theme'

/** Ventana durante la cual <html> lleva `data-theme-transition` (ms).
 *  Debe coincidir con la duración declarada en tokens.css §8. */
const THEME_TRANSITION_MS = 240

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark'
}

/** Tema del SISTEMA (`prefers-color-scheme`). Cae a 'light' si no se puede
 *  consultar (jsdom sin matchMedia, entornos sin window). */
export function systemTheme(): Theme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

let transitionTimer: ReturnType<typeof setTimeout> | undefined

/** Escribe `data-theme` en <html>.
 *  `animated` marca <html> con `data-theme-transition` durante una ventana
 *  corta para que el cambio de colores sea suave (solo al CAMBIAR de tema; en
 *  el arranque no hay nada que animar). La transición se anula bajo
 *  prefers-reduced-motion desde CSS, así que aquí no hace falta consultarlo. */
export function applyTheme(theme: Theme, animated = false): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (animated) {
    root.dataset.themeTransition = ''
    clearTimeout(transitionTimer)
    transitionTimer = setTimeout(() => {
      delete root.dataset.themeTransition
    }, THEME_TRANSITION_MS)
  }
  root.dataset.theme = theme
}

export interface ThemeState {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      // Solo se usa si NO hay nada persistido: `persist` rehidrata después.
      theme: systemTheme(),
      setTheme: (theme) => {
        if (theme === get().theme) return
        applyTheme(theme, true)
        set({ theme })
      },
      toggleTheme: () => {
        get().setTheme(get().theme === 'dark' ? 'light' : 'dark')
      },
    }),
    {
      name: THEME_STORAGE_KEY,
      // Sanea el valor persistido: un localStorage manipulado no debe acabar
      // escrito tal cual en el atributo de <html>.
      merge: (persisted, current) => {
        const stored = (persisted as Partial<ThemeState> | undefined)?.theme
        return { ...current, theme: isTheme(stored) ? stored : current.theme }
      },
    },
  ),
)

// El storage por defecto de `persist` es SÍNCRONO: aquí el estado ya está
// rehidratado. Aplicarlo en el import evita el destello de tema claro antes del
// primer render (no cabe un script inline: la CSP de Electron es estricta).
applyTheme(useThemeStore.getState().theme)
