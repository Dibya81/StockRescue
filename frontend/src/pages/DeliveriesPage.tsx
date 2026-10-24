import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Truck,
  Plane,
  Clock,
  CheckCircle2,
  MapPin,
  Warehouse,
  ShieldCheck,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { SkeletonTable } from '@/components/ui/Skeleton'

interface DeliveryRecord {
  delivery_id: string
  po_number: string
  case_id: string
  sku: string
  description: string
  quantity: number
  supplier_name: string
  carrier: string
  tracking_number: string
  origin: string
  destination_bay: string
  status: 'priority_air_transit' | 'express_ground_transit' | 'in_transit' | 'delivered'
  dispatched_at: string
  estimated_arrival: string
  notes: string
}

const FALLBACK_DELIVERIES: DeliveryRecord[] = [
  {
    delivery_id: 'DEL-2026-0891',
    po_number: 'PO-SR-2026-0891',
    case_id: 'CASE-MTR-4471',
    sku: 'SKU-IND-MTR-4471',
    description: '3-Phase High-Torque Servo Motor (400V)',
    quantity: 4,
    supplier_name: 'Siemens Industrial Technologies',
    carrier: 'DHL Express Priority Flight (LH8290)',
    tracking_number: 'DHL-EXP-99214-DE',
    origin: 'Munich Central Depot (MUC)',
    destination_bay: 'Dock Bay 3 (Priority Ramp)',
    status: 'priority_air_transit',
    dispatched_at: 'Today, 10:45 AM',
    estimated_arrival: 'Tomorrow, 04:30 AM (T+16h)',
    notes: 'Direct Munich-JFK air manifest. Cleared priority customs pre-check.',
  },
  {
    delivery_id: 'DEL-2026-0892',
    po_number: 'PO-SR-2026-0892',
    case_id: 'CASE-MTR-4471',
    sku: 'SKU-IND-MTR-4471',
    description: '3-Phase High-Torque Servo Motor (400V)',
    quantity: 6,
    supplier_name: 'Bosch Rexroth Mechatronics',
    carrier: 'FedEx Priority Air Freight',
    tracking_number: 'FDX-PRI-44109-FX',
    origin: 'Lohr am Main Distribution Hub',
    destination_bay: 'Dock Bay 4 (Direct Ingestion)',
    status: 'priority_air_transit',
    dispatched_at: 'Today, 11:10 AM',
    estimated_arrival: 'Tomorrow, 06:15 AM (T+18h)',
    notes: 'Split fulfillment batch with included MSK040C pilot flange adapters.',
  },
  {
    delivery_id: 'DEL-2026-0840',
    po_number: 'PO-SR-2026-0840',
    case_id: 'CASE-BRG-6204',
    sku: 'SKU-BRG-6204',
    description: 'Deep Groove Ball Bearing (6204-2RSH)',
    quantity: 20,
    supplier_name: 'SKF Industrial Bearings',
    carrier: 'UPS Worldwide Express Saver',
    tracking_number: '1Z999AA10123456784',
    origin: 'Schweinfurt Distribution Center',
    destination_bay: 'Dock Bay 1',
    status: 'in_transit',
    dispatched_at: 'Yesterday, 16:30 PM',
    estimated_arrival: 'Today, 14:00 PM',
    notes: 'Routine maintenance replenish order for Conveyor #2.',
  },
  {
    delivery_id: 'DEL-2026-0792',
    po_number: 'PO-SR-2026-0792',
    case_id: 'CASE-PLC-S715',
    sku: 'SKU-PLC-S715',
    description: 'Simatic S7-1500 Modular CPU Module',
    quantity: 3,
    supplier_name: 'Rockwell Automation (Allen-Bradley)',
    carrier: 'DB Schenker Expedited Freight',
    tracking_number: 'DBS-EXP-77401-US',
    origin: 'Milwaukee Logistics Hub',
    destination_bay: 'Dock Bay 2',
    status: 'in_transit',
    dispatched_at: 'Yesterday, 09:00 AM',
    estimated_arrival: 'Oct 26, 11:00 AM',
    notes: 'Line 1 retrofit upgrade PLC modules.',
  },
  {
    delivery_id: 'DEL-2026-0711',
    po_number: 'PO-SR-2026-0711',
    case_id: 'CASE-PRX-M18',
    sku: 'SKU-PRX-M18',
    description: 'Inductive Proximity Sensor M18 PNP',
    quantity: 15,
    supplier_name: 'Omron Electronic Sensing Corp',
    carrier: 'BlueDart Express Air Cargo',
    tracking_number: 'BD-AIR-550192',
    origin: 'Chennai Regional Hub',
    destination_bay: 'Dock Bay 1',
    status: 'delivered',
    dispatched_at: '2 days ago',
    estimated_arrival: 'Delivered (Received Bay 1)',
    notes: 'Stocked into bin LOC-B02-L1-P1. Barcodes verified.',
  },
]

export function DeliveriesPage() {
  const { apiClient } = useAuth()
  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>(FALLBACK_DELIVERIES)
  const [isLoading, setIsLoading] = useState(false)

  const fetchDeliveries = async () => {
    setIsLoading(true)
    try {
      const data = await apiClient.listDeliveries()
      if (Array.isArray(data) && data.length > 0) {
        setDeliveries(data as DeliveryRecord[])
      } else {
        setDeliveries(FALLBACK_DELIVERIES)
      }
    } catch {
      setDeliveries(FALLBACK_DELIVERIES)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchDeliveries()
  }, [])

  const priorityCount = deliveries.filter(d => d.status === 'priority_air_transit').length
  const inTransitCount = deliveries.filter(d => d.status === 'in_transit').length
  const deliveredCount = deliveries.filter(d => d.status === 'delivered').length

  const getStatusBadge = (status: DeliveryRecord['status']) => {
    if (status === 'priority_air_transit') {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#2563EB]/25 bg-[#EFF6FF] px-2.5 py-0.5 text-[11px] font-bold text-[#2563EB]">
          <Plane className="h-3 w-3 animate-pulse text-[#2563EB]" />
          Priority Air Flight
        </span>
      )
    }
    if (status === 'delivered') {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#16A34A]/25 bg-[#DCFCE7] px-2.5 py-0.5 text-[11px] font-bold text-[#16A34A]">
          <CheckCircle2 className="h-3 w-3 text-[#16A34A]" />
          Delivered / In Dock
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[#D97706]/25 bg-[#FEF3C7] px-2.5 py-0.5 text-[11px] font-bold text-[#D97706]">
        <Truck className="h-3 w-3 text-[#D97706]" />
        In Transit
      </span>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header & KPI Summary */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">
            Logistics & Inbound Deliveries
          </h1>
          <p className="mt-1 text-xs text-[#475569]">
            Real-time carrier tracking, flight manifests, and dock bay allocations observed by the Delivery Watch agent.
          </p>
        </div>

        {/* Quick summary stats */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-[#E2E8F0] bg-[#FFFFFF] px-3 py-1.5 text-xs shadow-2xs">
            <Truck className="h-3.5 w-3.5 text-[#64748B]" />
            <span className="text-[#64748B]">Active Shipments:</span>
            <span className="font-semibold text-[#0F172A] tabular-nums">{deliveries.length}</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-[#2563EB]/20 bg-[#EFF6FF] px-3 py-1.5 text-xs shadow-2xs">
            <Plane className="h-3.5 w-3.5 text-[#2563EB]" />
            <span className="text-[#2563EB] font-medium">Priority Air:</span>
            <span className="font-semibold text-[#2563EB] tabular-nums">{priorityCount}</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-[#D97706]/20 bg-[#FEF3C7] px-3 py-1.5 text-xs shadow-2xs">
            <Clock className="h-3.5 w-3.5 text-[#D97706]" />
            <span className="text-[#D97706] font-medium">In Transit:</span>
            <span className="font-semibold text-[#D97706] tabular-nums">{inTransitCount}</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-[#16A34A]/20 bg-[#DCFCE7] px-3 py-1.5 text-xs shadow-2xs">
            <CheckCircle2 className="h-3.5 w-3.5 text-[#16A34A]" />
            <span className="text-[#16A34A] font-medium">Delivered:</span>
            <span className="font-semibold text-[#16A34A] tabular-nums">{deliveredCount}</span>
          </div>
        </div>
      </div>

      {/* Operational Protocol Banner */}
      <div className="flex items-start gap-2.5 rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] p-4 text-xs text-[#475569] shadow-2xs">
        <ShieldCheck className="h-4 w-4 text-[#2563EB] flex-shrink-0 mt-0.5" />
        <div>
          Delivery milestones are continuously observed by the <strong className="text-[#0F172A]">delivery_watch</strong> autonomous specialist.
          Carrier tracking numbers are cross-referenced with flight manifests and RFID receiving dock sensors.
        </div>
      </div>

      {isLoading ? (
        <SkeletonTable rows={5} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] shadow-sm">
          <table className="w-full text-xs text-left" aria-label="Inbound deliveries">
            <thead>
              <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[#64748B] font-semibold uppercase tracking-wider text-[10px]">
                <th scope="col" className="px-4 py-3">Delivery ID & PO</th>
                <th scope="col" className="px-4 py-3">Material & Quantity</th>
                <th scope="col" className="px-4 py-3">Carrier & Tracking</th>
                <th scope="col" className="px-4 py-3">Transit Route & Bay</th>
                <th scope="col" className="px-4 py-3">Estimated Arrival</th>
                <th scope="col" className="px-4 py-3">Milestone Status</th>
                <th scope="col" className="px-4 py-3">Incident Link</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {deliveries.map(d => (
                <tr key={d.delivery_id} className="hover:bg-[#F8FAFC] transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-mono text-xs font-bold text-[#0F172A]">
                      {d.delivery_id}
                    </div>
                    <div className="font-mono text-[11px] text-[#64748B]">
                      {d.po_number}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-[#0F172A] bg-[#F1F5F9] px-2 py-0.5 rounded border border-[#E2E8F0]">
                        {d.sku}
                      </span>
                      <span className="font-bold text-[#0F172A] tabular-nums">
                        ×{d.quantity}
                      </span>
                    </div>
                    <div className="text-[11px] text-[#475569] truncate max-w-xs mt-0.5">
                      {d.description}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-[#0F172A] flex items-center gap-1.5">
                      {d.carrier}
                    </div>
                    <div className="font-mono text-[11px] text-[#2563EB] flex items-center gap-1 mt-0.5">
                      <span>{d.tracking_number}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-[#475569] flex items-center gap-1">
                      <MapPin className="h-3 w-3 text-[#94A3B8]" />
                      <span>{d.origin}</span>
                    </div>
                    <div className="text-[11px] font-semibold text-[#0F172A] mt-0.5 flex items-center gap-1">
                      <Warehouse className="h-3 w-3 text-[#2563EB]" />
                      <span>{d.destination_bay}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-[#0F172A] flex items-center gap-1">
                      <Clock className="h-3 w-3 text-[#64748B]" />
                      <span>{d.estimated_arrival}</span>
                    </div>
                    <div className="text-[11px] text-[#64748B]">
                      Dispatched: {d.dispatched_at}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {getStatusBadge(d.status)}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      to={`/disruptions/${d.case_id}`}
                      className="font-mono text-xs text-[#2563EB] hover:text-[#1D4ED8] hover:underline font-semibold"
                    >
                      {d.case_id}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
