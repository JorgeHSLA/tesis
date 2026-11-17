// Las explicaciones del editor de lecciones viven en un «?» y no como frases fijas
// bajo cada campo: ocupan sitio solo cuando se piden.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/api/admin', () => ({ uploadLessonImage: vi.fn() }))

import { MarkdownEditor } from '@/features/admin/lesson/MarkdownEditor'
import { SourcesEditor } from '@/features/admin/lesson/SourcesEditor'

describe('ayudas del editor de lecciones', () => {
  it('el contenido ya no lleva la frase fija «Subset soportado…»', () => {
    render(<MarkdownEditor value="" onChange={() => {}} />)
    expect(screen.queryByText(/Subset soportado/)).toBeNull()
  })

  it('su «?» explica la sintaxis, las imágenes y lo que no se puede', () => {
    render(<MarkdownEditor value="" onChange={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda: cómo escribir el contenido' }))
    const nota = screen.getByRole('note')
    expect(nota).toHaveTextContent('Insertar imagen')
    expect(nota).toHaveTextContent('2 MB')
    expect(nota).toHaveTextContent('No se puede')
    expect(nota).toHaveTextContent('Fuentes')
  })

  it('un error de validación sigue viéndose sin abrir nada', () => {
    render(<MarkdownEditor value="" onChange={() => {}} error="línea demasiado larga" />)
    expect(screen.getByRole('alert')).toHaveTextContent('línea demasiado larga')
  })

  it('las fuentes ya no llevan la frase fija «Van aquí…»', () => {
    render(<SourcesEditor rows={[]} onChange={() => {}} />)
    expect(screen.queryByText(/Van aquí, no en el contenido/)).toBeNull()
  })

  it('su «?» dice qué ve el estudiante y qué lleva cada campo', () => {
    render(<SourcesEditor rows={[]} onChange={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda: las fuentes de la lección' }))
    const nota = screen.getByRole('note')
    expect(nota).toHaveTextContent('Qué ve el estudiante')
    expect(nota).toHaveTextContent('https://')
    expect(nota).toHaveTextContent('Título del enlace')
  })
})
