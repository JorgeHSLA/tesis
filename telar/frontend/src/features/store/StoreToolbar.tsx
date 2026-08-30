// StoreToolbar — buscador + filtros + «Actualizar lista» del catálogo remoto.
// Mismo lenguaje visual que la toolbar de `/cursos` (buscador con borde de
// affordance + píldoras con contador), pero con clases PROPIAS: `.fpill` vive
// en `styles/screens/catalog.css`, que solo carga el chunk de esa pantalla, y
// entrar directo a `/#/modulos` no lo trae. Reusar el nombre habría funcionado
// en desarrollo y roto el estilo justo en la navegación directa.
//
// Los contadores cuentan MÓDULOS del catálogo (lo local queda fuera: no se
// incorpora ni se quita desde aquí).
import { useEffect, useRef } from 'react'
import { IconSearch } from '../../components/icons/icons'
import { Button } from '../../components/ui/Button'

export type StoreFilter = 'all' | 'available' | 'installed' | 'updates'

export interface StoreCounts {
  all: number
  available: number
  installed: number
  updates: number
}

export interface StoreToolbarProps {
  query: string
  onQuery: (q: string) => void
  filter: StoreFilter
  onFilter: (f: StoreFilter) => void
  counts: StoreCounts
  /** Vuelve a consultar el bucket (`?refresh=true` + `POST /catalog/refresh`). */
  onRefresh: () => void
  /** Hay una consulta al bucket en vuelo. */
  refreshing: boolean
  /** true → enfocar el buscador al montar. */
  autoFocus?: boolean
}

const PILLS: { id: StoreFilter; label: string; count: (c: StoreCounts) => number }[] = [
  { id: 'all', label: 'Todo', count: (c) => c.all },
  { id: 'available', label: 'Disponibles', count: (c) => c.available },
  { id: 'installed', label: 'Instalados', count: (c) => c.installed },
  { id: 'updates', label: 'Con actualización', count: (c) => c.updates },
]

export function StoreToolbar({
  query,
  onQuery,
  filter,
  onFilter,
  counts,
  onRefresh,
  refreshing,
  autoFocus = false,
}: StoreToolbarProps) {
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus) searchRef.current?.focus()
  }, [autoFocus])

  return (
    <div className="store-toolbar">
      <div className="store-search">
        <IconSearch size={14} />
        <input
          ref={searchRef}
          type="text"
          placeholder="Buscar módulo por título o tema..."
          aria-label="Buscar módulo por título o tema"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
        />
      </div>

      <div className="store-filters" role="group" aria-label="Filtrar módulos">
        {PILLS.map((pill) => (
          <button
            key={pill.id}
            type="button"
            className={`store-pill ${filter === pill.id ? 'active' : ''}`}
            aria-pressed={filter === pill.id}
            onClick={() => onFilter(pill.id)}
          >
            {pill.label} <span className="store-pill-n">{pill.count(counts)}</span>
          </button>
        ))}
      </div>

      <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
        {refreshing ? 'Consultando…' : 'Actualizar lista'}
      </Button>
    </div>
  )
}
