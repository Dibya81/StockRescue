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
  Workflow,
  Settings,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  to: string
  icon: LucideIcon
  label: string
  /** Title shown in the top bar breadcrumb */
  title: string
}

export interface NavSection {
  label: string
  items: NavItem[]
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Operations',
    items: [
      { to: '/',          icon: LayoutDashboard, label: 'Dashboard', title: 'Dashboard' },
      { to: '/warehouse', icon: Warehouse,       label: 'Warehouse', title: '3D Warehouse' },
      { to: '/inventory', icon: Package,         label: 'Inventory', title: 'Inventory Catalog' },
    ],
  },
  {
    label: 'Response',
    items: [
      { to: '/disruptions', icon: AlertTriangle, label: 'Disruptions', title: 'Disruptions' },
      { to: '/recovery',    icon: FileText,      label: 'Recovery',    title: 'Recovery Plans' },
      { to: '/approvals',   icon: ShieldCheck,   label: 'Approvals',   title: 'Procurement Approvals' },
      { to: '/deliveries',  icon: Activity,      label: 'Deliveries',  title: 'Deliveries Watch' },
    ],
  },
  {
    label: 'Network',
    items: [
      { to: '/suppliers',      icon: Truck,         label: 'Suppliers',      title: 'Suppliers & Sourcing' },
      { to: '/communications', icon: MessageSquare, label: 'Communications', title: 'Vendor Communications' },
      { to: '/simulation',     icon: Workflow,      label: 'Live Simulation', title: 'Live Multi-Agent Simulation' },
      { to: '/agents',         icon: Bot,           label: 'Agents',         title: 'Agent Operations' },
    ],
  },
]

export const SETTINGS_ITEM: NavItem = {
  to: '/settings', icon: Settings, label: 'Settings', title: 'System Settings',
}

const EXTRA_TITLES: Record<string, string> = {
  '/disruptions/new': 'New Case Intake',
}

export function isNavItemActive(to: string, pathname: string): boolean {
  return to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`)
}

/** Resolves the section + page title for a pathname, for breadcrumbs. */
export function resolveRoute(pathname: string): { section: string | null; title: string } {
  if (EXTRA_TITLES[pathname]) return { section: 'Response', title: EXTRA_TITLES[pathname] }
  for (const section of NAV_SECTIONS) {
    const item = section.items.find(i => isNavItemActive(i.to, pathname))
    if (item) return { section: section.label, title: item.title }
  }
  if (isNavItemActive(SETTINGS_ITEM.to, pathname)) return { section: null, title: SETTINGS_ITEM.title }
  return { section: null, title: 'Dashboard' }
}
