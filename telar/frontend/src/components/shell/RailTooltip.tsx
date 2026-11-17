// RailTooltip — etiqueta flotante de los iconos del rail (menú lateral plegado).
//
// Por qué un PORTAL y no un `::after` de CSS (2026-11-16): el rail tenía
// tooltips con `::after`, pero `.sidebar-nav` hace scroll (`overflow-y: auto`) y
// eso recorta también en horizontal, así que el rótulo de los items del menú
// quedaba cortado y NUNCA se veía — justo lo que los estudiantes echaron en
// falta en las pruebas de usabilidad («no se sabe qué hace cada icono»). Un
// elemento `position: fixed` en `document.body` no depende de ningún contenedor.
//
// Uso: el padre da el `ref` de su <aside> y pone `data-tip="…"` en cualquier
// control. Con el menú expandido el rótulo ya está escrito al lado del icono,
// así que no se muestra nada (`enabled = false`).
import { useCallback, useEffect, useState, type FocusEvent, type MouseEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'

/** Separación entre el borde derecho del rail y el rótulo (igual que el panel de runtime). */
const GAP_PX = 10

interface Tip {
  text: string
  top: number
  left: number
}

export interface RailTooltipBinding {
  /** Props de eventos para el contenedor (delegación: una sola pareja de handlers). */
  handlers: {
    onMouseOver: (e: MouseEvent) => void
    onMouseLeave: () => void
    onFocus: (e: FocusEvent) => void
    onBlur: () => void
  }
  /** El rótulo ya montado en un portal (o `null` si no hay nada que mostrar). */
  tooltip: React.ReactNode
}

export function useRailTooltip(
  railRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): RailTooltipBinding {
  const [tip, setTip] = useState<Tip | null>(null)

  const hide = useCallback(() => setTip(null), [])

  const show = useCallback(
    (target: EventTarget | null) => {
      const rail = railRef.current
      if (!enabled || rail === null || !(target instanceof Element)) return setTip(null)
      const el = target.closest<HTMLElement>('[data-tip]')
      const text = el?.dataset.tip
      if (el === null || el === undefined || !rail.contains(el) || !text) return setTip(null)
      const r = el.getBoundingClientRect()
      setTip({ text, top: r.top + r.height / 2, left: rail.getBoundingClientRect().right + GAP_PX })
    },
    [enabled, railRef],
  )

  // Expandir el menú o salir de la pantalla no debe dejar un rótulo colgado.
  useEffect(() => {
    if (!enabled) setTip(null)
  }, [enabled])

  // Un clic o un scroll ya respondieron a lo que el usuario quería saber.
  useEffect(() => {
    if (tip === null) return
    const close = () => setTip(null)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [tip])

  const tooltip =
    tip === null
      ? null
      : createPortal(
          <div className="rail-tip" role="tooltip" style={{ top: tip.top, left: tip.left }}>
            {tip.text}
          </div>,
          document.body,
        )

  return {
    handlers: {
      onMouseOver: (e) => show(e.target),
      onMouseLeave: hide,
      // Con teclado solo cuenta el foco VISIBLE; un clic con ratón también enfoca
      // y no debe dejar el rótulo pegado.
      onFocus: (e) => {
        if (e.target instanceof HTMLElement && e.target.matches(':focus-visible')) show(e.target)
      },
      onBlur: hide,
    },
    tooltip,
  }
}
