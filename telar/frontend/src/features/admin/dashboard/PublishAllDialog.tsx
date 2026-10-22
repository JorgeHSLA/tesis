// PublishAllDialog — «Publicar todo»: publica de una vez cada módulo con
// cambios sin publicar.
//
// Es el mismo flujo de `PublishModuleDialog` aplicado a varios módulos, con sus
// dos pasos obligatorios, porque publicar sigue siendo IRREVERSIBLE:
//
//   1. REVISAR — un ensayo (`dry_run`) por módulo. Construye y valida cada
//      bundle sin escribir nada y junta los avisos; los graves (una lección
//      retirada, un quiz que cambia de forma) se muestran antes de publicar.
//   2. PUBLICAR — solo los módulos cuyo ensayo salió bien, UNO DETRÁS DE OTRO:
//      cada publicación reescribe el índice del bucket, y en serie no compiten
//      por él. Un fallo no detiene a los demás; queda anotado en su fila.
//
// Los módulos sin cambios no se tocan: republicarlos crearía versiones vacías.
import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../../api/client'
import { getCatalogCredentials, getPublishStatus, publishModule } from '../../../api/admin'
import type {
  AdminCatalogCredentialStatusDto,
  AdminPublishResultDto,
  AdminPublishStatusDto,
} from '../../../api/admin-types'
import type { ModuleDto } from '../../../api/types'
import { Button } from '../../../components/ui/Button'

export interface PublishAllDialogProps {
  modules: ModuleDto[]
  onClose: () => void
  /** Se llama al cerrar si se publicó algo, con el resumen para el toast. */
  onDone: (message: string) => void
}

/** Avisos que afectan al avance de quien ya tiene el módulo. */
const GRAVES = new Set(['LESSON_ID_REMOVED', 'QUIZ_SHAPE_CHANGED'])

type Fase = 'cargando' | 'listo' | 'revisando' | 'revisado' | 'publicando' | 'terminado'

interface Fila {
  module: ModuleDto
  estado: AdminPublishStatusDto | 'error' | null
  /** Marcado para publicar (por defecto: los que tienen cambios). */
  marcado: boolean
  ensayo: AdminPublishResultDto | null
  publicado: AdminPublishResultDto | null
  error: string | null
}

/** ¿Hay algo que publicar? `unknown`/error no se marca: no se pudo comprobar. */
function tieneCambios(estado: Fila['estado']): boolean {
  if (estado == null || estado === 'error') return false
  return estado.state === 'never_published' || estado.state === 'changed' || estado.state === 'out_of_sync'
}

function textoDeEstado(estado: Fila['estado']): string {
  if (estado == null) return 'Comprobando…'
  if (estado === 'error' || estado.state === 'unknown') return 'No se pudo comprobar'
  switch (estado.state) {
    case 'never_published':
      return 'Nunca publicado'
    case 'unchanged':
      return `Al día (v${estado.published_version})`
    case 'changed':
      return `Cambios sin publicar (publicada: v${estado.published_version})`
    case 'out_of_sync':
      return 'Publicado sin constancia local'
  }
}

function mensajeDeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'CONTENT_VALIDATION_ERROR' || err.code === 'BUNDLE_INVALID')
      return 'No se puede publicar así: un estudiante no podría instalarlo. Ábrelo con «Publicar» para ver el detalle.'
    if (err.code === 'CATALOG_UNAVAILABLE') return 'No se pudo contactar con el bucket.'
    return err.message
  }
  return 'Falló la publicación.'
}

export function PublishAllDialog({ modules, onClose, onDone }: PublishAllDialogProps) {
  const [credencial, setCredencial] = useState<AdminCatalogCredentialStatusDto | 'error' | null>(null)
  const [filas, setFilas] = useState<Fila[]>(() =>
    modules.map((m) => ({ module: m, estado: null, marcado: false, ensayo: null, publicado: null, error: null })),
  )
  const [fase, setFase] = useState<Fase>('cargando')
  const montado = useRef(true)
  useEffect(() => {
    montado.current = true
    return () => {
      montado.current = false
    }
  }, [])

  useEffect(() => {
    let vivo = true
    getCatalogCredentials(true)
      .then((c) => vivo && setCredencial(c))
      .catch(() => vivo && setCredencial('error'))
    Promise.all(
      modules.map((m) =>
        getPublishStatus(m.id).then(
          (e) => e as Fila['estado'],
          () => 'error' as const,
        ),
      ),
    ).then((estados) => {
      if (!vivo) return
      setFilas((prev) =>
        prev.map((f, i) => ({ ...f, estado: estados[i], marcado: tieneCambios(estados[i]) })),
      )
      setFase('listo')
    })
    return () => {
      vivo = false
    }
    // Solo al abrir: la lista no cambia mientras el diálogo está abierto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const actualizar = (id: string, cambio: Partial<Fila>) =>
    setFilas((prev) => prev.map((f) => (f.module.id === id ? { ...f, ...cambio } : f)))

  const marcados = filas.filter((f) => f.marcado)
  const listosParaPublicar = marcados.filter((f) => f.ensayo != null && f.error == null)
  const puedePublicar = credencial != null && credencial !== 'error' && credencial.usable
  const bucket = credencial != null && credencial !== 'error' ? credencial.bucket : ''
  const ocupado = fase === 'cargando' || fase === 'revisando' || fase === 'publicando'
  const publicados = filas.filter((f) => f.publicado != null)
  const avisosGraves = marcados.flatMap((f) =>
    (f.ensayo?.warnings ?? []).filter((w) => GRAVES.has(w.code)).map((w) => ({ fila: f, w })),
  )

  async function revisar() {
    setFase('revisando')
    for (const f of marcados) {
      actualizar(f.module.id, { ensayo: null, error: null })
      try {
        const r = await publishModule(f.module.id, { dry_run: true })
        if (!montado.current) return
        actualizar(f.module.id, { ensayo: r })
      } catch (err) {
        if (!montado.current) return
        actualizar(f.module.id, { error: mensajeDeError(err) })
      }
    }
    if (montado.current) setFase('revisado')
  }

  async function publicar() {
    setFase('publicando')
    for (const f of listosParaPublicar) {
      try {
        const r = await publishModule(f.module.id, {})
        if (!montado.current) return
        actualizar(f.module.id, { publicado: r })
      } catch (err) {
        if (!montado.current) return
        actualizar(f.module.id, { error: mensajeDeError(err) })
      }
    }
    if (montado.current) setFase('terminado')
  }

  function cerrar() {
    if (publicados.length > 0) {
      onDone(
        publicados.length === 1
          ? `Se publicó «${publicados[0].module.title}».`
          : `Se publicaron ${publicados.length} módulos.`,
      )
    } else onClose()
  }

  function resultado(f: Fila): string {
    if (f.publicado != null)
      return f.publicado.local_state_updated
        ? `Publicado como v${f.publicado.version}`
        : `Publicado como v${f.publicado.version}; falta la constancia local (reintenta desde su fila)`
    if (f.error != null) return f.error
    if (fase === 'publicando' && listosParaPublicar.includes(f)) return 'Publicando…'
    if (f.ensayo != null) {
      const n = f.ensayo.warnings.length
      return `Se publicará como v${f.ensayo.version} · ${f.ensayo.lesson_ids.length} lecciones${n > 0 ? ` · ${n} aviso${n === 1 ? '' : 's'}` : ''}`
    }
    if (fase === 'revisando' && f.marcado) return 'Revisando…'
    return textoDeEstado(f.estado)
  }

  return (
    <div className="admin-modal-backdrop" onMouseDown={ocupado ? undefined : cerrar}>
      <div
        className="admin-modal admin-modal-form card publish-all"
        role="dialog"
        aria-labelledby="publish-all-title"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 id="publish-all-title" className="display-md">
          Publicar todo
        </h3>

        {credencial == null ? (
          <p className="field-hint">Comprobando la credencial…</p>
        ) : puedePublicar ? (
          <p className="field-hint">
            Se publicará en <strong>{bucket}</strong>. Primero
            revisa qué se va a subir; publicar es <strong>irreversible</strong>.
          </p>
        ) : (
          <p className="field-hint error" role="alert">
            Este equipo no tiene una credencial de publicación utilizable. Ábrela desde «Publicar» en
            cualquier módulo para ver el motivo.
          </p>
        )}

        <ul className="publish-all-list" aria-busy={ocupado}>
          {filas.map((f) => (
            <li key={f.module.id} className={f.error != null ? 'is-error' : f.publicado != null ? 'is-ok' : undefined}>
              <label>
                <input
                  type="checkbox"
                  checked={f.marcado}
                  disabled={ocupado || fase === 'terminado' || !tieneCambios(f.estado)}
                  onChange={(e) => {
                    // Cambiar la selección invalida la revisión hecha.
                    actualizar(f.module.id, { marcado: e.target.checked, ensayo: null, error: null })
                    if (fase === 'revisado') setFase('listo')
                  }}
                />
                <span className="publish-all-title">{f.module.title}</span>
              </label>
              <span className="publish-all-state">{resultado(f)}</span>
            </li>
          ))}
        </ul>

        {avisosGraves.length > 0 && fase !== 'terminado' && (
          <div className="field-hint error" role="alert">
            Estos cambios afectan al avance de quien ya tiene el módulo:
            <ul className="publish-warnings">
              {avisosGraves.map(({ fila, w }, i) => (
                <li key={`${fila.module.id}-${w.code}-${i}`} className="grave">
                  <strong>{fila.module.title}</strong>
                  {w.lesson_id != null && <code> {w.lesson_id}</code>} — {w.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {fase !== 'cargando' && marcados.length === 0 && fase !== 'terminado' && (
          <p className="field-hint">No hay módulos con cambios sin publicar.</p>
        )}

        <div className="admin-modal-actions">
          <Button variant="ghost" onClick={cerrar} disabled={ocupado}>
            {fase === 'terminado' ? 'Cerrar' : 'Cancelar'}
          </Button>
          {fase !== 'terminado' && (
            <>
              <Button
                variant="outline"
                onClick={() => void revisar()}
                disabled={!puedePublicar || ocupado || marcados.length === 0}
              >
                {fase === 'revisando' ? 'Revisando…' : 'Revisar qué se publicará'}
              </Button>
              <Button
                variant="primary"
                onClick={() => void publicar()}
                disabled={!puedePublicar || ocupado || fase !== 'revisado' || listosParaPublicar.length === 0}
              >
                {fase === 'publicando'
                  ? 'Publicando…'
                  : `Publicar ${listosParaPublicar.length} módulo${listosParaPublicar.length === 1 ? '' : 's'}`}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
