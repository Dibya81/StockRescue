import { memo, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { clsx } from 'clsx'
import { rackFootprint } from '../data/layoutGeometry'
import { patternId, STATUS_STYLES } from '../data/statusMapping'
import type { Equipment, InventoryStatus, Shipment, WarehouseLayout, ZoneKind } from '../data/schemas'
import { StatusPatternDefs } from './StatusGlyph'
import { titleCase } from './format'

export interface RackSummary {
  status: InventoryStatus
  occupied: number
  total: number
}

interface FloorPlanProps {
  layout: WarehouseLayout
  rackSummaries: Map<string, RackSummary>
  shipments: Shipment[]
  equipment: Equipment[]
  selectedRackId: string | null
  /** Racks holding the searched SKU; others are dimmed while set */
  highlightedRackIds: Set<string> | null
  onSelectRack: (rackId: string) => void
}

const ZONE_TINT: Record<ZoneKind, { fill: string; label: string }> = {
  receiving:  { fill: '#EFF6FF', label: '#1E40AF' },
  inspection: { fill: '#FFF7ED', label: '#9A3412' },
  dispatch:   { fill: '#F0FDF4', label: '#166534' },
  storage:    { fill: '#F8FAFC', label: '#334155' },
  equipment:  { fill: '#FEFCE8', label: '#854D0E' },
  control:    { fill: '#F5F3FF', label: '#5B21B6' },
  staging:    { fill: '#F1F5F9', label: '#334155' },
}

const EQUIPMENT_DOT: Record<Equipment['status'], string> = {
  idle: '#94A3B8',
  active: '#1F4FD8',
  charging: '#16A34A',
  maintenance: '#D97706',
}

const TRUCK_AT_DOCK = new Set<Shipment['status']>(['at_dock', 'unloading', 'loading'])
const APRON = 14

interface Tooltip {
  x: number
  y: number
  title: string
  lines: string[]
}

export const FloorPlan = memo(function FloorPlan({
  layout,
  rackSummaries,
  shipments,
  equipment,
  selectedRackId,
  highlightedRackIds,
  onSelectRack,
}: FloorPlanProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [tooltip, setTooltip] = useState<Tooltip | null>(null)
  const { width: W, depth: D } = layout.building

  const viewBox = `${-W / 2 - 2} ${-D / 2 - 2} ${W + 4} ${D + 4 + APRON}`
  const dockById = useMemo(() => new Map(layout.docks.map(d => [d.id, d])), [layout.docks])

  const showTip = (e: MouseEvent, title: string, lines: string[]) => {
    const box = containerRef.current?.getBoundingClientRect()
    if (!box) return
    setTooltip({ x: e.clientX - box.left, y: e.clientY - box.top, title, lines })
  }

  const onRackKey = (e: KeyboardEvent, rackId: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelectRack(rackId)
    }
  }

  return (
    <div ref={containerRef} className="relative w-full" onMouseLeave={() => setTooltip(null)}>
      <svg
        viewBox={viewBox}
        className="block h-auto w-full select-none"
        role="group"
        aria-label={`${layout.name} floor plan`}
      >
        <StatusPatternDefs />
        <defs>
          <pattern id="twin-asphalt" width="1.2" height="1.2" patternUnits="userSpaceOnUse">
            <rect width="1.2" height="1.2" fill="#E2E8F0" />
            <circle cx="0.3" cy="0.4" r="0.06" fill="#CBD5E1" />
            <circle cx="0.9" cy="0.95" r="0.05" fill="#CBD5E1" />
          </pattern>
          <filter id="twin-shadow" x="-10%" y="-10%" width="120%" height="120%">
            <feDropShadow dx="0" dy="0.3" stdDeviation="0.35" floodColor="#0F172A" floodOpacity="0.18" />
          </filter>
        </defs>

        {/* Yard / truck apron */}
        <rect x={-W / 2 - 2} y={D / 2} width={W + 4} height={APRON + 2} fill="url(#twin-asphalt)" />
        <line x1={-W / 2 - 2} x2={W / 2 + 2} y1={D / 2 + APRON - 1.5} y2={D / 2 + APRON - 1.5} stroke="#FFFFFF" strokeWidth="0.25" strokeDasharray="2 1.5" />

        {/* Building slab & walls */}
        <rect x={-W / 2} y={-D / 2} width={W} height={D} fill="#FFFFFF" stroke="#64748B" strokeWidth="0.45" filter="url(#twin-shadow)" />

        {/* Zones */}
        {layout.zones.map(z => {
          const tint = ZONE_TINT[z.kind]
          return (
            <g key={z.id}>
              <rect
                x={z.bounds.x}
                y={z.bounds.z}
                width={z.bounds.width}
                height={z.bounds.depth}
                fill={tint.fill}
                stroke="#CBD5E1"
                strokeWidth="0.12"
                strokeDasharray="0.6 0.4"
                rx="0.4"
              />
              <text x={z.bounds.x + 0.7} y={z.bounds.z + 1.5} fontSize="1.05" fontWeight="600" fill={tint.label} letterSpacing="0.06">
                {z.name.toUpperCase()}
              </text>
            </g>
          )
        })}

        {/* Aisle floor markings */}
        {layout.aisles.map(a => {
          const half = a.width / 2
          const len = a.length
          const alongZ = a.orientation === 'z'
          const x = alongZ ? a.x - half : a.x - len / 2
          const y = alongZ ? a.z - len / 2 : a.z - half
          const w = alongZ ? a.width : len
          const h = alongZ ? len : a.width
          return (
            <g key={a.id}>
              <rect x={x} y={y} width={w} height={h} fill="#F8FAFC" />
              {alongZ ? (
                <>
                  <line x1={x + 0.15} x2={x + 0.15} y1={y} y2={y + h} stroke="#EAB308" strokeWidth="0.14" />
                  <line x1={x + w - 0.15} x2={x + w - 0.15} y1={y} y2={y + h} stroke="#EAB308" strokeWidth="0.14" />
                  <line x1={a.x} x2={a.x} y1={y + 0.4} y2={y + h - 0.4} stroke="#CBD5E1" strokeWidth="0.08" strokeDasharray="0.8 0.6" />
                </>
              ) : (
                <>
                  <line x1={x} x2={x + w} y1={y + 0.15} y2={y + 0.15} stroke="#EAB308" strokeWidth="0.14" />
                  <line x1={x} x2={x + w} y1={y + h - 0.15} y2={y + h - 0.15} stroke="#EAB308" strokeWidth="0.14" />
                </>
              )}
              <text
                x={alongZ ? a.x : x + 0.6}
                y={alongZ ? y + h + 1.4 : a.z + 0.4}
                fontSize="1.1"
                fontWeight="700"
                textAnchor={alongZ ? 'middle' : 'start'}
                fill="#1F4FD8"
                className="font-mono"
              >
                {a.id}
              </text>
            </g>
          )
        })}

        {/* Racks */}
        {layout.racks.map(rack => {
          const fp = rackFootprint(rack, layout)
          const summary = rackSummaries.get(rack.id) ?? { status: 'empty' as const, occupied: 0, total: rack.levels * rack.positionsPerLevel }
          const style = STATUS_STYLES[summary.status]
          const selected = rack.id === selectedRackId
          const dimmed = highlightedRackIds !== null && !highlightedRackIds.has(rack.id)
          const lit = highlightedRackIds?.has(rack.id) ?? false
          return (
            <g
              key={rack.id}
              role="button"
              tabIndex={0}
              aria-label={`Rack ${rack.id}: ${summary.occupied} of ${summary.total} positions occupied, ${style.label}`}
              aria-pressed={selected}
              className="cursor-pointer outline-none [&:focus-visible>rect:last-child]:stroke-[#1F4FD8] [&:focus-visible>rect:last-child]:[stroke-width:0.4]"
              style={{ opacity: dimmed ? 0.28 : 1, transition: 'opacity 300ms ease' }}
              onClick={() => onSelectRack(rack.id)}
              onKeyDown={e => onRackKey(e, rack.id)}
              onMouseMove={e => showTip(e, `Rack ${rack.id}`, [
                `${summary.occupied}/${summary.total} positions occupied`,
                `Worst status: ${style.label}`,
                `${rack.levels} levels × ${rack.positionsPerLevel} positions`,
              ])}
              onMouseLeave={() => setTooltip(null)}
            >
              <rect
                x={fp.x}
                y={fp.z}
                width={fp.w}
                height={fp.d}
                fill={style.color}
                style={{ transition: 'fill 450ms ease' }}
                rx="0.12"
              />
              <rect x={fp.x} y={fp.z} width={fp.w} height={fp.d} fill={`url(#${patternId(summary.status)})`} rx="0.12" />
              <rect
                x={fp.x}
                y={fp.z}
                width={fp.w}
                height={fp.d}
                fill="none"
                rx="0.12"
                stroke={selected || lit ? '#1F4FD8' : 'rgba(15,23,42,0.25)'}
                strokeWidth={selected ? 0.42 : lit ? 0.3 : 0.06}
                className={clsx(lit && !selected && 'animate-pulse')}
              />
            </g>
          )
        })}

        {/* Docks */}
        {layout.docks.map(d => {
          const occupied = d.status === 'occupied'
          return (
            <g key={d.id}>
              <rect
                x={d.x - 1.8}
                y={d.z - 0.45}
                width="3.6"
                height="0.9"
                rx="0.15"
                fill={occupied ? '#1F4FD8' : d.status === 'maintenance' ? '#D97706' : '#94A3B8'}
                style={{ transition: 'fill 400ms ease' }}
              />
              <text x={d.x} y={d.z + 2} fontSize="0.9" textAnchor="middle" fontWeight="600" fill="#334155">
                {d.label}
              </text>
              <text x={d.x} y={d.z + 3.1} fontSize="0.7" textAnchor="middle" fill="#64748B">
                {d.purpose}
              </text>
            </g>
          )
        })}

        {/* Trucks: drawn only for shipment records that place them here */}
        {shipments.map(s => {
          if (s.status === 'scheduled' || s.status === 'departed' || !s.dockId) return null
          const dock = dockById.get(s.dockId)
          if (!dock) return null
          const docked = TRUCK_AT_DOCK.has(s.status)
          const y = docked ? dock.z + 0.5 : dock.z + APRON - 3.2
          const length = s.vehicleType === 'delivery_truck' ? 7 : 10.5
          return (
            <g
              key={s.id}
              className="animate-fade-in"
              onMouseMove={e => showTip(e, s.id, [
                `${titleCase(s.vehicleType)} · ${s.supplier.name}`,
                `Status: ${titleCase(s.status)}`,
                s.sku ? `${s.qty ?? '?'} × ${s.sku}` : 'No cargo line on record',
              ])}
              onMouseLeave={() => setTooltip(null)}
            >
              {docked ? (
                <>
                  <rect x={dock.x - 1.25} y={y} width="2.5" height={length} rx="0.2" fill="#F8FAFC" stroke="#1F4FD8" strokeWidth="0.18" />
                  <rect x={dock.x - 1.15} y={y + length} width="2.3" height="2" rx="0.3" fill="#1F4FD8" />
                </>
              ) : (
                <>
                  <rect x={dock.x - 1.25} y={y} width="2.5" height={length * 0.3} rx="0.2" fill="#F8FAFC" stroke="#0891B2" strokeWidth="0.18" strokeDasharray="0.5 0.3" />
                  <text x={dock.x} y={y - 0.5} fontSize="0.75" textAnchor="middle" fill="#0E7490" fontWeight="600">
                    arriving
                  </text>
                </>
              )}
            </g>
          )
        })}

        {/* Inbound markers for scheduled shipments with an assigned dock */}
        {shipments.filter(s => s.status === 'scheduled' && s.dockId).map(s => {
          const dock = dockById.get(s.dockId ?? '')
          if (!dock) return null
          return (
            <g key={`m-${s.id}`} onMouseMove={e => showTip(e, s.id, ['Scheduled inbound', s.supplier.name])} onMouseLeave={() => setTooltip(null)}>
              <path d={`M${dock.x} ${dock.z - 1.1} l0.7 -1 h-1.4 z`} fill="#0891B2" />
            </g>
          )
        })}

        {/* Equipment parked at home bays (positions are not tracked) */}
        {equipment.map(eq => (
          <g
            key={eq.id}
            onMouseMove={e => showTip(e, eq.label, [
              `Status: ${titleCase(eq.status)}`,
              eq.currentTask ? eq.currentTask.description : 'No task assigned',
            ])}
            onMouseLeave={() => setTooltip(null)}
          >
            {eq.status === 'active' && (
              <circle cx={eq.home.x} cy={eq.home.z} r="0.9" fill="none" stroke="#1F4FD8" strokeWidth="0.15" className="animate-pulse" />
            )}
            <circle cx={eq.home.x} cy={eq.home.z} r="0.6" fill={EQUIPMENT_DOT[eq.status]} stroke="#FFFFFF" strokeWidth="0.15" style={{ transition: 'fill 400ms ease' }} />
            <text x={eq.home.x} y={eq.home.z + 1.6} fontSize="0.6" textAnchor="middle" fill="#475569" className="font-mono">
              {eq.id}
            </text>
          </g>
        ))}
      </svg>

      {tooltip && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 max-w-[240px] -translate-x-1/2 -translate-y-[calc(100%+12px)] rounded-lg bg-[#0F172A] px-3 py-2 text-xs text-white shadow-lg"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <p className="font-semibold">{tooltip.title}</p>
          {tooltip.lines.map(l => (
            <p key={l} className="text-[#CBD5E1]">{l}</p>
          ))}
        </div>
      )}
    </div>
  )
})
