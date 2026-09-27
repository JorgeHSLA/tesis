// field-errors — los dos formatos de 422 se posicionan junto a su campo
// (CU-06.3, 13.3, 14.3, 17.4, 18.5, 21.3): {field, reason} de las reglas de
// negocio y {type, loc, msg} de pydantic (con el mensaje en español).
import { describe, expect, it } from 'vitest'
import { ApiError } from '@/api/client'
import {
  changedFields,
  clearFieldErrors,
  parseContentErrors,
  REVIEW_FIELDS_BANNER,
  visibleBanner,
} from '@/features/admin/field-errors'

const err422 = (details: unknown) =>
  new ApiError('VALIDATION_ERROR', 'El cuerpo o los parámetros de la petición no son válidos.', 422, details)

describe('parseContentErrors · pydantic {type, loc, msg}', () => {
  it('quita el prefijo body y traduce el tipo', () => {
    const r = parseContentErrors(
      err422([
        { type: 'string_too_short', loc: ['body', 'title'], msg: 'String should have at least 1 character' },
        { type: 'greater_than_equal', loc: ['body', 'estimated_minutes'], msg: 'Input should be >= 1' },
      ]),
      ['title', 'estimated_minutes'],
    )
    expect(r.byField).toEqual({
      title: 'Este campo no puede quedar vacío.',
      estimated_minutes: 'El valor es menor que el mínimo permitido.',
    })
    expect(r.banner).toBeNull()
  })

  it('un campo anidado conserva su ruta y los índices de lista se omiten', () => {
    const r = parseContentErrors(
      err422([
        { type: 'string_pattern_mismatch', loc: ['example', 'filename'], msg: 'x' },
        { type: 'too_short', loc: ['body', 'takeaways'], msg: 'x' },
        { type: 'missing', loc: ['body', 'takeaways', 0], msg: 'x' },
      ]),
      ['example.filename', 'takeaways'],
    )
    expect(r.byField['example.filename']).toBe('El formato no es válido.')
    expect(r.byField.takeaways).toBe('Debe tener al menos un elemento.')
  })

  it('lo que no tiene control va al banner nombrando el campo', () => {
    const r = parseContentErrors(
      err422([{ type: 'int_parsing', loc: ['body', 'questions', 1, 'order'], msg: 'x' }]),
      ['title'],
    )
    expect(r.byField).toEqual({})
    expect(r.banner).toBe('questions.order: Debe ser un número entero.')
  })

  it('un tipo desconocido usa un mensaje genérico', () => {
    const r = parseContentErrors(err422([{ type: 'raro', loc: ['body', 'level'], msg: 'x' }]), ['level'])
    expect(r.byField.level).toBe('El valor no es válido.')
  })

  it('el formato {field, reason} sigue igual', () => {
    const r = parseContentErrors(
      new ApiError('CONTENT_VALIDATION_ERROR', 'x', 422, [{ field: 'completion_rule', reason: 'Necesita quiz.' }]),
      ['completion_rule'],
    )
    expect(r.byField).toEqual({ completion_rule: 'Necesita quiz.' })
  })
})

describe('errores que se van al editar', () => {
  it('clearFieldErrors quita solo los campos editados y conserva el objeto si no había nada', () => {
    const errs = { title: 'a', order: 'b' }
    expect(clearFieldErrors(errs, ['title'])).toEqual({ order: 'b' })
    expect(clearFieldErrors(errs, ['level'])).toBe(errs)
    expect(errs).toEqual({ title: 'a', order: 'b' })
  })

  it('changedFields compara superficialmente y antepone el prefijo', () => {
    expect(changedFields({ a: 1, b: 2 }, { a: 1, b: 3 }, 'example.')).toEqual(['example.b'])
  })

  it('visibleBanner oculta solo el resumen de campos marcados cuando no queda ninguno', () => {
    expect(visibleBanner(REVIEW_FIELDS_BANNER, {})).toBeNull()
    expect(visibleBanner(REVIEW_FIELDS_BANNER, { title: 'x' })).toBe(REVIEW_FIELDS_BANNER)
    expect(visibleBanner('Otro fallo', {})).toBe('Otro fallo')
  })
})
