import { Outlet } from 'react-router-dom'
import { BottomNav } from './BottomNav'
import { Toast } from '../ui/Toast'

export function AppShell() {
  return (
    <div className="min-h-svh flex flex-col bg-white max-w-lg mx-auto">
      <Toast />
      <main className="flex-1 pb-20 overflow-hidden">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
