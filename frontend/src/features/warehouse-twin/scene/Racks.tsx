import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { WarehouseLayout } from '../data/schemas'
import { BRAND_BLUE } from '../world/constants'
import { levelY, rackHeight, rackRotation, rotateXZ } from '../world/layoutToWorld'
import { BEAM, BRACE, rackPartMatrices, UPRIGHT } from '../world/rackParts'
import { rbox, useInstanceMatrices } from './Building'
import { createAtlas, drawBarcode, drawCellText, type Atlas } from './textures'

/** A textured quad placed in world space, reading one atlas cell. */
function atlasQuad(atlas: Atlas, key: string, w: number, h: number, matrix: THREE.Matrix4): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h)
  const [u0, v0, u1, v1] = atlas.uv(key)
  const uv = g.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0))
  }
  g.applyMatrix4(matrix)
  return g
}

function rackLocal(layout: WarehouseLayout, rackIndex: number, lx: number, y: number, lz: number, extraRot = 0): THREE.Matrix4 {
  const rack = layout.racks[rackIndex]
  const rot = rackRotation(layout, rack)
  const [dx, dz] = rotateXZ(lx, lz, rot)
  return new THREE.Matrix4().compose(
    new THREE.Vector3(rack.x + dx, y, rack.z + dz),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot + extraRot),
    new THREE.Vector3(1, 1, 1),
  )
}

function useRackLabels(layout: WarehouseLayout) {
  return useMemo(() => {
    const maxLevels = Math.max(...layout.racks.map(r => r.levels))
    const pplSet = [...new Set(layout.racks.map(r => r.positionsPerLevel))]

    const plateCells = [
      ...layout.racks.map(r => ({
        key: `rack:${r.id}`,
        draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => {
          ctx.fillStyle = '#FFFFFF'
          ctx.fillRect(0, 0, w, h)
          ctx.fillStyle = BRAND_BLUE
          ctx.fillRect(0, 0, 10, h)
          drawCellText(ctx, r.id, 20, h * 0.36, h * 0.42, { weight: 800, maxW: w - 30 })
          drawBarcode(ctx, r.id, 20, h * 0.66, w - 34, h * 0.24)
        },
      })),
      ...layout.aisles.map(a => ({
        key: `aisle:${a.id}`,
        draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => {
          ctx.fillStyle = BRAND_BLUE
          ctx.fillRect(0, 0, w, h)
          drawCellText(ctx, 'AISLE', w / 2, h * 0.27, h * 0.22, { color: '#DBEAFE', weight: 700, align: 'center' })
          drawCellText(ctx, a.id, w / 2, h * 0.65, h * 0.5, { color: '#FFFFFF', weight: 800, align: 'center' })
        },
      })),
    ]
    const levelCells = [
      ...Array.from({ length: maxLevels }, (_, i) => i + 1).flatMap(level => pplSet.map(ppl => ({
        key: `level:${level}:${ppl}`,
        draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => {
          ctx.fillStyle = '#FDE68A'
          ctx.fillRect(0, 0, w, h)
          ctx.fillStyle = '#FFFFFF'
          const lead = 120
          drawCellText(ctx, `L${String(level).padStart(2, '0')}`, 8, h / 2, h * 0.62, { weight: 800 })
          const slot = (w - lead) / ppl
          for (let p = 0; p < ppl; p++) {
            const x = lead + p * slot
            ctx.fillStyle = '#FFFFFF'
            ctx.fillRect(x + 4, 4, slot - 8, h - 8)
            drawCellText(ctx, `P${String(p + 1).padStart(2, '0')}`, x + 10, h / 2, h * 0.5, { weight: 700 })
            drawBarcode(ctx, `L${level}P${p + 1}`, x + 62, 8, slot - 74, h - 16)
          }
        },
      }))),
    ]
    const atlas = createAtlas(plateCells, 256, 64)
    // Beam strips are ~28:1; a matching cell keeps glyphs undistorted
    const levelAtlas = createAtlas(levelCells, 1792, 64)
    const levelQuads: THREE.BufferGeometry[] = []

    const quads: THREE.BufferGeometry[] = []
    layout.racks.forEach((rack, i) => {
      const front = rack.depth / 2
      // Location plate hanging under the level-2 beam (or level 1 for single-level racks)
      const plateY = (rack.levels > 1 ? levelY(rack, 2) : rackHeight(rack)) - BEAM.h - 0.12
      quads.push(atlasQuad(atlas, `rack:${rack.id}`, 0.48, 0.12, rackLocal(layout, i, -rack.width / 2 + 0.38, plateY, front + 0.012)))
      // Beam strip per level on the aisle-side beam
      for (let l = 1; l <= rack.levels; l++) {
        levelQuads.push(atlasQuad(levelAtlas, `level:${l}:${rack.positionsPerLevel}`, rack.width - 0.22, BEAM.h * 0.72,
          rackLocal(layout, i, 0, levelY(rack, l) - BEAM.h / 2, front + 0.004)))
      }
    })
    // Double-sided aisle signs hung at each aisle mouth
    for (const a of layout.aisles) {
      const racks = layout.racks.filter(r => r.aisleId === a.id)
      const top = Math.max(...racks.map(rackHeight)) + 1.1
      const along = a.orientation === 'z'
      const mx = along ? a.x : a.x + a.length / 2 + 0.3
      const mz = along ? a.z + a.length / 2 + 0.3 : a.z
      for (const flip of [0, Math.PI]) {
        const rot = (along ? 0 : Math.PI / 2) + flip
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(mx, top, mz),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot),
          new THREE.Vector3(1, 1, 1),
        )
        const g = atlasQuad(atlas, `aisle:${a.id}`, 1.6, 0.4, m)
        // Back-to-back faces must not z-fight
        g.translate(Math.sin(rot) * 0.01, 0, Math.cos(rot) * 0.01)
        quads.push(g)
      }
    }
    const merged = mergeGeometries(quads)
    const levelMerged = mergeGeometries(levelQuads)
    quads.forEach(q => q.dispose())
    levelQuads.forEach(q => q.dispose())
    const signPosts = layout.aisles.map(a => {
      const racks = layout.racks.filter(r => r.aisleId === a.id)
      const top = Math.max(...racks.map(rackHeight)) + 1.1
      const along = a.orientation === 'z'
      return { x: along ? a.x : a.x + a.length / 2 + 0.3, z: along ? a.z + a.length / 2 + 0.3 : a.z, top }
    })
    return { atlas, geometry: merged, levelAtlas, levelGeometry: levelMerged, signPosts }
  }, [layout])
}

export function Racks({ layout, clearHeight }: { layout: WarehouseLayout; clearHeight: number }) {
  const parts = useMemo(() => rackPartMatrices(layout), [layout])
  const geos = useMemo(() => ({
    upright: rbox(UPRIGHT.w, 1, UPRIGHT.d, 0.012),
    beam: rbox(1, BEAM.h, BEAM.d, 0.012),
    brace: new THREE.BoxGeometry(BRACE, 1, BRACE),
    basePlate: new THREE.BoxGeometry(0.16, 0.012, 0.14),
    endGuard: rbox(0.16, 0.6, Math.max(...layout.racks.map(r => r.depth)) + 0.2, 0.05),
  }), [layout])
  useEffect(() => () => Object.values(geos).forEach(g => g.dispose()), [geos])

  const labels = useRackLabels(layout)
  useEffect(() => () => {
    labels.geometry.dispose()
    labels.atlas.texture.dispose()
    labels.levelGeometry.dispose()
    labels.levelAtlas.texture.dispose()
  }, [labels])

  const refs = {
    upright: useRef<THREE.InstancedMesh>(null),
    beam: useRef<THREE.InstancedMesh>(null),
    brace: useRef<THREE.InstancedMesh>(null),
    basePlate: useRef<THREE.InstancedMesh>(null),
    endGuard: useRef<THREE.InstancedMesh>(null),
  }
  useInstanceMatrices(refs.upright, parts.upright)
  useInstanceMatrices(refs.beam, parts.beam)
  useInstanceMatrices(refs.brace, parts.brace)
  useInstanceMatrices(refs.basePlate, parts.basePlate)
  useInstanceMatrices(refs.endGuard, parts.endGuard)

  return (
    <group>
      <instancedMesh ref={refs.upright} args={[geos.upright, undefined, parts.upright.length]} castShadow receiveShadow frustumCulled={false}>
        <meshStandardMaterial color={BRAND_BLUE} metalness={0.45} roughness={0.38} />
      </instancedMesh>
      <instancedMesh ref={refs.beam} args={[geos.beam, undefined, parts.beam.length]} castShadow receiveShadow frustumCulled={false}>
        <meshStandardMaterial color="#D3D8DE" metalness={0.55} roughness={0.36} />
      </instancedMesh>
      <instancedMesh ref={refs.brace} args={[geos.brace, undefined, parts.brace.length]} frustumCulled={false}>
        <meshStandardMaterial color="#3B67E0" metalness={0.45} roughness={0.4} />
      </instancedMesh>
      <instancedMesh ref={refs.basePlate} args={[geos.basePlate, undefined, parts.basePlate.length]} frustumCulled={false}>
        <meshStandardMaterial color="#9CA3AF" metalness={0.7} roughness={0.4} />
      </instancedMesh>
      <instancedMesh ref={refs.endGuard} args={[geos.endGuard, undefined, Math.max(1, parts.endGuard.length)]} castShadow frustumCulled={false}>
        <meshStandardMaterial color="#E5E7EB" metalness={0.3} roughness={0.45} />
      </instancedMesh>

      {/* Location plates and aisle signs; beam barcode strips (two draw calls) */}
      <mesh geometry={labels.geometry}>
        <meshStandardMaterial map={labels.atlas.texture} roughness={0.55} polygonOffset polygonOffsetFactor={-2} side={THREE.FrontSide} />
      </mesh>
      <mesh geometry={labels.levelGeometry}>
        <meshStandardMaterial map={labels.levelAtlas.texture} roughness={0.55} polygonOffset polygonOffsetFactor={-2} side={THREE.FrontSide} />
      </mesh>
      {/* Hangers for the aisle signs */}
      {labels.signPosts.map((s, i) => (
        <mesh key={i} position={[s.x, (s.top + 0.2 + clearHeight) / 2, s.z]}>
          <cylinderGeometry args={[0.012, 0.012, Math.max(0.2, clearHeight - s.top - 0.2), 6]} />
          <meshStandardMaterial color="#94A3B8" metalness={0.8} roughness={0.3} />
        </mesh>
      ))}
    </group>
  )
}
