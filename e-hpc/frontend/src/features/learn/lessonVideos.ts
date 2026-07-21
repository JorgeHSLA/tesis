// lessonVideos.ts — fuente de video por lección (queja #3, 2026-07).
//
// El bloque grande de la lección es un REPRODUCTOR DE VIDEO. La fuente se
// declara aquí, keyed por `example_id`, y admite DOS FORMAS:
//
//   1) URL externa:   'https://cdn.ejemplo.com/leccion.mp4'
//   2) .mp4 EN DISCO:  ruta relativa a `public/` (se bundlea en `dist/`), p.ej.
//      'media/videos/primerEjemplo.mp4'. Coloca el archivo en
//      `frontend/public/media/videos/` y referéncialo con esa ruta.
//
// Si una lección NO está en el mapa (o su valor está vacío) → el reproductor
// muestra el placeholder "Video próximamente". Se resuelve en frontend (sin
// tocar los contratos congelados); cuando haya videos, basta con añadir aquí la
// entrada (o subir el .mp4 a public/media/videos/).
const LESSON_VIDEOS: Readonly<Record<string, string>> = {
  // Ejemplos (comentados hasta que existan los videos):
  // primerEjemplo: 'media/videos/primerEjemplo.mp4',   // .mp4 en disco
  // spmd: 'https://cdn.ejemplo.com/spmd.mp4',           // URL externa
}

// Externa = URL con ESQUEMA explícito (https://, http://). Se exige el esquema a
// propósito: así una ruta en disco mal tecleada con doble slash ('//media/…') NO
// se confunde con una URL protocol-relative (que apuntaría al host "media" y daría
// un video roto en silencio); cualquier '//…' se trata como ruta local.
const ABSOLUTE_URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i

/**
 * Resuelve una fuente de video cruda a un `src` usable, o `null` si está vacía.
 * Una URL externa (con esquema) se devuelve tal cual; una ruta en disco se
 * resuelve contra `BASE_URL` (el build usa base './'), de modo que funcione
 * tanto en web (nginx) como en Electron (carga por `file://`). Los slashes
 * iniciales de la ruta se normalizan. Pura (sin el mapa) → testeable.
 */
export function resolveVideoSrc(raw: string | undefined): string | null {
  const value = raw?.trim()
  if (!value) return null
  if (ABSOLUTE_URL_RE.test(value)) return value
  const base = import.meta.env.BASE_URL || './'
  return base.replace(/\/?$/, '/') + value.replace(/^\/+/, '')
}

/** Fuente de video de un ejemplo según el mapa, o `null` si no hay ninguna. */
export function resolveLessonVideo(exampleId: string): string | null {
  return resolveVideoSrc(LESSON_VIDEOS[exampleId])
}
