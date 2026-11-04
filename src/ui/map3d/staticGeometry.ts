import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { Vec2 } from '../../game/types'

/**
 * Geometry for map features that never change shape (glade polygons and
 * their borders). Built once per mount and disposed on unmount, so a sim
 * tick never touches the GPU buffers.
 */

/**
 * Creation counter. Cheap enough to keep in production; tests (and the perf
 * check in the browser) assert it stays flat while the sim ticks.
 */
export const mapStats = { geometriesCreated: 0, geometriesDisposed: 0 }

/** Memoises `factory()` on `deps` and disposes the result when it is replaced. */
export function useStaticGeometry<T extends THREE.BufferGeometry>(
  factory: () => T,
  deps: React.DependencyList,
): T {
  const geometry = useMemo(() => {
    mapStats.geometriesCreated++
    return factory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(
    () => () => {
      mapStats.geometriesDisposed++
      geometry.dispose()
    },
    [geometry],
  )
  return geometry
}

/** Flat fill of a glade polygon, in the XY plane (rotate −90° about X to lay it down). */
export function gladeFillGeometry(polygon: Vec2[]): THREE.ShapeGeometry {
  const shape = new THREE.Shape(polygon.map((p) => new THREE.Vector2(p.x, -p.y)))
  return new THREE.ShapeGeometry(shape)
}

/**
 * A flat ribbon running just inside a glade's border, in world XZ at y=0.
 * `dash` splits each edge into [on, off] lengths; `null` draws it solid.
 * Inset (rather than centred on the edge) so neighbouring glades' borders
 * sit side by side instead of overlapping.
 */
export function gladeEdgeGeometry(
  polygon: Vec2[],
  dash: [number, number] | null,
  width: number,
): THREE.BufferGeometry {
  let area = 0
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % polygon.length]
    area += a.x * b.y - b.x * a.y
  }
  // Interior lies to the left of each edge for a positively wound polygon.
  const side = area >= 0 ? 1 : -1
  const positions: number[] = []
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % polygon.length]
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    if (length < 1e-6) continue
    const ux = (b.x - a.x) / length
    const uy = (b.y - a.y) / length
    const nx = -uy * side * width
    const ny = ux * side * width
    const runs: [number, number][] = []
    if (!dash) runs.push([0, length])
    else {
      for (let t = dash[1] / 2; t < length; t += dash[0] + dash[1]) {
        runs.push([t, Math.min(length, t + dash[0])])
      }
    }
    for (const [t0, t1] of runs) {
      const x0 = a.x + ux * t0
      const y0 = a.y + uy * t0
      const x1 = a.x + ux * t1
      const y1 = a.y + uy * t1
      positions.push(
        x0, 0, y0, x1, 0, y1, x1 + nx, 0, y1 + ny,
        x0, 0, y0, x1 + nx, 0, y1 + ny, x0 + nx, 0, y0 + ny,
      )
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return geometry
}
