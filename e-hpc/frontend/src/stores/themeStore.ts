// themeStore.ts — la app quedó FIJA en la variante v2 ("app / compacto").
// El switch v1/v2 del TopBar se retiró (2026-07): v2 es la única variante
// soportada. Se conserva el atributo `data-variant="v2"` en <html> porque los
// overrides del CSS lo usan como selector ([data-variant="v2"] .x). Ignoramos
// cualquier valor 'v1' que hubiera quedado persistido en localStorage de
// sesiones previas: siempre se aplica v2.
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
