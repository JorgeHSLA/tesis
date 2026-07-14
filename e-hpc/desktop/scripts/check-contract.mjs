// Test de igualdad del contrato window.ehpc (electron-spec §1):
// desktop/types/ehpc-api.d.ts debe ser copia byte-idéntica de
// frontend/src/types/ehpc.d.ts. Falla con exit 1 si divergen.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const desktopCopy = path.join(here, '..', 'types', 'ehpc-api.d.ts')
const frontendCopy = path.join(here, '..', '..', 'frontend', 'src', 'types', 'ehpc.d.ts')

const a = readFileSync(desktopCopy, 'utf8')
const b = readFileSync(frontendCopy, 'utf8')

if (a !== b) {
  console.error('CONTRATO ROTO: desktop/types/ehpc-api.d.ts != frontend/src/types/ehpc.d.ts')
  console.error('Ambos archivos deben ser copias byte-idénticas (electron-spec.md §1).')
  process.exit(1)
}
console.log('contrato window.ehpc: OK (idénticos)')
