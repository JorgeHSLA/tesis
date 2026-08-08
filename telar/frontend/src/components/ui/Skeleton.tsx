// Skeleton — ÚNICA forma permitida de estado de carga (frontend-spec §6):
// siluetas del layout, sin spinners globales. La animación (opacidad) se
// suprime con prefers-reduced-motion (regla global de base.css).
import type { CSSProperties } from 'react'

export interface SkeletonProps {
  width?: number | string
  height?: number | string
  /** border-radius CSS (por defecto var(--r-md)). */
  radius?: number | string
  style?: CSSProperties
  className?: string
}

export function Skeleton({ width = '100%', height = 16, radius, style, className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={['skeleton', className].filter(Boolean).join(' ')}
      style={{ width, height, ...(radius != null ? { borderRadius: radius } : null), ...style }}
    />
  )
}

/** Fallback de Suspense por pantalla (router §2): silueta genérica. */
export function ScreenSkeleton() {
  return (
    <div className="screen-skeleton" role="status" aria-label="Cargando pantalla">
      <div>
        <Skeleton width={160} height={12} style={{ marginBottom: 10 }} />
        <Skeleton width={380} height={30} />
      </div>
      <div className="skeleton-grid">
        <Skeleton height={120} radius="var(--r-lg)" />
        <Skeleton height={120} radius="var(--r-lg)" />
        <Skeleton height={120} radius="var(--r-lg)" />
      </div>
      <Skeleton height={260} radius="var(--r-lg)" />
    </div>
  )
}
