import type { Vec2 } from '../types'

/**
 * Plain 2D geometry over world coordinates. The world is a continuous plane —
 * buildings, deposits and obstacles are circles, glades are polygons — so
 * everything the sim asks about space reduces to distances and containment.
 */

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function dist2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

/** Ray-casting point-in-polygon. Polygons are simple and small (~10 verts). */
export function pointInPolygon(p: Vec2, polygon: Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    if (a.y > p.y !== b.y > p.y) {
      const t = (p.y - a.y) / (b.y - a.y)
      if (p.x < a.x + t * (b.x - a.x)) inside = !inside
    }
  }
  return inside
}

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const len2 = abx * abx + aby * aby
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2))
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby))
}

/** Distance from a point to the nearest polygon edge. */
export function distToPolygonEdge(p: Vec2, polygon: Vec2[]): number {
  let best = Infinity
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    best = Math.min(best, distToSegment(p, polygon[j], polygon[i]))
  }
  return best
}

export function polygonBounds(polygon: Vec2[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of polygon) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return { minX, minY, maxX, maxY }
}

/** Shoelace area; polygons from the Voronoi are simple, orientation ignored. */
export function polygonArea(polygon: Vec2[]): number {
  let sum = 0
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    sum += (polygon[j].x + polygon[i].x) * (polygon[j].y - polygon[i].y)
  }
  return Math.abs(sum / 2)
}

/**
 * A point at least `margin` inside the polygon, by rejection sampling with a
 * caller-supplied uniform source (so map generation stays seed-deterministic).
 * Returns null when the polygon is too cramped for the margin.
 */
export function randomPointInPolygon(
  next: () => number,
  polygon: Vec2[],
  margin = 0,
  attempts = 60,
): Vec2 | null {
  const { minX, minY, maxX, maxY } = polygonBounds(polygon)
  for (let i = 0; i < attempts; i++) {
    const p = { x: minX + next() * (maxX - minX), y: minY + next() * (maxY - minY) }
    if (!pointInPolygon(p, polygon)) continue
    if (margin > 0 && distToPolygonEdge(p, polygon) < margin) continue
    return p
  }
  return null
}
