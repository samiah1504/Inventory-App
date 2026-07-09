import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, Users, Package, Warehouse, ChevronRight, LogOut, AlertCircle, Bell, DollarSign, CalendarDays } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useBusinesses, useWarehouses } from '../../hooks/useBusinesses'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { TopBar } from '../../components/layout/TopBar'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { Input, Select, Textarea } from '../../components/ui/Input'
import { useAppStore } from '../../stores/appStore'
import { NIGERIAN_STATES } from '../../utils/format'

export function SettingsPage() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const isCeo = ['ceo', 'super_admin'].includes(user?.role)

  if (!isCeo) return <NonAdminSettings user={user} logout={logout} />

  return (
    <div className="flex flex-col h-full overflow-x-hidden w-full">
      <TopBar title="Settings" back={false} />
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-3">

        {/* Admin sections */}
        {[
          { label: 'Businesses', icon: Building2, to: '/settings/businesses', sub: 'Manage business units' },
          { label: 'Staff Management', icon: Users, to: '/settings/staff', sub: 'Add, edit, deactivate staff' },
          { label: 'Products', icon: Package, to: '/settings/products', sub: 'Manage products & categories' },
          { label: 'Warehouses', icon: Warehouse, to: '/settings/warehouses', sub: 'Add and manage warehouses' },
          { label: 'Expenses', icon: AlertCircle, to: '/accounting', sub: 'Admin-only expense tracking' },
          { label: 'Alerts', icon: Bell, to: '/settings/alerts', sub: 'Configure alert thresholds' },
          { label: 'My Leave', icon: CalendarDays, to: '/settings/leave', sub: 'Apply for and track your leave' },
        ].map(({ label, icon: Icon, to, sub }) => (
          <button
            key={label}
            onClick={() => navigate(to)}
            className="w-full flex items-center gap-3 bg-white rounded-2xl p-4 border border-gray-100 active:scale-[0.99] transition-all"
          >
            <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600 shrink-0">
              <Icon size={20} />
            </div>
            <div className="flex-1 text-left min-w-0">
              <p className="text-sm font-semibold text-gray-900">{label}</p>
              <p className="text-xs text-gray-500">{sub}</p>
            </div>
            <ChevronRight size={18} className="text-gray-400 shrink-0" />
          </button>
        ))}

        <div className="bg-white rounded-2xl p-4 border border-gray-100">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-gray-600 font-bold text-sm">
              {user?.name?.[0]}
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">{user?.name}</p>
              <p className="text-xs text-gray-500">@{user?.username} · {user?.role} · {user?.staff_code}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="w-full py-2.5 text-sm font-medium text-red-600 bg-red-50 rounded-xl active:scale-95 transition-all flex items-center justify-center gap-2"
          >
            <LogOut size={16} /> Sign Out
          </button>
        </div>
      </div>
    </div>
  )
}

function NonAdminSettings({ user, logout }) {
  const navigate = useNavigate()
  const isOpsManager = user?.role === 'operations_manager'

  return (
    <div className="flex flex-col h-full overflow-x-hidden w-full">
      <TopBar title="Settings" back={false} />
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-3">
        {/* Profile card */}
        <div className="bg-white rounded-2xl p-4 border border-gray-100">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold text-lg">
              {user?.name?.[0]}
            </div>
            <div>
              <p className="text-base font-bold text-gray-900">{user?.name}</p>
              <p className="text-sm text-gray-500 capitalize">@{user?.username} · {user?.role?.replace(/_/g, ' ')} · {user?.staff_code}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="w-full py-3 text-sm font-medium text-red-600 bg-red-50 rounded-xl active:scale-95 transition-all flex items-center justify-center gap-2"
          >
            <LogOut size={16} /> Sign Out
          </button>
        </div>

        {/* Leave self-service for all staff */}
        <button
          onClick={() => navigate('/settings/leave')}
          className="w-full flex items-center gap-3 bg-white rounded-2xl p-4 border border-gray-100 active:scale-[0.99] transition-all"
        >
          <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600 shrink-0">
            <CalendarDays size={20} />
          </div>
          <div className="flex-1 text-left min-w-0">
            <p className="text-sm font-semibold text-gray-900">My Leave</p>
            <p className="text-xs text-gray-500">Apply for and track your leave</p>
          </div>
          <ChevronRight size={18} className="text-gray-400 shrink-0" />
        </button>

        {/* Ops Manager gets access to alert config and accounting */}
        {isOpsManager && (
          <>
            <button
              onClick={() => navigate('/accounting')}
              className="w-full flex items-center gap-3 bg-white rounded-2xl p-4 border border-gray-100 active:scale-[0.99] transition-all"
            >
              <div className="w-10 h-10 bg-teal-50 rounded-xl flex items-center justify-center text-teal-600 shrink-0">
                <DollarSign size={20} />
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className="text-sm font-semibold text-gray-900">Accounting</p>
                <p className="text-xs text-gray-500">Log operational expenses</p>
              </div>
              <ChevronRight size={18} className="text-gray-400 shrink-0" />
            </button>
            <button
              onClick={() => navigate('/settings/alerts')}
              className="w-full flex items-center gap-3 bg-white rounded-2xl p-4 border border-gray-100 active:scale-[0.99] transition-all"
            >
              <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center text-amber-600 shrink-0">
                <Bell size={20} />
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className="text-sm font-semibold text-gray-900">Alert Thresholds</p>
                <p className="text-xs text-gray-500">Configure order stale/delay alerts</p>
              </div>
              <ChevronRight size={18} className="text-gray-400 shrink-0" />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
