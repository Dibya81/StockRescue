import { useCallback, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { useMediaQuery } from '@/hooks/useMediaQuery'

const COLLAPSE_KEY = 'stockrescue_sidebar_collapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

export function AppShell() {
  const { pathname } = useLocation()
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readCollapsed)
  const [mobileOpen, setMobileOpen] = useState(false)

  const toggleCollapsed = useCallback(() => {
    setSidebarCollapsed(c => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1')
      } catch {
        // storage unavailable: keep in-memory state only
      }
      return !c
    })
  }, [])
  const closeMobile = useCallback(() => setMobileOpen(false), [])

  // Close the drawer when navigating or growing to desktop
  const [drawerKey, setDrawerKey] = useState(`${pathname}|${isDesktop}`)
  if (drawerKey !== `${pathname}|${isDesktop}`) {
    setDrawerKey(`${pathname}|${isDesktop}`)
    setMobileOpen(false)
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#F8FAFC] text-[#0F172A]">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={isDesktop ? toggleCollapsed : closeMobile}
        isDesktop={isDesktop}
        mobileOpen={mobileOpen}
        onMobileClose={closeMobile}
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar
          showMenuButton={!isDesktop}
          menuOpen={mobileOpen}
          onMenuClick={() => setMobileOpen(true)}
        />
        <main
          className="flex-1 overflow-y-auto"
          id="main-content"
          tabIndex={-1}
          aria-label="Main content"
        >
          {/* Keyed by route so every navigation replays the enter transition */}
          <div key={pathname} className="animate-page-enter mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
