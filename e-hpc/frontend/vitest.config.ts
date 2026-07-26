// vitest.config.ts — suite de tests WP10 (frontend-spec §10).
// jsdom + jest-dom; setup con matchMedia mock y FakeWebSocket controlable.
// Cobertura v8 reportada por los 4 directorios con criterio ≥80 %:
// src/ws, src/stores, src/lib, src/hooks.
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Mismo `define` que vite.config.ts: sin él, cualquier test que renderice el
// diálogo «Acerca de» rompería con `__APP_VERSION__ is not defined`.
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
) as { version: string }

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    testTimeout: 15000,
    hookTimeout: 15000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: ['src/ws/**', 'src/stores/**', 'src/lib/**', 'src/hooks/**'],
      all: true,
    },
  },
})
