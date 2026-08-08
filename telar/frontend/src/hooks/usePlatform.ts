// usePlatform.ts — 'web' | 'desktop' según window.telar (frontend-spec §6.7).
// window.telar lo inyecta el preload de Electron (types/telar.d.ts).

export type Platform = 'web' | 'desktop'

export function getPlatform(): Platform {
  return typeof window !== 'undefined' && typeof window.telar !== 'undefined'
    ? 'desktop'
    : 'web'
}

/** window.telar no cambia durante la vida de la página: valor estático. */
export function usePlatform(): Platform {
  return getPlatform()
}
