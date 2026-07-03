export function Skeleton({ className = '', height = 'h-4', width = 'w-full' }) {
  return <div className={`shimmer ${height} ${width} ${className}`} />
}

export function SkeletonCard() {
  return (
    <div className="bg-white rounded-2xl p-4 border border-gray-100 space-y-3">
      <div className="flex items-center justify-between">
        <Skeleton height="h-4" width="w-24" />
        <Skeleton height="h-6" width="w-16" />
      </div>
      <Skeleton height="h-5" width="w-3/4" />
      <Skeleton height="h-4" width="w-1/2" />
      <div className="flex gap-2 pt-1">
        <Skeleton height="h-8" width="w-20" />
        <Skeleton height="h-8" width="w-20" />
      </div>
    </div>
  )
}

export function SkeletonList({ count = 4 }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  )
}
