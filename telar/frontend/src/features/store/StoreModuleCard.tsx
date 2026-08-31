// StoreModuleCard — UNA tarjeta del catálogo remoto de módulos (§11.5.1).
// Presentación pura: recibe la fila ya clasificada por `lib/catalogDiff` y
// devuelve al padre la intención del usuario. No conoce el store ni la red.
//
// LO QUE GOBIERNA ESTE ARCHIVO: el estado tiene que ser legible de un vistazo,
// porque de él depende qué botón aparece. Cinco estados, un chip cada uno y
// SOLO las acciones que ese estado admite:
//
//   available        chip neutro «Disponible»           → Incorporar
//   up_to_date       chip VERDE «Instalado»             → Quitar
//   update_available chip ámbar «Actualización · v{n}»  → Ver qué cambia · Actualizar · Quitar
//   unpublished      chip neutro «Ya no publicado»      → Quitar
//   local_only       (no debería llegar: el padre lo filtra — §11.6.4 responde
//                    404 MODULE_NOT_INSTALLED sobre un módulo local)
//
// Los datos que NO existen no se inventan ni se pintan como «—»: un módulo
// despublicado solo conserva lo que hay en SQLite (título, versión, lecciones),
// así que su tarjeta muestra menos metadatos, no metadatos vacíos.
import type { ReactNode } from 'react'
import { IconAlert, IconDownload } from '../../components/icons/icons'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Chip, type ChipTone } from '../../components/ui/Chip'
import type { CatalogEntry } from '../../lib/catalogDiff'
import { fmtBytes } from '../../lib/format'
import type { CatalogFailure, CatalogOp } from '../../stores/catalogStore'

export interface StoreModuleCardProps {
  entry: CatalogEntry
  /** Operación en vuelo sobre ESTE módulo: deshabilita todos sus botones. */
  op?: CatalogOp
  /** Último fallo de incorporar/actualizar/quitar ESTE módulo. */
  error?: CatalogFailure
  onInstall: () => void
  onPreview: () => void
  onUpdate: () => void
  onRemove: () => void
  onDismissError: () => void
}

interface StateSpec {
  label: string
  tone: ChipTone
}

/**
 * Traduce el `error.code` del contrato (§11.5/§11.6) a algo que un estudiante
 * pueda accionar. El `message` del backend queda de reserva: es correcto pero
 * está escrito para quien conoce el mecanismo.
 *
 * Se exporta porque el diálogo de actualizar (ModuleStoreScreen) tiene que
 * decir exactamente lo mismo que la tarjeta ante el mismo código.
 */
export function catalogErrorText(failure: CatalogFailure): string {
  switch (failure.code) {
    case 'CATALOG_DISABLED':
      return 'Este equipo no tiene un catálogo de módulos configurado.'
    case 'CATALOG_UNAVAILABLE':
      return 'No se pudo contactar con el catálogo. Revisa tu conexión e inténtalo de nuevo.'
    case 'REMOTE_MODULE_NOT_FOUND':
      return 'Este módulo ya no está publicado en el catálogo.'
    case 'MODULE_ALREADY_INSTALLED':
      return 'Este módulo ya está en tu equipo: actualízalo en lugar de incorporarlo.'
    case 'MODULE_NOT_INSTALLED':
      return 'Este módulo no está incorporado en este equipo.'
    case 'DUPLICATE_ID':
      return 'Otro módulo de este equipo ya usa alguno de sus identificadores, así que no se puede incorporar.'
    case 'CHECKSUM_MISMATCH':
      // El TOCTOU que cierra `expected_checksum` (§11.6.1): lo publicado cambió
      // entre que se pintó la tarjeta y el clic.
      return 'El módulo publicado cambió mientras lo mirabas. Actualiza la lista y vuelve a intentarlo.'
    case 'VERSION_CONFLICT':
      return 'Ya tienes una versión igual o más nueva que la publicada.'
    case 'BUNDLE_TOO_LARGE':
      return 'El módulo publicado supera el tamaño máximo admitido.'
    case 'BUNDLE_INVALID':
    case 'CONTENT_VALIDATION_ERROR':
      return 'El módulo publicado no pasó la validación de contenido: avisa a quien lo publicó.'
    default:
      return failure.message
  }
}

/** Chip de estado. Es la señal principal de la tarjeta. */
function stateSpec(entry: CatalogEntry): StateSpec {
  switch (entry.state) {
    case 'available':
      return { label: 'Disponible', tone: 'neutral' }
    case 'up_to_date':
      return { label: 'Instalado', tone: 'green' }
    case 'update_available':
      return {
        label: entry.availableVersion != null ? `Actualización · v${entry.availableVersion}` : 'Actualización',
        tone: 'amber',
      }
    case 'unpublished':
      return { label: 'Ya no publicado', tone: 'neutral' }
    case 'local_only':
      return { label: 'De este equipo', tone: 'neutral' }
  }
}

const OP_LABEL: Record<CatalogOp, string> = {
  installing: 'Incorporando…',
  updating: 'Actualizando…',
  removing: 'Quitando…',
}

export function StoreModuleCard({
  entry,
  op,
  error,
  onInstall,
  onPreview,
  onUpdate,
  onRemove,
  onDismissError,
}: StoreModuleCardProps) {
  const { remote, installed } = entry
  const spec = stateSpec(entry)
  const busy = op !== undefined
  const titleId = `store-card-${entry.moduleId}`

  // Metadatos: solo los que este estado CONOCE de verdad.
  const meta: ReactNode[] = []
  if (remote?.level) meta.push(<li key="level">{remote.level}</li>)
  const version = entry.state === 'available' ? entry.availableVersion : entry.installedVersion
  if (version != null) meta.push(<li key="version" className="mono-small">v{version}</li>)
  const lessons = remote?.lessons_count ?? installed?.lessons_total ?? null
  if (lessons != null) meta.push(<li key="lessons">{lessons === 1 ? '1 lección' : `${lessons} lecciones`}</li>)
  if (remote != null) {
    meta.push(
      <li key="questions">
        {remote.questions_count === 1 ? '1 pregunta' : `${remote.questions_count} preguntas`}
      </li>,
    )
    meta.push(<li key="minutes">~{remote.estimated_minutes_total} min</li>)
    // El tamaño solo importa cuando aún hay algo que descargar.
    if (entry.state === 'available') meta.push(<li key="size">{fmtBytes(remote.size_bytes)}</li>)
  }

  return (
    <Card className="store-card" aria-labelledby={titleId}>
      <div className="store-card-body">
        <div className="store-card-head">
          <h3 className="store-card-title" id={titleId}>
            {entry.title}
          </h3>
          <Chip tone={spec.tone}>{spec.label}</Chip>
        </div>

        {remote?.description ? <p className="store-card-desc">{remote.description}</p> : null}

        {meta.length > 0 && <ul className="store-card-meta">{meta}</ul>}

        <div className="store-card-tags">
          {remote?.requires_gpu === true && <Chip tone="blue">Requiere GPU</Chip>}
          {remote?.author_label ? <span className="store-card-author">{remote.author_label}</span> : null}
        </div>

        {/* El avance propio, junto al botón de quitar: es lo que la copy de la
            confirmación promete conservar, y verlo aquí la hace creíble. */}
        {installed != null && installed.lessons_total > 0 && (
          <p className="store-card-progress">
            {installed.lessons_completed} de {installed.lessons_total} lecciones completadas
          </p>
        )}

        {entry.state === 'unpublished' && (
          <p className="store-card-note">
            Sigue funcionando en tu equipo, pero ya no está en el catálogo: no recibirá más actualizaciones.
          </p>
        )}

        {error != null && (
          <div className="store-card-error" role="alert">
            <IconAlert size={14} />
            <span>{catalogErrorText(error)}</span>
            <button
              type="button"
              className="store-dismiss"
              onClick={onDismissError}
              aria-label={`Descartar el aviso de ${entry.title}`}
            >
              Descartar
            </button>
          </div>
        )}
      </div>

      <div className="store-card-actions">
        {entry.state === 'available' && (
          <Button
            variant="primary"
            size="sm"
            disabled={busy}
            onClick={onInstall}
            aria-label={`${op === 'installing' ? OP_LABEL.installing : 'Incorporar'} ${entry.title}`}
          >
            <IconDownload size={14} /> {op === 'installing' ? OP_LABEL.installing : 'Incorporar'}
          </Button>
        )}

        {entry.state === 'update_available' && (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={onPreview}
              aria-label={`Ver qué cambia en ${entry.title}`}
            >
              Ver qué cambia
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={busy}
              onClick={onUpdate}
              aria-label={`${op === 'updating' ? OP_LABEL.updating : 'Actualizar'} ${entry.title}`}
            >
              {op === 'updating' ? OP_LABEL.updating : 'Actualizar'}
            </Button>
          </>
        )}

        {entry.state !== 'available' && entry.state !== 'local_only' && (
          // Ghost neutro, no rojo: quitar un módulo NO destruye el avance
          // (§11.6.4: esa ruta ya no sabe borrar avance). El tono de peligro
          // se reserva a la confirmación, que es donde se explica el alcance.
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={onRemove}
            aria-label={`${op === 'removing' ? OP_LABEL.removing : 'Quitar'} ${entry.title}`}
          >
            {op === 'removing' ? OP_LABEL.removing : 'Quitar'}
          </Button>
        )}
      </div>
    </Card>
  )
}
