// usePlatform.ts — 'web' | 'desktop' según window.ehpc (frontend-spec §6.7).
// window.ehpc lo inyecta el preload de Electron (types/ehpc.d.ts).

export type Platform = 'web' | 'desktop'

export function getPlatform(): Platform {
  return typeof window !== 'undefined' && typeof window.ehpc !== 'undefined'
    ? 'desktop'
    : 'web'
}

/** window.ehpc no cambia durante la vida de la página: valor estático. */
export function usePlatform(): Platform {
  return getPlatform()
}
