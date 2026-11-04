import { defineConfig, devices } from '@playwright/test'

/*
 * Real-browser smoke tests. jsdom tests drive the store directly, so they
 * cannot catch a game loop that never advances under requestAnimationFrame,
 * a WebGL scene that fails to mount, or a service worker that 404s. These do.
 *
 * The suite serves a production build with `vite preview` on a fixed port.
 * Set BASE_PATH (e.g. /roguelite-game/) to build and serve under the same
 * sub-path GitHub Pages uses. Set E2E_SKIP_BUILD=1 to reuse an existing
 * dist/ (CI builds once, in its own step).
 */

const PORT = 4319
const HOST = '127.0.0.1'

/** Mirrors resolveBase() in vite.config.ts: the path the preview serves at. */
function basePath(): string {
  const raw = process.env.BASE_PATH?.trim()
  if (!raw || raw === '.' || raw === './') return '/'
  const lead = raw.startsWith('/') ? raw : `/${raw}`
  return lead.endsWith('/') ? lead : `${lead}/`
}

const isCI = Boolean(process.env.CI)
const origin = `http://${HOST}:${PORT}`
const preview = `npx vite preview --host ${HOST} --port ${PORT} --strictPort`

export default defineConfig({
  testDir: './e2e',
  // Generous per test; the whole suite runs in well under a minute.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  /*
   * One browser at a time. Software WebGL is CPU-hungry and multithreaded: a
   * 3D scene in a parallel worker starves the page whose clock is being timed
   * against the wall, which made the real-time assertion flaky.
   */
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI
    ? [['list'], ['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `${origin}${basePath()}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          /*
           * Headless Chromium on a GPU-less runner has no hardware WebGL.
           * SwiftShader (software GL through ANGLE) lets the three.js map
           * mount instead of the app quietly falling back to the 2D map.
           */
          args: [
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
            '--ignore-gpu-blocklist',
          ],
        },
      },
    },
  ],
  webServer: {
    command: process.env.E2E_SKIP_BUILD ? preview : `npm run build && ${preview}`,
    url: `${origin}${basePath()}`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
