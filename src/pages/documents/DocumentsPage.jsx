import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Download } from 'lucide-react'
import { useOrders } from '../../hooks/useOrders'
import { TopBar } from '../../components/layout/TopBar'
import { SearchBar } from '../../components/ui/SearchBar'
import { SkeletonList } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'
import { StatusBadge } from '../../components/ui/Badge'
import { formatCurrency, formatDate } from '../../utils/format'
import { generateInvoice, generateReceipt, generateDeliveryNote, savePdf } from '../../lib/pdf'

export function DocumentsPage() {
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState('invoices')
  const navigate = useNavigate()

  const statusFilter = activeTab === 'receipts'
    ? 'paid'
    : undefined

  const { data: orders, isLoading } = useOrders({
    search: search || undefined,
    status: statusFilter,
    limit: 100,
  })

  function handleDoc(type, order) {
    const business = order.business
    let doc
    if (type === 'invoice') doc = generateInvoice(order, business)
    else if (type === 'receipt') doc = generateReceipt(order, business)
    else doc = generateDeliveryNote(order, business)
    savePdf(doc, `${type}-${order.order_number}.pdf`)
  }

  const displayOrders = orders || []

  return (
    <div className="flex flex-col h-full">
      <TopBar title="Documents" back={false} />
      <div className="bg-white border-b border-gray-100 px-4 pt-3 pb-2 space-y-2 sticky top-[57px] z-20">
        <SearchBar value={search} onChange={setSearch} placeholder="Search by order number, customer..." />
        <div className="flex gap-2">
          {['invoices', 'receipts', 'delivery_notes'].map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium capitalize ${activeTab === tab ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
              {tab.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {isLoading ? <SkeletonList count={5} /> : (
          displayOrders.length === 0 ? (
            <EmptyState icon={<FileText size={28} />} title="No documents" />
          ) : (
            displayOrders.map(order => (
              <div key={order.id} className="bg-white rounded-2xl p-4 border border-gray-100">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex-1 min-w-0" onClick={() => navigate(`/orders/${order.id}`)}>
                    <span className="text-xs font-mono text-gray-400">{order.order_number}</span>
                    <p className="text-sm font-semibold text-gray-900">{order.customer_name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <StatusBadge status={order.status} />
                      <span className="text-xs text-gray-500">{formatDate(order.created_at)}</span>
                    </div>
                  </div>
                  <p className="text-sm font-bold text-gray-900 shrink-0">{formatCurrency(order.total_amount)}</p>
                </div>
                <div className="flex gap-2">
                  {activeTab === 'invoices' && (
                    <button onClick={() => handleDoc('invoice', order)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-blue-700 bg-blue-50 rounded-xl active:scale-95 transition-all">
                      <Download size={14} /> Invoice
                    </button>
                  )}
                  {activeTab === 'receipts' && (
                    <button onClick={() => handleDoc('receipt', order)}
                      disabled={order.status !== 'paid'}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-green-700 bg-green-50 rounded-xl active:scale-95 transition-all disabled:opacity-40">
                      <Download size={14} /> Receipt
                    </button>
                  )}
                  {activeTab === 'delivery_notes' && (
                    <button onClick={() => handleDoc('delivery', order)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-purple-700 bg-purple-50 rounded-xl active:scale-95 transition-all">
                      <Download size={14} /> Delivery Note
                    </button>
                  )}
                </div>
              </div>
            ))
          )
        )}
      </div>
    </div>
  )
}
