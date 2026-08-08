// Suite 8 (frontend-spec §10): features/simulator/LiveTerminalCard.test.tsx
// Render de stdout/stderr con clases; placeholders por fase; pausa de
// auto-scroll al scrollear arriba; banner de salida truncada.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LiveTerminalCard } from '@/features/simulator/LiveTerminalCard'
import type { LogLine, UiPhase } from '@/stores/jobStore'

function logs(...entries: Array<[number, string, 'stdout' | 'stderr']>): LogLine[] {
  return entries.map(([seq, text, stream]) => ({ seq, ts: '2026-07-12T15:04:08.101Z', stream, text }))
}

function renderCard(phase: UiPhase, lines: LogLine[] = [], truncated = false) {
  return render(<LiveTerminalCard jobId="j1" phase={phase} logs={lines} logsTruncated={truncated} />)
}

describe('render de líneas', () => {
  it('stdout usa term-green y stderr term-red', () => {
    renderCard('running', logs([1, 'hola stdout', 'stdout'], [2, 'boom stderr', 'stderr']))
    const stdoutTag = screen.getByText('stdout')
    const stderrTag = screen.getByText('stderr')
    expect(stdoutTag).toHaveClass('term-green')
    expect(stderrTag).toHaveClass('term-red')
    expect(screen.getByText('hola stdout')).toBeInTheDocument()
    expect(screen.getByText('boom stderr')).toBeInTheDocument()
  })
})

describe('BL-16: ts del replay desde DB', () => {
  it('ts vacío (no fabricado por el servidor) se muestra como «—»', () => {
    // El replay post-terminal no conoce el instante real de cada línea y
    // manda `ts: ""` (§8.2): la terminal NO puede inventar un reloj.
    const { container } = renderCard('completed', [
      { seq: 1, ts: '', stream: 'stdout', text: 'salida vieja' },
    ])
    expect(container.querySelector('.term-line .term-dim')?.textContent).toBe('[—]')
    expect(screen.getByText('salida vieja')).toBeInTheDocument()
  })
})

describe('placeholders por fase (logs vacíos)', () => {
  it('creating → «Creando contenedor…»', () => {
    renderCard('creating')
    expect(screen.getByText('Creando contenedor…')).toBeInTheDocument()
  })
  it('compiling → «Compilando con Numba…»', () => {
    renderCard('compiling')
    expect(screen.getByText(/Compilando con Numba/)).toBeInTheDocument()
  })
  it('connecting → «Conectando con el job…»', () => {
    renderCard('connecting')
    expect(screen.getByText('Conectando con el job…')).toBeInTheDocument()
  })
  it('con logs no se muestra placeholder', () => {
    renderCard('running', logs([1, 'x', 'stdout']))
    expect(screen.queryByText('Creando contenedor…')).not.toBeInTheDocument()
  })
})

describe('banner de truncado', () => {
  it('logsTruncated → línea ámbar de salida truncada', () => {
    renderCard('completed', logs([1, 'x', 'stdout']), true)
    expect(screen.getByText(/salida truncada \(límite 256 KB\)/)).toBeInTheDocument()
  })
})

describe('auto-scroll', () => {
  it('scrollear arriba pausa el follow y muestra «↓ seguir salida»', () => {
    renderCard('running', logs([1, 'a', 'stdout'], [2, 'b', 'stdout']))
    const body = screen.getByRole('log')
    // Simula geometría: contenido largo, scrolleado arriba (no al fondo).
    Object.defineProperty(body, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(body, 'clientHeight', { value: 100, configurable: true })
    Object.defineProperty(body, 'scrollTop', { value: 0, writable: true, configurable: true })
    body.scrollTo = vi.fn()

    expect(screen.queryByText('↓ seguir salida')).not.toBeInTheDocument()
    fireEvent.scroll(body)
    expect(screen.getByText('↓ seguir salida')).toBeInTheDocument()

    // Reanudar: click restaura follow y el botón desaparece.
    Object.defineProperty(body, 'scrollTop', { value: 900, writable: true, configurable: true })
    fireEvent.click(screen.getByText('↓ seguir salida'))
    expect(body.scrollTo).toHaveBeenCalled()
    expect(screen.queryByText('↓ seguir salida')).not.toBeInTheDocument()
  })
})
