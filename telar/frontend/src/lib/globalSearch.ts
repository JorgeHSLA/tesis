// lib/globalSearch.ts — lógica PURA del buscador global (sin red ni DOM).
//
// Pedido de las pruebas de usabilidad (2026-11): el «Buscar» de la barra solo
// filtraba cursos; la idea es que encuentre TODO lo que hay en Telar: páginas,
// cursos y lecciones, ejemplos del simulador, ejecuciones, configuraciones
// guardadas y módulos disponibles. Aquí solo se normaliza, puntúa y agrupa;
// de dónde salen los datos lo decide `useGlobalSearchIndex`.

export type SearchKind =
  | 'pagina'
  | 'curso'
  | 'leccion'
  | 'ejemplo'
  | 'ejecucion'
  | 'configuracion'
  | 'modulo'

export interface SearchItem {
  /** Único dentro de su tipo (clave de React y de la lista). */
  id: string
  kind: SearchKind
  title: string
  subtitle?: string
  /** Ruta del HashRouter a la que lleva. */
  to: string
  /** `state` de navegación (p. ej. una configuración guardada que el simulador precarga). */
  state?: unknown
  /** Texto extra buscable que no se muestra (directivas, estado, nombre de archivo…). */
  keywords?: string
}

/** Orden de los grupos en el resultado y su rótulo. */
export const KIND_ORDER: readonly SearchKind[] = [
  'pagina',
  'curso',
  'leccion',
  'ejemplo',
  'ejecucion',
  'configuracion',
  'modulo',
]

export const KIND_LABEL: Readonly<Record<SearchKind, string>> = {
  pagina: 'Páginas',
  curso: 'Cursos',
  leccion: 'Lecciones',
  ejemplo: 'Ejemplos del simulador',
  ejecucion: 'Ejecuciones',
  configuracion: 'Mis configuraciones',
  modulo: 'Módulos disponibles',
}

/** Minúsculas y sin tildes: «ejecución» y «ejecucion» son lo mismo al buscar. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

function tokens(query: string): string[] {
  return normalize(query).split(/\s+/).filter(Boolean)
}

/** 0 = no coincide. Todas las palabras de la consulta deben aparecer. */
export function scoreItem(item: SearchItem, query: string): number {
  const words = tokens(query)
  if (words.length === 0) return 0
  const title = normalize(item.title)
  const rest = normalize(`${item.subtitle ?? ''} ${item.keywords ?? ''}`)
  let total = 0
  for (const w of words) {
    let s = 0
    if (title.startsWith(w)) s = 4
    else if (title.split(/[\s\-_/.·:()]+/).some((part) => part.startsWith(w))) s = 3
    else if (title.includes(w)) s = 2
    else if (rest.includes(w)) s = 1
    if (s === 0) return 0
    total += s
  }
  // Desempate: el título entero igual a la consulta gana.
  if (title === normalize(query).trim()) total += 3
  return total
}

export interface SearchGroup {
  kind: SearchKind
  label: string
  items: SearchItem[]
}

/** Puntúa, ordena y agrupa. Sin consulta devuelve solo las páginas (atajos). */
export function searchItems(items: readonly SearchItem[], query: string, perGroup = 6): SearchGroup[] {
  const q = query.trim()
  const pool = q === '' ? items.filter((i) => i.kind === 'pagina') : items
  const scored = pool
    .map((item) => ({ item, score: q === '' ? 1 : scoreItem(item, q) }))
    .filter((x) => x.score > 0)
  const groups: SearchGroup[] = []
  for (const kind of KIND_ORDER) {
    const inKind = scored
      .filter((x) => x.item.kind === kind)
      // Estable: a igual puntaje se conserva el orden de origen.
      .sort((a, b) => b.score - a.score)
      .slice(0, perGroup)
      .map((x) => x.item)
    if (inKind.length > 0) groups.push({ kind, label: KIND_LABEL[kind], items: inKind })
  }
  return groups
}

/** Aplana los grupos al orden en que se recorren con las flechas. */
export function flatten(groups: readonly SearchGroup[]): SearchItem[] {
  return groups.flatMap((g) => g.items)
}
