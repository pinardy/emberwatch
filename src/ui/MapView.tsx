import { Component, Suspense, lazy, memo, useEffect, useRef, type ReactNode } from 'react'
import { useGameStore } from '../game/store'
import { hasWebGL, loadMapView3D } from './map3dLoader'
import { MapView2D } from './MapView2D'

/*
 * The 3D renderer (three.js) is lazy-loaded so the main bundle stays small and
 * environments without WebGL — old devices, jsdom in tests — never touch it.
 */
const MapView3D = lazy(() => loadMapView3D().then((m) => ({ default: m.MapView3D })))

/** How long a lost WebGL context may take to come back before the 2D map takes over. */
export const CONTEXT_RESTORE_GRACE_MS = 3000

/** Shown when the 3D map fails and the game switches to the 2D one. */
export const MAP_FALLBACK_NOTICE =
  'The 3D map stopped working on this device, so the game switched to the 2D map. You can switch back from the top bar.'

/** Switches the renderer setting to 2D and says why. */
function fallBackTo2D(): void {
  const store = useGameStore.getState()
  if (store.settings.renderer === '2d') return
  store.updateSettings({ renderer: '2d' })
  useGameStore.setState({ notice: MAP_FALLBACK_NOTICE })
}

/**
 * Catches anything the 3D map throws (a shader that will not compile, a
 * driver fault, its chunk failing to load) and shows the 2D map in its place,
 * switching the renderer setting so the next run starts on 2D as well.
 */
class Map3DBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: Error) {
    console.error('The 3D map failed; falling back to the 2D map.', error)
    fallBackTo2D()
  }
  render() {
    return this.state.failed ? <MapView2D /> : this.props.children
  }
}

/**
 * Watches the 3D canvas for `webglcontextlost` (the GPU was reset, or the
 * browser reclaimed the context): when the context is not restored within
 * `CONTEXT_RESTORE_GRACE_MS`, the 2D map takes over. The events do not
 * bubble, so they are caught on the way down, in the capture phase.
 */
function ContextLossWatch({ children }: { children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = host.current
    if (!el) return
    let timer: number | undefined
    const onLost = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(fallBackTo2D, CONTEXT_RESTORE_GRACE_MS)
    }
    const onRestored = () => window.clearTimeout(timer)
    el.addEventListener('webglcontextlost', onLost, true)
    el.addEventListener('webglcontextrestored', onRestored, true)
    return () => {
      window.clearTimeout(timer)
      el.removeEventListener('webglcontextlost', onLost, true)
      el.removeEventListener('webglcontextrestored', onRestored, true)
    }
  }, [])
  return (
    <div ref={host} className="map-3d-host" style={{ display: 'contents' }}>
      {children}
    </div>
  )
}

/**
 * Picks the 3D map when the setting asks for it and the device can run it.
 * Memoised (it takes no props): the game screen re-renders on every sim
 * tick, and the 3D scene subscribes to exactly what it draws instead.
 */
export const MapView = memo(function MapView() {
  const renderer = useGameStore((s) => s.settings.renderer)
  if (renderer === '2d' || !hasWebGL()) return <MapView2D />
  return (
    <Map3DBoundary>
      <ContextLossWatch>
        <Suspense fallback={<div className="map-wrap map-loading">Raising the forest…</div>}>
          <MapView3D />
        </Suspense>
      </ContextLossWatch>
    </Map3DBoundary>
  )
})
