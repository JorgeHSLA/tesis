// ThemeToggle — conmutador claro ⇄ oscuro del rail (arriba a la izquierda,
// junto a la marca). El icono muestra el DESTINO de la acción, que es lo que
// espera el usuario de un conmutador de tema:
//   tema claro  → luna ("cambiar a oscuro")
//   tema oscuro → sol  ("cambiar a claro")
// A11y: <button> real, `aria-pressed` = "¿está el modo oscuro activo?",
// aria-label/title/tooltip que nombran la acción (no el estado), y el foco
// visible global de base.css.
import { useThemeStore } from '../../stores/themeStore'
import { IconMoon, IconSun } from '../icons/icons'

export function ThemeToggle() {
  const theme = useThemeStore((s) => s.theme)
  const toggleTheme = useThemeStore((s) => s.toggleTheme)

  const isDark = theme === 'dark'
  const label = isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'

  return (
    <button
      type="button"
      className="nav-item theme-toggle"
      onClick={toggleTheme}
      aria-pressed={isDark}
      aria-label={label}
      title={label}
      data-tip={label}
    >
      <span className="nav-icon">{isDark ? <IconSun size={17} /> : <IconMoon size={17} />}</span>
    </button>
  )
}
