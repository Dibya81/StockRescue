import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { clsx } from 'clsx'
import { ChevronsLeft, X, Zap } from 'lucide-react'
import {
  NAV_SECTIONS,
  SETTINGS_ITEM,
  isNavItemActive,
  type NavItem,
} from './navigation'

interface SidebarProps {
  /** Icon-only rail. Only honoured on desktop. */
  collapsed: boolean
  onToggle: () => void
  isDesktop: boolean
  mobileOpen: boolean
  onMobileClose: () => void
}

interface IndicatorBox {
  top: number
  height: number
}

interface TooltipState {
  label: string
  top: number
  left: number
}

const ALL_ITEMS = [...NAV_SECTIONS.flatMap(s => s.items), SETTINGS_ITEM]

export function Sidebar({ collapsed, onToggle, isDesktop, mobileOpen, onMobileClose }: SidebarProps) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const rail = collapsed && isDesktop

  const listRef = useRef<HTMLDivElement>(null)
  const linkRefs = useRef(new Map<string, HTMLAnchorElement>())
  const [indicator, setIndicator] = useState<IndicatorBox | null>(null)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  const activeItem = ALL_ITEMS.find(i => isNavItemActive(i.to, pathname))

  // Slide the active pill to the current route's link
  const measure = useCallback(() => {
    const link = activeItem && activeItem !== SETTINGS_ITEM ? linkRefs.current.get(activeItem.to) : undefined
    const list = listRef.current
    if (!link || !list) {
      setIndicator(null)
      return
    }
    // Rect delta rather than offsetTop: the animated <li> wrappers change the offsetParent chain
    const linkRect = link.getBoundingClientRect()
    setIndicator({ top: linkRect.top - list.getBoundingClientRect().top, height: linkRect.height })
  }, [activeItem])

  useLayoutEffect(measure, [measure, rail])

  useEffect(() => {
    const el = listRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure])

  // Ctrl/Cmd+B toggles the rail on desktop
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

  // Escape closes the mobile drawer
  useEffect(() => {
    if (isDesktop || !mobileOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onMobileClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isDesktop, mobileOpen, onMobileClose])

  const showTooltip = (label: string, el: HTMLElement) => {
    if (!rail) return
    const r = el.getBoundingClientRect()
    setTooltip({ label, top: r.top + r.height / 2, left: r.right + 10 })
  }
  const hideTooltip = () => setTooltip(null)

  let itemIndex = 0
  const renderItem = (item: NavItem, inList: boolean) => {
    const { to, icon: Icon, label } = item
    const isActive = isNavItemActive(to, pathname)
    const delay = itemIndex++ * 28
    return (
      <li key={to} className="animate-nav-item" style={{ animationDelay: `${delay}ms` }}>
        <NavLink
          ref={el => {
            if (!inList) return
            if (el) linkRefs.current.set(to, el)
            else linkRefs.current.delete(to)
          }}
          to={to}
          end={to === '/'}
          onClick={() => {
            hideTooltip()
            if (!isDesktop) onMobileClose()
          }}
          onMouseEnter={e => showTooltip(label, e.currentTarget)}
          onMouseLeave={hideTooltip}
          onFocus={e => showTooltip(label, e.currentTarget)}
          onBlur={hideTooltip}
          aria-label={rail ? label : undefined}
          className={clsx(
            'group relative z-[1] flex h-10 items-center gap-3 rounded-lg text-sm transition-colors duration-200',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]',
            rail ? 'justify-center px-0' : 'px-3',
            isActive
              ? 'font-semibold text-[#1D4ED8]'
              : 'font-medium text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A]',
            // Settings sits outside the indicator container, so it carries its own active fill
            isActive && !inList && 'bg-[#EFF6FF]',
          )}
        >
          <Icon
            className={clsx(
              'h-[18px] w-[18px] flex-shrink-0 transition-transform duration-200 ease-out',
              isActive ? 'text-[#2563EB]' : 'text-[#64748B] group-hover:scale-110 group-hover:text-[#0F172A]',
            )}
            aria-hidden="true"
          />
          <span
            className={clsx(
              'truncate-text transition-[opacity,transform] duration-200 ease-out',
              rail ? 'pointer-events-none absolute -translate-x-1 opacity-0' : 'translate-x-0 opacity-100',
            )}
          >
            {label}
          </span>
        </NavLink>
      </li>
    )
  }

  return (
    <>
      {/* Mobile backdrop */}
      {!isDesktop && mobileOpen && (
        <div
          className="animate-fade-in fixed inset-0 z-30 bg-[#0F172A]/40 backdrop-blur-[2px]"
          onClick={onMobileClose}
          aria-hidden="true"
        />
      )}

      <aside
        id="app-sidebar"
        className={clsx(
          'flex h-full flex-shrink-0 flex-col border-r border-[#E2E8F0] bg-white text-[#475569] select-none',
          'transition-[width,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
          isDesktop
            ? clsx('relative z-20', rail ? 'w-[72px]' : 'w-[248px]')
            : clsx(
                'fixed inset-y-0 left-0 z-40 w-[272px] shadow-2xl',
                mobileOpen ? 'translate-x-0' : '-translate-x-full',
              ),
        )}
        aria-label="Main navigation"
        inert={!isDesktop && !mobileOpen ? true : undefined}
      >
        {/* Brand */}
        <div className={clsx('flex h-14 flex-shrink-0 items-center border-b border-[#E2E8F0]', rail ? 'justify-center' : 'justify-between px-4')}>
          <button
            type="button"
            onClick={() => {
              navigate('/')
              if (!isDesktop) onMobileClose()
            }}
            className="group flex min-w-0 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
            aria-label="StockRescue home"
          >
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-[#2563EB] to-[#1E40AF] text-white shadow-[0_4px_12px_rgba(37,99,235,0.35)] transition-transform duration-300 ease-out group-hover:rotate-[-8deg] group-hover:scale-105">
              <Zap className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            {!rail && (
              <span className="animate-fade-in flex min-w-0 flex-col text-left leading-tight">
                <span className="truncate-text text-[15px] font-bold tracking-tight text-[#0F172A]">StockRescue</span>
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#64748B]">Command Center</span>
              </span>
            )}
          </button>
          {!isDesktop && (
            <button
              type="button"
              onClick={onMobileClose}
              className="rounded-lg p-1.5 text-[#64748B] transition-colors hover:bg-[#F1F5F9] hover:text-[#0F172A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
              aria-label="Close navigation"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-4" aria-label="Sidebar navigation">
          <div ref={listRef} className="relative">
            {indicator && (
              <span
                className="pointer-events-none absolute inset-x-0 top-0 rounded-lg bg-[#EFF6FF] ring-1 ring-inset ring-[#2563EB]/10 transition-[transform,height] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                style={{ transform: `translateY(${indicator.top}px)`, height: indicator.height }}
                aria-hidden="true"
              >
                <span className="absolute -left-3 top-2 bottom-2 w-[3px] rounded-r-full bg-[#2563EB]" />
              </span>
            )}

            {NAV_SECTIONS.map((section, si) => (
              <div key={section.label} className={clsx(si > 0 && 'mt-5')}>
                <div className="mb-1.5 flex h-4 items-center">
                  {rail ? (
                    <span className="mx-auto h-px w-6 bg-[#E2E8F0]" aria-hidden="true" />
                  ) : (
                    <span className="animate-fade-in px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#94A3B8]">
                      {section.label}
                    </span>
                  )}
                </div>
                <ul className="flex flex-col gap-0.5" role="list">
                  {section.items.map(item => renderItem(item, true))}
                </ul>
              </div>
            ))}
          </div>
        </nav>

        {/* Footer */}
        <div className="flex-shrink-0 border-t border-[#E2E8F0] p-3">
          <ul role="list">{renderItem(SETTINGS_ITEM, false)}</ul>
          {isDesktop && (
            <button
              type="button"
              onClick={onToggle}
              onMouseEnter={e => showTooltip('Expand · Ctrl+B', e.currentTarget)}
              onMouseLeave={hideTooltip}
              className={clsx(
                'mt-1 flex h-9 w-full items-center gap-3 rounded-lg text-xs font-medium text-[#64748B]',
                'transition-colors hover:bg-[#F1F5F9] hover:text-[#0F172A]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]',
                rail ? 'justify-center' : 'px-3',
              )}
              aria-label={rail ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!rail}
              aria-controls="app-sidebar"
            >
              <ChevronsLeft
                className={clsx('h-4 w-4 flex-shrink-0 transition-transform duration-300', rail && 'rotate-180')}
                aria-hidden="true"
              />
              {!rail && (
                <>
                  <span className="animate-fade-in flex-1 text-left">Collapse</span>
                  <kbd className="rounded border border-[#E2E8F0] bg-[#F8FAFC] px-1.5 py-0.5 font-mono text-[10px] text-[#64748B]">
                    Ctrl B
                  </kbd>
                </>
              )}
            </button>
          )}
        </div>
      </aside>

      {/* Rail tooltip, rendered outside the scroll container so it isn't clipped */}
      {rail && tooltip && (
        <div
          role="tooltip"
          className="animate-fade-in pointer-events-none fixed z-50 -translate-y-1/2 whitespace-nowrap rounded-md bg-[#0F172A] px-2.5 py-1.5 text-xs font-medium text-white shadow-lg"
          style={{ top: tooltip.top, left: tooltip.left }}
        >
          {tooltip.label}
        </div>
      )}
    </>
  )
}
