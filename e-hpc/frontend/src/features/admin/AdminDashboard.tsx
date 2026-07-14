// AdminDashboard — pantalla índice del área de autoría (#/admin). Lista los
// módulos (lectura pública GET /modules reutilizada) en grupos colapsables con
// CRUD; "+ Nuevo módulo" abre el formulario. Un toast efímero comunica el
// resultado de las operaciones (incl. 409 MODULE_NOT_EMPTY). §9.F(2).
import { useCallback, useEffect, useRef, useState } from 'react'
import { getModules } from '../../api/content'
import { ApiError } from '../../api/client'
import type { ModuleDto } from '../../api/types'
import { useAdminResource } from '../../hooks/useAdminResource'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorState } from '../../components/ui/ErrorState'
import { Skeleton } from '../../components/ui/Skeleton'
import { IconLayers, IconPlus } from '../../components/icons/icons'
import { ModuleGroup } from './dashboard/ModuleGroup'
import { ModuleFormDialog } from './dashboard/ModuleFormDialog'

type ToastTone = 'default' | 'error'
interface Toast {
  message: string
  tone: ToastTone
  /** Clave para reiniciar la animación en toasts consecutivos. */
  key: number
}

type DialogState = { mode: 'create' } | { mode: 'edit'; module: ModuleDto } | null

export default function AdminDashboard() {
  const { data, loading, error, reload } = useAdminResource(() => getModules(), [])
  const [openId, setOpenId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((message: string, tone: ToastTone = 'default') => {
    setToast({ message, tone, key: Date.now() })
  }, [])

  useEffect(() => {
    if (toast == null) return
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 4000)
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current)
    }
  }, [toast])

  const onSaved = useCallback(
    (message: string) => {
      setDialog(null)
      showToast(message)
      reload()
    },
    [reload, showToast],
  )

  if (loading && data == null) {
    return (
      <section className="screen admin-dashboard">
        <div className="admin-dashboard-head">
          <Skeleton width={220} height={28} />
          <Skeleton width={150} height={36} radius="var(--r-md)" />
        </div>
        <div className="admin-dashboard-list">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={64} radius="var(--r-lg)" />
          ))}
        </div>
      </section>
    )
  }

  if (error != null && data == null) {
    return (
      <section className="screen admin-dashboard">
        <ErrorState
          message="No se pudieron cargar los módulos del curso."
          detail={error instanceof ApiError ? `${error.code}: ${error.message}` : String(error)}
          onRetry={reload}
        />
      </section>
    )
  }

  const modules = data ? [...data.modules].sort((a, b) => a.order - b.order) : []

  return (
    <section className="screen admin-dashboard">
      <div className="admin-dashboard-head">
        <div>
          <div className="eyebrow">Autoría · Contenido</div>
          <h2 className="display-lg">Módulos del curso</h2>
          <p className="muted" style={{ margin: '6px 0 0', maxWidth: 560 }}>
            Crea y edita módulos, lecciones, ejemplos y quizzes. Los cambios se reflejan de inmediato en el
            catálogo del estudiante.
          </p>
        </div>
        <Button variant="primary" size="md" onClick={() => setDialog({ mode: 'create' })}>
          <IconPlus size={16} />
          Nuevo módulo
        </Button>
      </div>

      {modules.length === 0 ? (
        <EmptyState
          icon={<IconLayers size={28} />}
          title="Aún no hay módulos"
          body="Empieza creando el primer módulo del curso."
          action={
            <Button variant="primary" size="sm" onClick={() => setDialog({ mode: 'create' })}>
              <IconPlus size={15} />
              Nuevo módulo
            </Button>
          }
        />
      ) : (
        <div className="admin-dashboard-list">
          {modules.map((module) => (
            <ModuleGroup
              key={module.id}
              module={module}
              open={openId === module.id}
              onToggle={() => setOpenId(openId === module.id ? null : module.id)}
              onReload={reload}
              onToast={showToast}
              onEdit={(m) => setDialog({ mode: 'edit', module: m })}
            />
          ))}
        </div>
      )}

      {dialog?.mode === 'create' && (
        <ModuleFormDialog mode="create" onClose={() => setDialog(null)} onSaved={onSaved} />
      )}
      {dialog?.mode === 'edit' && (
        <ModuleFormDialog mode="edit" initial={dialog.module} onClose={() => setDialog(null)} onSaved={onSaved} />
      )}

      {toast != null && (
        <div
          key={toast.key}
          className={['admin-toast', toast.tone === 'error' ? 'is-error' : ''].filter(Boolean).join(' ')}
          role="status"
          aria-live="polite"
        >
          {toast.message}
        </div>
      )}
    </section>
  )
}
