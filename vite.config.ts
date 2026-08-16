import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

const isTest = process.env.VITEST === 'true'

export default defineConfig({
  base: './',
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
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
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
        },
      },
      {
        extends: true,
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
        },
      },
    ],
  },
})
