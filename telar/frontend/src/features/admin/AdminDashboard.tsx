// AdminDashboard — pantalla índice del área de autoría (#/admin). Lista los
// módulos (lectura pública GET /modules reutilizada) en grupos colapsables con
// CRUD; "+ Nuevo módulo" abre el formulario. Los módulos se reordenan por
// drag-and-drop NATIVO (asa de arrastre) o con botones «Subir»/«Bajar»
// accesibles: reorden OPTIMISTA que revierte ante error. Un reorden a la vez
// (CU-15.1): con el PUT en vuelo se deshabilitan «Subir»/«Bajar» y el asa, y el
// orden final sale de la respuesta del PUT, sin GET extra. Un toast efímero
// comunica el resultado de las operaciones (incl. 409 MODULE_NOT_EMPTY). §9.F(2).
import { useCallback, useEffect, useRef, useState } from 'react'
import { getModules } from '../../api/content'
import { reorderModules } from '../../api/admin'
import { ApiError } from '../../api/client'
import type { ModuleDto } from '../../api/types'
import { moveItem, resequence, toReorderItems } from '../../lib/reorder'
import { useAdminResource } from '../../hooks/useAdminResource'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorState } from '../../components/ui/ErrorState'
import { Skeleton } from '../../components/ui/Skeleton'
import { IconLayers, IconPlus } from '../../components/icons/icons'
import { ModuleGroup } from './dashboard/ModuleGroup'
import { ImportModuleDialog } from './dashboard/ImportModuleDialog'
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
  const [importando, setImportando] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Copia de trabajo local (fuente de verdad del render). Se resiembra desde el
  // servidor en cada carga; el reorden OPTIMISTA la actualiza al instante.
  const [items, setItems] = useState<ModuleDto[]>([])
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const [reordering, setReordering] = useState(false)

  useEffect(() => {
    setItems(data ? [...data.modules].sort((a, b) => a.order - b.order) : [])
  }, [data])

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

  // Aplica un nuevo orden de forma optimista y lo persiste; ante error revierte
  // al estado previo y avisa con un toast (reutiliza el estado de error).
  const commitReorder = useCallback(
    async (next: ModuleDto[], prev: ModuleDto[]) => {
      setItems(next)
      setReordering(true)
      try {
        const res = await reorderModules(toReorderItems(next))
        // El PUT devuelve el listado admin ya reordenado: de él solo hace falta
        // el `order` final de cada módulo (el resto no cambió).
        const orderById = new Map(res.modules.map((m) => [m.id, m.order]))
        setItems(
          next
            .map((m) => ({ ...m, order: orderById.get(m.id) ?? m.order }))
            .sort((a, b) => a.order - b.order),
        )
      } catch (err) {
        setItems(prev)
        showToast(
          err instanceof ApiError ? err.message : 'No se pudieron reordenar los módulos.',
          'error',
        )
      } finally {
        setReordering(false)
      }
    },
    [showToast],
  )

  const moveModule = useCallback(
    (from: number, to: number) => {
      if (reordering) return
      if (from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) return
      const next = resequence(moveItem(items, from, to))
      void commitReorder(next, items)
    },
    [items, reordering, commitReorder],
  )

  const onReorderDrop = useCallback(
    (index: number) => {
      if (dragIndex != null && dragIndex !== index) moveModule(dragIndex, index)
      setDragIndex(null)
      setOverIndex(null)
    },
    [dragIndex, moveModule],
  )

  const onReorderEnd = useCallback(() => {
    setDragIndex(null)
    setOverIndex(null)
  }, [])

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

  const existingIds = items.map((m) => m.id)
  const nextOrder = items.length ? Math.max(...items.map((m) => m.order)) + 1 : 1

  return (
    <section className="screen admin-dashboard">
      <div className="admin-dashboard-head">
        <div>
          <div className="eyebrow">Autoría · Contenido</div>
          <h2 className="display-lg">Módulos del curso</h2>
          <p className="muted" style={{ margin: '6px 0 0', maxWidth: 560 }}>
            Crea y edita módulos, lecciones, ejemplos y quizzes. Arrastra por el asa (o usa
            «Subir»/«Bajar») para reordenarlos. Los cambios se reflejan de inmediato en el catálogo
            del estudiante.
          </p>
        </div>
        <div className="admin-dashboard-head-actions">
          <Button variant="outline" size="md" onClick={() => setImportando(true)}>
            Importar del catálogo
          </Button>
          <Button variant="primary" size="md" onClick={() => setDialog({ mode: 'create' })}>
            <IconPlus size={16} />
            Nuevo módulo
          </Button>
        </div>
      </div>

      {items.length === 0 ? (
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
          {items.map((module, index) => (
            <ModuleGroup
              key={module.id}
              module={module}
              index={index}
              count={items.length}
              reorderDisabled={reordering}
              isDragging={dragIndex === index}
              isDropTarget={overIndex === index && dragIndex !== null && dragIndex !== index}
              open={openId === module.id}
              onToggle={() => setOpenId(openId === module.id ? null : module.id)}
              onReload={reload}
              onToast={showToast}
              onEdit={(m) => setDialog({ mode: 'edit', module: m })}
              onMove={moveModule}
              onReorderStart={setDragIndex}
              onReorderEnter={setOverIndex}
              onReorderDrop={onReorderDrop}
              onReorderEnd={onReorderEnd}
            />
          ))}
        </div>
      )}

      {dialog?.mode === 'create' && (
        <ModuleFormDialog
          mode="create"
          existingIds={existingIds}
          defaultOrder={nextOrder}
          onClose={() => setDialog(null)}
          onSaved={onSaved}
        />
      )}
      {dialog?.mode === 'edit' && (
        <ModuleFormDialog mode="edit" initial={dialog.module} onClose={() => setDialog(null)} onSaved={onSaved} />
      )}

      {importando && (
        <ImportModuleDialog
          existingIds={existingIds}
          onClose={() => setImportando(false)}
          onImported={(mensaje) => {
            setImportando(false)
            onSaved(mensaje)
          }}
        />
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
