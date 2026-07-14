// AdminGuard — puerta del área de autoría. Al montar, si el estado es
// `unknown`, verifica el token persistido contra GET /admin/session
// (`restore`); mientras verifica muestra el ScreenSkeleton (sin flash de
// login). Sin sesión usable → redirige a /admin/login guardando `state.from`
// para volver tras el login. La ruta /admin/login queda FUERA del guard
// (evita un bucle de redirección). fase4-autoria-design §9.C.
import { useEffect, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAdminSession } from '../../stores/adminSessionStore'
import { ScreenSkeleton } from '../ui/Skeleton'

export interface AdminGuardProps {
  children: ReactNode
}

export function AdminGuard({ children }: AdminGuardProps) {
  const status = useAdminSession((s) => s.status)
  const restore = useAdminSession((s) => s.restore)
  const location = useLocation()

  useEffect(() => {
    if (status === 'unknown') void restore()
  }, [status, restore])

  if (status === 'authenticated') return <>{children}</>
  if (status === 'unknown' || status === 'restoring') return <ScreenSkeleton />
  return <Navigate to="/admin/login" replace state={{ from: location }} />
}
