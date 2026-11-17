// MarkdownEditor — imágenes: «Insertar imagen», pegar y arrastrar suben el
// archivo a la nube y dejan `![texto](url)` en su propia línea; la vista previa
// las muestra como figura y, si no cargan, avisa en lugar de un icono roto.
import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/admin', () => ({ uploadLessonImage: vi.fn() }))

import { uploadLessonImage } from '@/api/admin'
import { ApiError } from '@/api/client'
import { MarkdownEditor } from '@/features/admin/lesson/MarkdownEditor'

const HASH = '0123456789abcdef0123456789abcdef'
const URL_OK = `https://storage.googleapis.com/clasestelar/imagenes/${HASH}.png`
const upload = vi.mocked(uploadLessonImage)

/** El editor es controlado: este envoltorio guarda su texto como lo haría la pantalla. */
function Harness({ initial = '', onValue }: { initial?: string; onValue?: (v: string) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <MarkdownEditor
      value={value}
      onChange={(v) => {
        setValue(v)
        onValue?.(v)
      }}
    />
  )
}

const png = (name = 'jerarquia-de-memoria.png', size = 1234, type = 'image/png') =>
  new File([new Uint8Array(size)], name, { type })

const area = () => screen.getByLabelText(/Contenido de la lección/) as HTMLTextAreaElement
const picker = () => screen.getByLabelText('Elegir imagen para la lección') as HTMLInputElement

beforeEach(() => {
  upload.mockReset()
  upload.mockResolvedValue({
    url: URL_OK,
    object_path: `imagenes/${HASH}.png`,
    bytes: 1234,
    width: 800,
    height: 600,
    content_type: 'image/png',
  })
})

describe('MarkdownEditor · imágenes', () => {
  it('«Insertar imagen» sube el archivo y deja el markdown en su propia línea, con la vista previa', async () => {
    render(<Harness initial="Antes de la imagen" />)
    fireEvent.change(picker(), { target: { files: [png()] } })

    await waitFor(() => expect(area().value).toContain(`![jerarquia de memoria](${URL_OK})`))
    expect(upload).toHaveBeenCalledTimes(1)
    expect(upload.mock.calls[0][0].name).toBe('jerarquia-de-memoria.png')
    expect(area().value.startsWith('Antes de la imagen')).toBe(true)
    // Línea propia: separada del texto por un salto de párrafo.
    expect(area().value).toContain(`Antes de la imagen\n\n![`)
    // Aviso con lo subido (y qué editar).
    expect(await screen.findByRole('status')).toHaveTextContent('800×600')
    // La vista previa ya la pinta como figura con su pie.
    const figure = screen.getByTestId('markdown-preview').querySelector('figure.md-figure')
    expect(figure).not.toBeNull()
    expect(figure?.querySelector('img')).toHaveAttribute('src', URL_OK)
  })

  it('la imagen se inserta donde estaba el cursor al elegir el archivo', async () => {
    render(<Harness initial="Uno Dos" />)
    area().focus()
    area().setSelectionRange(3, 3)
    fireEvent.change(picker(), { target: { files: [png('esquema.png')] } })
    await waitFor(() => expect(area().value).toContain('![esquema]('))
    expect(area().value.indexOf('![esquema](')).toBeGreaterThan(area().value.indexOf('Uno'))
    expect(area().value.indexOf('![esquema](')).toBeLessThan(area().value.indexOf('Dos'))
  })

  it('mientras sube, el botón avisa y no deja lanzar otra subida', async () => {
    let resolver: (v: Awaited<ReturnType<typeof uploadLessonImage>>) => void = () => {}
    upload.mockReturnValue(new Promise((r) => (resolver = r)))
    render(<Harness />)
    fireEvent.change(picker(), { target: { files: [png()] } })

    const boton = await screen.findByRole('button', { name: 'Subiendo imagen…' })
    expect(boton).toBeDisabled()
    resolver({ url: URL_OK, object_path: 'x', bytes: 10, width: 1, height: 1, content_type: 'image/png' })
    await screen.findByRole('button', { name: 'Insertar imagen' })
  })

  it('un formato no admitido se rechaza SIN llamar a la API', async () => {
    render(<Harness />)
    fireEvent.change(picker(), { target: { files: [png('dibujo.svg', 100, 'image/svg+xml')] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('SVG no se permite')
    expect(upload).not.toHaveBeenCalled()
    expect(area().value).toBe('')
  })

  it('una imagen demasiado pesada se rechaza con los MB reales', async () => {
    render(<Harness />)
    fireEvent.change(picker(), { target: { files: [png('grande.png', 3 * 1024 * 1024)] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('máximo es 2 MB')
    expect(upload).not.toHaveBeenCalled()
  })

  it('si el servidor falla (p. ej. sin clave de publicación) lo dice y no toca el texto', async () => {
    upload.mockRejectedValue(
      new ApiError('CATALOG_CREDENTIALS_INVALID', 'No hay una credencial de escritura utilizable para subir imágenes.', 403),
    )
    render(<Harness initial="Texto intacto" />)
    fireEvent.change(picker(), { target: { files: [png()] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('credencial de escritura')
    expect(area().value).toBe('Texto intacto')
  })

  it('un fallo de red sin respuesta del servidor da un mensaje comprensible', async () => {
    upload.mockRejectedValue(new Error('network'))
    render(<Harness />)
    fireEvent.change(picker(), { target: { files: [png()] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo subir la imagen')
  })

  it('pegar una captura del portapapeles la sube; pegar texto sigue siendo texto', async () => {
    render(<Harness />)
    const pasteEvent = (files: File[]) => ({ clipboardData: { files } })

    fireEvent.paste(area(), pasteEvent([])) // texto normal: no se intercepta
    expect(upload).not.toHaveBeenCalled()

    fireEvent.paste(area(), pasteEvent([png('image.png')]))
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(area().value).toContain('![Descripción de la imagen]('))
  })

  it('arrastrar un archivo de imagen sobre el texto la sube', async () => {
    render(<Harness />)
    fireEvent.drop(area(), { dataTransfer: { files: [png('arrastrada.png')], types: ['Files'] } })
    await waitFor(() => expect(area().value).toContain('![arrastrada]('))
  })

  it('arrastrar algo que no es imagen no sube nada', () => {
    render(<Harness />)
    fireEvent.drop(area(), { dataTransfer: { files: [new File(['x'], 'a.txt', { type: 'text/plain' })], types: ['Files'] } })
    expect(upload).not.toHaveBeenCalled()
  })

  it('si el autor escribe mientras sube, la imagen se inserta sobre el texto más reciente', async () => {
    let resolver: (v: Awaited<ReturnType<typeof uploadLessonImage>>) => void = () => {}
    upload.mockReturnValue(new Promise((r) => (resolver = r)))
    render(<Harness initial="Hola" />)
    area().focus()
    area().setSelectionRange(4, 4)
    fireEvent.change(picker(), { target: { files: [png('esquema.png')] } })

    fireEvent.change(area(), { target: { value: 'Hola, mundo' } }) // sigue escribiendo
    resolver({ url: URL_OK, object_path: 'x', bytes: 10, width: 1, height: 1, content_type: 'image/png' })

    await waitFor(() => expect(area().value).toContain('![esquema]('))
    expect(area().value).toContain('Hola')
    expect(area().value).toContain('mundo') // lo escrito durante la subida NO se pierde
  })
})

describe('Vista previa · imagen que no carga', () => {
  it('sin conexión muestra un aviso con el texto alternativo, no un icono roto', async () => {
    render(<Harness initial={`![Esquema de la caché](${URL_OK})`} />)
    const img = screen.getByTestId('markdown-preview').querySelector('img') as HTMLImageElement
    expect(img).not.toBeNull()

    fireEvent.error(img)

    expect(screen.getByTestId('markdown-preview').querySelector('img')).toBeNull()
    const aviso = screen.getByTestId('markdown-preview').querySelector('.md-img-missing')
    expect(aviso).toHaveTextContent('Imagen no disponible')
    expect(aviso).toHaveTextContent('Esquema de la caché')
  })

  it('una URL de otro host nunca llega a ser <img>', () => {
    render(<Harness initial="![x](https://evil.example/p.png)" />)
    expect(screen.getByTestId('markdown-preview').querySelector('img')).toBeNull()
    expect(screen.getByTestId('markdown-preview').querySelector('.md-img-blocked')).not.toBeNull()
  })
})
