import { useEffect, useRef, useState } from 'react'
import { useLocation, Link } from 'react-router-dom'
import { clsx } from 'clsx'
import { ChevronDown, ChevronRight, LogOut, Menu, Settings, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { resolveRoute } from './navigation'

type ConnectivityStatus = 'checking' | 'online' | 'offline'

const CONNECTIVITY_STYLE: Record<ConnectivityStatus, { pill: string; dot: string; label: string }> = {
  checking: { pill: 'border-[#E2E8F0] bg-[#F8FAFC] text-[#64748B]', dot: 'bg-[#94A3B8]', label: 'Connecting' },
  online:   { pill: 'border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]', dot: 'bg-[#16A34A]', label: 'API connected' },
  offline:  { pill: 'border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]', dot: 'bg-[#DC2626]', label: 'API offline' },
}

interface TopBarProps {
  showMenuButton: boolean
  menuOpen: boolean
  onMenuClick: () => void
}

function initialsFor(nameOrEmail: string): string {
  const base = nameOrEmail.split('@')[0]
  const parts = base.split(/[\s._-]+/).filter(Boolean)
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : base.slice(0, 2)
  return letters.toUpperCase()
}

export function TopBar({ showMenuButton, menuOpen, onMenuClick }: TopBarProps) {
  const { user, signOut, apiClient } = useAuth()
  const location = useLocation()
  const [connectivity, setConnectivity] = useState<ConnectivityStatus>('checking')
  const [signingOut, setSigningOut] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)

  const { section, title } = resolveRoute(location.pathname)

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

  // Close the user menu on outside click / Escape
  useEffect(() => {
    if (!userMenuOpen) return
    const onPointer = (e: PointerEvent) => {
      if (!userMenuRef.current?.contains(e.target as Node)) setUserMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setUserMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [userMenuOpen])

  // Close the user menu on navigation
  const [menuPath, setMenuPath] = useState(location.pathname)
  if (menuPath !== location.pathname) {
    setMenuPath(location.pathname)
    setUserMenuOpen(false)
  }

  const handleSignOut = async () => {
    setSigningOut(true)
    await signOut()
    setSigningOut(false)
  }

  const userRoles = (user?.app_metadata as { roles?: string[] })?.roles || []
  const isApprover = userRoles.includes('procurement_approver')
  const displayName = (user?.user_metadata as { name?: string } | undefined)?.name || user?.email || 'Operator'
  const conn = CONNECTIVITY_STYLE[connectivity]

  return (
    <header
      className="relative z-10 flex h-14 flex-shrink-0 items-center justify-between gap-3 border-b border-[#E2E8F0] bg-white/90 px-4 backdrop-blur-md select-none sm:px-6"
      aria-label="Top navigation"
    >
      {/* Route change progress sweep */}
      <span
        key={location.pathname}
        className="animate-route-progress pointer-events-none absolute inset-x-0 -bottom-px h-[2px] bg-gradient-to-r from-[#2563EB] via-[#3B82F6] to-[#60A5FA]"
        aria-hidden="true"
      />

      <div className="flex min-w-0 items-center gap-2">
        {showMenuButton && (
          <button
            type="button"
            onClick={onMenuClick}
            className="-ml-1.5 mr-1 rounded-lg p-2 text-[#475569] transition-colors hover:bg-[#F1F5F9] hover:text-[#0F172A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
            aria-label="Open navigation"
            aria-expanded={menuOpen}
            aria-controls="app-sidebar"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
        )}

        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
          <Link
            to="/"
            className="hidden font-medium text-[#64748B] transition-colors hover:text-[#2563EB] sm:inline"
          >
            StockRescue
          </Link>
          {section && (
            <>
              <ChevronRight className="hidden h-3.5 w-3.5 flex-shrink-0 text-[#CBD5E1] md:block" aria-hidden="true" />
              <span key={`s-${section}`} className="animate-crumb hidden font-medium text-[#64748B] md:inline">
                {section}
              </span>
            </>
          )}
          <ChevronRight className="hidden h-3.5 w-3.5 flex-shrink-0 text-[#CBD5E1] sm:block" aria-hidden="true" />
          <span
            key={location.pathname}
            className="animate-crumb truncate-text font-semibold text-[#0F172A]"
            aria-current="page"
          >
            {title}
          </span>
        </nav>
      </div>

      <div className="flex flex-shrink-0 items-center gap-2 sm:gap-3">
        {/* Connectivity */}
        <div
          className={clsx(
            'flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors duration-300',
            conn.pill,
          )}
          role="status"
          aria-live="polite"
          title={`API connectivity: ${connectivity}`}
        >
          <span className="relative flex h-2 w-2" aria-hidden="true">
            {connectivity === 'online' && (
              <span className={clsx('animate-status-ping absolute inset-0 rounded-full', conn.dot)} />
            )}
            <span
              className={clsx(
                'relative h-2 w-2 rounded-full transition-colors duration-300',
                conn.dot,
                connectivity === 'checking' && 'animate-pulse',
              )}
            />
          </span>
          <span className="hidden sm:inline">{conn.label}</span>
          <span className="sr-only sm:hidden">{conn.label}</span>
        </div>

        {/* User menu */}
        {user && (
          <div ref={userMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setUserMenuOpen(o => !o)}
              className={clsx(
                'flex items-center gap-2 rounded-full border border-[#E2E8F0] bg-white py-1 pl-1 pr-2 transition-all duration-200',
                'hover:border-[#CBD5E1] hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]',
                userMenuOpen && 'border-[#CBD5E1] shadow-sm',
              )}
              aria-haspopup="menu"
              aria-expanded={userMenuOpen}
              aria-label="Account menu"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-[#DBEAFE] to-[#BFDBFE] text-[11px] font-bold text-[#1D4ED8]">
                {initialsFor(displayName)}
              </span>
              <span className="hidden max-w-[160px] flex-col text-left leading-tight md:flex">
                <span className="truncate-text text-xs font-semibold text-[#0F172A]">{displayName}</span>
                <span className="text-[10px] font-medium text-[#64748B]">{isApprover ? 'Approver' : 'Operator'}</span>
              </span>
              <ChevronDown
                className={clsx('h-3.5 w-3.5 text-[#64748B] transition-transform duration-200', userMenuOpen && 'rotate-180')}
                aria-hidden="true"
              />
            </button>

            {userMenuOpen && (
              <div
                role="menu"
                className="animate-pop-in absolute right-0 top-[calc(100%+8px)] w-64 overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-[0_16px_40px_-8px_rgba(15,23,42,0.18)]"
              >
                <div className="border-b border-[#F1F5F9] px-4 py-3">
                  <p className="truncate-text text-sm font-semibold text-[#0F172A]">{displayName}</p>
                  {user.email && user.email !== displayName && (
                    <p className="truncate-text text-xs text-[#64748B]" title={user.email}>{user.email}</p>
                  )}
                  {isApprover && (
                    <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-[#EFF6FF] px-2 py-0.5 text-[10px] font-semibold text-[#1D4ED8]">
                      <ShieldCheck className="h-3 w-3" aria-hidden="true" /> Procurement approver
                    </span>
                  )}
                </div>
                <div className="p-1.5">
                  <Link
                    to="/settings"
                    role="menuitem"
                    className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-[#334155] transition-colors hover:bg-[#F1F5F9] hover:text-[#0F172A]"
                  >
                    <Settings className="h-4 w-4 text-[#64748B]" aria-hidden="true" />
                    Settings
                  </Link>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={handleSignOut}
                    disabled={signingOut}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-[#B91C1C] transition-colors hover:bg-[#FEF2F2] disabled:opacity-50"
                  >
                    <LogOut className="h-4 w-4" aria-hidden="true" />
                    {signingOut ? 'Signing out…' : 'Sign out'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  )
}
