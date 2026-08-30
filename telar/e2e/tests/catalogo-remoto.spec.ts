// catalogo-remoto.spec.ts — el recorrido que da sentido a toda la Fase 5.
//
//   Un admin publica un módulo. El estudiante lo ve, ELIGE incorporarlo, avanza
//   en él, y cuando llega una versión nueva la instala SIN PERDER lo avanzado.
//
// Que el backend conserve el progreso ya lo prueban 897 tests de pytest. Lo que
// falta comprobar —y solo se puede comprobar aquí— es que la PERSONA lo vea: que
// el aviso aparezca, que el «qué conservo» diga la verdad, y que después de
// actualizar su avance siga en la pantalla.
//
// El escenario (bucket falso servido en loopback, backend con driver http_local)
// está descrito en e2e/README-catalogo.md. Los tests van en serie y COMPARTEN
// estado a propósito: son un recorrido, no casos sueltos.
import { expect, test } from '@playwright/test'

/** Puerto del backend del escenario E2E (no el 8000 del compose). */
const API = process.env.TELAR_E2E_API ?? 'http://127.0.0.1:8015'

test.describe.configure({ mode: 'serial' })

/** Publica la versión indicada de `mFundamentos` reescribiendo el índice. */
async function publicarVersion(version: 1 | 2) {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const guion = process.env.TELAR_E2E_PREPARAR
  const bucket = process.env.TELAR_E2E_BUCKET
  if (!guion || !bucket) {
    test.skip(true, 'faltan TELAR_E2E_PREPARAR y TELAR_E2E_BUCKET')
    return
  }
  // El guion importa `app.services.catalog_hash` para firmar el bundle con la
  // MISMA función que el backend, así que necesita el intérprete que tenga las
  // dependencias del backend, no el del sistema.
  const python = process.env.TELAR_E2E_PYTHON ?? 'python3'
  await promisify(execFile)(python, [guion, bucket, '--version', String(version)])
}

test.describe('CU-35 · explorar el catálogo del bucket', () => {
  test('la tienda de módulos lista lo que hay publicado', async ({ page }) => {
    await page.goto('#/modulos')

    await expect(page.getByText('Fundamentos de paralelismo')).toBeVisible()
    await expect(page.getByText('Módulo que nadie incorpora')).toBeVisible()
  })

  test('anuncia qué trae cada módulo antes de descargarlo', async ({ page }) => {
    await page.goto('#/modulos')

    // El estudiante decide con información: cuántas lecciones, cuántas
    // preguntas y cuánto tiempo. Si no, «incorporar» es un salto al vacío.
    const tarjeta = page.locator('.store-card', { hasText: 'Fundamentos de paralelismo' })
    await expect(tarjeta).toContainText('2')
    await expect(tarjeta).toContainText(/lecciones?/)
  })

  test('el catálogo local no muestra todavía el módulo remoto', async ({ page }) => {
    await page.goto('#/cursos')
    await expect(page.locator('.cat-module').first()).toBeVisible()
    await expect(
      page.locator('.cat-module', { hasText: 'Fundamentos de paralelismo' }),
    ).toHaveCount(0)
  })
})

test.describe('CU-36 · incorporar el módulo que se elige', () => {
  test('incorporar uno lo instala y deja el otro fuera', async ({ page }) => {
    await page.goto('#/modulos')

    const fundamentos = page.locator('.store-card', { hasText: 'Fundamentos de paralelismo' })
    await fundamentos.getByRole('button', { name: /Incorporar/ }).click()

    // Queda instalado…
    await expect(fundamentos.getByText(/Instalado/)).toBeVisible({ timeout: 20_000 })

    // …y el otro sigue disponible: incorporar es una ELECCIÓN, no un todo o nada.
    const extra = page.locator('.store-card', { hasText: 'Módulo que nadie incorpora' })
    await expect(extra.getByRole('button', { name: /Incorporar/ })).toBeVisible()
  })

  test('el módulo aparece en el catálogo con sus lecciones', async ({ page }) => {
    await page.goto('#/cursos')

    const modulo = page.locator('.cat-module', { hasText: 'Fundamentos de paralelismo' })
    await expect(modulo).toBeVisible()
    await modulo.locator('.cat-module-head').click()
    await expect(modulo.locator('.cat-lesson')).toHaveCount(2)
  })

  test('la lección conceptual del bucket se lee, sin ofrecer ejecutarla', async ({ page }) => {
    await page.goto('#/cursos/f1Hilo')

    await expect(page.locator('.markdown')).toContainText('unidad de ejecución')
    // Sin código no hay affordance de ejecución: no un botón muerto, ninguno.
    await expect(page.getByRole('button', { name: 'Probar en el simulador' })).toHaveCount(0)
  })

  test('su video llega como iframe al dominio sin cookies, ya normalizado', async ({ page }) => {
    await page.goto('#/cursos/f1Hilo')

    const marco = page.locator('iframe.lesson-media-video')
    await expect(marco).toBeVisible()
    await expect(marco).toHaveAttribute(
      'src',
      /^https:\/\/www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]{11}\?/,
    )
    // El `&list=NoDeberiaSobrevivir` con el que se publicó no sobrevivió ni a la
    // normalización del servidor ni a la del cliente.
    await expect(marco).not.toHaveAttribute('src', /list=/)
  })
})

test.describe('el estudiante avanza en el módulo incorporado', () => {
  test('aprueba el quiz de la lección práctica', async ({ page, request }) => {
    // Las claves correctas se leen del GET admin del quiz (§10.5 las trae), sin
    // tocar la base: el intento se envía por la UI, como lo haría una persona.
    const admin = await request.get(`${API}/api/v1/admin/lessons/f1Practica/quiz`)
    const claves: Record<string, string> = Object.fromEntries(
      (await admin.json()).data.questions.map((q: { id: string; correct_key: string }) => [
        q.id,
        q.correct_key,
      ]),
    )

    await page.goto('#/cursos/f1Practica')
    await page.getByRole('button', { name: /Empezar quiz/ }).click()

    for (const [qid, clave] of Object.entries(claves)) {
      await page.locator(`input[name="quiz-${qid}"][value="${clave}"]`).check()
    }
    await page.getByRole('button', { name: /Enviar respuestas/ }).click()

    await expect(page.getByText('Aprobado')).toBeVisible()
    await expect(page.locator('.quiz-summary-score')).toContainText('2/2')
  })

  test('el catálogo refleja el avance', async ({ page }) => {
    await page.goto('#/cursos')
    const modulo = page.locator('.cat-module', { hasText: 'Fundamentos de paralelismo' })
    // Una de las dos lecciones completada. Se compara con el texto EXACTO: un
    // `not.toContainText('0%')` daría por bueno cualquier cosa menos «0%»… y
    // fallaría con «50%», que lo contiene como subcadena.
    await expect(modulo.locator('.cat-prog-n')).toHaveText('50%')
  })
})

test.describe('CU-38 y CU-39 · llega una versión nueva', () => {
  test('el admin publica la v2 y el estudiante ve el aviso', async ({ page }) => {
    await publicarVersion(2)

    await page.goto('#/modulos')
    await page.getByRole('button', { name: 'Actualizar lista' }).click()

    const tarjeta = page.locator('.store-card', { hasText: 'Fundamentos de paralelismo' })
    await expect(tarjeta.getByText(/Actualización/)).toBeVisible({ timeout: 20_000 })
  })

  test('el aviso también aparece en el catálogo, sin sacarlo de ahí', async ({ page }) => {
    await page.goto('#/cursos')

    const modulo = page.locator('.cat-module', { hasText: 'Fundamentos de paralelismo' })
    await expect(modulo.getByText(/Actualización/)).toBeVisible({ timeout: 20_000 })
  })

  test('«ver qué cambia» promete que el progreso se conserva', async ({ page }) => {
    await page.goto('#/modulos')
    const tarjeta = page.locator('.store-card', { hasText: 'Fundamentos de paralelismo' })
    await tarjeta.getByRole('button', { name: /Ver qué cambia/ }).click()
    const dialogo = page.getByRole('dialog')

    // La lección nueva se anuncia POR SU TÍTULO, no por su id: el diálogo existe
    // para que el estudiante entienda qué cambia.
    await expect(dialogo.getByText('Concurrencia no es paralelismo')).toBeVisible()
    // Y la promesa está escrita donde se decide. Sin esta frase, nadie pulsa
    // «Actualizar». Se busca DENTRO del diálogo: la tarjeta la repite, y un
    // getByText suelto casaría con las dos.
    await expect(dialogo.getByText(/[Tt]u progreso se conserva/)).toBeVisible()
  })

  test('actualiza y el avance sigue intacto', async ({ page, request }) => {
    await page.goto('#/modulos')
    const tarjeta = page.locator('.store-card', { hasText: 'Fundamentos de paralelismo' })
    await tarjeta
      .getByRole('button', { name: 'Actualizar Fundamentos de paralelismo' })
      .click()

    // Actualizar PIDE CONFIRMACIÓN, y no es fricción gratuita: el diálogo es
    // donde vive la promesa «tu progreso se conserva». Sin ese paso, el
    // estudiante aceptaría a ciegas justo lo que más le preocupa.
    const dialogo = page.getByRole('dialog')
    await expect(dialogo.getByText(/[Tt]u progreso se conserva/)).toBeVisible()
    await dialogo.getByRole('button', { name: 'Actualizar ahora' }).click()

    await expect(tarjeta.getByText(/Instalado/)).toBeVisible({ timeout: 20_000 })

    // LA PRUEBA. El quiz aprobado en la v1 sigue aprobado en la v2.
    const progreso = await (await request.get(`${API}/api/v1/progress`)).json()
    const practica = progreso.data.lessons.f1Practica
    expect(practica.completed, 'el aprobado no puede revocarse al actualizar').toBe(true)
    expect(practica.best_quiz_score).toBe(2)
    expect(practica.completed_via).toBe('quiz')

    // Y se ve en la pantalla, que es lo que esta suite añade sobre pytest.
    await page.goto('#/cursos')
    const modulo = page.locator('.cat-module', { hasText: 'Fundamentos de paralelismo' })
    await modulo.locator('.cat-module-head').click()
    await expect(modulo.locator('.cat-lesson')).toHaveCount(3) // creció
    await expect(
      modulo.locator('.cat-lesson', { hasText: 'Tu primera región paralela' }),
    ).toHaveClass(/done/) // y sigue completada
  })

  test('la lección nueva llegó y es legible', async ({ page }) => {
    await page.goto('#/cursos/f1Concurrencia')
    await expect(page.locator('.markdown')).toContainText('barista')
  })
})

test.describe('el modo sin red es un caso de uso, no un fallo', () => {
  test('con el bucket caído, /cursos sigue completo y sin error', async ({ page }) => {
    // Se corta el bucket a nivel de red, no del backend: es lo que le pasa a un
    // estudiante en un tren, y la app de escritorio debe seguir sirviendo lo ya
    // instalado.
    await page.route('**/catalog/**', (route) => route.abort())

    await page.goto('#/cursos')

    await expect(page.locator('.cat-module').first()).toBeVisible()
    await expect(page.locator('.error-state')).toHaveCount(0)
    // Sin red no hay chips de actualización, y eso es todo lo que se pierde.
    await expect(page.getByText(/Actualización ·/)).toHaveCount(0)
  })

  test('la lección instalada se lee igual sin red', async ({ page }) => {
    await page.route('**/catalog/**', (route) => route.abort())

    await page.goto('#/cursos/f1Hilo')
    await expect(page.locator('.markdown')).toContainText('unidad de ejecución')
  })

  test('/modulos es la ÚNICA pantalla que muestra error, y ofrece reintentar', async ({
    page,
  }) => {
    await page.route('**/catalog/**', (route) => route.abort())

    await page.goto('#/modulos')

    await expect(page.locator('.error-state')).toBeVisible()
    await expect(page.getByRole('button', { name: /Reintentar/ })).toBeVisible()
  })
})
