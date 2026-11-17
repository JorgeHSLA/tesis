// HelpTip — un «?» pequeño junto a un dato que, al pulsarlo, explica en pocas
// líneas qué significa. Pedido tras las pruebas de usabilidad: varios estudiantes
// no entendían las métricas ni la gráfica de Resultados («speedup», «eficiencia»,
// «CPU 400 %»…).
//
// Es un botón de verdad (teclado, lector de pantalla): se abre con clic o con
// Enter/Espacio y se cierra con Escape, un clic fuera o volviendo a pulsarlo. No
// se abre al pasar el cursor a propósito: una explicación que aparece sola tapa
// justo lo que se está leyendo.
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export interface HelpTipProps {
  /** De qué trata, para el nombre accesible: «Ayuda: speedup». */
  topic: string
  /** Título corto del recuadro (por defecto, el tema). */
  title?: string
  children: ReactNode
  /** Alinea el recuadro a la derecha del botón (para los que están al borde derecho). */
  alignEnd?: boolean
}

export function HelpTip({ topic, title, children, alignEnd = false }: HelpTipProps) {
  const [open, setOpen] = useState(false)
  // Hacia dónde se abre el recuadro: por defecto abajo y a la derecha del botón; si no cabe
  // en la ventana, se voltea (un recuadro que se sale agranda la pantalla y crea scroll).
  const [flip, setFlip] = useState<{ end: boolean; up: boolean }>({ end: false, up: false })
  const popRef = useRef<HTMLSpanElement>(null)
  const rootRef = useRef<HTMLSpanElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const id = useId()

  useLayoutEffect(() => {
    if (!open) {
      setFlip({ end: false, up: false })
      return
    }
    const pop = popRef.current
    const btn = btnRef.current
    if (pop === null || btn === null) return
    // Se mide con la posición por defecto (flip en falso) ANTES de pintar: sin parpadeo.
    const r = pop.getBoundingClientRect()
    const b = btn.getBoundingClientRect()
    const end = r.right > window.innerWidth - 8 && b.right - r.width >= 8
    const up = r.bottom > window.innerHeight - 8 && b.top - r.height - 8 >= 8
    if (end || up) setFlip({ end, up })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        btnRef.current?.focus()
      }
    }
    const onDown = (e: MouseEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open])

  return (
    <span className="help-tip" ref={rootRef}>
      <button
        ref={btnRef}
        type="button"
        className="help-tip-btn"
        aria-label={`Ayuda: ${topic}`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true">?</span>
      </button>
      {open && (
        <span
          id={id}
          ref={popRef}
          role="note"
          className={'help-tip-pop' + (alignEnd || flip.end ? ' is-end' : '') + (flip.up ? ' is-up' : '')}
        >
          <span className="help-tip-title">{title ?? topic}</span>
          <span className="help-tip-body">{children}</span>
        </span>
      )}
    </span>
  )
}
