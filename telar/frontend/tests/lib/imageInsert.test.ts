// lib/imageInsert — validar el archivo y meter `![texto](url)` en su propia línea.
import { describe, expect, it } from 'vitest'
import { MAX_IMAGE_BYTES, defaultAltText, imageFileIssue, insertImageMarkdown } from '@/lib/imageInsert'

describe('imageFileIssue', () => {
  it('acepta PNG/JPG/GIF/WebP dentro del tope', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
      expect(imageFileIssue({ type, size: 1000 })).toBeNull()
    }
  })

  it('SVG se rechaza con su motivo; otros formatos, con el aviso general', () => {
    expect(imageFileIssue({ type: 'image/svg+xml', size: 10 })).toMatch(/SVG no se permite/)
    expect(imageFileIssue({ type: 'application/pdf', size: 10 })).toMatch(/Formato no admitido/)
    expect(imageFileIssue({ type: '', size: 10 })).toMatch(/Formato no admitido/)
  })

  it('rechaza lo pesado (con los MB reales) y lo vacío', () => {
    expect(imageFileIssue({ type: 'image/png', size: MAX_IMAGE_BYTES + 1 })).toMatch(/máximo es 2 MB/)
    expect(imageFileIssue({ type: 'image/png', size: 0 })).toMatch(/vacío/)
  })
})

describe('defaultAltText', () => {
  it('nombre del archivo sin extensión ni símbolos', () => {
    expect(defaultAltText('jerarquia-de-memoria.png')).toBe('jerarquia de memoria')
    expect(defaultAltText('Caché_L1.v2.JPG')).toBe('Caché L1 v2')
    expect(defaultAltText('a[b](c)!.gif')).toBe('a b c')
  })

  it('una captura de pantalla no sirve de descripción', () => {
    expect(defaultAltText('Captura de pantalla 2026-11-16 190546.png')).toBe('Descripción de la imagen')
    expect(defaultAltText('image.png')).toBe('Descripción de la imagen')
    expect(defaultAltText('.png')).toBe('Descripción de la imagen')
  })
})

describe('insertImageMarkdown', () => {
  const U = 'https://storage.googleapis.com/b/imagenes/0123456789abcdef0123456789abcdef.png'
  const NL = '\n'

  it('en texto vacío: solo la imagen', () => {
    const r = insertImageMarkdown('', 0, 0, 'x', U)
    expect(r.value).toBe(`![x](${U})${NL}`)
    expect(r.cursor).toBe(`![x](${U})`.length)
  })

  it('en medio de un párrafo: la deja en su propia línea (blancos antes y después)', () => {
    const r = insertImageMarkdown('Hola mundo', 4, 4, 'foto', U)
    expect(r.value).toBe(`Hola${NL}${NL}![foto](${U})${NL}${NL} mundo`)
  })

  it('tras un párrafo ya terminado no duplica los saltos', () => {
    const r = insertImageMarkdown(`Texto${NL}${NL}Sigue`, 7, 7, 'foto', U)
    expect(r.value).toBe(`Texto${NL}${NL}![foto](${U})${NL}${NL}Sigue`)
  })

  it('tras un salto de línea simple añade solo lo que falta', () => {
    const r = insertImageMarkdown(`Texto${NL}Sigue`, 6, 6, 'foto', U)
    expect(r.value).toBe(`Texto${NL}${NL}![foto](${U})${NL}${NL}Sigue`)
  })

  it('reemplaza la selección', () => {
    const r = insertImageMarkdown('uno BORRAR dos', 4, 10, 'foto', U)
    expect(r.value).not.toContain('BORRAR')
    expect(r.value.startsWith('uno')).toBe(true)
    expect(r.value.endsWith('dos')).toBe(true)
  })

  it('los corchetes del texto alternativo no rompen el markdown', () => {
    expect(insertImageMarkdown('', 0, 0, 'a [b] c', U).value).toContain('![a b c](')
  })

  it('el cursor queda justo tras la imagen', () => {
    const r = insertImageMarkdown('Hola mundo', 4, 4, 'foto', U)
    expect(r.value[r.cursor - 1]).toBe(')')
    expect(r.value.slice(0, r.cursor).endsWith(`![foto](${U})`)).toBe(true)
  })
})
