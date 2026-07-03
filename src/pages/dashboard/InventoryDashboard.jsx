import { useNavigate } from 'react-router-dom'
import { Package, AlertTriangle, ArrowRightLeft } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useInventory } from '../../hooks/useInventory'
import { StatCard } from '../../components/ui/Card'

export function InventoryDashboard() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const { data: inventory } = useInventory()
  const { data: lowStock } = useInventory({ low_stock: true })

  const totalItems = inventory?.length || 0
  const lowStockCount = lowStock?.length || 0

  return (
    <div className="overflow-y-auto h-full">
      <div className="bg-blue-600 text-white px-4 pt-12 pb-6">
        <p className="text-blue-200 text-sm">Inventory Dashboard</p>
        <h1 className="text-2xl font-bold">{user?.name}</h1>
      </div>
      <div className="px-4 -mt-4 space-y-4 pb-6">
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Stock Lines" value={totalItems} icon={<Package size={20} />} color="blue"
            onClick={() => navigate('/inventory')} />
          <StatCard label="Low Stock" value={lowStockCount} icon={<AlertTriangle size={20} />} color="red"
            onClick={() => navigate('/inventory?filter=low_stock')} />
        </div>
        <button onClick={() => navigate('/inventory/receive')}
          className="w-full py-3.5 bg-blue-600 text-white rounded-2xl font-semibold text-sm active:scale-95 transition-all">
          Add Received Stock
        </button>
        <button onClick={() => navigate('/inventory/transfers')}
          className="w-full py-3.5 bg-gray-100 text-gray-700 rounded-2xl font-semibold text-sm active:scale-95 transition-all flex items-center justify-center gap-2">
          <ArrowRightLeft size={16} /> Warehouse Transfers
        </button>
        <button onClick={logout} className="w-full py-3 text-sm text-red-600 font-medium">Sign Out</button>
      </div>
    </div>
  )
}
