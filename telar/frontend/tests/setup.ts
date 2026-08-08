// tests/setup.ts — infraestructura común de la suite WP10 (frontend-spec §10):
//  - @testing-library/jest-dom (matchers .toBeInTheDocument, etc.),
//  - mock controlable de window.matchMedia (prefers-reduced-motion),
//  - FakeWebSocket controlable que reemplaza el WebSocket global.
// Todo autosuficiente: los tests no tocan un backend real.
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})

// ───────────────────────── matchMedia controlable ──────────────────────────

type MqlListener = (e: MediaQueryListEvent) => void

class FakeMediaQueryList {
  readonly media: string
  matches: boolean
  onchange: MqlListener | null = null
  private readonly listeners = new Set<MqlListener>()

  constructor(media: string, matches: boolean) {
    this.media = media
    this.matches = matches
  }

  addEventListener(_type: 'change', l: MqlListener): void {
    this.listeners.add(l)
  }
  removeEventListener(_type: 'change', l: MqlListener): void {
    this.listeners.delete(l)
  }
  addListener(l: MqlListener): void {
    this.listeners.add(l)
  }
  removeListener(l: MqlListener): void {
    this.listeners.delete(l)
  }
  dispatchEvent(): boolean {
    return true
  }

  /** Helper de test: cambia matches y notifica a los listeners registrados. */
  fire(matches: boolean): void {
    this.matches = matches
    const ev = { matches, media: this.media } as MediaQueryListEvent
    this.onchange?.(ev)
    for (const l of this.listeners) l(ev)
  }
}

const reducedMotionState = { reduced: false }
const mqlRegistry: FakeMediaQueryList[] = []

function fakeMatchMedia(query: string): FakeMediaQueryList {
  const isReduced = query.includes('prefers-reduced-motion')
  const mql = new FakeMediaQueryList(query, isReduced ? reducedMotionState.reduced : false)
  mqlRegistry.push(mql)
  return mql
}

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: fakeMatchMedia,
})

/** Fija prefers-reduced-motion y notifica a los MQL vivos. */
export function setReducedMotion(reduced: boolean): void {
  reducedMotionState.reduced = reduced
  for (const m of mqlRegistry) {
    if (m.media.includes('prefers-reduced-motion')) m.fire(reduced)
  }
}

export function resetMatchMedia(): void {
  reducedMotionState.reduced = false
  mqlRegistry.length = 0
}

// ───────────────────────── FakeWebSocket controlable ───────────────────────

/**
 * Reemplaza el WebSocket global. Cada instancia queda registrada en
 * `FakeWebSocket.instances`; los tests la conducen con open()/emit()/serverClose().
 */
export class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  static instances: FakeWebSocket[] = []
  static reset(): void {
    FakeWebSocket.instances = []
  }
  static get last(): FakeWebSocket | undefined {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
  }

  readonly CONNECTING = 0
  readonly OPEN = 1
  readonly CLOSING = 2
  readonly CLOSED = 3

  readonly url: string
  readyState = 0
  onopen: ((ev: Event) => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: ((ev: { code: number; reason: string }) => void) | null = null
  onerror: ((ev: Event) => void) | null = null

  /** Frames enviados por el cliente (JSON string). */
  readonly sent: string[] = []
  /** Última llamada a close() iniciada por el cliente (código). */
  clientClose: { code: number } | null = null

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(code = 1000): void {
    this.readyState = FakeWebSocket.CLOSED
    this.clientClose = { code }
  }

  // ── controles de test ───────────────────────────────────────────────────
  /** Simula onopen (readyState → OPEN). */
  open(): void {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.(new Event('open'))
  }
  /** Emite un mensaje del servidor (objeto → JSON, o string tal cual). */
  emit(msg: unknown): void {
    const data = typeof msg === 'string' ? msg : JSON.stringify(msg)
    this.onmessage?.({ data })
  }
  /** Simula un cierre iniciado por el servidor. */
  serverClose(code = 1000, reason = ''): void {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({ code, reason })
  }
}

Object.defineProperty(globalThis, 'WebSocket', {
  writable: true,
  configurable: true,
  value: FakeWebSocket,
})
