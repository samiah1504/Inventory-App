import { useState } from 'react'
import { Bell, Save, AlertTriangle, AlertCircle, CheckCircle } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { TopBar } from '../../components/layout/TopBar'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { useAppStore } from '../../stores/appStore'
import { useBusinesses } from '../../hooks/useBusinesses'

const ALERT_TYPES = [
  { key: 'new_order_stale_hours', label: 'New order waiting too long', unit: 'hours', default: 24, desc: 'Alert when a new order has not been moved to awaiting waybill' },
  { key: 'awaiting_waybill_stale_hours', label: 'Awaiting waybill too long', unit: 'hours', default: 48, desc: 'Alert when an order is stuck awaiting waybill' },
  { key: 'waybilled_not_received_hours', label: 'Waybilled but not received', unit: 'hours', default: 120, desc: 'Alert when a waybilled order has not been received at warehouse' },
  { key: 'processing_overdue_hours', label: 'Scheduled but not processing', unit: 'hours', default: 4, desc: 'Alert when planned delivery date has passed and order is not processing' },
  { key: 'delivered_unpaid_hours', label: 'Delivered but not paid', unit: 'hours', default: 72, desc: 'Alert when a delivered order has not been marked paid' },
  { key: 'low_stock_threshold', label: 'Low stock threshold', unit: 'units', default: 5, desc: 'Alert when available stock falls below this number' },
  { key: 'customer_failed_deliveries', label: 'Failed delivery count alert', unit: 'orders', default: 2, desc: 'Alert when a customer has this many or more failed deliveries' },
]

export function AlertsPage() {
  const { showToast } = useAppStore()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { data: businesses } = useBusinesses()
  const [selectedBusiness, setSelectedBusiness] = useState('')

  const { data: configs, isLoading } = useQuery({
    queryKey: ['alert_configs', selectedBusiness],
    queryFn: async () => {
      let query = supabase.from('alert_configs').select('*')
      if (selectedBusiness) query = query.eq('business_id', selectedBusiness)
      const { data, error } = await query
      if (error) throw error
      return data || []
    },
  })

  const [thresholds, setThresholds] = useState({})

  const liveAlerts = useQuery({
    queryKey: ['live_alerts', configs, selectedBusiness],
    enabled: Array.isArray(configs),
    queryFn: async () => {
      const now = new Date()
      const getHours = (type) => {
        const cfg = (configs || []).find(c => c.alert_type === type)
        return cfg?.threshold_hours || ALERT_TYPES.find(a => a.key === type)?.default || 24
      }

      const alerts = []
      const today = now.toISOString().split('T')[0]

      const bFilter = (q) => selectedBusiness ? q.eq('business_id', selectedBusiness) : q

      const newHours = getHours('new_order_stale_hours')
      const newCutoff = new Date(now - newHours * 3600000).toISOString()
      const { count: newCount } = await bFilter(
        supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'new').lt('created_at', newCutoff)
      )
      if (newCount > 0) alerts.push({ key: 'new', label: `${newCount} new order${newCount > 1 ? 's' : ''} stale >${newHours}h`, severity: newCount > 3 ? 'high' : 'medium', status: 'new' })

      const awHours = getHours('awaiting_waybill_stale_hours')
      const awCutoff = new Date(now - awHours * 3600000).toISOString()
      const { count: awCount } = await bFilter(
        supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'awaiting_waybill').lt('updated_at', awCutoff)
      )
      if (awCount > 0) alerts.push({ key: 'awaiting_waybill', label: `${awCount} order${awCount > 1 ? 's' : ''} stuck awaiting waybill >${awHours}h`, severity: 'medium', status: 'awaiting_waybill' })

      const { count: overdueCount } = await bFilter(
        supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'processing').lt('planned_delivery_date', today).not('planned_delivery_date', 'is', null)
      )
      if (overdueCount > 0) alerts.push({ key: 'overdue', label: `${overdueCount} order${overdueCount > 1 ? 's' : ''} overdue for delivery`, severity: 'high', status: 'processing' })

      const dpHours = getHours('delivered_unpaid_hours')
      const dpCutoff = new Date(now - dpHours * 3600000).toISOString()
      const { count: dpCount } = await bFilter(
        supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'delivered').lt('updated_at', dpCutoff)
      )
      if (dpCount > 0) alerts.push({ key: 'delivered', label: `${dpCount} delivered order${dpCount > 1 ? 's' : ''} unpaid >${dpHours}h`, severity: 'medium', status: 'delivered' })

      return alerts
    },
    staleTime: 60000,
  })

  function getConfigValue(alertType) {
    if (thresholds[alertType] !== undefined) return thresholds[alertType]
    const existing = (configs || []).find(c => c.alert_type === alertType)
    if (existing) return existing.threshold_hours ?? existing.threshold_count ?? ''
    return ALERT_TYPES.find(a => a.key === alertType)?.default ?? ''
  }

  function getConfigActive(alertType) {
    const existing = (configs || []).find(c => c.alert_type === alertType)
    return existing ? existing.is_active : true
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      for (const alert of ALERT_TYPES) {
        const value = Number(getConfigValue(alert.key)) || alert.default
        const isHours = alert.unit === 'hours'
        const existing = (configs || []).find(c => c.alert_type === alert.key)
        const payload = {
          business_id: selectedBusiness || null,
          alert_type: alert.key,
          threshold_hours: isHours ? value : null,
          threshold_count: !isHours ? value : null,
          is_active: true,
        }
        if (existing) {
          await supabase.from('alert_configs').update(payload).eq('id', existing.id)
        } else {
          await supabase.from('alert_configs').insert(payload)
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert_configs'] })
      showToast('Alert thresholds saved', 'success')
      setThresholds({})
    },
    onError: (err) => showToast(err.message, 'error'),
  })

  return (
    <div className="flex flex-col h-full">
      <TopBar title="Alert Thresholds" />
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

        {/* Business filter */}
        <div className="bg-white rounded-2xl p-4 border border-gray-100">
          <label className="text-xs font-medium text-gray-500 mb-1.5 block">Configure for business</label>
          <select
            value={selectedBusiness}
            onChange={e => setSelectedBusiness(e.target.value)}
            className="w-full px-3 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Businesses (Default)</option>
            {(businesses || []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>

        {/* Live alerts */}
        <div className="bg-white rounded-2xl p-4 border border-gray-100">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={16} className="text-amber-600" />
            <h3 className="text-sm font-semibold text-gray-900">Current Alerts</h3>
            <span className="ml-auto text-xs text-gray-400">{liveAlerts.isLoading ? 'Checking...' : `${(liveAlerts.data || []).length} active`}</span>
          </div>
          {liveAlerts.isLoading ? (
            <div className="h-8 shimmer rounded-lg" />
          ) : (liveAlerts.data || []).length === 0 ? (
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle size={16} />
              <span className="text-sm">All clear — no active alerts</span>
            </div>
          ) : (
            <div className="space-y-2">
              {(liveAlerts.data || []).map(alert => (
                <button
                  key={alert.key}
                  onClick={() => navigate(`/orders?status=${alert.status}`)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl text-left active:scale-[0.98] transition-all"
                  style={{ background: alert.severity === 'high' ? '#FEF2F2' : '#FFFBEB' }}
                >
                  <AlertCircle size={16} className={alert.severity === 'high' ? 'text-red-600 shrink-0' : 'text-amber-600 shrink-0'} />
                  <span className={`text-sm font-medium ${alert.severity === 'high' ? 'text-red-800' : 'text-amber-800'}`}>{alert.label}</span>
                  <span className="ml-auto text-xs text-gray-400">View →</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-3">
          {ALERT_TYPES.map(alert => (
            <div key={alert.key} className="bg-white rounded-2xl p-4 border border-gray-100">
              <div className="flex items-start gap-3 mb-3">
                <div className="w-8 h-8 bg-amber-50 rounded-xl flex items-center justify-center shrink-0">
                  <Bell size={16} className="text-amber-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{alert.label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{alert.desc}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  min="1"
                  inputMode="numeric"
                  placeholder={String(alert.default)}
                  value={thresholds[alert.key] !== undefined ? thresholds[alert.key] : (getConfigValue(alert.key) || '')}
                  onChange={e => setThresholds(t => ({ ...t, [alert.key]: e.target.value }))}
                  hint={`Trigger after ${alert.unit}`}
                />
              </div>
            </div>
          ))}
        </div>

        <Button
          onClick={() => saveMutation.mutate()}
          loading={saveMutation.isPending}
          size="lg"
          className="w-full"
          leftIcon={<Save size={18} />}
        >
          Save Alert Settings
        </Button>
      </div>
    </div>
  )
}
