// Card — .card / .card-head / .card-title / .card-sub / .card-pad (handoff §2.3).
import type { ComponentPropsWithoutRef, ReactNode } from 'react'

export interface CardProps extends ComponentPropsWithoutRef<'section'> {
  children?: ReactNode
}

export function Card({ className, children, ...rest }: CardProps) {
  return (
    <section className={['card', className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </section>
  )
}

export interface CardHeadProps {
  /** Icono a la izquierda (típicamente <IconX size={16}/>). */
  icon?: ReactNode
  title: ReactNode
  /** Texto secundario (.card-sub). */
  sub?: ReactNode
  /** Contenido alineado a la derecha (botones, mono-small…). */
  right?: ReactNode
}

export function CardHead({ icon, title, sub, right }: CardHeadProps) {
  return (
    <header className="card-head">
      {icon}
      <span className="card-title">{title}</span>
      {sub != null && <span className="card-sub">{sub}</span>}
      {right != null && <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>{right}</span>}
    </header>
  )
}

export function CardPad({ className, children, ...rest }: ComponentPropsWithoutRef<'div'>) {
  return (
    <div className={['card-pad', className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </div>
  )
}
