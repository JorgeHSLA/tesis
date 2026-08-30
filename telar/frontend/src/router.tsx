// router.tsx — router DEFINITIVO (frontend-spec §2): createHashRouter con las
// rutas del estudiante + autoría, React.lazy por pantalla y <Suspense
// fallback={<ScreenSkeleton/>}>. Un chunk por pantalla; ui/icons/shell van al
// chunk principal. `*` vuelve a `/` (frontend-spec §2).
// Autoría (admin): /admin/* anidado en el MISMO AppShell (opción B — misma
// shell), SOLO en el build admin (VITE_ADMIN → ADMIN_BUILD). Ya no hay login ni
// guard: el acceso es por el item «Autoría» del Sidebar. En el build estudiante
// esas rutas ni se registran (y sus chunks caen por tree-shaking) → /admin/*
// termina en el catch-all → Home.
import { lazy, Suspense, type ComponentType } from 'react'
import { createHashRouter, Navigate, type RouteObject } from 'react-router-dom'
import { AppShell } from './components/shell/AppShell'
import { ScreenSkeleton } from './components/ui/Skeleton'
import { ADMIN_BUILD } from './config'

const HomeScreen = lazy(() => import('./features/home/HomeScreen'))
const SimulatorScreen = lazy(() => import('./features/simulator/SimulatorScreen'))
const ResultsList = lazy(() => import('./features/results/ResultsList'))
const ResultsScreen = lazy(() => import('./features/results/ResultsScreen'))
const CatalogScreen = lazy(() => import('./features/catalog/CatalogScreen'))
const ModuleStoreScreen = lazy(() => import('./features/store/ModuleStoreScreen'))
const LearnScreen = lazy(() => import('./features/learn/LearnScreen'))

function screen(Component: ComponentType) {
  return (
    <Suspense fallback={<ScreenSkeleton />}>
      <Component />
    </Suspense>
  )
}

// Rutas de autoría (admin), SOLO en el build admin. Las llamadas
// `lazy(() => import('./features/admin/...'))` viven DENTRO de este branch: en el
// build estudiante `ADMIN_BUILD` es una constante falsa, así que el bundler
// elimina toda la rama (rutas + imports dinámicos) por tree-shaking y no emite
// los chunks de `features/admin/*`.
function adminRoutes(): RouteObject[] {
  if (!ADMIN_BUILD) return []
  const AdminDashboard = lazy(() => import('./features/admin/AdminDashboard'))
  const AdminLessonEditor = lazy(() => import('./features/admin/lesson/AdminLessonEditor'))
  const AdminQuizEditor = lazy(() => import('./features/admin/quiz/AdminQuizEditor'))
  const AdminExampleEditor = lazy(() => import('./features/admin/example/AdminExampleEditor'))
  return [
    {
      // MISMA shell que el estudiante (topbar + sidebar): no hay app aparte.
      // Sus pantallas usan `.screen`, igual que las del estudiante, así que
      // encajan en el Outlet del AppShell.
      path: 'admin',
      children: [
        { index: true, element: screen(AdminDashboard) },
        { path: 'lecciones/nueva', element: screen(AdminLessonEditor) },
        { path: 'lecciones/:lessonId', element: screen(AdminLessonEditor) },
        { path: 'quiz/:lessonId', element: screen(AdminQuizEditor) },
        { path: 'ejemplos/:exampleId', element: screen(AdminExampleEditor) },
        { path: '*', element: <Navigate to="/admin" replace /> },
      ],
    },
  ]
}

export const router = createHashRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: screen(HomeScreen) },
      { path: 'simulador', element: screen(SimulatorScreen) },
      { path: 'simulador/:jobId', element: screen(SimulatorScreen) },
      { path: 'resultados', element: screen(ResultsList) },
      { path: 'resultados/:jobId', element: screen(ResultsScreen) },
      { path: 'cursos', element: screen(CatalogScreen) },
      { path: 'cursos/:leccionId', element: screen(LearnScreen) },

      // Catálogo remoto (Fase 5, §11.5-§11.6). HERMANA de /cursos, NO anidada
      // bajo ella: `cursos/:leccionId` es un comodín sobre ids que vienen del
      // BUCKET, así que un módulo publicado con una lección llamada `modulos`
      // dejaría esta pantalla inalcanzable para siempre. Como ruta de primer
      // nivel, ningún contenido remoto puede taparla.
      { path: 'modulos', element: screen(ModuleStoreScreen) },

      ...adminRoutes(),

      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])
