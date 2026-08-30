// playwright.config.ts — E2E de Telar contra el stack en loopback.
//
// La app y el backend se levantan FUERA de Playwright (ver e2e/README.md): el
// backend necesita su propia DB temporal y el frontend un build con
// `VITE_API_BASE` apuntando al puerto del backend, y encadenar eso en
// `webServer` haría la config dependiente del entorno de cada quien.
//
// `workers: 1` y `retries: 1` son los mismos de la suite anterior: los tests
// comparten un backend con estado, así que correr en paralelo los haría pisarse.
import { defineConfig, devices } from '@playwright/test'

const BASE_URL = process.env.TELAR_E2E_BASE_URL ?? 'http://127.0.0.1:4173'

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: undefined } }],
})
