// AdminLoginScreen — pantalla pública #/admin/login (fuera del guard).
// Campo de contraseña (autoFocus, Enter=submit) + botón "Entrar". Un 401 (sea
// contraseña incorrecta o modo admin deshabilitado en el backend) muestra el
// mismo mensaje "Contraseña incorrecta". Bajo el formulario hay una ayuda
// ESTÁTICA (pista de cliente, no señal del servidor). Fallos de red → ErrorState.
import '../../styles/screens/admin.css'
import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { useAdminSession } from '../../stores/adminSessionStore'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { ErrorState } from '../../components/ui/ErrorState'
import { IconLayers } from '../../components/icons/icons'

interface LocationState {
  from?: { pathname?: string }
}

export default function AdminLoginScreen() {
  const status = useAdminSession((s) => s.status)
  const login = useAdminSession((s) => s.login)
  const navigate = useNavigate()
  const location = useLocation()

  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [netError, setNetError] = useState<ApiError | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const from = (location.state as LocationState | null)?.from?.pathname ?? '/admin'

  // Si ya hay sesión (p. ej. tras un restore exitoso), no mostrar el login.
  if (status === 'authenticated') return <Navigate to={from} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (submitting || password.length === 0) return
    setSubmitting(true)
    setError(null)
    setNetError(null)
    try {
      await login(password)
      navigate(from, { replace: true })
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Contraseña incorrecta')
      } else if (err instanceof ApiError) {
        setNetError(err)
      } else {
        setNetError(new ApiError('INTERNAL_ERROR', 'Error inesperado al iniciar sesión.', 0))
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="admin-auth">
      <div className="admin-accent-bar" aria-hidden="true" />
      <section className="admin-auth-card card" aria-labelledby="admin-login-title">
        <div className="admin-auth-brand">
          <span className="admin-brand-mark" aria-hidden="true">
            <IconLayers size={20} />
          </span>
          <div>
            <div className="eyebrow">E-HPC · Autoría</div>
            <h1 id="admin-login-title" className="display-lg">
              Modo administrador
            </h1>
          </div>
        </div>

        {netError != null ? (
          <ErrorState
            title="No se pudo iniciar sesión"
            message="No se pudo contactar con el backend E-HPC. Comprueba que esté en marcha e inténtalo de nuevo."
            detail={`${netError.code}: ${netError.message}`}
            onRetry={() => setNetError(null)}
          />
        ) : (
          <form className="admin-auth-form" onSubmit={submit} noValidate>
            <Field label="Contraseña" htmlFor="admin-password" error={error ?? undefined}>
              <input
                id="admin-password"
                className="input"
                type="password"
                autoFocus
                autoComplete="current-password"
                value={password}
                spellCheck={false}
                aria-invalid={error != null}
                onChange={(e) => {
                  setPassword(e.currentTarget.value)
                  if (error != null) setError(null)
                }}
              />
            </Field>
            <Button type="submit" variant="primary" size="lg" disabled={submitting || password.length === 0}>
              {submitting ? 'Entrando…' : 'Entrar'}
            </Button>
            <p className="admin-auth-help mono-small muted">
              ¿El backend tiene <code>EHPC_ADMIN_PASSWORD</code> configurado? Sin esa variable el modo
              administrador está deshabilitado.
            </p>
          </form>
        )}
      </section>
    </div>
  )
}
