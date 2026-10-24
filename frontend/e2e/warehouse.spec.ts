import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

const SCREENSHOTS = resolve(dirname(fileURLToPath(import.meta.url)), '../../docs/screenshots')
const PRESETS = ['exterior', 'docks', 'receiving', 'storage', 'dispatch', 'control'] as const
const STAGE = 'stage2'

type V3 = [number, number, number]

interface Snapshot {
  ready: boolean
  preset: string
  lots: number
  equipment: number
  mode: string
  cutaway: boolean
  selectedPosition: string | null
  selectedRack: string | null
  selectedEntity: string | null
  highlightSku: string | null
}

interface Hook {
  info: () => { calls: number; triangles: number; shadowMaps: number; shadowsEnabled: boolean }
  setPreset: (id: string) => void
  selectPosition: (id: string | null) => void
  selectEntity: (id: string | null) => void
  getSnapshot: () => Snapshot
  getCamera: () => { position: V3; target: V3 }
  screenOf: (id: string) => { x: number; y: number; visible: boolean } | null
}

type W = { __SR3D__: Hook }

const hook = (page: Page) => ({
  snapshot: () => page.evaluate(() => (window as unknown as W).__SR3D__.getSnapshot()),
  info: () => page.evaluate(() => (window as unknown as W).__SR3D__.info()),
  camera: () => page.evaluate(() => (window as unknown as W).__SR3D__.getCamera()),
  screenOf: (id: string) => page.evaluate(i => (window as unknown as W).__SR3D__.screenOf(i), id),
  setPreset: (id: string) => page.evaluate(p => (window as unknown as W).__SR3D__.setPreset(p), id),
  selectPosition: (id: string) => page.evaluate(p => (window as unknown as W).__SR3D__.selectPosition(p), id),
  selectEntity: (id: string | null) => page.evaluate(p => (window as unknown as W).__SR3D__.selectEntity(p), id),
})

const dist2D = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[2] - b[2])

test.describe('3D warehouse (SIMULATION, offline)', () => {
  test('renders the world, inventory and interactions with no errors and no third-party requests', async ({ page, context }) => {
    mkdirSync(SCREENSHOTS, { recursive: true })
    const blocked: string[] = []
    const errors: string[] = []
    const shot = (name: string) => page.screenshot({ path: `${SCREENSHOTS}/${STAGE}-${name}.png` })

    // Anything that is not localhost is blocked and recorded: proves the app runs offline
    await context.route('**/*', route => {
      const url = new URL(route.request().url())
      if (['localhost', '127.0.0.1'].includes(url.hostname) || url.protocol === 'data:' || url.protocol === 'blob:') {
        return route.continue()
      }
      blocked.push(url.href)
      return route.abort()
    })
    // The shell polls the backend health endpoint; answer it so no backend is needed
    await context.route('http://localhost:8000/**', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok', app_name: 'StockRescue', demo_mode: true, real_purchasing_enabled: false }),
      }),
    )
    page.on('console', m => {
      if (m.type() === 'error') errors.push(m.text())
    })
    page.on('pageerror', e => errors.push(e.message))

    await context.addInitScript(() => {
      localStorage.setItem('stockrescue_demo_session', JSON.stringify({
        access_token: 'demo', token_type: 'bearer', expires_in: 3600, refresh_token: 'demo',
        user: { id: 'demo', email: 'operator@stockrescue.internal', app_metadata: { roles: ['procurement_approver'] }, user_metadata: {} },
      }))
      localStorage.setItem('stockrescue_twin_mode', 'simulation')
    })

    await page.goto('/warehouse?seed=42&freeze=1')
    await page.waitForFunction(() => (window as unknown as { __SR3D__?: Hook }).__SR3D__?.getSnapshot().ready === true, null, { timeout: 180_000 })

    const h = hook(page)
    const canvas = page.locator('canvas[aria-label]')
    await expect(canvas).toBeVisible()
    expect(await canvas.evaluate(c => !!((c as HTMLCanvasElement).getContext('webgl2') ?? (c as HTMLCanvasElement).getContext('webgl')))).toBe(true)
    await expect(page.getByText('Simulation mode: not real operational data')).toBeVisible()

    const snap = await h.snapshot()
    expect(snap.mode).toBe('simulation')
    expect(snap.lots).toBeGreaterThan(0)
    const first = await h.info()
    expect(first.shadowsEnabled).toBe(true)
    expect(first.shadowMaps).toBeGreaterThan(0)

    // Legend overlay is always visible over the canvas
    const legend = page.getByRole('list', { name: 'Status legend' }).first()
    for (const label of ['In stock', 'Low stock', 'Shortage', 'Disruption-affected', 'Reserved / Allocated', 'Incoming', 'Quarantine', 'Empty']) {
      await expect(legend.getByText(label, { exact: true })).toBeVisible()
    }

    // ── Presets ──
    await page.getByRole('button', { name: 'Hide panels' }).click()
    for (const id of PRESETS) {
      await h.setPreset(id)
      await page.waitForTimeout(2500)
      expect((await h.snapshot()).preset).toBe(id)
      expect((await h.info()).calls).toBeGreaterThan(0)
      await shot(`${PRESETS.indexOf(id) + 1}-${id}`)
    }
    await h.setPreset('exterior')
    await page.getByRole('button', { name: 'Cutaway' }).click()
    await page.waitForTimeout(2500)
    await shot('7-exterior-cutaway')
    await page.getByRole('button', { name: 'Cutaway' }).click()

    // ── Real pointer click on a rack in the 3D view ──
    await h.setPreset('storage')
    await page.waitForTimeout(1500)
    const rackId = 'A02-R14'
    const p = await h.screenOf(rackId)
    expect(p?.visible).toBe(true)
    await page.mouse.click(p!.x, p!.y)
    await page.waitForTimeout(1500)
    const afterRack = await h.snapshot()
    expect(afterRack.selectedRack).not.toBeNull()
    await shot('8-rack-selected')

    // ── Position by id: inspector + camera ──
    await page.getByRole('button', { name: 'Show panels' }).click()
    await h.selectPosition('A05-R02-L01-P01')
    await page.waitForTimeout(1500)
    const drawer = page.locator('#twin-drawer')
    await expect(drawer.getByText('A05-R02-L01-P01').first()).toBeVisible()
    await expect(drawer.getByText('MTR-7.5KW-IE3').first()).toBeVisible()
    const cam = await h.camera()
    expect(cam.target[1]).toBeGreaterThan(0)
    await shot('9-position-inspector')

    // ── SKU search flies the camera to frame every location holding it ──
    await page.getByLabel('Search SKU').fill('MTR-7.5')
    await page.getByRole('button', { name: /MTR-7\.5KW-IE3/ }).first().click()
    await page.waitForTimeout(1500)
    const searched = await h.snapshot()
    expect(searched.highlightSku).toBe('MTR-7.5KW-IE3')
    expect(searched.cutaway).toBe(true)
    await page.getByRole('button', { name: 'Hide panels' }).click()
    await shot('10-sku-search')
    await page.getByRole('button', { name: 'Show panels' }).click()

    // ── Row → camera: equipment row flies to its bay and opens the record ──
    await page.getByRole('tab', { name: /equipment/i }).click()
    const row = page.getByRole('button', { name: /Forklift 01/ })
    await row.click()
    await page.waitForTimeout(1500)
    expect((await h.snapshot()).selectedEntity).toBe('FL-01')
    await expect(drawer.getByText('Forklift 01').first()).toBeVisible()
    expect(dist2D((await h.camera()).target, [28, 0, -20])).toBeLessThan(1.5)
    await expect(row).toHaveAttribute('aria-pressed', 'true')

    // ── 3D → row: selecting a dock highlights its shipment rows ──
    await h.selectEntity('D02')
    await page.waitForTimeout(1200)
    expect((await h.snapshot()).selectedEntity).toBe('D02')
    await expect(drawer.getByText('Dock 2').first()).toBeVisible()
    await shot('11-dock-selected')

    expect(blocked, `blocked requests: ${blocked.join(', ')}`).toEqual([])
    expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([])
  })
})
