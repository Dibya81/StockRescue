import { useRef, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { clsx } from 'clsx'
import {
  LayoutDashboard,
  Warehouse,
  Package,
  AlertTriangle,
  Truck,
  FileText,
  ShieldCheck,
  MessageSquare,
  Activity,
  Bot,
  Settings,
  ChevronLeft,
  ChevronRight,
  Zap,
} from 'lucide-react'

const NAV_ITEMS = [
  { to: '/',              icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/warehouse',     icon: Warehouse,        label: 'Warehouse' },
  { to: '/inventory',     icon: Package,          label: 'Inventory' },
  { to: '/disruptions',   icon: AlertTriangle,    label: 'Disruptions' },
  { to: '/suppliers',     icon: Truck,            label: 'Suppliers' },
  { to: '/recovery',      icon: FileText,         label: 'Recovery' },
  { to: '/approvals',     icon: ShieldCheck,      label: 'Approvals' },
  { to: '/communications',icon: MessageSquare,    label: 'Communications' },
  { to: '/deliveries',    icon: Activity,         label: 'Deliveries' },
  { to: '/agents',        icon: Bot,              label: 'Agents' },
  { to: '/settings',      icon: Settings,         label: 'Settings' },
]

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const navigate = useNavigate()
  const toggleRef = useRef<HTMLButtonElement>(null)

  // Keyboard shortcut: Ctrl+B / Cmd+B toggles sidebar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        onToggle()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onToggle])

  return (
    <aside
      className={clsx(
        'relative flex h-full flex-col border-r border-[#E2E8F0] bg-[#FFFFFF] text-[#475569] transition-[width] duration-200 ease-in-out select-none z-20 shadow-sm',
        collapsed ? 'w-[72px]' : 'w-[240px]',
      )}
      aria-label="Main navigation"
    >
      {/* Brand Header */}
      <div
        className={clsx(
          'flex h-[56px] items-center border-b border-[#E2E8F0] px-4',
          collapsed ? 'justify-center px-0' : 'gap-3',
        )}
      >
        <button
          type="button"
          onClick={() => navigate('/')}
          className="flex items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
          aria-label="StockRescue home"
        >
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[#EFF6FF] border border-[#2563EB]/25 text-[#2563EB] shadow-sm transition-transform hover:scale-105">
            <Zap className="h-4 w-4" aria-hidden="true" />
          </div>
          {!collapsed && (
            <div className="flex flex-col text-left">
              <span className="font-bold text-sm tracking-tight text-[#0F172A]">
                StockRescue
              </span>
              <span className="text-[10px] font-semibold tracking-wider text-[#2563EB] uppercase">
                Command Center
              </span>
            </div>
          )}
        </button>
      </div>

      {/* Nav items */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3" aria-label="Sidebar navigation">
        <ul className="flex flex-col gap-1 px-2.5" role="list">
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
            <li key={to} className="relative">
              <NavLink
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  clsx(
                    'group flex items-center gap-3 rounded-lg py-2.5 text-sm font-medium transition-all duration-150',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]',
                    isActive
                      ? 'bg-[#EFF6FF] text-[#2563EB] font-semibold shadow-xs'
                      : 'text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A]',
                    collapsed ? 'justify-center px-0' : 'px-3',
                  )
                }
                title={collapsed ? label : undefined}
                aria-label={collapsed ? label : undefined}
              >
                {({ isActive }) => (
                  <>
                    {/* Active indicator bar on left */}
                    {isActive && (
                      <span
                        className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-full bg-[#2563EB]"
                        aria-hidden="true"
                      />
                    )}
                    <Icon
                      className={clsx(
                        'h-4 w-4 flex-shrink-0 transition-colors',
                        isActive ? 'text-[#2563EB]' : 'text-[#64748B] group-hover:text-[#0F172A]',
                      )}
                      aria-hidden="true"
                    />
                    {!collapsed && (
                      <span className="truncate-text">{label}</span>
                    )}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* Collapse toggle */}
      <div className="border-t border-[#E2E8F0] p-2.5">
        <button
          ref={toggleRef}
          type="button"
          onClick={onToggle}
          className={clsx(
            'flex w-full items-center gap-2.5 rounded-lg py-2 text-xs font-medium text-[#64748B]',
            'transition-colors hover:bg-[#F1F5F9] hover:text-[#0F172A]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]',
            collapsed ? 'justify-center px-0' : 'px-3',
          )}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar (Ctrl+B)' : 'Collapse sidebar (Ctrl+B)'}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          ) : (
            <>
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              <span className="flex-1 text-left">Collapse</span>
              <kbd className="rounded border border-[#E2E8F0] bg-[#F1F5F9] px-1.5 py-0.5 text-[10px] text-[#64748B] font-mono">
                Ctrl+B
              </kbd>
            </>
          )}
        </button>
      </div>
    </aside>
  )
}
