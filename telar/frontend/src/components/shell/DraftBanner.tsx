// DraftBanner — S5 (D+): en el build de autoría, las rutas /aprender muestran
// el BORRADOR del autor (el mismo snapshot que edita en Autoría). Los
// estudiantes de otras máquinas solo reciben lo PUBLICADO (§11.8), así que sin
// este aviso el autor podría creer que lo que ve ya lo ven los demás. Decisión
// documentada en api-contract §10.1 (nota D+): no hay tablas de borrador.
//
// Es un aviso fijo (no se cierra): la confusión que evita no desaparece por
// haberlo leído una vez. Vive en el shell y no en LearnScreen para cubrir
// /aprender y todas sus lecciones con un solo punto.
import { useLocation } from 'react-router-dom'
import { ADMIN_BUILD } from '../../config'
import { IconAlert } from '../icons/icons'

/** `/aprender` y `/aprender/<lección>`, pero no rutas que solo empiecen igual. */
const RUTA_APRENDER = /^\/aprender(\/|$)/

export function DraftBanner() {
  const { pathname } = useLocation()
  if (!ADMIN_BUILD || !RUTA_APRENDER.test(pathname)) return null
  return (
    <div className="draft-banner" role="note">
      <IconAlert size={14} />
      <span>
        Vista previa: estás viendo tu borrador. Los estudiantes ven la última versión
        publicada.
      </span>
    </div>
  )
}
