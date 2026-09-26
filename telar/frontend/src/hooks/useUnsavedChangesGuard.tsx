// hooks/useUnsavedChangesGuard.tsx — la ÚNICA guarda de «cambios sin guardar»
// de la Autoría (CU-13.1, 14.1, 17.3, 18.4, 21.2, 39.4, 40.2). Con `dirty`:
//  1. `useBlocker` detiene TODA navegación del router (enlaces, «atrás», y
//     también la que solo cambia la query) y pregunta con un ConfirmDialog;
//  2. `beforeunload` hace que el navegador pregunte al recargar o cerrar la
//     pestaña (en Electron, el main lo convierte en su propio diálogo con
//     `will-prevent-unload`);
//  3. `confirm(action)` es la misma pregunta para cerrar un modal (Escape,
//     clic fuera, Cancelar): sin cambios, `action` corre al momento.
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { useBlocker, useLocation } from 'react-router-dom'
import { ConfirmDialog } from '../components/admin/ConfirmDialog'

export interface UnsavedChangesGuard {
  /** Ejecuta `action`; si hay cambios, solo tras confirmar que se descartan. */
  confirm: (action: () => void) => void
  /** Deja pasar la próxima navegación (p. ej. tras guardar y salir). */
  allowNavigation: () => void
  /** Hay una pregunta abierta: un modal debe ignorar su propio Escape. */
  asking: boolean
  /** El diálogo de confirmación: renderízalo una vez, fuera de otro modal. */
  dialog: ReactElement
}

export function useUnsavedChangesGuard(dirty: boolean): UnsavedChangesGuard {
  const bypass = useRef(false)
  const location = useLocation()
  // El permiso de `allowNavigation` vale para UNA navegación: al llegar a la
  // nueva ubicación (el mismo componente puede seguir montado) se retira.
  useEffect(() => {
    bypass.current = false
  }, [location.key])

  const blocker = useBlocker(() => dirty && !bypass.current)
  const [pending, setPending] = useState<(() => void) | null>(null)

  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = '' // navegadores que aún exigen returnValue
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  const confirm = useCallback(
    (action: () => void) => {
      if (dirty) setPending(() => action)
      else action()
    },
    [dirty],
  )
  const allowNavigation = useCallback(() => {
    bypass.current = true
  }, [])

  const blocked = blocker.state === 'blocked'
  // Puede haber a la vez un cierre de modal pendiente y una navegación
  // bloqueada (p. ej. «atrás» con la pregunta abierta): una sola respuesta
  // resuelve las dos, igual que onCancel.
  const onConfirm = () => {
    if (pending != null) {
      setPending(null)
      pending()
    }
    if (blocked) blocker.proceed()
  }
  const onCancel = () => {
    setPending(null)
    if (blocked) blocker.reset()
  }

  const dialog = (
    <ConfirmDialog
      open={blocked || pending != null}
      tone="danger"
      title="Cambios sin guardar"
      body="Si sales ahora perderás los cambios que no has guardado. ¿Quieres salir de todos modos?"
      confirmLabel="Salir sin guardar"
      cancelLabel="Seguir editando"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )

  return { confirm, allowNavigation, asking: blocked || pending != null, dialog }
}
