// config.ts — regla congelada (architecture.md §2.3): API_BASE/WS_BASE se
// resuelven en RUNTIME, no en el build. El build es ÚNICO para web y desktop;
// hornear un valor rompería la otra plataforma.
const isDesktop = typeof window.ehpc !== 'undefined' || location.protocol === 'file:'

export const API_BASE = import.meta.env.VITE_API_BASE      // override SOLO de dev
  ?? (isDesktop ? 'http://localhost:8000' : '')             // web: mismo origen (proxy nginx)

export const WS_BASE = import.meta.env.VITE_WS_BASE
  ?? (isDesktop ? 'ws://localhost:8000'
                : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`)

/** Versión mostrada en «Acerca de». La inyecta el `define` de vite.config.ts /
 *  vitest.config.ts desde package.json (así no se duplica a mano).
 *  El `typeof` NO es decorativo: referenciar el identificador a pelo lanza
 *  ReferenceError y tumba la pantalla entera si algún camino de build se deja
 *  el define (el build de Docker es un pipeline aparte). Con el define puesto,
 *  esbuild pliega la expresión a la constante. */
export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' && __APP_VERSION__ !== '' ? __APP_VERSION__ : '0.0.0-dev'
