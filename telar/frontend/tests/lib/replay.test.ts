// lib/replay — el reproductor de la ejecución solo vuelve a MOSTRAR lo que ya
// llegó (salida y métricas con su hora); nunca inventa ni cambia una medida.
import { describe, expect, it } from 'vitest'
import {
  SPEED_MAX,
  SPEED_MIN,
  fmtClock,
  fmtSpeed,
  logsUntil,
  metricAt,
  metricsUntil,
  threadActivity,
  timelineOf,
} from '@/lib/replay'

const at = (ms: number) => new Date(Date.UTC(2026, 10, 16, 12, 0, 0, 0) + ms).toISOString()
const T0 = Date.UTC(2026, 10, 16, 12, 0, 0, 0)

const logs = [{ ts: at(0), n: 'a' }, { ts: at(1500), n: 'b' }, { ts: at(3200), n: 'c' }]
const metrics = [
  { ts: at(500), cpu: 90 },
  { ts: at(1500), cpu: 380 },
  { ts: at(2500), cpu: 40 },
]

describe('timelineOf', () => {
  it('empieza en el primer dato y dura hasta el último', () => {
    expect(timelineOf(logs, metrics, null)).toEqual({ t0: T0, duration: 3200 })
  })

  it('si el servidor dice que duró más, manda esa duración', () => {
    expect(timelineOf(logs, metrics, 5000).duration).toBe(5000)
  })

  it('sin datos con hora usa la duración del servidor; sin nada, 0', () => {
    expect(timelineOf([], [], 4200)).toEqual({ t0: 0, duration: 4200 })
    expect(timelineOf([], [], null)).toEqual({ t0: 0, duration: 0 })
  })

  it('ignora marcas de tiempo ilegibles', () => {
    expect(timelineOf([{ ts: 'no es fecha' }, { ts: at(100) }], [], null).t0).toBe(T0 + 100)
  })
})

describe('logsUntil / metricsUntil / metricAt', () => {
  it('muestran solo lo que ya había llegado en ese instante', () => {
    expect(logsUntil(logs, T0, 0).map((l) => l.n)).toEqual(['a'])
    expect(logsUntil(logs, T0, 1500).map((l) => l.n)).toEqual(['a', 'b'])
    expect(logsUntil(logs, T0, 99999).map((l) => l.n)).toEqual(['a', 'b', 'c'])
  })

  it('al final del recorrido muestran TODO (igual que lo real)', () => {
    const { t0, duration } = timelineOf(logs, metrics, null)
    expect(logsUntil(logs, t0, duration)).toHaveLength(logs.length)
    expect(metricsUntil(metrics, t0, duration)).toHaveLength(metrics.length)
  })

  it('metricAt es la última muestra a esa altura, o null si aún no había', () => {
    expect(metricAt(metrics, T0, 100)).toBeNull()
    expect(metricAt(metrics, T0, 1600)?.cpu).toBe(380)
    expect(metricAt(metrics, T0, 9000)?.cpu).toBe(40)
  })

  it('no mutan la entrada', () => {
    const copy = [...logs]
    logsUntil(logs, T0, 10)
    expect(logs).toEqual(copy)
  })
})

describe('threadActivity', () => {
  it('es la CPU real repartida a partes iguales: 200 % entre 4 hilos = 50 % cada uno', () => {
    expect(threadActivity(200, 4)).toBeCloseTo(0.5, 5)
    expect(threadActivity(400, 4)).toBeCloseTo(0.98, 2) // tope visual (nunca un anillo «roto»)
    expect(threadActivity(100, 1)).toBeCloseTo(0.98, 2)
  })

  it('no inventa nada: sin azar ni ondulación, la misma CPU da siempre lo mismo', () => {
    const a = Array.from({ length: 20 }, () => threadActivity(173, 8))
    expect(new Set(a).size).toBe(1)
  })

  it('más CPU, más actividad', () => {
    expect(threadActivity(380, 4)).toBeGreaterThan(threadActivity(50, 4))
  })

  it('siempre dentro de [0.15, 0.98], también con valores absurdos', () => {
    for (const cpu of [null, 0, 5, 400, 9999, -20]) {
      const v = threadActivity(cpu, 4)
      expect(v).toBeGreaterThanOrEqual(0.15)
      expect(v).toBeLessThanOrEqual(0.98)
    }
  })

  it('sin muestra todavía queda en reposo (baja)', () => {
    expect(threadActivity(null, 4)).toBeLessThan(0.3)
  })
})

describe('fmtClock / fmtSpeed', () => {
  it('minutos:segundos.décimas', () => {
    expect(fmtClock(0)).toBe('0:00.0')
    expect(fmtClock(3250)).toBe('0:03.2')
    expect(fmtClock(65_400)).toBe('1:05.4')
    expect(fmtClock(-5)).toBe('0:00.0')
  })

  it('la velocidad se escribe corta', () => {
    expect(fmtSpeed(1)).toBe('1×')
    expect(fmtSpeed(0.25)).toBe('0.25×')
    expect(fmtSpeed(0.5)).toBe('0.5×')
    expect(fmtSpeed(4)).toBe('4×')
  })

  it('rango del deslizante', () => {
    expect([SPEED_MIN, SPEED_MAX]).toEqual([0.25, 4])
  })
})
