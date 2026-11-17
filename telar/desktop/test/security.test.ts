// security.test.ts — reglas puras de security.ts: a qué respuestas se aplica
// la CSP de Telar y a qué peticiones se añade el Referer de YouTube.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { debeAplicarCsp, cabecerasYouTube, REFERER_YOUTUBE } from '../src/security'

const DEV = 'http://localhost:5173'

test('CSP: se aplica al documento file:// de la app', () => {
  assert.equal(
    debeAplicarCsp({ url: 'file:///opt/Telar/resources/app-frontend/index.html', resourceType: 'mainFrame' }, null),
    true,
  )
})

test('CSP: se aplica al origen del dev-server en el mainFrame', () => {
  assert.equal(debeAplicarCsp({ url: 'http://localhost:5173/', resourceType: 'mainFrame' }, DEV), true)
})

test('CSP: sin dev-server, localhost:5173 no es de la app (salvo mainFrame)', () => {
  assert.equal(debeAplicarCsp({ url: 'http://localhost:5173/x.js', resourceType: 'script' }, null), false)
})

test('CSP: NO se aplica al subFrame de youtube-nocookie', () => {
  assert.equal(
    debeAplicarCsp({ url: 'https://www.youtube-nocookie.com/embed/st2ONJO-5WM', resourceType: 'subFrame' }, DEV),
    false,
  )
})

test('CSP: NO se aplica a un subFrame aunque sea file://', () => {
  assert.equal(debeAplicarCsp({ url: 'file:///tmp/otra.html', resourceType: 'subFrame' }, null), false)
})

test('CSP: NO se aplica a respuestas de https://www.youtube.com', () => {
  assert.equal(
    debeAplicarCsp({ url: 'https://www.youtube.com/s/player/abc/base.js', resourceType: 'script' }, DEV),
    false,
  )
})

test('CSP: se aplica a cualquier mainFrame (defensa si algo navega fuera)', () => {
  assert.equal(debeAplicarCsp({ url: 'https://evil.example/', resourceType: 'mainFrame' }, null), true)
})

test('CSP: URL inválida en recurso no-documento → no se aplica', () => {
  assert.equal(debeAplicarCsp({ url: 'no es una url', resourceType: 'script' }, null), false)
})

test('Referer: se añade al embed de youtube-nocookie sin Referer', () => {
  const out = cabecerasYouTube('https://www.youtube-nocookie.com/embed/st2ONJO-5WM', { Accept: 'text/html' })
  assert.deepEqual(out, { Accept: 'text/html', Referer: REFERER_YOUTUBE })
})

test('Referer: se añade a youtube.com, ytimg.com y googlevideo.com', () => {
  for (const url of [
    'https://www.youtube.com/s/player/abc/base.js',
    'https://i.ytimg.com/vi/x/hqdefault.jpg',
    'https://rr1---sn-abc.googlevideo.com/videoplayback?x=1',
  ]) {
    assert.equal(cabecerasYouTube(url, {}).Referer, REFERER_YOUTUBE, url)
  }
})

test('Referer: no toca el backend local ni otros hosts', () => {
  for (const url of [
    'http://localhost:8000/api/v1/modules',
    'http://localhost:5173/src/main.tsx',
    'https://storage.googleapis.com/clasestelar/x.json',
    'https://notyoutube.com/embed/x',
    'https://youtube.com.evil.example/embed/x',
  ]) {
    const headers = { Accept: '*/*' }
    assert.equal(cabecerasYouTube(url, headers), headers, url)
  }
})

test('Referer: http (no https) a YouTube no se toca', () => {
  const headers = {}
  assert.equal(cabecerasYouTube('http://www.youtube.com/embed/x', headers), headers)
})

test('Referer: no pisa un Referer ya presente (cualquier capitalización)', () => {
  const a = { Referer: 'https://www.youtube-nocookie.com/' }
  assert.equal(cabecerasYouTube('https://www.youtube.com/x', a), a)
  const b = { referer: 'http://localhost:5173/' }
  assert.equal(cabecerasYouTube('https://www.youtube-nocookie.com/embed/x', b), b)
})

test('Referer: no muta el objeto de entrada', () => {
  const headers = { Accept: 'text/html' }
  cabecerasYouTube('https://www.youtube-nocookie.com/embed/x', headers)
  assert.deepEqual(headers, { Accept: 'text/html' })
})

test('Referer: el valor es la página pública del proyecto (https)', () => {
  assert.match(REFERER_YOUTUBE, /^https:\/\/telar-javeriana\.github\.io\/$/)
})

// ── Permisos del navegador: solo `fullscreen`, y solo para YouTube/la app ─────
import { permisoPermitido } from '../src/security'

test('Permisos: pantalla completa del reproductor de YouTube → concedida', () => {
  assert.equal(permisoPermitido('fullscreen', 'https://www.youtube-nocookie.com/embed/st2ONJO-5WM?rel=0', null), true)
})

test('Permisos: pantalla completa de la propia app (file://) → concedida', () => {
  assert.equal(permisoPermitido('fullscreen', 'file:///opt/Telar/resources/app-frontend/index.html', null), true)
})

test('Permisos: pantalla completa de un sitio cualquiera → denegada', () => {
  assert.equal(permisoPermitido('fullscreen', 'https://evil.example/embed/x', null), false)
  assert.equal(permisoPermitido('fullscreen', 'https://youtube.com.evil.example/x', null), false)
})

test('Permisos: cualquier otro permiso → denegado, aunque venga de YouTube', () => {
  for (const p of ['media', 'geolocation', 'notifications', 'clipboard-read', 'openExternal', 'pointerLock']) {
    assert.equal(permisoPermitido(p, 'https://www.youtube-nocookie.com/embed/st2ONJO-5WM', null), false, p)
  }
})

test('Permisos: URL inválida → denegada', () => {
  assert.equal(permisoPermitido('fullscreen', 'no es una url', null), false)
})
