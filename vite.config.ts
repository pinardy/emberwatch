import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

const isTest = process.env.VITEST === 'true'

/*
 * Where the app is served from. The default relative base works from any
 * directory for dev, tests and `vite preview`; a build served from a sub-path sets
 * BASE_PATH=/roguelite-game/ so asset URLs, the manifest link and the service
 * worker's scope are all anchored to the project-site sub-path.
 */
function resolveBase(raw: string | undefined): string {
  const value = raw?.trim()
  if (!value) return './'
  if (value === '.' || value === './') return './'
  const withLead = value.startsWith('/') ? value : `/${value}`
  return withLead.endsWith('/') ? withLead : `${withLead}/`
}

/** Real-browser smoke tests live in e2e/ and run under Playwright, not vitest. */
const testExclude = [...configDefaults.exclude, 'e2e/**']

export default defineConfig({
  base: resolveBase(process.env.BASE_PATH),
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // The PWA virtual module only exists inside a real plugin build, so tests
      // mounting the UI get a stub instead.
      ...(isTest
        ? {
            'virtual:pwa-register/react': fileURLToPath(
              new URL('./src/test/pwa-register-stub.ts', import.meta.url),
            ),
          }
        : {}),
    },
  },
  build: {
    // three.js alone is ~850 kB minified and cannot be tree-shaken under r3f
    // (it registers the whole THREE namespace), so the lazy vendor chunk is
    // allowed to exceed the default 500 kB warning; anything else may not.
    chunkSizeWarningLimit: 900,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              /*
               * React itself is needed up front by both the shell and the 3D
               * renderer. Claiming it first (higher priority) keeps it out of
               * the three-vendor group below, which otherwise drags its
               * dependencies along and would make that chunk load eagerly.
               */
              name: 'react-vendor',
              test: /node_modules[\\/](react|react-dom|scheduler|use-sync-external-store|zustand)[\\/]/,
              priority: 2,
            },
            {
              /*
               * three.js and its React bindings change far less often than
               * the map code, so they get their own long-cached chunk that
               * only the lazy 3D map imports.
               */
              name: 'three-vendor',
              priority: 1,
              test: /node_modules[\\/](three|three-stdlib|@react-three[\\/](fiber|drei)|react-reconciler|its-fine|suspend-react|react-use-measure)[\\/]/,
            },
          ],
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      // A new version waits for the player's Reload (UpdatePrompt) rather than
      // swapping chunks under a running game.
      registerType: 'prompt',
      includeAssets: ['favicon.svg'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // The whole game is client-side, so a single app-shell fallback is enough.
        navigateFallback: 'index.html',
        // The lazy-loaded three.js chunk exceeds the default 2 MiB cap; keep it
        // precached so the 3D map works offline too.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      manifest: {
        name: 'Emberwatch — Roguelite City Builder',
        short_name: 'Emberwatch',
        description:
          'Build settlements in a rain-soaked forest. Survive the storm, satisfy your villagers, and win the Queen’s favour before her patience runs out.',
        theme_color: '#141b21',
        background_color: '#0d1216',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  test: {
    globals: true,
    // The sim tests are environment-agnostic; the UI tests need a DOM. Each
    // environment is its own project, and `extends` hands them the plugins and
    // aliases above.
    projects: [
      {
        extends: true,
        test: {
          name: 'sim',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: testExclude,
        },
      },
      {
        extends: true,
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          // Lazy screens are loaded up front so UI tests can click straight
          // through them; LazyScreens.test.tsx covers the cold, suspending path.
          setupFiles: ['src/test/setup-ui.ts'],
          exclude: testExclude,
        },
      },
    ],
  },
})
