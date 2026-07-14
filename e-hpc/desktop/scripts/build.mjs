// scripts/build.mjs — literal de electron-spec.md §3.
// esbuild: src/main.ts + src/preload.ts → dist-electron/*.cjs.
import { build, context } from 'esbuild'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const opts = {
  entryPoints: ['src/main.ts', 'src/preload.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',                 // Node embebido de Electron 43 = 24.18
  external: ['electron'],
  outdir: 'dist-electron',
  outExtension: { '.js': '.cjs' },
  sourcemap: true,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },   // usada por preload.ts
}
if (process.argv.includes('--watch')) {
  const ctx = await context(opts); await ctx.watch()
} else {
  await build(opts)
}
