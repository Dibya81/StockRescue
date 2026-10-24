import * as THREE from 'three'
import type { WarehouseLayout } from '../data/schemas'
import type { StatusGlyph } from '../data/statusMapping'
import { createRng } from '../world/sceneParams'
import { rectD, rectW, type Rect, type SitePlan } from '../world/sitePlan'
import { BRAND_BLUE, SAFETY_YELLOW } from '../world/constants'

// Every texture in the scene is drawn here on a canvas with a seeded RNG,
// so the world renders offline and identically for a given seed.

const FONT = '"Inter Variable", "Inter", system-ui, sans-serif'

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable')
  return [c, ctx]
}

function finish(c: HTMLCanvasElement, opts: { srgb?: boolean; repeat?: [number, number]; anisotropy?: number } = {}): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c)
  if (opts.srgb) t.colorSpace = THREE.SRGBColorSpace
  if (opts.repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(opts.repeat[0], opts.repeat[1])
  }
  t.anisotropy = opts.anisotropy ?? 8
  t.needsUpdate = true
  return t
}

function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, rng: () => number, count: number, colors: string[], maxR: number) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(rng() * colors.length)]
    ctx.globalAlpha = 0.05 + rng() * 0.12
    ctx.beginPath()
    ctx.arc(rng() * w, rng() * h, 0.4 + rng() * maxR, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

// ── Concrete floor ───────────────────────────────────────

export function createConcreteTextures(seed: number, repeat: [number, number]) {
  const rng = createRng(seed)
  const size = 1024
  const [albedo, a] = canvas(size, size)
  a.fillStyle = '#D5D9DD'
  a.fillRect(0, 0, size, size)
  // Large soft trowel clouds
  for (let i = 0; i < 40; i++) {
    const g = a.createRadialGradient(rng() * size, rng() * size, 0, rng() * size, rng() * size, 80 + rng() * 220)
    const tone = rng() > 0.5 ? '255,255,255' : '120,128,138'
    g.addColorStop(0, `rgba(${tone},0.06)`)
    g.addColorStop(1, `rgba(${tone},0)`)
    a.fillStyle = g
    a.fillRect(0, 0, size, size)
  }
  speckle(a, size, size, rng, 9000, ['#9AA3AD', '#EEF1F4', '#B6BDC5'], 1.4)
  // Scuffs and tyre marks
  a.lineCap = 'round'
  for (let i = 0; i < 26; i++) {
    a.strokeStyle = `rgba(40,44,52,${0.025 + rng() * 0.05})`
    a.lineWidth = 3 + rng() * 9
    a.beginPath()
    const x = rng() * size
    const y = rng() * size
    a.moveTo(x, y)
    a.bezierCurveTo(x + (rng() - 0.5) * 300, y + (rng() - 0.5) * 300, x + (rng() - 0.5) * 300, y + (rng() - 0.5) * 300, x + (rng() - 0.5) * 500, y + (rng() - 0.5) * 500)
    a.stroke()
  }
  // Saw-cut control joints
  a.strokeStyle = 'rgba(90,98,108,0.35)'
  a.lineWidth = 1.5
  a.beginPath()
  a.moveTo(0, 0.5)
  a.lineTo(size, 0.5)
  a.moveTo(0.5, 0)
  a.lineTo(0.5, size)
  a.stroke()

  const [rough, r] = canvas(512, 512)
  r.fillStyle = 'rgb(92,92,92)'
  r.fillRect(0, 0, 512, 512)
  for (let i = 0; i < 60; i++) {
    const g = r.createRadialGradient(rng() * 512, rng() * 512, 0, rng() * 512, rng() * 512, 40 + rng() * 120)
    const v = rng() > 0.5 ? 150 : 50
    g.addColorStop(0, `rgba(${v},${v},${v},0.35)`)
    g.addColorStop(1, `rgba(${v},${v},${v},0)`)
    r.fillStyle = g
    r.fillRect(0, 0, 512, 512)
  }
  speckle(r, 512, 512, rng, 3000, ['#B0B0B0', '#404040'], 1.2)

  return {
    map: finish(albedo, { srgb: true, repeat }),
    roughnessMap: finish(rough, { repeat }),
  }
}

// ── Floor markings (one texture over the building footprint) ──

const PPM = 20

export function createFloorMarkingsTexture(layout: WarehouseLayout, plan: SitePlan): THREE.CanvasTexture {
  const fp = plan.footprint
  const [c, ctx] = canvas(Math.round(rectW(fp) * PPM), Math.round(rectD(fp) * PPM))
  const X = (x: number) => (x - fp.minX) * PPM
  const Z = (z: number) => (z - fp.minZ) * PPM
  const rect = (r: Rect) => [X(r.minX), Z(r.minZ), rectW(r) * PPM, rectD(r) * PPM] as const

  // Pedestrian walkways: green fill with white edge lines
  for (const w of plan.walkways) {
    ctx.fillStyle = 'rgba(22,163,74,0.55)'
    ctx.fillRect(...rect(w))
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'
    ctx.lineWidth = 0.08 * PPM
    ctx.strokeRect(...rect(w))
  }

  // Zone outlines (blue) with corner ticks
  ctx.strokeStyle = BRAND_BLUE
  ctx.lineWidth = 0.1 * PPM
  ctx.setLineDash([0.9 * PPM, 0.45 * PPM])
  for (const z of layout.zones) {
    ctx.strokeRect(X(z.bounds.x) + 4, Z(z.bounds.z) + 4, z.bounds.width * PPM - 8, z.bounds.depth * PPM - 8)
  }
  ctx.setLineDash([])

  // Aisle edge lines (yellow)
  ctx.strokeStyle = SAFETY_YELLOW
  ctx.lineWidth = 0.1 * PPM
  for (const a of layout.aisles) {
    const hw = a.width / 2 - 0.12
    const hl = a.length / 2
    ctx.beginPath()
    if (a.orientation === 'z') {
      ctx.moveTo(X(a.x - hw), Z(a.z - hl)); ctx.lineTo(X(a.x - hw), Z(a.z + hl))
      ctx.moveTo(X(a.x + hw), Z(a.z - hl)); ctx.lineTo(X(a.x + hw), Z(a.z + hl))
    } else {
      ctx.moveTo(X(a.x - hl), Z(a.z - hw)); ctx.lineTo(X(a.x + hl), Z(a.z - hw))
      ctx.moveTo(X(a.x - hl), Z(a.z + hw)); ctx.lineTo(X(a.x + hl), Z(a.z + hw))
    }
    ctx.stroke()
    // Aisle number painted at the mouth
    ctx.save()
    ctx.fillStyle = 'rgba(31,79,216,0.85)'
    ctx.font = `700 ${1.1 * PPM}px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const mouthZ = a.orientation === 'z' ? a.z + hl - 1.2 : a.z
    ctx.fillText(a.id, X(a.x), Z(mouthZ))
    ctx.restore()
  }

  // Cross-aisle centre line and travel arrows
  if (plan.crossAisle) {
    const ca = plan.crossAisle
    const laneEdge = ca.maxZ - 1.35 - 0.15
    ctx.strokeStyle = SAFETY_YELLOW
    ctx.lineWidth = 0.1 * PPM
    ctx.beginPath()
    ctx.moveTo(X(ca.minX), Z(ca.minZ + 0.15)); ctx.lineTo(X(ca.maxX), Z(ca.minZ + 0.15))
    ctx.moveTo(X(ca.minX), Z(laneEdge)); ctx.lineTo(X(ca.maxX), Z(laneEdge))
    ctx.stroke()
    ctx.setLineDash([1.2 * PPM, 1.2 * PPM])
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'
    ctx.beginPath()
    const mid = (ca.minZ + laneEdge) / 2
    ctx.moveTo(X(ca.minX), Z(mid)); ctx.lineTo(X(ca.maxX), Z(mid))
    ctx.stroke()
    ctx.setLineDash([])
  }
  for (const arrow of plan.laneArrows) {
    ctx.save()
    ctx.translate(X(arrow.x), Z(arrow.z))
    ctx.rotate(-arrow.rotationY)
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.beginPath()
    const s = PPM
    ctx.moveTo(0, -0.9 * s)
    ctx.lineTo(0.45 * s, -0.2 * s)
    ctx.lineTo(0.15 * s, -0.2 * s)
    ctx.lineTo(0.15 * s, 0.9 * s)
    ctx.lineTo(-0.15 * s, 0.9 * s)
    ctx.lineTo(-0.15 * s, -0.2 * s)
    ctx.lineTo(-0.45 * s, -0.2 * s)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  // Hazard hatching inside each dock door, and dock numbers
  layout.docks.filter(d => d.side === 'south').forEach((d, i) => {
    const h = plan.dockHatches[i]
    if (!h) return
    const [x, y, w, hh] = rect(h)
    ctx.save()
    ctx.beginPath()
    ctx.rect(x, y, w, hh)
    ctx.clip()
    ctx.fillStyle = '#1F2937'
    ctx.fillRect(x, y, w, hh)
    ctx.strokeStyle = SAFETY_YELLOW
    ctx.lineWidth = 0.25 * PPM
    for (let k = -hh; k < w + hh; k += 0.6 * PPM) {
      ctx.beginPath()
      ctx.moveTo(x + k, y)
      ctx.lineTo(x + k + hh, y + hh)
      ctx.stroke()
    }
    ctx.restore()
    ctx.fillStyle = 'rgba(255,255,255,0.95)'
    ctx.font = `800 ${1.4 * PPM}px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(d.label.replace(/\D/g, ''), X(d.x), Z(h.minZ - 1.4))
  })

  return finish(c, { srgb: true, anisotropy: 16 })
}

// ── Yard ─────────────────────────────────────────────────

export function createAsphaltTextures(seed: number, repeat: [number, number]) {
  const rng = createRng(seed + 7)
  const [c, ctx] = canvas(512, 512)
  ctx.fillStyle = '#3A3F46'
  ctx.fillRect(0, 0, 512, 512)
  speckle(ctx, 512, 512, rng, 14000, ['#24282D', '#5C626B', '#4A5058'], 1.1)
  for (let i = 0; i < 12; i++) {
    ctx.strokeStyle = `rgba(20,22,26,${0.08 + rng() * 0.1})`
    ctx.lineWidth = 1
    ctx.beginPath()
    let x = rng() * 512
    let y = rng() * 512
    ctx.moveTo(x, y)
    for (let k = 0; k < 6; k++) {
      x += (rng() - 0.5) * 60
      y += (rng() - 0.5) * 60
      ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  const [rc, r] = canvas(256, 256)
  r.fillStyle = 'rgb(225,225,225)'
  r.fillRect(0, 0, 256, 256)
  speckle(r, 256, 256, rng, 3000, ['#FFFFFF', '#A0A0A0'], 1)
  return { map: finish(c, { srgb: true, repeat }), roughnessMap: finish(rc, { repeat }) }
}

const YARD_PPM = 8

/** Line markings for apron, docks lanes, staging and parking. Covers the whole site. */
export function createYardMarkingsTexture(layout: WarehouseLayout, plan: SitePlan): THREE.CanvasTexture {
  const s = plan.site
  const [c, ctx] = canvas(Math.round(rectW(s) * YARD_PPM), Math.round(rectD(s) * YARD_PPM))
  const X = (x: number) => (x - s.minX) * YARD_PPM
  const Z = (z: number) => (z - s.minZ) * YARD_PPM
  ctx.lineCap = 'butt'

  // Dock approach lanes
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'
  ctx.lineWidth = 0.15 * YARD_PPM
  for (const d of layout.docks.filter(x => x.side === 'south')) {
    for (const off of [-1.9, 1.9]) {
      ctx.beginPath()
      ctx.moveTo(X(d.x + off), Z(plan.footprint.maxZ + 0.6))
      ctx.lineTo(X(d.x + off), Z(plan.footprint.maxZ + 22))
      ctx.stroke()
    }
    // Yellow stop bar & bay number
    ctx.fillStyle = SAFETY_YELLOW
    ctx.fillRect(X(d.x - 1.9), Z(plan.footprint.maxZ + 1.2), 3.8 * YARD_PPM, 0.3 * YARD_PPM)
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.font = `800 ${2.4 * YARD_PPM}px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(d.label.replace(/\D/g, ''), X(d.x), Z(plan.footprint.maxZ + 19))
  }

  // Staging stalls
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'
  for (const st of plan.stagingStalls) {
    ctx.strokeRect(X(st.x - st.width / 2), Z(st.z - st.length / 2), st.width * YARD_PPM, st.length * YARD_PPM)
  }
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.font = `700 ${2 * YARD_PPM}px ${FONT}`
  ctx.textAlign = 'center'
  ctx.fillText('TRUCK STAGING', X((plan.stagingYard.minX + plan.stagingYard.maxX) / 2), Z(plan.stagingYard.maxZ - 3))

  // Parking stalls
  for (const st of plan.parkingStalls) {
    ctx.save()
    ctx.translate(X(st.x), Z(st.z))
    ctx.strokeRect(-st.length / 2 * YARD_PPM, -st.width / 2 * YARD_PPM, st.length * YARD_PPM, st.width * YARD_PPM)
    ctx.restore()
  }
  ctx.fillText('VISITOR & STAFF PARKING', X((plan.parking.minX + plan.parking.maxX) / 2), Z(plan.parking.maxZ - 1.5))

  // Gate lane arrows & SLOW
  const g = plan.fence.gate
  ctx.font = `800 ${2.6 * YARD_PPM}px ${FONT}`
  ctx.fillStyle = SAFETY_YELLOW
  ctx.fillText('SLOW', X(g.x), Z(plan.apron.maxZ + 6))

  // Hatched no-parking box in front of the personnel entrance
  const door = plan.openings.find(o => o.kind === 'personnel')
  if (door) {
    const x0 = X(door.along - 2.5)
    const y0 = Z(plan.footprint.maxZ + 3.2)
    const w = 5 * YARD_PPM
    const h = 3 * YARD_PPM
    ctx.save()
    ctx.beginPath()
    ctx.rect(x0, y0, w, h)
    ctx.clip()
    ctx.strokeStyle = SAFETY_YELLOW
    ctx.lineWidth = 0.25 * YARD_PPM
    for (let k = -h; k < w + h; k += 0.8 * YARD_PPM) {
      ctx.beginPath()
      ctx.moveTo(x0 + k, y0)
      ctx.lineTo(x0 + k + h, y0 + h)
      ctx.stroke()
    }
    ctx.restore()
    ctx.strokeStyle = SAFETY_YELLOW
    ctx.strokeRect(x0, y0, w, h)
  }
  return finish(c, { srgb: true, anisotropy: 16 })
}

export function createGrassTexture(seed: number, repeat: [number, number]): THREE.CanvasTexture {
  const rng = createRng(seed + 11)
  const [c, ctx] = canvas(256, 256)
  ctx.fillStyle = '#6E9A55'
  ctx.fillRect(0, 0, 256, 256)
  speckle(ctx, 256, 256, rng, 9000, ['#5B8746', '#86B068', '#4F7A3D', '#9BBF7B'], 1)
  return finish(c, { srgb: true, repeat })
}

// ── Building materials ───────────────────────────────────

/** Normal map of vertical trapezoidal cladding ribs; one rib per 256 px. */
export function createCladdingNormal(repeat: [number, number]): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 8)
  const img = ctx.createImageData(256, 8)
  for (let x = 0; x < 256; x++) {
    const t = x / 256
    // Height profile: flat pan, sloped flank, flat crest, sloped flank
    let slope = 0
    if (t > 0.55 && t < 0.62) slope = 1
    else if (t > 0.85 && t < 0.92) slope = -1
    else if (t > 0.05 && t < 0.08) slope = 0.3
    const nx = -slope * 0.85
    const nz = Math.sqrt(1 - nx * nx)
    for (let y = 0; y < 8; y++) {
      const i = (y * 256 + x) * 4
      img.data[i] = Math.round((nx * 0.5 + 0.5) * 255)
      img.data[i + 1] = 128
      img.data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255)
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return finish(c, { repeat })
}

/** Normal map of horizontal roller-shutter slats; one slat per 32 px. */
export function createShutterNormal(repeat: [number, number]): THREE.CanvasTexture {
  const [c, ctx] = canvas(8, 32)
  const img = ctx.createImageData(8, 32)
  for (let y = 0; y < 32; y++) {
    const t = y / 32
    const ny = t < 0.15 ? 0.7 : t > 0.85 ? -0.5 : Math.sin((t - 0.15) / 0.7 * Math.PI) * 0.15
    const nz = Math.sqrt(1 - ny * ny)
    for (let x = 0; x < 8; x++) {
      const i = (y * 8 + x) * 4
      img.data[i] = 128
      img.data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255)
      img.data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255)
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return finish(c, { repeat })
}

/** Weld-mesh fence panel alpha map. */
export function createFenceAlpha(repeat: [number, number]): THREE.CanvasTexture {
  const [c, ctx] = canvas(64, 64)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, 64, 64)
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 3
  ctx.strokeRect(0, 0, 64, 64)
  ctx.beginPath()
  ctx.moveTo(32, 0); ctx.lineTo(32, 64)
  ctx.moveTo(0, 32); ctx.lineTo(64, 32)
  ctx.stroke()
  return finish(c, { repeat })
}

// ── Labels ───────────────────────────────────────────────

export interface LabelStyle {
  fg?: string
  bg?: string
  weight?: number
  /** Canvas pixels per metre */
  ppm?: number
  padding?: number
  border?: string
  align?: CanvasTextAlign
}

/** Text drawn into a texture. Returns the texture and its aspect ratio. */
export function createLabelTexture(lines: string[], heightM: number, widthM: number, style: LabelStyle = {}) {
  const ppm = style.ppm ?? 160
  const [c, ctx] = canvas(Math.max(8, Math.round(widthM * ppm)), Math.max(8, Math.round(heightM * ppm)))
  if (style.bg) {
    ctx.fillStyle = style.bg
    ctx.fillRect(0, 0, c.width, c.height)
  }
  if (style.border) {
    ctx.strokeStyle = style.border
    ctx.lineWidth = Math.max(2, c.height * 0.05)
    ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, c.width - ctx.lineWidth, c.height - ctx.lineWidth)
  }
  const pad = (style.padding ?? 0.12) * c.height
  const lineH = (c.height - pad * 2) / lines.length
  ctx.fillStyle = style.fg ?? '#0F172A'
  ctx.textBaseline = 'middle'
  ctx.textAlign = style.align ?? 'center'
  lines.forEach((line, i) => {
    let size = lineH * 0.78
    ctx.font = `${style.weight ?? 700} ${size}px ${FONT}`
    const maxW = c.width - pad * 2
    while (ctx.measureText(line).width > maxW && size > 6) {
      size -= 1
      ctx.font = `${style.weight ?? 700} ${size}px ${FONT}`
    }
    const x = style.align === 'left' ? pad : style.align === 'right' ? c.width - pad : c.width / 2
    ctx.fillText(line, x, pad + lineH * (i + 0.5))
  })
  return finish(c, { srgb: true })
}

/** Generic procedural screen pattern for control-room monitors (non-numeric). */
export function createScreenTexture(seed: number): THREE.CanvasTexture {
  const rng = createRng(seed + 99)
  const [c, ctx] = canvas(256, 160)
  const g = ctx.createLinearGradient(0, 0, 0, 160)
  g.addColorStop(0, '#0B1E4D')
  g.addColorStop(1, '#0A1636')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 256, 160)
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = `rgba(96,165,250,${0.25 + rng() * 0.4})`
    ctx.fillRect(12, 14 + i * 20, 40 + rng() * 150, 8)
  }
  ctx.strokeStyle = 'rgba(52,211,153,0.8)'
  ctx.lineWidth = 2
  ctx.beginPath()
  for (let x = 0; x <= 256; x += 16) ctx.lineTo(x, 130 - rng() * 30)
  ctx.stroke()
  return finish(c, { srgb: true })
}

// ── Label atlas ──────────────────────────────────────────

export interface AtlasCell {
  key: string
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
}

export interface Atlas {
  texture: THREE.CanvasTexture
  /** [u0, v0, u1, v1] for a cell key */
  uv: (key: string) => [number, number, number, number]
}

/** Packs many small labels into one texture so they render in a single draw call. */
export function createAtlas(cells: AtlasCell[], cellW: number, cellH: number): Atlas {
  const cols = Math.max(1, Math.min(cells.length, Math.floor(4096 / cellW)))
  const rows = Math.max(1, Math.ceil(cells.length / cols))
  const [c, ctx] = canvas(cols * cellW, rows * cellH)
  const index = new Map<string, number>()
  cells.forEach((cell, i) => {
    index.set(cell.key, i)
    ctx.save()
    ctx.translate((i % cols) * cellW, Math.floor(i / cols) * cellH)
    ctx.beginPath()
    ctx.rect(0, 0, cellW, cellH)
    ctx.clip()
    cell.draw(ctx, cellW, cellH)
    ctx.restore()
  })
  const texture = finish(c, { srgb: true, anisotropy: 16 })
  return {
    texture,
    uv: key => {
      const i = index.get(key) ?? 0
      const col = i % cols
      const row = Math.floor(i / cols)
      return [col / cols, 1 - (row + 1) / rows, (col + 1) / cols, 1 - row / rows]
    },
  }
}

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** Deterministic barcode-style bars for a string (decorative, not a scannable code). */
export function drawBarcode(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, h: number) {
  const rng = createRng(hashString(text))
  ctx.fillStyle = '#111827'
  let cx = x
  while (cx < x + w) {
    const bw = 1 + Math.floor(rng() * 3)
    if (rng() > 0.45) ctx.fillRect(cx, y, bw, h)
    cx += bw + 1
  }
}

export function drawCellText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, opts: { color?: string; weight?: number; align?: CanvasTextAlign; maxW?: number } = {}) {
  ctx.fillStyle = opts.color ?? '#0F172A'
  ctx.textAlign = opts.align ?? 'left'
  ctx.textBaseline = 'middle'
  let s = size
  ctx.font = `${opts.weight ?? 700} ${s}px ${FONT}`
  while (opts.maxW && ctx.measureText(text).width > opts.maxW && s > 6) {
    s -= 1
    ctx.font = `${opts.weight ?? 700} ${s}px ${FONT}`
  }
  ctx.fillText(text, x, y)
}

// ── Status icons ─────────────────────────────────────────

/** Round badge with a white glyph; the glyph shape carries meaning without colour. */
export function createStatusIconTexture(glyph: StatusGlyph, color: string): THREE.CanvasTexture {
  const S = 128
  const [c, ctx] = canvas(S, S)
  ctx.fillStyle = '#FFFFFF'
  ctx.beginPath()
  ctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(S / 2, S / 2, S / 2 - 9, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#FFFFFF'
  ctx.fillStyle = '#FFFFFF'
  ctx.lineWidth = 11
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const p = (pts: [number, number][], close = false) => {
    ctx.beginPath()
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x * S, y * S) : ctx.lineTo(x * S, y * S)))
    if (close) ctx.closePath()
  }
  switch (glyph) {
    case 'check': p([[0.3, 0.52], [0.44, 0.66], [0.71, 0.36]]); ctx.stroke(); break
    case 'trend-down': p([[0.28, 0.36], [0.46, 0.54], [0.56, 0.44], [0.72, 0.62]]); ctx.stroke(); p([[0.6, 0.64], [0.73, 0.64], [0.73, 0.51]]); ctx.stroke(); break
    case 'alert': p([[0.5, 0.3], [0.5, 0.56]]); ctx.stroke(); ctx.beginPath(); ctx.arc(0.5 * S, 0.7 * S, 7, 0, Math.PI * 2); ctx.fill(); break
    case 'zap': p([[0.55, 0.22], [0.34, 0.54], [0.5, 0.54], [0.44, 0.78], [0.67, 0.44], [0.51, 0.44]], true); ctx.fill(); break
    case 'lock':
      ctx.fillRect(0.32 * S, 0.47 * S, 0.36 * S, 0.27 * S)
      ctx.lineWidth = 9
      ctx.beginPath(); ctx.arc(0.5 * S, 0.46 * S, 0.12 * S, Math.PI, 0); ctx.stroke(); break
    case 'arrow-in': p([[0.5, 0.25], [0.5, 0.58]]); ctx.stroke(); p([[0.37, 0.46], [0.5, 0.59], [0.63, 0.46]]); ctx.stroke(); p([[0.3, 0.72], [0.7, 0.72]]); ctx.stroke(); break
    case 'ban': ctx.beginPath(); ctx.arc(0.5 * S, 0.5 * S, 0.22 * S, 0, Math.PI * 2); ctx.stroke(); p([[0.35, 0.35], [0.65, 0.65]]); ctx.stroke(); break
    case 'circle': ctx.beginPath(); ctx.arc(0.5 * S, 0.5 * S, 0.2 * S, 0, Math.PI * 2); ctx.stroke(); break
  }
  return finish(c, { srgb: true })
}

// ── Packaging surfaces ───────────────────────────────────

export function createCartonTexture(seed: number): THREE.CanvasTexture {
  const rng = createRng(seed + 31)
  const [c, ctx] = canvas(256, 256)
  ctx.fillStyle = '#C8A06A'
  ctx.fillRect(0, 0, 256, 256)
  speckle(ctx, 256, 256, rng, 1600, ['#B48A55', '#D6B07C'], 1)
  // Three stacked tiers of two cartons, with seams and tape
  ctx.strokeStyle = 'rgba(90,62,30,0.55)'
  ctx.lineWidth = 3
  for (const y of [85, 170]) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(256, y); ctx.stroke() }
  ctx.beginPath(); ctx.moveTo(128, 0); ctx.lineTo(128, 256); ctx.stroke()
  ctx.fillStyle = 'rgba(214,190,150,0.9)'
  for (const y of [0, 85, 170]) ctx.fillRect(0, y + 36, 256, 10)
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  for (const [x, y] of [[20, 52], [148, 52], [20, 137], [148, 137], [20, 222], [148, 222]]) ctx.fillRect(x, y, 40, 22)
  return finish(c, { srgb: true })
}

export function createToteTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 128)
  ctx.fillStyle = '#2F5FCF'
  ctx.fillRect(0, 0, 128, 128)
  ctx.strokeStyle = 'rgba(10,25,70,0.55)'
  ctx.lineWidth = 4
  for (const y of [32, 64, 96]) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(128, y); ctx.stroke() }
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'
  ctx.lineWidth = 2
  for (let x = 8; x < 128; x += 12) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 128); ctx.stroke() }
  return finish(c, { srgb: true })
}

export function createSteelBundleTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 128)
  ctx.fillStyle = '#8B949E'
  ctx.fillRect(0, 0, 128, 128)
  ctx.strokeStyle = 'rgba(40,46,54,0.5)'
  ctx.lineWidth = 2
  for (let y = 0; y < 128; y += 16) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(128, y); ctx.stroke() }
  ctx.fillStyle = '#334155'
  for (const x of [24, 100]) ctx.fillRect(x, 0, 6, 128)
  return finish(c, { srgb: true })
}

export function createPalletTexture(seed: number): THREE.CanvasTexture {
  const rng = createRng(seed + 41)
  const [c, ctx] = canvas(128, 128)
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, 128, 128)
  for (let i = 0; i < 5; i++) {
    const y = 4 + i * 25
    ctx.fillStyle = `hsl(32, 35%, ${68 + rng() * 10}%)`
    ctx.fillRect(0, y, 128, 18)
  }
  ctx.fillStyle = 'rgba(60,40,20,0.6)'
  for (let i = 0; i < 5; i++) ctx.fillRect(0, 22 + i * 25, 128, 7)
  return finish(c, { srgb: true })
}
