// features/learn/LessonMedia.test.tsx — el bloque grande de la lección es un
// reproductor de video (queja #3, 2026-07): fuente en disco o URL; si no hay,
// placeholder "Video próximamente". Debajo, CTA secundario al simulador.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

// Se mockea SOLO resolveLessonVideo (para forzar ambas ramas); resolveVideoSrc
// queda real para probar su lógica pura.
vi.mock('@/features/learn/lessonVideos', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/learn/lessonVideos')>()
  return { ...actual, resolveLessonVideo: vi.fn() }
})

import { LessonMedia } from '@/features/learn/LessonMedia'
import { resolveLessonVideo, resolveVideoSrc } from '@/features/learn/lessonVideos'

const resolveMock = resolveLessonVideo as Mock

beforeEach(() => resolveMock.mockReset())

function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="loc">{loc.pathname + loc.search}</div>
}

function renderMedia(runDisabled = false) {
  return render(
    <MemoryRouter initialEntries={['/cursos/primerEjemplo']}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <LessonMedia exampleId="primerEjemplo" filename="helloOpenMP.py" runDisabled={runDisabled} />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

describe('resolveVideoSrc (pura)', () => {
  it('URL externa (con esquema) se devuelve tal cual', () => {
    expect(resolveVideoSrc('https://cdn.x/y.mp4')).toBe('https://cdn.x/y.mp4')
  })
  it('ruta en disco se resuelve contra BASE_URL (no absoluta)', () => {
    const out = resolveVideoSrc('media/videos/a.mp4')
    expect(out).toMatch(/\/?media\/videos\/a\.mp4$/)
    expect(out).not.toMatch(/^https?:/)
  })
  it('footgun: doble slash inicial NO se toma como URL, se normaliza a ruta local', () => {
    const out = resolveVideoSrc('//media/videos/a.mp4')
    expect(out).toMatch(/\/?media\/videos\/a\.mp4$/)
    expect(out).not.toMatch(/^\/\//) // no queda como protocol-relative
  })
  it('vacío / undefined → null', () => {
    expect(resolveVideoSrc('')).toBeNull()
    expect(resolveVideoSrc('   ')).toBeNull()
    expect(resolveVideoSrc(undefined)).toBeNull()
  })
})

describe('LessonMedia', () => {
  // C1: sin video NO hay bloque. El placeholder «Video próximamente» se retiró
  // porque, con el mapa de videos vacío, era el primer bloque de las 14
  // lecciones y la pantalla abría mostrando un hueco en vez de la lección.
  it('sin fuente → no renderiza NADA (ni marco, ni placeholder, ni CTA)', () => {
    resolveMock.mockReturnValue(null)
    const { container } = renderMedia()
    expect(container.querySelector('.lesson-media')).toBeNull()
    expect(container.querySelector('video')).toBeNull()
    expect(screen.queryByText('Video próximamente')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Ejecutar en el simulador/ })).not.toBeInTheDocument()
  })

  it('con fuente → <video> con src resuelto, controles, sin autoplay', () => {
    resolveMock.mockReturnValue('https://cdn.x/leccion.mp4')
    const { container } = renderMedia()
    const video = container.querySelector('video.lesson-media-video') as HTMLVideoElement | null
    expect(video).not.toBeNull()
    expect(video).toHaveAttribute('src', 'https://cdn.x/leccion.mp4')
    // Requisitos duros: controles nativos, preload metadata, sin autoplay.
    expect(video).toHaveAttribute('controls')
    expect(video).toHaveAttribute('preload', 'metadata')
    expect(video?.autoplay).toBe(false)
  })

  it('el CTA secundario navega a /simulador con el ejemplo precargado', async () => {
    resolveMock.mockReturnValue('https://cdn.x/leccion.mp4')
    const user = userEvent.setup()
    renderMedia()
    await user.click(screen.getByRole('button', { name: /Ejecutar en el simulador/ }))
    expect(screen.getByTestId('loc')).toHaveTextContent('/simulador?ejemplo=primerEjemplo')
  })

  it('runDisabled deshabilita el CTA al simulador', () => {
    resolveMock.mockReturnValue('https://cdn.x/leccion.mp4')
    renderMedia(true)
    expect(screen.getByRole('button', { name: /Ejecutar en el simulador/ })).toBeDisabled()
  })
})
