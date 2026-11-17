// Claridad de las gráficas de Resultados (pruebas de usabilidad): ejes con título,
// leyenda que dice qué es cada serie, tabla con los valores de cada punto y una
// frase que lee la comparación en lugar de dejarla a la intuición.
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ComparisonBars } from '@/components/viz/ComparisonBars'
import { SpeedupChart } from '@/components/viz/SpeedupChart'

const SERIES = [
  { threads: 1, time_s: 4.0, speedup: 1.0, efficiency: 1.0 },
  { threads: 2, time_s: 2.2, speedup: 1.82, efficiency: 0.91 },
  { threads: 4, time_s: 1.3, speedup: 3.08, efficiency: 0.77 },
  { threads: 8, time_s: 0.95, speedup: 4.21, efficiency: 0.53 },
]

describe('SpeedupChart', () => {
  it('la leyenda explica cada línea con palabras', () => {
    render(<SpeedupChart series={SERIES} />)
    expect(screen.getByText(/medido en tu ejecución/)).toBeInTheDocument()
    expect(screen.getByText(/ideal \(reparto perfecto\)/)).toBeInTheDocument()
  })

  it('los dos ejes llevan título', () => {
    const { container } = render(<SpeedupChart series={SERIES} />)
    const svg = container.querySelector('svg') as SVGElement
    expect(svg.textContent).toContain('veces más rápido que con 1 hilo')
    expect(svg.textContent).toContain('hilos usados en cada prueba')
  })

  it('la tabla trae tiempo, speedup y eficiencia de CADA prueba', () => {
    render(<SpeedupChart series={SERIES} />)
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Hilos',
      'Tiempo',
      'Speedup',
      'Eficiencia',
    ])
    const fila8 = within(table).getByRole('rowheader', { name: '8' }).closest('tr') as HTMLElement
    expect(fila8).toHaveTextContent('0.950 s')
    expect(fila8).toHaveTextContent('4.21×')
    expect(fila8).toHaveTextContent('53%')
    expect(within(table).getAllByRole('row')).toHaveLength(SERIES.length + 1) // + encabezado
  })

  it('ordena por hilos aunque lleguen desordenados', () => {
    render(<SpeedupChart series={[SERIES[3], SERIES[0], SERIES[2], SERIES[1]]} />)
    const headers = within(screen.getByRole('table')).getAllByRole('rowheader').map((h) => h.textContent)
    expect(headers).toEqual(['1', '2', '4', '8'])
  })

  it('un tiempo largo se escribe con un decimal', () => {
    render(<SpeedupChart series={[{ threads: 1, time_s: 12.345, speedup: 1, efficiency: 1 }]} />)
    expect(screen.getByRole('table')).toHaveTextContent('12.3 s')
  })

  it('la tabla tiene su «?» de ayuda', () => {
    render(<SpeedupChart series={SERIES} />)
    expect(screen.getByRole('button', { name: 'Ayuda: la tabla de valores' })).toBeInTheDocument()
  })
})

describe('ComparisonBars', () => {
  it('nombres comprensibles en lugar de «openmp» / «numpy» a secas', () => {
    render(<ComparisonBars parallel_time_s={0.5} reference_time_s={2} reference_label="numpy" />)
    expect(screen.getAllByText('OpenMP (paralelo)').length).toBeGreaterThan(0)
    expect(screen.getAllByText('NumPy (referencia)').length).toBeGreaterThan(0)
  })

  it('lee la comparación: «X× más rápido»', () => {
    render(<ComparisonBars parallel_time_s={0.5} reference_time_s={2} reference_label="serial" />)
    expect(screen.getByText(/OpenMP fue 4\.0× más rápido que Serial \(1 hilo\)/)).toBeInTheDocument()
  })

  it('si el paralelo salió más lento lo dice, con el porqué', () => {
    render(<ComparisonBars parallel_time_s={2} reference_time_s={0.5} reference_label="blas" />)
    expect(screen.getByText(/4\.0× más lento que BLAS/)).toHaveTextContent('crear el equipo de hilos cuesta')
  })

  it('una etiqueta de referencia desconocida se muestra tal cual', () => {
    render(<ComparisonBars parallel_time_s={1} reference_time_s={1} reference_label="otra" />)
    expect(screen.getAllByText('otra').length).toBeGreaterThan(0)
  })
})
