// unsaved-changes.ts — confirmación al cerrar/recargar con cambios sin guardar
// (CU-13.1, 14.1, 17.3, 18.4, 21.2, 39.4, 40.2). La Autoría registra un
// `beforeunload` que cancela la descarga mientras hay cambios
// (frontend/src/hooks/useUnsavedChangesGuard.tsx). En un navegador eso abre
// su diálogo nativo; en Electron NO se muestra nada y la ventana simplemente
// no se cierra, así que aquí se pregunta con un diálogo propio.
// `event.preventDefault()` en `will-prevent-unload` IGNORA el beforeunload y
// deja que la ventana se cierre (o recargue).
import { dialog, type BrowserWindow } from 'electron'

export const SALIR = 0
export const SEGUIR = 1

/** El diálogo: Enter, Escape y cerrarlo sin elegir equivalen a «Seguir editando». */
export const OPCIONES_DIALOGO = {
  type: 'warning' as const,
  buttons: ['Salir sin guardar', 'Seguir editando'],
  defaultId: SEGUIR,
  cancelId: SEGUIR,
  noLink: true,
  title: 'Cambios sin guardar',
  message: 'Tienes cambios sin guardar.',
  detail: 'Si sales ahora perderás los cambios que no has guardado.',
}

/** Solo el botón «Salir sin guardar» deja cerrar/recargar la ventana. */
export function debePermitirSalir(choice: number): boolean {
  return choice === SALIR
}

export function attachUnsavedChangesPrompt(win: BrowserWindow): void {
  win.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(win, OPCIONES_DIALOGO)
    if (debePermitirSalir(choice)) event.preventDefault()
  })
}
