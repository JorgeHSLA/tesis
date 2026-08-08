// CatalogToolbar — búsqueda + fpills (frontend-spec §6.5): cada lección
// aporta 1 ejemplo + 1 quiz al conteo; el filtro muestra/oculta filas.
// Este buscador es también el destino del botón «Buscar» del TopBar: cuando
// llega con `autoFocus`, se enfoca al montar (el montaje ocurre cuando el
// catálogo ya tiene datos, así que el foco nunca se pierde contra el skeleton).
import { useEffect, useRef } from 'react'
import { IconHelp, IconPlay, IconSearch } from '../../components/icons/icons'

export type CatalogFilter = 'all' | 'example' | 'quiz'

export interface CatalogToolbarProps {
  query: string
  onQuery: (q: string) => void
  filter: CatalogFilter
  onFilter: (f: CatalogFilter) => void
  totals: { all: number; examples: number; quizzes: number }
  /** true → enfocar el buscador (petición del TopBar). */
  autoFocus?: boolean
  /** Se llama tras enfocar, para que el padre baje la petición. */
  onFocused?: () => void
}

export function CatalogToolbar({
  query,
  onQuery,
  filter,
  onFilter,
  totals,
  autoFocus = false,
  onFocused,
}: CatalogToolbarProps) {
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!autoFocus) return
    searchRef.current?.focus()
    onFocused?.()
  }, [autoFocus, onFocused])

  return (
    <div className="catalog-toolbar">
      <div className="catalog-search">
        <IconSearch size={14} />
        <input
          ref={searchRef}
          type="text"
          placeholder="Buscar lección, quiz o tema..."
          aria-label="Buscar lección, quiz o tema"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
        />
      </div>
      <div className="catalog-filters" role="group" aria-label="Filtrar contenidos">
        <button
          type="button"
          className={`fpill ${filter === 'all' ? 'active' : ''}`}
          aria-pressed={filter === 'all'}
          onClick={() => onFilter('all')}
        >
          Todo <span className="fpill-n">{totals.all}</span>
        </button>
        <button
          type="button"
          className={`fpill ${filter === 'example' ? 'active' : ''}`}
          aria-pressed={filter === 'example'}
          onClick={() => onFilter('example')}
        >
          <IconPlay size={11} /> Ejemplos <span className="fpill-n">{totals.examples}</span>
        </button>
        <button
          type="button"
          className={`fpill ${filter === 'quiz' ? 'active' : ''}`}
          aria-pressed={filter === 'quiz'}
          onClick={() => onFilter('quiz')}
        >
          <IconHelp size={11} /> Quizzes <span className="fpill-n">{totals.quizzes}</span>
        </button>
      </div>
    </div>
  )
}
