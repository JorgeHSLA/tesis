// fresh-install.test.ts — cuándo una apertura cuenta como instalación nueva
// (y limpia los datos Docker) y cuándo es una actualización (no toca nada).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { decideReset, initFreshInstall, markResetDone, MARKER_FILE } from '../src/fresh-install'

test('sin marcador y sin rastros de uso: instalación nueva, hay que limpiar', () => {
  assert.deepEqual(decideReset(null, false), { resetPending: true })
})

test('sin marcador pero con rastros de uso: es una actualización, no se limpia', () => {
  assert.deepEqual(decideReset(null, true), { resetPending: false })
})

test('con marcador manda lo ya decidido, haya o no rastros', () => {
  assert.deepEqual(decideReset({ resetPending: true }, true), { resetPending: true })
  assert.deepEqual(decideReset({ resetPending: false }, false), { resetPending: false })
})

function carpeta(): string {
  return mkdtempSync(path.join(tmpdir(), 'telar-fresh-'))
}

test('userData inexistente (recién desinstalada): limpia y deja el marcador', () => {
  const base = carpeta()
  const userData = path.join(base, 'Telar') // todavía no existe
  try {
    assert.equal(initFreshInstall(userData).resetPending, true)
    const marcador = JSON.parse(readFileSync(path.join(userData, MARKER_FILE), 'utf8'))
    assert.equal(marcador.resetPending, true)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('actualización desde una versión sin marcador: no limpia', () => {
  const userData = carpeta()
  try {
    mkdirSync(path.join(userData, 'Local Storage'))
    assert.equal(initFreshInstall(userData).resetPending, false)
  } finally {
    rmSync(userData, { recursive: true, force: true })
  }
})

test('si la limpieza no pudo hacerse, sigue pendiente en la siguiente apertura', () => {
  const userData = carpeta()
  try {
    assert.equal(initFreshInstall(userData).resetPending, true)
    mkdirSync(path.join(userData, 'Code Cache')) // Chromium ya dejó rastros
    assert.equal(initFreshInstall(userData).resetPending, true)
    markResetDone(userData)
    assert.equal(initFreshInstall(userData).resetPending, false)
  } finally {
    rmSync(userData, { recursive: true, force: true })
  }
})
