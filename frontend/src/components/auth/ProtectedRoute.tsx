import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'

interface ProtectedRouteProps {
  children: React.ReactNode
  requireApprover?: boolean
}

export function ProtectedRoute({ children, requireApprover = false }: ProtectedRouteProps) {
  const { session, loading, user } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center" aria-live="polite">
        <div className="text-secondary text-sm">Authenticating…</div>
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/sign-in" state={{ from: location }} replace />
  }

  if (requireApprover) {
    // Check role from JWT app_metadata or user_metadata
    const meta = user?.app_metadata as Record<string, unknown> | undefined
    const roles = (meta?.roles as string[] | undefined) ?? []
    if (!roles.includes('procurement_approver')) {
      return (
        <div
          className="flex h-full flex-col items-center justify-center gap-3"
          role="alert"
          aria-live="assertive"
        >
          <p className="text-danger font-medium text-base">Access Denied</p>
          <p className="text-secondary text-sm">
            The <code>procurement_approver</code> role is required to access this page.
          </p>
        </div>
      )
    }
  }

  return <>{children}</>
}
