import { useAuthStore } from '../../stores/authStore'
import { CeoDashboard } from './CeoDashboard'
import { FulfillmentDashboard } from './FulfillmentDashboard'
import { CustomerSupportDashboard } from './CustomerSupportDashboard'
import { WaybillDashboard } from './WaybillDashboard'
import { InventoryDashboard } from './InventoryDashboard'
import { OperationsManagerDashboard } from './OperationsManagerDashboard'

export function DashboardPage() {
  const { user } = useAuthStore()
  const role = user?.role

  if (role === 'ceo' || role === 'super_admin') return <CeoDashboard />
  if (role === 'operations_manager') return <OperationsManagerDashboard />
  if (role === 'fulfillment') return <FulfillmentDashboard />
  if (role === 'waybill') return <WaybillDashboard />
  if (role === 'inventory') return <InventoryDashboard />
  return <CustomerSupportDashboard />
}
