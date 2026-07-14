// config.ts — regla congelada (architecture.md §2.3): API_BASE/WS_BASE se
// resuelven en RUNTIME, no en el build. El build es ÚNICO para web y desktop;
// hornear un valor rompería la otra plataforma.
const isDesktop = typeof window.ehpc !== 'undefined' || location.protocol === 'file:'

export const API_BASE = import.meta.env.VITE_API_BASE      // override SOLO de dev
  ?? (isDesktop ? 'http://localhost:8000' : '')             // web: mismo origen (proxy nginx)

export const WS_BASE = import.meta.env.VITE_WS_BASE
  ?? (isDesktop ? 'ws://localhost:8000'
                : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`)
