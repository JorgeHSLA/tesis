/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Override SOLO de dev (architecture.md §2.3). */
  readonly VITE_API_BASE?: string
  /** Override SOLO de dev (architecture.md §2.3). */
  readonly VITE_WS_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Versión de package.json inyectada en build-time (`define` de vite.config.ts
 *  y vitest.config.ts). Se usa en el diálogo «Acerca de»; leerla del paquete en
 *  vez de duplicarla a mano evita que se quede desfasada. */
declare const __APP_VERSION__: string
