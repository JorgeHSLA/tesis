import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' es OBLIGATORIO: el MISMO build se sirve tras nginx y bajo file://
// en Electron (architecture.md §2.3, frontend-spec.md §0).
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
