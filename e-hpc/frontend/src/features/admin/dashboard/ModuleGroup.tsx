// ModuleGroup — grupo colapsable de un módulo en el dashboard admin. Cabecera
// con título/nivel/orden y acciones (editar, borrar, "+ Lección"); cuerpo con
// las filas de lección. Borrar un módulo con lecciones → 409 MODULE_NOT_EMPTY
// → toast "Vacía el módulo antes de borrarlo". fase4-autoria-design §9.F(2).
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '../../../api/client'
import { deleteModule } from '../../../api/admin'
import type { ModuleDto } from '../../../api/types'
import { Button } from '../../../components/ui/Button'
import { Chip } from '../../../components/ui/Chip'
import { ConfirmDialog } from '../../../components/admin/ConfirmDialog'
import { IconChevronRight, IconPlus } from '../../../components/icons/icons'
import { LessonAdminRow } from './LessonAdminRow'

export interface ModuleGroupProps {
  module: ModuleDto
  open: boolean
  onToggle: () => void
  onReload: () => void
  onToast: (message: string, tone?: 'default' | 'error') => void
  onEdit: (module: ModuleDto) => void
}

export function ModuleGroup({ module, open, onToggle, onReload, onToast, onEdit }: ModuleGroupProps) {
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const lessons = [...module.lessons].sort((a, b) => a.order - b.order)
  const bodyId = `admin-module-body-${module.id}`

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

  return (
    <section className="admin-module-group card">
      <div className="admin-module-head">
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
    </section>
  )
}
