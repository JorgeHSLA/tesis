// LessonSources — etiquetas arriba; al enfocar/pasar el cursor, cita + enlace.
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LessonSources } from '@/features/learn/LessonSources'
import type { LessonSource } from '@/lib/lessonSources'

const FUENTES: LessonSource[] = [
  {
    label: 'OpenMP API Specification 5.2',
    citation: 'OpenMP ARB, OpenMP API Specification 5.2: constructos task y taskwait.',
    links: [{ text: 'OpenMP API Specification 5.2', url: 'https://www.openmp.org/spec-html/5.2/openmp.html' }],
  },
  { label: 'Solo cita', citation: 'Solo cita, sin enlace.', links: [] },
]

describe('LessonSources', () => {
  it('sin fuentes no pinta nada', () => {
    const { container } = render(<LessonSources sources={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('cada fuente es una etiqueta; con enlace, abre el primero en pestaña nueva y segura', () => {
    const { container } = render(<LessonSources sources={FUENTES} />)
    expect(screen.getByLabelText('Fuentes de esta lección')).toBeInTheDocument()
    const chip = container.querySelector('a.lesson-source-chip') as HTMLElement
    expect(chip).toHaveTextContent('OpenMP API Specification 5.2')
    expect(chip).toHaveAttribute('href', 'https://www.openmp.org/spec-html/5.2/openmp.html')
    expect(chip).toHaveAttribute('target', '_blank')
    expect(chip.getAttribute('rel')).toContain('noopener')
  })

  it('el desplegable lleva la cita completa y la opción de abrir cada enlace', () => {
    const { container } = render(<LessonSources sources={FUENTES} />)
    const tips = screen.getAllByRole('tooltip', { hidden: true })
    expect(tips[0]).toHaveTextContent('OpenMP ARB, OpenMP API Specification 5.2: constructos task y taskwait.')
    expect(tips[0]).toHaveTextContent('openmp.org')
    const open = tips[0].querySelector('a.lesson-source-open')
    expect(open).toHaveAttribute('href', 'https://www.openmp.org/spec-html/5.2/openmp.html')
    // La etiqueta se describe con su desplegable (a11y para teclado y lector).
    expect(container.querySelector('a.lesson-source-chip')).toHaveAttribute('aria-describedby', tips[0].id)
  })

  it('una fuente sin enlace sigue siendo enfocable con teclado', () => {
    render(<LessonSources sources={FUENTES} />)
    const chip = screen.getByText('Solo cita', { selector: '.lesson-source-chip' })
    expect(chip).toHaveAttribute('tabindex', '0')
    expect(chip.tagName).toBe('SPAN')
  })
})
