import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { WarehouseLayout } from '../data/schemas'
import { BRAND_BLUE } from '../world/constants'
import type { SitePlan } from '../world/sitePlan'
import { buildZoneProps, type Prop } from '../world/zoneProps'
import { createAtlas, createFenceAlpha, createScreenTexture, drawCellText, type Atlas } from './textures'

// Zone furniture, merged per material so ~50 props cost about a dozen draw
// calls. Everything here is visual only.

type Mat = 'steel' | 'dark' | 'white' | 'blue' | 'red' | 'green' | 'wood' | 'glass' | 'mesh' | 'screen' | 'glowBlue' | 'glowGreen' | 'label'
type Piece = { geo: THREE.BufferGeometry; mat: Mat }

const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat: Mat, r = 0.02): Piece => {
  const geo = r > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)) : new THREE.BoxGeometry(w, h, d)
  geo.translate(x, y, z)
  return { geo, mat }
}
const cyl = (r: number, h: number, x: number, y: number, z: number, mat: Mat, axis: 'y' | 'x' | 'z' = 'y', seg = 16): Piece => {
  const geo = new THREE.CylinderGeometry(r, r, h, seg)
  if (axis === 'x') geo.rotateZ(Math.PI / 2)
  if (axis === 'z') geo.rotateX(Math.PI / 2)
  geo.translate(x, y, z)
  return { geo, mat }
}
/** A plane facing +Z (or rotated), optionally reading an atlas cell or tiling its UVs. */
const quad = (w: number, h: number, x: number, y: number, z: number, mat: Mat, opts: { rotY?: number; rotX?: number; atlas?: Atlas; key?: string; tile?: number } = {}): Piece => {
  const geo = new THREE.PlaneGeometry(w, h)
  const uv = geo.attributes.uv as THREE.BufferAttribute
  if (opts.atlas && opts.key) {
    const [u0, v0, u1, v1] = opts.atlas.uv(opts.key)
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0))
  } else if (opts.tile) {
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / opts.tile, uv.getY(i) * h / opts.tile)
  }
  if (opts.rotX) geo.rotateX(opts.rotX)
  if (opts.rotY) geo.rotateY(opts.rotY)
  geo.translate(x, y, z)
  return { geo, mat }
}

function propPieces(p: Prop, clear: number, atlas: Atlas): Piece[] {
  const out: Piece[] = []
  switch (p.kind) {
    case 'scanStation':
      out.push(box(0.4, 0.04, 0.4, 0, 0.02, 0, 'dark'), cyl(0.05, 1.05, 0, 0.55, 0, 'steel'))
      out.push(box(0.5, 0.32, 0.26, 0, 1.18, 0, 'white', 0.04), quad(0.36, 0.22, 0, 1.2, 0.135, 'screen'))
      out.push(box(0.08, 0.16, 0.1, 0.3, 1.1, 0.05, 'dark'))
      break
    case 'palletStack':
      for (let i = 0; i < 7; i++) out.push(box(1.2, 0.13, 0.8, 0, 0.065 + i * 0.145, 0, 'wood'))
      break
    case 'inspectionTable':
      out.push(box(2.4, 0.05, 1.2, 0, 0.9, 0, 'white'))
      for (const [x, z] of [[-1.1, -0.5], [1.1, -0.5], [-1.1, 0.5], [1.1, 0.5]]) out.push(cyl(0.035, 0.88, x, 0.44, z, 'steel'))
      out.push(box(2.3, 0.03, 1.1, 0, 0.18, 0, 'steel'))
      out.push(cyl(0.015, 0.7, 0.9, 1.25, -0.45, 'steel'), box(0.3, 0.06, 0.16, 0.75, 1.58, -0.45, 'dark'))
      break
    case 'qualityStation':
      out.push(box(1.8, 0.05, 0.9, 0, 0.9, 0, 'white'), box(0.6, 0.85, 0.85, -0.55, 0.43, 0, 'steel'))
      for (const x of [0.82]) out.push(box(0.05, 0.88, 0.85, x, 0.44, 0, 'steel'))
      out.push(box(0.58, 0.38, 0.05, 0.25, 1.2, -0.3, 'dark'), quad(0.52, 0.32, 0.25, 1.2, -0.27, 'screen'))
      out.push(box(0.5, 0.04, 0.5, -0.45, 0.95, 0.1, 'steel'))
      break
    case 'damagedArea':
      out.push(quad(p.w, p.d, 0, 0.006, 0, 'label', { rotX: -Math.PI / 2, atlas, key: 'hatch' }))
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) out.push(cyl(0.04, 0.9, x * p.w / 2, 0.45, z * p.d / 2, 'red'))
      for (const z of [-1, 1]) out.push(cyl(0.012, p.w, 0, 0.85, z * p.d / 2, 'red', 'x', 6))
      out.push(cyl(0.012, p.d, -p.w / 2, 0.85, 0, 'red', 'z', 6))
      out.push(quad(1.4, 0.36, 0, 1.15, p.d / 2 + 0.02, 'label', { atlas, key: 'DAMAGED GOODS' }))
      break
    case 'quarantineCage': {
      const H = 2.4
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) out.push(box(0.06, H, 0.06, x * p.w / 2, H / 2, z * p.d / 2, 'steel', 0))
      out.push(quad(p.w, H - 0.1, 0, H / 2, -p.d / 2, 'mesh', { tile: 0.12 }))
      out.push(quad(p.d, H - 0.1, -p.w / 2, H / 2, 0, 'mesh', { rotY: Math.PI / 2, tile: 0.12 }))
      out.push(quad(p.d, H - 0.1, p.w / 2, H / 2, 0, 'mesh', { rotY: Math.PI / 2, tile: 0.12 }))
      // Front: panel with a door opening
      out.push(quad(p.w - 1.2, H - 0.1, -0.6, H / 2, p.d / 2, 'mesh', { tile: 0.12 }))
      out.push(box(0.06, H, 0.06, p.w / 2 - 1.2, H / 2, p.d / 2, 'steel', 0))
      out.push(quad(1.5, 0.36, -0.6, H + 0.3, p.d / 2 + 0.03, 'label', { atlas, key: 'QUARANTINE' }))
      break
    }
    case 'packingTable':
      out.push(box(2.2, 0.06, 1.1, 0, 0.9, 0, 'wood'), box(2.1, 0.03, 1.0, 0, 0.3, 0, 'steel'))
      for (const [x, z] of [[-1.02, -0.48], [1.02, -0.48], [-1.02, 0.48], [1.02, 0.48]]) out.push(box(0.05, 0.9, 0.05, x, 0.45, z, 'steel', 0))
      out.push(cyl(0.12, 0.6, 0.6, 1.08, -0.35, 'white', 'x'), box(0.4, 0.3, 0.3, -0.7, 1.08, -0.3, 'dark'))
      break
    case 'wrapper':
      out.push(cyl(1.1, 0.1, 0, 0.05, 0, 'dark', 'y', 32), cyl(1.0, 0.03, 0, 0.115, 0, 'steel', 'y', 32))
      out.push(box(0.25, 2.6, 0.25, 1.3, 1.3, 0, 'steel'), box(0.4, 0.35, 0.4, 1.12, 1.2, 0, 'blue', 0.04))
      out.push(box(0.5, 0.8, 0.35, 1.3, 0.4, 0.5, 'blue', 0.04))
      break
    case 'charger':
      out.push(box(0.5, 0.7, 0.22, 0, 1.25, 0.11, 'white', 0.05), box(0.32, 0.05, 0.02, 0, 1.45, 0.23, 'glowGreen', 0))
      out.push(cyl(0.02, 1.0, 0.12, 0.6, 0.16, 'dark'))
      break
    case 'maintenanceLift':
      out.push(box(3, 0.1, 2, 0, 0.12, 0, 'steel'), box(2.9, 0.04, 1.9, 0, 0.19, 0, 'dark', 0))
      for (const x of [-1.5, 1.5]) out.push(box(0.2, 2.2, 0.2, x, 1.1, -1.05, 'blue', 0.03))
      out.push(box(0.8, 1.0, 0.5, 1.2, 0.5, 1.35, 'red', 0.04))
      break
    case 'partsShelf': {
      const W = p.w
      for (const x of [-W / 2, W / 2]) for (const z of [-0.28, 0.28]) out.push(box(0.05, 2.2, 0.05, x, 1.1, z, 'blue', 0))
      for (const y of [0.15, 0.7, 1.25, 1.8]) {
        out.push(box(W, 0.03, 0.6, 0, y, 0, 'steel', 0))
        for (let i = 0; i < 5; i++) out.push(box(0.36, 0.2, 0.5, -W / 2 + 0.3 + i * 0.45, y + 0.12, 0, 'blue', 0.03))
      }
      break
    }
    case 'workstation':
      out.push(box(1.8, 0.04, 0.9, 0, 0.74, 0, 'white'))
      for (const x of [-0.85, 0.85]) out.push(box(0.05, 0.72, 0.8, x, 0.36, 0, 'steel', 0))
      for (const x of [-0.35, 0.35]) {
        out.push(box(0.6, 0.38, 0.04, x, 1.1, -0.3, 'dark'), quad(0.55, 0.33, x, 1.1, -0.277, 'screen'))
        out.push(box(0.05, 0.25, 0.05, x, 0.86, -0.32, 'dark', 0))
      }
      out.push(box(0.55, 0.08, 0.5, 0, 0.48, 0.65, 'dark', 0.03), box(0.5, 0.55, 0.06, 0, 0.8, 0.9, 'dark', 0.03), cyl(0.03, 0.45, 0, 0.23, 0.65, 'steel'))
      break
    case 'networkCabinet':
      out.push(box(0.8, 2.0, 1.0, 0, 1.0, 0, 'dark', 0.03))
      for (let i = 0; i < 6; i++) out.push(box(0.04, 0.02, 0.01, -0.25 + i * 0.1, 1.6, 0.505, 'glowBlue', 0))
      break
    case 'glassPartition': {
      const H = 2.7
      out.push(quad(p.w, H, 0, H / 2, 0, 'glass'), box(p.w, 0.06, 0.08, 0, 0.03, 0, 'steel', 0), box(p.w, 0.06, 0.08, 0, H, 0, 'steel', 0))
      for (let x = -p.w / 2; x <= p.w / 2 + 1e-6; x += Math.max(1.2, p.w / Math.max(1, Math.round(p.w / 1.5)))) out.push(box(0.05, H, 0.08, x, H / 2, 0, 'steel', 0))
      break
    }
    case 'extinguisher':
      out.push(box(0.26, 0.04, 0.16, 0, 0.62, 0.08, 'dark', 0), cyl(0.09, 0.5, 0, 0.9, 0.12, 'red'), cyl(0.03, 0.08, 0, 1.19, 0.12, 'dark'))
      out.push(quad(0.4, 0.4, 0, 1.6, 0.01, 'label', { atlas, key: 'FIRE' }))
      break
    case 'firstAid':
      out.push(box(0.5, 0.42, 0.15, 0, 1.5, 0.075, 'green', 0.03), box(0.22, 0.06, 0.01, 0, 1.5, 0.155, 'white', 0), box(0.06, 0.22, 0.01, 0, 1.5, 0.155, 'white', 0))
      out.push(quad(0.7, 0.2, 0, 1.92, 0.01, 'label', { atlas, key: 'FIRST AID' }))
      break
    case 'barrier': {
      const n = Math.max(1, Math.round(p.w / 1.5))
      for (let i = 0; i <= n; i++) out.push(cyl(0.045, 1.0, -p.w / 2 + (p.w * i) / n, 0.5, 0, 'blue'))
      for (const y of [0.55, 0.95]) out.push(box(p.w, 0.08, 0.06, 0, y, 0, 'blue', 0.02))
      break
    }
    case 'floorLight':
      out.push(cyl(0.13, 0.02, 0, 0.012, 0, 'glowBlue', 'y', 20))
      break
    case 'zoneBanner': {
      const y = clear - 1.9
      for (const flip of [0, Math.PI]) out.push(quad(4.4, 0.85, Math.sin(flip) * 0.01, y, Math.cos(flip) * 0.01, 'label', { rotY: flip, atlas, key: `banner:${p.label}` }))
      for (const x of [-2, 2]) out.push(cyl(0.01, clear - y - 0.42, x, (clear + y + 0.42) / 2, 0, 'steel', 'y', 6))
      break
    }
  }
  return out
}

export function ZoneProps({ layout, plan, parkingBays }: { layout: WarehouseLayout; plan: SitePlan; parkingBays: { x: number; z: number }[] }) {
  const bayKey = parkingBays.map(b => `${b.x},${b.z}`).join('|')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const props = useMemo(() => buildZoneProps(layout, plan, parkingBays), [layout, plan, bayKey])

  const atlas = useMemo(() => {
    const banners = props.filter(p => p.kind === 'zoneBanner').map(p => p.label ?? '')
    const sign = (key: string, bg: string, fg = '#FFFFFF') => ({
      key,
      draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => {
        ctx.fillStyle = bg
        ctx.fillRect(0, 0, w, h)
        drawCellText(ctx, key, w / 2, h / 2, h * 0.5, { color: fg, weight: 800, align: 'center', maxW: w - 16 })
      },
    })
    return createAtlas([
      ...banners.map(b => ({
        key: `banner:${b}`,
        draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => {
          ctx.fillStyle = '#FFFFFF'
          ctx.fillRect(0, 0, w, h)
          ctx.fillStyle = BRAND_BLUE
          ctx.fillRect(0, 0, w, 8)
          ctx.fillRect(0, h - 8, w, 8)
          drawCellText(ctx, b, w / 2, h / 2, h * 0.42, { color: '#0F172A', weight: 800, align: 'center', maxW: w - 24 })
        },
      })),
      sign('DAMAGED GOODS', '#B91C1C'),
      sign('QUARANTINE', '#C2410C'),
      sign('FIRST AID', '#15803D'),
      sign('FIRE', '#B91C1C'),
      {
        key: 'hatch',
        draw: (ctx, w, h) => {
          ctx.fillStyle = '#FFFFFF'
          ctx.fillRect(0, 0, w, h)
          ctx.strokeStyle = '#DC2626'
          ctx.lineWidth = 10
          for (let k = -h; k < w + h; k += 26) {
            ctx.beginPath()
            ctx.moveTo(k, 0)
            ctx.lineTo(k + h, h)
            ctx.stroke()
          }
        },
      },
    ], 512, 100)
  }, [props])

  const materials = useMemo(() => {
    const fence = createFenceAlpha([1, 1])
    const screen = createScreenTexture(7)
    const m: Record<Mat, THREE.Material> = {
      steel: new THREE.MeshStandardMaterial({ color: '#C5CCD3', metalness: 0.7, roughness: 0.35 }),
      dark: new THREE.MeshStandardMaterial({ color: '#2A2F36', metalness: 0.3, roughness: 0.6 }),
      white: new THREE.MeshStandardMaterial({ color: '#F1F5F9', roughness: 0.45 }),
      blue: new THREE.MeshStandardMaterial({ color: BRAND_BLUE, metalness: 0.4, roughness: 0.4 }),
      red: new THREE.MeshStandardMaterial({ color: '#C81E1E', metalness: 0.3, roughness: 0.4 }),
      green: new THREE.MeshStandardMaterial({ color: '#15803D', roughness: 0.5 }),
      wood: new THREE.MeshStandardMaterial({ color: '#C9A26B', roughness: 0.85 }),
      glass: new THREE.MeshPhysicalMaterial({ color: '#DCEBFF', roughness: 0.08, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
      mesh: new THREE.MeshStandardMaterial({ color: '#8A949F', metalness: 0.7, roughness: 0.4, alphaMap: fence, alphaTest: 0.5, side: THREE.DoubleSide }),
      screen: new THREE.MeshStandardMaterial({ map: screen, emissive: '#ffffff', emissiveMap: screen, emissiveIntensity: 0.9, toneMapped: false }),
      glowBlue: new THREE.MeshStandardMaterial({ color: '#60A5FA', emissive: '#3B82F6', emissiveIntensity: 4, toneMapped: false }),
      glowGreen: new THREE.MeshStandardMaterial({ color: '#4ADE80', emissive: '#22C55E', emissiveIntensity: 4, toneMapped: false }),
      label: new THREE.MeshStandardMaterial({ map: atlas.texture, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }),
    }
    fence.wrapS = fence.wrapT = THREE.RepeatWrapping
    return { m, textures: [fence, screen] }
  }, [atlas])
  useEffect(() => () => {
    Object.values(materials.m).forEach(x => x.dispose())
    materials.textures.forEach(t => t.dispose())
    atlas.texture.dispose()
  }, [materials, atlas])

  const merged = useMemo(() => {
    const byMat = new Map<Mat, THREE.BufferGeometry[]>()
    const up = new THREE.Vector3(0, 1, 0)
    for (const p of props) {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(p.x, 0, p.z), new THREE.Quaternion().setFromAxisAngle(up, p.rotationY), new THREE.Vector3(1, 1, 1))
      for (const piece of propPieces(p, plan.heights.clear, atlas)) {
        piece.geo.applyMatrix4(m)
        const list = byMat.get(piece.mat)
        if (list) list.push(piece.geo)
        else byMat.set(piece.mat, [piece.geo])
      }
    }
    const out: { mat: Mat; geo: THREE.BufferGeometry }[] = []
    for (const [mat, geos] of byMat) {
      // mergeGeometries needs uniform index presence; flatten everything to non-indexed
      const flat = geos.map(g => (g.index ? g.toNonIndexed() : g))
      const geo = mergeGeometries(flat)
      new Set([...geos, ...flat]).forEach(g => g.dispose())
      if (geo) out.push({ mat, geo })
    }
    return out
  }, [props, plan.heights.clear, atlas])
  useEffect(() => () => merged.forEach(m => m.geo.dispose()), [merged])

  return (
    <group>
      {merged.map(({ mat, geo }) => (
        <mesh key={mat} geometry={geo} material={materials.m[mat]} castShadow={mat !== 'glass' && mat !== 'label'} receiveShadow />
      ))}
    </group>
  )
}
