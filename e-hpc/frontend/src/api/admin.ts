// api/admin.ts — capa HTTP del modo autoría (admin, Fase 4).
// `authFetch` inyecta el Bearer de la sesión (adminSessionStore) por `init` y,
// ante un 401, limpia la sesión (el guard redirige a /admin/login). NO toca
// client.ts: `buildHeaders` ya mergea `init.headers` (fase4-autoria-design §9.D).
// Las LECTURAS del dashboard (lista de módulos, ejemplo por id) reutilizan
// api/content.ts; solo el quiz con `correct_key` usa el endpoint admin.
import { ApiError, fetchJson } from './client'
import { useAdminSession } from '../stores/adminSessionStore'
import type {
  AdminDeleteResultDto,
  AdminExampleCodeRequestDto,
  AdminExampleCodeResultDto,
  AdminExampleDto,
  AdminExampleUpdateDto,
  AdminLessonCreateDto,
  AdminLessonDetailDto,
  AdminLessonUpdateDto,
  AdminLoginResultDto,
  AdminLogoutResultDto,
  AdminModuleCreateDto,
  AdminModuleDto,
  AdminModulesResponseDto,
  AdminModuleUpdateDto,
  AdminQuizDto,
  AdminQuizUpsertDto,
  AdminSessionInfoDto,
} from './admin-types'

const P = '/api/v1/admin'
const enc = encodeURIComponent

/** Inyecta `Authorization: Bearer <token>` si hay sesión activa. */
function authInit(init?: RequestInit): RequestInit {
  const token = useAdminSession.getState().token
  return {
    ...init,
    headers: { ...init?.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  }
}

/** `fetchJson` con Bearer; ante 401 limpia la sesión local y re-lanza. */
async function authFetch<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    return await fetchJson<T>(path, authInit(init))
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) useAdminSession.getState().clear()
    throw err
  }
}

// ── §10.1 Auth ────────────────────────────────────────────────────────────

/** POST /admin/login — sin Bearer (aún no hay sesión). */
export function adminLogin(password: string): Promise<AdminLoginResultDto> {
  return fetchJson<AdminLoginResultDto>(`${P}/login`, {
    method: 'POST',
    body: JSON.stringify({ password }),
  })
}

/** POST /admin/logout — revoca el token en el server. */
export function adminLogout(): Promise<AdminLogoutResultDto> {
  return authFetch<AdminLogoutResultDto>(`${P}/logout`, { method: 'POST' })
}

/** GET /admin/session — verifica el token (no renueva el TTL). */
export function adminSessionInfo(): Promise<AdminSessionInfoDto> {
  return authFetch<AdminSessionInfoDto>(`${P}/session`)
}

// ── §10.3 Módulos ───────────────────────────────────────────────────────────

export function getAdminModules(): Promise<AdminModulesResponseDto> {
  return authFetch<AdminModulesResponseDto>(`${P}/modules`)
}

export function createModule(body: AdminModuleCreateDto): Promise<AdminModuleDto> {
  return authFetch<AdminModuleDto>(`${P}/modules`, { method: 'POST', body: JSON.stringify(body) })
}

export function updateModule(id: string, body: AdminModuleUpdateDto): Promise<AdminModuleDto> {
  return authFetch<AdminModuleDto>(`${P}/modules/${enc(id)}`, { method: 'PUT', body: JSON.stringify(body) })
}

export function deleteModule(id: string): Promise<AdminDeleteResultDto> {
  return authFetch<AdminDeleteResultDto>(`${P}/modules/${enc(id)}`, { method: 'DELETE' })
}

// ── §10.5 Lecciones (unidad = lección + ejemplo pareado + quiz) ──────────────

export function getAdminLesson(id: string): Promise<AdminLessonDetailDto> {
  return authFetch<AdminLessonDetailDto>(`${P}/lessons/${enc(id)}`)
}

export function createLesson(body: AdminLessonCreateDto): Promise<AdminLessonDetailDto> {
  return authFetch<AdminLessonDetailDto>(`${P}/lessons`, { method: 'POST', body: JSON.stringify(body) })
}

export function updateLesson(id: string, body: AdminLessonUpdateDto): Promise<AdminLessonDetailDto> {
  return authFetch<AdminLessonDetailDto>(`${P}/lessons/${enc(id)}`, { method: 'PUT', body: JSON.stringify(body) })
}

export function deleteLesson(id: string): Promise<AdminDeleteResultDto> {
  return authFetch<AdminDeleteResultDto>(`${P}/lessons/${enc(id)}`, { method: 'DELETE' })
}

// ── §10.6 Quiz (el GET admin SÍ trae correct_key/explanation) ────────────────

export function getAdminQuiz(lessonId: string): Promise<AdminQuizDto> {
  return authFetch<AdminQuizDto>(`${P}/lessons/${enc(lessonId)}/quiz`)
}

export function putAdminQuiz(lessonId: string, body: AdminQuizUpsertDto): Promise<AdminQuizDto> {
  return authFetch<AdminQuizDto>(`${P}/lessons/${enc(lessonId)}/quiz`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export function deleteAdminQuiz(lessonId: string): Promise<AdminDeleteResultDto> {
  return authFetch<AdminDeleteResultDto>(`${P}/lessons/${enc(lessonId)}/quiz`, { method: 'DELETE' })
}

// ── §10.4 Ejemplos (solo edición; nacen/mueren con la lección) ───────────────

export function getAdminExample(id: string): Promise<AdminExampleDto> {
  return authFetch<AdminExampleDto>(`${P}/examples/${enc(id)}`)
}

export function updateExample(id: string, body: AdminExampleUpdateDto): Promise<AdminExampleDto> {
  return authFetch<AdminExampleDto>(`${P}/examples/${enc(id)}`, { method: 'PUT', body: JSON.stringify(body) })
}

/** POST /admin/examples/{id}/code — sube el `.py` como JSON (filename+source). */
export function uploadExampleCode(
  id: string,
  body: AdminExampleCodeRequestDto,
): Promise<AdminExampleCodeResultDto> {
  return authFetch<AdminExampleCodeResultDto>(`${P}/examples/${enc(id)}/code`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}
