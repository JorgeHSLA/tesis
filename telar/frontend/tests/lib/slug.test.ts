// tests/lib/slug.test.ts — identificador (PK) autogenerado de un módulo.
// Cubre acentos, espacios, símbolos, colisión y título que empieza por número.
import { describe, expect, it } from 'vitest'
import { slugify, uniqueSlug } from '@/lib/slug'

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/

describe('slugify', () => {
  it('normaliza acentos y diacríticos (NFD)', () => {
    expect(slugify('Memoria compartida')).toBe('memoria-compartida')
    expect(slugify('Introducción')).toBe('introduccion')
    expect(slugify('Programación paralela ñ')).toBe('programacion-paralela-n')
  })

  it('colapsa espacios y separadores repetidos y recorta los bordes', () => {
    expect(slugify('  Hola   Mundo  ')).toBe('hola-mundo')
    expect(slugify('a---b')).toBe('a-b')
    expect(slugify('-borde-')).toBe('borde')
  })

  it('convierte símbolos no alfanuméricos en un único separador', () => {
    expect(slugify('C/C++ & OpenMP!')).toBe('c-c-openmp')
    expect(slugify('foo@bar.baz')).toBe('foo-bar-baz')
  })

  it('garantiza letra inicial cuando el título empieza por número', () => {
    expect(slugify('123 hilos')).toBe('m-123-hilos')
    expect(slugify('42')).toBe('m-42')
  })

  it('cae a "modulo" cuando no queda nada utilizable', () => {
    expect(slugify('')).toBe('modulo')
    expect(slugify('   ')).toBe('modulo')
    expect(slugify('!!!')).toBe('modulo')
  })

  it('recorta a 64 caracteres y cumple SIEMPRE el patrón del backend', () => {
    const long = slugify('palabra '.repeat(20))
    expect(long.length).toBeLessThanOrEqual(64)
    expect(long.endsWith('-')).toBe(false)
    for (const title of ['Memoria compartida', '123', 'Ñoño äéîõü', '', 'x'.repeat(200)]) {
      expect(ID_PATTERN.test(slugify(title))).toBe(true)
    }
  })
})

describe('uniqueSlug', () => {
  it('devuelve la base intacta cuando no colisiona', () => {
    expect(uniqueSlug('intro', ['spmd', 'memoria'])).toBe('intro')
    expect(uniqueSlug('intro', [])).toBe('intro')
  })

  it('sufija -2, -3… ante colisiones sucesivas', () => {
    expect(uniqueSlug('intro', ['intro'])).toBe('intro-2')
    expect(uniqueSlug('intro', ['intro', 'intro-2'])).toBe('intro-3')
    expect(uniqueSlug('intro', ['intro', 'intro-2', 'intro-3'])).toBe('intro-4')
  })

  it('respeta el máximo de 64 al añadir el sufijo', () => {
    const base = 'a'.repeat(64)
    const out = uniqueSlug(base, [base])
    expect(out.length).toBeLessThanOrEqual(64)
    expect(out.endsWith('-2')).toBe(true)
    expect(ID_PATTERN.test(out)).toBe(true)
  })
})
