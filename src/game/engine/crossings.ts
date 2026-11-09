import type { Barrier, Glade, RunState } from '../types'
import { distToPolygonEdge } from './geometry'

/**
 * Which glades lie beyond a barrier (a river's far bank, the lowland below
 * the ridge's cliffs): those the hearth can reach only through one of its
 * crossings. Derived from the saved glades and barriers alone, so older
 * saves need nothing, and remembered per map (glade ids and borders are a
 * function of the seed and the plan).
 */

/** A crossing sits on the middle of the border it opens; this close counts as on it. */
const ON_BORDER = 0.05

const cache = new Map<string, ReadonlySet<string>>()
const CACHE_LIMIT = 16

function mapKey(s: RunState, kind: Barrier['kind']): string {
  return `${s.seed}:${s.world.layout ?? 'rings'}:${s.world.biome ?? 'woodland'}:${kind}:${Object.keys(s.glades).length}`
}

/** True when the border between `a` and `b` is one of the barrier's crossings. */
function crossesAt(barrier: Barrier, a: Glade, b: Glade): boolean {
  return barrier.crossings.some(
    (c) => distToPolygonEdge(c, a.polygon) < ON_BORDER && distToPolygonEdge(c, b.polygon) < ON_BORDER,
  )
}

/**
 * Glade ids beyond the barrier of `kind` from the hearth's glade. Empty on a
 * map without one (the rings, the ruins, an older save).
 */
export function gladesBeyond(s: RunState, kind: Barrier['kind']): ReadonlySet<string> {
  const barrier = s.world.barriers?.find((b) => b.kind === kind)
  if (!barrier) return new Set()
  const key = mapKey(s, kind)
  const known = cache.get(key)
  if (known) return known
  const home = Object.values(s.glades).find((g) => g.kind === 'settlement')
  const near = new Set<string>()
  if (home) {
    const queue = [home.id]
    near.add(home.id)
    while (queue.length > 0) {
      const g = s.glades[queue.pop()!]
      for (const id of g?.neighbors ?? []) {
        const n = s.glades[id]
        if (!n || near.has(id) || crossesAt(barrier, g, n)) continue
        near.add(id)
        queue.push(id)
      }
    }
  }
  const far = new Set(Object.keys(s.glades).filter((id) => !near.has(id)))
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!)
  cache.set(key, far)
  return far
}

/** True when the glade lies across a ford or pass from the glade `from` (neighbours at a crossing). */
export function isCrossing(s: RunState, kind: Barrier['kind'], from: string, to: string): boolean {
  const far = gladesBeyond(s, kind)
  return far.has(from) !== far.has(to)
}
