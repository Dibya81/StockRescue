import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

const SCREENSHOTS = resolve(dirname(fileURLToPath(import.meta.url)), '../../docs/screenshots')
const PRESETS = ['exterior', 'docks', 'receiving', 'storage', 'dispatch', 'control'] as const

interface Snapshot {
  ready: boolean
  preset: string
  lots: number
  equipment: number
  mode: string
}

interface Hook {
  info: () => { calls: number; triangles: number; shadowMaps: number; shadowsEnabled: boolean }
  setPreset: (id: string) => void
  selectPosition: (id: string | null) => void
  getSnapshot: () => Snapshot
}

const hook = (page: Page) => ({
  snapshot: () => page.evaluate(() => (window as unknown as { __SR3D__: Hook }).__SR3D__.getSnapshot()),
  info: () => page.evaluate(() => (window as unknown as { __SR3D__: Hook }).__SR3D__.info()),
  setPreset: (id: string) => page.evaluate(p => (window as unknown as { __SR3D__: Hook }).__SR3D__.setPreset(p), id),
  selectPosition: (id: string) => page.evaluate(p => (window as unknown as { __SR3D__: Hook }).__SR3D__.selectPosition(p), id),
})

test.describe('3D warehouse (SIMULATION, offline)', () => {
  test('renders a real WebGL scene with no errors and no third-party requests', async ({ page, context }) => {
    mkdirSync(SCREENSHOTS, { recursive: true })
    const blocked: string[] = []
    const errors: string[] = []

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
    await page.waitForFunction(
      () => (window as unknown as { __SR3D__?: Hook }).__SR3D__?.getSnapshot().ready === true,
      null,
      { timeout: 180_000 },
    )

    const h = hook(page)
    const canvas = page.locator('canvas[aria-label]')
    await expect(canvas).toBeVisible()
    const gl = await canvas.evaluate(c => !!((c as HTMLCanvasElement).getContext('webgl2') ?? (c as HTMLCanvasElement).getContext('webgl')))
    expect(gl).toBe(true)
    await expect(page.getByText('Simulation mode: not real operational data')).toBeVisible()

    const snap = await h.snapshot()
    expect(snap.mode).toBe('simulation')
    expect(snap.lots).toBeGreaterThan(0)
    const first = await h.info()
    expect(first.shadowsEnabled).toBe(true)
    expect(first.shadowMaps).toBeGreaterThan(0)

    // Close the panels so screenshots show the world
    await page.getByRole('button', { name: 'Hide panels' }).click()

    for (const id of PRESETS) {
      await h.setPreset(id)
      await page.waitForTimeout(2500)
      expect((await h.snapshot()).preset).toBe(id)
      expect((await h.info()).calls).toBeGreaterThan(0)
      await page.screenshot({ path: `${SCREENSHOTS}/stage1-${PRESETS.indexOf(id) + 1}-${id}.png` })
    }

    // Exterior aerial with the cutaway toggled on
    await h.setPreset('exterior')
    await page.getByRole('button', { name: 'Cutaway' }).click()
    await page.waitForTimeout(2500)
    await page.screenshot({ path: `${SCREENSHOTS}/stage1-7-exterior-cutaway.png` })
    await page.getByRole('button', { name: 'Cutaway' }).click()

    // Selecting a position by id opens the inspector with its real record
    await page.getByRole('button', { name: 'Show panels' }).click()
    await h.selectPosition('A05-R02-L01-P01')
    const inspector = page.locator('#twin-drawer')
    await expect(inspector.getByText('A05-R02-L01-P01').first()).toBeVisible()
    await expect(inspector.getByText('MTR-7.5KW-IE3').first()).toBeVisible()
    await page.screenshot({ path: `${SCREENSHOTS}/stage1-8-inspector.png` })

    expect(blocked, `blocked requests: ${blocked.join(', ')}`).toEqual([])
    expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([])
  })
})
