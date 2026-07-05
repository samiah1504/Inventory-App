import { Outlet } from 'react-router-dom'
import { BottomNav } from './BottomNav'
import { Toast } from '../ui/Toast'

export function AppShell() {
  return (
    <div className="min-h-svh flex flex-col bg-white max-w-lg mx-auto w-full overflow-x-hidden">
      <Toast />
      <main className="flex-1 pb-20 overflow-hidden w-full">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
