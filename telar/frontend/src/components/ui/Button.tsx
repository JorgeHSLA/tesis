// Button — clases .btn del handoff (§2.2): default | primary | ghost | outline
// × tamaños sm | md | lg | xl.
import type { ComponentPropsWithoutRef } from 'react'

export interface ButtonProps extends ComponentPropsWithoutRef<'button'> {
  variant?: 'default' | 'primary' | 'ghost' | 'outline'
  size?: 'sm' | 'md' | 'lg' | 'xl'
}

const VARIANT_CLASS: Record<NonNullable<ButtonProps['variant']>, string> = {
  default: '',
  primary: 'btn-primary',
  ghost: 'btn-ghost',
  outline: 'btn-outline',
}

const SIZE_CLASS: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'btn-sm',
  md: '',
  lg: 'btn-lg',
  xl: 'btn-xl',
}

export function Button({ variant = 'default', size = 'md', className, type, children, ...rest }: ButtonProps) {
  const cls = ['btn', VARIANT_CLASS[variant], SIZE_CLASS[size], className].filter(Boolean).join(' ')
  return (
    <button type={type ?? 'button'} className={cls} {...rest}>
      {children}
    </button>
  )
}
