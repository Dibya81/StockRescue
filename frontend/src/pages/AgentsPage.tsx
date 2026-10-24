import { Info } from 'lucide-react'
import { LiveAgentSimulation } from '@/features/simulation/LiveAgentSimulation'

// Agent identity map — shared mailbox identities vs logical specialist capabilities.
// Status is "Unknown" because there is no trusted API endpoint returning
// registration/connection data. Hard-coded labels are NOT used.
// IMPORTANT: Never expose seed or token text in the client.

const AGENT_MAP = [
  { mailbox: 1, identity: 'coordinator',          specialists: ['Coordinator'],                         note: null },
  { mailbox: 2, identity: 'inventory_bom',         specialists: ['Inventory BOM Analyst'],               note: null },
  { mailbox: 3, identity: 'job_impact',            specialists: ['Job Impact Assessor'],                 note: null },
  { mailbox: 4, identity: 'supplier_discovery',    specialists: ['Supplier Discovery', 'Compatibility'], note: 'Shared mailbox for two logical capabilities' },
  { mailbox: 5, identity: 'quote_risk',            specialists: ['Quote Risk', 'Recovery Planner'],      note: 'Shared mailbox for two logical capabilities' },
  { mailbox: 6, identity: 'procurement',           specialists: ['Procurement'],                         note: null },
  { mailbox: 7, identity: 'delivery_watch',        specialists: ['Delivery Watch'],                      note: null },
  { mailbox: 8, identity: 'vendor_voice',          specialists: ['Vendor Voice'],                        note: null },
]

export function AgentsPage() {
  return (
    <div className="flex flex-col gap-8">
      {/* Page Title Header */}
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-[#0F172A]">
            Autonomous Specialist Multi-Agent Matrix
          </h1>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#2563EB]/25 bg-[#EFF6FF] px-2.5 py-0.5 text-xs font-semibold text-[#2563EB] shadow-2xs">
            <span className="h-1.5 w-1.5 rounded-full bg-[#2563EB] animate-pulse" />
            Live Simulation Engine
          </span>
        </div>
        <p className="mt-1 text-sm text-[#475569]">
          Parallel multi-agent orchestration mesh powered by Fetch.ai uAgents protocol & Agentverse mailboxes.
        </p>
      </div>

      {/* Hero Interactive Simulation Engine */}
      <section aria-labelledby="live-sim-heading">
        <h2 id="live-sim-heading" className="sr-only">Live Agent Simulation</h2>
        <LiveAgentSimulation />
      </section>

      {/* Safety & Protocol Banner */}
      <div className="flex items-start gap-2.5 rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] p-4 text-xs text-[#475569] shadow-2xs">
        <Info className="h-4 w-4 text-[#2563EB] flex-shrink-0 mt-0.5" />
        <div>
          Agent registration and connection status cannot be verified — no trusted API endpoint returns this data. Statuses shown as <strong>Unknown</strong>. All sensitive credentials remain securely managed on the server.
        </div>
      </div>

      {/* Agentverse Matrix Table */}
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-bold text-[#0F172A]">
          Agentverse Mailbox Directory & Endpoints
        </h3>
        <div className="overflow-x-auto rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] shadow-xs">
          <table className="w-full text-xs text-left" aria-label="Agentverse mailbox identities">
            <thead>
              <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[#64748B] font-semibold uppercase tracking-wider text-[10px]">
                <th scope="col" className="px-4 py-3"># Mailbox</th>
                <th scope="col" className="px-4 py-3">Mailbox Identity</th>
                <th scope="col" className="px-4 py-3">Logical Specialist(s)</th>
                <th scope="col" className="px-4 py-3">Connection Telemetry</th>
                <th scope="col" className="px-4 py-3">Architecture Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {AGENT_MAP.map(a => (
                <tr key={a.mailbox} className="hover:bg-[#F8FAFC] transition-colors">
                  <td className="px-4 py-3 text-[#64748B] font-mono">
                    MB-{String(a.mailbox).padStart(2, '0')}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-[#2563EB]">
                    {a.identity}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {a.specialists.map(s => (
                        <span
                          key={s}
                          className="rounded-md border border-[#E2E8F0] bg-[#F1F5F9] px-2 py-0.5 text-[11px] font-semibold text-[#0F172A]"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E2E8F0] bg-[#F1F5F9] px-2.5 py-0.5 text-[10px] font-semibold text-[#64748B]">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#94A3B8]" />
                      Unknown
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-[#64748B]">
                    {a.note ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
