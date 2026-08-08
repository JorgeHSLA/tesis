// Contrato TS de window.telar — TRANSCRIPCIÓN LITERAL de electron-spec.md §5.1.
// Este archivo se COMPARTE con el paquete desktop por copia verificada:
// frontend/src/types/telar.d.ts == desktop/types/telar-api.d.ts (byte a byte;
// `make check-contract` / `npm run check:contract` lo verifican).
// NO editar uno sin el otro.

export interface ComposeService {
  name: string                                // p.ej. 'telar-backend-1'
  service: string                             // 'backend' | 'web' | ...
  state: 'running' | 'exited' | 'restarting' | 'paused' | 'created' | 'dead'
  health?: 'healthy' | 'unhealthy' | 'starting'
}

export interface DockerStatusResult {
  ok: boolean                                 // false = docker/compose no disponible o error
  services: ComposeService[]                  // [] si ok === false
  error?: string                              // mensaje saneado para UI
}

export interface DockerActionResult {
  ok: boolean
  error?: string                              // stderr saneado (primeras ~500 chars)
}

export interface TelarApi {
  /** Versión de la app de escritorio (package.json). */
  readonly appVersion: string
  /** Plataforma del SO: 'win32' | 'linux' | 'darwin'. */
  readonly platform: NodeJS.Platform
  /** `docker compose ps --format json` del proyecto Telar. */
  dockerStatus(): Promise<DockerStatusResult>
  /** `docker compose up -d` (backend + web + build de runner si falta). */
  dockerUp(): Promise<DockerActionResult>
  /** `docker compose stop`. */
  dockerStop(): Promise<DockerActionResult>
  /** Abre una URL https en el navegador del sistema. Rechaza cualquier otro esquema. */
  openExternal(url: string): Promise<void>
}

declare global {
  interface Window { telar?: TelarApi }         // undefined en el build web = detector de plataforma
}
