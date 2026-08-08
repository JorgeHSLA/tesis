// Test de igualdad del contrato window.telar (electron-spec §1):
// desktop/types/telar-api.d.ts debe ser copia byte-idéntica de
// frontend/src/types/telar.d.ts. Falla con exit 1 si divergen.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const desktopCopy = path.join(here, '..', 'types', 'telar-api.d.ts')
const frontendCopy = path.join(here, '..', '..', 'frontend', 'src', 'types', 'telar.d.ts')

const a = readFileSync(desktopCopy, 'utf8')
const b = readFileSync(frontendCopy, 'utf8')

if (a !== b) {
  console.error('CONTRATO ROTO: desktop/types/telar-api.d.ts != frontend/src/types/telar.d.ts')
  console.error('Ambos archivos deben ser copias byte-idénticas (electron-spec.md §1).')
  process.exit(1)
}
console.log('contrato window.telar: OK (idénticos)')
