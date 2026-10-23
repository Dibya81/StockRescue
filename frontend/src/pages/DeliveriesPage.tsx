import { Activity, Info } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'

// Delivery events are tracked by the delivery_watch agent.
// There is no GET /deliveries endpoint yet — display explicit empty state with explanation.
// Unknown status is never converted without evidence.

export function DeliveriesPage() {
  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">
          Logistics & Inbound Deliveries
        </h1>
        <p className="mt-1 text-xs text-[#475569]">
          Real-time carrier tracking, milestone verification, and transit exception telemetry.
        </p>
      </div>

      {/* Operational Protocol Banner */}
      <div className="flex items-start gap-2.5 rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] p-4 text-xs text-[#475569] shadow-2xs">
        <Info className="h-4 w-4 text-[#2563EB] flex-shrink-0 mt-0.5" />
        <div>
          Delivery milestones are observed by the <strong className="text-[#0F172A]">delivery_watch</strong> autonomous specialist. Status is shown only when verified events exist. Unconfirmed shipments remain classified as <em>Unknown</em> to prevent false optimism.
        </div>
      </div>

      {/* Empty State */}
      <EmptyState
        icon={Activity}
        title="No active delivery events recorded"
        description="Delivery event tracking requires a /deliveries API endpoint, which is not yet exposed by the backend. Verified carrier milestones will stream here once registered."
      />
    </div>
  )
}
