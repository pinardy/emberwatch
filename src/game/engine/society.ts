import { BUILDINGS } from '../content/buildings'
import { COMPLEX_FOOD, EDIBLE } from '../content/resources'
import { SPECIES, speciesSingular } from '../content/species'
import type { ResourceId, RunState, Season, SpeciesId, Villager } from '../types'
import {
  COMPLEX_FOOD_MULTIPLIER,
  DEPARTURE_GRACE,
  FOOD_VARIETY_CAP,
  FROST_EXPOSURE_PER_LOSS,
  HEARTH_FUEL_PER_SECOND,
  HEARTH_IDLE_FUEL_PER_SECOND,
  IMPATIENCE_BASE,
  IMPATIENCE_HOSTILITY_THRESHOLD,
  IMPATIENCE_OVERTIME_BASE,
  IMPATIENCE_OVERTIME_RAMP,
  IMPATIENCE_PER_HOSTILITY_OVER,
  IMPATIENCE_PER_VILLAGER_LOST,
  IMPATIENCE_STAGNATION_GRACE,
  IMPATIENCE_STAGNATION_MAX,
  IMPATIENCE_STAGNATION_RAMP,
  IMPATIENCE_STALL_FROM_YEAR,
  IMPATIENCE_STALL_RATE,
  IMPATIENCE_YEAR_SCALING,
  QUEEN_DEADLINE_YEAR,
  REPUTATION_PER_RESOLVE_POINT,
  REPUTATION_UNSERVED_SHARE,
  RESOLVE_COLD_HEARTH,
  RESOLVE_COLD_HOME,
  RESOLVE_COMFORT,
  RESOLVE_DRIFT,
  RESOLVE_EXPECTATION_CROWD_FROM,
  RESOLVE_EXPECTATION_PER_VILLAGER,
  RESOLVE_EXPECTATION_PER_YEAR,
  RESOLVE_HOUSED,
  RESOLVE_LEAVE_THRESHOLD,
  RESOLVE_PER_FOOD_VARIETY,
  RESOLVE_PER_NEED,
  RESOLVE_STARVING,
  RESOLVE_UNHOUSED,
  SECONDS_PER_MEAL,
  SECONDS_TO_LEAVE,
  STARVING_MIN_SEVERITY,
  YEAR_SECONDS,
  hostilityResolvePenalty,
} from './balance'
import type { Modifiers } from './modifiers'
import { makeRng } from './rng'
import { touchVillagers } from './runCache'
import { needsReductionFor, resolveBonusFor } from './modifiers'
import {
  SERVICE_COVERAGE_RATIO,
  comfortableHousing,
  foodVariety,
  hearthWarmthRadius,
  population,
  serviceCoverage,
  speciesCounts,
  totalHousing,
  warmHousing,
} from './queries'
import { despairRate, ignoresColdHearth, mealMultiplier, needFloor } from './traits'
import { feats } from './feats'
import {
  type RefinedStatus,
  refinedResolve,
  refinedStatus,
  stepRefinedNeeds,
} from './refinedNeeds'
import { recordEvent } from './timeline'
import { gainReputation, reputationFor } from './reputation'

/**
 * Villagers eat once every `SECONDS_PER_MEAL`. Cooked food covers two meals,
 * which is the main reason to invest in a cookhouse.
 *
 * Consumption deliberately eats down the *largest* stack first so that food
 * variety (and its resolve bonus) survives as long as possible.
 */
export function stepFood(s: RunState, dt: number, mods: Modifiers): void {
  const pop = population(s)
  if (pop === 0) {
    s.starving = false
    return
  }

  s.foodDebt += mealsPerSecond(s, mods) * dt

  let guard = 0
  while (s.foodDebt >= 1 && guard++ < 500) {
    const pick = pickFood(s)
    if (!pick) break
    s.stock[pick] = (s.stock[pick] ?? 0) - 1
    if ((s.stock[pick] ?? 0) <= 0) delete s.stock[pick]
    s.foodDebt -= COMPLEX_FOOD.includes(pick) ? COMPLEX_FOOD_MULTIPLIER : 1
  }

  /*
   * The debt is *kept* when it cannot be paid, so `starving` latches for as
   * long as the larder is empty instead of flickering each time the counter
   * rolls over. Cooked food can overpay, which carries as a small credit.
   */
  s.foodDebt = Math.max(-COMPLEX_FOOD_MULTIPLIER, Math.min(s.foodDebt, pop * 2))
  s.starving = s.foodDebt >= 1
}

/** Meals the settlement eats per second at its current size and upkeep. */
export function mealsPerSecond(s: RunState, mods: Modifiers): number {
  // Foxes and frugal villagers eat less; gluttons eat more.
  let mouths = 0
  for (const v of Object.values(s.villagers)) mouths += mealMultiplier(v)
  return (mouths * Math.max(0.1, mods.foodUpkeep)) / SECONDS_PER_MEAL
}

/** Cooked food first (better value), then the biggest raw stack. */
function pickFood(s: RunState): ResourceId | null {
  let best: ResourceId | null = null
  let bestScore = -1
  for (const id of EDIBLE) {
    const amount = s.stock[id] ?? 0
    if (amount <= 0) continue
    const score = amount + (COMPLEX_FOOD.includes(id) ? 1000 : 0)
    if (score > bestScore) {
      bestScore = score
      best = id
    }
  }
  return best
}

/** Wood the hearth burns per second in `season`. */
export function hearthFuelRate(season: Season, mods: Modifiers): number {
  return (
    (season === 'storm' ? HEARTH_FUEL_PER_SECOND : HEARTH_IDLE_FUEL_PER_SECOND) *
    mods.hearthFuel
  )
}

/** Burns hearth fuel. Returns true if the hearth went cold. */
export function stepHearth(s: RunState, dt: number, fuelPerSecond: number): boolean {
  const need = fuelPerSecond * dt
  const wood = s.stock.wood ?? 0
  if (wood >= need) {
    s.stock.wood = wood - need
    if ((s.stock.wood ?? 0) <= 0.0001) delete s.stock.wood
    return false
  }
  delete s.stock.wood
  return true
}

/**
 * Braziers burn wood only while the Storm rages, after the hearth has taken
 * its share. One that finds the woodpile empty goes cold, and the homes that
 * relied on it chill. Returns how many went cold this step (for the log).
 */
export function stepBraziers(s: RunState, dt: number, fuelMultiplier = 1): number {
  const storm = s.season.season === 'storm'
  let wentCold = 0
  for (const b of Object.values(s.buildings)) {
    const warmth = BUILDINGS[b.defId]?.warmth
    if (!warmth || !b.built) continue
    if (!storm) {
      // Out of the Storm a brazier idles, and is relit for the next one.
      if (b.unlit) b.unlit = false
      continue
    }
    const need = warmth.fuelPerSecond * fuelMultiplier * dt
    const wood = s.stock.wood ?? 0
    if (wood >= need && wood > 0) {
      s.stock.wood = wood - need
      if ((s.stock.wood ?? 0) <= 0.0001) delete s.stock.wood
      b.unlit = false
    } else {
      if (!b.unlit) wentCold++
      b.unlit = true
    }
  }
  return wentCold
}

/** Wood per second the hearth and every brazier burn during the Storm. */
export function stormFuelPerSecond(
  s: RunState,
  hearthFuelPerSecond: number,
  fuelMultiplier = 1,
  brazierMultiplier = fuelMultiplier,
): number {
  let rate = hearthFuelPerSecond * fuelMultiplier
  for (const b of Object.values(s.buildings)) {
    const warmth = BUILDINGS[b.defId]?.warmth
    if (warmth && b.built) rate += warmth.fuelPerSecond * brazierMultiplier
  }
  return rate
}

export interface ResolveBreakdown {
  species: SpeciesId
  base: number
  needs: number
  housing: number
  comfort: number
  variety: number
  hostility: number
  /** Rising expectations: the year and the settlement's size (≤ 0). */
  expectations: number
  /** The refined need's bonus (≥ 0; see `engine/refinedNeeds.ts`). */
  refined: number
  /** Where this species' refined need stands (null for a species without one). */
  refinedStatus: RefinedStatus | null
  penalties: number
  /** The Storm's chill on homes beyond every fire, inside `penalties` (≤ 0). */
  chill: number
  cornerstone: number
  target: number
  current: number
  /** Which of this species' needs are fully satisfied. */
  needDetail: Record<string, boolean>
  /** 0..1 share of the population each need is currently able to serve. */
  needRatio: Record<string, number>
  /** Resolve at which this species starts generating reputation. */
  threshold: number
  /** 0..1 share of this species' needs that are met (partial coverage counts). */
  needsMet: number
  /**
   * 0..1 share of its needs met by services the settlement built (and
   * cornerstones that waive one) — what a species does for itself, like the
   * harpies' teaching, raises its resolve but not the Queen's opinion.
   */
  builtMet: number
}

/**
 * Computes each species' resolve target and the contributing terms. The UI
 * renders this breakdown directly, so the numbers players see are the exact
 * numbers the sim uses.
 */
export function resolveBreakdowns(s: RunState, mods: Modifiers): ResolveBreakdown[] {
  const pop = population(s)
  const housing = totalHousing(s)
  const comfort = comfortableHousing(s)
  const coverage = serviceCoverage(s)
  const variety = Math.min(foodVariety(s), FOOD_VARIETY_CAP)
  const storm = s.season.season === 'storm'

  const housedTerm = pop > 0 && housing >= pop ? RESOLVE_HOUSED : 0
  const comfortTerm = pop > 0 && comfort >= pop * 0.6 ? RESOLVE_COMFORT : 0
  const unhousedTerm =
    pop > 0 && housing < pop ? RESOLVE_UNHOUSED * Math.min(1, (pop - housing) / pop) : 0
  const starvingTerm = s.starving ? RESOLVE_STARVING * hungerSeverity(s, pop) : 0
  const coldTerm = s.coldHearth ? RESOLVE_COLD_HEARTH : 0

  /*
   * Homes beyond every warmth source — the hearth's radius or a lit brazier's —
   * are cold in the Storm. The penalty scales with the share of the housed
   * population sleeping out there, so one distant shelter is a nuisance and a
   * whole cold suburb is a crisis.
   */
  const chillTerm = pop > 0 ? RESOLVE_COLD_HOME * (coldVillagers(s, pop) / pop) : 0
  const owed = expectations(s, pop)

  return s.speciesPool.map((sp) => {
    const def = SPECIES[sp]
    const reduction = needsReductionFor(mods, sp)

    /*
     * Needs pay out *proportionally* to how much of the population a service can
     * actually reach. A tavern covering half the settlement is worth half the
     * resolve — no cliff, and partial investment is never wasted.
     */
    const required = Math.max(1, pop * SERVICE_COVERAGE_RATIO)
    const needDetail: Record<string, boolean> = {}
    const needRatio: Record<string, number> = {}
    let satisfied = 0
    let built = 0
    for (const need of def.needs) {
      const served = coverage[need].active
        ? Math.min(1, coverage[need].capacity / required)
        : 0
      built += served
      // Some species meet part of a need among themselves (harpies teach).
      const ratio = Math.max(served, needFloor(sp, need))
      needRatio[need] = ratio
      needDetail[need] = ratio >= 1
      satisfied += ratio
    }
    // Cornerstones that reduce needs count as fully satisfied ones.
    satisfied = Math.min(def.needs.length, satisfied + reduction)
    const needsTerm = satisfied * RESOLVE_PER_NEED
    const needsMet = def.needs.length > 0 ? satisfied / def.needs.length : 1
    // What a species is served, it comes to expect: rising expectations bite
    // in proportion to the needs met, so a well-served settlement must keep
    // improving while a struggling one is not kicked when it is down.
    const expectationsTerm = -owed * needsMet
    // The finer form of one need: a bonus on top, and part of the
    // expectations given back. Missing it costs nothing.
    const refined = refinedStatus(s, sp, pop)
    if (refined) refined.basicsMet = needsMet >= 1
    const refinedTerm = refinedResolve(refined, owed)
    const varietyTerm = variety * RESOLVE_PER_FOOD_VARIETY
    const hostilityTerm = -hostilityResolvePenalty(s.hostility)
    const cornerstoneTerm = resolveBonusFor(mods, sp) + (storm ? mods.stormResolve : 0)
    // Lizards do not feel a cold hearth; nobody escapes hunger or the rain.
    const speciesColdTerm = ignoresColdHearth(sp) ? 0 : coldTerm
    const penalties = unhousedTerm + starvingTerm + speciesColdTerm + chillTerm

    const target =
      def.baseResolve +
      needsTerm +
      housedTerm +
      comfortTerm +
      varietyTerm +
      hostilityTerm +
      expectationsTerm +
      refinedTerm +
      cornerstoneTerm +
      penalties

    return {
      species: sp,
      base: def.baseResolve,
      needs: needsTerm,
      housing: housedTerm,
      comfort: comfortTerm,
      variety: varietyTerm,
      hostility: hostilityTerm,
      expectations: expectationsTerm,
      refined: refinedTerm,
      refinedStatus: refined,
      penalties,
      chill: chillTerm,
      cornerstone: cornerstoneTerm,
      target,
      current: s.resolve[sp],
      needDetail,
      needRatio,
      threshold: def.resolveTarget,
      needsMet,
      builtMet:
        def.needs.length > 0 ? Math.min(def.needs.length, built + reduction) / def.needs.length : 1,
    }
  })
}

/**
 * 0..1 — how hard hunger bites. The first missed meal stings; the full penalty
 * arrives once the unpaid debt reaches a meal per villager.
 */
export function hungerSeverity(s: RunState, pop = population(s)): number {
  if (!s.starving || pop <= 0) return 0
  return Math.min(1, Math.max(STARVING_MIN_SEVERITY, s.foodDebt / pop))
}

/**
 * Villagers sleeping in the cold right now: in the Storm, the housed
 * population beyond every live warmth source (the hearth's shrinking reach, a
 * lit brazier) and not in an insulated home. 0 outside the Storm.
 */
export function coldVillagers(s: RunState, pop = population(s)): number {
  if (s.season.season !== 'storm') return 0
  return villagersBeyond(s, hearthWarmthRadius(s), pop)
}

/**
 * Housed villagers who would sleep cold with the hearth's reach at
 * `hearthRadius`. Villagers take the warm beds first, so only a settlement
 * whose warm homes are full has anyone out in the cold.
 */
export function villagersBeyond(s: RunState, hearthRadius: number, pop = population(s)): number {
  if (pop <= 0) return 0
  const housing = totalHousing(s)
  if (housing <= 0) return 0
  const housed = Math.min(pop, housing)
  return housed - Math.min(housed, warmHousing(s, hearthRadius))
}

/**
 * Resolve a fully served species has come to take for granted: nothing in
 * Year 1, then `RESOLVE_EXPECTATION_PER_YEAR` more each year, plus a little
 * for every villager past `RESOLVE_EXPECTATION_CROWD_FROM`. Each species
 * feels it in proportion to the share of its needs that are met (see
 * `resolveBreakdowns`).
 */
export function expectations(s: RunState, pop = population(s)): number {
  const years = Math.max(0, s.season.year - 1) * RESOLVE_EXPECTATION_PER_YEAR
  const crowd =
    Math.max(0, pop - RESOLVE_EXPECTATION_CROWD_FROM) * RESOLVE_EXPECTATION_PER_VILLAGER
  return years + crowd
}

/**
 * Frost: villagers in cold homes through the Storm build up exposure, and each
 * `FROST_EXPOSURE_PER_LOSS` of it costs a life (and the Queen's patience, like
 * any loss). Lizards shrug off the cold, so it takes one of the others.
 * Exposure clears when the Storm passes. Returns log lines for the losses.
 */
export function stepFrost(s: RunState, dt: number): string[] {
  if (s.season.season !== 'storm') {
    if (s.frostExposure) s.frostExposure = 0
    return []
  }
  const cold = coldVillagers(s)
  if (cold <= 0) return []
  feats(s).sleptCold = true
  s.frostExposure = (s.frostExposure ?? 0) + cold * dt
  if (s.frostExposure < FROST_EXPOSURE_PER_LOSS) return []
  s.frostExposure -= FROST_EXPOSURE_PER_LOSS
  const pool = Object.values(s.villagers).filter((v) => !ignoresColdHearth(v.species))
  if (pool.length === 0) return []
  const rng = makeRng(s.seed, s.rngCursor)
  const victim = rng.pick(pool)
  s.rngCursor = rng.cursor()
  loseVillager(s, victim, 'lost')
  feats(s).frostLosses = (feats(s).frostLosses ?? 0) + 1
  addImpatience(s, IMPATIENCE_PER_VILLAGER_LOST)
  return [
    `${victim.name} the ${speciesSingular(victim.species)} died of the cold in an unheated home. Raise a brazier or insulate the homes beyond the hearth's reach.`,
  ]
}

/** Seconds until the cold takes someone at the current exposure (Infinity if nobody is cold). */
export function secondsUntilFrostLoss(s: RunState): number {
  const cold = coldVillagers(s)
  if (cold <= 0) return Infinity
  return Math.max(0, (FROST_EXPOSURE_PER_LOSS - (s.frostExposure ?? 0)) / cold)
}

/** Drifts resolve toward its target and returns the fresh breakdowns. */
export function stepResolve(
  s: RunState,
  dt: number,
  mods: Modifiers,
): ResolveBreakdown[] {
  const breakdowns = resolveBreakdowns(s, mods)
  for (const b of breakdowns) {
    const current = s.resolve[b.species]
    const delta = b.target - current
    const step = Math.sign(delta) * Math.min(Math.abs(delta), RESOLVE_DRIFT * dt)
    s.resolve[b.species] = current + step
  }
  stepRefinedNeeds(
    s,
    dt,
    breakdowns.map((b) => ({ species: b.species, refined: b.refinedStatus })),
  )
  return breakdowns
}

/**
 * Reputation ticks up while species sit above their resolve threshold, weighted
 * by how much of the population they make up and by how well their needs are
 * served — see `REPUTATION_UNSERVED_SHARE`.
 */
export function stepReputation(
  s: RunState,
  dt: number,
  mods: Modifiers,
  breakdowns: ResolveBreakdown[],
): number {
  const pop = population(s)
  if (pop === 0) return 0
  const counts = speciesCounts(s)
  let gain = 0
  for (const b of breakdowns) {
    const share = counts[b.species] / pop
    if (share <= 0) continue
    const over = Math.max(0, s.resolve[b.species] - b.threshold)
    const served = REPUTATION_UNSERVED_SHARE + (1 - REPUTATION_UNSERVED_SHARE) * b.builtMet
    gain += share * over * served * REPUTATION_PER_RESOLVE_POINT * dt * mods.reputationRate
  }
  // The land's profile (Pilgrim Road pays more for contentment); once the
  // meter is full, it is Glory.
  gain = reputationFor(s, 'resolve', gain)
  gainReputation(s, gain, 'resolve')
  return gain
}

/**
 * Passive impatience per second right now, by cause. The sim adds `total`;
 * the HUD names the larger causes, so the rate the player is shown — and why
 * — is the rate that is applied. Every part but `deadline` already carries the
 * cornerstones' calming (`mods.impatienceRate`).
 */
export interface ImpatienceParts {
  /** The calendar: a base rate that grows each year. */
  calendar: number
  /** Hostility past `IMPATIENCE_HOSTILITY_THRESHOLD`. */
  hostility: number
  /** Villagers whose species sits below its reputation threshold. */
  stalling: number
  /** Time since reputation last rose (see `stagnationImpatienceRate`). */
  stagnation: number
  /** The Queen's deadline overtime. */
  deadline: number
  total: number
}

export function impatienceParts(s: RunState, mods: Modifiers): ImpatienceParts {
  const calm = mods.impatienceRate
  const yearScale = 1 + (s.season.year - 1) * IMPATIENCE_YEAR_SCALING
  const calendar = IMPATIENCE_BASE * yearScale * calm
  const hostility =
    s.hostility > IMPATIENCE_HOSTILITY_THRESHOLD
      ? (s.hostility - IMPATIENCE_HOSTILITY_THRESHOLD) * IMPATIENCE_PER_HOSTILITY_OVER * calm
      : 0
  const stalling = stallingImpatienceRate(s) * calm
  const stagnation = stagnationImpatienceRate(s) * calm
  // The deadline is not softened by cornerstones: it is what ends every run.
  const deadline = deadlineOvertimeRate(s)
  return {
    calendar,
    hostility,
    stalling,
    stagnation,
    deadline,
    total: calendar + hostility + stalling + stagnation + deadline,
  }
}

/**
 * Passive impatience gained per second right now, including the Queen's
 * deadline overtime. Shared by the sim and the HUD so the rate the player is
 * shown is the rate that is applied.
 */
export function impatienceRate(s: RunState, mods: Modifiers): number {
  return impatienceParts(s, mods).total
}

/**
 * Seconds since reputation last rose by a whole point (0 until the run's first
 * tick has started the count; see `noteReputation`).
 */
export function secondsSinceReputation(s: RunState): number {
  return s.reputationRise ? Math.max(0, s.clock - s.reputationRise.at) : 0
}

/**
 * The Queen reacts to stagnation, not just the calendar: once reputation has
 * stood still for `IMPATIENCE_STAGNATION_GRACE` seconds, impatience climbs by
 * a rate that grows with every further second — gently at first, up to
 * `IMPATIENCE_STAGNATION_MAX`. The next reputation point resets it.
 */
export function stagnationImpatienceRate(s: RunState): number {
  const past = secondsSinceReputation(s) - IMPATIENCE_STAGNATION_GRACE
  if (past <= 0) return 0
  return Math.min(IMPATIENCE_STAGNATION_MAX, past * IMPATIENCE_STAGNATION_RAMP)
}

/**
 * Remembers when reputation last rose. A save from before this existed starts
 * the count when it is first ticked, rather than inheriting a whole run of
 * stagnation.
 */
export function noteReputation(s: RunState): void {
  const rise = s.reputationRise
  if (!rise || s.reputation > rise.level) {
    s.reputationRise = { at: s.clock, level: s.reputation }
  } else if (s.reputation < rise.level) {
    rise.level = s.reputation
  }
}

/**
 * The Queen's view of a settlement that is not earning: from Year 2, extra
 * impatience per second in proportion to the share of villagers whose species
 * sits below its reputation threshold. Nothing at all while every species is
 * above it — keep earning and she keeps her peace.
 */
export function stallingImpatienceRate(s: RunState): number {
  if (s.season.year < IMPATIENCE_STALL_FROM_YEAR) return 0
  return IMPATIENCE_STALL_RATE * stalledShare(s)
}

/** 0..1 share of villagers whose species is below its reputation threshold. */
export function stalledShare(s: RunState): number {
  const pop = population(s)
  if (pop === 0) return 0
  const counts = speciesCounts(s)
  let stalled = 0
  for (const sp of s.speciesPool) {
    if (counts[sp] > 0 && s.resolve[sp] < SPECIES[sp].resolveTarget) stalled += counts[sp]
  }
  return stalled / pop
}

/**
 * Extra impatience per second the Queen's deadline adds right now: nothing
 * before it, then a base rate that steepens with every second past it.
 */
export function deadlineOvertimeRate(s: RunState): number {
  const overtime = secondsPastDeadline(s)
  return overtime > 0 ? IMPATIENCE_OVERTIME_BASE + overtime * IMPATIENCE_OVERTIME_RAMP : 0
}

export function stepImpatience(s: RunState, dt: number, mods: Modifiers): void {
  addImpatience(s, impatienceRate(s, mods) * dt)
}

/**
 * Game-clock second at which the Queen's deadline falls: the start of
 * `QUEEN_DEADLINE_YEAR` at standard season lengths. It is a fixed point on the
 * clock, so modifiers that stretch or shorten seasons move it within the
 * calendar (Long Storms land it in Year 4's Storm), never in time.
 */
export const QUEEN_DEADLINE_SECONDS = (QUEEN_DEADLINE_YEAR - 1) * YEAR_SECONDS

/** Seconds since the Queen's deadline passed (0 before it). */
export function secondsPastDeadline(s: RunState): number {
  return Math.max(0, s.clock - QUEEN_DEADLINE_SECONDS)
}

/**
 * Moves the Queen's impatience by `amount`, up or down. Whole points carry
 * through the fractional progress both ways: relief borrows from whole points
 * (7 and a half, less 2, is 5 and a half), and the meter never drops below 0.
 */
export function addImpatience(s: RunState, amount: number): void {
  // While the envoy rides the Queen is satisfied: her patience stands still.
  if (s.envoy && !s.envoy.outcome) return
  // Whole points only: a fraction in them (an older save, a hand edit) moves
  // into the progress, so the meter can never step past its ceiling.
  const whole = Math.floor(s.impatience)
  if (whole !== s.impatience) {
    s.impatienceProgress += s.impatience - whole
    s.impatience = whole
  }
  s.impatienceProgress += amount
  while (s.impatienceProgress >= 1 && s.impatience < s.maxImpatience) {
    s.impatienceProgress -= 1
    s.impatience += 1
  }
  while (s.impatienceProgress < 0 && s.impatience > 0) {
    s.impatienceProgress += 1
    s.impatience -= 1
  }
  if (s.impatienceProgress < 0) s.impatienceProgress = 0
  if (s.impatience >= s.maxImpatience) {
    s.impatience = s.maxImpatience
    s.impatienceProgress = 0
  }
}

/**
 * Grants `amount` reputation from glade events and conditions, worth what this
 * run's profile says. Every other source grants through `gainReputation`
 * directly (see `reputation.ts`).
 */
export function addReputation(s: RunState, amount: number): void {
  gainReputation(s, amount > 0 ? reputationFor(s, 'events', amount) : amount, 'events')
}

/**
 * Species stuck in despair start losing villagers. Each departure feeds the
 * Queen's impatience, which is the main way a run spirals.
 */
export function stepDepartures(s: RunState, dt: number): string[] {
  const departed: string[] = []
  const counts = speciesCounts(s)
  for (const sp of s.speciesPool) {
    if (counts[sp] === 0) {
      s.despair[sp] = 0
      continue
    }
    if (s.resolve[sp] <= RESOLVE_LEAVE_THRESHOLD) {
      s.despair[sp] += dt * despairRate(sp)
      if (s.despair[sp] >= SECONDS_TO_LEAVE) {
        // One at a time, then a grace period before the next considers it.
        s.despair[sp] = -DEPARTURE_GRACE
        const victim = pickVictim(s, sp)
        if (!victim) continue
        loseVillager(s, victim, 'left')
        departed.push(`${victim.name} the ${speciesSingular(sp)} left the settlement.`)
        addImpatience(s, IMPATIENCE_PER_VILLAGER_LOST)
      }
    } else {
      s.despair[sp] = Math.max(0, s.despair[sp] - dt * 2)
    }
  }
  return departed
}

/**
 * Picks a villager at random with the run RNG (advancing the cursor, so a save
 * replays the same choice). `species` narrows the pool.
 */
export function pickVictim(s: RunState, species?: SpeciesId): Villager | null {
  const pool = Object.values(s.villagers).filter((v) => !species || v.species === species)
  if (pool.length === 0) return null
  const rng = makeRng(s.seed, s.rngCursor)
  const victim = rng.pick(pool)
  s.rngCursor = rng.cursor()
  return victim
}

/** A villager gone for good: off the roster, counted, and on the timeline. */
export function loseVillager(s: RunState, v: Villager, event: 'lost' | 'left' = 'lost'): void {
  removeVillager(s, v.id)
  s.stats.villagersLost++
  recordEvent(s, event, v.species)
}

export function removeVillager(s: RunState, id: string): void {
  const villager = s.villagers[id]
  if (!villager) return
  if (villager.assignment) unassign(s, id)
  delete s.villagers[id]
  touchVillagers(s)
}

/** Removes a villager from whatever they are doing. */
export function unassign(s: RunState, villagerId: string): void {
  const villager = s.villagers[villagerId]
  if (!villager?.assignment) return
  const assignment = villager.assignment
  if (assignment.startsWith('clearing:')) {
    const glade = s.glades[assignment.slice('clearing:'.length)]
    if (glade) glade.clearers = Math.max(0, glade.clearers - 1)
  } else {
    const building = s.buildings[assignment]
    if (building) building.workers = building.workers.filter((w) => w !== villagerId)
  }
  villager.assignment = null
}
