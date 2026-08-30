// LessonMedia — reproductor de video de la lección, OPCIONAL.
//
// 2026-08: el componente ya NO pinta un placeholder «Video próximamente». Con el
// mapa de videos vacío, ese placeholder era el bloque grande y primero de las 14
// lecciones: la pantalla abría mostrando un hueco gris en vez de la lección
// (hallazgo C1 de la revisión previa al refactor). Sin fuente de video el
// componente devuelve `null` y la lección empieza directamente por su contenido.
//
// La fuente (mp4 en disco o URL externa) la resuelve `lessonVideos.ts`. El video
// NO hace autoplay (nunca con sonido) y usa los controles nativos;
// `prefers-reduced-motion` se respeta al no autoreproducir.
import { useNavigate } from 'react-router-dom'
import { IconPlay } from '../../components/icons/icons'
import { resolveLessonVideo } from './lessonVideos'

export interface LessonMediaProps {
  exampleId: string
  filename: string
  /** Lección GPU sin GPU / deshabilitada: el CTA al simulador queda disabled. */
  runDisabled: boolean
}

export function LessonMedia({ exampleId, filename, runDisabled }: LessonMediaProps) {
  const navigate = useNavigate()
  const videoSrc = resolveLessonVideo(exampleId)
  // Sin video no hay bloque: la lección arranca por su contenido, no por un hueco.
  if (videoSrc === null) return null

  const run = () => navigate(`/simulador?ejemplo=${encodeURIComponent(exampleId)}`)

  return (
    <div className="lesson-media">
      <div className="lesson-media-screen">
        {/* TODO(a11y, WCAG 1.2.2): cuando existan videos reales, añadir un
            <track kind="captions"> por lección. El valor de LESSON_VIDEOS puede
            evolucionar de string a { src, captions } sin tocar contratos. */}
        <video
          className="lesson-media-video"
          src={videoSrc}
          controls
          preload="metadata"
          playsInline
          aria-label={`Video de la lección (${filename})`}
        >
          Tu navegador no puede reproducir este video.
        </video>
      </div>
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
    </div>
  )
}
