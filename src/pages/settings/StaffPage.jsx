import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Edit, UserX, UserCheck, ChevronRight } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { TopBar } from '../../components/layout/TopBar'
import { Badge } from '../../components/ui/Badge'
import { useAppStore } from '../../stores/appStore'
import { StaffFormModal, ROLES } from './StaffFormModal'
import { STAFF_STATUSES, labelOf } from '../../hooks/useStaff'

const roleColors = {
  ceo: 'purple',
  operations_manager: 'blue',
  customer_support: 'green',
  fulfillment: 'amber',
  waybill: 'blue',
  inventory: 'gray',
  accountant: 'gray',
}

const statusColors = { active: 'green', on_leave: 'amber', suspended: 'red', inactive: 'gray' }

export function StaffPage() {
  const navigate = useNavigate()
  const [showModal, setShowModal] = useState(false)
  const [editingStaff, setEditingStaff] = useState(null)
  const queryClient = useQueryClient()

  const { data: staff, isLoading } = useQuery({
    queryKey: ['staff'],
    queryFn: async () => {
      const { data, error } = await supabase.from('staff_users').select('*').order('name')
      if (error) throw error
      // Deleted accounts leave daily operations entirely
      return (data || []).filter(s => !s.is_deleted)
    },
  })

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }) => {
      const { error } = await supabase.from('staff_users').update({ is_active: !is_active }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staff'] }),
  })

  return (
    <div className="flex flex-col h-full overflow-x-hidden w-full">
      <TopBar
        title="Staff Management"
        actions={
          <button onClick={() => { setEditingStaff(null); setShowModal(true) }}
            className="p-2 bg-blue-600 text-black rounded-xl active:scale-95">
            <Plus size={20} />
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-3">
        {isLoading ? (
          <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-20 shimmer rounded-2xl" />)}</div>
        ) : (
          <>
            <p className="text-xs text-gray-500">{staff?.length} staff members · tap a card to open the full profile</p>
            {(staff || []).map(member => (
              <div
                key={member.id}
                onClick={() => navigate(`/settings/staff/${member.id}`)}
                className="bg-white rounded-2xl p-4 border border-gray-100 cursor-pointer active:scale-[0.99] transition-transform"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <p className="text-sm font-semibold text-gray-900">{member.name}</p>
                      {member.status && member.status !== 'active' && (
                        <Badge color={statusColors[member.status] || 'gray'}>{labelOf(STAFF_STATUSES, member.status)}</Badge>
                      )}
                      {!member.is_active && !member.status && <Badge color="red">Inactive</Badge>}
                    </div>
                    <p className="text-xs text-gray-500">@{member.username} · {member.staff_code}</p>
                    {(member.position || member.department) && (
                      <p className="text-xs text-gray-400">{[member.position, member.department].filter(Boolean).join(' · ')}</p>
                    )}
                    {member.phone && <p className="text-xs text-gray-400">{member.phone}</p>}
                    <div className="mt-1">
                      <Badge color={roleColors[member.role] || 'gray'}>
                        {ROLES.find(r => r.value === member.role)?.label || member.role}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={e => { e.stopPropagation(); setEditingStaff(member); setShowModal(true) }}
                      className="p-2 bg-gray-100 text-gray-600 rounded-xl active:scale-95 transition-all">
                      <Edit size={16} />
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); toggleActive.mutate({ id: member.id, is_active: member.is_active }) }}
                      className={`p-2 rounded-xl active:scale-95 transition-all ${member.is_active ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}
                    >
                      {member.is_active ? <UserX size={16} /> : <UserCheck size={16} />}
                    </button>
                    <ChevronRight size={16} className="text-gray-300" />
                  </div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      <StaffFormModal
        isOpen={showModal}
        onClose={() => { setShowModal(false); setEditingStaff(null) }}
        staff={editingStaff}
      />
    </div>
  )
}
