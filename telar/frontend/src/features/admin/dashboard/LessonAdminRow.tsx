// LessonAdminRow — fila de una lección en el dashboard admin. Badges de estado
// (habilitada, quiz·nº preguntas) y acciones de edición: [Lección] [Quiz]
// [Ejemplo | Agregar ejemplo] [borrar]. Sin ejemplo, «Agregar ejemplo» abre el
// editor de la lección con el formulario abierto (CU-18.2). Las archivadas no
// llegan aquí: GET /modules las excluye; su estado se ve en el editor.
// El borrado pide confirmación —nombrando solo el ejemplo y el quiz que la
// lección tiene de verdad (CU-20.1)— y refresca el dashboard.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '../../../api/client'
import { deleteLesson } from '../../../api/admin'
import type { ModuleLessonDto } from '../../../api/types'
import { Button } from '../../../components/ui/Button'
import { Chip } from '../../../components/ui/Chip'
import { ConfirmDialog } from '../../../components/admin/ConfirmDialog'

export interface LessonAdminRowProps {
  lesson: ModuleLessonDto
  onReload: () => void
  onToast: (message: string, tone?: 'default' | 'error') => void
}

/** Qué se lleva por delante borrar la lección (el backend purga también el progreso). */
function deleteWarning(lesson: ModuleLessonDto): string {
  const partes = [lesson.example_id != null && 'su ejemplo', lesson.has_quiz && 'su quiz'].filter(Boolean)
  const junto = partes.length > 0 ? ` junto con ${partes.join(' y ')}` : ''
  return `Se eliminará "${lesson.title}"${junto} y el progreso de los estudiantes en ella. Esta acción no se puede deshacer.`
}

export function LessonAdminRow({ lesson, onReload, onToast }: LessonAdminRowProps) {
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const exampleId = lesson.example_id

  const remove = async () => {
    setDeleting(true)
    try {
      await deleteLesson(lesson.id)
      onToast(`Lección "${lesson.title}" eliminada.`)
      setConfirming(false)
      onReload()
    } catch (err) {
      onToast(err instanceof ApiError ? err.message : 'No se pudo borrar la lección.', 'error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="admin-lesson-row">
      <div className="admin-lesson-main">
        <span className="admin-lesson-order mono-small">#{lesson.order}</span>
        <span className="admin-lesson-title">{lesson.title}</span>
      </div>

      <div className="admin-lesson-badges">
        {lesson.enabled ? (
          <Chip tone="green" dot dotPulse={false}>
            habilitada
          </Chip>
        ) : (
          <Chip tone="neutral">deshabilitada</Chip>
        )}
        {lesson.has_quiz ? (
          <Chip tone="blue">quiz · {lesson.quiz_question_count}</Chip>
        ) : (
          <Chip tone="neutral">sin quiz</Chip>
        )}
      </div>

      <div className="admin-lesson-actions">
        <Button variant="outline" size="sm" onClick={() => navigate(`/admin/lecciones/${lesson.id}`)}>
          Lección
        </Button>
        <Button variant="outline" size="sm" onClick={() => navigate(`/admin/quiz/${lesson.id}`)}>
          Quiz
        </Button>
        {exampleId != null ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/admin/ejemplos/${encodeURIComponent(exampleId)}`)}
          >
            Ejemplo
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/admin/lecciones/${encodeURIComponent(lesson.id)}?ejemplo=nuevo`)}
          >
            Agregar ejemplo
          </Button>
        )}
        <Button variant="ghost" size="sm" className="admin-btn-danger-ghost" onClick={() => setConfirming(true)}>
          Borrar
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        tone="danger"
        title="Borrar lección"
        body={deleteWarning(lesson)}
        confirmLabel="Borrar lección"
        busy={deleting}
        onConfirm={remove}
        onCancel={() => !deleting && setConfirming(false)}
      />
    </div>
  )
}
