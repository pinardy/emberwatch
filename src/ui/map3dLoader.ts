import { useGameStore } from '../game/store'

/*
 * The 3D map's code (three.js and the scene) is its own lazy chunk. This small
 * module is how both the map and the idle-time preloader fetch it, so the
 * startup chunk never pulls in the map itself.
 */

type MapView3DModule = typeof import('./map3d/MapView3D')

let pending: Promise<MapView3DModule> | null = null

/** Fetches the 3D map's chunk; safe to call any number of times, retried after a failure. */
export function loadMapView3D(): Promise<MapView3DModule> {
  pending ??= import('./map3d/MapView3D').catch((error: unknown) => {
    pending = null
    throw error
  })
  return pending
}

let webglSupport: boolean | null = null

/** Whether this device can create a WebGL context at all (checked once). */
export function hasWebGL(): boolean {
  if (webglSupport !== null) return webglSupport
  try {
    const canvas = document.createElement('canvas')
    webglSupport = Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext('webgl2') ?? canvas.getContext('webgl')),
    )
  } catch {
    webglSupport = false
  }
  return webglSupport
}

/** Forgets the WebGL check, so a test can stand in a WebGL-capable canvas. */
export function forgetWebGLCheckForTests(): void {
  webglSupport = null
}

/**
 * Preloads the 3D map when it is the renderer the game will show, so a run
 * opens on the map rather than on "Raising the forest". Quiet on failure:
 * the map retries, and says so, when it is actually shown.
 */
export function preloadMapView3D(): Promise<unknown> {
  if (useGameStore.getState().settings.renderer !== '3d' || !hasWebGL()) return Promise.resolve()
  return loadMapView3D().catch(() => undefined)
}
