import {
  BIOMES,
  BIOME_LIST,
  DEFAULT_BIOME,
  DEFAULT_LAYOUT,
  LAYOUTS,
  LAYOUT_LIST,
} from '../content/layouts'
import type { BiomeDef, BiomeId, LayoutDef, LayoutId, MapgenHooks, RunState, WorldInfo } from '../types'
import { hashInt, makeRng } from './rng'

/**
 * Which layout and biome a run's map takes. Like the land's modifiers, they
 * come from their own stream of the seed — a pure function of the seed and
 * the land — so the setup screen can name them before the run exists, and
 * drawing them never moves the map RNG: a seed that draws the rings in the
 * old woodland generates exactly the map it always did.
 */

export interface TerrainPlan {
  layout: LayoutId
  biome: BiomeId
}

export const DEFAULT_PLAN: TerrainPlan = { layout: DEFAULT_LAYOUT, biome: DEFAULT_BIOME }

/** Salt for the plan's stream (XORed into the seed, as the modifiers' is). */
const PLAN_STREAM = 0x6c61796f

/**
 * The plan a seed draws on a land whose hooks are `hooks` (modifiers can
 * lean the odds; see `MapgenHooks.layoutWeights`). `force` pins either half,
 * for tests and the balance harness.
 */
export function drawTerrainPlan(
  seed: number,
  hooks: MapgenHooks = {},
  force: Partial<TerrainPlan> = {},
): TerrainPlan {
  const rng = makeRng(hashInt((seed ^ PLAN_STREAM) >>> 0, 0), 0)
  const lw = hooks.layoutWeights ?? {}
  const bw = hooks.biomeWeights ?? {}
  const layout = rng.weighted(LAYOUT_LIST, (d) => d.weight * (lw[d.id] ?? 1)).id
  const biome = rng.weighted(BIOME_LIST, (d) => d.weight * (bw[d.id] ?? 1)).id
  return {
    layout: force.layout && LAYOUTS[force.layout] ? force.layout : layout,
    biome: force.biome && BIOMES[force.biome] ? force.biome : biome,
  }
}

/** The run's layout (rings for saves from before layouts). */
export function layoutOf(world: WorldInfo): LayoutDef {
  return LAYOUTS[world.layout ?? DEFAULT_LAYOUT] ?? LAYOUTS[DEFAULT_LAYOUT]
}

/** The run's biome (the old woodland for saves from before biomes). */
export function biomeOf(world: WorldInfo): BiomeDef {
  return BIOMES[world.biome ?? DEFAULT_BIOME] ?? BIOMES[DEFAULT_BIOME]
}

/** True when the plan is anything but today's rings in the old woodland. */
export function isUnusualPlan(plan: TerrainPlan): boolean {
  return plan.layout !== DEFAULT_LAYOUT || plan.biome !== DEFAULT_BIOME
}

/**
 * Saves from before layouts and biomes were all rings in the old woodland,
 * with no barriers. A mangled field reads as the default too.
 */
export function migrateWorld(run: RunState): void {
  const world = run.world
  if (!world || typeof world !== 'object') return
  if (typeof world.layout !== 'string' || !LAYOUTS[world.layout]) world.layout = DEFAULT_LAYOUT
  if (typeof world.biome !== 'string' || !BIOMES[world.biome]) world.biome = DEFAULT_BIOME
  if (world.barriers !== undefined && !Array.isArray(world.barriers)) delete world.barriers
}
