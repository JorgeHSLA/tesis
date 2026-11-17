// HelpTip — el «?» que explica un dato: botón real, se abre con clic/teclado, se
// cierra con Escape o clic fuera, y devuelve el foco.
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

describe('HelpTip · cabe en la ventana', () => {
  const rect = (o: Partial<DOMRect>): DOMRect => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}), ...o }) as DOMRect

  function conRects(pop: DOMRect, btn: DOMRect) {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return this.getAttribute('role') === 'note' ? pop : btn
    })
  }
  afterEach(() => vi.restoreAllMocks())

  it('si se sale por la derecha, se abre hacia la izquierda (si no, creaba scroll)', () => {
    conRects(rect({ left: 1465, right: 1785, width: 320, top: 178, bottom: 300, height: 122 }), rect({ left: 1450, right: 1468, width: 18, top: 150, bottom: 168, height: 18 }))
    render(<HelpTip topic="x">texto</HelpTip>)
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda: x' }))
    expect(screen.getByRole('note')).toHaveClass('is-end')
  })

  it('si se sale por abajo, se abre hacia arriba', () => {
    conRects(rect({ left: 100, right: 420, width: 320, top: 600, bottom: 800, height: 200 }), rect({ left: 90, right: 108, width: 18, top: 570, bottom: 588, height: 18 }))
    render(<HelpTip topic="x">texto</HelpTip>)
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda: x' }))
    expect(screen.getByRole('note')).toHaveClass('is-up')
  })

  it('si cabe, queda donde está (abajo y a la derecha)', () => {
    conRects(rect({ left: 100, right: 420, width: 320, top: 200, bottom: 300, height: 100 }), rect({ left: 90, right: 108, width: 18, top: 170, bottom: 188, height: 18 }))
    render(<HelpTip topic="x">texto</HelpTip>)
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda: x' }))
    expect(screen.getByRole('note')).not.toHaveClass('is-end')
    expect(screen.getByRole('note')).not.toHaveClass('is-up')
  })
})
