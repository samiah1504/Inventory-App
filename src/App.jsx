import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect } from 'react'
import { AppShell } from './components/layout/AppShell'
import { LoginPage } from './pages/auth/LoginPage'
import { DashboardPage } from './pages/dashboard/DashboardPage'
import { OrdersPage } from './pages/orders/OrdersPage'
import { NewOrderPage } from './pages/orders/NewOrderPage'
import { OrderDetailPage } from './pages/orders/OrderDetailPage'
import { FulfillmentPage } from './pages/orders/FulfillmentPage'
import { WaybillPage } from './pages/waybill/WaybillPage'
import { WaybillBatchDetailPage } from './pages/waybill/WaybillBatchDetailPage'
import { InventoryPage } from './pages/inventory/InventoryPage'
import { HoldingQueuePage } from './pages/holding/HoldingQueuePage'
import { CustomersPage } from './pages/customers/CustomersPage'
import { CustomerDetailPage } from './pages/customers/CustomerDetailPage'
import { ReportsPage } from './pages/reports/ReportsPage'
import { SettingsPage } from './pages/settings/SettingsPage'
import { StaffPage } from './pages/settings/StaffPage'
import { StaffDetailPage } from './pages/settings/StaffDetailPage'
import { MyLeavePage } from './pages/settings/MyLeavePage'
import { BusinessesPage } from './pages/settings/BusinessesPage'
import { WarehousesPage } from './pages/settings/WarehousesPage'
import { ProductsPage } from './pages/settings/ProductsPage'
import { AccountingPage } from './pages/accounting/AccountingPage'
import { SalesAnalyticsPage } from './pages/analytics/SalesAnalyticsPage'
import { DocumentsPage } from './pages/documents/DocumentsPage'
import { EditOrderPage } from './pages/orders/EditOrderPage'
import { AlertsPage } from './pages/settings/AlertsPage'
import { useAuthStore } from './stores/authStore'
import { useAppStore } from './stores/appStore'
import { getQueuedActions, removeQueuedAction } from './lib/offline'
import { supabase } from './lib/supabase'
import { PWAUpdateBanner } from './components/ui/PWAUpdateBanner'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30000,
    },
  },
})

function ProtectedRoute({ children }) {
  const { user } = useAuthStore()
  if (!user) return <Navigate to="/login" replace />
  return children
}

function AppInit() {
  const { setOnline, setOfflineQueueCount } = useAppStore()

  useEffect(() => {
    async function syncOfflineQueue() {
      const actions = await getQueuedActions()
      setOfflineQueueCount(actions.length)
      for (const action of actions) {
        try {
          if (action.type === 'update_order_status') {
            const { id, status, extra = {} } = action.payload
            await supabase.from('orders').update({ status, ...extra }).eq('id', id)
            await removeQueuedAction(action.id)
          }
        } catch {
          // Will retry on next online event
        }
      }
      setOfflineQueueCount(0)
      queryClient.invalidateQueries()
    }

    function handleOnline() {
      setOnline(true)
      syncOfflineQueue()
    }
    function handleOffline() {
      setOnline(false)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    setOnline(navigator.onLine)
    if (navigator.onLine) syncOfflineQueue()

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [setOnline, setOfflineQueueCount])

  return null
}

export default function App() {
  const { user } = useAuthStore()

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <PWAUpdateBanner />
        <AppInit />
        <Routes>
          <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
          <Route element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/orders/new" element={<NewOrderPage />} />
            <Route path="/orders/:id" element={<OrderDetailPage />} />
            <Route path="/fulfillment" element={<FulfillmentPage />} />
            <Route path="/waybill" element={<WaybillPage />} />
            <Route path="/waybill/batches/:id" element={<WaybillBatchDetailPage />} />
            <Route path="/inventory" element={<InventoryPage />} />
            <Route path="/holding" element={<HoldingQueuePage />} />
            <Route path="/customers" element={<CustomersPage />} />
            <Route path="/customers/:id" element={<CustomerDetailPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/documents" element={<DocumentsPage />} />
            <Route path="/accounting" element={<AccountingPage />} />
            <Route path="/analytics" element={<SalesAnalyticsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/settings/staff" element={<StaffPage />} />
            <Route path="/settings/staff/:id" element={<StaffDetailPage />} />
            <Route path="/settings/leave" element={<MyLeavePage />} />
            <Route path="/settings/businesses" element={<BusinessesPage />} />
            <Route path="/settings/warehouses" element={<WarehousesPage />} />
            <Route path="/settings/products" element={<ProductsPage />} />
            <Route path="/settings/alerts" element={<AlertsPage />} />
            <Route path="/orders/:id/edit" element={<EditOrderPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
