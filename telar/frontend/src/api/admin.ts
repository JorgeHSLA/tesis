// api/admin.ts — capa HTTP del modo autoría (admin, Fase 4).
// Ya NO hay login ni token: el modo autoría se decide en BUILD (VITE_ADMIN →
// config.ts ADMIN_BUILD) y el backend lo gobierna con TELAR_ADMIN_MODE. Las
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
  AdminLessonExampleCreateDto,
  AdminLessonUpdateDto,
  AdminModuleCreateDto,
  AdminModuleDto,
  AdminModulesResponseDto,
  AdminModuleUpdateDto,
  AdminQuizDto,
  AdminQuizUpsertDto,
  AdminReorderItemDto,
  AdminReorderRequestDto,
  AdminCatalogCredentialStatusDto,
  AdminImportRequestDto,
  AdminImportResultDto,
  AdminPublishRequestDto,
  AdminPublishResultDto,
  AdminPublishStatusDto,
  AdminUnpublishResultDto,
  AdminWorkshopStepInputDto,
  AdminWorkshopStepsDto,
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

/**
 * §10.2 DELETE /admin/modules/{id}. Sin `cascade`, un módulo con lecciones da
 * 409 MODULE_NOT_EMPTY; con `cascade` se borran también sus lecciones (CU-16.1).
 */
export function deleteModule(id: string, opts?: { cascade?: boolean }): Promise<AdminDeleteResultDto> {
  const query = opts?.cascade ? '?cascade=true' : ''
  return fetchJson<AdminDeleteResultDto>(`${P}/modules/${enc(id)}${query}`, { method: 'DELETE' })
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

/**
 * §10.3 PUT /admin/lessons/reorder — reasigna el `order` (y, con `module_id`,
 * el módulo) de varias lecciones en una sola transacción. Es lo que permite
 * insertar en una posición ocupada: el PUT de una lección daría 409.
 */
export function reorderLessons(items: AdminReorderItemDto[]): Promise<AdminModulesResponseDto> {
  const body: AdminReorderRequestDto = { items }
  return fetchJson<AdminModulesResponseDto>(`${P}/lessons/reorder`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

/** §10.3 POST /admin/lessons/{id}/example — da ejemplo y código a una lección sin él. */
export function addLessonExample(id: string, body: AdminLessonExampleCreateDto): Promise<AdminExampleDto> {
  return fetchJson<AdminExampleDto>(`${P}/lessons/${enc(id)}/example`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// ── §12.3 Pasos de un taller (S6) — cada operación devuelve la lista entera ──

/** POST /admin/lessons/{id}/steps — añade un paso al final. */
export function addWorkshopStep(lessonId: string, body: AdminWorkshopStepInputDto): Promise<AdminWorkshopStepsDto> {
  return fetchJson<AdminWorkshopStepsDto>(`${P}/lessons/${enc(lessonId)}/steps`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/** PUT /admin/lessons/{id}/steps/{idx} — reemplaza el contenido de un paso. */
export function updateWorkshopStep(
  lessonId: string,
  idx: number,
  body: AdminWorkshopStepInputDto,
): Promise<AdminWorkshopStepsDto> {
  return fetchJson<AdminWorkshopStepsDto>(`${P}/lessons/${enc(lessonId)}/steps/${idx}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

/** PUT /admin/lessons/{id}/steps/reorder — `order[i]` = idx actual del paso que pasa a `i`. */
export function reorderWorkshopSteps(lessonId: string, order: number[]): Promise<AdminWorkshopStepsDto> {
  return fetchJson<AdminWorkshopStepsDto>(`${P}/lessons/${enc(lessonId)}/steps/reorder`, {
    method: 'PUT',
    body: JSON.stringify({ order }),
  })
}

/** DELETE /admin/lessons/{id}/steps/{idx} — borra el paso y compacta los idx. */
export function deleteWorkshopStep(lessonId: string, idx: number): Promise<AdminWorkshopStepsDto> {
  return fetchJson<AdminWorkshopStepsDto>(`${P}/lessons/${enc(lessonId)}/steps/${idx}`, { method: 'DELETE' })
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

// ── §11.8 Catálogo admin: credencial y publicación ──────────────────────────

/**
 * §11.8.1 `GET /admin/catalog/credentials` — ¿se puede publicar, y con qué
 * cuenta? **Responde 200 siempre**, incluso sin clave: que falte es un estado
 * normal de un despliegue, no una avería, y el diálogo necesita poder decir
 * POR QUÉ no se puede publicar antes de que el admin escriba nada.
 *
 * Con `probe` sale a la red para comprobar que la cuenta autoriza sobre el
 * bucket; sin él solo mira el archivo (existe, permisos, forma).
 */
export function getCatalogCredentials(
  probe = false,
): Promise<AdminCatalogCredentialStatusDto> {
  const query = probe ? '?probe=true' : ''
  return fetchJson<AdminCatalogCredentialStatusDto>(`${P}/catalog/credentials${query}`)
}

/**
 * §11.8.2 `POST /admin/modules/{id}/publish` — publica el módulo en el bucket.
 *
 * **Publicar es irreversible**: una versión publicada es inmutable, así que
 * republicarla da `409 VERSION_CONFLICT`. Por eso existe `dry_run`, que recorre
 * el MISMO camino sin escribir y devuelve los avisos — en particular
 * `LESSON_ID_REMOVED`, que anuncia que quien actualice perderá su avance.
 */
export function publishModule(
  moduleId: string,
  body: AdminPublishRequestDto = {},
): Promise<AdminPublishResultDto> {
  return fetchJson<AdminPublishResultDto>(`${P}/modules/${enc(moduleId)}/publish`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/**
 * §11.8.3 `GET /admin/modules/{id}/publish/status` — compara el contenido local
 * con la versión vigente del índice (leído sin caché). **200 también sin red**
 * (`state: 'unknown'`): no poder comprobar no impide publicar.
 */
export function getPublishStatus(moduleId: string): Promise<AdminPublishStatusDto> {
  return fetchJson<AdminPublishStatusDto>(`${P}/modules/${enc(moduleId)}/publish/status`)
}

/**
 * §11.8.4 `DELETE /admin/modules/{id}/publish` — retira el módulo del catálogo
 * (CU-41.1). Solo quita la entrada del índice: no borra bundles ni toca nada
 * local, y quien ya lo incorporó lo conserva como «Ya no publicado».
 */
export function unpublishModule(moduleId: string): Promise<AdminUnpublishResultDto> {
  return fetchJson<AdminUnpublishResultDto>(`${P}/modules/${enc(moduleId)}/publish`, {
    method: 'DELETE',
  })
}

/**
 * §11.7 `POST /admin/catalog/import` — traer un módulo del bucket para editarlo.
 *
 * Sin `as_module_id` el import es **vinculado**: equivale a incorporarlo, y el
 * módulo conserva su fila en `installed_modules`, que es lo que le dice al admin
 * sobre qué versión base está editando. Con `as_module_id` es un **fork**: ids
 * propios, `origin='local'` y sin manifiesto — contenido nuevo que ya no recibe
 * actualizaciones del bucket y se publicará bajo su id.
 *
 * **No exige credencial de escritura**: leer el catálogo sigue siendo anónimo
 * (§11.7), así que se puede importar sin poder publicar.
 */
export function importCatalogModule(
  body: AdminImportRequestDto,
): Promise<AdminImportResultDto> {
  return fetchJson<AdminImportResultDto>(`${P}/catalog/import`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// ── Imágenes de las lecciones ────────────────────────────────────────────────

/** Respuesta de POST /admin/images (backend/app/routers/admin_catalog.py). */
export interface AdminImageDto {
  /** URL pública lista para `![texto](url)` en el markdown de la lección. */
  url: string
  object_path: string
  bytes: number
  width: number
  height: number
  content_type: string
}

/**
 * Sube una imagen al bucket de Telar (PNG/JPG/GIF/WebP, ≤ 2 MB, ≤ 4096 px por
 * lado). Se sube AL MOMENTO: el nombre es el hash del contenido, así que la URL
 * es segura de insertar de inmediato y subir la misma imagen dos veces no
 * duplica nada. Requiere la misma credencial que publicar.
 */
export function uploadLessonImage(file: File): Promise<AdminImageDto> {
  const form = new FormData()
  form.append('file', file)
  return fetchJson<AdminImageDto>(`${P}/images`, { method: 'POST', body: form })
}
