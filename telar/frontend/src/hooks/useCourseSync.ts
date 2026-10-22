// useCourseSync — descarga el curso desde el catálogo al arrancar la app.
//
// La app no trae contenido propio: todo el curso vive en la nube y
// `POST /catalog/sync` trae los módulos que falten. En escritorio el backend
// tarda en levantar (Docker), así que si la llamada no llega se reintenta cada
// `retryMs` hasta que el backend responda. Una vez por sesión: el store
// recuerda que ya terminó.
import { useEffect } from 'react'
import { useCatalogStore } from '../stores/catalogStore'

export const COURSE_SYNC_RETRY_MS = 10_000

export function useCourseSync(retryMs: number = COURSE_SYNC_RETRY_MS): void {
  const syncCourse = useCatalogStore((s) => s.syncCourse)

  useEffect(() => {
    let alive = true
    let timer: number | undefined
    const attempt = async (): Promise<void> => {
      const done = await syncCourse()
      if (!done && alive) timer = window.setTimeout(() => void attempt(), retryMs)
    }
    void attempt()
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [syncCourse, retryMs])
}
