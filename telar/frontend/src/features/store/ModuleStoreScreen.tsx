// ModuleStoreScreen — `/modulos`, el catálogo remoto visto por el estudiante:
// CU-35 (explorar), CU-36 (incorporar) y CU-39 (actualizar / quitar).
//
// TRES REGLAS DE PRODUCTO, y las tres se leen en el código de esta pantalla:
//
// 1. **Es la ÚNICA pantalla que puede pintar `ErrorState` por falta de red**
//    (§11.9), y solo cuando no queda NADA que enseñar: con una lista en caché
//    se sigue explorando y el fallo baja a una tira informativa. Lo decide
//    `shouldShowRemoteError`, no un `try/catch` suelto.
// 2. **«Tu progreso se conserva» es copy obligatoria** en la confirmación de
//    actualizar y en la de quitar. Sin ella nadie actualiza, y el mecanismo
//    entero (§11.6.2) deja de tener sentido. Por eso el botón «Actualizar» de
//    la tarjeta NO llama a la API directamente: abre el mismo diálogo que «Ver
//    qué cambia», que es donde vive la promesa.
// 3. **Un despliegue sin bucket no está roto, está apagado**
//    (`CATALOG_DISABLED`): se explica con `EmptyState`, sin «Reintentar», que
//    no arreglaría nada. El item del rail ni siquiera aparece (Sidebar).
//
// Lo LOCAL queda fuera de esta pantalla: los módulos `local_only` (baseline o
// creados en autoría) no se incorporan ni se quitan por §11.6.4 —respondería
// `404 MODULE_NOT_INSTALLED`—, así que enseñarlos aquí sería ofrecer botones
// que no funcionan. Su sitio es `/cursos`.
import '../../styles/screens/store.css'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { getUpdatePreview } from '../../api/catalog'
import type { LessonChange, ModuleUpdatePreviewDto, ProgressEffect } from '../../api/catalog-types'
import { ApiError } from '../../api/client'
import { ConfirmDialog } from '../../components/admin/ConfirmDialog'
import { IconAlert, IconCheck, IconDownload } from '../../components/icons/icons'
import { Button } from '../../components/ui/Button'
import { Chip, type ChipTone } from '../../components/ui/Chip'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorState } from '../../components/ui/ErrorState'
import { Skeleton } from '../../components/ui/Skeleton'
import type { CatalogEntry } from '../../lib/catalogDiff'
import { fmtRelative } from '../../lib/format'
import {
  selectCatalogDiff,
  shouldShowRemoteError,
  useCatalogStore,
  type CatalogFailure,
} from '../../stores/catalogStore'
import { catalogErrorText, StoreModuleCard } from './StoreModuleCard'
import { StoreToolbar, type StoreCounts, type StoreFilter } from './StoreToolbar'

/** La promesa de §11.6.2/§11.6.4, palabra por palabra. Se usa en los DOS diálogos. */
const PROGRESS_PROMISE = 'Tu progreso se conserva'

export default function ModuleStoreScreen() {
  const status = useCatalogStore((s) => s.status)
  const remote = useCatalogStore((s) => s.remote)
  const stale = useCatalogStore((s) => s.stale)
  const loadingRemote = useCatalogStore((s) => s.loadingRemote)
  const refreshing = useCatalogStore((s) => s.refreshing)
  const statusError = useCatalogStore((s) => s.statusError)
  const remoteError = useCatalogStore((s) => s.remoteError)
  const ops = useCatalogStore((s) => s.ops)
  const opErrors = useCatalogStore((s) => s.opErrors)
  const hydrateStatus = useCatalogStore((s) => s.hydrateStatus)
  const refreshStatus = useCatalogStore((s) => s.refreshStatus)
  const loadRemote = useCatalogStore((s) => s.loadRemote)
  const install = useCatalogStore((s) => s.install)
  const update = useCatalogStore((s) => s.update)
  const remove = useCatalogStore((s) => s.remove)
  const clearOpError = useCatalogStore((s) => s.clearOpError)

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<StoreFilter>('all')
  /** Confirmación de quitar (CU-39): id del módulo, no la fila (se recalcula). */
  const [removeId, setRemoveId] = useState<string | null>(null)
  /** Diálogo de actualizar: es TAMBIÉN la confirmación, por la regla 2. */
  const [updateId, setUpdateId] = useState<string | null>(null)
  const [diffOpen, setDiffOpen] = useState(false)
  const [preview, setPreview] = useState<ModuleUpdatePreviewDto | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<CatalogFailure | null>(null)
  const [announcement, setAnnouncement] = useState<Announcement | null>(null)
  // Descarta respuestas de previews que ya no interesan (el usuario cerró el
  // diálogo o abrió el de otro módulo mientras la anterior volvía).
  const previewSeq = useRef(0)

  useEffect(() => {
    void hydrateStatus()
  }, [hydrateStatus])

  useEffect(() => {
    void loadRemote()
  }, [loadRemote])

  const diff = useMemo(() => selectCatalogDiff({ status, remote }), [status, remote])

  const entries = useMemo(() => diff.entries.filter((e) => e.state !== 'local_only'), [diff])

  const counts: StoreCounts = useMemo(
    () => ({
      all: entries.length,
      available: diff.byState.available.length,
      installed:
        diff.byState.up_to_date.length +
        diff.byState.update_available.length +
        diff.byState.unpublished.length,
      updates: diff.byState.update_available.length,
    }),
    [entries, diff],
  )

  const visible = useMemo(() => filterEntries(entries, filter, query), [entries, filter, query])

  const removeEntry = entries.find((e) => e.moduleId === removeId) ?? null
  const updateEntry = entries.find((e) => e.moduleId === updateId) ?? null

  // ── acciones ──────────────────────────────────────────────────────────────

  const handleRefresh = useCallback(() => {
    // Las DOS: `/remote?refresh=true` trae el índice del bucket (esta pantalla)
    // y `/catalog/refresh` reescribe el estado en SQLite, que es de donde salen
    // los chips de actualización de `/cursos`. Un solo clic, las dos vistas al día.
    void loadRemote(true)
    void refreshStatus()
  }, [loadRemote, refreshStatus])

  const handleInstall = useCallback(
    async (entry: CatalogEntry) => {
      if (await install(entry.moduleId)) {
        setAnnouncement({ text: `«${entry.title}» ya está en tu equipo.`, toCatalog: true })
      }
    },
    [install],
  )

  const loadPreview = useCallback((entry: CatalogEntry) => {
    const seq = (previewSeq.current += 1)
    setDiffOpen(true)
    setPreview(null)
    setPreviewError(null)
    setPreviewLoading(true)
    // Se ancla la versión que el usuario VIO en la tarjeta (si se conoce el
    // bucket), para que el diff y la actualización posterior hablen de lo mismo.
    getUpdatePreview(entry.moduleId, entry.remote?.version)
      .then((data) => {
        if (previewSeq.current !== seq) return
        setPreview(data)
        setPreviewLoading(false)
      })
      .catch((err: unknown) => {
        if (previewSeq.current !== seq) return
        setPreviewError(failureOf(err))
        setPreviewLoading(false)
      })
  }, [])

  const openUpdate = useCallback(
    (entry: CatalogEntry, withDiff: boolean) => {
      previewSeq.current += 1
      setUpdateId(entry.moduleId)
      setDiffOpen(false)
      setPreview(null)
      setPreviewError(null)
      setPreviewLoading(false)
      if (withDiff) loadPreview(entry)
    },
    [loadPreview],
  )

  const closeUpdate = useCallback(() => {
    previewSeq.current += 1
    setUpdateId(null)
    setDiffOpen(false)
    setPreview(null)
    setPreviewError(null)
    setPreviewLoading(false)
  }, [])

  const confirmUpdate = useCallback(async () => {
    if (updateEntry === null) return
    const { moduleId, title } = updateEntry
    // Con preview en mano se actualiza EXACTAMENTE a lo que se acaba de
    // enseñar; sin ella, el store ancla la versión del índice (§11.6.1).
    const opts = preview !== null ? { toVersion: preview.to_version, expectedChecksum: preview.to_checksum } : {}
    if (await update(moduleId, opts)) {
      closeUpdate()
      setAnnouncement({ text: `«${title}» está actualizado. ${PROGRESS_PROMISE}.`, toCatalog: true })
    }
    // Si falla, el diálogo SIGUE abierto mostrando el motivo: cerrarlo dejaría
    // el clic sin respuesta visible, con el aviso escondido detrás del scrim.
  }, [closeUpdate, preview, update, updateEntry])

  const confirmRemove = useCallback(async () => {
    if (removeEntry === null) return
    const { moduleId, title } = removeEntry
    const ok = await remove(moduleId)
    setRemoveId(null)
    if (ok) {
      setAnnouncement({ text: `«${title}» se quitó de este equipo. ${PROGRESS_PROMISE}.`, toCatalog: false })
    }
  }, [remove, removeEntry])

  // ── estados de pantalla ───────────────────────────────────────────────────

  // Despliegue sin bucket: apagado, no roto. Sin «Reintentar» (regla 3).
  if (remote === null && remoteError?.code === 'CATALOG_DISABLED') {
    return (
      <section className="screen store">
        <StoreHead />
        <EmptyState
          icon={<IconDownload size={20} />}
          title="Este equipo no tiene catálogo de módulos"
          body="No hay un repositorio de módulos configurado, así que no hay nada que incorporar. Tus lecciones instaladas siguen disponibles en Aprender."
          action={
            <Link className="btn btn-outline btn-sm" to="/cursos">
              Ir a Aprender
            </Link>
          }
        />
      </section>
    )
  }

  // Carga: se espera también a `/status`, que es offline-safe y rápido. Sin él
  // un módulo YA instalado aparecería un instante como «Disponible».
  if ((remote === null && remoteError === null) || (status === null && statusError === null)) {
    return (
      <section className="screen store" aria-busy="true">
        <StoreHead />
        <div className="store-grid" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} height={196} radius="var(--r-lg)" />
          ))}
        </div>
      </section>
    )
  }

  // Bucket caído y sin caché previa: el único ErrorState permitido en la app.
  if (remoteError !== null && shouldShowRemoteError({ remote, remoteError })) {
    return (
      <section className="screen store">
        <StoreHead />
        <ErrorState
          title="No se pudo consultar el catálogo"
          message={catalogErrorText(remoteError)}
          detail={`${remoteError.code} · ${remoteError.message}`}
          onRetry={handleRefresh}
        >
          <Link className="btn btn-ghost btn-sm" to="/cursos">
            Seguir con lo instalado
          </Link>
        </ErrorState>
      </section>
    )
  }

  const lastChecked = remote?.fetched_at ?? status?.last_checked_at ?? null
  // `stale` es información, no alarma; un refresh fallido CON lista en memoria,
  // tampoco: se sigue explorando lo último que se sabe del bucket.
  const showCacheNote = stale || (remoteError !== null && remote !== null)

  return (
    <section className="screen store">
      <StoreHead
        right={
          <div className="store-summary">
            <span className="store-summary-n">{counts.all}</span>
            <span className="muted">{counts.all === 1 ? 'módulo en el catálogo' : 'módulos en el catálogo'}</span>
            {lastChecked !== null && <span className="mono-small">consultado {fmtRelative(lastChecked)}</span>}
          </div>
        }
      />

      {showCacheNote && (
        <p className="store-note" role="status">
          <IconAlert size={14} />
          <span>
            Estás viendo la última lista guardada
            {lastChecked !== null ? ` (${fmtRelative(lastChecked)})` : ''}. Puedes seguir explorando; «Actualizar
            lista» vuelve a consultar el catálogo.
          </span>
        </p>
      )}

      {announcement !== null && (
        <p className="store-announce" role="status">
          <IconCheck size={14} />
          <span>{announcement.text}</span>
          {announcement.toCatalog && (
            <Link className="btn btn-ghost btn-sm" to="/cursos">
              Ir a Aprender
            </Link>
          )}
          <button
            type="button"
            className="store-dismiss"
            onClick={() => setAnnouncement(null)}
            aria-label="Descartar el aviso"
          >
            Descartar
          </button>
        </p>
      )}

      <StoreToolbar
        query={query}
        onQuery={setQuery}
        filter={filter}
        onFilter={setFilter}
        counts={counts}
        onRefresh={handleRefresh}
        refreshing={refreshing || loadingRemote}
      />

      {entries.length === 0 ? (
        <EmptyState
          icon={<IconDownload size={20} />}
          title="El catálogo todavía no publica módulos"
          body="Cuando se publique uno aparecerá aquí y podrás incorporarlo a este equipo."
        />
      ) : visible.length === 0 ? (
        <EmptyState
          title="Ningún módulo coincide con la búsqueda"
          body="Prueba con otro término o quita el filtro."
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setQuery('')
                setFilter('all')
              }}
            >
              Ver todos
            </Button>
          }
        />
      ) : (
        <div className="store-grid">
          {visible.map((entry) => (
            <StoreModuleCard
              key={entry.moduleId}
              entry={entry}
              op={ops[entry.moduleId]}
              error={opErrors[entry.moduleId]}
              onInstall={() => void handleInstall(entry)}
              onPreview={() => openUpdate(entry, true)}
              onUpdate={() => openUpdate(entry, false)}
              onRemove={() => setRemoveId(entry.moduleId)}
              onDismissError={() => clearOpError(entry.moduleId)}
            />
          ))}
        </div>
      )}

      {updateEntry !== null && (
        <UpdateDialog
          entry={updateEntry}
          diffOpen={diffOpen}
          preview={preview}
          loading={previewLoading}
          previewError={previewError}
          opError={opErrors[updateEntry.moduleId]}
          busy={ops[updateEntry.moduleId] === 'updating'}
          onShowDiff={() => loadPreview(updateEntry)}
          onConfirm={() => void confirmUpdate()}
          onClose={closeUpdate}
        />
      )}

      <ConfirmDialog
        open={removeEntry !== null}
        title={`¿Quitar «${removeEntry?.title ?? ''}»?`}
        body={
          <>
            Sus lecciones dejan de estar en este equipo. <strong>{PROGRESS_PROMISE}</strong>: si vuelves a
            incorporar el módulo, recuperas tu avance tal y como estaba.
          </>
        }
        confirmLabel="Quitar módulo"
        tone="danger"
        busy={removeEntry !== null && ops[removeEntry.moduleId] === 'removing'}
        onConfirm={() => void confirmRemove()}
        onCancel={() => setRemoveId(null)}
      />
    </section>
  )
}

// ── cabecera ────────────────────────────────────────────────────────────────

function StoreHead({ right }: { right?: ReactNode }) {
  return (
    <div className="screen-head">
      <div>
        <div className="eyebrow">Aprendizaje</div>
        <h2 className="display-lg">Módulos disponibles</h2>
        <p className="muted store-lead">
          Elige qué módulos quieres en este equipo. Puedes incorporarlos, actualizarlos y quitarlos cuando
          quieras: <strong>{PROGRESS_PROMISE.toLowerCase()}</strong>.
        </p>
      </div>
      {right}
    </div>
  )
}

// ── diálogo de actualizar (= confirmación + «qué cambia») ───────────────────

interface Announcement {
  text: string
  /** Añade el CTA a `/cursos`: tras incorporar o actualizar, ahí está el contenido. */
  toCatalog: boolean
}

interface UpdateDialogProps {
  entry: CatalogEntry
  diffOpen: boolean
  preview: ModuleUpdatePreviewDto | null
  loading: boolean
  previewError: CatalogFailure | null
  opError?: CatalogFailure
  busy: boolean
  onShowDiff: () => void
  onConfirm: () => void
  onClose: () => void
}

const CHANGE_LABEL: Record<LessonChange, string> = {
  added: 'Nueva',
  updated: 'Actualizada',
  unchanged: 'Sin cambios',
  removed: 'Retirada',
}

const CHANGE_TONE: Record<LessonChange, ChipTone> = {
  added: 'green',
  updated: 'blue',
  unchanged: 'neutral',
  removed: 'amber',
}

/**
 * Vocabulario de §11.6.2, sin eufemismos y sin mentiras: `archived` NO es
 * «se borra» (la lección sigue siendo legible y conserva su historial) y
 * `rescored` NO es «se pierde la nota» (un aprobado ganado jamás se revoca).
 */
const PROGRESS_LABEL: Record<ProgressEffect, string> = {
  preserved: 'Tu avance se conserva',
  rescored: 'La nota se recalcula; lo aprobado no se revoca',
  archived: 'Se archiva: tu avance se guarda',
  none: 'Sin avance previo',
}

function UpdateDialog({
  entry,
  diffOpen,
  preview,
  loading,
  previewError,
  opError,
  busy,
  onShowDiff,
  onConfirm,
  onClose,
}: UpdateDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    // El foco entra en el diálogo por «Cancelar», no por la acción: un Enter
    // reflejo no puede disparar una escritura de contenido.
    closeRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const fromVersion = preview?.from_version ?? entry.installedVersion
  const toVersion = preview?.to_version ?? entry.availableVersion

  return (
    <div
      className="dialog-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="card dialog" role="dialog" aria-modal="true" aria-labelledby="store-update-title">
        <div className="card-head">
          <IconDownload size={16} />
          <div>
            <div className="card-title" id="store-update-title">
              Actualizar «{entry.title}»
            </div>
            {fromVersion != null && toVersion != null && (
              <div className="card-sub">
                v{fromVersion} → v{toVersion}
              </div>
            )}
          </div>
        </div>

        <div className="dialog-body">
          {/* Copy OBLIGATORIA (regla 2): sin esta frase nadie pulsa el botón. */}
          <p className="store-promise">
            <IconCheck size={14} />
            <span>
              <strong>{PROGRESS_PROMISE}.</strong> Las lecciones que ya completaste siguen completadas, y las
              que esta versión retire se archivan sin borrar tu avance.
            </span>
          </p>

          {!diffOpen && (
            <div>
              <Button variant="outline" size="sm" onClick={onShowDiff}>
                Ver qué cambia
              </Button>
            </div>
          )}

          {loading && (
            <div className="store-diff-skeleton" aria-hidden="true">
              <Skeleton height={18} />
              <Skeleton height={18} />
              <Skeleton height={18} />
            </div>
          )}

          {previewError !== null && (
            <p className="store-dialog-error" role="alert">
              <IconAlert size={14} />
              <span>No se pudo consultar qué cambia: {catalogErrorText(previewError)}</span>
            </p>
          )}

          {preview !== null && (
            <>
              <p className="dialog-note">
                <b>{preview.progress_summary.preserved}</b> conservan tu avance ·{' '}
                <b>{preview.progress_summary.rescored}</b> recalculan la nota ·{' '}
                <b>{preview.progress_summary.archived}</b> se archivan ·{' '}
                <b>{preview.progress_summary.unaffected}</b> sin cambios
              </p>

              <ul className="store-diff" aria-label="Cambios lección por lección">
                {preview.lessons.map((lesson) => (
                  <li key={lesson.lesson_id} className="store-diff-row">
                    <code className="mono-small">{lesson.lesson_id}</code>
                    <Chip tone={CHANGE_TONE[lesson.change]}>{CHANGE_LABEL[lesson.change]}</Chip>
                    <span className="store-diff-effect">{PROGRESS_LABEL[lesson.progress]}</span>
                  </li>
                ))}
              </ul>

              {preview.warnings.length > 0 && (
                <ul className="store-warnings">
                  {preview.warnings.map((w, i) => (
                    <li key={`${w.code}-${w.lesson_id ?? i}`}>
                      <IconAlert size={14} /> {w.message}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {opError != null && (
            <p className="store-dialog-error" role="alert">
              <IconAlert size={14} />
              <span>{catalogErrorText(opError)}</span>
            </p>
          )}
        </div>

        <div className="dialog-actions">
          {/* <button> nativo: necesita ref para recibir el foco al abrir y
              `Button` no reenvía refs (mismo motivo que en AboutDialog). */}
          <button ref={closeRef} type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <Button variant="primary" size="sm" onClick={onConfirm} disabled={busy}>
            {busy ? 'Actualizando…' : 'Actualizar ahora'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── interno ─────────────────────────────────────────────────────────────────

function filterEntries(
  entries: readonly CatalogEntry[],
  filter: StoreFilter,
  query: string,
): CatalogEntry[] {
  const q = query.trim().toLowerCase()
  return entries.filter((entry) => {
    if (filter === 'available' && entry.state !== 'available') return false
    if (filter === 'updates' && entry.state !== 'update_available') return false
    if (filter === 'installed' && entry.state === 'available') return false
    if (q === '') return true
    return [entry.title, entry.moduleId, entry.remote?.description ?? '', entry.remote?.level ?? ''].some(
      (field) => field.toLowerCase().includes(q),
    )
  })
}

/** Mismo criterio que el store: se conserva el `error.code` del contrato. */
function failureOf(err: unknown): CatalogFailure {
  if (err instanceof ApiError) return { code: err.code, message: err.message }
  return { code: 'UNKNOWN', message: err instanceof Error ? err.message : String(err) }
}
