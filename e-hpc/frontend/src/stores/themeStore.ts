// themeStore.ts — variante v1|v2 (frontend-spec §3.1).
// Theming UNIFICADO (decisión §5.1): único atributo `data-variant` en <html>;
// no existe la clase `v2` en `.app`. Persistencia en localStorage 'ehpc-variant'.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Variant = 'v1' | 'v2'

export interface ThemeState {
  variant: Variant
  setVariant: (v: Variant) => void
}

function applyVariant(v: Variant): void {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.variant = v
  }
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      variant: 'v1',
      setVariant: (v) => {
        applyVariant(v)
        set({ variant: v })
      },
    }),
    {
      name: 'ehpc-variant',
      onRehydrateStorage: () => (state) => {
        applyVariant(state?.variant ?? 'v1')
      },
    },
  ),
)

// La rehidratación de localStorage es síncrona: aplicar la variante
// persistida ANTES del primer render (evita flash de v1).
applyVariant(useThemeStore.getState().variant)
