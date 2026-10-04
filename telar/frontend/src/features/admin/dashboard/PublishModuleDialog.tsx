// PublishModuleDialog — §11.8 CU-38: publicar un módulo en el bucket.
//
// El diálogo está construido alrededor de UNA idea: **publicar es
// irreversible**. Una versión publicada es inmutable (`if_generation_match=0`),
// así que no hay «deshacer»: lo que se sube se queda, y quien lo instale
// dependerá de ello. Por eso el flujo tiene dos pasos obligatorios y no uno.
//
//   1. ENSAYO (`dry_run`) — recorre el MISMO camino que publicar (construye el
//      bundle, lo valida con las reglas del importador, lo firma) pero no
//      escribe nada. Es lo que produce los avisos, y el que más importa es
//      `LESSON_ID_REMOVED`: dice que quien actualice PERDERÁ su avance en esa
//      lección. Enseñarlo después de subir sería enseñarlo tarde.
//   2. PUBLICAR — solo se habilita tras un ensayo con éxito. NO reenvía la
//      versión ni el checksum del ensayo: el servidor vuelve a construir y a
//      validar el bundle, así que publica el contenido de ese momento (anclar
//      lo ensayado sería CU-37.2, descartado).
//
// Antes de todo eso comprueba la credencial (§11.8.1) para poder decir POR QUÉ
// no se puede publicar, y compara el contenido local con la versión vigente
// (§11.8.3, D+) para decir si hay algo que publicar.
import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../../api/client'
import { getCatalogCredentials, getPublishStatus, publishModule } from '../../../api/admin'
import type {
  AdminCatalogCredentialStatusDto,
  AdminPublishResultDto,
  AdminPublishStatusDto,
  CredentialReason,
} from '../../../api/admin-types'
import type { ModuleDto } from '../../../api/types'
import { Button } from '../../../components/ui/Button'

export interface PublishModuleDialogProps {
  module: ModuleDto
  onClose: () => void
  onPublished: (message: string) => void
}

/** §11.8.1 — cada motivo manda al admin a un sitio DISTINTO a arreglarlo. */
const MOTIVO: Record<CredentialReason, string> = {
  absent:
    'Este equipo no tiene credencial de publicación: falta TELAR_GCS_CREDENTIALS.',
  unreadable: 'El archivo de la credencial no existe o no se puede leer.',
  insecure_mode:
    'La credencial es legible por otros usuarios del sistema. Debe tener permisos 0600.',
  malformed:
    'El archivo no es una clave de cuenta de servicio de Google válida.',
  forbidden:
    'La cuenta de servicio no tiene permiso para escribir en el bucket.',
}

/** Los avisos no bloquean, pero no todos pesan igual: el orden es el del daño. */
const AVISO: Record<string, { titulo: string; grave: boolean }> = {
  LESSON_ID_REMOVED: { titulo: 'Se retira una lección', grave: true },
  QUIZ_SHAPE_CHANGED: { titulo: 'Cambia un quiz', grave: true },
  EXAMPLE_ID_RENAMED: { titulo: 'Se renombra un ejemplo', grave: false },
  LESSON_ID_ADDED: { titulo: 'Lección nueva', grave: false },
}

/** CU-37.4 — la frase exacta del caso «subido pero sin constancia local». */
const SIN_ESTADO_LOCAL =
  'Publicado en la nube; no se pudo actualizar el estado local. Reintenta.'

/** `'error'` = la propia consulta falló: se trata igual que «sin red». */
type Estado = AdminPublishStatusDto | 'error' | null

/** Un problema de validación, ya localizado en su lección (CU-37.1). */
interface Problema {
  leccion: string | null
  campo: string
  motivo: string
}

function textoDeEstado(estado: Estado): string {
  if (estado == null) return 'Comprobando si hay cambios sin publicar…'
  if (estado === 'error' || estado.state === 'unknown')
    return 'No se pudo comprobar si hay cambios sin publicar; puedes publicar igualmente.'
  switch (estado.state) {
    case 'never_published':
      return 'Este módulo aún no se ha publicado.'
    case 'unchanged':
      return `No hay cambios respecto a v${estado.published_version}.`
    case 'changed':
      return `Tienes cambios sin publicar (la publicada es la v${estado.published_version}).`
    case 'out_of_sync':
      return SIN_ESTADO_LOCAL
  }
}

function mensajeDeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'VERSION_CONFLICT')
      return 'Esa versión ya está publicada con otro contenido. Las versiones son inmutables: usa la siguiente.'
    if (err.code === 'CATALOG_CREDENTIALS_INVALID')
      return 'La credencial de publicación no sirve. Revísala y vuelve a intentarlo.'
    if (err.code === 'CATALOG_DISABLED')
      return 'Este despliegue no tiene bucket configurado (TELAR_CATALOG_BUCKET).'
    if (err.code === 'CATALOG_UNAVAILABLE')
      return 'No se pudo contactar con el bucket. Comprueba la conexión e inténtalo de nuevo.'
    if (err.code === 'BUNDLE_TOO_LARGE')
      return 'El módulo ocupa más de lo que el catálogo admite.'
    if (err.code === 'CONTENT_VALIDATION_ERROR' || err.code === 'BUNDLE_INVALID')
      return 'El módulo no se puede publicar así: un estudiante no podría instalarlo. Corrige esto:'
    return err.message
  }
  return 'No se pudo publicar el módulo.'
}

/** `details` de un 422 → problemas legibles, con el TÍTULO de la lección. */
function problemasDe(err: unknown, module: ModuleDto): Problema[] {
  if (!(err instanceof ApiError) || !Array.isArray(err.details)) return []
  const titulos = new Map(module.lessons.map((l) => [l.id, l.title]))
  return err.details.flatMap((d: unknown) => {
    if (d == null || typeof d !== 'object') return []
    const { field, reason, lesson_id } = d as Record<string, unknown>
    if (typeof reason !== 'string') return []
    const id = typeof lesson_id === 'string' ? lesson_id : null
    return [
      {
        leccion: id == null ? null : (titulos.get(id) ?? id),
        // Con la lección delante, `lessons[3].` solo es ruido para el autor.
        campo: typeof field === 'string' ? field.replace(/^lessons\[\d+\]\.?/, '') : '',
        motivo: reason,
      },
    ]
  })
}

export function PublishModuleDialog({
  module,
  onClose,
  onPublished,
}: PublishModuleDialogProps) {
  // `'error'` = no se pudo ni consultar (red): se dice y se ofrece repetir.
  const [credencial, setCredencial] = useState<
    AdminCatalogCredentialStatusDto | 'error' | null
  >(null)
  const [estado, setEstado] = useState<Estado>(null)
  const [ensayo, setEnsayo] = useState<AdminPublishResultDto | null>(null)
  const [notas, setNotas] = useState('')
  const [ocupado, setOcupado] = useState(false)
  // Publicar es irreversible: si el diálogo se desmonta con la petición en
  // vuelo, su resultado ya no tiene a quién avisar.
  const montado = useRef(true)
  // Se vuelve a poner en true al montar: StrictMode (dev) desmonta y remonta,
  // y sin esto la respuesta del ensayo se ignoraba («Comprobando…» eterno).
  useEffect(() => {
    montado.current = true
    return () => {
      montado.current = false
    }
  }, [])
  const [error, setError] = useState<string | null>(null)
  const [problemas, setProblemas] = useState<Problema[]>([])
  const [sinEstadoLocal, setSinEstadoLocal] = useState(false)

  const [intentoCredencial, setIntentoCredencial] = useState(0)

  useEffect(() => {
    let vivo = true
    setCredencial(null)
    // `probe: true`: comprobar el archivo no basta para saber si la CUENTA
    // puede escribir en el bucket, y descubrirlo al pulsar «Publicar» es tarde.
    getCatalogCredentials(true)
      .then((c) => vivo && setCredencial(c))
      .catch(() => vivo && setCredencial('error'))
    return () => {
      vivo = false
    }
  }, [intentoCredencial])

  useEffect(() => {
    let vivo = true
    getPublishStatus(module.id)
      .then((e) => vivo && setEstado(e))
      .catch(() => vivo && setEstado('error'))
    return () => {
      vivo = false
    }
  }, [module.id])

  async function ejecutar(dryRun: boolean) {
    setOcupado(true)
    setError(null)
    setProblemas([])
    try {
      const r = await publishModule(module.id, { dry_run: dryRun, notes: notas })
      if (!montado.current) return
      if (dryRun) setEnsayo(r)
      else if (!r.local_state_updated) setSinEstadoLocal(true)
      else onPublished(`«${module.title}» se publicó como v${r.version}.`)
    } catch (err) {
      if (!montado.current) return
      setError(mensajeDeError(err))
      setProblemas(problemasDe(err, module))
      // Un ensayo fallido invalida el anterior: si no, el botón de publicar
      // seguiría habilitado por un ensayo que ya no describe la realidad.
      if (dryRun) setEnsayo(null)
    } finally {
      if (montado.current) setOcupado(false)
    }
  }

  const puedePublicar = credencial != null && credencial !== 'error' && credencial.usable
  const sinCambios = estado != null && estado !== 'error' && estado.state === 'unchanged'
  // CU-37.4: la nube ya tiene la versión; publicar de nuevo solo la registra.
  const reintentar = sinEstadoLocal || (estado !== 'error' && estado?.state === 'out_of_sync')
  const avisos = ensayo?.warnings ?? []
  const graves = avisos.filter((w) => AVISO[w.code]?.grave)

  return (
    <div className="admin-modal-backdrop" onMouseDown={ocupado ? undefined : onClose}>
      <div
        className="admin-modal admin-modal-form card"
        role="dialog"
        aria-labelledby="publish-title"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 id="publish-title" className="display-md">
          Publicar «{module.title}»
        </h3>

        {/* ── la credencial, ANTES de nada ─────────────────────────────── */}
        {credencial == null ? (
          <p className="field-hint">Comprobando la credencial…</p>
        ) : credencial === 'error' ? (
          <div className="field-hint error" role="alert">
            No se pudo comprobar la credencial de publicación.{' '}
            <Button variant="ghost" size="sm" onClick={() => setIntentoCredencial((n) => n + 1)}>
              Volver a comprobar
            </Button>
          </div>
        ) : puedePublicar ? (
          <p className="field-hint">
            Se publicará en <strong>{credencial.bucket}</strong> con la cuenta{' '}
            <code>{credencial.client_email}</code>.
          </p>
        ) : (
          <div className="field-hint error" role="alert">
            {credencial.reason != null
              ? MOTIVO[credencial.reason]
              : 'La credencial de publicación no sirve.'}
          </div>
        )}

        {/* ── D+: ¿hay algo que publicar? ─────────────────────────────── */}
        <p
          className={['field-hint', reintentar ? 'error' : ''].filter(Boolean).join(' ')}
          role="status"
        >
          {sinEstadoLocal ? SIN_ESTADO_LOCAL : textoDeEstado(estado)}
        </p>

        {error != null && (
          <div className="field-hint error" role="alert" style={{ marginTop: 10 }}>
            {error}
            {problemas.length > 0 && (
              <ul className="publish-warnings">
                {problemas.map((p, i) => (
                  <li key={`${p.leccion ?? ''}-${p.campo}-${i}`} className="grave">
                    <strong>{p.leccion ?? 'Módulo'}</strong>
                    {p.campo !== '' && <code> {p.campo}</code>} — {p.motivo}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {puedePublicar && !reintentar && (
          <>
            <label className="field-label" htmlFor="publish-notes">
              Notas de esta versión (opcional)
            </label>
            <input
              id="publish-notes"
              className="input"
              value={notas}
              maxLength={2000}
              placeholder="Qué cambia respecto de la versión anterior"
              onChange={(e) => setNotas(e.target.value)}
            />

            {/* ── el ensayo ────────────────────────────────────────────── */}
            {ensayo != null && (
              <div className="publish-preview" style={{ marginTop: 14 }}>
                <p className="field-hint">
                  Se publicará como <strong>v{ensayo.version}</strong> ·{' '}
                  {ensayo.lesson_ids.length} lecciones · {ensayo.bytes} bytes
                </p>

                {avisos.length === 0 ? (
                  <p className="field-hint">Sin avisos: nada se retira ni cambia de forma.</p>
                ) : (
                  <ul className="publish-warnings">
                    {avisos.map((w, i) => (
                      <li
                        key={`${w.code}-${w.lesson_id ?? i}`}
                        className={AVISO[w.code]?.grave ? 'grave' : undefined}
                      >
                        <strong>{AVISO[w.code]?.titulo ?? w.code}</strong>
                        {w.lesson_id != null && <code> {w.lesson_id}</code>} — {w.message}
                      </li>
                    ))}
                  </ul>
                )}

                {graves.length > 0 && (
                  // La frase importa: es lo único que separa a un autor de
                  // borrarle el avance a sus estudiantes sin enterarse.
                  <p className="field-hint error" role="alert">
                    Publicar es <strong>irreversible</strong> y esta versión afecta al
                    avance de quien ya tenga el módulo. Revisa los avisos antes de
                    continuar.
                  </p>
                )}
              </div>
            )}
          </>
        )}

        <div className="admin-modal-actions">
          <Button variant="ghost" onClick={onClose} disabled={ocupado}>
            Cancelar
          </Button>
          {reintentar ? (
            <Button
              variant="primary"
              onClick={() => ejecutar(false)}
              disabled={!puedePublicar || ocupado}
            >
              {ocupado ? 'Reintentando…' : 'Reintentar'}
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => ejecutar(true)}
                disabled={!puedePublicar || ocupado}
              >
                {ocupado && ensayo == null ? 'Comprobando…' : 'Ver qué se publicará'}
              </Button>
              <Button
                variant="primary"
                onClick={() => ejecutar(false)}
                // Solo tras un ensayo con éxito (publicar sin haber visto los
                // avisos es lo que este diálogo existe para impedir) y solo si
                // hay algo nuevo: republicar lo mismo crearía una versión vacía.
                disabled={!puedePublicar || ocupado || ensayo == null || sinCambios}
              >
                {ocupado && ensayo != null ? 'Publicando…' : `Publicar v${ensayo?.version ?? ''}`}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
