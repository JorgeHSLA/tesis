// CatalogToolbar — búsqueda + fpills (frontend-spec §6.5): cada lección
// aporta 1 ejemplo + 1 quiz al conteo; el filtro muestra/oculta filas.
import { IconHelp, IconPlay, IconSearch } from '../../components/icons/icons'

export type CatalogFilter = 'all' | 'example' | 'quiz'

export interface CatalogToolbarProps {
  query: string
  onQuery: (q: string) => void
  filter: CatalogFilter
  onFilter: (f: CatalogFilter) => void
  totals: { all: number; examples: number; quizzes: number }
}

export function CatalogToolbar({ query, onQuery, filter, onFilter, totals }: CatalogToolbarProps) {
  return (
    <div className="catalog-toolbar">
      <div className="catalog-search">
        <IconSearch size={14} />
        <input
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
