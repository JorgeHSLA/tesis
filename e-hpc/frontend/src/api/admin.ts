// api/admin.ts — capa HTTP del modo autoría (admin, Fase 4).
// Ya NO hay login ni token: el modo autoría se decide en BUILD (VITE_ADMIN →
// config.ts ADMIN_BUILD) y el backend lo gobierna con EHPC_ADMIN_MODE. Las
// llamadas admin usan `fetchJson` normal, SIN cabecera Authorization ni token.
// Las LECTURAS del dashboard (lista de módulos, ejemplo por id) reutilizan
// api/content.ts; solo el quiz con `correct_key` usa el endpoint admin.
import { fetchJson } from './client'
import type {
  AdminDeleteResultDto,
  AdminExampleCodeRequestDto,
  AdminExampleCodeResultDto,
  AdminExampleDto,
  AdminExampleUpdateDto,
  AdminLessonCreateDto,
  AdminLessonDetailDto,
  AdminLessonUpdateDto,
  AdminModuleCreateDto,
  AdminModuleDto,
  AdminModulesResponseDto,
  AdminModuleUpdateDto,
  AdminQuizDto,
  AdminQuizUpsertDto,
  AdminReorderItemDto,
  AdminReorderRequestDto,
} from './admin-types'

const P = '/api/v1/admin'
const enc = encodeURIComponent

// ── §10.3 Módulos ───────────────────────────────────────────────────────────

export function getAdminModules(): Promise<AdminModulesResponseDto> {
  return fetchJson<AdminModulesResponseDto>(`${P}/modules`)
}

export function createModule(body: AdminModuleCreateDto): Promise<AdminModuleDto> {
  return fetchJson<AdminModuleDto>(`${P}/modules`, { method: 'POST', body: JSON.stringify(body) })
}

export function updateModule(id: string, body: AdminModuleUpdateDto): Promise<AdminModuleDto> {
  return fetchJson<AdminModuleDto>(`${P}/modules/${enc(id)}`, { method: 'PUT', body: JSON.stringify(body) })
}

export function deleteModule(id: string): Promise<AdminDeleteResultDto> {
  return fetchJson<AdminDeleteResultDto>(`${P}/modules/${enc(id)}`, { method: 'DELETE' })
}

/**
 * §10.2 PUT /admin/modules/reorder — reasigna varios `order` en una sola
 * transacción (evita el 409 del swap directo). Devuelve el listado admin ya
 * reordenado. La ruta `reorder` va ANTES del `{id}` en el backend, así que no
 * colisiona con `updateModule`.
 */
export function reorderModules(items: AdminReorderItemDto[]): Promise<AdminModulesResponseDto> {
  const body: AdminReorderRequestDto = { items }
  return fetchJson<AdminModulesResponseDto>(`${P}/modules/reorder`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

// ── §10.5 Lecciones (unidad = lección + ejemplo pareado + quiz) ──────────────

export function getAdminLesson(id: string): Promise<AdminLessonDetailDto> {
  return fetchJson<AdminLessonDetailDto>(`${P}/lessons/${enc(id)}`)
}

export function createLesson(body: AdminLessonCreateDto): Promise<AdminLessonDetailDto> {
  return fetchJson<AdminLessonDetailDto>(`${P}/lessons`, { method: 'POST', body: JSON.stringify(body) })
}

export function updateLesson(id: string, body: AdminLessonUpdateDto): Promise<AdminLessonDetailDto> {
  return fetchJson<AdminLessonDetailDto>(`${P}/lessons/${enc(id)}`, { method: 'PUT', body: JSON.stringify(body) })
}

export function deleteLesson(id: string): Promise<AdminDeleteResultDto> {
  return fetchJson<AdminDeleteResultDto>(`${P}/lessons/${enc(id)}`, { method: 'DELETE' })
}

// ── §10.6 Quiz (el GET admin SÍ trae correct_key/explanation) ────────────────

export function getAdminQuiz(lessonId: string): Promise<AdminQuizDto> {
  return fetchJson<AdminQuizDto>(`${P}/lessons/${enc(lessonId)}/quiz`)
}

export function putAdminQuiz(lessonId: string, body: AdminQuizUpsertDto): Promise<AdminQuizDto> {
  return fetchJson<AdminQuizDto>(`${P}/lessons/${enc(lessonId)}/quiz`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export function deleteAdminQuiz(lessonId: string): Promise<AdminDeleteResultDto> {
  return fetchJson<AdminDeleteResultDto>(`${P}/lessons/${enc(lessonId)}/quiz`, { method: 'DELETE' })
}

// ── §10.4 Ejemplos (solo edición; nacen/mueren con la lección) ───────────────

export function getAdminExample(id: string): Promise<AdminExampleDto> {
  return fetchJson<AdminExampleDto>(`${P}/examples/${enc(id)}`)
}

export function updateExample(id: string, body: AdminExampleUpdateDto): Promise<AdminExampleDto> {
  return fetchJson<AdminExampleDto>(`${P}/examples/${enc(id)}`, { method: 'PUT', body: JSON.stringify(body) })
}

/** POST /admin/examples/{id}/code — sube el `.py` como JSON (filename+source). */
export function uploadExampleCode(
  id: string,
  body: AdminExampleCodeRequestDto,
): Promise<AdminExampleCodeResultDto> {
  return fetchJson<AdminExampleCodeResultDto>(`${P}/examples/${enc(id)}/code`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}
