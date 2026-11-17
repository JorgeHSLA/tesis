// features/learn/LessonMedia.test.tsx — el video de la lección es un embed de
// YouTube NO LISTADO (una URL, nunca un .mp4 descargado). Dos cosas se prueban
// aquí: (1) que `resolveYouTubeEmbed` normaliza toda forma de URL de YouTube al
// dominio nocookie y RECHAZA cualquier otra cosa —esa URL acabará viniendo del
// catálogo remoto, o sea de contenido no confiable—, y (2) que sin fuente el
// componente no monta nada (C1: la lección no abre con un hueco).
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

// Se mockea SOLO resolveLessonVideo (para forzar ambas ramas del componente);
// resolveYouTubeEmbed queda real para probar su lógica pura.
vi.mock('@/features/learn/lessonVideos', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/learn/lessonVideos')>()
  return { ...actual, resolveLessonVideo: vi.fn() }
})

import { LessonMedia } from '@/features/learn/LessonMedia'
import {
  isPlayingState,
  parsePlayerState,
  resolveLessonVideo,
  resolveYouTubeEmbed,
  withPlayerEvents,
} from '@/features/learn/lessonVideos'

const resolveMock = resolveLessonVideo as Mock
const EMBED = 'https://www.youtube-nocookie.com/embed/'
const ID = 'dQw4w9WgXcQ' // 11 chars, formato real de id de YouTube

beforeEach(() => resolveMock.mockReset())

function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="loc">{loc.pathname + loc.search}</div>
}

function renderMedia(runDisabled = false) {
  return render(
    <MemoryRouter initialEntries={['/aprender/primerEjemplo']}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <LessonMedia
                lessonId="primerEjemplo"
                exampleId="primerEjemplo"
                filename="helloOpenMP.py"
                runDisabled={runDisabled}
              />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

describe('resolveYouTubeEmbed — formas válidas', () => {
  it('watch?v= se normaliza al dominio nocookie', () => {
    expect(resolveYouTubeEmbed(`https://www.youtube.com/watch?v=${ID}`)).toBe(
      `${EMBED}${ID}?rel=0&modestbranding=1`,
    )
  })
  it('acepta la forma corta youtu.be', () => {
    expect(resolveYouTubeEmbed(`https://youtu.be/${ID}`)).toBe(`${EMBED}${ID}?rel=0&modestbranding=1`)
  })
  it('acepta /embed/ ya normalizado (idempotente)', () => {
    const once = resolveYouTubeEmbed(`https://www.youtube.com/embed/${ID}`)
    expect(once).toBe(`${EMBED}${ID}?rel=0&modestbranding=1`)
    expect(resolveYouTubeEmbed(once)).toBe(once)
  })
  it('acepta /shorts/ y el host móvil', () => {
    expect(resolveYouTubeEmbed(`https://m.youtube.com/shorts/${ID}`)).toContain(`${EMBED}${ID}`)
  })
  it('conserva el segundo de arranque de ?t= y ?start=', () => {
    expect(resolveYouTubeEmbed(`https://youtu.be/${ID}?t=90`)).toContain('start=90')
    expect(resolveYouTubeEmbed(`https://www.youtube.com/watch?v=${ID}&start=42`)).toContain('start=42')
  })
  it('ignora un ?t= no numérico en vez de propagarlo', () => {
    expect(resolveYouTubeEmbed(`https://youtu.be/${ID}?t=1m30s`)).toBe(
      `${EMBED}${ID}?rel=0&modestbranding=1`,
    )
  })
})

describe('resolveYouTubeEmbed — entrada no confiable', () => {
  it('rechaza otro host aunque la ruta imite a YouTube', () => {
    expect(resolveYouTubeEmbed(`https://evil.example/watch?v=${ID}`)).toBeNull()
    expect(resolveYouTubeEmbed(`https://youtube.com.evil.example/watch?v=${ID}`)).toBeNull()
  })
  it('rechaza esquemas que no sean https', () => {
    expect(resolveYouTubeEmbed(`http://www.youtube.com/watch?v=${ID}`)).toBeNull()
    expect(resolveYouTubeEmbed('javascript:alert(1)')).toBeNull()
    expect(resolveYouTubeEmbed('data:text/html,<script>alert(1)</script>')).toBeNull()
  })
  it('rechaza un id con formato inválido', () => {
    expect(resolveYouTubeEmbed('https://www.youtube.com/watch?v=corto')).toBeNull()
    expect(resolveYouTubeEmbed('https://www.youtube.com/watch?v=' + 'a'.repeat(12))).toBeNull()
    expect(resolveYouTubeEmbed('https://www.youtube.com/watch?v=tiene/barra')).toBeNull()
  })
  it('rechaza URLs relativas y basura', () => {
    expect(resolveYouTubeEmbed(`//www.youtube.com/watch?v=${ID}`)).toBeNull()
    expect(resolveYouTubeEmbed('media/videos/a.mp4')).toBeNull()
    expect(resolveYouTubeEmbed('no soy una url')).toBeNull()
  })
  it('vacío / undefined → null', () => {
    expect(resolveYouTubeEmbed('')).toBeNull()
    expect(resolveYouTubeEmbed('   ')).toBeNull()
    expect(resolveYouTubeEmbed(undefined)).toBeNull()
    expect(resolveYouTubeEmbed(null)).toBeNull()
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
    expect(container.querySelector('iframe')).toBeNull()
    expect(screen.queryByText('Video próximamente')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Ejecutar en el simulador/ })).not.toBeInTheDocument()
  })

  it('con fuente → <iframe> al dominio nocookie, con nombre accesible', () => {
    resolveMock.mockReturnValue(`${EMBED}${ID}?rel=0&modestbranding=1`)
    const { container } = renderMedia()
    const frame = container.querySelector('iframe.lesson-media-video')
    expect(frame).not.toBeNull()
    // Lleva `enablejsapi=1` para que el reproductor avise de su estado (mini reproductor).
    expect(frame).toHaveAttribute('src', `${EMBED}${ID}?rel=0&modestbranding=1&enablejsapi=1`)
    // El título es el nombre accesible del iframe (WCAG 4.1.2).
    expect(screen.getByTitle('Video de la lección (helloOpenMP.py)')).toBe(frame)
    // Ya no hay <video>: el media no se descarga.
    expect(container.querySelector('video')).toBeNull()
  })

  it('el CTA secundario navega a /simulador con el ejemplo precargado', async () => {
    resolveMock.mockReturnValue(`${EMBED}${ID}`)
    const user = userEvent.setup()
    renderMedia()
    await user.click(screen.getByRole('button', { name: /Ejecutar en el simulador/ }))
    expect(screen.getByTestId('loc')).toHaveTextContent('/simulador?ejemplo=primerEjemplo')
  })

  it('runDisabled deshabilita el CTA al simulador', () => {
    resolveMock.mockReturnValue(`${EMBED}${ID}`)
    renderMedia(true)
    expect(screen.getByRole('button', { name: /Ejecutar en el simulador/ })).toBeDisabled()
  })

  it('la prop videoUrl gana al mapa local (puente hacia el campo de la API)', () => {
    resolveMock.mockReturnValue(null) // el mapa no tiene nada…
    const { container } = render(
      <MemoryRouter>
        <LessonMedia
          lessonId="primerEjemplo"
          exampleId="primerEjemplo"
          filename="helloOpenMP.py"
          runDisabled={false}
          videoUrl={`https://youtu.be/${ID}`}
        />
      </MemoryRouter>,
    )
    // …y aun así hay iframe, porque la URL llegó por prop.
    expect(container.querySelector('iframe')).toHaveAttribute('src', `${EMBED}${ID}?rel=0&modestbranding=1&enablejsapi=1`)
  })
})

describe('estado del reproductor (postMessage de YouTube)', () => {
  it('withPlayerEvents añade enablejsapi=1 sin tocar el resto', () => {
    expect(withPlayerEvents(`${EMBED}${ID}?rel=0&modestbranding=1&start=30`)).toBe(
      `${EMBED}${ID}?rel=0&modestbranding=1&start=30&enablejsapi=1`,
    )
  })

  it('parsePlayerState entiende onStateChange e infoDelivery (objeto o texto JSON)', () => {
    expect(parsePlayerState({ event: 'onStateChange', info: 1 })).toBe(1)
    expect(parsePlayerState(JSON.stringify({ event: 'infoDelivery', info: { playerState: 2 } }))).toBe(2)
    expect(parsePlayerState({ event: 'infoDelivery', info: { playerState: -1 } })).toBe(-1)
  })

  it('parsePlayerState descarta lo que no es un estado', () => {
    expect(parsePlayerState('no es json')).toBeNull()
    expect(parsePlayerState(null)).toBeNull()
    expect(parsePlayerState(42)).toBeNull()
    expect(parsePlayerState({ event: 'onReady' })).toBeNull()
    expect(parsePlayerState({ event: 'infoDelivery', info: { currentTime: 3 } })).toBeNull()
    expect(parsePlayerState({ event: 'onStateChange', info: '1' })).toBeNull()
  })

  it('isPlayingState: solo reproduciendo (1) o cargando (3)', () => {
    expect([-1, 0, 1, 2, 3, 5].map(isPlayingState)).toEqual([false, false, true, false, true, false])
  })
})
