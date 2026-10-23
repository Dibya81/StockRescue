import { useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Html } from '@react-three/drei'
import * as THREE from 'three'
import type { InventoryRecord } from '@/types/api'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { X, Layers, Box, RotateCcw } from 'lucide-react'

// ─────────────────────────────────────────────────────────
// Bin colours — Arctic White & Royal Blue Enterprise Palette
// ─────────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, THREE.Color> = {
  normal:   new THREE.Color('#16A34A'), // Green
  low:      new THREE.Color('#F59E0B'), // Amber
  shortage: new THREE.Color('#DC2626'), // Red
  unknown:  new THREE.Color('#94A3B8'), // Slate
}

const STATUS_SYMBOLS: Record<string, string> = {
  normal: '✓',
  low: '▲',
  shortage: '✕',
  unknown: '?',
}

function getStatus(inv: InventoryRecord): string {
  if (inv.shortage > 0) return 'shortage'
  if (inv.min_stock_level != null && inv.available_quantity <= inv.min_stock_level) return 'low'
  if (inv.available_quantity > 0) return 'normal'
  return 'unknown'
}

// ─────────────────────────────────────────────────────────
// StorageBin — individual clickable/hoverable bin mesh
// ─────────────────────────────────────────────────────────
interface BinProps {
  position: [number, number, number]
  inv: InventoryRecord
  isSelected: boolean
  isFiltered: boolean
  onSelect: () => void
}

function StorageBin({ position, inv, isSelected, isFiltered, onSelect }: BinProps) {
  const [hovered, setHovered] = useState(false)
  const meshRef = useRef<THREE.Mesh>(null!)
  const status = getStatus(inv)
  const baseColor = STATUS_COLORS[status] ?? STATUS_COLORS.unknown

  useFrame(() => {
    if (!meshRef.current) return
    const mat = meshRef.current.material as THREE.MeshStandardMaterial
    if (isSelected) {
      mat.emissive.set('#2563EB') // Royal Blue selection highlight
      mat.emissiveIntensity = 0.7
    } else if (hovered) {
      mat.emissive.set(baseColor)
      mat.emissiveIntensity = 0.35
    } else {
      mat.emissive.set('#000000')
      mat.emissiveIntensity = 0
    }
    mat.opacity = isFiltered ? 0.2 : 1
  })

  return (
    <mesh
      ref={meshRef}
      position={position}
      onPointerOver={e => {
        e.stopPropagation()
        setHovered(true)
      }}
      onPointerOut={() => setHovered(false)}
      onPointerDown={e => {
        e.stopPropagation()
        onSelect()
      }}
      castShadow
      receiveShadow
    >
      <boxGeometry args={[0.85, 0.75, 0.85]} />
      <meshStandardMaterial
        color={baseColor}
        roughness={0.25}
        metalness={0.15}
        transparent
      />
      {/* Hover tooltip */}
      {hovered && (
        <Html distanceFactor={14} center>
          <div className="pointer-events-none rounded-lg bg-[#FFFFFF]/95 border border-[#E2E8F0] px-2.5 py-1.5 text-xs text-[#0F172A] shadow-xl whitespace-nowrap flex items-center gap-1.5 z-30">
            <span className="font-bold text-[#2563EB]">{STATUS_SYMBOLS[status]}</span>
            <span className="font-mono font-semibold">{inv.sku}</span>
            <span className="text-[#64748B]">• {status}</span>
          </div>
        </Html>
      )}
    </mesh>
  )
}

// ─────────────────────────────────────────────────────────
// Industrial Storage Rack — Light Steel & Aluminum
// ─────────────────────────────────────────────────────────
function Rack({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      {/* Upright steel pillars */}
      {[
        [-0.5, -0.5],
        [0.5, -0.5],
        [-0.5, 0.5],
        [0.5, 0.5],
      ].map(([dx, dz], i) => (
        <mesh key={i} position={[dx, 1.8, dz]} castShadow>
          <boxGeometry args={[0.06, 3.8, 0.06]} />
          <meshStandardMaterial color="#CBD5E1" metalness={0.3} roughness={0.4} />
        </mesh>
      ))}

      {/* Horizontal shelf levels */}
      {[0.4, 1.4, 2.4, 3.4].map(y => (
        <mesh key={y} position={[0, y, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.08, 0.04, 1.08]} />
          <meshStandardMaterial color="#E2E8F0" metalness={0.2} roughness={0.5} />
        </mesh>
      ))}
    </group>
  )
}

// ─────────────────────────────────────────────────────────
// Warehouse Light Slate Concrete Floor
// ─────────────────────────────────────────────────────────
function Floor() {
  return (
    <group position={[0, -0.05, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[48, 48]} />
        <meshStandardMaterial color="#F1F5F9" roughness={0.7} metalness={0.05} />
      </mesh>
      {/* Floor Grid Marker */}
      <gridHelper args={[48, 24, '#CBD5E1', '#E2E8F0']} position={[0, 0.01, 0]} />
    </group>
  )
}

// ─────────────────────────────────────────────────────────
// Warehouse Legend — Glassmorphism Panel
// ─────────────────────────────────────────────────────────
function WarehouseLegend() {
  const items = [
    { status: 'normal', color: '#16A34A', symbol: '✓', label: 'Normal Stock' },
    { status: 'low', color: '#F59E0B', symbol: '▲', label: 'Low Stock' },
    { status: 'shortage', color: '#DC2626', symbol: '✕', label: 'Shortage' },
    { status: 'unknown', color: '#94A3B8', symbol: '?', label: 'Unknown' },
  ]
  return (
    <div className="absolute bottom-4 left-4 rounded-xl border border-white/80 bg-white/85 p-3.5 backdrop-blur-md shadow-lg select-none z-10">
      <div className="flex items-center gap-1.5 mb-2.5 text-xs font-semibold uppercase tracking-wider text-[#475569]">
        <Layers className="h-3.5 w-3.5 text-[#2563EB]" />
        <span>Bin Status Key</span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {items.map(it => (
          <li key={it.status} className="flex items-center gap-2.5">
            <span
              className="h-2.5 w-2.5 rounded-sm flex-shrink-0"
              style={{ backgroundColor: it.color }}
              aria-hidden="true"
            />
            <span className="font-mono text-xs font-bold" style={{ color: it.color }}>
              {it.symbol}
            </span>
            <span className="text-xs font-medium text-[#0F172A]">{it.label}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ─────────────────────────────────────────────────────────
// Selected Bin Detail Panel — Glassmorphism Modal
// ─────────────────────────────────────────────────────────
function BinDetailPanel({
  inv,
  onClose,
}: {
  inv: InventoryRecord
  onClose: () => void
}) {
  const status = getStatus(inv) as any

  return (
    <div
      className="absolute right-4 top-4 w-76 rounded-2xl border border-white/80 bg-white/90 p-5 backdrop-blur-lg shadow-xl z-20"
      role="region"
      aria-label="Selected bin details"
    >
      <div className="flex items-start justify-between border-b border-[#E2E8F0] pb-3 mb-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#EFF6FF] border border-[#2563EB]/20 text-[#2563EB] shadow-2xs">
            <Box className="h-4 w-4" />
          </div>
          <div>
            <p className="font-mono text-sm font-bold text-[#0F172A]">{inv.sku}</p>
            <p className="text-[11px] text-[#64748B]">
              {inv.location ? `Loc: ${inv.location}` : 'Location: Not recorded'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1 text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#0F172A] transition-colors"
          aria-label="Close bin details"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-center justify-between mb-3.5">
        <span className="text-xs font-medium text-[#64748B]">Status State</span>
        <StatusBadge variant={status} />
      </div>

      <dl className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-2.5 shadow-2xs">
          <dt className="text-[#64748B] text-[10px] uppercase font-semibold">Available</dt>
          <dd className="font-mono text-sm font-bold text-[#0F172A] mt-0.5">
            {inv.available_quantity ?? '—'}
          </dd>
        </div>
        <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-2.5 shadow-2xs">
          <dt className="text-[#64748B] text-[10px] uppercase font-semibold">Required</dt>
          <dd className="font-mono text-sm font-bold text-[#0F172A] mt-0.5">
            {inv.required_quantity ?? '—'}
          </dd>
        </div>
        <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-2.5 shadow-2xs">
          <dt className="text-[#64748B] text-[10px] uppercase font-semibold">Shortage</dt>
          <dd
            className={`font-mono text-sm font-bold mt-0.5 ${
              inv.shortage > 0 ? 'text-[#DC2626]' : 'text-[#16A34A]'
            }`}
          >
            {inv.shortage > 0 ? `-${inv.shortage}` : '0'}
          </dd>
        </div>
        <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-2.5 shadow-2xs">
          <dt className="text-[#64748B] text-[10px] uppercase font-semibold">Min Threshold</dt>
          <dd className="font-mono text-sm font-bold text-[#0F172A] mt-0.5">
            {inv.min_stock_level ?? '—'}
          </dd>
        </div>
      </dl>
    </div>
  )
}

// ─────────────────────────────────────────────────────────
// Main WarehouseScene Component
// ─────────────────────────────────────────────────────────
export interface WarehouseSceneProps {
  inventory: InventoryRecord[]
  searchSku: string
  filterStatus: string
}

export function WarehouseScene({
  inventory,
  searchSku,
  filterStatus,
}: WarehouseSceneProps) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
  const controlsRef = useRef<any>(null)

  // Derived grid layout coordinates — clearly labelled as layout, not warehouse measurements
  const displayInventory =
    inventory.length > 0
      ? inventory
      : [
          { sku: 'SKU-DEMO-01', location: 'Aisle 1 / Shelf A', available_quantity: 45, required_quantity: 10, shortage: 0, min_stock_level: 20, status: 'normal' },
          { sku: 'SKU-DEMO-02', location: 'Aisle 1 / Shelf B', available_quantity: 4, required_quantity: 25, shortage: 21, min_stock_level: 10, status: 'shortage' },
          { sku: 'SKU-DEMO-03', location: 'Aisle 2 / Shelf A', available_quantity: 8, required_quantity: 10, shortage: 0, min_stock_level: 15, status: 'low' },
          { sku: 'SKU-DEMO-04', location: 'Aisle 2 / Shelf B', available_quantity: 60, required_quantity: 20, shortage: 0, min_stock_level: 20, status: 'normal' },
        ] as InventoryRecord[]

  const binsWithPos = displayInventory.map((inv, i) => {
    const col = i % 8
    const row = Math.floor(i / 8)
    const shelf = i % 3
    return {
      inv,
      position: [col * 2.2 - 7.7, shelf * 1.0 + 0.9, row * 2.4 - 3] as [
        number,
        number,
        number,
      ],
    }
  })

  const rackPositions: [number, number][] = []
  for (let col = 0; col < 8; col++) {
    for (let row = 0; row < Math.max(2, Math.ceil(displayInventory.length / 8)); row++) {
      rackPositions.push([col * 2.2 - 7.7, row * 2.4 - 3])
    }
  }

  const resetCamera = () => {
    if (controlsRef.current) {
      controlsRef.current.reset()
    }
  }

  return (
    <div className="relative h-full w-full rounded-2xl overflow-hidden border border-[#E2E8F0] bg-[#F8FAFC] shadow-lg">
      {/* Reset Camera Button & Layout Disclaimer */}
      <div className="absolute left-4 top-4 z-10 flex items-center gap-3">
        <button
          type="button"
          onClick={resetCamera}
          className="btn-clay text-xs shadow-sm py-1.5 px-3 flex items-center gap-1.5"
        >
          <RotateCcw className="h-3.5 w-3.5 text-[#2563EB]" />
          Reset Camera
        </button>
        <span className="hidden md:inline text-[11px] text-[#64748B] bg-white/80 px-2.5 py-1 rounded-md border border-[#E2E8F0] backdrop-blur-sm shadow-2xs font-medium">
          Derived visual grid • Orbit with drag • Scroll to zoom
        </span>
      </div>

      <Canvas
        shadows
        camera={{ position: [10, 10, 12], fov: 45 }}
        gl={{ antialias: true, alpha: false }}
        aria-label="Interactive 3D warehouse visualization"
      >
        <color attach="background" args={['#F8FAFC']} />
        <ambientLight intensity={0.85} />
        <directionalLight
          position={[12, 16, 8]}
          intensity={1.2}
          castShadow
          shadow-mapSize={[1024, 1024]}
        />
        <directionalLight position={[-8, 10, -8]} intensity={0.5} />

        <Floor />

        {/* Industrial Racks */}
        {rackPositions.slice(0, 24).map(([x, z], i) => (
          <Rack key={i} x={x} z={z} />
        ))}

        {/* Storage Bins */}
        {binsWithPos.map(({ inv, position }, i) => {
          const status = getStatus(inv)
          const matchSearch =
            !searchSku || inv.sku.toLowerCase().includes(searchSku.toLowerCase())
          const matchFilter = filterStatus === 'all' || status === filterStatus
          const isFiltered = !matchSearch || !matchFilter
          return (
            <StorageBin
              key={`${inv.sku}-${i}`}
              position={position}
              inv={inv}
              isSelected={selectedIdx === i}
              isFiltered={isFiltered}
              onSelect={() => setSelectedIdx(prev => (prev === i ? null : i))}
            />
          )
        })}

        <OrbitControls
          ref={controlsRef}
          minDistance={4}
          maxDistance={35}
          maxPolarAngle={Math.PI / 2.05}
          makeDefault
        />
      </Canvas>

      <WarehouseLegend />

      {selectedIdx !== null && displayInventory[selectedIdx] && (
        <BinDetailPanel
          inv={displayInventory[selectedIdx]}
          onClose={() => setSelectedIdx(null)}
        />
      )}
    </div>
  )
}
