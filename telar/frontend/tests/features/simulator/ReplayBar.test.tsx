// ReplayBar — controles «de editor de video» de la ejecución. En vivo solo se
// puede pausar la ilustración y cambiar su velocidad; al terminar se desbloquea
// pausar/retroceder/saltar.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ReplayBar, STEP_MS, type ReplayBarProps } from '@/features/simulator/ReplayBar'

function setup(over: Partial<ReplayBarProps> = {}) {
  const props: ReplayBarProps = {
    live: false,
    time: 1500,
    duration: 4000,
    playing: false,
    speed: 1,
    onToggle: vi.fn(),
    onSeek: vi.fn(),
    onStep: vi.fn(),
    onRestart: vi.fn(),
    onSpeed: vi.fn(),
    ...over,
  }
  render(<ReplayBar {...props} />)
  return props
}

describe('ReplayBar · ejecución terminada', () => {
  it('todos los controles activos; el reloj dice «momento / total»', () => {
    setup()
    for (const name of ['Ir al principio', 'Retroceder 1 segundo', 'Reproducir', 'Adelantar 1 segundo']) {
      expect(screen.getByRole('button', { name })).toBeEnabled()
    }
    expect(screen.getByRole('slider', { name: 'Momento de la ejecución' })).toBeEnabled()
    expect(screen.getByText('0:01.5 / 0:04.0')).toBeInTheDocument()
  })

  it('cada botón llama a lo suyo', () => {
    const p = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Ir al principio' }))
    fireEvent.click(screen.getByRole('button', { name: 'Retroceder 1 segundo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Adelantar 1 segundo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reproducir' }))
    expect(p.onRestart).toHaveBeenCalledTimes(1)
    expect(p.onStep).toHaveBeenNthCalledWith(1, -STEP_MS)
    expect(p.onStep).toHaveBeenNthCalledWith(2, STEP_MS)
    expect(p.onToggle).toHaveBeenCalledTimes(1)
  })

  it('mientras reproduce, el botón principal pasa a «Pausar»', () => {
    setup({ playing: true })
    expect(screen.getByRole('button', { name: 'Pausar' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('arrastrar la línea de tiempo salta a ese momento', () => {
    const p = setup()
    fireEvent.change(screen.getByRole('slider', { name: 'Momento de la ejecución' }), { target: { value: '2750' } })
    expect(p.onSeek).toHaveBeenCalledWith(2750)
  })

  it('el deslizante de velocidad llega de 0.25× a 4× y avisa el valor', () => {
    const p = setup({ speed: 0.5 })
    const speed = screen.getByRole('slider', { name: 'Velocidad de la ilustración' })
    expect(speed).toHaveAttribute('min', '0.25')
    expect(speed).toHaveAttribute('max', '4')
    expect(speed).toHaveAttribute('aria-valuetext', '0.5×')
    fireEvent.change(speed, { target: { value: '3' } })
    expect(p.onSpeed).toHaveBeenCalledWith(3)
  })
})

describe('ReplayBar · ejecución en vivo', () => {
  it('marca «en vivo» y bloquea retroceder, saltar y arrastrar (todavía no hay qué rebobinar)', () => {
    setup({ live: true, time: 2300, duration: 2300, playing: true })
    expect(screen.getByText(/en vivo/)).toBeInTheDocument()
    for (const name of ['Ir al principio', 'Retroceder 1 segundo', 'Adelantar 1 segundo']) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }
    expect(screen.getByRole('slider', { name: 'Momento de la ejecución' })).toBeDisabled()
  })

  it('pero se puede pausar la ilustración y cambiar su velocidad', () => {
    const p = setup({ live: true, playing: true })
    const pausar = screen.getByRole('button', { name: 'Pausar' })
    expect(pausar).toBeEnabled()
    // Deja claro que NO pausa la ejecución real.
    expect(pausar).toHaveAttribute('title', expect.stringMatching(/solo la ilustración/i))
    fireEvent.click(pausar)
    expect(p.onToggle).toHaveBeenCalled()
    expect(screen.getByRole('slider', { name: 'Velocidad de la ilustración' })).toBeEnabled()
  })

  it('en pausa dice «Reanudar la ilustración»', () => {
    setup({ live: true, playing: false })
    expect(screen.getByRole('button', { name: 'Reanudar la ilustración' })).toBeInTheDocument()
  })
})

describe('ReplayBar · sin nada que reproducir', () => {
  it('queda bloqueado por completo', () => {
    setup({ empty: true, duration: 0, time: 0 })
    expect(screen.getByRole('button', { name: 'Reproducir' })).toBeDisabled()
    expect(screen.getByRole('slider', { name: 'Momento de la ejecución' })).toBeDisabled()
  })
})
