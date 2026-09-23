#!/usr/bin/env node
// sync-release.mjs — genera site/release.json a partir del último release
// publicado en GitHub.
//
// POR QUÉ EXISTE: la página podría llamar a la API de GitHub desde el
// navegador, pero sin autenticar son 60 peticiones/hora POR IP. Un salón
// entero detrás del NAT de la universidad agota esa cuota y la página se
// queda sin descargas justo cuando más gente la abre. Horneando los datos
// aquí, el sitio no depende de ninguna API en tiempo de carga.
//
// Uso:  node scripts/sync-release.mjs            (último release)
//       node scripts/sync-release.mjs v1.0.3     (uno concreto)
//
// Requiere `gh` autenticado (el mismo que se usa para publicar releases).

import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const REPO = 'telar-javeriana/telar'
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'release.json')

/** Clasificación de artefactos. El orden manda: gana la primera que coincida. */
const KINDS = [
  {
    test: (n) => /setup.*\.exe$/i.test(n),
    os: 'windows', kind: 'installer', recommended: true,
    label: 'Instalador', hint: 'Se instala y queda en el menú de inicio.',
  },
  {
    test: (n) => /\.exe$/i.test(n),
    os: 'windows', kind: 'portable', recommended: false,
    label: 'Portable', hint: 'No instala nada: se ejecuta tal cual.',
  },
  {
    test: (n) => /\.deb$/i.test(n),
    os: 'linux', kind: 'installer', recommended: true,
    label: 'Instalador .deb', hint: 'Debian, Ubuntu, Mint y derivadas.',
  },
  {
    test: (n) => /\.appimage$/i.test(n),
    os: 'linux', kind: 'portable', recommended: false,
    label: 'AppImage', hint: 'Cualquier distribución, sin permisos de administrador.',
  },
]

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
}

/** El nombre en SHA256SUMS lleva espacios; GitHub los convierte en puntos. */
const normalize = (name) => name.replace(/\s+/g, '.')

function parseChecksums(text) {
  const map = new Map()
  for (const line of text.split('\n')) {
    const m = line.match(/^([0-9a-f]{64})\s+\*?(.+?)\s*$/i) // `*` = modo binario de sha256sum -b
    if (m) map.set(normalize(m[2]), m[1].toLowerCase())
  }
  return map
}

const tag = process.argv[2]
const view = ['release', 'view', ...(tag ? [tag] : []), '-R', REPO,
  '--json', 'tagName,name,publishedAt,body,url,assets']
const rel = JSON.parse(gh(view))

// Los checksums viven en un asset del propio release, no en el repo.
const sumsAsset = rel.assets.find((a) => /^SHA256SUMS/i.test(a.name))
let checksums = new Map()
if (sumsAsset) {
  const res = await fetch(sumsAsset.url)
  if (res.ok) checksums = parseChecksums(await res.text())
  else console.warn(`aviso: no se pudo leer ${sumsAsset.name} (HTTP ${res.status})`)
} else {
  console.warn('aviso: el release no adjunta SHA256SUMS; la página omitirá la verificación')
}

const downloads = []
for (const asset of rel.assets) {
  const kind = KINDS.find((k) => k.test(asset.name))
  if (!kind) continue // SHA256SUMS, source code, etc.
  const sha256 = checksums.get(asset.name) ?? null
  if (!sha256) console.warn(`aviso: sin checksum para ${asset.name}`)
  downloads.push({
    file: asset.name,
    url: asset.url,
    size: asset.size,
    os: kind.os,
    kind: kind.kind,
    recommended: kind.recommended,
    label: kind.label,
    hint: kind.hint,
    sha256,
  })
}

if (downloads.length === 0) {
  console.error(`error: ${rel.tagName} no tiene artefactos reconocibles`)
  process.exit(1)
}

const data = {
  version: rel.tagName.replace(/^v/, ''),
  tag: rel.tagName,
  name: rel.name,
  publishedAt: rel.publishedAt,
  notesUrl: rel.url,
  repo: REPO,
  checksumsUrl: sumsAsset?.url ?? null,
  generatedAt: new Date().toISOString(),
  downloads,
}

writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n', 'utf8')
console.log(`release.json ← ${rel.tagName} (${downloads.length} artefactos)`)
