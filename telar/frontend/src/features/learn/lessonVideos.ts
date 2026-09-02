// lessonVideos.ts — fuente de video por lección: URLs de YouTube NO LISTADO.
//
// Los videos NO se descargan ni se empaquetan: son enlaces a YouTube en modo
// «no listado» (visibles solo con el enlace, fuera de búsquedas y del canal).
// El reproductor es un <iframe>, no un <video>.
//
// La URL cruda puede llegar en cualquiera de las formas que YouTube reparte
// (`watch?v=`, `youtu.be/`, `/embed/`, `/shorts/`) y —importante— acabará
// viniendo del catálogo remoto, es decir de CONTENIDO NO CONFIABLE. Por eso
// aquí no se interpola nunca la URL recibida: se EXTRAE el id del video, se
// valida contra el formato de id de YouTube y se reconstruye una URL de embed
// canónica sobre `youtube-nocookie.com`. Cualquier cosa que no encaje devuelve
// `null` y la lección simplemente no muestra bloque de video.
//
// Segunda barrera, independiente: la CSP de Electron solo permite
// `frame-src https://www.youtube-nocookie.com` (electron-spec.md §7.1).

/** Id de video de YouTube: 11 caracteres del alfabeto base64url. */
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/

/** Hosts de YouTube aceptados, ya sin el prefijo `www.`/`m.`. */
const YOUTUBE_HOSTS = new Set(['youtube.com', 'youtube-nocookie.com'])

/** Origen canónico del embed: el dominio sin cookies de seguimiento. */
const EMBED_ORIGIN = 'https://www.youtube-nocookie.com/embed/'

/**
 * Mapa local `example_id → URL de YouTube`. Es el puente provisional hasta que
 * el video sea un campo de la lección servido por la API (y publicado por el
 * admin junto al resto del módulo). Cuando eso ocurra, `LessonMedia` recibirá
 * la URL por prop y este mapa desaparece sin tocar el resolver.
 */
const LESSON_VIDEOS: Readonly<Record<string, string>> = {
  // primerEjemplo: 'https://www.youtube.com/watch?v=XXXXXXXXXXX',
}

/** Extrae el id de video de una URL de YouTube, o `null` si no lo es. */
function extractVideoId(url: URL): string | null {
  // Solo https: descarta de golpe javascript:, data:, file: y http en claro.
  if (url.protocol !== 'https:') return null

  const host = url.hostname.toLowerCase().replace(/^(www\.|m\.)/, '')

  // Forma corta: youtu.be/<id>
  if (host === 'youtu.be') {
    const id = url.pathname.slice(1)
    return YOUTUBE_ID_RE.test(id) ? id : null
  }

  if (!YOUTUBE_HOSTS.has(host)) return null

  // youtube.com/watch?v=<id>
  if (url.pathname === '/watch') {
    const id = url.searchParams.get('v') ?? ''
    return YOUTUBE_ID_RE.test(id) ? id : null
  }

  // youtube.com/embed/<id>  ·  youtube.com/shorts/<id>
  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length === 2 && (segments[0] === 'embed' || segments[0] === 'shorts')) {
    return YOUTUBE_ID_RE.test(segments[1]) ? segments[1] : null
  }

  return null
}

/** Segundo de arranque (`?t=` o `?start=`), solo si es un entero no negativo. */
function extractStartSeconds(url: URL): number | null {
  const raw = url.searchParams.get('start') ?? url.searchParams.get('t')
  if (raw === null || !/^\d+$/.test(raw)) return null
  const seconds = Number.parseInt(raw, 10)
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : null
}

/**
 * Normaliza una URL de YouTube a su embed canónico en `youtube-nocookie.com`,
 * o `null` si no es una URL de video de YouTube válida.
 *
 * `rel=0` limita los vídeos sugeridos del final al mismo canal y
 * `modestbranding=1` reduce el marcaje de YouTube: para una lección, lo que
 * aparezca al terminar no debería sacar al estudiante del curso.
 */
export function resolveYouTubeEmbed(raw: string | null | undefined): string | null {
  const value = raw?.trim()
  if (!value) return null

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null // no es una URL absoluta: se descarta sin más
  }

  const id = extractVideoId(url)
  if (id === null) return null

  const params = new URLSearchParams({ rel: '0', modestbranding: '1' })
  const start = extractStartSeconds(url)
  if (start !== null) params.set('start', String(start))

  return `${EMBED_ORIGIN}${id}?${params.toString()}`
}

/** Embed de un ejemplo según el mapa local, o `null` si no tiene video. */
export function resolveLessonVideo(exampleId: string): string | null {
  return resolveYouTubeEmbed(LESSON_VIDEOS[exampleId])
}
