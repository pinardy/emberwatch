import { BUILDINGS } from '../content/buildings'
import type { RunState, Vec2 } from '../types'
import { BUILDING_GAP, FOOTPRINT_RADIUS } from './balance'
import { dist } from './geometry'
import { gladeAt, insideWorld } from './mapgen'

/*
 * The hearth glade's camp plot: a spot by its trees kept for the first
 * Woodcutters' Camp.
 *
 * A cramped start (a narrow ridge, a glade where only one stand of trees
 * fit) could have its only camp spot taken by the first Shelter, and with
 * the starting wood spent there was no way back: no camp, no wood to build
 * one. So the run picks the spot when it is made, and nothing else may be
 * built on it until a Woodcutters' Camp stands somewhere. It costs nothing
 * once the first camp is up.
 */

const CAMP = 'woodcuttersCamp'

/** Footprint of a Woodcutters' Camp. */
function campRadius(): number {
  const def = BUILDINGS[CAMP]
  return def?.footprint ?? FOOTPRINT_RADIUS.gathering
}

/**
 * The spot kept for the first camp: inside the hearth's glade, clear of the
 * hearth, deposits and rough ground, with trees in reach — the one furthest
 * from the hearth, so the ring around the hearth stays free to build on.
 * Null when the glade has no trees (or no room by them at all).
 */
export function findCampPlot(
  s: Pick<RunState, 'world' | 'glades' | 'deposits' | 'obstacles' | 'buildings'>,
): Vec2 | null {
  const def = BUILDINGS[CAMP]
  const reach = def?.gatherRadius ?? 3
  const radius = campRadius()
  const trees = Object.values(s.deposits)
    .filter((d) => d.gladeId === 'glade0' && d.kind === 'trees')
    .sort((a, b) => a.id.localeCompare(b.id))
  const hearth = s.buildings.hearth
  const hearthPos = hearth?.pos ?? { x: 0, y: 0 }
  const hearthRadius = FOOTPRINT_RADIUS.hearth
  let best: Vec2 | null = null
  let bestDistance = -1
  const step = 0.25
  for (const tree of trees) {
    for (let ring = 1; ring * step <= reach + tree.radius; ring++) {
      const r = ring * step
      const count = Math.max(8, Math.ceil((2 * Math.PI * r) / step))
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2
        const pos = { x: tree.pos.x + Math.cos(angle) * r, y: tree.pos.y + Math.sin(angle) * r }
        if (gladeAt(s.glades, pos)?.id !== 'glade0' || !insideWorld(s.world, pos, radius)) continue
        if (dist(pos, hearthPos) < radius + hearthRadius + BUILDING_GAP) continue
        if (s.obstacles.some((o) => dist(pos, o.pos) < radius + o.radius)) continue
        if (Object.values(s.deposits).some((d) => dist(pos, d.pos) < radius + d.radius)) continue
        const away = dist(pos, hearthPos)
        if (away > bestDistance) {
          best = { x: Math.round(pos.x * 100) / 100, y: Math.round(pos.y * 100) / 100 }
          bestDistance = away
        }
      }
    }
  }
  return best
}

/** True while the plot is still kept: no Woodcutters' Camp stands or is being raised. */
export function campPlotKept(s: Pick<RunState, 'campPlot' | 'buildings'>): boolean {
  return !!s.campPlot && !Object.values(s.buildings).some((b) => b.defId === CAMP)
}

/**
 * Why a `defId` with footprint `radius` may not stand at `pos` because of the
 * camp plot, or null.
 */
export function campPlotBlocks(
  s: Pick<RunState, 'campPlot' | 'buildings'>,
  defId: string,
  pos: Vec2,
  radius: number,
): string | null {
  if (defId === CAMP || !campPlotKept(s) || !s.campPlot) return null
  if (dist(pos, s.campPlot) >= radius + campRadius() + BUILDING_GAP) return null
  return "This ground is kept for your first Woodcutters' Camp, by the hearth's trees — build beside it."
}
