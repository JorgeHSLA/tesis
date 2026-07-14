// Contrato TS de window.ehpc — TRANSCRIPCIÓN LITERAL de electron-spec.md §5.1.
// Este archivo se COMPARTE con el paquete desktop por copia verificada:
// frontend/src/types/ehpc.d.ts == desktop/types/ehpc-api.d.ts (byte a byte;
// `make check-contract` / `npm run check:contract` lo verifican).
// NO editar uno sin el otro.

export interface ComposeService {
  name: string                                // p.ej. 'ehpc-backend-1'
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

export interface EhpcApi {
  /** Versión de la app de escritorio (package.json). */
  readonly appVersion: string
  /** Plataforma del SO: 'win32' | 'linux' | 'darwin'. */
  readonly platform: NodeJS.Platform
  /** `docker compose ps --format json` del proyecto E-HPC. */
  dockerStatus(): Promise<DockerStatusResult>
  /** `docker compose up -d` (backend + web + build de runner si falta). */
  dockerUp(): Promise<DockerActionResult>
  /** `docker compose stop`. */
  dockerStop(): Promise<DockerActionResult>
  /** Abre una URL https en el navegador del sistema. Rechaza cualquier otro esquema. */
  openExternal(url: string): Promise<void>
}

declare global {
  interface Window { ehpc?: EhpcApi }         // undefined en el build web = detector de plataforma
}
