import { BUILDINGS } from '../content/buildings'
import { SPECIES } from '../content/species'
import { TERRAIN } from '../content/terrain'
import type {
  BuildingInstance,
  DepositId,
  Recipe,
  ResourceId,
  RunState,
  Season,
  TerrainEffect,
  TerrainId,
} from '../types'
import { adjacencyMultiplier } from './adjacency'
import {
  BUILD_RATE_PER_VILLAGER,
  FARM_SEASON_MULTIPLIER,
  GATHER_SEASON_MULTIPLIER,
  WORKER_RATE,
} from './balance'
import { dist } from './geometry'
import type { Modifiers } from './modifiers'
import { extraOutputChance, productionMultiplier } from './modifiers'
import { canAfford, grant, spend, storageUsed } from './queries'
import { makeRng } from './rng'
import { buildMultiplier, workTraitMultiplier } from './traits'

/**
 * Which deposits a building at `pos` can reach. Only counts deposits inside
 * cleared glades — you cannot harvest what you have not taken back yet. Range
 * is measured to the deposit's edge, so a wide stand of trees is a little
 * easier to reach than a point.
 */
export function depositsInRangeOf(
  s: RunState,
  pos: { x: number; y: number },
  radius: number,
): Partial<Record<DepositId, string[]>> {
  const out: Partial<Record<DepositId, string[]>> = {}
  for (const deposit of Object.values(s.deposits)) {
    if (dist(pos, deposit.pos) > radius + deposit.radius) continue
    if (!s.glades[deposit.gladeId]?.cleared) continue
    if (deposit.amount !== null && deposit.amount <= 0) continue
    const list = out[deposit.kind] ?? (out[deposit.kind] = [])
    list.push(deposit.id)
  }
  return out
}

/** Recomputes the deposit cache for every building. Called after clearing. */
export function refreshDepositCaches(s: RunState): void {
  for (const b of Object.values(s.buildings)) {
    const def = BUILDINGS[b.defId]
    if (!def?.gatherRadius) continue
    b.depositsInRange = depositsInRangeOf(s, b.pos, def.gatherRadius)
  }
}

// Adjacency moved to its own module (several partners per building); the
// re-export keeps existing imports working.
export { adjacencyMultiplier } from './adjacency'

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

/** The terrain effects from `content/terrain.ts` that apply to a building def. */
export function terrainEffectsFor(defId: string, terrain: TerrainId | undefined): TerrainEffect[] {
  const def = BUILDINGS[defId]
  if (!def || !terrain) return []
  return (TERRAIN[terrain]?.effects ?? []).filter((effect) => {
    switch (effect.kind) {
      case 'workSpeed':
        return def.tags.includes(effect.tag)
      case 'yield':
        return def.recipes.some((r) => (r.outputs[effect.resource] ?? 0) > 0)
      case 'buildSpeed':
        return true
    }
  })
}

/** Sum of a kind of matching terrain effect, as a multiplier (floored at 0.1). */
function terrainMultiplier(
  defId: string,
  terrain: TerrainId | undefined,
  kinds: TerrainEffect['kind'][],
): number {
  let percent = 0
  for (const effect of terrainEffectsFor(defId, terrain)) {
    if (kinds.includes(effect.kind)) percent += effect.percent
  }
  return Math.max(0.1, 1 + percent / 100)
}

/** Work-speed multiplier from the ground a building of `defId` stands on. */
export function terrainWorkMultiplier(defId: string, terrain: TerrainId | undefined): number {
  return terrainMultiplier(defId, terrain, ['workSpeed', 'yield'])
}

/** Construction-speed multiplier from the ground. */
export function terrainBuildMultiplier(defId: string, terrain: TerrainId | undefined): number {
  return terrainMultiplier(defId, terrain, ['buildSpeed'])
}

/** The terrain under a placed building (fixed at placement). */
export function terrainOf(s: RunState, b: BuildingInstance): TerrainId | undefined {
  return s.glades[b.gladeId]?.terrain
}

/** Combined worker rate in work-seconds per real second. */
export function workRate(s: RunState, b: BuildingInstance, mods: Modifiers): number {
  const def = BUILDINGS[b.defId]
  if (!def) return 0
  const gathering = def.tags.includes('gathering')
  let rate = 0
  for (const workerId of b.workers) {
    const villager = s.villagers[workerId]
    if (!villager) continue
    const bonuses = SPECIES[villager.species].workBonus
    let bonus = 0
    for (const tag of def.tags) bonus += bonuses[tag] ?? 0
    rate +=
      WORKER_RATE *
      (1 + bonus) *
      workTraitMultiplier(villager, gathering, s.season.season)
  }
  return (
    rate *
    productionMultiplier(mods, def.tags) *
    adjacencyMultiplier(s, b) *
    terrainWorkMultiplier(b.defId, terrainOf(s, b))
  )
}

/** Seasonal multiplier for a building's output. */
export function seasonMultiplier(
  defId: string,
  season: Season,
  mods?: Modifiers,
): number {
  const def = BUILDINGS[defId]
  if (!def) return 1
  if (def.tags.includes('farming')) {
    const base = FARM_SEASON_MULTIPLIER[season]
    // Greenhouse-style cornerstones keep farms turning through the Storm.
    if (season === 'storm' && mods) return Math.max(base, mods.farmsInStorm)
    return base
  }
  if (def.tags.includes('gathering')) return GATHER_SEASON_MULTIPLIER[season]
  return 1
}

export interface ProductionResult {
  /** Ids of buildings that finished construction this tick. */
  completed: string[]
  /** Deposits that ran dry, so caches can be refreshed. */
  depletedDeposit: boolean
  /** True if at least one cycle was blocked purely by a full stockpile. */
  storageFull: boolean
}

/**
 * Advances construction and production for every building.
 *
 * Construction is powered by idle villagers acting as a shared builder pool —
 * this keeps the UI simple (no dragging builders around) while still making
 * unassigned population useful.
 */
export function stepProduction(
  s: RunState,
  dt: number,
  mods: Modifiers,
): ProductionResult {
  const result: ProductionResult = {
    completed: [],
    depletedDeposit: false,
    storageFull: false,
  }

  // --- construction ---------------------------------------------------------
  const underConstruction = Object.values(s.buildings).filter((b) => !b.built)
  // Idle villagers are the shared builder pool; beavers and strong backs count
  // for more than one pair of hands.
  let buildPower = 0
  for (const v of Object.values(s.villagers)) {
    if (v.assignment === null) buildPower += BUILD_RATE_PER_VILLAGER * buildMultiplier(v)
  }
  if (underConstruction.length > 0 && buildPower > 0) {
    // Builders split evenly across every site.
    const perSite = (buildPower * mods.buildSpeed) / underConstruction.length
    for (const b of underConstruction) {
      const def = BUILDINGS[b.defId]
      if (!def) continue
      b.buildProgress += perSite * terrainBuildMultiplier(b.defId, terrainOf(s, b)) * dt
      if (b.buildProgress >= def.buildSeconds) {
        b.built = true
        b.buildProgress = def.buildSeconds
        s.stats.buildingsBuilt++
        result.completed.push(b.id)
        if (def.gatherRadius) {
          b.depositsInRange = depositsInRangeOf(s, b.pos, def.gatherRadius)
        }
      }
    }
  }

  // --- production -----------------------------------------------------------
  let used = storageUsed(s)
  const cap = s.storageCap

  for (const b of Object.values(s.buildings)) {
    const def = BUILDINGS[b.defId]
    if (!def || !b.built || b.paused || b.workers.length === 0) continue
    if (def.recipes.length === 0) continue

    const recipe = def.recipes.find((r) => r.id === b.activeRecipeId) ?? def.recipes[0]
    if (!recipe) continue

    // Deposit-gated recipes need a live deposit in range.
    if (recipe.requiresDeposit && !hasLiveDeposit(s, b, recipe.requiresDeposit)) continue

    const multiplier = seasonMultiplier(b.defId, s.season.season, mods)
    if (multiplier <= 0) continue

    const rate = workRate(s, b, mods) * multiplier
    if (rate <= 0) continue

    b.recipeProgress += rate * dt

    // A building may complete several cycles in one tick at high speed.
    let guard = 0
    while (b.recipeProgress >= recipe.seconds && guard++ < 20) {
      if (!canAfford(s.stock, recipe.inputs)) {
        // Hold at the brim so work resumes the instant inputs arrive.
        b.recipeProgress = recipe.seconds
        break
      }
      const outputTotal = countOutputs(recipe)
      const isService = outputTotal === 0
      if (!isService && used + outputTotal > cap) {
        b.recipeProgress = recipe.seconds
        result.storageFull = true
        break
      }

      b.recipeProgress -= recipe.seconds
      spend(s.stock, recipe.inputs)

      if (!isService) {
        let doubled = false
        const chance = extraOutputChance(mods, def.tags)
        if (chance > 0) {
          const rng = makeRng(s.seed, s.rngCursor)
          doubled = rng.chance(chance)
          s.rngCursor = rng.cursor()
        }
        const gain = doubled ? doubleBag(recipe.outputs) : recipe.outputs
        const added = grant(s.stock, gain, cap, used)
        used += added
        s.stats.resourcesProduced += added
        for (const [id, amount] of Object.entries(gain)) {
          const key = id as ResourceId
          s.producedTotals[key] = (s.producedTotals[key] ?? 0) + (amount ?? 0)
        }
      }

      if (recipe.requiresDeposit) {
        if (consumeDeposit(s, b, recipe.requiresDeposit)) result.depletedDeposit = true
      }
    }
  }

  return result
}

function countOutputs(recipe: Recipe): number {
  let sum = 0
  for (const [id, amount] of Object.entries(recipe.outputs)) {
    if (id === 'amber') continue
    sum += amount ?? 0
  }
  return sum
}

function doubleBag(bag: Recipe['outputs']): Recipe['outputs'] {
  const out: Recipe['outputs'] = {}
  for (const [id, amount] of Object.entries(bag)) {
    out[id as ResourceId] = (amount ?? 0) * 2
  }
  return out
}

function hasLiveDeposit(s: RunState, b: BuildingInstance, id: DepositId): boolean {
  const ids = b.depositsInRange[id]
  if (!ids || ids.length === 0) return false
  return ids.some((depositId) => {
    const deposit = s.deposits[depositId]
    return deposit && (deposit.amount === null || deposit.amount > 0)
  })
}

/** Decrements the nearest live deposit. Returns true if one ran out. */
function consumeDeposit(s: RunState, b: BuildingInstance, id: DepositId): boolean {
  const ids = b.depositsInRange[id]
  if (!ids) return false
  const live = ids
    .map((depositId) => s.deposits[depositId])
    .filter((d) => d && (d.amount === null || d.amount > 0))
    .sort((a, c) => dist(b.pos, a.pos) - dist(b.pos, c.pos))

  const target = live[0]
  if (!target) return false
  if (target.amount === null) return false
  target.amount -= 1
  if (target.amount <= 0) {
    delete s.deposits[target.id]
    b.depositsInRange[id] = ids.filter((k) => k !== target.id)
    return true
  }
  return false
}
