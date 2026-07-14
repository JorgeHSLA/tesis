// AdminShell — layout propio del área de autoría (grid header + main), SIN el
// Sidebar/TopBar del estudiante. Una barra de acento superior distintiva
// recuerda al admin que no está en la vista del alumno. fase4-autoria-design §9.C.
import { Outlet } from 'react-router-dom'
import { AdminTopBar } from './AdminTopBar'

export function AdminShell() {
  return (
    <div className="admin-shell">
      <div className="admin-accent-bar" aria-hidden="true" />
      <AdminTopBar />
      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  )
}
