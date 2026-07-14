// hooks/useSimulation.ts — motor SOLO DECORATIVO (frontend-spec §5.3).
// Alimenta la parte ilustrativa de LiveTopology y la columna «Actividad»
// (etiquetada `ilustrativa`) mientras el job corre. NO genera logs, métricas
// ni progreso (eso es del WS). Tick 700 ms con jitter; con reducedMotion no
// hay tick (nodos estáticos, sin paquetes SMIL); running=false congela el
// último estado.
import { useEffect, useState } from 'react'

export interface DecorNode {
  id: string
  kind: 'master' | 'thread'
  /** Actividad ilustrativa 0..1 (jitter por tick de 700 ms). */
  activity: number
}

export interface UseSimulationOpts {
  threads: number
  running: boolean
  reducedMotion: boolean
}

const TICK_MS = 700

function clamp01(v: number): number {
  return Math.min(0.98, Math.max(0.15, v))
}

function makeNodes(threads: number): DecorNode[] {
  const master: DecorNode = { id: 'master', kind: 'master', activity: 0.35 }
  const workers: DecorNode[] = Array.from({ length: Math.max(1, threads) }, (_, i) => ({
    id: `t${i}`,
    kind: 'thread' as const,
    activity: clamp01(0.65 + Math.random() * 0.3),
  }))
  return [master, ...workers]
}

function jitterNodes(nodes: DecorNode[]): DecorNode[] {
  return nodes.map((n) => ({
    ...n,
    activity: clamp01(n.activity + (Math.random() - 0.5) * (n.kind === 'master' ? 0.08 : 0.16)),
  }))
}

export function useSimulation({ threads, running, reducedMotion }: UseSimulationOpts): { nodes: DecorNode[] } {
  const [nodes, setNodes] = useState<DecorNode[]>(() => makeNodes(threads))

  // Reconstruir cuando cambia el número de hilos (llega del GET del job).
  useEffect(() => {
    setNodes(makeNodes(threads))
  }, [threads])

  useEffect(() => {
    if (!running || reducedMotion) return // congela el último estado
    const id = setInterval(() => setNodes((prev) => jitterNodes(prev)), TICK_MS)
    return () => clearInterval(id)
  }, [running, reducedMotion, threads])

  return { nodes }
}
