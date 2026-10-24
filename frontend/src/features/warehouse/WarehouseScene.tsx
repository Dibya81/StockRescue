import React, { useRef, useState, useMemo, useEffect, useCallback } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Html } from '@react-three/drei'
import * as THREE from 'three'
import type { InventoryRecord } from '@/types/api'
import { StatusBadge } from '@/components/ui/StatusBadge'
import {
  Layers,
  Box,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  MapPin,
  Maximize2,
  X,
  Package,
} from 'lucide-react'

// ─────────────────────────────────────────────────────────
// Color Palette & Design System Tokens (Light Industrial Theme)
// ─────────────────────────────────────────────────────────
const COLORS = {
  bg: '#F8FAFC',
  floor: '#F1F5F9',
  floorJoint: '#E2E8F0',
  safetyYellow: '#F59E0B',
  hazardDark: '#1E293B',
  steelColumn: '#CBD5E1',
  steelColumnSelected: '#93C5FD',
  beamSafety: '#2563EB', // Royal Blue structural accents
  beamOrange: '#EA580C', // Industrial powder-coat beam safety orange
  wireDeck: '#94A3B8',
  woodPallet: '#D4C5B9',
  woodPalletDark: '#B8A695',
  cartonKraft: '#E5D5C5',
  cartonTape: '#CBB5A1',
  cartonSelected: '#DBEAFE',
  statusNormal: '#16A34A',
  statusLow: '#F59E0B',
  statusShortage: '#DC2626',
  statusUnknown: '#94A3B8',
  primaryBlue: '#2563EB',
}

export type CameraPreset = 'overview' | 'aisleA' | 'aisleB' | 'plan' | 'staging'

const CAMERA_PRESETS: Record<CameraPreset, { position: [number, number, number]; target: [number, number, number] }> = {
  overview: { position: [16, 12, 16], target: [0, 1.2, 0] },
  aisleA:   { position: [-3.4, 2.8, 12.0], target: [-5.5, 1.8, -2.0] },
  aisleB:   { position: [3.4, 2.8, 12.0], target: [5.5, 1.8, -2.0] },
  plan:     { position: [0, 24, 0.01], target: [0, 0, 0] },
  staging:  { position: [0, 4.5, 15.0], target: [0, 0.5, 8.5] },
}

export interface StorageSlot {
  id: string
  aisle: 'A' | 'B'
  bay: number // 1..4
  level: number // 1..3
  position: 1 | 2 // 1: left, 2: right
  worldPos: [number, number, number]
  inv?: InventoryRecord
}

function getRecordStatus(inv?: InventoryRecord): 'normal' | 'low' | 'shortage' | 'unknown' {
  if (!inv) return 'unknown'
  if (inv.shortage > 0) return 'shortage'
  if (inv.min_stock_level != null && inv.available_quantity <= inv.min_stock_level) return 'low'
  if (inv.available_quantity > 0) return 'normal'
  return 'unknown'
}

// ─────────────────────────────────────────────────────────
// Smooth Camera Controller with Lerping & Free Orbit/Zoom
// ─────────────────────────────────────────────────────────
function CameraController({
  targetPos,
  targetLookAt,
  controlsRef,
  onTransitionComplete,
}: {
  targetPos: [number, number, number] | null
  targetLookAt: [number, number, number] | null
  controlsRef: React.MutableRefObject<any>
  onTransitionComplete?: () => void
}) {
  const { camera } = useThree()
  const isTransitioning = useRef(false)
  const destPos = useRef<THREE.Vector3 | null>(null)
  const destLookAt = useRef<THREE.Vector3 | null>(null)

  useEffect(() => {
    if (targetPos || targetLookAt) {
      if (targetPos) destPos.current = new THREE.Vector3(...targetPos)
      if (targetLookAt) destLookAt.current = new THREE.Vector3(...targetLookAt)
      isTransitioning.current = true
    } else {
      isTransitioning.current = false
      destPos.current = null
      destLookAt.current = null
    }
  }, [targetPos, targetLookAt])

  useFrame((_, delta) => {
    if (!controlsRef.current || !isTransitioning.current) return

    const damping = Math.min(1, delta * 5.0)
    let posDone = true
    let lookDone = true

    if (destLookAt.current) {
      controlsRef.current.target.lerp(destLookAt.current, damping)
      if (controlsRef.current.target.distanceTo(destLookAt.current) > 0.04) {
        lookDone = false
      }
    }

    if (destPos.current) {
      camera.position.lerp(destPos.current, damping)
      if (camera.position.distanceTo(destPos.current) > 0.04) {
        posDone = false
      }
    }

    controlsRef.current.update()

    if (posDone && lookDone) {
      isTransitioning.current = false
      destPos.current = null
      destLookAt.current = null
      if (onTransitionComplete) {
        onTransitionComplete()
      }
    }
  })

  return null
}

// ─────────────────────────────────────────────────────────
// Architectural Concrete Floor & Industrial Striping
// ─────────────────────────────────────────────────────────
function WarehouseFloor() {
  return (
    <group position={[0, -0.01, 0]}>
      {/* Polished Concrete Slab */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[38, 30]} />
        <meshStandardMaterial color={COLORS.floor} roughness={0.78} metalness={0.06} />
      </mesh>

      {/* Concrete Joint Seam Lines */}
      <gridHelper args={[36, 12, COLORS.floorJoint, COLORS.floorJoint]} position={[0, 0.002, 0]} />

      {/* Central Forklift Boulevard Striping (Z: -12 to +8) */}
      <mesh position={[-2.4, 0.004, -2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.08, 20]} />
        <meshBasicMaterial color={COLORS.safetyYellow} />
      </mesh>
      <mesh position={[2.4, 0.004, -2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.08, 20]} />
        <meshBasicMaterial color={COLORS.safetyYellow} />
      </mesh>

      {/* Aisle A Boundary Line */}
      <mesh position={[-9.6, 0.004, -2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.06, 20]} />
        <meshBasicMaterial color="#CBD5E1" />
      </mesh>
      {/* Aisle B Boundary Line */}
      <mesh position={[9.6, 0.004, -2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.06, 20]} />
        <meshBasicMaterial color="#CBD5E1" />
      </mesh>

      {/* Inbound Staging & Receiving Hazard Bay (Z: 8.5 to 13.5) */}
      <group position={[0, 0.004, 10.5]}>
        {/* Perimeter Safety Floor */}
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[16, 5]} />
          <meshStandardMaterial color="#E2E8F0" roughness={0.9} />
        </mesh>
        {/* Yellow Boundary */}
        {[-8, 8].map((x, i) => (
          <mesh key={`h-border-${i}`} position={[x, 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.1, 5]} />
            <meshBasicMaterial color={COLORS.safetyYellow} />
          </mesh>
        ))}
        {[-2.5, 2.5].map((z, i) => (
          <mesh key={`h-border-z-${i}`} position={[0, 0.001, z]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[16, 0.1]} />
            <meshBasicMaterial color={COLORS.safetyYellow} />
          </mesh>
        ))}
      </group>

      {/* Painted Industrial Decals on Floor */}
      <Html position={[-5.8, 0.01, 8.8]} rotation={[-Math.PI / 2, 0, 0]} transform pointerEvents="none">
        <div className="font-mono text-[10px] font-bold text-[#64748B] tracking-widest uppercase border border-[#CBD5E1] bg-white/70 px-2 py-0.5 rounded shadow-2xs">
          AISLE A • ZONE 1
        </div>
      </Html>
      <Html position={[5.8, 0.01, 8.8]} rotation={[-Math.PI / 2, 0, 0]} transform pointerEvents="none">
        <div className="font-mono text-[10px] font-bold text-[#64748B] tracking-widest uppercase border border-[#CBD5E1] bg-white/70 px-2 py-0.5 rounded shadow-2xs">
          AISLE B • ZONE 2
        </div>
      </Html>
      <Html position={[0, 0.01, 12.8]} rotation={[-Math.PI / 2, 0, 0]} transform pointerEvents="none">
        <div className="font-mono text-[10px] font-bold text-[#D97706] tracking-widest uppercase border border-[#F59E0B]/40 bg-[#FEF3C7]/80 px-2.5 py-0.5 rounded shadow-2xs">
          STAGING & INBOUND BUFFER
        </div>
      </Html>
    </group>
  )
}

// ─────────────────────────────────────────────────────────
// Structural Steel Warehouse Columns & Overhead Trusses
// ─────────────────────────────────────────────────────────
function BuildingStructure() {
  const columnPositions: [number, number][] = [
    [-17, -13], [-17, 0], [-17, 13],
    [17, -13],  [17, 0],  [17, 13],
  ]

  return (
    <group>
      {/* Perimeter Steel I-Columns */}
      {columnPositions.map(([x, z], i) => (
        <group key={`col-${i}`} position={[x, 3.25, z]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[0.35, 6.5, 0.35]} />
            <meshStandardMaterial color={COLORS.steelColumn} roughness={0.4} metalness={0.5} />
          </mesh>
          {/* Baseplate */}
          <mesh position={[0, -3.2, 0]}>
            <boxGeometry args={[0.65, 0.08, 0.65]} />
            <meshStandardMaterial color="#94A3B8" roughness={0.5} metalness={0.4} />
          </mesh>
        </group>
      ))}

      {/* Overhead High-Bay Roof Trusses (above racks at Y = 5.8) */}
      {[-8, -2, 4].map(z => (
        <group key={`truss-${z}`} position={[0, 5.8, z]}>
          {/* Main Cross Beam */}
          <mesh>
            <boxGeometry args={[34, 0.16, 0.16]} />
            <meshStandardMaterial color="#E2E8F0" roughness={0.4} metalness={0.3} />
          </mesh>
          {/* High-Bay Linear LED Lighting Fixtures */}
          {[-6.0, 0, 6.0].map((x, j) => (
            <mesh key={`light-${j}`} position={[x, -0.2, 0]}>
              <boxGeometry args={[1.6, 0.08, 0.25]} />
              <meshStandardMaterial color="#FFFFFF" emissive="#FFFFFF" emissiveIntensity={0.6} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  )
}

// ─────────────────────────────────────────────────────────
// Industrial Pallet Rack Bay (Columns, Diagonal Bracing, Beams)
// ─────────────────────────────────────────────────────────
interface RackBayProps {
  x: number
  z: number
  bayWidth?: number
  bayDepth?: number
  levels: number[]
  isEndBay?: boolean
  isSelectedBay?: boolean
}

function IndustrialRackBay({
  x,
  z,
  bayWidth = 2.6,
  bayDepth = 1.1,
  levels = [0.35, 1.75, 3.15],
  isEndBay = false,
  isSelectedBay = false,
}: RackBayProps) {
  const halfW = bayWidth / 2
  const halfD = bayDepth / 2
  const uprightH = 4.4

  return (
    <group position={[x, 0, z]}>
      {/* 4 Vertical Upright Columns */}
      {[
        [-halfW, -halfD],
        [-halfW, halfD],
        [halfW, -halfD],
        [halfW, halfD],
      ].map(([cx, cz], i) => (
        <group key={`upright-${i}`} position={[cx, uprightH / 2, cz]}>
          {/* Steel Column C-Channel */}
          <mesh castShadow>
            <boxGeometry args={[0.07, uprightH, 0.07]} />
            <meshStandardMaterial
              color={isSelectedBay ? COLORS.steelColumnSelected : COLORS.steelColumn}
              roughness={0.35}
              metalness={0.45}
            />
          </mesh>
          {/* Floor Baseplate */}
          <mesh position={[0, -uprightH / 2 + 0.02, 0]}>
            <boxGeometry args={[0.16, 0.04, 0.16]} />
            <meshStandardMaterial color="#94A3B8" roughness={0.4} />
          </mesh>
        </group>
      ))}

      {/* End-Row Safety Yellow Column Guard (Forklift Protection) */}
      {isEndBay && (
        <group position={[halfW + 0.02, 0.35, 0]}>
          <mesh position={[0, 0, -halfD]}>
            <cylinderGeometry args={[0.08, 0.08, 0.7, 12]} />
            <meshStandardMaterial color={COLORS.safetyYellow} roughness={0.3} metalness={0.2} />
          </mesh>
          <mesh position={[0, 0, halfD]}>
            <cylinderGeometry args={[0.08, 0.08, 0.7, 12]} />
            <meshStandardMaterial color={COLORS.safetyYellow} roughness={0.3} metalness={0.2} />
          </mesh>
          <mesh position={[0, 0, 0]}>
            <boxGeometry args={[0.08, 0.12, bayDepth]} />
            <meshStandardMaterial color={COLORS.safetyYellow} roughness={0.3} metalness={0.2} />
          </mesh>
        </group>
      )}

      {/* Diagonal & Horizontal Lattice Bracing between front/rear uprights */}
      {[-halfW, halfW].map((sideX, sIdx) => (
        <group key={`truss-side-${sIdx}`} position={[sideX, 0, 0]}>
          {[0.8, 1.8, 2.8, 3.8].map(h => (
            <mesh key={`diag-${h}`} position={[0, h, 0]} rotation={[0, 0, Math.PI / 6]}>
              <boxGeometry args={[0.03, bayDepth * 0.95, 0.03]} />
              <meshStandardMaterial color="#CBD5E1" roughness={0.4} metalness={0.4} />
            </mesh>
          ))}
        </group>
      ))}

      {/* Horizontal Step Beams at Each Tier Level */}
      {levels.map((y, lIdx) => (
        <group key={`level-${lIdx}`} position={[0, y, 0]}>
          {/* Front Load Beam */}
          <mesh position={[0, 0, halfD]} castShadow receiveShadow>
            <boxGeometry args={[bayWidth, 0.09, 0.05]} />
            <meshStandardMaterial
              color={isSelectedBay ? COLORS.beamSafety : COLORS.beamOrange}
              roughness={0.35}
              metalness={0.3}
            />
          </mesh>
          {/* Rear Load Beam */}
          <mesh position={[0, 0, -halfD]} castShadow receiveShadow>
            <boxGeometry args={[bayWidth, 0.09, 0.05]} />
            <meshStandardMaterial
              color={isSelectedBay ? COLORS.beamSafety : COLORS.beamOrange}
              roughness={0.35}
              metalness={0.3}
            />
          </mesh>

          {/* Wire Mesh Waterfall Decking (Supports pallets) */}
          <mesh position={[0, 0.03, 0]} receiveShadow>
            <boxGeometry args={[bayWidth - 0.08, 0.02, bayDepth - 0.08]} />
            <meshStandardMaterial
              color={COLORS.wireDeck}
              roughness={0.65}
              metalness={0.25}
            />
          </mesh>
        </group>
      ))}
    </group>
  )
}

// ─────────────────────────────────────────────────────────
// Realistic Pallet + Packaging Unit with Interactive Events
// ─────────────────────────────────────────────────────────
interface PalletUnitProps {
  slot: StorageSlot
  isSelected: boolean
  isDimmed: boolean
  onSelect: (slot: StorageSlot) => void
}

function PalletUnit({ slot, isSelected, isDimmed, onSelect }: PalletUnitProps) {
  const [hovered, setHovered] = useState(false)
  const meshRef = useRef<THREE.Group>(null!)
  const status = getRecordStatus(slot.inv)

  // Status badge indicator color
  const statusColor =
    status === 'shortage'
      ? COLORS.statusShortage
      : status === 'low'
      ? COLORS.statusLow
      : status === 'normal'
      ? COLORS.statusNormal
      : COLORS.statusUnknown

  const hasItem = !!slot.inv

  useFrame(() => {
    if (!meshRef.current) return
    if (isSelected) {
      meshRef.current.position.y = slot.worldPos[1] + Math.sin(Date.now() * 0.005) * 0.025
    } else {
      meshRef.current.position.y = slot.worldPos[1]
    }
  })

  return (
    <group
      ref={meshRef}
      position={slot.worldPos}
      onPointerOver={e => {
        e.stopPropagation()
        setHovered(true)
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => {
        setHovered(false)
        document.body.style.cursor = 'default'
      }}
      onPointerDown={e => {
        e.stopPropagation()
        onSelect(slot)
      }}
    >
      {/* ── Generous Invisible Hit Box for Easy Clicking ── */}
      <mesh visible={false} position={[0, 0.5, 0]}>
        <boxGeometry args={[1.15, 1.25, 1.05]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>

      {/* ── 1. Timber Pallet Base (1.1m x 1.0m) ── */}
      <group position={[0, 0.07, 0]}>
        {/* 3 Bottom Runner Skids with fork pocket gaps */}
        {[-0.42, 0, 0.42].map((pz, idx) => (
          <mesh key={`runner-${idx}`} position={[0, -0.04, pz]} castShadow receiveShadow>
            <boxGeometry args={[1.05, 0.06, 0.08]} />
            <meshStandardMaterial color={COLORS.woodPalletDark} roughness={0.88} />
          </mesh>
        ))}
        {/* 5 Top Deck Slats */}
        {[-0.45, -0.22, 0, 0.22, 0.45].map((pz, idx) => (
          <mesh key={`slat-${idx}`} position={[0, 0.02, pz]} castShadow receiveShadow>
            <boxGeometry args={[1.08, 0.025, 0.14]} />
            <meshStandardMaterial color={COLORS.woodPallet} roughness={0.85} />
          </mesh>
        ))}
      </group>

      {/* ── 2. Stored Cartons / Totes (if inventory exists) ── */}
      {hasItem ? (
        <group position={[0, 0.48, 0]}>
          {/* Main Unit Load: 2x2 Neatly Stacked Master Cartons */}
          <mesh castShadow receiveShadow>
            <boxGeometry args={[0.96, 0.72, 0.92]} />
            <meshStandardMaterial
              color={isSelected ? COLORS.cartonSelected : COLORS.cartonKraft}
              roughness={0.7}
              metalness={0.05}
              transparent={isDimmed}
              opacity={isDimmed ? 0.3 : 1.0}
            />
          </mesh>

          {/* Pallet Corner Packaging Protector Trim / Banding */}
          <mesh position={[0, 0, 0]}>
            <boxGeometry args={[0.97, 0.06, 0.93]} />
            <meshStandardMaterial color={COLORS.cartonTape} roughness={0.6} />
          </mesh>

          {/* Barcode / LPN Identification Tag on Front Face */}
          <mesh position={[0, -0.05, 0.47]}>
            <planeGeometry args={[0.42, 0.22]} />
            <meshBasicMaterial color="#FFFFFF" />
          </mesh>

          {/* Front Semantic Status Seal / Inspection Pill */}
          <group position={[0, 0.16, 0.47]}>
            <mesh>
              <planeGeometry args={[0.32, 0.1]} />
              <meshBasicMaterial color={statusColor} />
            </mesh>
          </group>

          {/* Selection Wire Highlight Frame */}
          {isSelected && (
            <mesh position={[0, 0, 0]}>
              <boxGeometry args={[1.04, 0.8, 1.0]} />
              <meshBasicMaterial color={COLORS.primaryBlue} wireframe />
            </mesh>
          )}
        </group>
      ) : (
        /* Empty Slot Indicator (Wire Deck visible, waiting for pallet) */
        <group position={[0, 0.14, 0]}>
          <mesh>
            <boxGeometry args={[0.9, 0.02, 0.85]} />
            <meshStandardMaterial color="#E2E8F0" roughness={0.9} transparent opacity={0.6} />
          </mesh>
        </group>
      )}

      {/* ── 3. Interactive HTML Floating Tooltip on Hover ── */}
      {hovered && (
        <Html distanceFactor={13} center position={[0, 1.15, 0]} pointerEvents="none">
          <div className="rounded-xl border border-white/80 bg-white/95 px-3 py-2 text-xs text-[#0F172A] shadow-xl backdrop-blur-md whitespace-nowrap flex flex-col gap-1 z-40">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] font-bold uppercase text-[#2563EB] bg-[#EFF6FF] px-1.5 py-0.5 rounded border border-[#2563EB]/20">
                {slot.id}
              </span>
              <span className="font-bold text-xs">{hasItem ? slot.inv?.sku : 'Empty Compartment'}</span>
            </div>
            {hasItem && (
              <div className="flex items-center gap-2 text-[11px] text-[#64748B]">
                <span>Qty: <strong className="text-[#0F172A] font-semibold">{slot.inv?.available_quantity}</strong></span>
                <span>•</span>
                <span className="capitalize font-medium" style={{ color: statusColor }}>{status}</span>
                {slot.inv && slot.inv.shortage > 0 && (
                  <span className="text-[#DC2626] font-bold">(-{slot.inv.shortage})</span>
                )}
              </div>
            )}
            <div className="text-[10px] text-[#94A3B8]">Click to inspect details</div>
          </div>
        </Html>
      )}
    </group>
  )
}

// ─────────────────────────────────────────────────────────
// Slide-in Warehouse Information Drawer (Right Side)
// ─────────────────────────────────────────────────────────
function WarehouseDetailDrawer({
  slot,
  onClose,
  onFocus,
}: {
  slot: StorageSlot
  onClose: () => void
  onFocus: () => void
}) {
  const inv = slot.inv
  const status = getRecordStatus(inv)

  return (
    <aside
      className="absolute right-4 top-4 bottom-4 w-80 md:w-92 rounded-2xl border border-white/80 bg-white/95 p-5 backdrop-blur-xl shadow-2xl z-30 flex flex-col justify-between overflow-y-auto animate-fade-in"
      role="region"
      aria-label="Storage Location Inspector"
    >
      <div className="flex flex-col gap-4">
        {/* Drawer Header */}
        <div className="flex items-start justify-between border-b border-[#E2E8F0] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#EFF6FF] border border-[#2563EB]/25 text-[#2563EB] shadow-2xs">
              <Box className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-[#2563EB] uppercase">
                  {slot.id}
                </span>
                <span className="rounded bg-[#F1F5F9] px-1.5 py-0.5 text-[10px] font-mono text-[#64748B] border border-[#E2E8F0]">
                  Aisle {slot.aisle} • Bay {slot.bay}
                </span>
              </div>
              <h2 className="text-sm font-bold text-[#0F172A] mt-0.5">
                {inv ? inv.sku : 'Ready Storage Position'}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#0F172A] transition-colors"
            aria-label="Close inspector"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Status Pill Strip */}
        <div className="flex items-center justify-between rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3 shadow-2xs">
          <span className="text-xs font-medium text-[#64748B]">Operational State</span>
          {inv ? (
            <StatusBadge variant={status} />
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#CBD5E1] bg-[#F1F5F9] px-2.5 py-0.5 text-xs font-semibold text-[#64748B]">
              Ready / Unassigned
            </span>
          )}
        </div>

        {/* Quantities & Inventory Metrics */}
        {inv ? (
          <dl className="grid grid-cols-2 gap-2.5 text-xs">
            <div className="rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] p-3 shadow-2xs">
              <dt className="text-[10px] uppercase font-semibold text-[#64748B]">Available On Hand</dt>
              <dd className="font-mono text-base font-bold text-[#0F172A] mt-1">
                {inv.available_quantity ?? 0}
              </dd>
            </div>
            <div className="rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] p-3 shadow-2xs">
              <dt className="text-[10px] uppercase font-semibold text-[#64748B]">Required Target</dt>
              <dd className="font-mono text-base font-bold text-[#0F172A] mt-1">
                {inv.required_quantity ?? 0}
              </dd>
            </div>
            <div className="rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] p-3 shadow-2xs">
              <dt className="text-[10px] uppercase font-semibold text-[#64748B]">Deficit / Shortage</dt>
              <dd
                className={`font-mono text-base font-bold mt-1 ${
                  inv.shortage > 0 ? 'text-[#DC2626]' : 'text-[#16A34A]'
                }`}
              >
                {inv.shortage > 0 ? `-${inv.shortage}` : '0'}
              </dd>
            </div>
            <div className="rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] p-3 shadow-2xs">
              <dt className="text-[10px] uppercase font-semibold text-[#64748B]">Buffer Threshold</dt>
              <dd className="font-mono text-base font-bold text-[#0F172A] mt-1">
                {inv.min_stock_level ?? '—'}
              </dd>
            </div>
          </dl>
        ) : (
          <div className="rounded-xl border border-dashed border-[#CBD5E1] p-4 text-center text-xs text-[#64748B] flex flex-col items-center gap-2">
            <Package className="h-6 w-6 text-[#94A3B8]" />
            <span>This rack slot is vacant and ready for incoming vendor stock or BOM allocations.</span>
          </div>
        )}

        {/* Storage Location Spatial Coordinates */}
        <div className="rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] p-3 text-xs flex flex-col gap-2 shadow-2xs">
          <span className="text-[10px] uppercase font-semibold text-[#64748B] flex items-center gap-1.5">
            <MapPin className="h-3 w-3 text-[#2563EB]" />
            Warehouse Spatial Address
          </span>
          <div className="grid grid-cols-3 gap-1 text-[11px] text-[#0F172A] font-mono">
            <div>Tier: Level {slot.level}</div>
            <div>Bay: #{slot.bay}</div>
            <div>Pos: Slot {slot.position}</div>
          </div>
          {inv?.location && (
            <div className="text-[11px] text-[#64748B] pt-1 border-t border-[#E2E8F0]">
              Recorded Coordinate: <strong className="text-[#0F172A]">{inv.location}</strong>
            </div>
          )}
        </div>
      </div>

      {/* Action Footer */}
      <div className="mt-4 flex flex-col gap-2 pt-3 border-t border-[#E2E8F0]">
        <button
          type="button"
          onClick={onFocus}
          className="btn-clay text-xs py-2 flex items-center justify-center gap-2 font-semibold text-[#2563EB]"
        >
          <Maximize2 className="h-3.5 w-3.5 text-[#2563EB]" />
          Center Camera on Location
        </button>
      </div>
    </aside>
  )
}

// ─────────────────────────────────────────────────────────
// Floating View Controls & Preset Toolbar
// ─────────────────────────────────────────────────────────
function WarehouseControlsToolbar({
  activePreset,
  onSelectPreset,
  onReset,
  onZoomIn,
  onZoomOut,
}: {
  activePreset: CameraPreset
  onSelectPreset: (preset: CameraPreset) => void
  onReset: () => void
  onZoomIn: () => void
  onZoomOut: () => void
}) {
  const presets: { id: CameraPreset; label: string }[] = [
    { id: 'overview', label: 'Isometric Overview' },
    { id: 'aisleA',   label: 'Aisle A' },
    { id: 'aisleB',   label: 'Aisle B' },
    { id: 'staging',  label: 'Staging Bay' },
    { id: 'plan',     label: 'Top Plan' },
  ]

  return (
    <div className="absolute left-4 top-4 z-20 flex flex-wrap items-center gap-2 select-none">
      {/* Preset Pills */}
      <div className="inline-flex rounded-xl border border-white/80 bg-white/90 p-1 backdrop-blur-md shadow-md">
        {presets.map(p => (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelectPreset(p.id)}
            className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
              activePreset === p.id
                ? 'bg-[#2563EB] text-[#FFFFFF] shadow-xs'
                : 'text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A]'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Camera Reset & Zoom Controls */}
      <div className="inline-flex items-center gap-1 rounded-xl border border-white/80 bg-white/90 p-1 backdrop-blur-md shadow-md">
        <button
          type="button"
          onClick={onReset}
          className="btn-clay text-xs p-1.5 rounded-lg text-[#0F172A]"
          title="Reset Camera View"
          aria-label="Reset Camera View"
        >
          <RotateCcw className="h-3.5 w-3.5 text-[#2563EB]" />
        </button>
        <button
          type="button"
          onClick={onZoomIn}
          className="btn-clay text-xs p-1.5 rounded-lg text-[#0F172A]"
          title="Zoom In"
          aria-label="Zoom In"
        >
          <ZoomIn className="h-3.5 w-3.5 text-[#64748B]" />
        </button>
        <button
          type="button"
          onClick={onZoomOut}
          className="btn-clay text-xs p-1.5 rounded-lg text-[#0F172A]"
          title="Zoom Out"
          aria-label="Zoom Out"
        >
          <ZoomOut className="h-3.5 w-3.5 text-[#64748B]" />
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────
// Bottom Legend Panel
// ─────────────────────────────────────────────────────────
function WarehouseLegend() {
  const items = [
    { label: 'Normal / Healthy', color: COLORS.statusNormal, desc: 'Stock >= required' },
    { label: 'Low Buffer',       color: COLORS.statusLow,    desc: 'Stock <= minimum threshold' },
    { label: 'Shortage Deficit', color: COLORS.statusShortage, desc: 'Active BOM deficit' },
    { label: 'Empty Position',   color: '#CBD5E1',           desc: 'Available pallet compartment' },
  ]

  return (
    <div className="absolute bottom-5 left-5 rounded-xl border border-white/85 bg-white/90 p-3 backdrop-blur-md shadow-lg select-none z-10 hidden sm:block">
      <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold uppercase tracking-wider text-[#475569]">
        <Layers className="h-3.5 w-3.5 text-[#2563EB]" />
        <span>Industrial Storage Key</span>
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {items.map(it => (
          <li key={it.label} className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-sm flex-shrink-0 shadow-2xs"
              style={{ backgroundColor: it.color }}
              aria-hidden="true"
            />
            <span className="text-xs font-medium text-[#0F172A]">{it.label}</span>
          </li>
        ))}
      </ul>
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
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null)
  const [activePreset, setActivePreset] = useState<CameraPreset>('overview')
  const [targetPos, setTargetPos] = useState<[number, number, number] | null>(null)
  const [targetLookAt, setTargetLookAt] = useState<[number, number, number] | null>(null)
  const controlsRef = useRef<any>(null)

  const handleTransitionComplete = useCallback(() => {
    setTargetPos(null)
    setTargetLookAt(null)
  }, [])

  const handleManualControlStart = useCallback(() => {
    setTargetPos(null)
    setTargetLookAt(null)
  }, [])

  // 1. Resolve display records: use real inventory or initial fallback records
  const displayInventory = useMemo(() => {
    if (inventory.length > 0) return inventory
    return [
      { sku: 'SKU-DEMO-01', location: 'Aisle A / Bay 1 / L1', available_quantity: 45, required_quantity: 10, shortage: 0, min_stock_level: 20, status: 'normal' },
      { sku: 'SKU-DEMO-02', location: 'Aisle A / Bay 2 / L2', available_quantity: 4, required_quantity: 25, shortage: 21, min_stock_level: 10, status: 'shortage' },
      { sku: 'SKU-DEMO-03', location: 'Aisle B / Bay 1 / L1', available_quantity: 8, required_quantity: 10, shortage: 0, min_stock_level: 15, status: 'low' },
      { sku: 'SKU-DEMO-04', location: 'Aisle B / Bay 3 / L3', available_quantity: 60, required_quantity: 20, shortage: 0, min_stock_level: 20, status: 'normal' },
    ] as InventoryRecord[]
  }, [inventory])

  // 2. Generate standard deterministic layout grid (Aisle A & B, 4 Bays each, 3 Levels, 2 Pallet slots)
  const slots: StorageSlot[] = useMemo(() => {
    const list: StorageSlot[] = []
    const aisles: ('A' | 'B')[] = ['A', 'B']
    const bayOffsets = [-7.5, -2.5, 2.5, 7.5] // 4 bays along Z

    const unallocatedInv = [...displayInventory]

    for (const aisle of aisles) {
      const aisleX = aisle === 'A' ? -6.0 : 6.0

      for (let bay = 1; bay <= 4; bay++) {
        const bayZ = bayOffsets[bay - 1]

        for (let level = 1; level <= 3; level++) {
          const levelY = level === 1 ? 0.35 : level === 2 ? 1.75 : 3.15

          for (let pos = 1; pos <= 2; pos++) {
            const posX = aisleX + (pos === 1 ? -0.65 : 0.65)
            const slotId = `LOC-${aisle}0${bay}-L${level}-P${pos}`

            // Check if any record matches this slot explicitly or populates sequentially
            let matchedInv: InventoryRecord | undefined = undefined

            // Match by exact location code if present
            const explicitMatchIdx = unallocatedInv.findIndex(
              r => r.location && r.location.toUpperCase().includes(`${aisle}${bay}`),
            )
            if (explicitMatchIdx !== -1) {
              matchedInv = unallocatedInv.splice(explicitMatchIdx, 1)[0]
            } else if (unallocatedInv.length > 0 && list.length < displayInventory.length) {
              // Sequentially place remaining real inventory into clean slots
              matchedInv = unallocatedInv.shift()
            }

            list.push({
              id: slotId,
              aisle,
              bay,
              level,
              position: pos as 1 | 2,
              worldPos: [posX, levelY, bayZ],
              inv: matchedInv,
            })
          }
        }
      }
    }
    return list
  }, [displayInventory])

  // Handle Preset View Selection
  const handleSelectPreset = (preset: CameraPreset) => {
    setActivePreset(preset)
    const conf = CAMERA_PRESETS[preset]
    setTargetPos([...conf.position])
    setTargetLookAt([...conf.target])
  }

  // Handle Zoom In / Out with vector-based offset calculation
  const handleZoom = (factor: number) => {
    if (!controlsRef.current) return
    const controls = controlsRef.current
    const cam = controls.object as THREE.PerspectiveCamera
    if (!cam) return

    const offset = new THREE.Vector3().subVectors(cam.position, controls.target)
    const currentDist = offset.length()
    const targetDist = Math.max(3.0, Math.min(48, currentDist * factor))
    offset.setLength(targetDist)

    const newPos = new THREE.Vector3().addVectors(controls.target, offset)
    setTargetLookAt([controls.target.x, controls.target.y, controls.target.z])
    setTargetPos([newPos.x, newPos.y, newPos.z])
  }

  // Handle Pallet Selection
  const handleSelectSlot = (slot: StorageSlot) => {
    if (selectedSlotId === slot.id) {
      setSelectedSlotId(null)
      return
    }
    setSelectedSlotId(slot.id)
    // Focus camera toward selected pallet
    const [x, y, z] = slot.worldPos
    setTargetLookAt([x, y + 0.5, z])
    setTargetPos([x + (slot.aisle === 'A' ? 3.2 : -3.2), y + 1.8, z + 3.4])
  }

  // Re-focus current selected slot
  const handleFocusSelected = () => {
    const cur = slots.find(s => s.id === selectedSlotId)
    if (!cur) return
    const [x, y, z] = cur.worldPos
    setTargetLookAt([x, y + 0.5, z])
    setTargetPos([x + (cur.aisle === 'A' ? 3.0 : -3.0), y + 1.6, z + 3.2])
  }

  // Camera Reset
  const handleReset = () => {
    setSelectedSlotId(null)
    handleSelectPreset('overview')
  }

  // Search Auto-Focus: If searchSku matches an item, focus it asynchronously
  useEffect(() => {
    if (!searchSku.trim()) return
    const match = slots.find(s => s.inv && s.inv.sku.toLowerCase() === searchSku.trim().toLowerCase())
    if (match) {
      const timer = setTimeout(() => {
        setSelectedSlotId(match.id)
        const [x, y, z] = match.worldPos
        setTargetLookAt([x, y + 0.5, z])
        setTargetPos([x + (match.aisle === 'A' ? 3.2 : -3.2), y + 1.8, z + 3.4])
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [searchSku, slots])

  const selectedSlot = useMemo(() => slots.find(s => s.id === selectedSlotId), [slots, selectedSlotId])

  return (
    <div className="relative h-full w-full rounded-2xl overflow-hidden border border-[#E2E8F0] bg-[#F8FAFC] shadow-lg select-none">
      {/* View Presets & Camera Toolbar */}
      <WarehouseControlsToolbar
        activePreset={activePreset}
        onSelectPreset={handleSelectPreset}
        onReset={handleReset}
        onZoomIn={() => handleZoom(0.75)}
        onZoomOut={() => handleZoom(1.3)}
      />

      {/* 3D WebGL Canvas */}
      <Canvas
        shadows
        camera={{ position: [16, 12, 16], fov: 42 }}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
        aria-label="3D Warehouse Spatial Digital Twin"
      >
        <color attach="background" args={[COLORS.bg]} />

        {/* Ambient & Daylight Balance */}
        <ambientLight intensity={0.8} />
        <directionalLight
          position={[14, 20, 12]}
          intensity={1.25}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-22}
          shadow-camera-right={22}
          shadow-camera-top={22}
          shadow-camera-bottom={-22}
          shadow-bias={-0.0001}
        />
        <directionalLight position={[-14, 16, -10]} intensity={0.45} />
        <hemisphereLight args={['#FFFFFF', '#E2E8F0', 0.6]} />

        {/* Smooth Camera Controller */}
        <CameraController
          targetPos={targetPos}
          targetLookAt={targetLookAt}
          controlsRef={controlsRef}
          onTransitionComplete={handleTransitionComplete}
        />

        {/* Concrete Floor, Boundaries, Decals */}
        <WarehouseFloor />

        {/* Structural Building Perimeter & Overhead Trusses */}
        <BuildingStructure />

        {/* Industrial Pallet Racks (Aisle A: X = -6.0, Aisle B: X = 6.0) */}
        {[-7.5, -2.5, 2.5, 7.5].map((bz, bIdx) => (
          <React.Fragment key={`bays-${bz}`}>
            {/* Aisle A Rack Bay */}
            <IndustrialRackBay
              x={-6.0}
              z={bz}
              bayWidth={2.6}
              bayDepth={1.1}
              levels={[0.35, 1.75, 3.15]}
              isEndBay={bIdx === 3}
              isSelectedBay={selectedSlot?.aisle === 'A' && selectedSlot?.bay === bIdx + 1}
            />
            {/* Aisle B Rack Bay */}
            <IndustrialRackBay
              x={6.0}
              z={bz}
              bayWidth={2.6}
              bayDepth={1.1}
              levels={[0.35, 1.75, 3.15]}
              isEndBay={bIdx === 3}
              isSelectedBay={selectedSlot?.aisle === 'B' && selectedSlot?.bay === bIdx + 1}
            />
          </React.Fragment>
        ))}

        {/* Pallets and Stored Cartons */}
        {slots.map(slot => {
          const status = getRecordStatus(slot.inv)
          const matchSearch =
            !searchSku || (slot.inv && slot.inv.sku.toLowerCase().includes(searchSku.toLowerCase())) ||
            slot.id.toLowerCase().includes(searchSku.toLowerCase())
          const matchFilter = filterStatus === 'all' || status === filterStatus
          const isDimmed = !matchSearch || !matchFilter

          return (
            <PalletUnit
              key={slot.id}
              slot={slot}
              isSelected={selectedSlotId === slot.id}
              isDimmed={isDimmed}
              onSelect={handleSelectSlot}
            />
          )
        })}

        {/* Orbit Controls with Safe Polar Angle and Bounds */}
        <OrbitControls
          ref={controlsRef}
          target={[0, 1.2, 0]}
          minDistance={3.0}
          maxDistance={48}
          maxPolarAngle={Math.PI / 2.06}
          enableZoom={true}
          zoomSpeed={1.2}
          enableDamping
          dampingFactor={0.06}
          onStart={handleManualControlStart}
          makeDefault
        />
      </Canvas>

      {/* Legend Key */}
      <WarehouseLegend />

      {/* Slide-in Detail Drawer for Selected Slot */}
      {selectedSlot && (
        <WarehouseDetailDrawer
          slot={selectedSlot}
          onClose={() => setSelectedSlotId(null)}
          onFocus={handleFocusSelected}
        />
      )}
    </div>
  )
}
