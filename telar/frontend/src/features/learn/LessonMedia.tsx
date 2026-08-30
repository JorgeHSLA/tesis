// LessonMedia — reproductor de video de la lección, OPCIONAL.
//
// El video es un embed de YouTube NO LISTADO (una URL, nunca un .mp4
// descargado), así que el reproductor es un <iframe> al dominio sin cookies
// `youtube-nocookie.com`. La URL la normaliza y valida `lessonVideos.ts` antes
// de llegar aquí; la CSP de Electron acota el origen permitido
// (electron-spec.md §7.1).
//
// C1: el componente NO pinta placeholder «Video próximamente». Sin fuente
// devuelve `null` y la lección empieza directamente por su contenido, en vez
// de abrir con un hueco gris.
//
// E1: la lección puede no tener ejemplo. Entonces no hay CTA al simulador —no
// un botón deshabilitado, sino ninguno—: no existe código que ejecutar.
//
// Accesibilidad: el `title` del iframe es su nombre accesible (WCAG 4.1.2).
// Los subtítulos (WCAG 1.2.2) pasan a ser responsabilidad del video en YouTube:
// hay que activarlos al subirlo, no hay `<track>` que añadir aquí.
import { useNavigate } from 'react-router-dom'
import { IconPlay } from '../../components/icons/icons'
import { resolveLessonVideo, resolveYouTubeEmbed } from './lessonVideos'

export interface LessonMediaProps {
  lessonId: string
  /**
   * URL de YouTube servida por la API (`LessonDetailDto.video_url`). Si es
   * `undefined` se cae al mapa local por `exampleId`, el puente que queda
   * mientras haya contenido sembrado sin el campo.
   */
  videoUrl?: string | null
  /** E1: `null` en una lección conceptual. */
  exampleId: string | null
  /** E1: `null` cuando no hay ejemplo. */
  filename: string | null
  /** Lección GPU sin GPU / deshabilitada: el CTA al simulador queda disabled. */
  runDisabled: boolean
}

export function LessonMedia({
  lessonId,
  videoUrl,
  exampleId,
  filename,
  runDisabled,
}: LessonMediaProps) {
  const navigate = useNavigate()
  const embedSrc =
    videoUrl === undefined
      ? exampleId != null
        ? resolveLessonVideo(exampleId)
        : null
      : resolveYouTubeEmbed(videoUrl)

  // Sin video no hay bloque: la lección arranca por su contenido, no por un hueco.
  if (embedSrc === null) return null

  const run = () => {
    if (exampleId != null) navigate(`/simulador?ejemplo=${encodeURIComponent(exampleId)}`)
  }

  return (
    <div className="lesson-media">
      <div className="lesson-media-screen">
        <iframe
          className="lesson-media-video"
          src={embedSrc}
          title={`Video de la lección (${filename ?? lessonId})`}
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
        />
      </div>
      {exampleId != null && (
        <div className="lesson-media-foot">
          <span className="mono-small">{filename}</span>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={run}
            disabled={runDisabled}
          >
            <IconPlay size={14} /> Ejecutar en el simulador
          </button>
        </div>
      )}
    </div>
  )
}
