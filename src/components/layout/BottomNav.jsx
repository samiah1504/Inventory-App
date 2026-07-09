import { NavLink, useLocation } from 'react-router-dom'
import {
  Home, ShoppingCart, Package, BarChart3, Settings,
  Truck, Warehouse, Users, FileText, ClipboardList
} from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'

const NAV_CONFIG = {
  ceo: [
    { to: '/', icon: Home, label: 'Home' },
    { to: '/orders', icon: ShoppingCart, label: 'Orders' },
    { to: '/inventory', icon: Package, label: 'Inventory' },
    { to: '/waybill', icon: Truck, label: 'Waybill' },
    { to: '/reports', icon: BarChart3, label: 'Reports' },
    { to: '/settings', icon: Settings, label: 'Settings' },
  ],
  super_admin: [
    { to: '/', icon: Home, label: 'Home' },
    { to: '/orders', icon: ShoppingCart, label: 'Orders' },
    { to: '/inventory', icon: Package, label: 'Inventory' },
    { to: '/waybill', icon: Truck, label: 'Waybill' },
    { to: '/reports', icon: BarChart3, label: 'Reports' },
    { to: '/settings', icon: Settings, label: 'Settings' },
  ],
  operations_manager: [
    { to: '/', icon: Home, label: 'Home' },
    { to: '/orders', icon: ShoppingCart, label: 'Orders' },
    { to: '/inventory', icon: Package, label: 'Inventory' },
    { to: '/waybill', icon: Truck, label: 'Waybill' },
    { to: '/fulfillment', icon: Warehouse, label: 'Fulfillment' },
    { to: '/settings', icon: Settings, label: 'Settings' },
  ],
  customer_support: [
    { to: '/', icon: Home, label: 'Home' },
    { to: '/orders/new', icon: ShoppingCart, label: 'New Order', end: true },
    { to: '/orders', icon: ClipboardList, label: 'My Orders', end: true },
    { to: '/customers', icon: Users, label: 'Customers' },
    { to: '/settings', icon: Settings, label: 'Settings' },
  ],
  fulfillment: [
    { to: '/', icon: Home, label: 'Home' },
    { to: '/fulfillment', icon: Truck, label: 'Fulfillment' },
    { to: '/orders', icon: ShoppingCart, label: 'Orders' },
    { to: '/settings', icon: Settings, label: 'Settings' },
  ],
  waybill: [
    { to: '/', icon: Home, label: 'Home' },
    { to: '/waybill', icon: Truck, label: 'Waybill' },
    { to: '/orders', icon: ShoppingCart, label: 'Orders' },
    { to: '/settings', icon: Settings, label: 'Settings' },
  ],
  inventory: [
    { to: '/', icon: Home, label: 'Home' },
    { to: '/inventory', icon: Package, label: 'Inventory' },
    { to: '/customers', icon: Users, label: 'Customers' },
    { to: '/settings', icon: Settings, label: 'Settings' },
  ],
}

export function BottomNav() {
  const { user } = useAuthStore()
  const role = user?.role || 'customer_support'
  const navItems = NAV_CONFIG[role] || NAV_CONFIG.customer_support

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-40 safe-area-bottom">
      <div className="flex items-center justify-around px-1 pt-1 pb-2 max-w-lg mx-auto">
        {navItems.map(({ to, icon: Icon, label, end: endProp }) => (
          <NavLink
            key={to}
            to={to}
            end={endProp ?? to === '/'}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 px-1.5 py-1.5 rounded-xl min-w-[48px] flex-1 max-w-[72px] transition-all ${
                isActive
                  ? 'text-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <div className={`p-1.5 rounded-xl transition-colors ${isActive ? 'bg-blue-50' : ''}`}>
                  <Icon size={22} />
                </div>
                <span className={`text-[10px] font-medium ${isActive ? 'text-blue-600' : 'text-gray-500'}`}>
                  {label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
