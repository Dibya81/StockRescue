import { clsx } from 'clsx'

interface SkeletonProps {
  className?: string
  lines?: number
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={clsx(
        'animate-pulse rounded bg-[#E2E8F0]/80',
        className,
      )}
      aria-hidden="true"
    />
  )
}

export function SkeletonLines({ lines = 3, className }: SkeletonProps) {
  return (
    <div className={clsx('flex flex-col gap-2.5', className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={clsx('h-3.5', i === lines - 1 ? 'w-2/3' : 'w-full')}
        />
      ))}
    </div>
  )
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={clsx('card flex flex-col gap-4 border-[#E2E8F0] bg-[#FFFFFF] shadow-sm', className)} aria-busy="true" aria-label="Loading">
      <Skeleton className="h-4 w-1/3" />
      <SkeletonLines lines={3} />
    </div>
  )
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="w-full overflow-hidden rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] shadow-sm" aria-busy="true" aria-label="Loading table">
      <div className="flex gap-4 border-b border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3.5">
        <Skeleton className="h-3.5 w-1/4" />
        <Skeleton className="h-3.5 w-1/4" />
        <Skeleton className="h-3.5 w-1/4" />
        <Skeleton className="h-3.5 w-1/4" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 border-b border-[#E2E8F0]/70 px-4 py-3.5 last:border-0">
          <Skeleton className="h-3.5 w-1/3" />
          <Skeleton className="h-3.5 w-1/5" />
          <Skeleton className="h-3.5 w-1/4" />
          <Skeleton className="h-3.5 w-1/6" />
        </div>
      ))}
    </div>
  )
}
