// audit-tokens.mjs — auditoría de la paleta contra la app REAL servida.
//  1. TODO token declarado en tokens.css debe resolver a un valor no vacío.
//  2. Cada par (texto/fondo, blanco/CTA, borde/superficie, estado/fondo)
//     se mide con los valores RENDERIZADOS, no con los del archivo.
// Uso: node audit-tokens.mjs <ruta/tokens.css> [baseURL]
import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'

const TOKENS_PATH = process.argv[2]
const BASE = process.argv[3] || 'http://127.0.0.1:8080'

// Nombres declarados en :root (capa primitive + semantic).
const src = readFileSync(TOKENS_PATH, 'utf8')
const declared = [...new Set([...src.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)].map((m) => m[1]))]

const b = await chromium.launch()
const p = await b.newPage()
await p.goto(`${BASE}/#/`, { waitUntil: 'networkidle' })
await p.waitForTimeout(500)

const resolved = await p.evaluate((names) => {
  const s = getComputedStyle(document.documentElement)
  const out = {}
  for (const n of names) out[n] = s.getPropertyValue(n).trim()
  return out
}, declared)

const empty = declared.filter((n) => !resolved[n])
console.log(`Tokens declarados: ${declared.length}   sin resolver: ${empty.length}`)
if (empty.length) {
  console.log('  ✗ VACÍOS: ' + empty.join(', '))
}

// ── contraste ─────────────────────────────────────────────────────────────
const lum = (h) => {
  h = h.replace('#', '')
  if (h.length === 3) h = [...h].map((c) => c + c).join('')
  const [r, g, b_] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b_)
}
const cr = (a, b_) => {
  const [x, y] = [lum(a), lum(b_)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
const V = (n) => resolved[n]

// par: [etiqueta, frente, fondo, umbral]
const PAIRS = [
  ['texto de cuerpo sobre lienzo', '--text', '--bg', 4.5],
  ['texto de cuerpo sobre tarjeta', '--text', '--surface', 4.5],
  ['texto atenuado sobre lienzo', '--text-muted', '--bg', 4.5],
  ['texto atenuado sobre tarjeta', '--text-muted', '--surface', 4.5],
  ['texto atenuado fuerte sobre pozo', '--text-muted-strong', '--surface-3', 4.5],
  ['blanco sobre CTA', '--on-accent', '--accent', 4.5],
  ['blanco sobre CTA hover', '--on-accent', '--accent-hover', 4.5],
  ['CTA como texto sobre tarjeta', '--accent', '--surface', 4.5],
  ['enlace (primary-ink) sobre lienzo', '--primary-ink', '--bg', 4.5],
  ['enlace (primary-ink) sobre tarjeta', '--primary-ink', '--surface', 4.5],
  ['blanco sobre primary-ink (badge)', '--on-accent', '--primary-ink', 4.5],
  ['tinta de marca sobre primary-soft', '--primary-ink', '--primary-soft', 4.5],
  ['tinta de acento sobre accent-soft', '--accent-hover', '--accent-soft', 4.5],
  ['borde-affordance sobre tarjeta', '--border-strong', '--surface', 3.0],
  ['borde-affordance sobre lienzo', '--border-strong', '--bg', 3.0],
  ['marca (--primary) como icono', '--primary', '--surface', 3.0],
  ['dot success sobre tarjeta', '--success', '--surface', 3.0],
  ['dot warn sobre tarjeta', '--warn', '--surface', 3.0],
  ['dot danger sobre tarjeta', '--danger', '--surface', 3.0],
  ['blanco sobre danger (botón/toast)', '--on-accent', '--danger', 4.5],
  ['tinta success sobre su chip', '--success-ink', '--success-soft', 4.5],
  ['tinta warn sobre su chip', '--warn-ink', '--warn-soft', 4.5],
  ['tinta danger sobre su chip', '--danger-ink', '--danger-soft', 4.5],
  ['icono warn sobre su chip', '--warn', '--warn-soft', 3.0],
  ['serie 1 de gráfica sobre tarjeta', '--viz-observed', '--surface', 3.0],
  ['serie 2 de gráfica sobre tarjeta', '--viz-mem', '--surface', 3.0],
  ['referencia ideal sobre tarjeta', '--viz-ideal', '--surface', 3.0],
  ['etiqueta de eje (texto)', '--viz-label', '--surface', 4.5],
  ['texto de terminal', '--term-text', '--term-bg', 4.5],
  ['texto atenuado de terminal', '--term-dim', '--term-bg', 4.5],
  ['acento de terminal', '--term-accent', '--term-bg', 4.5],
]

console.log('\n| par | frente | fondo | ratio | umbral | AA |')
console.log('|---|---|---|---|---|---|')
let fails = 0
for (const [label, fg, bg, need] of PAIRS) {
  const a = V(fg), c = V(bg)
  if (!a || !c) { console.log(`| ${label} | ${fg}=${a} | ${bg}=${c} | — | — | ✗ SIN VALOR |`); fails++; continue }
  const r = cr(a, c)
  const ok = r >= need
  if (!ok) fails++
  console.log(`| ${label} | \`${a}\` | \`${c}\` | ${r.toFixed(2)}:1 | ${need} | ${ok ? '✅' : '❌'} |`)
}

// separación en escala de grises entre estados
console.log('\nSeparación en escala de grises entre estados (objetivo ≥1.30:1):')
const st = [['success', '--success', '--success-ink'], ['warn', '--warn', '--warn-ink'], ['danger', '--danger', '--danger-ink']]
for (let i = 0; i < st.length; i++) {
  for (let j = i + 1; j < st.length; j++) {
    const rb = cr(V(st[i][1]), V(st[j][1])), ri = cr(V(st[i][2]), V(st[j][2]))
    const ok = rb >= 1.3 && ri >= 1.3
    if (!ok) fails++
    console.log(`  ${st[i][0]} vs ${st[j][0]}: base ${rb.toFixed(2)}:1  tinta ${ri.toFixed(2)}:1  ${ok ? '✅' : '❌'}`)
  }
}
const sep = cr(V('--viz-observed'), V('--viz-ideal'))
console.log(`  serie observada vs ideal: ${sep.toFixed(2)}:1 ${sep >= 1.3 ? '✅' : '❌'}`)
if (sep < 1.3) fails++

await b.close()
console.log(`\n${fails === 0 && empty.length === 0 ? 'AUDITORÍA VERDE' : 'AUDITORÍA CON FALLOS: ' + (fails + empty.length)}`)
process.exit(fails === 0 && empty.length === 0 ? 0 : 1)
