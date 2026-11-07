import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/*
 * The engine (src/game/engine, src/game/content) is a pure simulation: it is
 * run by the store, the balance harness and the tests alike, and a save
 * replays to the same future only because nothing in it reads browser state
 * or an unseeded random number. These rules keep it that way.
 */
const ENGINE_SOURCES = ['src/game/engine/**/*.ts', 'src/game/content/**/*.ts']

const engineImports = {
  paths: [
    { name: 'react', message: 'The engine is pure: no React.' },
    { name: 'react-dom', message: 'The engine is pure: no React.' },
    { name: 'zustand', message: 'The engine is pure: the store drives it, not the other way round.' },
    { name: 'three', message: 'The engine is pure: rendering lives in src/ui.' },
  ],
  patterns: [
    { group: ['react-dom/*', 'zustand/*', 'three/*', '@react-three/*'], message: 'The engine is pure: no UI or rendering libraries.' },
    // Relative (../../ui/...) or aliased (@/ui/...).
    { regex: '(^|/)ui(/|$)', message: 'The engine must not import from src/ui.' },
  ],
}

const browserState = 'The engine is pure: no browser state; the store passes in what it needs.'
const BROWSER_GLOBALS = ['window', 'document', 'localStorage', 'sessionStorage', 'performance', 'navigator']
const viaGlobalThis = BROWSER_GLOBALS.map((property) => ({ object: 'globalThis', property, message: browserState }))

export default defineConfig([
  globalIgnores([
    'dist/',
    'dist-ssr/',
    'dev-dist/',
    'dist-artifact/',
    'playwright-report/',
    'test-results/',
    'blob-report/',
    'coverage/',
  ]),

  js.configs.recommended,
  tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser },
    },
    linterOptions: {
      // The 15 exhaustive-deps disables are deliberate; a stale one should say so.
      reportUnusedDisableDirectives: 'warn',
    },
  },

  // Build scripts, configs and the Playwright suite run in Node.
  {
    files: ['scripts/**', '*.config.{js,ts}', 'e2e/**', 'src/styles.test.ts'],
    languageOptions: { globals: { ...globals.node } },
  },

  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      // A warning, so each `eslint-disable-next-line` for it is a considered choice.
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // A leading underscore marks a name left unused on purpose (a dropped
      // field in a rest destructure, a callback's unused parameter).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },

  // Engine purity: imports, for sources and tests alike.
  {
    files: ['src/game/engine/**', 'src/game/content/**'],
    rules: { 'no-restricted-imports': ['error', engineImports] },
  },

  // Engine purity: browser state and unseeded randomness, for sources (tests stub storage).
  {
    files: ENGINE_SOURCES,
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...BROWSER_GLOBALS.map((name) => ({ name, message: browserState })),
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded RNG in engine/rng.ts so runs replay.' },
        ...viaGlobalThis,
      ],
    },
  },
  {
    // The one place a fresh seed is drawn, for a run started without one.
    files: ['src/game/engine/rng.ts'],
    rules: { 'no-restricted-properties': ['error', ...viaGlobalThis] },
  },
])
