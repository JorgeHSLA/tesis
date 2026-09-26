// unsaved-changes.test.ts — la decisión pura de unsaved-changes.ts: qué botón
// deja salir sin guardar y qué pasa si el diálogo se cierra sin elegir.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { debePermitirSalir, OPCIONES_DIALOGO, SALIR, SEGUIR } from '../src/unsaved-changes'

test('«Salir sin guardar» deja cerrar la ventana', () => {
  assert.equal(debePermitirSalir(SALIR), true)
})

test('«Seguir editando» mantiene la ventana abierta', () => {
  assert.equal(debePermitirSalir(SEGUIR), false)
})

test('un valor inesperado no deja salir (se pierden cambios solo si se pide)', () => {
  assert.equal(debePermitirSalir(-1), false)
  assert.equal(debePermitirSalir(7), false)
})

test('los botones están en el orden de las constantes', () => {
  assert.equal(OPCIONES_DIALOGO.buttons[SALIR], 'Salir sin guardar')
  assert.equal(OPCIONES_DIALOGO.buttons[SEGUIR], 'Seguir editando')
})

test('Escape/cerrar el diálogo y Enter por defecto equivalen a seguir editando', () => {
  assert.equal(OPCIONES_DIALOGO.cancelId, SEGUIR)
  assert.equal(OPCIONES_DIALOGO.defaultId, SEGUIR)
  assert.equal(debePermitirSalir(OPCIONES_DIALOGO.cancelId), false)
})
