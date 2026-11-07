import { BUILDINGS } from '../content/buildings'
import { COMPLEX_FOOD, EDIBLE } from '../content/resources'
import type { BuildingInstance, Recipe, ResourceBag, ResourceId, RunState, Season } from '../types'
import {
  COMPLEX_FOOD_MULTIPLIER,
  HEARTH_FUEL_PER_SECOND,
  IMPATIENCE_OVERTIME_BASE,
  SEASON_LENGTH,
  SEASON_ORDER,
} from './balance'
import { computeModifiers, seasonLengthFor, type Modifiers } from './modifiers'
import {
  countOutputs,
  hasLiveDeposit,
  seasonMultiplier,
  storageLimitFor,
  workRate,
} from './production'
import { activeRecipe, canAfford, storageUsed } from './queries'
import {
  QUEEN_DEADLINE_SECONDS,
  deadlineOvertimeRate,
  hearthFuelRate,
  impatienceRate,
  mealsPerSecond,
  secondsPastDeadline,
  stormFuelPerSecond,
} from './society'
import { hostilityRate } from './hostility'
import { recipesOf } from './upgrades'

/**
 * Forward-looking, read-only numbers for the HUD: how long until the Storm,
 * how long the wood and food last, how fast the bad meters climb, and why a
 * building is (or is not) working. Nothing here mutates the run; every rate
 * comes from the same function the tick uses, so forecasts cannot drift from
 * the simulation.
 */

/** Runways shorter than this earn a warning in the diagnostics strip. */
export const RUNWAY_WARNING_SECONDS = 60

/**
 * How long before the Storm the larder forecast speaks up: the back half of
 * Drizzle and all of Clearance — late enough that the first camps are up,
 * early enough to raise and staff another before the Storm halves gathering.
 */
export const STORM_FOOD_WARNING_LEAD = 70 + SEASON_LENGTH.clearance

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

/** Meals a bag of food is worth: raw food one each, cooked food double. */
function mealValue(bag: ResourceBag): number {
  let meals = 0
  for (const [id, amount] of Object.entries(bag) as [ResourceId, number][]) {
    if (!EDIBLE.includes(id)) continue
    meals += COMPLEX_FOOD.includes(id) ? amount * COMPLEX_FOOD_MULTIPLIER : amount
  }
  return meals
}

/**
 * Net meals per second the settlement's staffed food producers add in
 * `season`, at that season's multipliers: farms stop in the Storm (unless a
 * cornerstone keeps them turning) and gathering halves. A kitchen counts only
 * what cooking adds over the raw food it uses, and only while it has that raw
 * food in stock. An estimate — it ignores deposits running dry and the odd
 * bonus batch — but it never counts a farm's harvest during the Storm.
 */
export function foodProductionRate(s: RunState, mods: Modifiers, season: Season): number {
  return recipeRate(s, mods, season, (r) => mealValue(r.outputs) - mealValue(r.inputs))
}

/**
 * Units of `resource` per second the settlement's staffed producers turn out
 * right now, at this season's multipliers: what orders and decrees are sized
 * from. Like `foodProductionRate`, it counts a workshop only while it has its
 * inputs in stock (a kitchen with no grain makes no biscuits), and never a
 * producer whose deposit has run dry.
 */
export function productionRate(s: RunState, mods: Modifiers, resource: ResourceId): number {
  return recipeRate(s, mods, s.season.season, (r) => (r.outputs as ResourceBag)[resource] ?? 0)
}

/**
 * Sum over staffed, running producers of `valueOf(recipe)` per second in
 * `season`. Skips recipes worth nothing, a dry deposit, missing inputs and an
 * off-season multiplier; workers are rated as if in `season` (some quirks work
 * differently in the Storm).
 */
function recipeRate(
  s: RunState,
  mods: Modifiers,
  season: Season,
  valueOf: (recipe: Recipe) => number,
): number {
  const inSeason: RunState =
    s.season.season === season ? s : { ...s, season: { ...s.season, season } }
  let rate = 0
  for (const b of Object.values(s.buildings)) {
    if (!b.built || b.paused || b.workers.length === 0) continue
    const recipe = activeRecipe(b)
    if (!recipe || recipe.seconds <= 0) continue
    const value = valueOf(recipe)
    if (value <= 0) continue
    if (recipe.requiresDeposit && !hasLiveDeposit(s, b, recipe.requiresDeposit)) continue
    if (!canAfford(s.stock, recipe.inputs)) continue
    const multiplier = seasonMultiplier(b.defId, season, mods)
    if (multiplier <= 0) continue
    rate += (workRate(inSeason, b, mods) * multiplier * value) / recipe.seconds
  }
  return rate
}

export interface StormFoodForecast {
  /** Seconds from now until the coming (or current) Storm ends. */
  horizon: number
  /** Meals eaten over that horizon at the current population. */
  needed: number
  /** Meals in store now, net of meals already owed. */
  meals: number
  /** Meals the staffed food producers should add over the horizon. */
  produced: number
  /**
   * Meals missing at the leanest moment before the Storm ends: how much more
   * food (or production) it takes never to go hungry. Zero when covered.
   */
  shortfall: number
}

/**
 * Will the larder last until the Storm is over? Walks the seasons between
 * now and the end of the Storm, each at its own production rate, against what
 * the settlement eats. Food that would not fit in the stockpile is not
 * counted, so a camp idling at the brim cannot paper over a lean Storm.
 */
export function stormFoodForecast(s: RunState, mods: Modifiers): StormFoodForecast {
  const left = Math.max(0, s.season.length - s.season.elapsed)
  // Coming seasons at the lengths the tick will give them (Long Storms, an
  // Early Frost's short first year), all within the current year.
  const length = (season: Season) => seasonLengthFor(season, s.season.year, mods)
  const segments: [Season, number][] =
    s.season.season === 'storm'
      ? [['storm', left]]
      : s.season.season === 'clearance'
        ? [
            ['clearance', left],
            ['storm', length('storm')],
          ]
        : [
            ['drizzle', left],
            ['clearance', length('clearance')],
            ['storm', length('storm')],
          ]

  const eat = mealsPerSecond(s, mods)
  const { meals } = foodForecast(s, mods)
  // Raw food is one meal per stockpile slot; the larder cannot outgrow the room.
  const ceiling = meals + Math.max(0, s.storageCap - storageUsed(s))
  let running = meals
  let lowest = meals
  let horizon = 0
  let produced = 0
  for (const [season, seconds] of segments) {
    const make = foodProductionRate(s, mods, season)
    produced += make * seconds
    horizon += seconds
    running = Math.min(ceiling, running + (make - eat) * seconds)
    lowest = Math.min(lowest, running)
  }
  return { horizon, needed: eat * horizon, meals, produced, shortfall: Math.max(0, -lowest) }
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
// The Queen's deadline
// ---------------------------------------------------------------------------

/** Seconds in `year` at this run's season lengths (Long Storms, Early Frost). */
export function yearLengthFor(year: number, mods: Modifiers): number {
  return SEASON_ORDER.reduce((sum, season) => sum + seasonLengthFor(season, year, mods), 0)
}

export interface DeadlineForecast {
  /** Seconds until the deadline; 0 once it has passed. */
  secondsLeft: number
  /** Seconds since it passed; 0 before. */
  secondsPast: number
  passed: boolean
  /**
   * Within a year of the deadline (a year at this run's season lengths) and
   * not yet past it: the HUD counts down and the warning strip speaks up.
   */
  imminent: boolean
  /** Extra impatience per minute the deadline adds right now (0 before it). */
  overtimePerMinute: number
  /** What it adds per minute the moment it passes; it steepens from there. */
  startPerMinute: number
  /**
   * Where in the calendar the deadline lands at the current season lengths,
   * or null once it has passed. Year 5's first Drizzle at standard lengths;
   * Long Storms pull it into Year 4's Storm.
   */
  landsIn: { year: number; season: Season } | null
}

/**
 * The Queen's deadline as the HUD shows it. The countdown and the overtime
 * come from the functions the tick uses, so the number on screen is the one
 * that will bite; only the calendar placement is a projection (a cornerstone
 * that changes season lengths later can move it).
 */
export function deadlineForecast(s: RunState, mods: Modifiers): DeadlineForecast {
  const secondsPast = secondsPastDeadline(s)
  const secondsLeft = Math.max(0, QUEEN_DEADLINE_SECONDS - s.clock)
  const passed = secondsLeft <= 0
  return {
    secondsLeft,
    secondsPast,
    passed,
    imminent: !passed && secondsLeft <= yearLengthFor(s.season.year, mods),
    overtimePerMinute: deadlineOvertimeRate(s) * 60,
    startPerMinute: IMPATIENCE_OVERTIME_BASE * 60,
    landsIn: passed ? null : deadlineLandsIn(s, secondsLeft, mods),
  }
}

/** Walks the coming seasons, at the lengths the tick will give them. */
function deadlineLandsIn(
  s: RunState,
  secondsLeft: number,
  mods: Modifiers,
): { year: number; season: Season } {
  let { year, season } = s.season
  let remaining = secondsLeft - Math.max(0, s.season.length - s.season.elapsed)
  // A deadline on a season boundary belongs to the season that starts there.
  for (let guard = 0; remaining >= 0 && guard < 100; guard++) {
    const next = SEASON_ORDER[(SEASON_ORDER.indexOf(season) + 1) % SEASON_ORDER.length]
    if (next === 'drizzle') year++
    season = next
    remaining -= seasonLengthFor(season, year, mods)
  }
  return { year, season }
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
  // Tier-aware: an upgrade's recipes, ratios and speed are all folded in by
  // `activeRecipe` and `workRate`, so the status matches what the tick does.
  if (!recipe || recipesOf(b).length === 0) return { kind: 'none' }
  if (b.paused) return { kind: 'paused' }
  // A ward is staffed only when the forest needs calming; empty is not a fault.
  if (b.workers.length === 0) return def.ward ? { kind: 'none' } : { kind: 'noWorkers' }

  if (recipe.requiresDeposit && !hasLiveDeposit(s, b, recipe.requiresDeposit)) {
    return { kind: 'noDeposit' }
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
  if (outputs > 0 && used + outputs > storageLimitFor(recipe, s.storageCap)) {
    return { kind: 'storageFull', held }
  }

  const rate = workRate(s, b, mods) * multiplier
  return { kind: 'working', rate, batchSeconds: rate > 0 ? recipe.seconds / rate : Infinity }
}

/**
 * Seconds as m:ss, rounded up by default so a countdown never reads 0:00
 * early; pass `Math.round` for a point on a timeline.
 */
export function formatClock(seconds: number, round: (n: number) => number = Math.ceil): string {
  const total = Math.max(0, round(seconds))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
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
