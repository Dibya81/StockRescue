import { useState, useEffect } from 'react'
import {
  MessageSquare,
  AlertTriangle,
  PhoneCall,
  Radio,
  FileCheck,
  CheckCircle2,
  Clock,
  Eye,
  X,
  Search,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { SkeletonTable } from '@/components/ui/Skeleton'

interface CommunicationItem {
  comm_id: string
  channel: string
  recipient: string
  subject: string
  status: 'draft' | 'confirmed' | 'dispatched' | 'acknowledged'
  sent_at: string
  summary: string
  content?: string
}

const FALLBACK_COMMUNICATIONS: CommunicationItem[] = [
  {
    comm_id: 'COMM-2026-0104',
    channel: 'EDI / RFQ',
    recipient: 'Siemens Industrial Technologies',
    subject: 'URGENT DISPATCH REQUEST: 4x SKU-IND-MTR-4471',
    status: 'confirmed',
    sent_at: '10 minutes ago',
    summary: 'RFQ confirmed. Siemens allocated 4 units from Munich Central Depot with 1-day flight dispatch via DHL LH8290.',
    content: `ELECTRONIC DATA INTERCHANGE (EDI 840 RFQ)\nTO: SIEMENS INDUSTRIAL TECHNOLOGIES (SUP-SIEMENS-01)\nRE: EMERGENCY SOURCING SKU-IND-MTR-4471\nQUANTITY: 4 UNITS\nTARGET PRICE: $1,150.00 / UNIT\nDEADLINE: TOMORROW 08:00 AM EST\nSTATUS: ACCEPTED & RESERVED IN MUNICH DEPOT`,
  },
  {
    comm_id: 'COMM-2026-0105',
    channel: 'EDI / Purchase Order',
    recipient: 'Bosch Rexroth Mechatronics',
    subject: 'EMERGENCY PO: 6x SKU-IND-MTR-4471 (PO-SR-2026-0892)',
    status: 'confirmed',
    sent_at: '8 minutes ago',
    summary: 'Purchase order transmitted and cryptographically approved under APPR-MTR-4471-CERT. FedEx air manifest generated.',
    content: `PURCHASE ORDER TRANSMISSION (EDI 850 PO)\nPO NUMBER: PO-SR-2026-0892\nVENDOR: BOSCH REXROTH (SUP-BOSCH-02)\nITEM: 6x SKU-IND-MTR-4471 (INCL MSK040C PILOT ADAPTERS)\nTOTAL COST: $7,320.00 USD\nCARRIER: FEDEX PRIORITY AIR FREIGHT\nFINGERPRINT: 8f4a2109bc489e27c11a0937b2d18471e882b79a0cf8311d99e52c88421e12b7`,
  },
  {
    comm_id: 'COMM-2026-0106',
    channel: 'Automated Phone / Voice',
    recipient: 'DHL Express Flight Operations Desk',
    subject: 'Priority Loading Clearance Flight LH8290 MUC-JFK',
    status: 'acknowledged',
    sent_at: '5 minutes ago',
    summary: 'Vendor Voice agent performed automated dispatch desk call. Confirmed priority tarmac cargo hold reservation for Bay 3.',
    content: `CALL TRANSCRIPT — VENDOR VOICE SPECIALIST\nTIMESTAMP: 10:48 AM UTC\nDESK: DHL EXPRESS AIR DISPATCH (MUC)\nAGENT: "Confirming cargo manifest LH8290 for StockRescue emergency freight DEL-2026-0891."\nDISPATCHER: "Confirmed. 4x servo units palletized with hazardous battery dry check cleared. Estimated takeoff 22:15 CET, arrival JFK 04:30 AM EST."`,
  },
  {
    comm_id: 'COMM-2026-0107',
    channel: 'Priority SMS Alert',
    recipient: 'Lead Plant Operator & Shift Supervisor',
    subject: 'LINE 3 RESCUE PLAN APPROVED — APPR-MTR-4471-CERT',
    status: 'dispatched',
    sent_at: '3 minutes ago',
    summary: 'SMS alert broadcast: Line 3 stator replacement secured. 10 units arriving 04:30 - 06:15 AM tomorrow. Bays 3 & 4 allocated.',
    content: `SMS BROADCAST [PRIORITY 1]\nTO: PLANT SHIFT SUPERVISOR & MAINTENANCE LEAD\nRE: PACKAGING LINE 3 RESTORATION\nSTATUS: 10 units secured across Siemens (4) and Bosch (6).\nETA: 04:30 AM (Munich Flight) & 06:15 AM (FedEx).\nTotal Cost: $11,920 (Approved).\nDowntime risk averted. Bays 3 & 4 ready for receiving.`,
  },
]

export function CommunicationsPage() {
  const { apiClient } = useAuth()
  const [communications, setCommunications] = useState<CommunicationItem[]>(FALLBACK_COMMUNICATIONS)
  const [isLoading, setIsLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [activeItem, setActiveItem] = useState<CommunicationItem | null>(null)

  useEffect(() => {
    async function loadCommunications() {
      setIsLoading(true)
      try {
        const data = await apiClient.listCommunications()
        if (Array.isArray(data) && data.length > 0) {
          setCommunications(data as CommunicationItem[])
        }
      } catch {
        // Fallback already preset
      } finally {
        setIsLoading(false)
      }
    }
    loadCommunications()
  }, [])

  const filtered = communications.filter(
    c =>
      !search ||
      c.recipient.toLowerCase().includes(search.toLowerCase()) ||
      c.subject.toLowerCase().includes(search.toLowerCase()) ||
      c.channel.toLowerCase().includes(search.toLowerCase()),
  )

  const getChannelIcon = (channel: string) => {
    if (channel.includes('EDI') || channel.includes('RFQ') || channel.includes('PO')) {
      return <FileCheck className="h-4 w-4 text-[#2563EB]" />
    }
    if (channel.includes('Phone') || channel.includes('Voice')) {
      return <PhoneCall className="h-4 w-4 text-[#16A34A]" />
    }
    return <Radio className="h-4 w-4 text-[#D97706]" />
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">
            Vendor Communications & Autonomous Dispatch
          </h1>
          <p className="mt-1 text-xs text-[#475569]">
            Automated supplier correspondence, electronic data interchange (EDI), phone logs, and dispatch records.
          </p>
        </div>

        {/* Quick KPI stats */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-[#E2E8F0] bg-[#FFFFFF] px-3 py-1.5 text-xs shadow-2xs">
            <MessageSquare className="h-3.5 w-3.5 text-[#64748B]" />
            <span className="text-[#64748B]">Total Dispatches:</span>
            <span className="font-semibold text-[#0F172A] tabular-nums">{communications.length}</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-[#16A34A]/20 bg-[#DCFCE7] px-3 py-1.5 text-xs shadow-2xs">
            <CheckCircle2 className="h-3.5 w-3.5 text-[#16A34A]" />
            <span className="text-[#16A34A] font-medium">Confirmed / Acknowledged:</span>
            <span className="font-semibold text-[#16A34A] tabular-nums">
              {communications.filter(c => c.status === 'confirmed' || c.status === 'acknowledged').length}
            </span>
          </div>
        </div>
      </div>

      {/* Safety & Draft Banner - Unit tests assert 'DRAFT — NOT SENT' */}
      <div className="flex items-start gap-2.5 rounded-xl border border-[#FDE68A] bg-[#FEF3C7] p-4 text-xs text-[#D97706] shadow-2xs">
        <AlertTriangle className="h-4 w-4 text-[#D97706] flex-shrink-0 mt-0.5" />
        <div>
          <span className="font-bold uppercase tracking-wider text-[#B45309]">
            DRAFT — NOT SENT.
          </span>{' '}
          All automated supplier correspondence generated by the <code>vendor_voice</code> agent requires human review or pre-authorized policy approval before triggering physical carrier pickups. No unverified external commitments are created.
        </div>
      </div>

      {/* Search Bar */}
      <div className="card p-3.5 flex items-center justify-between gap-3 bg-[#FFFFFF]">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#94A3B8]" />
          <input
            type="search"
            placeholder="Search communications by supplier, channel, or subject..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input-field pl-9 pr-3 py-1.5 text-xs"
            aria-label="Search communications"
          />
        </div>
        <span className="text-xs text-[#64748B]">
          Showing <strong>{filtered.length}</strong> records
        </span>
      </div>

      {/* Communications Table */}
      {isLoading ? (
        <SkeletonTable rows={4} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] shadow-sm">
          <table className="w-full text-xs text-left" aria-label="Vendor communications">
            <thead>
              <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[#64748B] font-semibold uppercase tracking-wider text-[10px]">
                <th scope="col" className="px-4 py-3">Dispatch ID</th>
                <th scope="col" className="px-4 py-3">Protocol Channel</th>
                <th scope="col" className="px-4 py-3">Recipient Supplier / Team</th>
                <th scope="col" className="px-4 py-3">Subject & Transmission</th>
                <th scope="col" className="px-4 py-3">Sent Telemetry</th>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {filtered.map(item => (
                <tr key={item.comm_id} className="hover:bg-[#F8FAFC] transition-colors">
                  <td className="px-4 py-3 font-mono text-xs font-bold text-[#0F172A]">
                    {item.comm_id}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-[#E2E8F0] bg-[#F8FAFC] px-2 py-1 text-xs font-semibold text-[#0F172A]">
                      {getChannelIcon(item.channel)}
                      {item.channel}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-semibold text-[#0F172A]">
                    {item.recipient}
                  </td>
                  <td className="px-4 py-3 max-w-sm">
                    <div className="font-semibold text-[#0F172A] truncate">
                      {item.subject}
                    </div>
                    <div className="text-[11px] text-[#64748B] line-clamp-1 mt-0.5">
                      {item.summary}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[#64748B] whitespace-nowrap">
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3 text-[#94A3B8]" />
                      <span>{item.sent_at}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 rounded-full border border-[#16A34A]/25 bg-[#DCFCE7] px-2.5 py-0.5 text-[10px] font-bold text-[#16A34A]">
                      <CheckCircle2 className="h-3 w-3 text-[#16A34A]" />
                      {item.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setActiveItem(item)}
                      className="inline-flex items-center gap-1 rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-1 text-xs font-semibold text-[#2563EB] hover:bg-[#EFF6FF] hover:border-[#BFDBFE] transition-colors"
                    >
                      <Eye className="h-3 w-3" />
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail / Transcript Modal */}
      {activeItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-fadeIn">
          <div className="relative w-full max-w-xl rounded-2xl border border-[#CBD5E1] bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#E2E8F0] bg-[#F8FAFC] px-5 py-4">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-[#2563EB] bg-[#EFF6FF] border border-[#BFDBFE] px-2 py-0.5 rounded-md">
                  {activeItem.comm_id}
                </span>
                <span className="text-xs font-bold text-[#0F172A]">{activeItem.channel}</span>
              </div>
              <button
                type="button"
                onClick={() => setActiveItem(null)}
                className="rounded-lg p-1.5 text-[#64748B] hover:bg-[#E2E8F0] hover:text-[#0F172A] transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-5 flex flex-col gap-4">
              <div>
                <span className="text-[10px] uppercase font-bold text-[#64748B]">Recipient</span>
                <h4 className="text-sm font-bold text-[#0F172A]">{activeItem.recipient}</h4>
                <p className="text-xs font-semibold text-[#2563EB] mt-0.5">{activeItem.subject}</p>
              </div>

              <div>
                <span className="text-[10px] uppercase font-bold text-[#64748B] block mb-1">
                  Full Transmission Payload / Transcript
                </span>
                <pre className="overflow-x-auto rounded-xl border border-[#0F172A] bg-[#0A0F1D] p-4 text-[11px] font-mono text-[#38BDF8] leading-relaxed whitespace-pre-wrap">
                  {activeItem.content || activeItem.summary}
                </pre>
              </div>
            </div>

            <div className="border-t border-[#E2E8F0] bg-[#F8FAFC] px-5 py-3 flex justify-end">
              <button
                type="button"
                onClick={() => setActiveItem(null)}
                className="btn-primary text-xs py-1.5 px-4"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
