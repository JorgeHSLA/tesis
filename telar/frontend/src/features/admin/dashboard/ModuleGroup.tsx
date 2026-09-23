// ModuleGroup — grupo colapsable de un módulo en el dashboard admin. Cabecera
// con asa de arrastre, título/nivel/orden y acciones (editar, borrar, "+
// Lección"); cuerpo con las filas de lección. El módulo se reordena
// arrastrándolo por el asa (DnD nativo del navegador) o con los botones
// «Subir»/«Bajar» (fallback accesible por teclado). Borrar un módulo con
// lecciones → 409 MODULE_NOT_EMPTY → toast. fase4-autoria-design §9.F(2).
// S5 (D+): la cabecera lleva el distintivo «cambios sin publicar» cuando el
// contenido local difiere de la versión vigente del catálogo (§11.8.3).
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '../../../api/client'
import { deleteModule, getPublishStatus } from '../../../api/admin'
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
  const [sinPublicar, setSinPublicar] = useState(false)
  const cardRef = useRef<HTMLElement>(null)

  // Bajo demanda: se pide al montar y cada vez que el dashboard recarga el
  // módulo (tras editar o publicar, `module` es otro objeto). El backend cachea
  // en memoria la huella de la versión publicada, así que repetir es barato.
  // Sin red o con error no se pinta nada: el distintivo es una ayuda, no un
  // estado que pueda romper la fila.
  useEffect(() => {
    let vivo = true
    getPublishStatus(module.id)
      .then((e) => vivo && setSinPublicar(e.state === 'changed' || e.state === 'out_of_sync'))
      .catch(() => vivo && setSinPublicar(false))
    return () => {
      vivo = false
    }
  }, [module])

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
        onCancel={() => setConfirming(false)}
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
