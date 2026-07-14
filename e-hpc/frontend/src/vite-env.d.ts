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
