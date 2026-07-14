// AdminTopBar — cabecera propia del área de autoría (NO es el TopBar del
// estudiante). Marca "Modo autoría", acceso a la vista pública y botón
// "Cerrar sesión". El icono de logout se compone con el primitivo `Icon`
// exportado por icons.tsx (no se edita ese archivo).
import { useNavigate } from 'react-router-dom'
import { useAdminSession } from '../../stores/adminSessionStore'
import { Button } from '../ui/Button'
import { Icon, IconArrowRight, IconLayers, type IconProps } from '../icons/icons'

const IconLogOut = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5" />
    <path d="M21 12H9" />
  </Icon>
)

export function AdminTopBar() {
  const navigate = useNavigate()
  const logout = useAdminSession((s) => s.logout)

  const onLogout = async () => {
    await logout()
    navigate('/admin/login', { replace: true })
  }

  return (
    <header className="admin-topbar">
      <div className="admin-brand">
        <span className="admin-brand-mark" aria-hidden="true">
          <IconLayers size={18} />
        </span>
        <div className="admin-brand-text">
          <div className="admin-brand-title">Modo autoría</div>
          <div className="admin-brand-sub mono-small">E-HPC · contenido del curso</div>
        </div>
      </div>
      <div className="admin-topbar-actions">
        <a className="btn btn-ghost btn-sm" href="#/cursos">
          Ver como estudiante
          <IconArrowRight size={15} />
        </a>
        <Button variant="outline" size="sm" onClick={onLogout}>
          <IconLogOut size={15} />
          Cerrar sesión
        </Button>
      </div>
    </header>
  )
}
