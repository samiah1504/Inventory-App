import { useState, useMemo } from 'react'
import { Navigate } from 'react-router-dom'
import { Trash2, AlertTriangle, Check } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { TopBar } from '../../components/layout/TopBar'
import { SearchBar } from '../../components/ui/SearchBar'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { Input, Select, Textarea } from '../../components/ui/Input'
import { SkeletonList } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'
import { StatusBadge } from '../../components/ui/Badge'
import { useAuthStore } from '../../stores/authStore'
import { useBusinesses } from '../../hooks/useBusinesses'
import { useAppStore } from '../../stores/appStore'
import { formatCurrency, formatDate, statusLabel, NIGERIAN_STATES } from '../../utils/format'
import { DELETE_REASONS, verifyPassword, collectDeletionReview, purgeOrder } from '../../lib/orderPurge'

const ALL_STATUSES = ['new', 'awaiting_waybill', 'waybilled', 'arrived_at_park', 'picked_up_from_park',
  'received_at_warehouse', 'processing', 'delivered', 'partially_paid', 'paid',
  'failed_delivery', 'cancelled', 'returned', 'sent_to_park']

export function DeleteOrdersPage() {
  const { user, realUser } = useAuthStore()
  const { data: businesses } = useBusinesses()
  const { showToast } = useAppStore()
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [bizFilter, setBizFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [selected, setSelected] = useState([])

  const [showReview, setShowReview] = useState(false)
  const [review, setReview] = useState(null)
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [deleteCustomer, setDeleteCustomer] = useState(false)
  const [password, setPassword] = useState('')
  const [phrase, setPhrase] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)

  // Hard gate: CEO / Super Admin only — and never inside a role preview
  const isCeo = ['ceo', 'super_admin'].includes(user?.role) && !user?._preview && !realUser

  // Audit table check — deletion works without it, but leaves no trail
  const auditCheckQ = useQuery({
    queryKey: ['order_delete_audit_check'],
    enabled: isCeo,
    retry: false,
    queryFn: async () => {
      const { error } = await supabase.from('deleted_order_audit').select('id').limit(1)
      return !error
    },
    staleTime: 30000,
  })
  const auditReady = auditCheckQ.data !== false

  const ordersQ = useQuery({
    queryKey: ['delete_orders_list', bizFilter, statusFilter, stateFilter, dateFrom, dateTo],
    enabled: isCeo,
    queryFn: async () => {
      let q = supabase.from('orders')
        .select('*, business:businesses(id, name)')
        .order('created_at', { ascending: false })
        .limit(300)
      if (bizFilter) q = q.eq('business_id', bizFilter)
      if (statusFilter) q = q.eq('status', statusFilter)
      if (stateFilter) q = q.eq('state', stateFilter)
      if (dateFrom) q = q.gte('created_at', `${dateFrom}T00:00:00`)
      if (dateTo) q = q.lte('created_at', `${dateTo}T23:59:59`)
      const { data, error } = await q
      if (error) throw error
      return data || []
    },
    staleTime: 15000,
  })

  const list = useMemo(() => {
    let l = ordersQ.data || []
    if (search) {
      const q = search.toLowerCase()
      l = l.filter(o =>
        (o.order_number || '').toLowerCase().includes(q) ||
        (o.customer_name || '').toLowerCase().includes(q) ||
        (o.customer_phone || '').includes(search) ||
        (o.product_name || '').toLowerCase().includes(q) ||
        (o.business?.name || '').toLowerCase().includes(q))
    }
    return l
  }, [ordersQ.data, search])

  if (!isCeo) return <Navigate to="/settings" replace />

  const selectedOrders = list.filter(o => selected.includes(o.id))
  const totalValue = selectedOrders.reduce((s, o) => s + Number(o.total_amount || 0), 0)
  const uniqueCustomers = [...new Set(selectedOrders.map(o => o.customer_phone || o.customer_name).filter(Boolean))]
  const requiredPhrase = selected.length === 1 ? 'DELETE ORDER' : `DELETE ${selected.length} ORDERS`
  const canDelete = reason && phrase.trim() === requiredPhrase && password && !running

  const toggle = (id) =>
    setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])

  async function openReview() {
    setReason(''); setNotes(''); setPassword(''); setPhrase(''); setDeleteCustomer(false); setResult(null)
    setShowReview(true)
    setReviewLoading(true)
    setReview(await collectDeletionReview(selectedOrders))
    setReviewLoading(false)
  }

  async function executeDelete() {
    setRunning(true)
    try {
      const ok = await verifyPassword(realUser || user, password)
      if (!ok) {
        showToast('Password incorrect — deletion blocked', 'error')
        setRunning(false)
        return
      }
      const warnings = []
      let deleted = 0
      for (const order of selectedOrders) {
        try {
          const r = await purgeOrder(order, { reason, notes, deleteCustomer }, user)
          warnings.push(...r.warnings)
          deleted++
        } catch (err) {
          warnings.push(err.message)
        }
      }
      queryClient.invalidateQueries()
      setSelected([])
      setResult({ deleted, warnings })
      showToast(`${deleted} order${deleted !== 1 ? 's' : ''} permanently deleted`, deleted > 0 ? 'success' : 'error')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-x-hidden w-full">
      <TopBar title="Delete Orders" />

      <div className="bg-white border-b border-gray-100 sticky top-[57px] z-20 px-4 pt-3 pb-2 space-y-2 w-full overflow-x-hidden">
        <SearchBar value={search} onChange={setSearch} placeholder="Order #, customer, phone, product, business..." />
        <div className="flex gap-2">
          <div className="flex-1 min-w-0">
            <Select value={bizFilter} onChange={e => setBizFilter(e.target.value)}>
              <option value="">All Businesses</option>
              {(businesses || []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </div>
          <div className="flex-1 min-w-0">
            <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">All Statuses</option>
              {ALL_STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
            </Select>
          </div>
        </div>
        <div className="flex gap-2">
          <div className="flex-1 min-w-0">
            <Select value={stateFilter} onChange={e => setStateFilter(e.target.value)}>
              <option value="">All States</option>
              {NIGERIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </Select>
          </div>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="flex-1 min-w-0" />
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="flex-1 min-w-0" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-3 pb-24">
        {!auditReady && (
          <div className="bg-amber-50 border border-amber-300 rounded-2xl p-3">
            <p className="text-xs font-semibold text-amber-900 mb-1">⚠ Audit table missing</p>
            <p className="text-xs text-amber-800">
              Deletions will work but leave no audit trail until you run
              <span className="font-mono"> supabase/migrations.sql</span> in the Supabase SQL editor
              (safe to run the whole file).
            </p>
          </div>
        )}
        <div className="bg-red-50 border border-red-200 rounded-2xl p-3 flex items-start gap-2">
          <AlertTriangle size={15} className="text-red-600 shrink-0 mt-0.5" />
          <p className="text-xs text-red-800">
            Permanent deletion is for test, duplicate, mistaken or corrupted records only.
            For real transactions use Cancelled, Failed Delivery or Returned. Deletion cannot be undone.
          </p>
        </div>

        {ordersQ.isLoading ? <SkeletonList count={6} /> :
         list.length === 0 ? (
          <EmptyState icon={<Trash2 size={28} />} title="No orders match" description="Adjust the search or filters" />
        ) : list.map(o => {
          const on = selected.includes(o.id)
          return (
            <button key={o.id} onClick={() => toggle(o.id)}
              className={`w-full text-left bg-white rounded-2xl p-4 border transition-all ${on ? 'border-red-400 bg-red-50/40' : 'border-gray-100'}`}>
              <div className="flex items-start gap-3">
                <span className={`w-5 h-5 rounded flex items-center justify-center shrink-0 mt-0.5 ${on ? 'bg-red-500 text-white' : 'bg-gray-100 text-transparent'}`}>
                  <Check size={13} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-mono text-gray-500">{o.order_number}</span>
                    <StatusBadge status={o.status} />
                  </div>
                  <p className="text-sm font-semibold text-gray-900 mt-0.5 truncate">{o.customer_name}</p>
                  <p className="text-xs text-gray-500 truncate">
                    {[o.business?.name, o.product_name].filter(Boolean).join(' · ')}
                  </p>
                  <div className="flex items-center justify-between mt-0.5">
                    <p className="text-xs text-gray-400">{formatDate(o.created_at)} · {o.state}</p>
                    <p className="text-sm font-bold text-gray-900">{formatCurrency(o.total_amount)}</p>
                  </div>
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {/* Sticky action bar */}
      {selected.length > 0 && (
        <div className="fixed bottom-20 left-0 right-0 px-4 z-30">
          <button onClick={openReview}
            className="w-full py-3.5 bg-red-600 text-white rounded-2xl font-semibold text-sm active:scale-95 transition-all flex items-center justify-center gap-2 shadow-lg">
            <Trash2 size={16} /> Review &amp; Delete {selected.length} Order{selected.length !== 1 ? 's' : ''}
          </button>
        </div>
      )}

      {/* Review + confirmation modal */}
      <Modal isOpen={showReview} onClose={() => !running && setShowReview(false)}
        title={result ? 'Deletion Complete' : 'Review Permanent Deletion'}
        footer={result ? (
          <Button className="w-full" onClick={() => { setShowReview(false); setResult(null) }}>Done</Button>
        ) : (
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowReview(false)} className="flex-1" disabled={running}>Back</Button>
            <Button variant="danger" className="flex-1" disabled={!canDelete} loading={running} onClick={executeDelete}>
              Permanently Delete
            </Button>
          </div>
        )}>
        {result ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-800">
              <span className="font-bold">{result.deleted}</span> order{result.deleted !== 1 ? 's' : ''} permanently deleted.
              Inventory, reports and totals now exclude {result.deleted !== 1 ? 'them' : 'it'}.
            </p>
            {result.warnings.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1">
                <p className="text-xs font-semibold text-amber-800">Needs your attention:</p>
                {result.warnings.map((w, i) => <p key={i} className="text-xs text-amber-800">• {w}</p>)}
              </div>
            )}
            <p className="text-[11px] text-gray-400">A record of this deletion is kept in Deleted Order Audit.</p>
          </div>
        ) : (
        <div className="space-y-4">
          {/* What will be affected */}
          <div className="bg-gray-50 rounded-xl p-3 space-y-1">
            <p className="text-xs text-gray-600"><span className="font-semibold">{selectedOrders.length}</span> order{selectedOrders.length !== 1 ? 's' : ''} selected</p>
            <p className="text-xs text-gray-600"><span className="font-semibold">{uniqueCustomers.length}</span> customer{uniqueCustomers.length !== 1 ? 's' : ''} affected</p>
            <p className="text-xs text-gray-600">Total value: <span className="font-semibold">{formatCurrency(totalValue)}</span></p>
            <p className="text-xs text-gray-600">
              Inventory movements affected: <span className="font-semibold">{reviewLoading ? '…' : review?.movements ?? 0}</span>
            </p>
            <p className="text-xs text-gray-500">
              Also removed: order items, timeline, notes, order expenses, waybill links, return records.
              Invoices/receipts are generated from the order, so they disappear with it.
            </p>
          </div>

          {!reviewLoading && (review?.holding || []).length > 0 && (
            <div className="bg-cyan-50 border border-cyan-200 rounded-xl p-3">
              <p className="text-xs font-semibold text-cyan-900 mb-1">Product Holding Queue protection</p>
              {review.holding.map(h => (
                <p key={h.id} className="text-xs text-cyan-900">
                  • {h.quantity} × {h.product_name} ({h.state}) from {h.source_order_number} is in the Holding Queue —
                  it will be kept and needs separate handling.
                </p>
              ))}
            </div>
          )}

          <Select label="Deletion Reason" required value={reason} onChange={e => setReason(e.target.value)}>
            <option value="">Select reason...</option>
            {DELETE_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </Select>
          <Textarea label="Notes (optional)" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />

          <label className="flex items-start gap-2.5">
            <input type="checkbox" checked={deleteCustomer} onChange={e => setDeleteCustomer(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-gray-300" />
            <span className="text-xs text-gray-700">
              Also permanently delete the customer profile(s) — only applied when the customer
              has no other orders left; otherwise the profile is kept automatically.
              {!reviewLoading && (review?.customers || []).map(c => (
                <span key={c.phone} className="block text-[11px] text-gray-400 mt-0.5">
                  {c.name}: {c.remainingOrders === 0 ? 'no other orders — would be deleted' : `${c.remainingOrders} other order(s) — will be kept`}
                </span>
              ))}
            </span>
          </label>

          <Input label="Your Password" type="password" required autoComplete="current-password"
            value={password} onChange={e => setPassword(e.target.value)}
            placeholder="Re-enter your password to authorise" />
          <Input label={`Type ${requiredPhrase} to confirm`} required
            value={phrase} onChange={e => setPhrase(e.target.value)} placeholder={requiredPhrase} />
        </div>
        )}
      </Modal>
    </div>
  )
}
