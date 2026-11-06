import type { DepositId, Glade, TerrainId, Vec2, WorldInfo } from '../types'
import { distToPolygonEdge, pointInPolygon } from './geometry'

/**
 * The world is a continuous rectangle centred on the hearth, partitioned into
 * glades by a Voronoi diagram over seeded points. There is no grid: buildings
 * stand at arbitrary positions, deposits and obstacles are circular features
 * scattered inside their glade's polygon.
 *
 * This module holds what the running game needs about the world; generating
 * one (`worldgen.ts`, with the Delaunay library) is only needed when a new
 * run is created, so it stays out of the startup bundle.
 */

export const WORLD_WIDTH = 28
export const WORLD_HEIGHT = 22

export const DEPOSIT_RADIUS: Record<DepositId, number> = {
  trees: 0.85,
  stoneVein: 0.6,
  clayPatch: 0.55,
  orePatch: 0.6,
  vegetation: 0.55,
  game: 0.6,
  fertileSoil: 0.8,
}

/** Deep-forest gloom aside, these read best against the 3D lighting too. */
export const TERRAIN_COLORS: Record<TerrainId, string> = {
  clearing: '#4a5a44',
  forest: '#2f4634',
  marsh: '#3c4a43',
  rock: '#4b4e52',
  fertile: '#5b6339',
}

export const DEPOSIT_INFO: Record<DepositId, { name: string; icon: string }> = {
  trees: { name: 'Trees', icon: '🌲' },
  stoneVein: { name: 'Stone Vein', icon: '🪨' },
  clayPatch: { name: 'Clay Patch', icon: '🟤' },
  orePatch: { name: 'Copper Seam', icon: '🟠' },
  vegetation: { name: 'Undergrowth', icon: '🌿' },
  game: { name: 'Game Trails', icon: '🐗' },
  fertileSoil: { name: 'Fertile Soil', icon: '🌾' },
}

/** True when the point lies inside the playable rectangle (minus a margin). */
export function insideWorld(world: WorldInfo, p: Vec2, margin = 0): boolean {
  return (
    Math.abs(p.x) <= world.width / 2 - margin && Math.abs(p.y) <= world.height / 2 - margin
  )
}

/** The glade whose polygon contains the point; they partition the world. */
export function gladeAt(
  glades: Record<string, Glade>,
  p: Vec2,
): Glade | undefined {
  let best: Glade | undefined
  let bestEdge = -Infinity
  for (const glade of Object.values(glades)) {
    if (!pointInPolygon(p, glade.polygon)) continue
    // Points exactly on a shared border can test inside both; prefer the one
    // the point sits deeper in so the answer is stable.
    const edge = distToPolygonEdge(p, glade.polygon)
    if (edge > bestEdge) {
      bestEdge = edge
      best = glade
    }
  }
  return best
}
