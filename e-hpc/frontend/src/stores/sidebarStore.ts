// sidebarStore.ts — estado de colapso del sidebar (frontend-spec §3.1).
// Persistencia en localStorage 'ehpc-sidebar-expanded'; default COLAPSADO
// (como el prototipo: saved === null → false).
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface SidebarState {
  expanded: boolean
  toggle: () => void
}

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set) => ({
      expanded: false,
      toggle: () => set((s) => ({ expanded: !s.expanded })),
    }),
    { name: 'ehpc-sidebar-expanded' },
  ),
)
