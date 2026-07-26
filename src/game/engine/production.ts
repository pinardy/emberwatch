import { BUILDINGS } from '../content/buildings'
import { SPECIES } from '../content/species'
import type {
  BuildingInstance,
  DepositId,
  Recipe,
  ResourceId,
  RunState,
  Season,
} from '../types'
import {
  BUILD_RATE_PER_VILLAGER,
  FARM_SEASON_MULTIPLIER,
  GATHER_SEASON_MULTIPLIER,
  WORKER_RATE,
} from './balance'
import { hexDistance, hexesInRadius, hexKey } from './hex'
import type { Modifiers } from './modifiers'
import { extraOutputChance, productionMultiplier } from './modifiers'
import { canAfford, grant, spend, storageUsed } from './queries'
import { makeRng } from './rng'

/**
 * Which deposits a building at `tileKey` can reach. Only counts deposits inside
 * cleared glades — you cannot harvest what you have not taken back yet.
 */
export function depositsInRangeOf(
  s: RunState,
  tileKey: string,
  radius: number,
): Partial<Record<DepositId, string[]>> {
  const origin = s.tiles[tileKey]
  const out: Partial<Record<DepositId, string[]>> = {}
  if (!origin) return out
  for (const h of hexesInRadius(origin, radius)) {
    const tile = s.tiles[hexKey(h.q, h.r)]
    if (!tile?.deposit) continue
    if (!s.glades[tile.gladeId]?.cleared) continue
    if (tile.deposit.amount !== null && tile.deposit.amount <= 0) continue
    const list = out[tile.deposit.id] ?? (out[tile.deposit.id] = [])
    list.push(tile.key)
  }
  return out
}

/** Recomputes the deposit cache for every building. Called after clearing. */
export function refreshDepositCaches(s: RunState): void {
  for (const b of Object.values(s.buildings)) {
    const def = BUILDINGS[b.defId]
    if (!def?.gatherRadius) continue
    b.depositsInRange = depositsInRangeOf(s, b.tile, def.gatherRadius)
  }
}

/** Combined worker rate in work-seconds per real second. */
export function workRate(s: RunState, b: BuildingInstance, mods: Modifiers): number {
  const def = BUILDINGS[b.defId]
  if (!def) return 0
  let rate = 0
  for (const workerId of b.workers) {
    const villager = s.villagers[workerId]
    if (!villager) continue
    const bonuses = SPECIES[villager.species].workBonus
    let bonus = 0
    for (const tag of def.tags) bonus += bonuses[tag] ?? 0
    rate += WORKER_RATE * (1 + bonus)
  }
  return rate * productionMultiplier(mods, def.tags)
}

/** Seasonal multiplier for a building's output. */
export function seasonMultiplier(defId: string, season: Season): number {
  const def = BUILDINGS[defId]
  if (!def) return 1
  if (def.tags.includes('farming')) return FARM_SEASON_MULTIPLIER[season]
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
  idleBuilders: number,
): ProductionResult {
  const result: ProductionResult = {
    completed: [],
    depletedDeposit: false,
    storageFull: false,
  }

  // --- construction ---------------------------------------------------------
  const underConstruction = Object.values(s.buildings).filter((b) => !b.built)
  if (underConstruction.length > 0 && idleBuilders > 0) {
    // Builders split evenly across every site.
    const perSite = (idleBuilders * BUILD_RATE_PER_VILLAGER * mods.buildSpeed) /
      underConstruction.length
    for (const b of underConstruction) {
      const def = BUILDINGS[b.defId]
      if (!def) continue
      b.buildProgress += perSite * dt
      if (b.buildProgress >= def.buildSeconds) {
        b.built = true
        b.buildProgress = def.buildSeconds
        s.stats.buildingsBuilt++
        result.completed.push(b.id)
        if (def.gatherRadius) {
          b.depositsInRange = depositsInRangeOf(s, b.tile, def.gatherRadius)
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

    const multiplier = seasonMultiplier(b.defId, s.season.season)
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
  const tiles = b.depositsInRange[id]
  if (!tiles || tiles.length === 0) return false
  return tiles.some((key) => {
    const deposit = s.tiles[key]?.deposit
    return deposit && (deposit.amount === null || deposit.amount > 0)
  })
}

/** Decrements the nearest live deposit. Returns true if one ran out. */
function consumeDeposit(s: RunState, b: BuildingInstance, id: DepositId): boolean {
  const tiles = b.depositsInRange[id]
  if (!tiles) return false
  const origin = s.tiles[b.tile]
  const live = tiles
    .map((key) => s.tiles[key])
    .filter((t) => t?.deposit && (t.deposit.amount === null || t.deposit.amount > 0))
    .sort((a, c) => hexDistance(origin, a) - hexDistance(origin, c))

  const target = live[0]
  if (!target?.deposit) return false
  if (target.deposit.amount === null) return false
  target.deposit.amount -= 1
  if (target.deposit.amount <= 0) {
    delete target.deposit
    b.depositsInRange[id] = tiles.filter((k) => k !== target.key)
    return true
  }
  return false
}
