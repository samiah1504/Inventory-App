import { useState } from 'react'
import { Bell, Save } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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
