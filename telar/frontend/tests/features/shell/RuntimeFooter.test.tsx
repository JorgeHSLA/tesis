// RuntimeFooter — punto de estado pulsable + panel de acciones del runtime.
//
// REGRESIÓN QUE FIJA ESTA SUITE (2026-08-26): el botón `Levantar` vivía dentro
// de `.sidebar-footer-text`, que el rediseño del rail dejó en `display: none`
// permanente — el control existía en el DOM pero NADIE podía verlo ni pulsarlo,
// en Windows y en Linux. Un test que solo comprobara «el botón está en el DOM»
// habría pasado igualmente, así que aquí se afirma lo que de verdad importa:
// que el disparador es un botón accesible por su rol y su nombre, y que las
// acciones aparecen tras interactuar con él.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('@/api/system', () => ({
  getSystem: vi.fn().mockResolvedValue({ cores: 8 }),
  getHealth: vi.fn().mockResolvedValue({ status: 'ok' }),
}))

import { getSystem } from '@/api/system'
import { RuntimeFooter } from '@/components/shell/RuntimeFooter'
import { loadSystemInfo } from '@/hooks/useSystemInfo'

const getSystemMock = getSystem as Mock
const BACKEND_OK = { service: 'backend', state: 'running', health: 'healthy' }

function setDesktop(services: { state: string; service?: string }[], extra: Record<string, unknown> = {}) {
  const api = {
    dockerStatus: vi.fn().mockResolvedValue({ ok: true, services }),
    dockerUp: vi.fn().mockResolvedValue({ ok: true }),
    dockerStop: vi.fn().mockResolvedValue({ ok: true }),
    ...extra,
  }
  ;(window as { telar?: unknown }).telar = api
  return api
}

beforeEach(() => {
  vi.clearAllMocks()
  getSystemMock.mockResolvedValue({ cores: 8 })
})

afterEach(() => {
  delete (window as { telar?: unknown }).telar
})

describe('RuntimeFooter (desktop)', () => {
  it('el punto de estado es un BOTÓN alcanzable por rol y nombre', async () => {
    setDesktop([])
    render(<RuntimeFooter />)
    // El nombre accesible lleva el estado: sirve de tooltip y de etiqueta.
    const trigger = await screen.findByRole('button', { name: /servicios detenidos/i })
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('con los servicios caídos, al abrir el panel ofrece «Levantar» y lo invoca', async () => {
    const api = setDesktop([])
    render(<RuntimeFooter />)

    const trigger = await screen.findByRole('button', { name: /servicios detenidos/i })
    expect(screen.queryByRole('button', { name: 'Levantar' })).toBeNull() // cerrado por defecto

    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    const levantar = await screen.findByRole('button', { name: 'Levantar' })
    fireEvent.click(levantar)
    await waitFor(() => expect(api.dockerUp).toHaveBeenCalled())
  })

  it('con los servicios arriba ofrece «Detener» (dockerStop, antes sin UI)', async () => {
    const api = setDesktop([BACKEND_OK, { service: 'web', state: 'running' }])
    render(<RuntimeFooter />)

    const trigger = await screen.findByRole('button', { name: /2 contenedores activos/i })
    fireEvent.click(trigger)

    expect(screen.queryByRole('button', { name: 'Levantar' })).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: 'Detener' }))
    await waitFor(() => expect(api.dockerStop).toHaveBeenCalled())
  })

  it('Escape cierra el panel y devuelve el foco al disparador', async () => {
    setDesktop([])
    render(<RuntimeFooter />)
    const trigger = await screen.findByRole('button', { name: /servicios detenidos/i })

    fireEvent.click(trigger)
    await screen.findByRole('dialog')

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(trigger).toHaveFocus()
  })

  it('un fallo de dockerUp se muestra dentro del panel', async () => {
    setDesktop([], { dockerUp: vi.fn().mockResolvedValue({ ok: false, error: 'daemon caído' }) })
    render(<RuntimeFooter />)

    fireEvent.click(await screen.findByRole('button', { name: /servicios detenidos/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Levantar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('daemon caído')
  })
})

describe('RuntimeFooter (desktop) · causas y runner', () => {
  it('CU-27.4: sin Docker muestra la causa saneada en el panel', async () => {
    setDesktop([], {
      dockerStatus: vi.fn().mockResolvedValue({ ok: false, services: [], error: 'permiso denegado en docker.sock' }),
    })
    render(<RuntimeFooter />)
    const trigger = await screen.findByRole('button', { name: /Docker no disponible/i })
    fireEvent.click(trigger)
    expect(await screen.findByRole('alert')).toHaveTextContent('permiso denegado en docker.sock')
  })

  it('CU-27.3: con el backend listo pero sin imagen del runner ofrece «Reintentar preparación»', async () => {
    getSystemMock.mockResolvedValue({ cores: 8, runner_image_present: false })
    await loadSystemInfo(true)
    const api = setDesktop([BACKEND_OK])
    render(<RuntimeFooter />)

    const trigger = await screen.findByRole('button', { name: /falta la imagen del runner/i })
    fireEvent.click(trigger)
    const reintentar = await screen.findByRole('button', { name: 'Reintentar preparación' })
    const before = getSystemMock.mock.calls.length
    getSystemMock.mockResolvedValue({ cores: 8, runner_image_present: true })
    fireEvent.click(reintentar)
    await waitFor(() => expect(api.dockerUp).toHaveBeenCalled())
    // Tras preparar, /system se vuelve a consultar y el aviso desaparece.
    await waitFor(() => expect(getSystemMock.mock.calls.length).toBeGreaterThan(before))
    await screen.findByRole('button', { name: /1 contenedores activos/i })
    expect(screen.queryByRole('button', { name: 'Reintentar preparación' })).toBeNull()
  })
})

describe('RuntimeFooter (web)', () => {
  it('sin window.telar no ofrece acciones de Docker', async () => {
    render(<RuntimeFooter />)
    const trigger = await screen.findByRole('button', { name: /Backend Telar/i })
    fireEvent.click(trigger)

    await screen.findByRole('dialog')
    expect(screen.queryByRole('button', { name: 'Levantar' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Detener' })).toBeNull()
  })
})
