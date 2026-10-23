import { clsx } from 'clsx'

type Variant =
  | 'normal'
  | 'low'
  | 'shortage'
  | 'unknown'
  | 'proposed'
  | 'approved'
  | 'revoked'
  | 'expired'
  | 'info'
  | 'draft'

const CONFIG: Record<Variant, { label: string; symbol: string; color: string; bg: string; border: string }> = {
  normal:   { label: 'Normal',   symbol: '✓', color: 'text-[#16A34A]', bg: 'bg-[#DCFCE7]', border: 'border-[#BBF7D0]' },
  low:      { label: 'Low Stock', symbol: '▲', color: 'text-[#D97706]', bg: 'bg-[#FEF3C7]', border: 'border-[#FDE68A]' },
  shortage: { label: 'Shortage',  symbol: '✕', color: 'text-[#DC2626]', bg: 'bg-[#FEE2E2]', border: 'border-[#FECACA]' },
  unknown:  { label: 'Unknown',   symbol: '?', color: 'text-[#64748B]', bg: 'bg-[#F1F5F9]', border: 'border-[#E2E8F0]' },
  proposed: { label: 'Proposed',  symbol: '◎', color: 'text-[#7C3AED]', bg: 'bg-[#F3E8FF]', border: 'border-[#E9D5FF]' },
  approved: { label: 'Approved',  symbol: '✓', color: 'text-[#16A34A]', bg: 'bg-[#DCFCE7]', border: 'border-[#BBF7D0]' },
  revoked:  { label: 'Revoked',   symbol: '✕', color: 'text-[#DC2626]', bg: 'bg-[#FEE2E2]', border: 'border-[#FECACA]' },
  expired:  { label: 'Expired',   symbol: '⏱', color: 'text-[#D97706]', bg: 'bg-[#FEF3C7]', border: 'border-[#FDE68A]' },
  info:     { label: 'Info',      symbol: 'ℹ', color: 'text-[#2563EB]', bg: 'bg-[#DBEAFE]', border: 'border-[#BFDBFE]' },
  draft:    { label: 'Draft — Not Sent', symbol: '✎', color: 'text-[#D97706]', bg: 'bg-[#FEF3C7]', border: 'border-[#FCD34D]' },
}

interface StatusBadgeProps {
  variant: Variant
  className?: string
  showSymbol?: boolean
}

export function StatusBadge({ variant, className, showSymbol = true }: StatusBadgeProps) {
  const cfg = CONFIG[variant] || CONFIG.unknown
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold select-none shadow-2xs',
        cfg.color, cfg.bg, cfg.border, className,
      )}
      aria-label={cfg.label}
    >
      {showSymbol && <span aria-hidden="true" className="font-bold text-[11px]">{cfg.symbol}</span>}
      {cfg.label}
    </span>
  )
}
