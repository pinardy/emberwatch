import { expect, test, type Page } from '@playwright/test'

/*
 * Real-browser smoke test: the path a player takes, in a real Chromium with a
 * real requestAnimationFrame loop, WebGL and a service worker. The jsdom tests
 * call the store directly and once missed a loop that never advanced at 60 fps;
 * this suite exists to catch that class of bug.
 */

const RUN_KEY = 'emberwatch.run.v1'

/** Fails the test on any uncaught error, console error, or failed request. */
function watchForErrors(page: Page): string[] {
  const problems: string[] = []
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`))
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console.error: ${msg.text()}`)
  })
  page.on('requestfailed', (req) => {
    const reason = req.failure()?.errorText ?? 'failed'
    // Navigating away aborts in-flight requests; that is not a defect.
    if (reason.includes('ERR_ABORTED')) return
    problems.push(`requestfailed: ${req.url()} (${reason})`)
  })
  page.on('response', (res) => {
    if (res.status() >= 400) problems.push(`HTTP ${res.status()}: ${res.url()}`)
  })
  return problems
}

/** menu → New settlement → Set out → answer the opening draft → in the game. */
async function startSettlement(page: Page): Promise<void> {
  await page.goto('./')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Emberwatch')
  await page.getByRole('button', { name: /New settlement/i }).click()
  await page.getByRole('button', { name: /Set out with/i }).click()

  // The run opens on a blueprint draft (and possibly a cornerstone draft).
  // Answer every choice the way a player would until none remain.
  const options = page.locator('button.option')
  await expect(options.first()).toBeVisible()
  for (let guard = 0; guard < 10 && (await options.count()) > 0; guard++) {
    await options.first().click()
    // Each answer swaps or closes the modal; let React settle before counting.
    await page.waitForTimeout(150)
  }
  await expect(options).toHaveCount(0)
  await expect(page.locator('header.topbar')).toBeVisible()
  await expect(page.locator('[aria-label="Settlement map"]').first()).toBeVisible()
}

async function savedClock(page: Page): Promise<number | null> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const clock = (JSON.parse(raw) as { clock?: unknown }).clock
    return typeof clock === 'number' ? clock : null
  }, RUN_KEY)
}

/** Max real seconds one frame may feed the sim; mirrors useGameLoop. */
const FRAME_CLAMP_S = 0.5

/**
 * Starts a test-only rAF counter of the frame time the game loop is entitled
 * to: the sum of each frame's delta, clamped exactly as useGameLoop clamps it.
 */
async function startFrameClock(page: Page): Promise<void> {
  await page.evaluate((clamp) => {
    const w = window as unknown as { __e2eFrameClock?: number }
    if (w.__e2eFrameClock !== undefined) return
    w.__e2eFrameClock = 0
    let last = performance.now()
    const step = (now: number) => {
      w.__e2eFrameClock! += Math.min((now - last) / 1000, clamp)
      last = now
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }, FRAME_CLAMP_S)
}

interface ClockSample {
  /** Frame time the page has received since startFrameClock, in seconds. */
  frames: number
  year: number
  /** Seconds left in the season, from the top bar's "Year 1 · 2m 27s left". */
  left: number
}

/** Reads the frame clock and the season timer in one task, so no frame slips between. */
async function sampleClock(page: Page): Promise<ClockSample> {
  const { frames, text } = await page.evaluate(() => ({
    frames: (window as unknown as { __e2eFrameClock: number }).__e2eFrameClock,
    text: document.querySelector('.season-text small')?.textContent ?? '',
  }))
  const match = /Year\s+(\d+)\s*·\s*(?:(\d+)m)?\s*(?:(\d+)s)?\s*left/.exec(text)
  if (!match || (!match[2] && !match[3])) throw new Error(`unreadable season timer: "${text}"`)
  return {
    frames,
    year: Number(match[1]),
    left: Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0),
  }
}

/** The longest warning the game writes, at its full length. */
const LONG_WARNING =
  'Stockpile full of Berries — 4 buildings have stopped. You can afford a Warehouse now — build one, or dump some Berries (select the hearth or a warehouse).'

/**
 * Puts a short danger and the long stockpile warning into the real warnings
 * strip (its own list, its own classes) and returns where they landed, the
 * dock's top region and the side panel.
 */
async function longWarningLayout(page: Page) {
  return page.evaluate((text) => {
    const list = document.querySelector('.hud-top .warnings-list')
    if (!list) throw new Error('no warnings strip')
    if (!list.querySelector('.e2e-warning')) {
      for (const [severity, body] of [
        ['danger', 'The Queen is nearly out of patience.'],
        ['caution', text],
      ]) {
        const el = document.createElement('div')
        el.className = `warning is-${severity} e2e-warning`
        el.textContent = body
        list.append(el)
      }
    }
    const box = (el: Element | null) => {
      const r = el!.getBoundingClientRect()
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
    }
    return {
      warnings: [...list.querySelectorAll('.e2e-warning')].map(box),
      region: box(document.querySelector('.hud-top')),
      sidebar: box(document.querySelector('.sidebar')),
      tabs: box(document.querySelector('.sidebar .tabs')),
      width: document.documentElement.clientWidth,
    }
  }, LONG_WARNING)
}

test.describe('desktop', () => {
  test('a long warning wraps inside the dock and never covers the side panel', async ({
    page,
  }) => {
    const problems = watchForErrors(page)
    await page.setViewportSize({ width: 1280, height: 800 })
    await startSettlement(page)
    for (const [width, height] of [
      [1280, 800],
      [1440, 900],
      [1920, 1080],
    ]) {
      await page.setViewportSize({ width, height })
      const layout = await longWarningLayout(page)
      for (const w of layout.warnings) {
        expect(w.left, `${width}px`).toBeGreaterThanOrEqual(layout.region.left - 1)
        expect(w.right, `${width}px`).toBeLessThanOrEqual(layout.region.right + 1)
        expect(w.right, `${width}px`).toBeLessThanOrEqual(layout.sidebar.left)
      }
      // The long one wraps rather than running out of the region.
      const long = layout.warnings[1]
      expect(long.bottom - long.top, `${width}px`).toBeGreaterThan(30)
    }
    expect(problems).toEqual([])
  })

  test('the keyboard reaches the 3D glade plates through the glade list', async ({ page }) => {
    const problems = watchForErrors(page)
    await startSettlement(page)
    await expect(page.locator('.map-wrap-3d canvas')).toBeVisible({ timeout: 15_000 })
    const list = page.getByRole('navigation', { name: 'Glades' })
    const first = list.locator('button[tabindex="0"]')
    await expect(first).toHaveCount(1)
    // Out of sight until focused, then a readable panel.
    expect((await list.boundingBox())?.width ?? 0).toBeLessThan(4)
    await first.focus()
    expect((await list.boundingBox())?.width ?? 0).toBeGreaterThan(150)
    await page.keyboard.press('ArrowDown')
    const picked = list.locator('button[tabindex="0"]')
    const name = (await picked.locator('strong').textContent()) ?? ''
    expect(name.length).toBeGreaterThan(0)
    await page.keyboard.press('Enter')
    await expect(page.locator('.inspector')).toContainText(name)
    expect(problems).toEqual([])
  })

  test('a new settlement runs in real time and both maps render', async ({ page }) => {
    const problems = watchForErrors(page)
    await startSettlement(page)

    // A fresh run starts at 1×.
    await expect(page.getByRole('group', { name: 'Game speed' }).locator('.is-active')).toHaveText(
      '1×',
    )

    // The default renderer is the 3D map, which must actually mount a canvas.
    await expect(page.locator('.map-wrap-3d canvas')).toBeVisible({ timeout: 15_000 })

    // Switch to the 2D map: the SVG renderer replaces the canvas.
    await page.getByRole('button', { name: 'Switch to 2D map' }).click()
    const svgMap = page.locator('svg[role="img"][aria-label="Settlement map"]')
    await expect(svgMap).toBeVisible()
    expect(await svgMap.locator('path, polygon, circle').count()).toBeGreaterThan(10)
    await expect(page.getByRole('button', { name: 'Switch to 3D map' })).toBeVisible()

    /*
     * The in-game clock advances in step with real time at 1×. Measured on the
     * 2D map on purpose: it renders at the display's full rate, the regime
     * where a sub-tick frame delta once left the world standing still. (Under
     * software WebGL, frames are slow enough to hide that bug.)
     *
     * The yardstick is the frame time the page actually received, clamped the
     * way the game loop clamps it, rather than the wall clock: a busy machine
     * that stalls the renderer legitimately costs game time, and that must
     * not read as a broken loop.
     */
    await startFrameClock(page)
    const before = await sampleClock(page)
    await expect
      .poll(async () => (await sampleClock(page)).frames, { timeout: 25_000 })
      .toBeGreaterThan(before.frames + 4)
    const after = await sampleClock(page)
    expect(after.year).toBe(before.year)
    const budget = after.frames - before.frames
    const advanced = before.left - after.left
    // Slack: the timer shows whole seconds (rounded up), so the difference of
    // two readings is off by < 1 s, and the sim may hold < 1 tick in reserve.
    expect(advanced).toBeGreaterThan(budget * 0.95 - 1.2)
    expect(advanced).toBeLessThan(budget * 1.05 + 1.2)

    // The autosave (every 8 s) persists a clock that has moved on.
    await expect.poll(() => savedClock(page), { timeout: 12_000 }).toBeGreaterThan(3)

    expect(problems).toEqual([])
  })

  test('serves the manifest and works offline via the service worker', async ({
    page,
    request,
  }) => {
    const problems = watchForErrors(page)
    await page.goto('./')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Emberwatch')

    // The manifest link resolves, and everything it names lives under the base.
    const manifestHref = await page
      .locator('link[rel="manifest"]')
      .evaluate((el) => (el as HTMLLinkElement).href)
    const manifestRes = await request.get(manifestHref)
    expect(manifestRes.status()).toBe(200)
    const manifest = (await manifestRes.json()) as {
      start_url: string
      scope: string
      icons: { src: string }[]
    }
    const appRoot = new URL('./', page.url()).href
    expect(new URL(manifest.start_url, manifestHref).href).toBe(appRoot)
    expect(new URL(manifest.scope, manifestHref).href).toBe(appRoot)
    expect(manifest.icons.length).toBeGreaterThan(0)
    for (const icon of manifest.icons) {
      const res = await request.get(new URL(icon.src, manifestHref).href)
      expect(res.status(), icon.src).toBe(200)
    }

    // index.html's own icon links resolve too.
    const iconHrefs = await page
      .locator('link[rel="icon"], link[rel="apple-touch-icon"]')
      .evaluateAll((els) => els.map((el) => (el as HTMLLinkElement).href))
    for (const href of iconHrefs) {
      expect((await request.get(href)).status(), href).toBe(200)
    }

    // The service worker activates with the app root as its scope.
    const sw = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready
      return { scope: reg.scope, script: reg.active?.scriptURL ?? '' }
    })
    expect(sw.scope).toBe(appRoot)
    expect(sw.script).toBe(new URL('sw.js', appRoot).href)
    expect((await request.get(sw.script)).status()).toBe(200)

    // Once active, the precached shell boots with the network gone.
    await page.context().setOffline(true)
    try {
      await page.reload()
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Emberwatch')
    } finally {
      await page.context().setOffline(false)
    }

    expect(problems).toEqual([])
  })
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('reaches the game on a phone-sized touch screen', async ({ page }) => {
    const problems = watchForErrors(page)
    await startSettlement(page)
    await expect(page.locator('.season-text')).toBeVisible()

    // Nothing in the shell may push the page sideways.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)

    // The warnings strip stays on the map, above the side panel's tabs.
    const layout = await longWarningLayout(page)
    for (const w of layout.warnings) {
      expect(w.left).toBeGreaterThanOrEqual(0)
      expect(w.right).toBeLessThanOrEqual(layout.width)
      expect(w.bottom).toBeLessThanOrEqual(layout.tabs.top)
    }

    expect(problems).toEqual([])
  })
})
