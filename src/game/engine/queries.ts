import { BUILDINGS } from '../content/buildings'
import { COMPLEX_FOOD, EDIBLE, RESOURCES } from '../content/resources'
import { serviceCapacity } from './adjacency'
import { HEARTH_WARMTH_RADIUS, RESOLVE_LEAVE_THRESHOLD, SECONDS_TO_LEAVE } from './balance'
import { dist } from './geometry'
import { memoByBuildings, memoByVillagers } from './runCache'
import { despairRate } from './traits'
import {
  housingOf,
  isComfortable,
  isInsulated,
  recipesOf,
  storageOf,
  warmthRadiusOf,
  workerSlotsOf,
} from './upgrades'
import type {
  BuildingInstance,
  ResourceBag,
  ResourceId,
  RunState,
  ServiceNeed,
  SpeciesId,
  Vec2,
  Villager,
} from '../types'

/**
 * Read-only derivations over `RunState`. Kept separate from the tick so both
 * the sim and the UI can share them without duplicating rules.
 */

/*
 * The settlement-wide counts below are read many times a tick; inside a
 * `withRunCache` scope (the tick) each is computed once per change of what it
 * counts.
 */

export function population(s: RunState): number {
  return memoByVillagers(s, 'population', () => Object.keys(s.villagers).length)
}

export function villagerList(s: RunState): Villager[] {
  return Object.values(s.villagers)
}

export function idleVillagers(s: RunState): Villager[] {
  return villagerList(s).filter((v) => v.assignment === null)
}

export function totalHousing(s: RunState): number {
  return memoByBuildings(s, 'totalHousing', () => {
    let sum = 0
    for (const b of Object.values(s.buildings)) {
      if (!b.built) continue
      sum += housingOf(b)
    }
    return sum
  })
}

/**
 * Villagers living in a proper cabin get a small extra resolve bonus — and so
 * do those in a home upgraded to comfort (a shelter made into a lodge).
 */
export function comfortableHousing(s: RunState): number {
  return memoByBuildings(s, 'comfortableHousing', () => {
    let sum = 0
    for (const b of Object.values(s.buildings)) {
      if (!b.built || !isComfortable(b)) continue
      sum += housingOf(b)
    }
    return sum
  })
}

/** A circle of warmth: the hearth's, or a lit brazier's. */
export interface WarmthSource {
  id: string
  kind: 'hearth' | 'brazier'
  pos: Vec2
  radius: number
}

/**
 * Every live warmth source: the hearth (always — a cold hearth has its own
 * penalty) and each built brazier that has not run out of wood.
 */
export function warmthSources(
  s: RunState,
  hearthRadius: number = HEARTH_WARMTH_RADIUS,
): WarmthSource[] {
  const out: WarmthSource[] = []
  for (const b of Object.values(s.buildings)) {
    const def = BUILDINGS[b.defId]
    if (!def) continue
    if (def.category === 'hearth') {
      out.push({ id: b.id, kind: 'hearth', pos: b.pos, radius: hearthRadius })
    } else if (def.warmth && b.built && !b.unlit) {
      out.push({ id: b.id, kind: 'brazier', pos: b.pos, radius: warmthRadiusOf(b) })
    }
  }
  return out
}

/**
 * Whether a built home stays warm in the Storm: inside a live warmth source,
 * or insulated by an upgrade. Pass `sources` when checking many homes.
 */
export function isWarmHome(s: RunState, b: BuildingInstance, sources?: WarmthSource[]): boolean {
  if (isInsulated(b)) return true
  return (sources ?? warmthSources(s)).some((w) => dist(w.pos, b.pos) <= w.radius)
}

/** Whether a home at `pos` sits inside any live warmth source. */
export function isWarmAt(
  s: RunState,
  pos: Vec2,
  hearthRadius: number = HEARTH_WARMTH_RADIUS,
): boolean {
  return warmthSources(s, hearthRadius).some((w) => dist(w.pos, pos) <= w.radius)
}

/** Built homes standing within `radius` of `pos` (what a brazier would warm). */
export function homesWithin(s: RunState, pos: Vec2, radius: number): BuildingInstance[] {
  return Object.values(s.buildings).filter(
    (b) =>
      b.built &&
      BUILDINGS[b.defId]?.category === 'housing' &&
      dist(b.pos, pos) <= radius,
  )
}

/**
 * Housing capacity inside any warmth source — the hearth's radius or a lit
 * brazier's. Homes beyond every source are cold during the Storm — see
 * `RESOLVE_COLD_HOME`.
 */
export function warmHousing(s: RunState, radius: number = HEARTH_WARMTH_RADIUS): number {
  const sources = warmthSources(s, radius)
  let sum = 0
  for (const b of Object.values(s.buildings)) {
    if (!b.built) continue
    const housing = housingOf(b)
    if (housing <= 0) continue
    if (isWarmHome(s, b, sources)) sum += housing
  }
  return sum
}

export function computeStorageCap(s: RunState, bonus = 0): number {
  const cap = memoByBuildings(s, 'storageCap', () => {
    let sum = 0
    for (const b of Object.values(s.buildings)) {
      if (!b.built) continue
      sum += storageOf(b)
    }
    return sum
  })
  return cap + bonus
}

/** Amber does not take up stockpile space. */
export function storageUsed(s: RunState): number {
  let used = 0
  for (const [id, amount] of Object.entries(s.stock)) {
    if (id === 'amber') continue
    used += amount ?? 0
  }
  return used
}

export function speciesCounts(s: RunState): Record<SpeciesId, number> {
  const counts = memoByVillagers(s, 'speciesCounts', () => {
    const out = { human: 0, beaver: 0, lizard: 0, harpy: 0, fox: 0 }
    for (const v of Object.values(s.villagers)) out[v.species]++
    return out
  })
  // A copy: callers own what they get.
  return { ...counts }
}

/** Average resolve across the species living here (0 with nobody). */
export function averageResolve(s: RunState): number {
  const present = s.speciesPool.filter((sp) =>
    Object.values(s.villagers).some((v) => v.species === sp),
  )
  if (present.length === 0) return 0
  return present.reduce((sum, sp) => sum + s.resolve[sp], 0) / present.length
}

/**
 * Seconds until the next villager of each species walks out, for every present
 * species whose resolve is at or below the leaving threshold. Species that are
 * not in despair are absent. Mirrors `stepDepartures`.
 */
export function secondsUntilDeparture(s: RunState): Partial<Record<SpeciesId, number>> {
  const out: Partial<Record<SpeciesId, number>> = {}
  const counts = speciesCounts(s)
  for (const sp of s.speciesPool) {
    if (counts[sp] === 0 || s.resolve[sp] > RESOLVE_LEAVE_THRESHOLD) continue
    const rate = despairRate(sp)
    if (rate <= 0) continue
    out[sp] = Math.max(0, (SECONDS_TO_LEAVE - s.despair[sp]) / rate)
  }
  return out
}

// ---------------------------------------------------------------------------
// Food
// ---------------------------------------------------------------------------

/** Everything edible in `stock`. */
export function edibleTotal(stock: ResourceBag): number {
  let sum = 0
  for (const id of EDIBLE) sum += stock[id] ?? 0
  return sum
}

export function foodStock(s: RunState): number {
  return edibleTotal(s.stock)
}

/** Number of distinct edible resources with at least 1 in stock. */
export function foodVariety(s: RunState): number {
  let n = 0
  for (const id of EDIBLE) if ((s.stock[id] ?? 0) > 0) n++
  return n
}

export function complexFoodStock(s: RunState): number {
  let sum = 0
  for (const id of COMPLEX_FOOD) sum += s.stock[id] ?? 0
  return sum
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export interface ServiceCoverage {
  /** Villagers this need can serve right now. */
  capacity: number
  /** Whether at least one building for the need is staffed and supplied. */
  active: boolean
}

export function serviceCoverage(s: RunState): Record<ServiceNeed, ServiceCoverage> {
  const out: Record<ServiceNeed, ServiceCoverage> = {
    rest: { capacity: 0, active: false },
    luxury: { capacity: 0, active: false },
    religion: { capacity: 0, active: false },
    education: { capacity: 0, active: false },
    brawling: { capacity: 0, active: false },
    treatment: { capacity: 0, active: false },
  }
  for (const b of Object.values(s.buildings)) {
    const def = BUILDINGS[b.defId]
    if (!b.built || !def?.service || b.paused) continue
    if (b.workers.length === 0) continue
    // A service only counts while it has the goods to hand out.
    const recipe = recipesOf(b)[0]
    const supplied = !recipe || canAfford(s.stock, recipe.inputs)
    if (!supplied) continue
    const entry = out[def.service.need]
    // Homes nearby and a supplier next door stretch a venue's reach.
    entry.capacity += serviceCapacity(s, b)
    entry.active = true
  }
  return out
}

/**
 * A need counts as met when a service is live and can cover this share of the
 * population. Shared by the sim and the UI so both agree on the threshold.
 */
export const SERVICE_COVERAGE_RATIO = 0.7

// ---------------------------------------------------------------------------
// Resource bag helpers
// ---------------------------------------------------------------------------

export function canAfford(stock: ResourceBag, cost: ResourceBag): boolean {
  for (const [id, amount] of Object.entries(cost)) {
    if ((stock[id as ResourceId] ?? 0) < (amount ?? 0)) return false
  }
  return true
}

export function spend(stock: ResourceBag, cost: ResourceBag): void {
  for (const [id, amount] of Object.entries(cost)) {
    const key = id as ResourceId
    stock[key] = Math.max(0, (stock[key] ?? 0) - (amount ?? 0))
    if (stock[key] === 0) delete stock[key]
  }
}

/** Adds to the stockpile, respecting `cap` for everything except amber. */
export function grant(
  stock: ResourceBag,
  gain: ResourceBag,
  cap?: number,
  currentUsed?: number,
): number {
  let used = currentUsed ?? 0
  let added = 0
  for (const [id, amount] of Object.entries(gain)) {
    const key = id as ResourceId
    let qty = amount ?? 0
    if (qty <= 0) continue
    if (cap !== undefined && key !== 'amber') {
      qty = Math.max(0, Math.min(qty, cap - used))
      used += qty
    }
    if (qty <= 0) continue
    stock[key] = (stock[key] ?? 0) + qty
    added += qty
  }
  return added
}

/** Grants `gain` into the stockpile up to storage, counted as produced. */
export function grantProduced(s: RunState, gain: ResourceBag): void {
  s.stats.resourcesProduced += grant(s.stock, gain, s.storageCap, storageUsed(s))
}

export function sortBag(bag: ResourceBag): [ResourceId, number][] {
  return (Object.entries(bag) as [ResourceId, number][])
    .filter(([, n]) => n > 0)
    .sort((a, b) => {
      const ca = RESOURCES[a[0]]?.category ?? 'material'
      const cb = RESOURCES[b[0]]?.category ?? 'material'
      if (ca !== cb) return ca.localeCompare(cb)
      return a[0].localeCompare(b[0])
    })
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

export function activeRecipe(b: BuildingInstance) {
  const recipes = recipesOf(b)
  return recipes.find((r) => r.id === b.activeRecipeId) ?? recipes[0]
}

/** Recipes a building can actually run, given the deposits it can reach. */
export function availableRecipes(b: BuildingInstance) {
  return recipesOf(b).filter(
    (r) => !r.requiresDeposit || (b.depositsInRange[r.requiresDeposit]?.length ?? 0) > 0,
  )
}

export function workerCapacity(s: RunState): { used: number; total: number } {
  let used = 0
  let total = 0
  for (const b of Object.values(s.buildings)) {
    const def = BUILDINGS[b.defId]
    if (!def || !b.built) continue
    total += workerSlotsOf(b)
    used += b.workers.length
  }
  return { used, total }
}
