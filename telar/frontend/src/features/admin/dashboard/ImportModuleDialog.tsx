// ImportModuleDialog — §11.7 CU-37: traer un módulo del bucket para editarlo.
//
// La decisión que este diálogo tiene que hacer entendible no es «qué módulo»,
// es **qué modo**, porque los dos parecen «descargar» y hacen cosas opuestas:
//
//   VINCULADO  el módulo sigue siendo el del bucket. Se puede editar, pero
//              conserva el vínculo, así que sabe sobre qué versión base va y
//              recibirá las actualizaciones que publique su autor.
//   BIFURCADO  se lleva una COPIA con ids propios que ya no sigue a nadie. Es
//              lo que se quiere para adaptar el material de otro sin que una
//              actualización suya te pise el trabajo.
//
// Por eso el modo se elige con dos opciones explicadas y no con una casilla
// «avanzado»: elegir mal no da un error, da un comportamiento distinto meses
// después. Y en fork se enseña el id resultante de una lección ANTES de
// importar, que es la única forma de que el prefijo deje de ser abstracto.
import { useEffect, useMemo, useState } from 'react'
import { ApiError } from '../../../api/client'
import { importCatalogModule } from '../../../api/admin'
import { getRemoteCatalog } from '../../../api/catalog'
import type { AdminImportResultDto } from '../../../api/admin-types'
import type { RemoteModuleSummaryDto } from '../../../api/catalog-types'
import { Button } from '../../../components/ui/Button'
import { Field } from '../../../components/ui/Field'
import { slugify } from '../../../lib/slug'

export interface ImportModuleDialogProps {
  /** Ids de módulos que ya existen aquí — para avisar del choque antes de enviar. */
  existingIds: readonly string[]
  onClose: () => void
  onImported: (message: string) => void
}

type Modo = 'linked' | 'forked'

function mensajeDeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'DUPLICATE_ID')
      return 'Ese identificador ya lo usa contenido de este equipo. Elige otro para la copia.'
    if (err.code === 'MODULE_ALREADY_INSTALLED')
      return 'Ese módulo ya está incorporado. Para quedarte una copia editable, usa «Una copia independiente».'
    if (err.code === 'REMOTE_MODULE_NOT_FOUND')
      return 'Ese módulo ya no está en el catálogo. Actualiza la lista.'
    if (err.code === 'CATALOG_DISABLED')
      return 'Este despliegue no tiene catálogo remoto configurado.'
    if (err.code === 'CATALOG_UNAVAILABLE')
      return 'No se pudo contactar con el catálogo. Inténtalo de nuevo.'
    if (err.code === 'CHECKSUM_MISMATCH')
      return 'El catálogo cambió mientras mirabas. Actualiza la lista y repite.'
    return err.message
  }
  return 'No se pudo importar el módulo.'
}

export function ImportModuleDialog({
  existingIds,
  onClose,
  onImported,
}: ImportModuleDialogProps) {
  const [remotos, setRemotos] = useState<RemoteModuleSummaryDto[] | null>(null)
  const [elegido, setElegido] = useState<string>('')
  const [modo, setModo] = useState<Modo>('linked')
  const [nuevoId, setNuevoId] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    getRemoteCatalog(true)
      .then((r) => {
        if (!vivo) return
        setRemotos(r.modules)
        if (r.modules.length > 0) setElegido(r.modules[0].id)
      })
      .catch((err) => vivo && setError(mensajeDeError(err)))
    return () => {
      vivo = false
    }
  }, [])

  const modulo = remotos?.find((m) => m.id === elegido) ?? null

  // El id de la copia se propone solo, como en el alta de módulo: escribirlo a
  // mano es la vía rápida a un id con espacios o acentos que luego es una ruta
  // del bucket.
  useEffect(() => {
    if (modo === 'forked' && modulo != null && nuevoId === '') {
      setNuevoId(slugify(`${modulo.id} mio`))
    }
  }, [modo, modulo, nuevoId])

  const prefijo = nuevoId === '' ? '' : `${nuevoId}-`
  const yaExiste = modo === 'forked' && existingIds.includes(nuevoId)
  const yaIncorporado = modo === 'linked' && modulo?.state !== 'available'

  const ejemploId = useMemo(() => {
    // Enseñar el id que saldrá es lo que hace concreto el prefijo. Sin un
    // ejemplo real, «se prefijan los ids» no significa nada para nadie.
    if (modo !== 'forked' || modulo == null) return null
    return `${prefijo}<id-de-lección>`
  }, [modo, modulo, prefijo])

  async function importar() {
    if (modulo == null) return
    setOcupado(true)
    setError(null)
    try {
      const r: AdminImportResultDto = await importCatalogModule({
        module_id: modulo.id,
        ...(modo === 'forked' ? { as_module_id: nuevoId } : {}),
      })
      onImported(
        r.mode === 'forked'
          ? `Se importó una copia independiente como «${r.module.id}».`
          : `«${r.module.title}» se incorporó y ya se puede editar.`,
      )
    } catch (err) {
      setError(mensajeDeError(err))
    } finally {
      setOcupado(false)
    }
  }

  const puedeImportar =
    modulo != null &&
    !ocupado &&
    !yaExiste &&
    !(modo === 'linked' && yaIncorporado) &&
    (modo === 'linked' || nuevoId.trim() !== '')

  return (
    <div className="admin-modal-backdrop" onMouseDown={onClose}>
      <div
        className="admin-modal admin-modal-form card"
        role="dialog"
        aria-labelledby="import-title"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 id="import-title" className="display-md">
          Importar del catálogo
        </h3>

        {error != null && (
          <div className="field-hint error" role="alert" style={{ marginTop: 10 }}>
            {error}
          </div>
        )}

        {remotos == null ? (
          <p className="field-hint">Leyendo el catálogo…</p>
        ) : remotos.length === 0 ? (
          <p className="field-hint">No hay módulos publicados en el catálogo.</p>
        ) : (
          <>
            <Field label="Módulo del catálogo" htmlFor="import-modulo">
              <select
                id="import-modulo"
                className="input"
                value={elegido}
                onChange={(e) => setElegido(e.target.value)}
              >
                {remotos.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title} · v{m.version} · {m.lessons_count} lecciones
                  </option>
                ))}
              </select>
            </Field>

            <fieldset className="import-modos">
              <legend className="field-label">Cómo quieres traerlo</legend>

              <label className="import-modo">
                <input
                  type="radio"
                  name="import-modo"
                  checked={modo === 'linked'}
                  onChange={() => setModo('linked')}
                />
                <span>
                  <strong>Vinculado al catálogo</strong>
                  <span className="field-hint">
                    Lo editas aquí, pero sigue siendo el módulo de su autor: sabrás
                    sobre qué versión trabajas y te llegarán sus actualizaciones.
                  </span>
                </span>
              </label>

              <label className="import-modo">
                <input
                  type="radio"
                  name="import-modo"
                  checked={modo === 'forked'}
                  onChange={() => setModo('forked')}
                />
                <span>
                  <strong>Una copia independiente</strong>
                  <span className="field-hint">
                    Se lleva una copia con identificadores propios que ya{' '}
                    <strong>no recibe actualizaciones</strong>. Es lo que quieres para
                    adaptarlo sin que una versión nueva te pise el trabajo.
                  </span>
                </span>
              </label>
            </fieldset>

            {modo === 'linked' && yaIncorporado && (
              <div className="field-hint error" role="alert">
                Ese módulo ya está incorporado en este equipo. Para quedarte una
                versión tuya, elige «Una copia independiente».
              </div>
            )}

            {modo === 'forked' && (
              <>
                <Field
                  label="Identificador de la copia"
                  htmlFor="import-id"
                  hint="Será su id en el catálogo cuando la publiques."
                >
                  <input
                    id="import-id"
                    className="input"
                    value={nuevoId}
                    spellCheck={false}
                    onChange={(e) => setNuevoId(slugify(e.target.value))}
                  />
                </Field>
                {yaExiste ? (
                  <div className="field-hint error" role="alert">
                    Ya existe un módulo con ese identificador en este equipo.
                  </div>
                ) : (
                  ejemploId != null && (
                    <p className="field-hint">
                      Las lecciones se renombrarán así: <code>{ejemploId}</code>
                    </p>
                  )
                )}
              </>
            )}
          </>
        )}

        <div className="admin-modal-actions">
          <Button variant="ghost" onClick={onClose} disabled={ocupado}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={importar} disabled={!puedeImportar}>
            {ocupado ? 'Importando…' : 'Importar'}
          </Button>
        </div>
      </div>
    </div>
  )
}
