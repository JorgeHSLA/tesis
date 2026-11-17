// HelpTip — el «?» que explica un dato: botón real, se abre con clic/teclado, se
// cierra con Escape o clic fuera, y devuelve el foco.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HelpTip } from '@/components/ui/HelpTip'
import { Help } from '@/components/ui/helpTexts'

describe('HelpTip', () => {
  it('cerrado: solo el botón, con nombre accesible y sin explicación en pantalla', () => {
    render(<HelpTip topic="speedup">Explicación</HelpTip>)
    const btn = screen.getByRole('button', { name: 'Ayuda: speedup' })
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Explicación')).toBeNull()
  })

  it('clic abre; otro clic cierra', () => {
    render(
      <HelpTip topic="speedup" title="Speedup (aceleración)">
        Explicación
      </HelpTip>,
    )
    const btn = screen.getByRole('button', { name: 'Ayuda: speedup' })
    fireEvent.click(btn)
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('note')).toHaveTextContent('Speedup (aceleración)')
    expect(screen.getByRole('note')).toHaveTextContent('Explicación')
    fireEvent.click(btn)
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('el título cae al tema si no se da', () => {
    render(<HelpTip topic="memoria">x</HelpTip>)
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda: memoria' }))
    expect(screen.getByRole('note')).toHaveTextContent('memoria')
  })

  it('Escape cierra y devuelve el foco al botón', () => {
    render(<HelpTip topic="cpu">x</HelpTip>)
    const btn = screen.getByRole('button', { name: 'Ayuda: cpu' })
    fireEvent.click(btn)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('note')).toBeNull()
    expect(btn).toHaveFocus()
  })

  it('clic fuera cierra; clic dentro del recuadro no', () => {
    render(
      <div>
        <HelpTip topic="cpu">Texto de ayuda</HelpTip>
        <button type="button">otro</button>
      </div>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda: cpu' }))
    fireEvent.mouseDown(screen.getByText('Texto de ayuda'))
    expect(screen.getByRole('note')).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole('button', { name: 'otro' }))
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('el botón se describe con el recuadro abierto (lectores de pantalla)', () => {
    render(<HelpTip topic="cpu">x</HelpTip>)
    const btn = screen.getByRole('button', { name: 'Ayuda: cpu' })
    fireEvent.click(btn)
    expect(btn).toHaveAttribute('aria-controls', screen.getByRole('note').id)
  })
})

describe('textos de ayuda de Simulador y Resultados', () => {
  const topics = Object.keys(Help) as (keyof typeof Help)[]

  it.each(topics)('«%s» abre una explicación con contenido', (key) => {
    render(<>{Help[key]}</>)
    fireEvent.click(screen.getByRole('button'))
    const note = screen.getByRole('note')
    expect((note.textContent ?? '').length).toBeGreaterThan(60)
  })

  it('las dos medidas que más confundieron dan un ejemplo numérico', () => {
    render(<>{Help.speedup}</>)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('note')).toHaveTextContent('2× = tardó la mitad')
  })
})
