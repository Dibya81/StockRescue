import { useEffect, useState } from 'react'
import { useLocation, Link } from 'react-router-dom'
import { clsx } from 'clsx'
import { LogOut, User, ChevronRight, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

const ROUTE_LABELS: Record<string, string> = {
  '/':               'Dashboard',
  '/warehouse':      '3D Warehouse',
  '/inventory':      'Inventory Catalog',
  '/disruptions':    'Disruptions',
  '/disruptions/new':'New Case Intake',
  '/suppliers':      'Suppliers & Sourcing',
  '/recovery':       'Recovery Plans',
  '/approvals':      'Procurement Approvals',
  '/communications': 'Vendor Communications',
  '/deliveries':     'Deliveries Watch',
  '/agents':         'Agent Operations',
  '/settings':       'System Settings',
}

type ConnectivityStatus = 'checking' | 'online' | 'offline'

export function TopBar() {
  const { user, signOut, apiClient } = useAuth()
  const location = useLocation()
  const [connectivity, setConnectivity] = useState<ConnectivityStatus>('checking')
  const [signingOut, setSigningOut] = useState(false)

  const pageLabel =
    ROUTE_LABELS[location.pathname] ||
    Object.entries(ROUTE_LABELS).find(([path]) => path !== '/' && location.pathname.startsWith(path))?.[1] ||
    'Dashboard'

  // Live health check
  useEffect(() => {
    let cancelled = false
    async function check() {
      try {
        await apiClient.getHealth()
        if (!cancelled) setConnectivity('online')
      } catch {
        if (!cancelled) setConnectivity('offline')
      }
    }
    check()
    const id = setInterval(check, 30_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [apiClient])

  const handleSignOut = async () => {
    setSigningOut(true)
    await signOut()
    setSigningOut(false)
  }

  const userRoles = (user?.app_metadata as { roles?: string[] })?.roles || []
  const isApprover = userRoles.includes('procurement_approver')

  return (
    <header
      className="flex h-[56px] items-center justify-between border-b border-[#E2E8F0] bg-[#FFFFFF]/85 backdrop-blur-md px-6 z-10 select-none shadow-xs"
      aria-label="Top navigation"
    >
      {/* Breadcrumbs & Page title */}
      <div className="flex items-center gap-2 text-xs">
        <Link
          to="/"
          className="text-[#64748B] hover:text-[#2563EB] transition-colors font-medium"
        >
          StockRescue
        </Link>
        <ChevronRight className="h-3.5 w-3.5 text-[#94A3B8]" aria-hidden="true" />
        <span className="text-[#0F172A] font-semibold text-sm">
          {pageLabel}
        </span>
      </div>

      {/* Right cluster */}
      <div className="flex items-center gap-3 sm:gap-4">
        {/* Real Connectivity Indicator */}
        <div
          className={clsx(
            'flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors shadow-2xs',
            connectivity === 'online' && 'border-[#16A34A]/30 bg-[#DCFCE7] text-[#16A34A]',
            connectivity === 'offline' && 'border-[#DC2626]/30 bg-[#FEE2E2] text-[#DC2626]',
            connectivity === 'checking' && 'border-[#F59E0B]/30 bg-[#FEF3C7] text-[#F59E0B]',
          )}
          role="status"
          aria-live="polite"
          title={`API Connectivity: ${connectivity}`}
        >
          <span
            className={clsx(
              'h-2 w-2 rounded-full',
              connectivity === 'online' && 'bg-[#16A34A]',
              connectivity === 'offline' && 'bg-[#DC2626]',
              connectivity === 'checking' && 'bg-[#F59E0B] animate-pulse',
            )}
            aria-hidden="true"
          />
          <span className="capitalize hidden sm:inline">
            {connectivity === 'online' ? 'API Connected' : connectivity === 'offline' ? 'API Offline' : 'Connecting'}
          </span>
        </div>

        {/* Authenticated Operator Identity */}
        {user && (
          <div className="flex items-center gap-2.5 rounded-lg border border-[#E2E8F0] bg-[#FFFFFF] px-3 py-1.5 shadow-2xs">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[#EFF6FF] text-[#2563EB]">
              <User className="h-3.5 w-3.5" aria-hidden="true" />
            </div>
            <div className="flex flex-col text-left">
              <span className="max-w-[150px] truncate-text text-xs font-medium text-[#0F172A]" title={user.email ?? ''}>
                {user.email}
              </span>
              {isApprover && (
                <span className="flex items-center gap-1 text-[10px] font-semibold text-[#2563EB]">
                  <ShieldCheck className="h-3 w-3" /> Approver
                </span>
              )}
            </div>
          </div>
        )}

        {/* Sign Out */}
        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          className="btn-clay text-xs py-1.5 px-3"
          aria-label="Sign out"
        >
          <LogOut className="h-3.5 w-3.5 text-[#64748B]" aria-hidden="true" />
          <span className="hidden sm:inline">{signingOut ? 'Signing out…' : 'Sign out'}</span>
        </button>
      </div>
    </header>
  )
}
