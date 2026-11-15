// SavedConfigs — «Mis configuraciones» del simulador (CU-32.1), dentro de
// «Más detalles»: sin card propia ni empty state (es opcional).
// Guarda la configuración actual SIN ejecutar (lib/savedConfigs, solo
// localStorage) y lista las guardadas: cargar, renombrar, borrar. Cargar
// entrega una copia; editar después no toca lo guardado.
import { useId, useState, type FormEvent } from 'react'
import { Button } from '../../components/ui/Button'
import {
  deleteSavedConfig,
  listSavedConfigs,
  renameSavedConfig,
  saveConfig,
  type SavedConfig,
} from '../../lib/savedConfigs'
import type { SimConfig } from '../../lib/simConfig'

const STORAGE_ERROR = 'No se pudo guardar en este navegador (almacenamiento no disponible o lleno).'

export interface SavedConfigsProps {
  current: SimConfig
  onLoad: (config: SavedConfig) => void
}

function summary(c: SavedConfig): string {
  const timeout = c.timeout_s === 0 ? 'sin timeout' : `${c.timeout_s} s`
  return `${c.filename} · ${c.threads} ${c.threads === 1 ? 'hilo' : 'hilos'} · ${timeout}`
}

export function SavedConfigs({ current, onLoad }: SavedConfigsProps) {
  const nameId = useId()
  const [configs, setConfigs] = useState<SavedConfig[]>(() => listSavedConfigs())
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)

  const refresh = (ok: boolean) => {
    setError(ok ? null : STORAGE_ERROR)
    setConfigs(listSavedConfigs())
  }

  const onSave = (e: FormEvent) => {
    e.preventDefault()
    const saved = saveConfig({ ...current, name })
    if (saved != null) setName('')
    refresh(saved != null)
  }

  const onRename = (e: FormEvent) => {
    e.preventDefault()
    if (renaming == null) return
    const ok = renameSavedConfig(renaming.id, renaming.name)
    setRenaming(null)
    refresh(ok)
  }

  return (
    <section className="saved-configs" aria-label="Mis configuraciones">
      <h3 className="saved-configs-title">
        Mis configuraciones <span className="card-sub">se guardan solo en este equipo</span>
      </h3>
      <div>
        <form className="saved-configs-form" onSubmit={onSave}>
          <label className="field-label" htmlFor={nameId}>
            Nombre
          </label>
          <input
            id={nameId}
            className="input"
            value={name}
            maxLength={80}
            placeholder="p. ej. π con 4 hilos"
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <Button type="submit" variant="outline" disabled={current.code.trim() === ''}>
            Guardar configuración
          </Button>
        </form>
        {error != null && (
          <p className="saved-configs-error" role="alert">
            {error}
          </p>
        )}

        {configs.length > 0 && (
          <ul className="saved-configs-list">
            {configs.map((c) => (
              <li key={c.id} className="saved-configs-row">
                {renaming?.id === c.id ? (
                  <form className="saved-configs-rename" onSubmit={onRename}>
                    <input
                      className="input"
                      aria-label="Nuevo nombre"
                      value={renaming.name}
                      maxLength={80}
                      autoFocus
                      onChange={(e) => setRenaming({ id: c.id, name: e.currentTarget.value })}
                    />
                    <Button type="submit" size="sm" variant="primary">
                      Guardar
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setRenaming(null)}>
                      Cancelar
                    </Button>
                  </form>
                ) : (
                  <>
                    <div className="saved-configs-info">
                      <b>{c.name}</b>
                      <span className="mono-small">{summary(c)}</span>
                    </div>
                    <div className="saved-configs-actions">
                      <Button size="sm" variant="primary" aria-label={`Cargar ${c.name}`} onClick={() => onLoad(c)}>
                        Cargar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Renombrar ${c.name}`}
                        onClick={() => setRenaming({ id: c.id, name: c.name })}
                      >
                        Renombrar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Borrar ${c.name}`}
                        onClick={() => refresh(deleteSavedConfig(c.id))}
                      >
                        Borrar
                      </Button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
