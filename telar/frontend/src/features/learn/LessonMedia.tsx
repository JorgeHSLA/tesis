// LessonMedia — el bloque grande de la lección es un REPRODUCTOR DE VIDEO
// (queja #3, 2026-07; sustituye al antiguo CodeShowcase de código). La fuente
// (mp4 en disco o URL externa) la resuelve `lessonVideos.ts`; si no hay ninguna,
// muestra un placeholder "Video próximamente". Debajo, un CTA SECUNDARIO chico
// "Ejecutar en el simulador" (el CTA primario naranja "Probar en el simulador"
// sigue en LessonInfo). El video NO hace autoplay (nunca con sonido) y usa los
// controles nativos; `prefers-reduced-motion` se respeta al no autoreproducir.
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
  const run = () => navigate(`/simulador?ejemplo=${encodeURIComponent(exampleId)}`)

  return (
    <div className="lesson-media">
      <div className="lesson-media-screen">
        {videoSrc ? (
          // TODO(a11y, WCAG 1.2.2): cuando existan videos reales, añadir un
          // <track kind="captions"> por lección. El valor de LESSON_VIDEOS puede
          // evolucionar de string a { src, captions } sin tocar contratos.
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
        ) : (
          <div className="lesson-media-placeholder" role="note">
            <span className="lesson-media-placeholder-icon" aria-hidden="true">
              <IconPlay size={26} />
            </span>
            <span className="lesson-media-placeholder-title">Video próximamente</span>
            <span className="lesson-media-placeholder-sub">Esta lección aún no tiene video.</span>
          </div>
        )}
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
