// main.tsx — entry definitivo (WP5): fuentes self-hosted @fontsource (cero
// requests de red, requisito CSP desktop — frontend-spec §5.5), tokens +
// base + componentes, y RouterProvider con el router de §2.
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-sans/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/600.css'
import '@fontsource/jetbrains-mono/700.css'

import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/screens/admin.css'

// Fija data-variant="v2" en <html> ANTES del render (única variante soportada).
import './stores/themeStore'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { router } from './router'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
