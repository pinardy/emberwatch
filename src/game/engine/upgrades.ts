import { BUILDINGS } from '../content/buildings'
import { resourceName } from '../content/resources'
import type {
  BuildingDef,
  BuildingInstance,
  BuildingUpgrade,
  Recipe,
  ResourceBag,
  ResourceId,
  UpgradeEffects,
} from '../types'

/**
 * Building upgrade tiers: pure reads over a def and an instance's `tier`.
 *
 * Every stat the sim reads off a def (slots, speed, housing, storage, reach,
 * warmth, service capacity, recipes) has a tier-aware twin here, so the rule
 * "tier N has the effects of upgrades[0..N-1] stacked" lives in one place.
 * No React, no mutation — the commands live in `actions.ts` and construction
 * in `production.ts`.
 */

/** The tier a building has reached; saves from before upgrades read as 0. */
export function tierOf(b: Pick<BuildingInstance, 'tier'>): number {
  return b.tier ?? 0
}

/** How many tiers a def can be upgraded through. */
export function maxTier(defId: string): number {
  return BUILDINGS[defId]?.upgrades?.length ?? 0
}

/** The upgrade that would take `b` to its next tier, if there is one. */
export function nextUpgrade(b: BuildingInstance): BuildingUpgrade | undefined {
  return BUILDINGS[b.defId]?.upgrades?.[tierOf(b)]
}

/** True while an upgrade is under construction on a finished building. */
export function isUpgrading(b: BuildingInstance): boolean {
  return b.built && b.upgradeProgress !== undefined
}

/** "Reinforced Shelter" once upgraded, else the def's own name. */
export function tierName(defId: string, tier: number): string {
  const def = BUILDINGS[defId]
  if (!def) return defId
  return tier > 0 ? (def.upgrades?.[tier - 1]?.name ?? def.name) : def.name
}

export function displayName(b: BuildingInstance): string {
  return tierName(b.defId, tierOf(b))
}

// ---------------------------------------------------------------------------
// Stacked effects
// ---------------------------------------------------------------------------

/** The sum of every effect a building at `tier` has, numbers totalled. */
export interface TierEffects {
  workerSlots: number
  workSpeed: number
  serviceCapacity: number
  housing: number
  storage: number
  gatherRadius: number
  warmthRadius: number
  comfort: boolean
  insulated: boolean
  recipes: Recipe[]
  extraOutputs: Record<string, ResourceBag>
}

const NO_EFFECTS: TierEffects = Object.freeze({
  workerSlots: 0,
  workSpeed: 0,
  serviceCapacity: 0,
  housing: 0,
  storage: 0,
  gatherRadius: 0,
  warmthRadius: 0,
  comfort: false,
  insulated: false,
  recipes: [],
  extraOutputs: {},
}) as TierEffects

/** Adds one tier's effects onto a running total (mutates `into`). */
function stack(into: TierEffects, e: UpgradeEffects): void {
  into.workerSlots += e.workerSlots ?? 0
  into.workSpeed += e.workSpeed ?? 0
  into.serviceCapacity += e.serviceCapacity ?? 0
  into.housing += e.housing ?? 0
  into.storage += e.storage ?? 0
  into.gatherRadius += e.gatherRadius ?? 0
  into.warmthRadius += e.warmthRadius ?? 0
  into.comfort ||= !!e.comfort
  into.insulated ||= !!e.insulated
  if (e.recipes) into.recipes = [...into.recipes, ...e.recipes]
  for (const [recipeId, bag] of Object.entries(e.extraOutputs ?? {})) {
    into.extraOutputs[recipeId] = addBags(into.extraOutputs[recipeId] ?? {}, bag)
  }
}

function addBags(a: ResourceBag, b: ResourceBag): ResourceBag {
  const out: ResourceBag = { ...a }
  for (const [id, amount] of Object.entries(b) as [ResourceId, number][]) {
    out[id] = (out[id] ?? 0) + amount
  }
  return out
}

/*
 * Effects and effective recipes are read many times per tick (every building,
 * every service check), so they are cached per def and tier. Defs are static
 * data, so the cache never needs invalidating.
 */
const effectsCache = new Map<string, TierEffects>()
const recipesCache = new Map<string, Recipe[]>()

/** Every effect of tiers 1..`tier` of `defId`, stacked. */
export function effectsAt(defId: string, tier: number): TierEffects {
  if (tier <= 0) return NO_EFFECTS
  const key = `${defId}:${tier}`
  const cached = effectsCache.get(key)
  if (cached) return cached
  const total: TierEffects = { ...NO_EFFECTS, recipes: [], extraOutputs: {} }
  const upgrades = BUILDINGS[defId]?.upgrades ?? []
  for (let i = 0; i < Math.min(tier, upgrades.length); i++) stack(total, upgrades[i].effects)
  effectsCache.set(key, total)
  return total
}

export function tierEffects(b: BuildingInstance): TierEffects {
  return effectsAt(b.defId, tierOf(b))
}

/**
 * The recipes a building at `tier` offers: the def's own with any better
 * output ratio folded in, then the ones the tiers unlocked.
 */
export function recipesAt(defId: string, tier: number): Recipe[] {
  const def = BUILDINGS[defId]
  if (!def) return []
  if (tier <= 0 || !def.upgrades?.length) return def.recipes
  const key = `${defId}:${tier}`
  const cached = recipesCache.get(key)
  if (cached) return cached
  const effects = effectsAt(defId, tier)
  const list = [...def.recipes, ...effects.recipes].map((recipe) => {
    const extra = effects.extraOutputs[recipe.id]
    return extra ? { ...recipe, outputs: addBags(recipe.outputs, extra) } : recipe
  })
  recipesCache.set(key, list)
  return list
}

export function recipesOf(b: BuildingInstance): Recipe[] {
  return recipesAt(b.defId, tierOf(b))
}

// --- stats, each the def's base plus the stacked tiers ----------------------

export function workerSlotsOf(b: BuildingInstance): number {
  const def = BUILDINGS[b.defId]
  if (!def) return 0
  return def.workerSlots + tierEffects(b).workerSlots
}

/** Work-speed multiplier from upgrades (1 at tier 0). */
export function tierSpeedMultiplier(b: BuildingInstance): number {
  return 1 + tierEffects(b).workSpeed / 100
}

export function housingOf(b: BuildingInstance): number {
  const base = BUILDINGS[b.defId]?.housing ?? 0
  return base > 0 ? base + tierEffects(b).housing : 0
}

export function storageOf(b: BuildingInstance): number {
  return (BUILDINGS[b.defId]?.storage ?? 0) + tierEffects(b).storage
}

export function gatherRadiusOf(b: BuildingInstance): number | undefined {
  const base = BUILDINGS[b.defId]?.gatherRadius
  return base ? base + tierEffects(b).gatherRadius : undefined
}

export function warmthRadiusOf(b: BuildingInstance): number {
  const warmth = BUILDINGS[b.defId]?.warmth
  return warmth ? warmth.radius + tierEffects(b).warmthRadius : 0
}

/** A service venue's capacity before neighbourhood bonuses. */
export function baseServiceCapacity(b: BuildingInstance): number {
  const service = BUILDINGS[b.defId]?.service
  return service ? service.capacity + tierEffects(b).serviceCapacity : 0
}

/** Housing whose residents count as comfortably housed (cabins, lodges). */
export function isComfortable(b: BuildingInstance): boolean {
  return b.defId === 'cabin' || tierEffects(b).comfort
}

/** Housing that stays warm in the Storm without a fire nearby. */
export function isInsulated(b: BuildingInstance): boolean {
  return (BUILDINGS[b.defId]?.housing ?? 0) > 0 && tierEffects(b).insulated
}

// ---------------------------------------------------------------------------
// Describing an upgrade
// ---------------------------------------------------------------------------

/**
 * What an upgrade changes, one "+X" line per effect. Shared by the Inspector
 * and the build panel so both say the same thing.
 */
export function describeUpgrade(def: BuildingDef, upgrade: BuildingUpgrade): string[] {
  const e = upgrade.effects
  const out: string[] = []
  if (e.housing) out.push(`+${e.housing} housing`)
  if (e.storage) out.push(`+${e.storage} storage`)
  if (e.serviceCapacity) out.push(`+${e.serviceCapacity} service capacity`)
  if (e.workerSlots) out.push(`+${e.workerSlots} worker slot${e.workerSlots > 1 ? 's' : ''}`)
  if (e.workSpeed) out.push(`+${e.workSpeed}% work speed`)
  if (e.gatherRadius) out.push(`+${e.gatherRadius} gather reach`)
  if (e.warmthRadius) out.push(`+${e.warmthRadius} warmth reach`)
  if (e.insulated) out.push('Stays warm in the Storm, even beyond the fires')
  if (e.comfort) out.push('Counts as comfortable housing, like a cabin')
  const ratios = new Set<string>()
  for (const [recipeId, bag] of Object.entries(e.extraOutputs ?? {})) {
    if (!def.recipes.some((r) => r.id === recipeId)) continue
    for (const [id, amount] of Object.entries(bag) as [ResourceId, number][]) {
      ratios.add(`+${amount} ${resourceName(id)} per batch`)
    }
  }
  out.push(...ratios)
  for (const recipe of e.recipes ?? []) out.push(`New recipe: ${formatRecipe(recipe)}`)
  return out
}

/** "3 Root → 4 Porridge", or "→ 4 Herb" for a gathering recipe. */
export function formatRecipe(recipe: Recipe): string {
  const side = (bag: ResourceBag) =>
    (Object.entries(bag) as [ResourceId, number][])
      .map(([id, amount]) => `${amount} ${resourceName(id)}`)
      .join(' + ')
  const inputs = side(recipe.inputs)
  return `${inputs ? `${inputs} ` : ''}→ ${side(recipe.outputs)}`
}
