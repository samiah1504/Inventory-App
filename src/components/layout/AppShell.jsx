import { Outlet, useLocation } from 'react-router-dom'
import { BottomNav, isWideRoute } from './BottomNav'
import { Toast } from '../ui/Toast'
import { RolePreviewBanner } from '../ui/RolePreviewBanner'

export function AppShell() {
  // Inventory uses the full desktop width (with a left rail on large
  // screens); every other page keeps the phone-width column
  const wide = isWideRoute(useLocation().pathname)
  return (
    <div className={`min-h-svh flex flex-col w-full overflow-x-hidden ${
      wide ? 'bg-[#FAF8F5] lg:pl-[84px]' : 'bg-white max-w-lg mx-auto'}`}>
      <Toast />
      <main className={`flex-1 pb-20 overflow-hidden w-full ${wide ? 'lg:pb-0' : ''}`}>
        <Outlet />
      </main>
      <RolePreviewBanner />
      <BottomNav />
    </div>
  )
}
