// hooks/useBrokenImageFallback.ts — si una imagen de la lección no carga (sin
// internet, o el archivo ya no existe en la nube), en lugar de un icono roto se
// muestra un aviso con el texto alternativo.
//
// Las imágenes viven en el bucket de Telar y se piden al leer la lección (igual
// que el video de YouTube), así que sin conexión no están. El aviso lo dice.
//
// Los errores de carga de <img> NO burbujean, pero sí se pueden capturar en la
// fase de captura del contenedor: un solo listener cubre todas las imágenes, aun
// cuando `dangerouslySetInnerHTML` regenere el HTML. Se entrega como REF DE
// CALLBACK (y no con useEffect) porque el contenedor puede montarse y
// desmontarse (pestañas): así el listener lo sigue donde esté.
import { useCallback, useRef } from 'react'

export const BROKEN_IMAGE_TEXT = 'Imagen no disponible. Revisa tu conexión a internet.'

function onError(e: Event): void {
  const img = e.target
  if (!(img instanceof HTMLImageElement) || !img.classList.contains('md-img')) return
  const alt = img.getAttribute('alt')
  const note = document.createElement('span')
  note.className = 'md-img-missing'
  note.setAttribute('role', 'img')
  note.setAttribute('aria-label', alt ? `${BROKEN_IMAGE_TEXT} (${alt})` : BROKEN_IMAGE_TEXT)
  note.textContent = alt ? `${BROKEN_IMAGE_TEXT} «${alt}»` : BROKEN_IMAGE_TEXT
  img.replaceWith(note)
}

/** Ref para el contenedor `.markdown`: `<div ref={brokenImageRef} …/>`. */
export function useBrokenImageFallback(): (el: HTMLElement | null) => void {
  const current = useRef<HTMLElement | null>(null)
  return useCallback((el: HTMLElement | null) => {
    current.current?.removeEventListener('error', onError, true)
    current.current = el
    el?.addEventListener('error', onError, true)
  }, [])
}
