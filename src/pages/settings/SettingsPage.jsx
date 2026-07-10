import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, Users, Package, Warehouse, ChevronRight, LogOut, AlertCircle, Bell, DollarSign, CalendarDays, Eye } from 'lucide-react'
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

const PREVIEW_ROLES = [
  { role: 'operations_manager', label: 'Operations Manager' },
  { role: 'customer_support',   label: 'Customer Support' },
  { role: 'fulfillment',        label: 'Fulfillment Officer' },
  { role: 'waybill',            label: 'Waybill Officer' },
  { role: 'inventory',          label: 'Inventory / Warehouse' },
]

export function SettingsPage() {
  const { user, logout, startPreview } = useAuthStore()
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

        {/* Role preview — see the app exactly as each role does */}
        <div className="bg-white rounded-2xl p-4 border border-gray-100">
          <div className="flex items-center gap-2 mb-1">
            <Eye size={16} className="text-gray-500" />
            <h3 className="text-sm font-semibold text-gray-900">Preview Role Views</h3>
          </div>
          <p className="text-xs text-gray-400 mb-3">
            See the app exactly as each role sees it. Your CEO account and permissions stay unchanged — use the banner to return.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {PREVIEW_ROLES.map(({ role, label }) => (
              <button
                key={role}
                onClick={() => { startPreview(role); navigate('/') }}
                className="px-3 py-2.5 rounded-xl border border-gray-200 bg-white text-left text-sm font-medium text-gray-700 active:scale-[0.98] transition-all"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

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
          <p className="text-[11px] text-gray-400 text-center mt-3">
            App version: {new Date(__BUILD_TIME__).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </p>
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
          <p className="text-[11px] text-gray-400 text-center mt-3">
            App version: {new Date(__BUILD_TIME__).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </p>
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
              onClick={() => navigate('/settings/products')}
              className="w-full flex items-center gap-3 bg-white rounded-2xl p-4 border border-gray-100 active:scale-[0.99] transition-all"
            >
              <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600 shrink-0">
                <Package size={20} />
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className="text-sm font-semibold text-gray-900">Products</p>
                <p className="text-xs text-gray-500">Verify, edit, merge and manage the catalogue</p>
              </div>
              <ChevronRight size={18} className="text-gray-400 shrink-0" />
            </button>
            <button
              onClick={() => navigate('/settings/warehouses')}
              className="w-full flex items-center gap-3 bg-white rounded-2xl p-4 border border-gray-100 active:scale-[0.99] transition-all"
            >
              <div className="w-10 h-10 bg-orange-50 rounded-xl flex items-center justify-center text-orange-600 shrink-0">
                <Warehouse size={20} />
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className="text-sm font-semibold text-gray-900">Warehouses</p>
                <p className="text-xs text-gray-500">Add, edit and deactivate warehouses</p>
              </div>
              <ChevronRight size={18} className="text-gray-400 shrink-0" />
            </button>
            <button
              onClick={() => navigate('/my-expenses')}
              className="w-full flex items-center gap-3 bg-white rounded-2xl p-4 border border-gray-100 active:scale-[0.99] transition-all"
            >
              <div className="w-10 h-10 bg-teal-50 rounded-xl flex items-center justify-center text-teal-600 shrink-0">
                <DollarSign size={20} />
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className="text-sm font-semibold text-gray-900">My Expenses</p>
                <p className="text-xs text-gray-500">Record expenses you personally incur</p>
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
