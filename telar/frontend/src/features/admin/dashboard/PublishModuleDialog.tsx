// PublishModuleDialog — §11.8 CU-38: publicar un módulo en el bucket.
//
// El diálogo está construido alrededor de UNA idea: **publicar es
// irreversible**. Una versión publicada es inmutable (`if_generation_match=0`),
// así que no hay «deshacer»: lo que se sube se queda, y quien lo instale
// dependerá de ello. Por eso el flujo tiene dos pasos obligatorios y no uno.
//
//   1. ENSAYO (`dry_run`) — recorre el MISMO camino que publicar (construye el
//      bundle, lo valida, lo firma) pero no escribe nada. Es lo que produce los
//      avisos, y el que más importa es `LESSON_ID_REMOVED`: dice que quien
//      actualice PERDERÁ su avance en esa lección. Enseñarlo después de subir
//      sería enseñarlo tarde.
//   2. PUBLICAR — solo se habilita cuando el ensayo ha salido bien, y repite la
//      versión y el checksum que el ensayo mostró.
//
// Antes de todo eso comprueba la credencial (§11.8.1) para poder decir POR QUÉ
// no se puede publicar en vez de dejar que el admin lo descubra al pulsar.
import { useEffect, useState } from 'react'
import { ApiError } from '../../../api/client'
import { getCatalogCredentials, publishModule } from '../../../api/admin'
import type {
  AdminCatalogCredentialStatusDto,
  AdminPublishResultDto,
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

function mensajeDeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'VERSION_CONFLICT')
      return 'Esa versión ya está publicada. Las versiones son inmutables: usa la siguiente.'
    if (err.code === 'CATALOG_CREDENTIALS_INVALID')
      return 'La credencial de publicación no sirve. Revísala y vuelve a intentarlo.'
    if (err.code === 'CATALOG_DISABLED')
      return 'Este despliegue no tiene bucket configurado (TELAR_CATALOG_BUCKET).'
    if (err.code === 'CATALOG_UNAVAILABLE')
      return 'No se pudo contactar con el bucket. Comprueba la conexión e inténtalo de nuevo.'
    if (err.code === 'BUNDLE_TOO_LARGE')
      return 'El módulo ocupa más de lo que el catálogo admite.'
    return err.message
  }
  return 'No se pudo publicar el módulo.'
}

export function PublishModuleDialog({
  module,
  onClose,
  onPublished,
}: PublishModuleDialogProps) {
  const [credencial, setCredencial] = useState<AdminCatalogCredentialStatusDto | null>(
    null,
  )
  const [ensayo, setEnsayo] = useState<AdminPublishResultDto | null>(null)
  const [notas, setNotas] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    // `probe: true`: comprobar el archivo no basta para saber si la CUENTA
    // puede escribir en el bucket, y descubrirlo al pulsar «Publicar» es tarde.
    getCatalogCredentials(true)
      .then((c) => vivo && setCredencial(c))
      .catch(() => vivo && setError('No se pudo comprobar la credencial de publicación.'))
    return () => {
      vivo = false
    }
  }, [])

  async function ejecutar(dryRun: boolean) {
    setOcupado(true)
    setError(null)
    try {
      const r = await publishModule(module.id, { dry_run: dryRun, notes: notas })
      if (dryRun) setEnsayo(r)
      else onPublished(`«${module.title}» se publicó como v${r.version}.`)
    } catch (err) {
      setError(mensajeDeError(err))
      // Un ensayo fallido invalida el anterior: si no, el botón de publicar
      // seguiría habilitado por un ensayo que ya no describe la realidad.
      if (dryRun) setEnsayo(null)
    } finally {
      setOcupado(false)
    }
  }

  const puedePublicar = credencial?.usable === true
  const avisos = ensayo?.warnings ?? []
  const graves = avisos.filter((w) => AVISO[w.code]?.grave)

  return (
    <div className="admin-modal-backdrop" onMouseDown={onClose}>
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

        {error != null && (
          <div className="field-hint error" role="alert" style={{ marginTop: 10 }}>
            {error}
          </div>
        )}

        {puedePublicar && (
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
            // Solo tras un ensayo con éxito: publicar sin haber visto los avisos
            // es exactamente lo que este diálogo existe para impedir.
            disabled={!puedePublicar || ocupado || ensayo == null}
          >
            {ocupado && ensayo != null ? 'Publicando…' : `Publicar v${ensayo?.version ?? ''}`}
          </Button>
        </div>
      </div>
    </div>
  )
}
