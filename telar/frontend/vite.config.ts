import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Versión real del paquete → __APP_VERSION__ (diálogo «Acerca de»). Se lee del
// package.json para no duplicar el número a mano en el código.
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
) as { version: string }

// base './' es OBLIGATORIO: el MISMO build se sirve tras nginx y bajo file://
// en Electron (architecture.md §2.3, frontend-spec.md §0).
export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
