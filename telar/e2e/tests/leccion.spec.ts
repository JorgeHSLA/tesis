// leccion.spec.ts — la pantalla de lección, verificada sobre el DOM real.
//
// Cubre lo que la revisión previa al refactor marcó como los dos problemas más
// visibles del área educativa, y el cambio de modelo que los acompaña:
//
//   C1 — la lección abría mostrando un hueco de video con el texto plegado.
//   F1 — «ZINE», marca residual del prototipo, seguía en cuatro textos.
//   C4 — cinco campos pedagógicos se escribían y no llegaban a pantalla.
//   E1 — una lección no podía existir sin código, y por eso el track de
//        fundamentos vivía fuera de la aplicación.
//
// Cada test asserta sobre lo que ve el usuario, no sobre logs internos.
import { expect, test } from '@playwright/test'

/** Lección práctica del baseline: markdown + código + quiz. */
const LECCION_PRACTICA = '#/aprender/spmd'
/** Lección conceptual creada para esta verificación: sin código, con video. */
const LECCION_TEORICA = '#/aprender/queEsUnHilo'

test.describe('C1 · la lección abre mostrando la lección', () => {
  test('el contenido está a la vista sin desplegar nada', async ({ page }) => {
    await page.goto(LECCION_PRACTICA)

    // La tarjeta nace ABIERTA: antes había que hacer clic para ver el texto.
    const tarjeta = page.getByRole('button', { name: /De qué va esta lección/ })
    await expect(tarjeta).toHaveAttribute('aria-expanded', 'true')

    // Y el markdown de la lección se lee de verdad, sin interactuar.
    await expect(page.locator('.markdown')).toBeVisible()
    await expect(page.locator('.markdown')).not.toBeEmpty()
  })

  test('sin video no hay marco vacío ni «Video próximamente»', async ({ page }) => {
    await page.goto(LECCION_PRACTICA)

    await expect(page.locator('.lesson-media')).toHaveCount(0)
    await expect(page.getByText('Video próximamente')).toHaveCount(0)
    // Y desde luego ningún <video>: el medio no se descarga.
    await expect(page.locator('video')).toHaveCount(0)
  })

  test('sigue plegándose a voluntad (el control no se perdió)', async ({ page }) => {
    await page.goto(LECCION_PRACTICA)
    const tarjeta = page.getByRole('button', { name: /De qué va esta lección/ })

    await tarjeta.click()
    await expect(tarjeta).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('.markdown')).toHaveCount(0)

    await tarjeta.click()
    await expect(tarjeta).toHaveAttribute('aria-expanded', 'true')
  })
})

test.describe('F1 · «ZINE» ya no aparece por ninguna parte', () => {
  for (const [nombre, ruta] of [
    ['catálogo', '#/aprender'],
    ['lección', LECCION_PRACTICA],
  ] as const) {
    test(`no está en ${nombre}`, async ({ page }) => {
      await page.goto(ruta)
      await expect(page.locator('.screen')).toBeVisible()
      await expect(page.getByText('ZINE', { exact: false })).toHaveCount(0)
    })
  }

  test('el rail lateral dice «Aprender», no «Aprender (ZINE)»', async ({ page }) => {
    await page.goto('#/')
    // Por el NOMBRE ACCESIBLE, no por texto visible: el rail es de 56px y
    // `.nav-label` está en `display: none`. Esta aserción es además la que
    // defiende que los enlaces del rail tengan nombre (WCAG 2.4.4/4.1.2).
    const enlace = page.locator('.sidebar').getByRole('link', { name: 'Aprender', exact: true })
    await expect(enlace).toHaveAttribute('href', '#/aprender')
  })

  test('todos los enlaces del rail tienen nombre accesible', async ({ page }) => {
    await page.goto('#/')
    const enlaces = page.locator('.sidebar .nav-item')
    const total = await enlaces.count()
    expect(total).toBeGreaterThan(0)
    for (let i = 0; i < total; i++) {
      // Un rail de iconos sin nombre deja la navegación principal muda para un
      // lector de pantalla. El tooltip `::after` no cuenta: es contenido
      // generado por CSS y no llega al árbol de accesibilidad.
      await expect(enlaces.nth(i)).not.toHaveAttribute('aria-label', '')
      expect(await enlaces.nth(i).getAttribute('aria-label')).toBeTruthy()
    }
  })
})

test.describe('C4 · los metadatos pedagógicos llegan al estudiante', () => {
  test('la cabecera muestra el resumen y los minutos de lectura', async ({ page }) => {
    await page.goto(LECCION_PRACTICA)

    // `teaches`: el resumen de una línea que antes no se pintaba en ningún sitio.
    await expect(page.locator('.learn-teaches')).toBeVisible()
    // `estimated_minutes`: tiempo de LECTURA, distinto del de ejecución.
    await expect(page.getByText(/~\d+ min/)).toBeVisible()
  })

  test('la dificultad y las directivas de OpenMP se ven', async ({ page }) => {
    await page.goto(LECCION_PRACTICA)

    await expect(page.locator('.lesson-facts')).toBeVisible()
    await expect(page.getByText(/Dificultad \d\/5/)).toBeVisible()
    // Las directivas son la mejor pista de qué enseña el ejemplo.
    await expect(page.locator('.lesson-directives code').first()).toBeVisible()
  })
})

test.describe('E1 · la lección conceptual existe y se ve bien', () => {
  test('abre sin pedir un ejemplo que no tiene', async ({ page }) => {
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(String(e)))

    await page.goto(LECCION_TEORICA)

    await expect(page.locator('h2.display-lg', { hasText: '¿Qué es un hilo?' })).toBeVisible()
    await expect(page.locator('.markdown')).toContainText('unidad de ejecución')
    expect(errores, 'la pantalla no debe reventar sin ejemplo').toEqual([])
  })

  test('no ofrece ejecutar ni descargar: no hay botón, no un botón muerto', async ({ page }) => {
    await page.goto(LECCION_TEORICA)
    await expect(page.locator('.markdown')).toBeVisible()

    // La regla de UI: sin código NO hay affordance de ejecución. Un botón
    // deshabilitado sugeriría que a la lección le falta algo, y no le falta.
    await expect(page.getByRole('button', { name: 'Probar en el simulador' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Descargar/ })).toHaveCount(0)
  })

  test('sin ejemplo tampoco hay tabs, ni dificultad, ni directivas', async ({ page }) => {
    await page.goto(LECCION_TEORICA)
    await expect(page.locator('.markdown')).toBeVisible()

    await expect(page.getByRole('tab')).toHaveCount(0)
    await expect(page.locator('.lesson-facts')).toHaveCount(0)
  })

  test('el video es un iframe de YouTube al dominio sin cookies', async ({ page }) => {
    await page.goto(LECCION_TEORICA)

    const marco = page.locator('iframe.lesson-media-video')
    await expect(marco).toBeVisible()
    // Reconstruido por el cliente sobre el id, no la URL que se guardó.
    await expect(marco).toHaveAttribute(
      'src',
      /^https:\/\/www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]{11}\?/,
    )
    // El `&list=…` con el que se creó la lección no sobrevivió a la
    // normalización del servidor ni a la del cliente.
    await expect(marco).not.toHaveAttribute('src', /list=/)
  })

  test('sin ejemplo, el pie del reproductor no ofrece el CTA al simulador', async ({ page }) => {
    await page.goto(LECCION_TEORICA)
    await expect(page.locator('iframe.lesson-media-video')).toBeVisible()

    await expect(page.locator('.lesson-media-foot')).toHaveCount(0)
  })
})
