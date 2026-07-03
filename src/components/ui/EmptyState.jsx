import { PackageOpen } from 'lucide-react'
import { Button } from './Button'

export function EmptyState({ icon, title = 'Nothing here', description, action, actionLabel }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4 text-gray-400">
        {icon || <PackageOpen size={28} />}
      </div>
      <h3 className="text-base font-semibold text-gray-900 mb-1">{title}</h3>
      {description && <p className="text-sm text-gray-500 mb-6 max-w-xs">{description}</p>}
      {action && (
        <Button onClick={action} size="md">
          {actionLabel || 'Add New'}
        </Button>
      )}
    </div>
  )
}
