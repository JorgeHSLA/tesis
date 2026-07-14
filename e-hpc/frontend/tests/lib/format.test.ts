// Cobertura de src/lib: format.ts — formateadores compartidos (§1, §8.4).
import { describe, expect, it } from 'vitest'
import { decimate, decimateNumbers, fmtBytes, fmtPct, fmtRelative, fmtTime, fmtTimeMs } from '@/lib/format'

describe('fmtTime / fmtTimeMs', () => {
  it('formatea m + ss con 2 dígitos', () => {
    expect(fmtTime(134)).toBe('2m 14s')
    expect(fmtTime(35)).toBe('0m 35s')
    expect(fmtTime(-5)).toBe('0m 00s')
  })
  it('fmtTimeMs convierte ms', () => {
    expect(fmtTimeMs(8727)).toBe('0m 08s')
    expect(fmtTimeMs(134000)).toBe('2m 14s')
  })
})

describe('fmtBytes', () => {
  it('escala B/KB/MB/GB con dígitos adaptativos', () => {
    expect(fmtBytes(512)).toBe('512 B')
    expect(fmtBytes(1536)).toBe('1.50 KB')
    expect(fmtBytes(5 * 1024 * 1024)).toBe('5.00 MB')
    expect(fmtBytes(150 * 1024 * 1024)).toBe('150 MB')
    expect(fmtBytes(1024 ** 3)).toBe('1.00 GB')
  })
  it('valores inválidos → em dash', () => {
    expect(fmtBytes(-1)).toBe('—')
    expect(fmtBytes(Number.NaN)).toBe('—')
  })
})

describe('fmtPct', () => {
  it('formatea porcentaje (permite >100)', () => {
    expect(fmtPct(792.4, 1)).toBe('792.4%')
    expect(fmtPct(43)).toBe('43%')
    expect(fmtPct(Number.NaN)).toBe('—')
  })
})

describe('fmtRelative', () => {
  const now = new Date('2026-07-12T12:00:00Z')
  it('ahora / min / h / d en español', () => {
    expect(fmtRelative('2026-07-12T11:59:30Z', now)).toBe('ahora')
    expect(fmtRelative('2026-07-12T11:55:00Z', now)).toBe('hace 5 min')
    expect(fmtRelative('2026-07-12T10:00:00Z', now)).toBe('hace 2 h')
    expect(fmtRelative('2026-07-10T12:00:00Z', now)).toBe('hace 2 d')
  })
  it('fecha inválida → em dash', () => {
    expect(fmtRelative('no-fecha', now)).toBe('—')
  })
})

describe('decimate / decimateNumbers', () => {
  it('devuelve copia si items <= target', () => {
    expect(decimateNumbers([1, 2, 3], 10)).toEqual([1, 2, 3])
  })
  it('promedia por bucket al reducir', () => {
    const out = decimateNumbers([0, 2, 4, 6, 8, 10], 3)
    expect(out).toHaveLength(3)
    expect(out).toEqual([1, 5, 9])
  })
  it('target<=0 → copia', () => {
    expect(decimate([1, 2], 0, (b) => b[0])).toEqual([1, 2])
  })
})
