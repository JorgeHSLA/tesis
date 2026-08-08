// themeColors — parseo de color, derivación de tonos y lectura de tokens.
// Es la pieza que garantiza el criterio "las animaciones usan la paleta de la
// app": si esto falla, un <canvas> podría pintar con colores inventados.
import { describe, expect, it } from 'vitest'
import { mix, readThemeColors, shade, toHex, toRgb, withAlpha } from '../../src/lib/themeColors'

describe('toRgb', () => {
  it('parsea hex de 6 dígitos', () => {
    expect(toRgb('#A8501E')).toEqual({ r: 0xa8, g: 0x50, b: 0x1e })
  })

  it('parsea hex de 3 dígitos expandiendo cada nibble', () => {
    expect(toRgb('#abc')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc })
  })

  it('ignora el canal alfa del hex de 8 dígitos', () => {
    expect(toRgb('#11223344')).toEqual({ r: 0x11, g: 0x22, b: 0x33 })
  })

  it('parsea rgb() y rgba() con coma o espacio', () => {
    expect(toRgb('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30 })
    expect(toRgb('rgba(10 20 30 / .5)')).toEqual({ r: 10, g: 20, b: 30 })
  })

  it('tolera espacios alrededor', () => {
    expect(toRgb('  #FFFFFF  ')).toEqual({ r: 255, g: 255, b: 255 })
  })

  it('cae en negro ante un color no parseable (jsdom no trae canvas)', () => {
    expect(toRgb('no-es-un-color')).toEqual({ r: 0, g: 0, b: 0 })
  })
})

describe('toHex', () => {
  it('redondea y rellena a dos dígitos', () => {
    expect(toHex({ r: 0, g: 5, b: 254.6 })).toBe('#0005ff')
  })

  it('satura fuera de rango en vez de desbordar', () => {
    expect(toHex({ r: -20, g: 300, b: 128 })).toBe('#00ff80')
  })
})

describe('mix', () => {
  it('t=0 devuelve el primer color y t=1 el segundo', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000')
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff')
  })

  it('interpola linealmente por canal', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
  })

  it('satura t fuera de [0,1]', () => {
    expect(mix('#000000', '#ffffff', 5)).toBe('#ffffff')
    expect(mix('#000000', '#ffffff', -5)).toBe('#000000')
  })
})

describe('shade', () => {
  it('con amount positivo aclara hacia blanco', () => {
    expect(shade('#808080', 1)).toBe('#ffffff')
  })

  it('con amount negativo oscurece hacia negro', () => {
    expect(shade('#808080', -1)).toBe('#000000')
  })

  it('amount 0 no cambia el color', () => {
    expect(shade('#123456', 0)).toBe('#123456')
  })
})

describe('withAlpha', () => {
  it('produce rgba() con el alfa dado', () => {
    expect(withAlpha('#A8501E', 0.3)).toBe('rgba(168, 80, 30, 0.3)')
  })

  it('satura el alfa a [0,1]', () => {
    expect(withAlpha('#000000', 9)).toBe('rgba(0, 0, 0, 1)')
    expect(withAlpha('#000000', -9)).toBe('rgba(0, 0, 0, 0)')
  })
})

describe('readThemeColors', () => {
  const TOKENS = { accent: '--accent', node: '--viz-node' } as const

  it('resuelve los tokens del elemento indicado', () => {
    const host = document.createElement('div')
    host.style.setProperty('--accent', '#A8501E')
    host.style.setProperty('--viz-node', '#82664E')
    document.body.appendChild(host)

    expect(readThemeColors(TOKENS, host)).toEqual({ accent: '#A8501E', node: '#82664E' })

    host.remove()
  })

  it('usa el fallback cuando el token no está declarado', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)

    expect(readThemeColors(TOKENS, host, '#ff00ff')).toEqual({
      accent: '#ff00ff',
      node: '#ff00ff',
    })

    host.remove()
  })

  it('devuelve el fallback para TODAS las claves si no hay elemento', () => {
    expect(readThemeColors(TOKENS, null, '#123456')).toEqual({
      accent: '#123456',
      node: '#123456',
    })
  })

  it('mantiene exactamente el juego de claves del TokenMap', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)

    expect(Object.keys(readThemeColors(TOKENS, host)).sort()).toEqual(['accent', 'node'])

    host.remove()
  })
})
