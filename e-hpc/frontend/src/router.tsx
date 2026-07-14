// router.tsx — router DEFINITIVO (frontend-spec §2): createHashRouter con las
// 7 rutas, React.lazy por pantalla y <Suspense fallback={<ScreenSkeleton/>}>.
// Un chunk por pantalla; ui/icons/shell van al chunk principal.
// `*` vuelve a `/` (frontend-spec §2).
import { lazy, Suspense, type ComponentType } from 'react'
import { createHashRouter, Navigate } from 'react-router-dom'
import { AppShell } from './components/shell/AppShell'
import { AdminGuard } from './components/admin/AdminGuard'
import { AdminShell } from './components/admin/AdminShell'
import { ScreenSkeleton } from './components/ui/Skeleton'

const HomeScreen = lazy(() => import('./features/home/HomeScreen'))
const SimulatorScreen = lazy(() => import('./features/simulator/SimulatorScreen'))
const ResultsList = lazy(() => import('./features/results/ResultsList'))
const ResultsScreen = lazy(() => import('./features/results/ResultsScreen'))
const CatalogScreen = lazy(() => import('./features/catalog/CatalogScreen'))
const LearnScreen = lazy(() => import('./features/learn/LearnScreen'))

// Área de autoría (admin) — chunks lazy, fuera del bundle del estudiante.
const AdminLoginScreen = lazy(() => import('./features/admin/AdminLoginScreen'))
const AdminDashboard = lazy(() => import('./features/admin/AdminDashboard'))
const AdminLessonEditor = lazy(() => import('./features/admin/lesson/AdminLessonEditor'))
const AdminQuizEditor = lazy(() => import('./features/admin/quiz/AdminQuizEditor'))
const AdminExampleEditor = lazy(() => import('./features/admin/example/AdminExampleEditor'))

function screen(Component: ComponentType) {
  return (
    <Suspense fallback={<ScreenSkeleton />}>
      <Component />
    </Suspense>
  )
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
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
  {
    // Rama hermana top-level (NO anidada bajo AppShell): shell propio de autoría.
    path: '/admin',
    children: [
      { path: 'login', element: screen(AdminLoginScreen) },
      {
        element: (
          <AdminGuard>
            <AdminShell />
          </AdminGuard>
        ),
        children: [
          { index: true, element: screen(AdminDashboard) },
          { path: 'lecciones/nueva', element: screen(AdminLessonEditor) },
          { path: 'lecciones/:lessonId', element: screen(AdminLessonEditor) },
          { path: 'quiz/:lessonId', element: screen(AdminQuizEditor) },
          { path: 'ejemplos/:exampleId', element: screen(AdminExampleEditor) },
          { path: '*', element: <Navigate to="/admin" replace /> },
        ],
      },
    ],
  },
])
