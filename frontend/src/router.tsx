import { lazy, Suspense } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { SkeletonCard } from '@/components/ui/Skeleton'
import { SignInPage } from '@/pages/auth/SignInPage'

// Lazy-loaded pages — splits route bundles for performance
const DashboardPage      = lazy(() => import('@/pages/DashboardPage').then(m => ({ default: m.DashboardPage })))
const WarehousePage      = lazy(() => import('@/pages/WarehousePage').then(m => ({ default: m.WarehousePage })))
const InventoryPage      = lazy(() => import('@/pages/InventoryPage').then(m => ({ default: m.InventoryPage })))
const DisruptionsPage    = lazy(() => import('@/pages/DisruptionsPage').then(m => ({ default: m.DisruptionsPage })))
const CaseDetailPage     = lazy(() => import('@/pages/CaseDetailPage').then(m => ({ default: m.CaseDetailPage })))
const NewCasePage        = lazy(() => import('@/pages/NewCasePage').then(m => ({ default: m.NewCasePage })))
const SuppliersPage      = lazy(() => import('@/pages/SuppliersPage').then(m => ({ default: m.SuppliersPage })))
const RecoveryPage       = lazy(() => import('@/pages/RecoveryPage').then(m => ({ default: m.RecoveryPage })))
const ApprovalsPage      = lazy(() => import('@/pages/ApprovalsPage').then(m => ({ default: m.ApprovalsPage })))
const CommunicationsPage = lazy(() => import('@/pages/CommunicationsPage').then(m => ({ default: m.CommunicationsPage })))
const DeliveriesPage     = lazy(() => import('@/pages/DeliveriesPage').then(m => ({ default: m.DeliveriesPage })))
const AgentsPage         = lazy(() => import('@/pages/AgentsPage').then(m => ({ default: m.AgentsPage })))
const LiveSimulationPage = lazy(() => import('@/pages/LiveSimulationPage').then(m => ({ default: m.LiveSimulationPage })))
const SettingsPage       = lazy(() => import('@/pages/SettingsPage').then(m => ({ default: m.SettingsPage })))

function Fallback() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
    </div>
  )
}

function Protected({ children, requireApprover }: { children: React.ReactNode; requireApprover?: boolean }) {
  return (
    <ProtectedRoute requireApprover={requireApprover}>
      <Suspense fallback={<Fallback />}>{children}</Suspense>
    </ProtectedRoute>
  )
}

export const router = createBrowserRouter([
  {
    path: '/sign-in',
    element: <SignInPage />,
  },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <AppShell />
      </ProtectedRoute>
    ),
    children: [
      { index: true,        element: <Protected><DashboardPage /></Protected> },
      { path: 'warehouse',  element: <Protected><WarehousePage /></Protected> },
      { path: 'inventory',  element: <Protected><InventoryPage /></Protected> },
      {
        path: 'disruptions',
        children: [
          { index: true,          element: <Protected><DisruptionsPage /></Protected> },
          { path: 'new',          element: <Protected><NewCasePage /></Protected> },
          { path: ':caseId',      element: <Protected><CaseDetailPage /></Protected> },
        ],
      },
      { path: 'suppliers',       element: <Protected><SuppliersPage /></Protected> },
      { path: 'recovery',        element: <Protected><RecoveryPage /></Protected> },
      { path: 'approvals',       element: <Protected requireApprover><ApprovalsPage /></Protected> },
      { path: 'communications',  element: <Protected><CommunicationsPage /></Protected> },
      { path: 'deliveries',      element: <Protected><DeliveriesPage /></Protected> },
      { path: 'simulation',      element: <Protected><LiveSimulationPage /></Protected> },
      { path: 'agents',          element: <Protected><AgentsPage /></Protected> },
      { path: 'settings',        element: <Protected><SettingsPage /></Protected> },
      { path: '*',               element: <Navigate to="/" replace /> },
    ],
  },
])
