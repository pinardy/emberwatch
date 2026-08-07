import { COMPLEX_FOOD, EDIBLE } from '../content/resources'
import { SPECIES } from '../content/species'
import type { ResourceId, RunState, SpeciesId } from '../types'
import {
  COMPLEX_FOOD_MULTIPLIER,
  FOOD_VARIETY_CAP,
  HEARTH_WARMTH_RADIUS,
  IMPATIENCE_BASE,
  IMPATIENCE_HOSTILITY_THRESHOLD,
  IMPATIENCE_PER_HOSTILITY_OVER,
  IMPATIENCE_PER_VILLAGER_LOST,
  REPUTATION_PER_RESOLVE_POINT,
  RESOLVE_COLD_HEARTH,
  RESOLVE_COLD_HOME,
  RESOLVE_COMFORT,
  RESOLVE_DRIFT,
  RESOLVE_HOUSED,
  RESOLVE_LEAVE_THRESHOLD,
  RESOLVE_PER_FOOD_VARIETY,
  RESOLVE_PER_HOSTILITY,
  RESOLVE_PER_NEED,
  RESOLVE_STARVING,
  RESOLVE_UNHOUSED,
  SECONDS_PER_MEAL,
  SECONDS_TO_LEAVE,
} from './balance'
import type { Modifiers } from './modifiers'
import { needsReductionFor, resolveBonusFor } from './modifiers'
import {
  SERVICE_COVERAGE_RATIO,
  comfortableHousing,
  foodVariety,
  population,
  serviceCoverage,
  speciesCounts,
  totalHousing,
  warmHousing,
} from './queries'
import { despairRate, ignoresColdHearth, mealMultiplier } from './traits'

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

  // Foxes and frugal villagers eat less; gluttons eat more.
  let mouths = 0
  for (const v of Object.values(s.villagers)) mouths += mealMultiplier(v)

  s.foodDebt += (mouths * dt * Math.max(0.1, mods.foodUpkeep)) / SECONDS_PER_MEAL

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

export interface ResolveBreakdown {
  species: SpeciesId
  base: number
  needs: number
  housing: number
  comfort: number
  variety: number
  hostility: number
  penalties: number
  cornerstone: number
  target: number
  current: number
  /** Which of this species' needs are fully satisfied. */
  needDetail: Record<string, boolean>
  /** 0..1 share of the population each need is currently able to serve. */
  needRatio: Record<string, number>
  /** Resolve at which this species starts generating reputation. */
  threshold: number
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
  const starvingTerm = s.starving ? RESOLVE_STARVING : 0
  const coldTerm = s.coldHearth ? RESOLVE_COLD_HEARTH : 0

  /*
   * Homes beyond the hearth's warmth are cold in the Storm. The penalty scales
   * with the share of the housed population sleeping out there, so one distant
   * shelter is a nuisance and a whole cold suburb is a crisis.
   */
  let chillTerm = 0
  if (storm && pop > 0 && housing > 0) {
    const housed = Math.min(pop, housing)
    const warm = Math.min(housed, warmHousing(s, HEARTH_WARMTH_RADIUS))
    chillTerm = RESOLVE_COLD_HOME * ((housed - warm) / pop)
  }

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
    for (const need of def.needs) {
      const ratio = coverage[need].active
        ? Math.min(1, coverage[need].capacity / required)
        : 0
      needRatio[need] = ratio
      needDetail[need] = ratio >= 1
      satisfied += ratio
    }
    // Cornerstones that reduce needs count as fully satisfied ones.
    satisfied = Math.min(def.needs.length, satisfied + reduction)
    const needsTerm = satisfied * RESOLVE_PER_NEED
    const varietyTerm = variety * RESOLVE_PER_FOOD_VARIETY
    const hostilityTerm = -s.hostility * RESOLVE_PER_HOSTILITY
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
      penalties,
      cornerstone: cornerstoneTerm,
      target,
      current: s.resolve[sp],
      needDetail,
      needRatio,
      threshold: def.resolveTarget,
    }
  })
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
  return breakdowns
}

/**
 * Reputation ticks up while species sit above their resolve threshold, weighted
 * by how much of the population they make up.
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
    gain += share * over * REPUTATION_PER_RESOLVE_POINT * dt * mods.reputationRate
  }
  s.reputationProgress += gain
  while (s.reputationProgress >= 1 && s.reputation < s.maxReputation) {
    s.reputationProgress -= 1
    s.reputation += 1
  }
  if (s.reputation >= s.maxReputation) s.reputationProgress = 0
  return gain
}

export function stepImpatience(s: RunState, dt: number, mods: Modifiers): void {
  const yearScale = 1 + (s.season.year - 1) * 0.18
  let rate = IMPATIENCE_BASE * yearScale
  if (s.hostility > IMPATIENCE_HOSTILITY_THRESHOLD) {
    rate += (s.hostility - IMPATIENCE_HOSTILITY_THRESHOLD) * IMPATIENCE_PER_HOSTILITY_OVER
  }
  addImpatience(s, rate * mods.impatienceRate * dt)
}

export function addImpatience(s: RunState, amount: number): void {
  s.impatienceProgress += amount
  while (s.impatienceProgress >= 1 && s.impatience < s.maxImpatience) {
    s.impatienceProgress -= 1
    s.impatience += 1
  }
  if (s.impatience >= s.maxImpatience) s.impatienceProgress = 0
}

export function addReputation(s: RunState, amount: number): void {
  s.reputation = Math.min(s.maxReputation, s.reputation + amount)
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
      while (s.despair[sp] >= SECONDS_TO_LEAVE) {
        s.despair[sp] -= SECONDS_TO_LEAVE
        const victim = Object.values(s.villagers).find((v) => v.species === sp)
        if (!victim) break
        removeVillager(s, victim.id)
        departed.push(`${victim.name} the ${SPECIES[sp].name.slice(0, -1)} left the settlement.`)
        s.stats.villagersLost++
        addImpatience(s, IMPATIENCE_PER_VILLAGER_LOST)
      }
    } else {
      s.despair[sp] = Math.max(0, s.despair[sp] - dt * 2)
    }
  }
  return departed
}

export function removeVillager(s: RunState, id: string): void {
  const villager = s.villagers[id]
  if (!villager) return
  if (villager.assignment) unassign(s, id)
  delete s.villagers[id]
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
