import { BUILDINGS } from '../content/buildings'
import { COMPLEX_FOOD, EDIBLE } from '../content/resources'
import type { BuildingInstance, ResourceId, RunState } from '../types'
import { COMPLEX_FOOD_MULTIPLIER, HEARTH_FUEL_PER_SECOND } from './balance'
import { computeModifiers, seasonLengthFor, type Modifiers } from './modifiers'
import { countOutputs, seasonMultiplier, workRate } from './production'
import { activeRecipe, storageUsed } from './queries'
import { hearthFuelRate, impatienceRate, mealsPerSecond, stormFuelPerSecond } from './society'
import { hostilityRate } from './tick'

/**
 * Forward-looking, read-only numbers for the HUD: how long until the Storm,
 * how long the wood and food last, how fast the bad meters climb, and why a
 * building is (or is not) working. Nothing here mutates the run; every rate
 * comes from the same function the tick uses, so forecasts cannot drift from
 * the simulation.
 */

/** Runways shorter than this earn a warning in the diagnostics strip. */
export const RUNWAY_WARNING_SECONDS = 60

/** Seconds until the next Storm begins, or null while it rages. */
export function secondsUntilStorm(s: RunState): number | null {
  const left = Math.max(0, s.season.length - s.season.elapsed)
  if (s.season.season === 'storm') return null
  if (s.season.season === 'clearance') return left
  return left + seasonLengthFor('clearance', s.season.year, computeModifiers(s))
}

export interface HearthForecast {
  wood: number
  /** Wood burned per second right now. */
  rate: number
  /** Wood burned per second during the Storm, hearth and braziers together. */
  stormRate: number
  /** Seconds of fuel at the current rate. */
  runway: number
  /** Seconds of fuel at the Storm rate. */
  stormRunway: number
  /**
   * Wood still missing to keep the hearth lit through the next (or current)
   * Storm, ignoring wood yet to be cut. Zero when the stock already covers it.
   */
  stormShortfall: number
}

export function hearthForecast(s: RunState, mods: Modifiers): HearthForecast {
  const wood = s.stock.wood ?? 0
  // In the Storm every lit brazier draws on the same woodpile as the hearth.
  const stormRate = stormFuelPerSecond(
    s,
    HEARTH_FUEL_PER_SECOND,
    mods.hearthFuel,
    mods.hearthFuel * mods.brazierFuel,
  )
  const rate = s.season.season === 'storm' ? stormRate : hearthFuelRate(s.season.season, mods)
  const untilStorm = secondsUntilStorm(s)
  let needed: number
  if (untilStorm === null) {
    needed = Math.max(0, s.season.length - s.season.elapsed) * stormRate
  } else {
    needed = untilStorm * rate + seasonLengthFor('storm', s.season.year, mods) * stormRate
  }
  return {
    wood,
    rate,
    stormRate,
    runway: rate > 0 ? wood / rate : Infinity,
    stormRunway: stormRate > 0 ? wood / stormRate : Infinity,
    stormShortfall: Math.max(0, needed - wood),
  }
}

export interface FoodForecast {
  /** Meals in store (cooked food counts double), net of meals already owed. */
  meals: number
  /** Meals eaten per second at the current population and upkeep. */
  rate: number
  /** Seconds until the larder is empty, ignoring food still to be produced. */
  runway: number
}

export function foodForecast(s: RunState, mods: Modifiers): FoodForecast {
  let meals = 0
  for (const id of EDIBLE) {
    const amount = s.stock[id] ?? 0
    meals += COMPLEX_FOOD.includes(id) ? amount * COMPLEX_FOOD_MULTIPLIER : amount
  }
  meals = Math.max(0, meals - Math.max(0, s.foodDebt))
  const rate = mealsPerSecond(s, mods)
  return { meals, rate, runway: rate > 0 ? meals / rate : Infinity }
}

/** Passive impatience and hostility gained per minute right now. */
export function meterRates(
  s: RunState,
  mods: Modifiers,
): { impatiencePerMinute: number; hostilityPerMinute: number } {
  return {
    impatiencePerMinute: impatienceRate(s, mods) * 60,
    hostilityPerMinute: hostilityRate(s, mods.hostilityRate) * 60,
  }
}

// ---------------------------------------------------------------------------
// Building status
// ---------------------------------------------------------------------------

export type BuildingStatus =
  | { kind: 'construction' }
  | { kind: 'paused' }
  | { kind: 'noWorkers' }
  | { kind: 'noDeposit' }
  | { kind: 'offSeason' }
  /** `missing` holds the shortfall per good for the next batch. */
  | { kind: 'waitingInputs'; missing: [ResourceId, number][]; held: boolean }
  /** The next batch will not fit; `held` once the bar is at the brim. */
  | { kind: 'storageFull'; held: boolean }
  | { kind: 'working'; rate: number; batchSeconds: number }
  /** Nothing to produce (housing, storage, the hearth). */
  | { kind: 'none' }

/**
 * Why a building is or is not producing. Follows the same order of checks as
 * `stepProduction`, so the reason shown is the one actually holding it.
 */
export function buildingStatus(
  s: RunState,
  b: BuildingInstance,
  mods: Modifiers,
  used: number = storageUsed(s),
): BuildingStatus {
  const def = BUILDINGS[b.defId]
  if (!def) return { kind: 'none' }
  if (!b.built) return { kind: 'construction' }
  const recipe = activeRecipe(b)
  if (!recipe || def.recipes.length === 0) return { kind: 'none' }
  if (b.paused) return { kind: 'paused' }
  if (b.workers.length === 0) return { kind: 'noWorkers' }

  if (recipe.requiresDeposit) {
    const ids = b.depositsInRange[recipe.requiresDeposit] ?? []
    const live = ids.some((id) => {
      const d = s.deposits[id]
      return d && (d.amount === null || d.amount > 0)
    })
    if (!live) return { kind: 'noDeposit' }
  }

  const multiplier = seasonMultiplier(b.defId, s.season.season, mods)
  if (multiplier <= 0) return { kind: 'offSeason' }

  const held = b.recipeProgress >= recipe.seconds
  const missing: [ResourceId, number][] = []
  for (const [id, amount] of Object.entries(recipe.inputs) as [ResourceId, number][]) {
    const have = s.stock[id] ?? 0
    if (have < amount) missing.push([id, Math.ceil(amount - have)])
  }
  if (missing.length > 0) return { kind: 'waitingInputs', missing, held }

  const outputs = countOutputs(recipe)
  if (outputs > 0 && used + outputs > s.storageCap) return { kind: 'storageFull', held }

  const rate = workRate(s, b, mods) * multiplier
  return { kind: 'working', rate, batchSeconds: rate > 0 ? recipe.seconds / rate : Infinity }
}

/** "45s", "3m 05s", "12m" — compact enough for a chip, honest about scale. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '∞'
  const total = Math.max(0, Math.ceil(seconds))
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  if (minutes >= 10) return `${minutes}m`
  return `${minutes}m ${String(total % 60).padStart(2, '0')}s`
}

/** Buildings currently stopped at the brim because the stockpile is full. */
export function storageBlocked(s: RunState, mods: Modifiers): BuildingInstance[] {
  const used = storageUsed(s)
  return Object.values(s.buildings).filter((b) => {
    const status = buildingStatus(s, b, mods, used)
    return status.kind === 'storageFull' && status.held
  })
}
