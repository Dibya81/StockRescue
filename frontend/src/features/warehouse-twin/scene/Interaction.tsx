import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { Html } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import type { InventoryLot, WarehouseLayout } from '../data/schemas'
import { indexLotsByPosition, indexLotsByRack, rackPositionIds } from '../data/layoutGeometry'
import { positionStatus, rollupStatus, STATUS_STYLES } from '../data/statusMapping'
import { BRAND_BLUE, DOCK_DOOR } from '../world/constants'
import { layoutToWorld, levelY, rackHeight, rackRotation, rotateXZ } from '../world/layoutToWorld'
import type { Selection } from '../store/twinStore'
import { Label } from './Building'
import { isDragRelease } from './registry'

export type HoverTarget = { kind: 'rack' | 'position' | 'dock'; id: string } | null

interface InteractionProps {
  layout: WarehouseLayout
  lots: InventoryLot[]
  selection: Selection
  selectedDockId: string | null
  hover: HoverTarget
  setHover: (h: HoverTarget) => void
  onSelectRack: (rackId: string) => void
  onSelectLevel: (rackId: string, level: number) => void
  onSelectPosition: (positionId: string) => void
  onSelectDock: (dockId: string) => void
}

const invisible = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
const unitBox = new THREE.BoxGeometry(1, 1, 1)
const unitEdges = new THREE.EdgesGeometry(unitBox)

function Outline({ position, rotationY, size, color = BRAND_BLUE, opacity = 1 }: {
  position: [number, number, number]
  rotationY: number
  size: [number, number, number]
  color?: string
  opacity?: number
}) {
  return (
    <lineSegments geometry={unitEdges} position={position} rotation-y={rotationY} scale={size} renderOrder={10}>
      <lineBasicMaterial color={color} transparent opacity={opacity} depthTest={false} toneMapped={false} />
    </lineSegments>
  )
}

function Tip({ position, children }: { position: [number, number, number]; children: React.ReactNode }) {
  return (
    <Html position={position} center zIndexRange={[12, 0]} style={{ pointerEvents: 'none' }}>
      <div className="whitespace-nowrap rounded-lg bg-[#0F172A]/90 px-2.5 py-1.5 text-[11px] leading-tight text-white shadow-lg">{children}</div>
    </Html>
  )
}

export function Interaction(props: InteractionProps) {
  const { layout, lots, selection, selectedDockId, hover, setHover } = props
  const rackRef = useRef<THREE.InstancedMesh>(null)
  const { byPosition } = useMemo(() => indexLotsByPosition(lots), [lots])
  const byRack = useMemo(() => indexLotsByRack(lots), [lots])

  // Invisible pick volume per rack (one draw-free instanced mesh)
  useLayoutEffect(() => {
    const mesh = rackRef.current
    if (!mesh) return
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    layout.racks.forEach((r, i) => {
      const H = rackHeight(r)
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rackRotation(layout, r))
      mesh.setMatrixAt(i, m.compose(new THREE.Vector3(r.x, H / 2, r.z), q, new THREE.Vector3(r.width, H, r.depth)))
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [layout])

  useEffect(() => {
    document.body.style.cursor = hover ? 'pointer' : ''
    return () => {
      document.body.style.cursor = ''
    }
  }, [hover])

  const selectedRack = layout.racks.find(r => r.id === selection.rackId) ?? null
  const rackTf = selectedRack ? layoutToWorld(layout, selectedRack.id) : null

  const onRackClick = (e: ThreeEvent<MouseEvent>) => {
    if (isDragRelease(e)) return
    const rack = e.instanceId != null ? layout.racks[e.instanceId] : undefined
    if (!rack) return
    // Inside the selected rack, let positions and stock take the click
    if (rack.id === selection.rackId) return
    e.stopPropagation()
    props.onSelectRack(rack.id)
  }
  const onRackMove = (e: ThreeEvent<PointerEvent>) => {
    const rack = e.instanceId != null ? layout.racks[e.instanceId] : undefined
    if (!rack || rack.id === selection.rackId) return
    e.stopPropagation()
    if (hover?.kind !== 'rack' || hover.id !== rack.id) setHover({ kind: 'rack', id: rack.id })
  }

  // ── Tooltip content from data ──
  const tip = useMemo(() => {
    if (!hover) return null
    if (hover.kind === 'rack') {
      const rack = layout.racks.find(r => r.id === hover.id)
      if (!rack) return null
      const rackLots = byRack.get(rack.id) ?? []
      const occupied = new Set(rackLots.map(l => l.positionId)).size
      const status = rollupStatus(rackLots.map(l => l.status))
      return {
        at: [rack.x, rackHeight(rack) + 0.6, rack.z] as [number, number, number],
        body: (<><b>Rack {rack.id}</b><br />{occupied}/{rack.levels * rack.positionsPerLevel} positions occupied<br />Worst status: {STATUS_STYLES[status].label}</>),
      }
    }
    if (hover.kind === 'position') {
      const t = layoutToWorld(layout, hover.id)
      if (!t) return null
      const posLots = byPosition.get(hover.id)
      const lot = posLots?.[0]
      return {
        at: [t.position[0], t.position[1] + 1.5, t.position[2]] as [number, number, number],
        body: lot
          ? (<><b>{hover.id}</b><br />{lot.sku} · {posLots!.reduce((n, l) => n + l.qty, 0)} {lot.unit}<br />{STATUS_STYLES[positionStatus(posLots)].label}</>)
          : (<><b>{hover.id}</b><br />No inventory recorded</>),
      }
    }
    const dock = layout.docks.find(d => d.id === hover.id)
    if (!dock) return null
    return {
      at: [dock.x, DOCK_DOOR.height + 1.6, dock.z + 1] as [number, number, number],
      body: (<><b>{dock.label}</b> · {dock.purpose}<br />Status: {dock.status}</>),
    }
  }, [hover, layout, byRack, byPosition])

  const hoverOutline = useMemo(() => {
    if (!hover || hover.kind === 'dock') return null
    const t = layoutToWorld(layout, hover.id)
    if (!t) return null
    if (hover.kind === 'rack') return { position: [t.position[0], t.size[1] / 2, t.position[2]] as [number, number, number], rotationY: t.rotationY, size: [t.size[0] + 0.1, t.size[1] + 0.1, t.size[2] + 0.1] as [number, number, number] }
    return { position: [t.position[0], t.position[1] + 0.65, t.position[2]] as [number, number, number], rotationY: t.rotationY, size: [t.size[0] - 0.04, 1.3, t.size[2] + 0.06] as [number, number, number] }
  }, [hover, layout])

  const selectedPos = selection.positionId ? layoutToWorld(layout, selection.positionId) : null

  return (
    <group>
      <instancedMesh
        ref={rackRef}
        args={[unitBox, invisible, layout.racks.length]}
        frustumCulled={false}
        onClick={onRackClick}
        onPointerMove={onRackMove}
        onPointerOut={() => hover?.kind === 'rack' && setHover(null)}
      />

      {/* Dock doors are selectable from the yard */}
      {layout.docks.map(d => {
        const t = layoutToWorld(layout, d.id)
        if (!t) return null
        const [ox, oz] = rotateXZ(0, 0.6, t.rotationY)
        return (
          <mesh
            key={d.id}
            geometry={unitBox}
            material={invisible}
            position={[d.x + ox, DOCK_DOOR.height / 2, d.z + oz]}
            rotation-y={t.rotationY}
            scale={[DOCK_DOOR.width + 0.8, DOCK_DOOR.height + 0.8, 1.2]}
            onClick={e => {
              if (isDragRelease(e)) return
              e.stopPropagation()
              props.onSelectDock(d.id)
            }}
            onPointerMove={e => {
              e.stopPropagation()
              if (hover?.id !== d.id) setHover({ kind: 'dock', id: d.id })
            }}
            onPointerOut={() => hover?.kind === 'dock' && setHover(null)}
          />
        )
      })}
      {selectedDockId && (() => {
        const t = layoutToWorld(layout, selectedDockId)
        if (!t) return null
        const [ox, oz] = rotateXZ(0, 0.35, t.rotationY)
        return <Outline position={[t.position[0] + ox, DOCK_DOOR.height / 2 + 0.1, t.position[2] + oz]} rotationY={t.rotationY} size={[DOCK_DOOR.width + 0.9, DOCK_DOOR.height + 0.9, 0.5]} />
      })()}

      {hoverOutline && <Outline {...hoverOutline} color="#93C5FD" opacity={0.9} />}

      {/* Selected rack: outline, level tabs, position pick volumes */}
      {selectedRack && rackTf && (
        <group>
          <Outline position={[rackTf.position[0], rackTf.size[1] / 2, rackTf.position[2]]} rotationY={rackTf.rotationY} size={[rackTf.size[0] + 0.14, rackTf.size[1] + 0.14, rackTf.size[2] + 0.14]} />
          {Array.from({ length: selectedRack.levels }, (_, i) => i + 1).map(level => {
            const y = levelY(selectedRack, level)
            const [tx, tz] = rotateXZ(-selectedRack.width / 2 - 0.32, selectedRack.depth / 2 + 0.05, rackTf.rotationY)
            const active = selection.level === level
            return (
              <group key={level}>
                <group
                  position={[selectedRack.x + tx, y + 0.35, selectedRack.z + tz]}
                  rotation-y={rackTf.rotationY}
                  onClick={e => {
              if (isDragRelease(e)) return
                    e.stopPropagation()
                    props.onSelectLevel(selectedRack.id, level)
                  }}
                >
                  <Label
                    lines={[`L${String(level).padStart(2, '0')}`]}
                    width={0.42}
                    height={0.24}
                    position={[0, 0, 0]}
                    style={{ fg: active ? '#FFFFFF' : BRAND_BLUE, bg: active ? BRAND_BLUE : '#FFFFFF', weight: 800, border: BRAND_BLUE }}
                  />
                </group>
                {active && (
                  <mesh position={[selectedRack.x, y + selectedRack.levelHeight / 2 - 0.06, selectedRack.z]} rotation-y={rackTf.rotationY} renderOrder={5}>
                    <boxGeometry args={[selectedRack.width + 0.06, selectedRack.levelHeight - 0.14, selectedRack.depth + 0.06]} />
                    <meshBasicMaterial color={BRAND_BLUE} transparent opacity={0.1} depthWrite={false} />
                  </mesh>
                )}
              </group>
            )
          })}
          {rackPositionIds(selectedRack).map(pid => {
            const t = layoutToWorld(layout, pid)
            if (!t) return null
            return (
              <mesh
                key={pid}
                geometry={unitBox}
                material={invisible}
                position={[t.position[0], t.position[1] + (selectedRack.levelHeight - 0.2) / 2, t.position[2]]}
                rotation-y={t.rotationY}
                scale={[t.size[0] - 0.02, selectedRack.levelHeight - 0.2, t.size[2]]}
                onClick={e => {
              if (isDragRelease(e)) return
                  e.stopPropagation()
                  props.onSelectPosition(pid)
                }}
                onPointerMove={e => {
                  e.stopPropagation()
                  if (hover?.id !== pid) setHover({ kind: 'position', id: pid })
                }}
                onPointerOut={() => hover?.id === pid && setHover(null)}
              />
            )
          })}
        </group>
      )}

      {selectedPos && (
        <group>
          <mesh position={[selectedPos.position[0], selectedPos.position[1] + 0.7, selectedPos.position[2]]} rotation-y={selectedPos.rotationY} renderOrder={6}>
            <boxGeometry args={[selectedPos.size[0] - 0.02, 1.4, selectedPos.size[2] + 0.1]} />
            <meshBasicMaterial color={BRAND_BLUE} transparent opacity={0.16} depthWrite={false} />
          </mesh>
          <Outline position={[selectedPos.position[0], selectedPos.position[1] + 0.7, selectedPos.position[2]]} rotationY={selectedPos.rotationY} size={[selectedPos.size[0] - 0.02, 1.4, selectedPos.size[2] + 0.1]} />
        </group>
      )}

      {tip && <Tip position={tip.at}>{tip.body}</Tip>}
    </group>
  )
}
