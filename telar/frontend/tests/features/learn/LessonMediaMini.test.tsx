// features/learn/LessonMediaMini.test.tsx — al bajar a leer, el video pasa a un
// mini reproductor abajo a la derecha y al volver arriba regresa a su sitio.
//
// Lo que más importa: el iframe es SIEMPRE el mismo nodo del DOM. Si se moviera
// o se recreara al pasar a mini, YouTube lo recargaría y el video se reiniciaría
// justo cuando el estudiante quiere seguir viéndolo.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LessonMedia } from '@/features/learn/LessonMedia'

type Entrada = { isIntersecting: boolean; boundingClientRect: { top: number } }

/** IntersectionObserver controlable: el test decide cuándo y qué notifica. */
class FakeObserver {
  static todos: FakeObserver[] = []
  disconnect = vi.fn()
  observe = vi.fn()
  unobserve = vi.fn()
  constructor(private cb: (entries: Entrada[]) => void) {
    FakeObserver.todos.push(this)
  }
  emitir(entrada: Entrada) {
    this.cb([entrada])
  }
}

const URL_VIDEO = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
const ARRIBA: Entrada = { isIntersecting: false, boundingClientRect: { top: -400 } }
const ABAJO: Entrada = { isIntersecting: false, boundingClientRect: { top: 900 } }
const VISIBLE: Entrada = { isIntersecting: true, boundingClientRect: { top: 80 } }

const scrollIntoView = vi.fn()

beforeEach(() => {
  FakeObserver.todos = []
  scrollIntoView.mockReset()
  vi.stubGlobal('IntersectionObserver', FakeObserver)
  Element.prototype.scrollIntoView = scrollIntoView
})
afterEach(() => vi.unstubAllGlobals())

function montar() {
  const vista = render(
    <MemoryRouter>
      <LessonMedia
        lessonId="pruebaTeoria"
        videoUrl={URL_VIDEO}
        exampleId={null}
        filename={null}
        runDisabled={false}
      />
    </MemoryRouter>,
  )
  const marco = () => vista.container.querySelector('.lesson-media-screen') as HTMLElement
  const iframe = () => vista.container.querySelector('iframe') as HTMLIFrameElement
  const observer = () => FakeObserver.todos[FakeObserver.todos.length - 1]
  const emitir = (e: Entrada) => act(() => observer().emitir(e))
  return { ...vista, marco, iframe, emitir }
}

describe('mini reproductor del video', () => {
  it('arranca en grande: sin modo mini y con la barra oculta', () => {
    const { marco } = montar()
    expect(marco()).not.toHaveClass('is-mini')
    expect(screen.queryByRole('region', { name: /Mini reproductor/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Subir al video', hidden: true })).not.toBeVisible()
  })

  it('al dejar el video por ARRIBA de la pantalla pasa a mini', async () => {
    const { marco, emitir } = montar()
    await emitir(ARRIBA)
    expect(marco()).toHaveClass('is-mini')
    expect(screen.getByRole('region', { name: /Mini reproductor/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Subir al video' })).toBeVisible()
  })

  it('es el MISMO iframe en grande, en mini y de vuelta (el video no se recarga)', async () => {
    const { iframe, emitir } = montar()
    const original = iframe()
    await emitir(ARRIBA)
    expect(iframe()).toBe(original)
    await emitir(VISIBLE)
    expect(iframe()).toBe(original)
  })

  it('al volver al video regresa a su sitio', async () => {
    const { marco, emitir } = montar()
    await emitir(ARRIBA)
    await emitir(VISIBLE)
    expect(marco()).not.toHaveClass('is-mini')
  })

  it('si el video queda por DEBAJO de la pantalla no hay mini', async () => {
    const { marco, emitir } = montar()
    await emitir(ABAJO)
    expect(marco()).not.toHaveClass('is-mini')
  })

  it('«Subir al video» lleva de vuelta al hueco del video', async () => {
    const { emitir } = montar()
    await emitir(ARRIBA)
    fireEvent.click(screen.getByRole('button', { name: 'Subir al video' }))
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.contexts[0]).toHaveClass('lesson-media-slot')
  })

  it('«Cerrar» quita el mini, detiene el video (iframe nuevo) y no vuelve hasta regresar', async () => {
    const { marco, iframe, emitir } = montar()
    const original = iframe()
    await emitir(ARRIBA)
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar el mini reproductor' }))

    expect(marco()).not.toHaveClass('is-mini')
    expect(iframe()).not.toBe(original) // recreado: YouTube detiene la reproducción

    await emitir(ARRIBA) // sigue más abajo: no reaparece solo
    expect(marco()).not.toHaveClass('is-mini')

    await emitir(VISIBLE) // vuelve al video…
    await emitir(ARRIBA) // …y al bajar otra vez, el mini regresa
    expect(marco()).toHaveClass('is-mini')
  })

  it('observa el hueco (no el iframe) y deja de observar al desmontar', () => {
    const { container, unmount } = montar()
    const obs = FakeObserver.todos[0]
    expect(obs.observe).toHaveBeenCalledWith(container.querySelector('.lesson-media-slot'))
    unmount()
    expect(obs.disconnect).toHaveBeenCalled()
  })

  it('sin IntersectionObserver (entornos viejos) el video sigue funcionando en grande', () => {
    vi.unstubAllGlobals()
    vi.stubGlobal('IntersectionObserver', undefined)
    const { marco, iframe } = montar()
    expect(iframe()).toBeInTheDocument()
    expect(marco()).not.toHaveClass('is-mini')
  })
})

describe('sin video', () => {
  it('no monta nada ni observa nada', () => {
    const { container } = render(
      <MemoryRouter>
        <LessonMedia lessonId="x" videoUrl={null} exampleId={null} filename={null} runDisabled={false} />
      </MemoryRouter>,
    )
    expect(container).toBeEmptyDOMElement()
    expect(FakeObserver.todos).toHaveLength(0)
  })
})
