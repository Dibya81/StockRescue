import { clsx } from 'clsx'
import { type LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center gap-4 rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] p-12 text-center my-4 shadow-sm',
        className,
      )}
      aria-live="polite"
    >
      {Icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#EFF6FF] border border-[#2563EB]/20 text-[#2563EB] shadow-xs">
          <Icon className="h-6 w-6" aria-hidden="true" />
        </div>
      )}
      <div className="flex flex-col gap-1 max-w-sm">
        <p className="font-semibold text-base text-[#0F172A]">{title}</p>
        {description && (
          <p className="text-sm text-[#475569] leading-relaxed">{description}</p>
        )}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
