import { BUILDINGS } from '../content/buildings'
import { COMPLEX_FOOD, EDIBLE, RESOURCES } from '../content/resources'
import { dist } from './geometry'
import type {
  BuildingInstance,
  ResourceBag,
  ResourceId,
  RunState,
  ServiceNeed,
  SpeciesId,
  Villager,
} from '../types'

/**
 * Read-only derivations over `RunState`. Kept separate from the tick so both
 * the sim and the UI can share them without duplicating rules.
 */

export function population(s: RunState): number {
  return Object.keys(s.villagers).length
}

export function villagerList(s: RunState): Villager[] {
  return Object.values(s.villagers)
}

export function idleVillagers(s: RunState): Villager[] {
  return villagerList(s).filter((v) => v.assignment === null)
}

export function totalHousing(s: RunState): number {
  let sum = 0
  for (const b of Object.values(s.buildings)) {
    if (!b.built) continue
    sum += BUILDINGS[b.defId]?.housing ?? 0
  }
  return sum
}

/** Villagers living in a proper cabin get a small extra resolve bonus. */
export function comfortableHousing(s: RunState): number {
  let sum = 0
  for (const b of Object.values(s.buildings)) {
    if (!b.built || b.defId !== 'cabin') continue
    sum += BUILDINGS[b.defId]?.housing ?? 0
  }
  return sum
}

/**
 * Housing capacity within the hearth's warmth radius. Homes beyond it are
 * cold during the Storm — see `RESOLVE_COLD_HOME`.
 */
export function warmHousing(s: RunState, radius: number): number {
  const hearth = Object.values(s.buildings).find(
    (b) => BUILDINGS[b.defId]?.category === 'hearth',
  )
  if (!hearth) return 0
  let sum = 0
  for (const b of Object.values(s.buildings)) {
    if (!b.built) continue
    const housing = BUILDINGS[b.defId]?.housing ?? 0
    if (housing <= 0) continue
    if (dist(hearth.pos, b.pos) <= radius) sum += housing
  }
  return sum
}

export function computeStorageCap(s: RunState, bonus = 0): number {
  let cap = 0
  for (const b of Object.values(s.buildings)) {
    if (!b.built) continue
    cap += BUILDINGS[b.defId]?.storage ?? 0
  }
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
  const out = { human: 0, beaver: 0, lizard: 0, harpy: 0, fox: 0 }
  for (const v of Object.values(s.villagers)) out[v.species]++
  return out
}

export function presentSpecies(s: RunState): SpeciesId[] {
  const counts = speciesCounts(s)
  return (Object.keys(counts) as SpeciesId[]).filter((sp) => counts[sp] > 0)
}

// ---------------------------------------------------------------------------
// Food
// ---------------------------------------------------------------------------

export function foodStock(s: RunState): number {
  let sum = 0
  for (const id of EDIBLE) sum += s.stock[id] ?? 0
  return sum
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
    const recipe = def.recipes[0]
    const supplied = !recipe || canAfford(s.stock, recipe.inputs)
    if (!supplied) continue
    const entry = out[def.service.need]
    entry.capacity += def.service.capacity
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

export function bagTotal(bag: ResourceBag): number {
  let sum = 0
  for (const amount of Object.values(bag)) sum += amount ?? 0
  return sum
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
  const def = BUILDINGS[b.defId]
  return def?.recipes.find((r) => r.id === b.activeRecipeId) ?? def?.recipes[0]
}

/** Recipes a building can actually run, given the deposits it can reach. */
export function availableRecipes(b: BuildingInstance) {
  const def = BUILDINGS[b.defId]
  if (!def) return []
  return def.recipes.filter(
    (r) => !r.requiresDeposit || (b.depositsInRange[r.requiresDeposit]?.length ?? 0) > 0,
  )
}

export function workerCapacity(s: RunState): { used: number; total: number } {
  let used = 0
  let total = 0
  for (const b of Object.values(s.buildings)) {
    const def = BUILDINGS[b.defId]
    if (!def || !b.built) continue
    total += def.workerSlots
    used += b.workers.length
  }
  return { used, total }
}
