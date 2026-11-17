// ExamplePicker — solo ofrece módulos que TIENEN ejemplos para correr. Un módulo
// teórico (sin ejemplos) no aparece como un grupo vacío; cuando se le agregue un
// ejemplo, aparece solo.
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ModuleDto } from '@/api/types'
import { ExamplePicker } from '@/features/simulator/ExamplePicker'

const lesson = (id: string, example_id: string | null, enabled = true) =>
  ({ id, order: 1, title: `Lección ${id}`, example_id, has_quiz: true, has_video: false, enabled }) as ModuleDto['lessons'][number]

const mod = (id: string, order: number, lessons: ModuleDto['lessons']): ModuleDto =>
  ({ id, order, title: `Módulo ${id}`, description: '', level: 'Básico', version: 1, origin: 'remote', update_available: null, lessons }) as ModuleDto

const MODULES = [
  mod('teoria', 100, [lesson('t1', null), lesson('t2', null)]), // solo teoría
  mod('codigo', 300, [lesson('c1', 'ejemplo1'), lesson('c2', null)]),
  mod('gpu', 480, [lesson('g1', 'ejemploGpu', false)]),
]

describe('ExamplePicker', () => {
  it('un módulo sin ejemplos NO sale (ni como grupo vacío)', () => {
    render(<ExamplePicker modules={MODULES} value="" onChange={vi.fn()} />)
    const grupos = Array.from(document.querySelectorAll('optgroup')).map((g) => g.label)
    expect(grupos).toEqual(['M300 · Módulo codigo', 'M480 · Módulo gpu'])
    expect(screen.queryByText(/Módulo teoria/)).toBeNull()
  })

  it('dentro de un módulo solo salen las lecciones con ejemplo', () => {
    render(<ExamplePicker modules={MODULES} value="" onChange={vi.fn()} />)
    expect(screen.getByRole('option', { name: 'Lección c1' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Lección c2' })).toBeNull()
  })

  it('el ejemplo que requiere GPU sigue visible pero deshabilitado', () => {
    render(<ExamplePicker modules={MODULES} value="" onChange={vi.fn()} />)
    expect(screen.getByRole('option', { name: /Lección g1 — requiere GPU/ })).toBeDisabled()
  })

  it('«Código propio» siempre está', () => {
    render(<ExamplePicker modules={[mod('teoria', 100, [lesson('t1', null)])]} value="" onChange={vi.fn()} />)
    expect(screen.getByRole('option', { name: 'Código propio (editor)' })).toBeInTheDocument()
    expect(document.querySelectorAll('optgroup')).toHaveLength(0)
  })

  it('cuando un módulo teórico recibe un ejemplo, aparece', () => {
    const { rerender } = render(<ExamplePicker modules={[mod('m', 100, [lesson('a', null)])]} value="" onChange={vi.fn()} />)
    expect(document.querySelectorAll('optgroup')).toHaveLength(0)
    rerender(<ExamplePicker modules={[mod('m', 100, [lesson('a', 'nuevoEjemplo')])]} value="" onChange={vi.fn()} />)
    expect(document.querySelectorAll('optgroup')).toHaveLength(1)
  })
})
