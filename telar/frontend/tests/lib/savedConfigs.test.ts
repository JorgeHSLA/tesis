// lib/savedConfigs — configuraciones guardadas en localStorage (CU-32.1).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deleteSavedConfig,
  listSavedConfigs,
  renameSavedConfig,
  saveConfig,
  SAVED_CONFIGS_KEY,
} from '@/lib/savedConfigs'

const INPUT = {
  name: 'Mi prueba',
  example_id: 'spmd',
  code: 'print(1)\n',
  filename: 'piSpmd.py',
  threads: 4,
  timeout_s: 30,
  edited: false,
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('guardar y listar', () => {
  it('guarda y la lista la devuelve (más reciente primero)', () => {
    saveConfig(INPUT)
    saveConfig({ ...INPUT, name: 'Segunda', example_id: null })
    const list = listSavedConfigs()
    expect(list.map((c) => c.name)).toEqual(['Segunda', 'Mi prueba'])
    expect(list[0].example_id).toBeNull()
    expect(list[1]).toMatchObject(INPUT)
    expect(typeof list[1].id).toBe('string')
  })

  it('nombre vacío → nombre por defecto', () => {
    const saved = saveConfig({ ...INPUT, name: '   ' })
    expect(saved?.name).toBe('Configuración sin nombre')
  })

  it('JSON corrupto o entradas inválidas se ignoran', () => {
    localStorage.setItem(SAVED_CONFIGS_KEY, '{no json')
    expect(listSavedConfigs()).toEqual([])
    localStorage.setItem(SAVED_CONFIGS_KEY, JSON.stringify([{ id: 'x' }, 5, null]))
    expect(listSavedConfigs()).toEqual([])
  })

  it('si localStorage falla, save devuelve null y list []', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(saveConfig(INPUT)).toBeNull()
    expect(listSavedConfigs()).toEqual([])
  })
})

describe('renombrar y borrar', () => {
  it('renombra sin tocar el resto de campos', () => {
    const saved = saveConfig(INPUT)!
    expect(renameSavedConfig(saved.id, 'Nuevo')).toBe(true)
    expect(listSavedConfigs()[0]).toEqual({ ...saved, name: 'Nuevo' })
  })

  it('borra solo la indicada', () => {
    const a = saveConfig(INPUT)!
    saveConfig({ ...INPUT, name: 'B' })
    expect(deleteSavedConfig(a.id)).toBe(true)
    expect(listSavedConfigs().map((c) => c.name)).toEqual(['B'])
  })

  it('la lista devuelta es una copia: mutarla no cambia lo guardado', () => {
    saveConfig(INPUT)
    const list = listSavedConfigs()
    list[0].code = 'otro'
    expect(listSavedConfigs()[0].code).toBe(INPUT.code)
  })
})
