// scripts/test.mjs — tests unitarios del shell sin dependencias nuevas:
// esbuild (ya es devDependency) compila test/*.test.ts → dist-test/*.cjs y
// se ejecutan con el runner nativo `node --test`. `electron` queda externo:
// fuera de Electron, require('electron') devuelve una ruta y las APIs quedan
// sin definir, así que solo se prueban funciones puras.
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { readdirSync, rmSync } from 'node:fs'

const tests = readdirSync('test').filter((f) => f.endsWith('.test.ts'))
rmSync('dist-test', { recursive: true, force: true })
await build({
  entryPoints: tests.map((f) => `test/${f}`),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  outdir: 'dist-test',
  outExtension: { '.js': '.cjs' },
  logLevel: 'error',
})
const files = tests.map((f) => `dist-test/${f.replace(/\.ts$/, '.cjs')}`)
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' })
process.exit(r.status ?? 1)
