// Complemento de cobertura de src/stores: sidebarStore (frontend-spec §3.1).
// Default COLAPSADO; toggle alterna; persiste en 'ehpc-sidebar-expanded'.
import { beforeEach, describe, expect, it } from 'vitest'
import { useSidebarStore } from '@/stores/sidebarStore'

beforeEach(() => {
  localStorage.clear()
  useSidebarStore.setState({ expanded: false })
})

describe('sidebarStore', () => {
  it('arranca colapsado (expanded=false)', () => {
    expect(useSidebarStore.getState().expanded).toBe(false)
  })

  it('toggle alterna expanded y persiste', () => {
    useSidebarStore.getState().toggle()
    expect(useSidebarStore.getState().expanded).toBe(true)
    const raw = localStorage.getItem('ehpc-sidebar-expanded')
    expect(JSON.parse(raw as string).state.expanded).toBe(true)
    useSidebarStore.getState().toggle()
    expect(useSidebarStore.getState().expanded).toBe(false)
  })
})
