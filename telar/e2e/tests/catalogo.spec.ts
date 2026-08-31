// catalogo.spec.ts — el catálogo de contenidos sobre el DOM real.
//
// F2 — cada lección se pintaba DOS veces (una fila «Ejemplo» y otra «Quiz»)
//      que iban a la misma pantalla y solo cambiaban el ancla, y el contador
//      «Todo» sumaba lecciones + quizzes: decía 28 donde hay 14 cosas.
// E1 — el módulo conceptual nuevo aparece en el catálogo junto a los prácticos,
//      y sus filas no prometen una ejecución que no existe.
import { expect, test } from '@playwright/test'

test.describe('F2 · una fila por lección, contadores que cuentan lecciones', () => {
  test('el contador «Todo» no cuenta las cosas dos veces', async ({ page }) => {
    await page.goto('#/aprender')

    const todo = page.getByRole('button', { name: /^Todo/ })
    await expect(todo).toBeVisible()
    const total = Number((await todo.locator('.fpill-n').innerText()).trim())

    const ejemplos = Number(
      (await page.getByRole('button', { name: /Ejemplos/ }).locator('.fpill-n').innerText()).trim(),
    )
    const quizzes = Number(
      (await page.getByRole('button', { name: /Quizzes/ }).locator('.fpill-n').innerText()).trim(),
    )

    // Antes: total === ejemplos + quizzes (14 + 14 = 28) para 14 lecciones.
    expect(total).toBeLessThan(ejemplos + quizzes)
    // Una misma lección cuenta en las tres pastillas, así que el total es el
    // mayor de los subconjuntos, no su suma.
    expect(total).toBeGreaterThanOrEqual(Math.max(ejemplos, quizzes))
  })

  test('un módulo abierto pinta tantas filas como lecciones anuncia', async ({ page }) => {
    await page.goto('#/aprender')

    const modulo = page.locator('.cat-module').first()
    await expect(modulo).toBeVisible()

    const anunciadas = Number(
      (await modulo.locator('.cat-module-meta .mono-small').innerText()).match(/(\d+)/)![1],
    )
    if (!(await modulo.evaluate((el) => el.classList.contains('open')))) {
      await modulo.locator('.cat-module-head').click()
    }
    await expect(modulo.locator('.cat-lesson').first()).toBeVisible()

    // Antes esto habría dado el doble (una fila de ejemplo + una de quiz).
    await expect(modulo.locator('.cat-lesson')).toHaveCount(anunciadas)
  })

  test('la fila lleva las dos metas juntas, no en filas separadas', async ({ page }) => {
    await page.goto('#/aprender')
    const modulo = page.locator('.cat-module').first()
    if (!(await modulo.evaluate((el) => el.classList.contains('open')))) {
      await modulo.locator('.cat-module-head').click()
    }

    const meta = modulo.locator('.cat-lesson').first().locator('.cat-lesson-meta')
    await expect(meta).toContainText('min')      // tiempo de lectura (C4)
    await expect(meta).toContainText('Ejemplo')  // tiempo de ejecución
    await expect(meta).toContainText('Quiz')     // y el quiz, en la MISMA fila
  })
})

test.describe('E1 · el módulo conceptual convive con los prácticos', () => {
  test('aparece en el catálogo', async ({ page }) => {
    await page.goto('#/aprender')
    await expect(page.getByText('Fundamentos de paralelismo')).toBeVisible()
  })

  test('su lección no anuncia un ejemplo que no tiene', async ({ page }) => {
    await page.goto('#/aprender')

    const modulo = page.locator('.cat-module', { hasText: 'Fundamentos de paralelismo' })
    await modulo.locator('.cat-module-head').click()

    const fila = modulo.locator('.cat-lesson', { hasText: '¿Qué es un hilo?' })
    await expect(fila).toBeVisible()
    await expect(fila.locator('.cat-lesson-meta')).toContainText('min')
    await expect(fila.locator('.cat-lesson-meta')).not.toContainText('Ejemplo')
  })

  test('el filtro «Ejemplos» la deja fuera; «Todo» la incluye', async ({ page }) => {
    await page.goto('#/aprender')
    const modulo = page.locator('.cat-module', { hasText: 'Fundamentos de paralelismo' })
    await modulo.locator('.cat-module-head').click()

    const fila = modulo.locator('.cat-lesson', { hasText: '¿Qué es un hilo?' })
    await expect(fila).toBeVisible()

    await page.getByRole('button', { name: /Ejemplos/ }).click()
    await expect(fila).toHaveCount(0)

    await page.getByRole('button', { name: /^Todo/ }).click()
    await expect(fila).toBeVisible()
  })

  test('desde el catálogo se llega a la lección conceptual', async ({ page }) => {
    await page.goto('#/aprender')
    const modulo = page.locator('.cat-module', { hasText: 'Fundamentos de paralelismo' })
    await modulo.locator('.cat-module-head').click()
    await modulo.locator('.cat-lesson', { hasText: '¿Qué es un hilo?' }).click()

    await expect(page).toHaveURL(/#\/aprender\/queEsUnHilo$/)
    await expect(page.locator('h2.display-lg', { hasText: '¿Qué es un hilo?' })).toBeVisible()
  })
})

test.describe('E4 · la lección conceptual se puede completar', () => {
  test('el simulador no ofrece la lección sin código en su selector', async ({ page }) => {
    await page.goto('#/simulador')

    const selector = page.locator('select').first()
    await expect(selector).toBeVisible()
    // No aparece deshabilitada: directamente no está. El selector ofrece
    // EJEMPLOS, y una lección conceptual no aporta ninguno.
    await expect(selector.locator('option', { hasText: '¿Qué es un hilo?' })).toHaveCount(0)
  })
})
