// lib/download — descargas desde el renderer vía Blob local (CU-10.1).
// En Electron la página es file:// (o el dev server) y el API vive en
// http://localhost:8000: Chromium ignora `<a download>` entre orígenes y
// security.ts bloquea la navegación http. Un `blob:` es del mismo origen que
// la página, así que el atributo `download` sí se respeta en web y escritorio.

/** Tras el click el navegador ya tomó la referencia; se libera en el siguiente tick. */
const REVOKE_DELAY_MS = 0

/** Guarda un Blob ya construido (p. ej. la exportación JSON de resultados). */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  try {
    a.click()
  } finally {
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS)
  }
}

/** fetch → Blob → descarga. Rechaza si la red falla o la respuesta no es 2xx. */
export async function downloadFile(url: string, filename: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Descarga fallida: HTTP ${res.status}`)
  saveBlob(await res.blob(), filename)
}
