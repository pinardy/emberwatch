import { Suspense, lazy, memo } from 'react'
import { useGameStore } from '../game/store'
import { MapView2D } from './MapView2D'

/*
 * The 3D renderer (three.js) is lazy-loaded so the main bundle stays small and
 * environments without WebGL — old devices, jsdom in tests — never touch it.
 */
const MapView3D = lazy(() =>
  import('./map3d/MapView3D').then((m) => ({ default: m.MapView3D })),
)

let webglSupport: boolean | null = null

function hasWebGL(): boolean {
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

/**
 * Picks the 3D map when the setting asks for it and the device can run it.
 * Memoised (it takes no props): the game screen re-renders on every sim
 * tick, and the 3D scene subscribes to exactly what it draws instead.
 */
export const MapView = memo(function MapView() {
  const renderer = useGameStore((s) => s.settings.renderer)
  if (renderer === '2d' || !hasWebGL()) return <MapView2D />
  return (
    <Suspense fallback={<div className="map-wrap map-loading">Raising the forest…</div>}>
      <MapView3D />
    </Suspense>
  )
})
