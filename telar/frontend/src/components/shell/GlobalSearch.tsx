// GlobalSearch — buscador de TODO Telar (paleta de búsqueda).
//
// Se abre con el botón «Buscar» de la barra o con Ctrl/⌘ + K. Encuentra
// páginas, cursos y lecciones, ejemplos del simulador, ejecuciones pasadas,
// configuraciones guardadas y módulos disponibles (lib/globalSearch.ts), y
// lleva directo a donde corresponda. Antes «Buscar» solo filtraba cursos.
//
// A11y: patrón combobox + listbox (el foco se queda en el campo y la opción
// activa se anuncia con `aria-activedescendant`), Escape cierra y el foco
// vuelve a quien lo abrió (lo hace TopBar). Con movimiento reducido no hay
// animación de entrada.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useGlobalSearchIndex } from '../../hooks/useGlobalSearchIndex'
import { flatten, searchItems, type SearchItem, type SearchKind } from '../../lib/globalSearch'
import {
  IconBook,
  IconCode,
  IconDownload,
  IconHome,
  IconResults,
  IconSearch,
  type IconProps,
} from '../icons/icons'

const KIND_ICON: Readonly<Record<SearchKind, (p: IconProps) => React.JSX.Element>> = {
  pagina: IconHome,
  curso: IconBook,
  leccion: IconBook,
  ejemplo: IconCode,
  ejecucion: IconResults,
  configuracion: IconCode,
  modulo: IconDownload,
}

export interface GlobalSearchProps {
  open: boolean
  onClose: () => void
}

export function GlobalSearch({ open, onClose }: GlobalSearchProps) {
  const navigate = useNavigate()
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const { items, loading, partial } = useGlobalSearchIndex(open)

  const groups = useMemo(() => searchItems(items, query), [items, query])
  const flat = useMemo(() => flatten(groups), [groups])

  // Cada apertura empieza limpia y con el foco en el campo.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
    inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    setActive(0)
  }, [query])

  // La opción activa siempre a la vista al recorrer con flechas.
  useEffect(() => {
    if (!open) return
    document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [active, listId, open])

  if (!open) return null

  const go = (item: SearchItem | undefined) => {
    if (item === undefined) return
    onClose()
    navigate(item.to, item.state !== undefined ? { state: item.state } : undefined)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (flat.length > 0) setActive((i) => (i + 1) % flat.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (flat.length > 0) setActive((i) => (i - 1 + flat.length) % flat.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      go(flat[active])
    } else if (e.key === 'Tab') {
      // Diálogo modal: el foco no debe escaparse al fondo.
      e.preventDefault()
    }
  }

  let flatIndex = -1
  const empty = query.trim() !== '' && flat.length === 0 && !loading

  return createPortal(
    <div className="gsearch-backdrop" onMouseDown={onClose}>
      <div
        className="gsearch"
        role="dialog"
        aria-modal="true"
        aria-label="Buscar en Telar"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="gsearch-field">
          <IconSearch size={16} />
          <input
            ref={inputRef}
            className="gsearch-input"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={flat.length > 0 ? `${listId}-${active}` : undefined}
            aria-autocomplete="list"
            placeholder="Busca cursos, lecciones, ejemplos, ejecuciones…"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            spellCheck={false}
            autoComplete="off"
          />
          <kbd className="gsearch-kbd" aria-hidden="true">
            Esc
          </kbd>
        </div>

        <div className="gsearch-results" id={listId} role="listbox" aria-label="Resultados">
          {groups.map((group) => (
            <div key={group.kind} role="presentation">
              <div className="gsearch-group" role="presentation">
                {group.label}
              </div>
              {group.items.map((item) => {
                flatIndex += 1
                const index = flatIndex
                const Ico = KIND_ICON[item.kind]
                const isActive = index === active
                return (
                  <div
                    key={item.id}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={isActive}
                    className={'gsearch-item' + (isActive ? ' is-active' : '')}
                    onMouseMove={() => setActive(index)}
                    onClick={() => go(item)}
                  >
                    <span className="gsearch-item-icon" aria-hidden="true">
                      <Ico size={16} />
                    </span>
                    <span className="gsearch-item-text">
                      <span className="gsearch-item-title">{item.title}</span>
                      {item.subtitle != null && <span className="gsearch-item-sub">{item.subtitle}</span>}
                    </span>
                  </div>
                )
              })}
            </div>
          ))}
          {loading && <div className="gsearch-note">Buscando en todo Telar…</div>}
          {empty && <div className="gsearch-note">No encontramos nada para «{query.trim()}».</div>}
        </div>

        <div className="gsearch-foot" aria-live="polite">
          <span>↑↓ para moverte · Enter para abrir</span>
          {partial && <span>Algunas fuentes no respondieron; los resultados pueden estar incompletos.</span>}
        </div>
      </div>
    </div>,
    document.body,
  )
}
