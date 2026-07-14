// adminSessionStore.ts — sesión del modo autoría (admin, Fase 4).
// El token (Bearer opaco de vida corta) se persiste en **sessionStorage**
// (no localStorage): se limpia al cerrar la ventana → menor blast-radius ante
// XSS persistente; la sesión es server-side de vida corta de todos modos
// (fase4-autoria-design §9.E). Solo persisten {token, expiresAt}; `status` es
// estado de UI derivado en cada arranque.
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { adminLogin, adminLogout, adminSessionInfo } from '../api/admin'

/**
 * - `unknown`   → aún no se ha verificado (arranque); el guard lanza `restore`.
 * - `restoring` → verificando el token contra `GET /admin/session`.
 * - `authenticated` → token válido; el guard deja pasar.
 * - `anonymous` → sin sesión usable; el guard redirige a `/admin/login`.
 */
export type AdminSessionStatus = 'unknown' | 'restoring' | 'authenticated' | 'anonymous'

export interface AdminSessionState {
  token: string | null
  /** ISO-8601 UTC de expiración (informativo; el server es la autoridad). */
  expiresAt: string | null
  status: AdminSessionStatus
  /** POST /admin/login. Propaga `ApiError` (401) para que el form lo muestre. */
  login: (password: string) => Promise<void>
  /** POST /admin/logout (best-effort) + limpieza local. */
  logout: () => Promise<void>
  /** Limpieza local pura (la usa `authFetch` ante un 401). */
  clear: () => void
  /** Verifica el token persistido contra GET /admin/session al arrancar. */
  restore: () => Promise<void>
}

export const useAdminSession = create<AdminSessionState>()(
  persist(
    (set, get) => ({
      token: null,
      expiresAt: null,
      status: 'unknown',

      login: async (password: string) => {
        const { token, expires_at } = await adminLogin(password)
        set({ token, expiresAt: expires_at, status: 'authenticated' })
      },

      logout: async () => {
        try {
          if (get().token) await adminLogout()
        } catch {
          // Best-effort: aunque el server falle, invalidamos la sesión local.
        } finally {
          set({ token: null, expiresAt: null, status: 'anonymous' })
        }
      },

      clear: () => set({ token: null, expiresAt: null, status: 'anonymous' }),

      restore: async () => {
        const token = get().token
        if (!token) {
          set({ status: 'anonymous' })
          return
        }
        set({ status: 'restoring' })
        try {
          const info = await adminSessionInfo()
          if (info.authenticated) {
            set({ status: 'authenticated', expiresAt: info.expires_at })
          } else {
            // Backend reiniciado o token caducado: sin sesión usable.
            set({ token: null, expiresAt: null, status: 'anonymous' })
          }
        } catch {
          // 401 (token inválido/expirado) o red caída: fuerza re-login.
          set({ token: null, expiresAt: null, status: 'anonymous' })
        }
      },
    }),
    {
      name: 'ehpc-admin-session',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (s) => ({ token: s.token, expiresAt: s.expiresAt }),
    },
  ),
)
