// features/catalog/CatalogScreen.test.tsx — el aviso de actualizaciones de
// `/cursos` y, sobre todo, LO QUE NO PUEDE PASAR: que el catálogo remoto
// bloquee la pantalla del curso.
//
// El primero es el test que importa. `/cursos` es la pantalla donde el
// estudiante estudia; convertirla en un `ErrorState` porque un bucket de GCS no
// responde sería un fallo de producto, no de red (§11.0.8). Y es justo la clase
// de regresión que se cuela sin que nadie la note, porque en desarrollo el
// bucket siempre contesta: el día que deje de hacerlo, este test lo dice.
//
// Los fixtures de catálogo se construyen aquí y no en `tests/fixtures/rest.ts`
// a propósito: ese archivo es compartido y hay agentes trabajándolo en paralelo.
import { MemoryRouter } from 'react-router-dom'
import { render, screen, waitFor, within } from '@testing-library/react'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import CatalogScreen from '@/features/catalog/CatalogScreen'
import type { CatalogStatusResponseDto, InstalledModuleStatusDto } from '@/api/catalog-types'
import type { ModuleDto, ModulesResponseDto } from '@/api/types'
import { useCatalogStore } from '@/stores/catalogStore'
import { useProgressStore } from '@/stores/progressStore'
import { MODULES, SYSTEM_INFO, envelope, errorEnvelope, jsonResponse } from '../../fixtures/rest'

// ─────────────────────────── fixtures locales ───────────────────────────────

const M2 = MODULES.modules[0]

/** Segundo módulo, de origen REMOTO: es el que puede tener versión nueva. */
const M9: ModuleDto = {
  ...M2,
  id: 'm9',
  order: 9,
  title: 'Reducciones avanzadas',
  description: 'Reducciones definidas por el usuario sobre estructuras propias.',
  version: 2,
  origin: 'remote',
  update_available: null,
  lessons: [
    { ...M2.lessons[0], id: 'reduccionCustom', order: 1, title: 'Reducción a medida' },
  ],
}

const DOS_MODULOS: ModulesResponseDto = { ...MODULES, modules: [M2, M9] }

/** Fila de `/catalog/status`. Por defecto, un módulo LOCAL sin nada pendiente. */
function instalado(over: Partial<InstalledModuleStatusDto> = {}): InstalledModuleStatusDto {
  return {
    module_id: 'm2',
    title: 'Patrón SPMD y false sharing',
    origin: 'local',
    state: 'local_only',
    installed_version: 1,
    installed_checksum: null,
    available_version: null,
    available_checksum: null,
    object_path: null,
    installed_at: null,
    updated_at: null,
    last_checked_at: null,
    lessons_total: 2,
    lessons_completed: 0,
    ...over,
  }
}

/** El módulo remoto m9, en la versión instalada y disponible que se le pida. */
function m9EnVersion(instalada: number, disponible: number | null): InstalledModuleStatusDto {
  return instalado({
    module_id: 'm9',
    title: M9.title,
    origin: 'remote',
    state: disponible != null && disponible > instalada ? 'update_available' : 'installed',
    installed_version: instalada,
    available_version: disponible,
    object_path: 'modules/m9.json',
    last_checked_at: '2026-07-12T15:04:05.123Z',
    lessons_total: 1,
  })
}

function estado(modules: InstalledModuleStatusDto[], catalogEnabled = true): CatalogStatusResponseDto {
  return {
    catalog_enabled: catalogEnabled,
    bucket: catalogEnabled ? 'telar-demo' : null,
    last_checked_at: catalogEnabled ? '2026-07-12T15:04:05.123Z' : null,
    modules,
    summary: {
      modules_total: modules.length,
      installed: modules.filter((m) => m.state !== 'local_only').length,
      updatable: modules.filter((m) => m.state === 'update_available').length,
      local_only: modules.filter((m) => m.state === 'local_only').length,
      never_checked: modules.filter((m) => m.last_checked_at === null).length,
    },
  }
}

// ──────────────────────────── fetch de mentira ──────────────────────────────

/** `'error'` = ese endpoint responde 503 con el envelope de error del contrato. */
interface Escenario {
  modules: ModulesResponseDto | 'error'
  status: CatalogStatusResponseDto | 'error'
  refresh: CatalogStatusResponseDto | 'error'
}

function escenarioBase(): Escenario {
  const status = estado([instalado()])
  return { modules: DOS_MODULOS, status, refresh: status }
}

let escenario: Escenario = escenarioBase()
const llamadas: string[] = []

/** Por defecto el refresh devuelve lo mismo que el status (nada cambió). */
function preparar(over: Partial<Escenario> = {}): void {
  const base = escenarioBase()
  const status = over.status ?? base.status
  escenario = {
    modules: over.modules ?? base.modules,
    status,
    refresh: over.refresh ?? status,
  }
}

function servir(valor: unknown, codigo: string): Response {
  if (valor === 'error') {
    return jsonResponse(errorEnvelope(codigo, 'El catálogo remoto no está disponible.'), 503)
  }
  return jsonResponse(envelope(valor))
}

function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input)
  llamadas.push(`${init?.method ?? 'GET'} ${url}`)
  // El catálogo va primero: `/catalog/modules/...` no debe caer en `/modules`.
  if (url.endsWith('/api/v1/catalog/status')) {
    return Promise.resolve(servir(escenario.status, 'CATALOG_UNAVAILABLE'))
  }
  if (url.endsWith('/api/v1/catalog/refresh')) {
    return Promise.resolve(servir(escenario.refresh, 'CATALOG_UNAVAILABLE'))
  }
  if (url.endsWith('/api/v1/system')) return Promise.resolve(jsonResponse(envelope(SYSTEM_INFO)))
  if (url.endsWith('/api/v1/examples')) return Promise.resolve(jsonResponse(envelope({ examples: [] })))
  if (url.endsWith('/api/v1/modules')) return Promise.resolve(servir(escenario.modules, 'INTERNAL_ERROR'))
  return Promise.resolve(jsonResponse(errorEnvelope('NOT_FOUND', `sin ruta de test: ${url}`), 404))
}

const fetchOriginal = globalThis.fetch

beforeAll(() => {
  globalThis.fetch = fakeFetch as typeof fetch
})
afterAll(() => {
  globalThis.fetch = fetchOriginal
})

beforeEach(() => {
  llamadas.length = 0
  preparar()
  // Los dos stores son singletons de módulo: sin este reset, el segundo test
  // heredaría la caché del primero y no llegaría a pedir nada.
  useProgressStore.setState({ modules: null, summary: null, error: null, loading: false, lastLessonId: null })
  useCatalogStore.setState({
    status: null,
    remote: null,
    stale: false,
    loadingStatus: false,
    loadingRemote: false,
    refreshing: false,
    statusError: null,
    remoteError: null,
    ops: {},
    opErrors: {},
  })
})

function montar() {
  return render(
    <MemoryRouter initialEntries={['/cursos']}>
      <CatalogScreen />
    </MemoryRouter>,
  )
}

/** Punto de reposo: el efecto no bloqueante ya terminó, con o sin éxito. */
async function catalogoResuelto(): Promise<void> {
  await waitFor(() => {
    const { status, statusError } = useCatalogStore.getState()
    expect(status !== null || statusError !== null).toBe(true)
  })
}

// ─────────────────────────────── los tests ──────────────────────────────────

describe('CatalogScreen · el catálogo remoto NO puede bloquear /cursos', () => {
  it('con el bucket caído la pantalla se pinta ENTERA: sin ErrorState y sin chips', async () => {
    preparar({ status: 'error', refresh: 'error' })
    montar()

    // 1) Está todo lo que tiene que estar, igual que con el bucket sano.
    expect(await screen.findByText('Catálogo de contenidos')).toBeInTheDocument()
    expect(screen.getByText('Patrón SPMD y false sharing')).toBeInTheDocument()
    expect(screen.getByText('Reducciones avanzadas')).toBeInTheDocument()
    expect(screen.getByText('Lecciones completadas')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Buscar lección, quiz o tema' })).toBeInTheDocument()

    // 2) El catálogo YA falló —el store lo anotó— y aun así no hay alerta.
    await catalogoResuelto()
    expect(useCatalogStore.getState().statusError).not.toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()

    // 3) Lo único que se pierde son los avisos.
    expect(screen.queryByText(/Actualización · v/)).toBeNull()
    expect(screen.queryByText(/con actualización/)).toBeNull()
  })

  it('el único ErrorState de /cursos sigue siendo el de GET /modules', async () => {
    // El catálogo responde perfectamente; quien se cae es el contenido local.
    preparar({ modules: 'error' })
    montar()

    const alerta = await screen.findByRole('alert')
    expect(within(alerta).getByText('No se pudo cargar el catálogo de contenidos.')).toBeInTheDocument()
    expect(within(alerta).getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })

  it('sin bucket configurado ni siquiera se intenta el refresh', async () => {
    preparar({ status: estado([instalado()], false) })
    montar()

    expect(await screen.findByText('Catálogo de contenidos')).toBeInTheDocument()
    await catalogoResuelto()
    // `catalog_enabled: false` ⇒ el POST solo podría devolver CATALOG_DISABLED.
    expect(llamadas.filter((l) => l.includes('/catalog/refresh'))).toEqual([])
    expect(screen.queryByText(/con actualización/)).toBeNull()
  })
})

describe('CatalogScreen · aviso de actualizaciones', () => {
  it('pinta el chip azul en su módulo y la tira con el enlace a /modulos', async () => {
    preparar({ status: estado([instalado(), m9EnVersion(2, 3)]) })
    montar()

    expect(await screen.findByText(/^Actualización · v3$/)).toBeInTheDocument()
    expect(screen.getByText('1 módulo con actualización')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Revisar/ })).toHaveAttribute('href', '/modulos')
  })

  it('el chip vive en la meta del módulo, NO como control anidado en la cabecera', async () => {
    preparar({ status: estado([instalado(), m9EnVersion(2, 3)]) })
    montar()

    await screen.findByText(/^Actualización · v3$/)
    const cabecera = screen.getByRole('button', { name: /Reducciones avanzadas/ })
    // El chip está dentro de la cabecera y dentro de `.cat-module-meta`…
    expect(cabecera.querySelector('.cat-module-meta .chip-blue')).not.toBeNull()
    // …pero NO es un control: anidar botones o enlaces dentro de un <button>
    // es HTML inválido y deja el interior fuera del alcance del teclado.
    expect(within(cabecera).queryByRole('button')).toBeNull()
    expect(within(cabecera).queryByRole('link')).toBeNull()
  })

  it('solo el módulo con versión nueva lleva chip; la tira pluraliza', async () => {
    preparar({
      status: estado([
        instalado({ origin: 'remote', state: 'update_available', installed_version: 1, available_version: 4 }),
        m9EnVersion(2, 3),
      ]),
    })
    montar()

    expect(await screen.findByText(/^Actualización · v4$/)).toBeInTheDocument()
    expect(screen.getByText(/^Actualización · v3$/)).toBeInTheDocument()
    expect(screen.getByText('2 módulos con actualización')).toBeInTheDocument()
  })

  it('sin nada pendiente no hay ni chip ni tira', async () => {
    preparar({ status: estado([instalado(), m9EnVersion(2, 2)]) })
    montar()

    expect(await screen.findByText('Reducciones avanzadas')).toBeInTheDocument()
    await catalogoResuelto()
    expect(useCatalogStore.getState().status).not.toBeNull()
    expect(screen.queryByText(/Actualización · v/)).toBeNull()
    expect(screen.queryByText(/con actualización/)).toBeNull()
  })

  it('con el catálogo caído sobrevive el aviso que GET /modules YA traía', async () => {
    // No contradice al primer test, lo completa: un bucket caído no AÑADE
    // avisos nuevos, pero tampoco puede BORRAR los que el backend local ya
    // escribió en SQLite y sirvió en `update_available` (§4.1). El estudiante
    // sin red sigue enterándose de lo que su equipo ya sabía.
    const m9ConVersionNueva: ModuleDto = { ...M9, update_available: 3 }
    preparar({
      modules: { ...DOS_MODULOS, modules: [M2, m9ConVersionNueva] },
      status: 'error',
      refresh: 'error',
    })
    montar()

    expect(await screen.findByText(/^Actualización · v3$/)).toBeInTheDocument()
    expect(screen.getByText('1 módulo con actualización')).toBeInTheDocument()
    await catalogoResuelto()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('el refresh no bloqueante enciende el chip que el status aún no conocía', async () => {
    // SQLite todavía cree que m9 está al día; el sondeo al bucket lo desmiente.
    preparar({
      status: estado([instalado(), m9EnVersion(2, 2)]),
      refresh: estado([instalado(), m9EnVersion(2, 5)]),
    })
    montar()

    expect(await screen.findByText(/^Actualización · v5$/)).toBeInTheDocument()
    expect(screen.getByText('1 módulo con actualización')).toBeInTheDocument()
    // Y fue un POST de verdad: el chip no salió del status inicial.
    expect(
      llamadas.some((l) => l.startsWith('POST ') && l.includes('/api/v1/catalog/refresh')),
    ).toBe(true)
  })
})
