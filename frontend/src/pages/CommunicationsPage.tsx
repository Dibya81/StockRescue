import { MessageSquare, AlertTriangle } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'

// Vendor communications are prepared by the backend vendor_voice agent.
// There is no GET /communications endpoint yet — display explicit empty state.
// All communications are strictly draft-only and unsent.

export function CommunicationsPage() {
  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">
          Vendor Communications & Drafts
        </h1>
        <p className="mt-1 text-xs text-[#475569]">
          Automated supplier correspondence, quote inquiries, and delivery follow-up drafts.
        </p>
      </div>

      {/* Safety & Draft Banner - Unit tests assert 'DRAFT — NOT SENT' */}
      <div className="flex items-start gap-2.5 rounded-xl border border-[#FDE68A] bg-[#FEF3C7] p-4 text-xs text-[#D97706] shadow-2xs">
        <AlertTriangle className="h-4 w-4 text-[#D97706] flex-shrink-0 mt-0.5" />
        <div>
          <span className="font-bold uppercase tracking-wider text-[#B45309]">
            DRAFT — NOT SENT.
          </span>{' '}
          All communications shown here are unsent drafts prepared by the <code>vendor_voice</code> specialist. No external emails, SMS, or webhook communications are triggered automatically. Human approval is strictly required.
        </div>
      </div>

      {/* Empty State / Standby Notice */}
      <EmptyState
        icon={MessageSquare}
        title="No active communication drafts"
        description="Vendor communication drafts will appear here when the vendor_voice specialist produces negotiation letters. No API endpoint currently exposes draft records."
      />
    </div>
  )
}
