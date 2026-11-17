// dockerErrors.ts — traduce el error CRUDO de Docker (stderr saneado del proceso
// principal, o lo que diga el backend en modo web) a un mensaje que entienda un
// estudiante. Antes el panel del rail pintaba tal cual cosas como
// «error during connect: Get "http://%2F%2F.%2Fpipe%2FdockerDesktopLinuxEngine/…»
// (2026-11-16: «sale un error feo»). El texto original no se pierde: va en un
// «Detalle técnico» plegado, por si hay que pegarlo en un reporte.

/** Marca que pone el proceso principal cuando está abriendo Docker Desktop. */
export const DOCKER_STARTING_MARK = 'Docker Desktop se está iniciando'

export interface FriendlyDockerError {
  /** Una línea, sin jerga. */
  title: string
  /** Qué hacer. */
  hint: string
  /** El runtime está arrancando solo: no es un fallo, es una espera. */
  starting: boolean
  /** Texto original (para el «Detalle técnico»); `null` si ya es amable. */
  raw: string | null
}

const MAX_RAW = 600

interface Rule {
  test: RegExp
  title: string
  hint: string
  starting?: boolean
}

// El orden importa: lo más específico primero.
const RULES: readonly Rule[] = [
  {
    test: new RegExp(DOCKER_STARTING_MARK, 'i'),
    title: 'Abriendo Docker Desktop…',
    hint: 'Telar lo abre por ti. Puede tardar un minuto; en cuanto esté listo, prepara el entorno solo.',
    starting: true,
  },
  {
    test: /manually paused|is paused/i,
    title: 'Docker Desktop está en pausa',
    hint: 'Reanúdalo desde el icono de la ballena (barra de tareas) y Telar continuará.',
  },
  {
    test: /no est[aá] instalado|ENOENT|command not found|not recognized|no se reconoce/i,
    title: 'No encontramos Docker',
    hint: 'Telar necesita Docker Desktop para ejecutar código. Instálalo y vuelve a abrir Telar.',
  },
  {
    test: /permission denied|access is denied|acceso denegado/i,
    title: 'Sin permiso para usar Docker',
    hint: 'En Linux, añade tu usuario al grupo «docker» y reinicia la sesión. En Windows o Mac, abre Docker Desktop.',
  },
  {
    test: /cannot connect to the docker daemon|error during connect|dockerDesktopLinuxEngine|docker_engine|docker\.sock|is the docker daemon running|failed to connect to the docker api|daemon is not running|Docker no responde/i,
    title: 'Docker Desktop no está abierto',
    hint: 'Ábrelo y espera a que diga «Engine running». Telar lo intenta abrir solo.',
  },
  {
    test: /timed? ?out|se agot[oó]|tardó demasiado/i,
    title: 'Docker tardó demasiado en responder',
    hint: 'Puede estar arrancando. Espera un momento y pulsa «Levantar» de nuevo.',
  },
  {
    test: /imagen del runner|runner image/i,
    title: 'Falta preparar el entorno de ejecución',
    hint: 'Pulsa «Reintentar preparación»; necesita internet la primera vez.',
  },
  {
    test: /sin conexi[oó]n|failed to fetch|network/i,
    title: 'No hay conexión con Telar',
    hint: 'Revisa que el servicio esté encendido y vuelve a intentarlo.',
  },
]

export function friendlyDockerError(raw: string | null | undefined): FriendlyDockerError | null {
  const text = (raw ?? '').trim()
  if (text === '') return null
  const rule = RULES.find((r) => r.test.test(text))
  if (rule === undefined) {
    return {
      title: 'Docker no respondió como se esperaba',
      hint: 'Comprueba que Docker Desktop esté abierto. Si sigue igual, copia el detalle técnico al reportarlo.',
      starting: false,
      raw: text.slice(0, MAX_RAW),
    }
  }
  return {
    title: rule.title,
    hint: rule.hint,
    starting: rule.starting === true,
    // Un mensaje ya amable no necesita detalle técnico.
    raw: rule.starting === true ? null : text.slice(0, MAX_RAW),
  }
}
