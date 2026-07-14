// lib/observations.ts — motor de reglas de la card «Observaciones»
// (frontend-spec §6.4). Opera SOLO sobre datos reales del backend:
// parsed_timings + status/stderr del job + metadata del ejemplo.
// Tipos obs-warn / obs-ok / obs-info del handoff (§6.3).
import type { JobDetailDto, ParsedTimingsPairDto, ParsedTimingsSweepDto } from '../api/types'
import { amdahlParallelFraction, amdahlPredictedSpeedup, bestSweepPoint, maxThreadsPoint } from './speedup'

export type ObsKind = 'warn' | 'ok' | 'info'

export interface Observation {
  kind: ObsKind
  /** Título en negrita (termina en punto, como el handoff). */
  title: string
  body: string
}

/** Plantillas didácticas por example_id para el warn de bajo speedup (§6.4). */
const LOW_SPEEDUP_TEMPLATES: Record<string, string> = {
  spmd:
    'No es un bug: las casillas de partial comparten línea de caché — false sharing. ' +
    'Compara con spmdCritical.',
  spmdCritical:
    'La sección critical serializa la acumulación: los hilos se esperan entre sí. ' +
    'Compara la curva con la versión spmd con padding.',
  transporteParticulas:
    'Revisa si el tamaño del problema es suficiente: con poco trabajo por hilo, ' +
    'el overhead de crear el equipo domina el tiempo total.',
}

const GENERIC_LOW_SPEEDUP =
  'El overhead de sincronización o el acceso a memoria compartida está limitando el escalado. ' +
  'Revisa la lección asociada para el análisis de este patrón.'

function fmtX(v: number): string {
  return `${v.toFixed(1)}×`
}

function sweepObservations(timings: ParsedTimingsSweepDto, exampleId: string | null): Observation[] {
  const out: Observation[] = []
  const top = maxThreadsPoint(timings)
  const best = bestSweepPoint(timings)
  if (top == null || best == null) return out

  if (top.threads >= 8 && top.speedup < 1.5) {
    out.push({
      kind: 'warn',
      title: 'Casi no hay speedup.',
      body: LOW_SPEEDUP_TEMPLATES[exampleId ?? ''] ?? GENERIC_LOW_SPEEDUP,
    })
  } else if (top.speedup >= 0.8 * top.threads) {
    out.push({
      kind: 'ok',
      title: 'Escala casi lineal.',
      body:
        `Este problema es compute-bound: con ${top.threads} hilos el speedup observado es ` +
        `${fmtX(top.speedup)} (eficiencia ${Math.round(top.efficiency * 100)}%), muy cerca del ideal.`,
    })
  }

  const p = amdahlParallelFraction(best.speedup, best.threads)
  if (p != null) {
    const predicted = amdahlPredictedSpeedup(p, best.threads)
    out.push({
      kind: 'info',
      title: `Speedup ${fmtX(best.speedup)} con ${best.threads} hilos.`,
      body:
        `La ley de Amdahl predice ~${fmtX(predicted)} para un código con ` +
        `${Math.round(p * 100)}% paralelizable — tu medición es consistente con esa fracción.`,
    })
  }
  return out
}

function pairObservations(timings: ParsedTimingsPairDto, threads: number): Observation[] {
  const out: Observation[] = []
  const s = timings.speedup_vs_reference
  if (Number.isFinite(s)) {
    if (s < 1) {
      out.push({
        kind: 'warn',
        title: `OpenMP fue ${fmtX(1 / s)} más lento que ${timings.reference_label}.`,
        body:
          'Las bibliotecas optimizadas (NumPy/BLAS) ya usan SIMD y memoria contigua: ' +
          'batir a una implementación madura requiere mucho más que paralelizar el bucle.',
      })
    }
    const p = amdahlParallelFraction(s, threads)
    out.push({
      kind: 'info',
      title: `Speedup ${fmtX(s)} vs ${timings.reference_label} con ${threads} hilos.`,
      body:
        p != null
          ? `La ley de Amdahl predice ~${fmtX(amdahlPredictedSpeedup(p, threads))} para un código con ` +
            `${Math.round(p * 100)}% paralelizable.`
          : `Comparación directa contra la referencia ${timings.reference_label} medida en la misma corrida.`,
    })
  }
  return out
}

function lastStderrLines(stderr: string | null, n: number): string[] {
  if (stderr == null || stderr.trim() === '') return []
  return stderr.trimEnd().split('\n').slice(-n)
}

/** Genera las observaciones de la pantalla de Resultados (§6.4). */
export function buildObservations(job: JobDetailDto): Observation[] {
  const out: Observation[] = []

  if (job.status === 'failed') {
    const lines = lastStderrLines(job.stderr, 3)
    out.push({
      kind: 'warn',
      title: job.oom_killed ? 'El proceso fue matado por falta de memoria (OOM).' : 'La ejecución terminó con error.',
      body:
        lines.length > 0
          ? `Últimas líneas de stderr:\n${lines.join('\n')}`
          : job.error_detail === 'output_limit_exceeded'
            ? 'La salida superó el límite de 256 KB y el job fue terminado.'
            : 'No hay stderr disponible; revisa el output completo.',
    })
  }

  const t = job.parsed_timings
  if (t != null) {
    if (t.kind === 'sweep') out.push(...sweepObservations(t, job.example_id))
    else out.push(...pairObservations(t, job.threads))

    if (t.correct === true) {
      out.push({
        kind: 'ok',
        title: 'Resultado validado.',
        body: 'El propio script verificó que el resultado paralelo coincide con la referencia (correcto? True).',
      })
    } else if (t.correct === false) {
      out.push({
        kind: 'warn',
        title: 'El resultado NO coincide con la referencia.',
        body:
          'El script reporta correcto? False: hay una condición de carrera o un reparto de datos incorrecto. ' +
          'Esa es exactamente la lección de este ejemplo.',
      })
    }
  }

  if (job.status === 'timeout') {
    out.push({
      kind: 'warn',
      title: `El job superó el límite de ${job.timeout_s}s.`,
      body:
        'El timeout incluye el arranque de Python y la compilación JIT de Numba. ' +
        'Reduce el tamaño del problema o sube el timeout en Opciones avanzadas.',
    })
  }

  if (out.length === 0) {
    out.push({
      kind: 'info',
      title: 'Este ejemplo no auto-mide tiempos.',
      body:
        'El wall-time del job incluye la compilación JIT (la primera llamada compila), así que no sirve ' +
        'como métrica de speedup. Los ejemplos que barren hilos (piSpmd, transporteMonteCarlo) producen la curva completa.',
    })
  }

  // Orden estable: warn → ok → info (como el handoff).
  const rank: Record<ObsKind, number> = { warn: 0, ok: 1, info: 2 }
  return [...out].sort((a, b) => rank[a.kind] - rank[b.kind])
}
