// StatusChip — tabla ÚNICA de mapeo fase→chip (frontend-spec §6.3).
// Home y ResultsList reutilizan la parte terminal; el live usa todas.
import type { JobPhase } from '../../ws/messages'
import { Chip, type ChipTone } from './Chip'

/** Fases del contrato (8) + estados locales del cliente (§3.1). */
export type UiPhase = 'idle' | 'connecting' | 'lost' | JobPhase

interface PhaseSpec {
  label: string
  tone: ChipTone
  /** Color del dot pulsante (solo fases activas). */
  dot?: string
}

const PHASE_CHIP: Record<UiPhase, PhaseSpec> = {
  idle: { label: 'Conectando…', tone: 'neutral' },
  connecting: { label: 'Conectando…', tone: 'neutral' },
  queued: { label: 'Preparando', tone: 'orange', dot: 'var(--orange-500)' },
  creating: { label: 'Preparando', tone: 'orange', dot: 'var(--orange-500)' },
  compiling: { label: 'Compilando (JIT)', tone: 'orange', dot: 'var(--orange-500)' },
  running: { label: 'Ejecutando', tone: 'green', dot: 'var(--green-400)' },
  completed: { label: 'Finalizado', tone: 'green' },
  failed: { label: 'Error', tone: 'red' },
  timeout: { label: 'Timeout', tone: 'red' },
  cancelled: { label: 'Cancelado', tone: 'amber' },
  lost: { label: 'Conexión perdida', tone: 'red' },
}

export interface StatusChipProps {
  phase: UiPhase
  /** Texto alternativo (p. ej. `EN VIVO` en RecentJobs). */
  label?: string
}

export function StatusChip({ phase, label }: StatusChipProps) {
  const spec = PHASE_CHIP[phase]
  return (
    <Chip tone={spec.tone} dot={spec.dot} role="status">
      {label ?? spec.label}
    </Chip>
  )
}

/** Exportada para quien necesite solo el texto/tono (tablas, tests). */
export function phaseChipSpec(phase: UiPhase): { label: string; tone: ChipTone } {
  const { label, tone } = PHASE_CHIP[phase]
  return { label, tone }
}
