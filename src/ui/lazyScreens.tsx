import { Component, Suspense, lazy, useRef } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { loadIcons } from './Icon'
import './lazy-screens.css'

/*
 * Screens the menu does not need are split out of the startup chunk and
 * fetched on demand: the setup, Citadel, saves and achievements screens, the
 * game screen, and the end-of-run modal with its timeline chart. (The daily
 * expedition screen stays eager: the menu shows its entry card.) To keep the first interaction
 * instant, the app preloads them in idle time once the menu is up, and a
 * screen whose code has already arrived renders directly, without suspending
 * — so after the preload, navigating behaves exactly as it did before the
 * split. The service worker precaches every chunk, so this works offline.
 */

type Loader = () => Promise<ComponentType>

/** The screens take no props: they read everything from the store. */
export interface LazyScreen {
  (): ReactNode
  /** Fetches the screen's code; safe to call any number of times, retried after a failure. */
  preload: () => Promise<unknown>
}

function lazyScreen(load: Loader, fallback: ReactNode): LazyScreen {
  let loaded: ComponentType | null = null
  let pending: Promise<ComponentType> | null = null
  const preload = () => {
    // Every lazy screen draws icons, so their registry arrives with the code.
    pending ??= Promise.all([load(), loadIcons()]).then(
      ([component]) => (loaded = component),
      (error: unknown) => {
        pending = null // let a later attempt retry
        throw error
      },
    )
    return pending
  }
  const Lazy = lazy(() => preload().then((component) => ({ default: component })))

  function Screen() {
    // Pick once per mount, so the screen is never remounted when its code lands.
    const Resolved = useRef<ComponentType | null>(loaded).current
    if (Resolved) return <Resolved />
    return (
      <LoadBoundary>
        <Suspense fallback={fallback}>
          <Lazy />
        </Suspense>
      </LoadBoundary>
    )
  }
  Screen.preload = preload
  return Screen
}

/** If a chunk cannot be fetched (offline before it was cached), say so plainly. */
class LoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="screen screen-loading" role="alert">
        <p>This part of the game could not be loaded. Check your connection and reload.</p>
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    )
  }
}

const screenFallback = (
  <div className="screen screen-loading" role="status" aria-live="polite">
    Loading…
  </div>
)

export const SetupScreen = lazyScreen(
  () => import('./SetupScreen').then((m) => m.SetupScreen),
  screenFallback,
)

export const CitadelScreen = lazyScreen(
  () => import('./CitadelScreen').then((m) => m.CitadelScreen),
  screenFallback,
)

export const SavesScreen = lazyScreen(
  () => import('./SavesScreen').then((m) => m.SavesScreen),
  screenFallback,
)

export const AchievementsScreen = lazyScreen(
  () => import('./AchievementsScreen').then((m) => m.AchievementsScreen),
  screenFallback,
)

export const GameScreen = lazyScreen(
  () => import('./GameScreen').then((m) => m.GameScreen),
  <div className="screen screen-loading" role="status" aria-live="polite">
    Lighting the hearth…
  </div>,
)

/** The end-of-run summary and timeline chart; only needed once a run ends. */
export const EndModal = lazyScreen(
  () => import('./EndModal').then((m) => m.EndModal),
  <div className="overlay" role="status" aria-live="polite">
    <div className="modal screen-loading">Tallying the settlement…</div>
  </div>,
)

/** Everything above, in the order a player is likely to need it. */
export function preloadScreens(): Promise<unknown> {
  return Promise.all([
    SetupScreen.preload(),
    GameScreen.preload(),
    CitadelScreen.preload(),
    SavesScreen.preload(),
    EndModal.preload(),
    AchievementsScreen.preload(),
  ])
}

/**
 * Preloads once the browser is idle after first paint. A failure here is
 * quiet: the screen retries when it is actually opened, and says so then.
 */
export function preloadScreensWhenIdle(): () => void {
  const warmUp = () => void preloadScreens().catch(() => undefined)
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
    cancelIdleCallback?: (id: number) => void
  }
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(warmUp, { timeout: 2000 })
    return () => w.cancelIdleCallback?.(id)
  }
  const id = window.setTimeout(warmUp, 300)
  return () => window.clearTimeout(id)
}
