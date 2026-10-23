import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

export function AppShell() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  return (
    <div className="flex h-screen overflow-hidden bg-[#F8FAFC] text-[#0F172A]">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(c => !c)}
      />
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        <TopBar />
        <main
          className="flex-1 overflow-y-auto"
          id="main-content"
          tabIndex={-1}
          aria-label="Main content"
        >
          <div className="mx-auto max-w-[1600px] w-full p-4 sm:p-6 lg:p-8 animate-page-enter">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
