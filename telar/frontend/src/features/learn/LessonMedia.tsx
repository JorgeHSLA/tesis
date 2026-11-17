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
// Mini reproductor: al hacer scroll hacia abajo y dejar el video fuera de la
// pantalla, el MISMO reproductor pasa a una esquina (abajo a la derecha) para
// seguir viéndolo mientras se lee; al volver arriba regresa a su sitio. Se hace
// solo con CSS (`position: fixed` sobre el marco que ya existe), sin mover el
// iframe a otro lugar del árbol: mover o recrear un iframe lo recarga y YouTube
// reiniciaría el video. El hueco original (`.lesson-media-slot`) conserva su
// tamaño para que el texto no salte.
//
// El mini reproductor solo aparece si el video SE ESTÁ REPRODUCIENDO al bajar a
// leer (si está sin empezar o en pausa no tiene sentido abrir una ventanita que
// tapa el texto). El estado lo da el propio reproductor por postMessage
// (lessonVideos.ts). Si por cualquier motivo nunca llega, se conserva el
// comportamiento anterior: el mini aparece.
//
// Accesibilidad: el `title` del iframe es su nombre accesible (WCAG 4.1.2).
// Los subtítulos (WCAG 1.2.2) pasan a ser responsabilidad del video en YouTube:
// hay que activarlos al subirlo, no hay `<track>` que añadir aquí.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon, IconChevronUp, IconPlay } from '../../components/icons/icons'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import {
  PLAYER_LISTEN_MESSAGE,
  YOUTUBE_PLAYER_ORIGIN,
  isPlayingState,
  parsePlayerState,
  resolveLessonVideo,
  resolveYouTubeEmbed,
  withPlayerEvents,
} from './lessonVideos'

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
  const reducedMotion = useReducedMotion()
  const slotRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  /** Lo último que dijo el reproductor: 'unknown' hasta que avise. */
  const playback = useRef<'unknown' | 'playing' | 'idle'>('unknown')
  /** ¿Estaba el mini a la vista? (para animar el regreso al sitio original). */
  const wasMini = useRef(false)
  /** Al bajar, ¿se estaba reproduciendo? Si no, no se abre el mini. */
  const [miniEligible, setMiniEligible] = useState(true)
  /** El marco acaba de volver a su sitio: pequeña animación de regreso. */
  const [returning, setReturning] = useState(false)
  /** El video ya salió por ARRIBA de la pantalla (el estudiante bajó a leer). */
  const [scrolledPast, setScrolledPast] = useState(false)
  /** El estudiante cerró el mini reproductor: no vuelve hasta que regrese al video. */
  const [dismissed, setDismissed] = useState(false)
  /** Cambiar la `key` del iframe lo recrea: es lo que detiene la reproducción al cerrar. */
  const [playerKey, setPlayerKey] = useState(0)

  const embedSrc =
    videoUrl === undefined
      ? exampleId != null
        ? resolveLessonVideo(exampleId)
        : null
      : resolveYouTubeEmbed(videoUrl)

  const hasVideo = embedSrc !== null
  const playerSrc = embedSrc === null ? null : withPlayerEvents(embedSrc)

  // Estados del reproductor (solo mensajes del iframe propio y de su origen).
  useEffect(() => {
    if (!hasVideo) return
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== YOUTUBE_PLAYER_ORIGIN || e.source !== frameRef.current?.contentWindow) return
      const state = parsePlayerState(e.data)
      if (state !== null) playback.current = isPlayingState(state) ? 'playing' : 'idle'
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [hasVideo, playerKey])

  // Tras cargar, se le pide al reproductor que empiece a informar su estado.
  const onFrameLoad = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage(PLAYER_LISTEN_MESSAGE, YOUTUBE_PLAYER_ORIGIN)
  }, [])

  // Observa el hueco del video (no el iframe): si el hueco sigue visible, el
  // video está en su sitio. `root: null` sirve aunque el scroll sea de un
  // contenedor interno (`.main`): el observer descuenta lo que ese contenedor recorta.
  useEffect(() => {
    const slot = slotRef.current
    if (!hasVideo || slot === null || typeof IntersectionObserver !== 'function') return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setScrolledPast(false)
          setDismissed(false)
          if (wasMini.current) {
            wasMini.current = false
            setReturning(true)
          }
        } else {
          // Solo «por arriba»: si estuviera por debajo, no hay nada que seguir.
          const past = entry.boundingClientRect.top < 0
          setScrolledPast(past)
          // Solo se abre el mini si el video SE ESTÁ REPRODUCIENDO al bajar.
          if (past) setMiniEligible(playback.current !== 'idle')
        }
      },
      { threshold: 0 },
    )
    observer.observe(slot)
    return () => observer.disconnect()
  }, [hasVideo])

  const backToVideo = useCallback(() => {
    slotRef.current?.scrollIntoView({
      behavior: reducedMotion ? 'auto' : 'smooth',
      block: 'center',
    })
  }, [reducedMotion])

  // La animación de regreso dura lo que su CSS; luego se retira la clase.
  useEffect(() => {
    if (!returning) return
    const id = window.setTimeout(() => setReturning(false), 320)
    return () => window.clearTimeout(id)
  }, [returning])

  const closeMini = useCallback(() => {
    playback.current = 'unknown' // el iframe se recrea: empieza de cero
    setDismissed(true)
    setPlayerKey((k) => k + 1) // recrea el iframe: el video se detiene
  }, [])

  // Sin video no hay bloque: la lección arranca por su contenido, no por un hueco.
  if (embedSrc === null) return null

  const mini = scrolledPast && !dismissed && miniEligible
  wasMini.current = mini

  const run = () => {
    if (exampleId != null) navigate(`/simulador?ejemplo=${encodeURIComponent(exampleId)}`)
  }

  return (
    <div className="lesson-media">
      {/* El hueco conserva el 16:9 aunque el marco pase a la esquina. */}
      <div className="lesson-media-slot" ref={slotRef}>
        <div
          className={'lesson-media-screen' + (mini ? ' is-mini' : '') + (returning && !mini ? ' is-returning' : '')}
          role={mini ? 'region' : undefined}
          aria-label={mini ? 'Mini reproductor del video de la lección' : undefined}
        >
          {/* La barra existe siempre (oculta por CSS fuera del modo mini): así el
              iframe no cambia de posición entre hermanos al activarse. */}
          <div className="lesson-media-minibar" hidden={!mini}>
            <button
              type="button"
              className="lesson-media-minibtn"
              onClick={backToVideo}
              aria-label="Subir al video"
              title="Subir al video"
            >
              <IconChevronUp size={14} />
            </button>
            <button
              type="button"
              className="lesson-media-minibtn"
              onClick={closeMini}
              aria-label="Cerrar el mini reproductor"
              title="Cerrar"
            >
              <Icon size={14}>
                <path d="M6 6l12 12M18 6L6 18" />
              </Icon>
            </button>
          </div>
          <iframe
            key={playerKey}
            ref={frameRef}
            onLoad={onFrameLoad}
            className="lesson-media-video"
            src={playerSrc ?? undefined}
            title={`Video de la lección (${filename ?? lessonId})`}
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
          />
        </div>
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
