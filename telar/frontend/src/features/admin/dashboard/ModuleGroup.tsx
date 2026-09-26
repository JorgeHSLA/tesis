// ModuleGroup — grupo colapsable de un módulo en el dashboard admin. Cabecera
// con asa de arrastre, título/nivel/orden y acciones (editar, borrar, "+
// Lección"); cuerpo con las filas de lección. El módulo se reordena
// arrastrándolo por el asa (DnD nativo del navegador) o con los botones
// «Subir»/«Bajar» (fallback accesible por teclado). Borrar un módulo con
// lecciones → 409 MODULE_NOT_EMPTY → toast. fase4-autoria-design §9.F(2).
// S5 (D+): la cabecera lleva el distintivo «cambios sin publicar» cuando el
// contenido local difiere de la versión vigente del catálogo (§11.8.3).
// S7d (CU-41.1): si el índice anuncia el módulo, «Retirar del catálogo» quita
// esa entrada (§11.8.4) tras confirmar. No borra nada local.
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '../../../api/client'
import { deleteModule, getPublishStatus, unpublishModule } from '../../../api/admin'
import type { AdminPublishStatusDto } from '../../../api/admin-types'
import type { ModuleDto } from '../../../api/types'
import { Button } from '../../../components/ui/Button'
import { PublishModuleDialog } from './PublishModuleDialog'
import { Chip } from '../../../components/ui/Chip'
import { ConfirmDialog } from '../../../components/admin/ConfirmDialog'
import { IconChevronDown, IconChevronRight, IconChevronUp, IconGrip, IconPlus } from '../../../components/icons/icons'
import { LessonAdminRow } from './LessonAdminRow'

export interface ModuleGroupProps {
  module: ModuleDto
  /** Posición 0-based dentro de la lista (para el reorden). */
  index: number
  /** Total de módulos (para deshabilitar «Subir»/«Bajar» en los bordes). */
  count: number
  /** Este módulo se está arrastrando ahora mismo. */
  isDragging: boolean
  /** Otro módulo se suelta sobre este (destino del drop). */
  isDropTarget: boolean
  open: boolean
  onToggle: () => void
  onReload: () => void
  onToast: (message: string, tone?: 'default' | 'error') => void
  onEdit: (module: ModuleDto) => void
  /** Reordena de `from` a `to` (usado por los botones y por el drop). */
  onMove: (from: number, to: number) => void
  onReorderStart: (index: number) => void
  onReorderEnter: (index: number) => void
  onReorderDrop: (index: number) => void
  onReorderEnd: () => void
}

export function ModuleGroup({
  module,
  index,
  count,
  isDragging,
  isDropTarget,
  open,
  onToggle,
  onReload,
  onToast,
  onEdit,
  onMove,
  onReorderStart,
  onReorderEnter,
  onReorderDrop,
  onReorderEnd,
}: ModuleGroupProps) {
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const [publicando, setPublicando] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [estadoPublicacion, setEstadoPublicacion] = useState<AdminPublishStatusDto | null>(null)
  const [retirando, setRetirando] = useState(false)
  const [confirmandoRetirar, setConfirmandoRetirar] = useState(false)
  /** Tras retirar, fuerza releer el estado aunque `module` no cambie. */
  const [consulta, setConsulta] = useState(0)
  const cardRef = useRef<HTMLElement>(null)

  // Bajo demanda: se pide al montar y cuando CAMBIAN los datos del módulo
  // (tras editar, reordenar o publicar). La firma evita repetir la consulta
  // por recargas que devuelven lo mismo: el reorden optimista y la recarga
  // posterior producen objetos nuevos con el mismo contenido. El backend
  // cachea en memoria la huella de la versión publicada. Sin red o con error
  // no se pinta nada: el distintivo es una ayuda, no un estado que pueda
  // romper la fila.
  const firma = JSON.stringify(module)
  useEffect(() => {
    let vivo = true
    getPublishStatus(module.id)
      .then((e) => vivo && setEstadoPublicacion(e))
      .catch(() => vivo && setEstadoPublicacion(null))
    return () => {
      vivo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `firma` resume `module`
  }, [firma, consulta])

  const estado = estadoPublicacion?.state
  const sinPublicar = estado === 'changed' || estado === 'out_of_sync'
  // Solo hay algo que retirar si el índice anuncia el módulo. `unknown` (sin
  // red) no lo afirma, así que no se ofrece: el botón fallaría seguro.
  const versionPublicada =
    estado === 'unchanged' || estado === 'changed' || estado === 'out_of_sync'
      ? estadoPublicacion?.published_version ?? null
      : null

  const lessons = [...module.lessons].sort((a, b) => a.order - b.order)
  const bodyId = `admin-module-body-${module.id}`

  // El asa inicia el arrastre; la tarjeta entera es la imagen de arrastre y el
  // destino del drop. Así los clics y el texto del resto de la tarjeta quedan
  // intactos (el DnD nativo solo se dispara desde el asa `draggable`).
  const handleGripDragStart = (e: DragEvent) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
    if (cardRef.current) e.dataTransfer.setDragImage(cardRef.current, 16, 16)
    onReorderStart(index)
  }
  const handleDragOver = (e: DragEvent) => {
    e.preventDefault() // habilita el drop
    e.dataTransfer.dropEffect = 'move'
    onReorderEnter(index)
  }
  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    onReorderDrop(index)
  }

  const remove = async () => {
    setDeleting(true)
    try {
      await deleteModule(module.id)
      onToast(`Módulo "${module.title}" eliminado.`)
      setConfirming(false)
      onReload()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'MODULE_NOT_EMPTY') {
        onToast('Vacía el módulo antes de borrarlo.', 'error')
        setConfirming(false)
      } else {
        onToast(err instanceof ApiError ? err.message : 'No se pudo borrar el módulo.', 'error')
      }
    } finally {
      setDeleting(false)
    }
  }

  const retirar = async () => {
    setRetirando(true)
    try {
      await unpublishModule(module.id)
      onToast(`Se retiró «${module.title}» del catálogo.`)
      setConfirmandoRetirar(false)
      setConsulta((n) => n + 1)
      onReload()
    } catch (err) {
      // El backend no toca nada local si el bucket falla: basta con decirlo.
      const motivo = err instanceof ApiError ? err.message : 'Inténtalo de nuevo.'
      onToast(`No se pudo retirar el módulo del catálogo. ${motivo}`, 'error')
      setConfirmandoRetirar(false)
    } finally {
      setRetirando(false)
    }
  }

  const cardClass = ['admin-module-group', 'card', isDragging ? 'is-dragging' : '', isDropTarget ? 'is-drop-target' : '']
    .filter(Boolean)
    .join(' ')

  return (
    <section
      ref={cardRef}
      className={cardClass}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="admin-module-head">
        <div className="admin-module-reorder">
          <span
            className="admin-module-grip"
            aria-hidden="true"
            title="Arrastra para reordenar"
            draggable
            onDragStart={handleGripDragStart}
            onDragEnd={onReorderEnd}
          >
            <IconGrip size={16} />
          </span>
          <span className="admin-module-updown">
            <Button
              variant="ghost"
              size="sm"
              className="admin-module-move"
              aria-label={`Subir el módulo ${module.title}`}
              disabled={index === 0}
              onClick={() => onMove(index, index - 1)}
            >
              <IconChevronUp size={15} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="admin-module-move"
              aria-label={`Bajar el módulo ${module.title}`}
              disabled={index === count - 1}
              onClick={() => onMove(index, index + 1)}
            >
              <IconChevronDown size={15} />
            </Button>
          </span>
        </div>
        <button
          type="button"
          className="admin-module-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
        >
          <span className={['admin-module-caret', open ? 'is-open' : ''].filter(Boolean).join(' ')} aria-hidden="true">
            <IconChevronRight size={16} />
          </span>
          <span className="admin-module-order mono-small">#{module.order}</span>
          <span className="admin-module-title">{module.title}</span>
          <Chip tone="neutral">{module.level}</Chip>
          <span className="admin-module-count mono-small muted">{lessons.length} lecciones</span>
          {sinPublicar && <Chip tone="amber">cambios sin publicar</Chip>}
        </button>
        <div className="admin-module-actions">
          <Button variant="outline" size="sm" onClick={() => onEdit(module)}>
            Editar
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => navigate(`/admin/lecciones/nueva?modulo=${encodeURIComponent(module.id)}`)}
          >
            <IconPlus size={15} />
            Lección
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPublicando(true)}>
            Publicar
          </Button>
          {versionPublicada != null && (
            <Button variant="ghost" size="sm" onClick={() => setConfirmandoRetirar(true)}>
              Retirar del catálogo
            </Button>
          )}
          <Button variant="ghost" size="sm" className="admin-btn-danger-ghost" onClick={() => setConfirming(true)}>
            Borrar
          </Button>
        </div>
      </div>

      {open && (
        <div className="admin-module-body" id={bodyId}>
          {lessons.length === 0 ? (
            <p className="mono-small muted admin-module-empty">
              Este módulo no tiene lecciones todavía. Usa "+ Lección" para crear la primera.
            </p>
          ) : (
            lessons.map((lesson) => (
              <LessonAdminRow key={lesson.id} lesson={lesson} onReload={onReload} onToast={onToast} />
            ))
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        tone="danger"
        title="Borrar módulo"
        body={`Se eliminará el módulo "${module.title}". Debe estar vacío (sin lecciones) para poder borrarlo.`}
        confirmLabel="Borrar módulo"
        busy={deleting}
        onConfirm={remove}
        // Con el borrado en vuelo no se cierra (Escape/fondo): el resultado llega por toast.
        onCancel={() => !deleting && setConfirming(false)}
      />

      <ConfirmDialog
        open={confirmandoRetirar}
        tone="danger"
        title="Retirar del catálogo"
        body={
          `«${module.title}» (v${versionPublicada ?? '?'}) dejará de aparecer en el catálogo. ` +
          'No se borra nada: el módulo sigue aquí y las versiones subidas se conservan. ' +
          'Quien ya lo incorporó lo mantiene, marcado «Ya no publicado». ' +
          'Si lo vuelves a publicar, saldrá con la versión siguiente.'
        }
        confirmLabel="Retirar"
        busy={retirando}
        onConfirm={retirar}
        // Con la retirada en vuelo no se cierra: el resultado llega por toast.
        onCancel={() => !retirando && setConfirmandoRetirar(false)}
      />

      {publicando && (
        <PublishModuleDialog
          module={module}
          onClose={() => setPublicando(false)}
          onPublished={(mensaje) => {
            setPublicando(false)
            onToast(mensaje)
            // Publicar cambia `modules.version` (§11.8.2 paso 5), así que la
            // lista tiene que recargarse o mostraría la versión anterior.
            onReload()
          }}
        />
      )}
    </section>
  )
}
