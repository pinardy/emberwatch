import { BUILDINGS } from '../content/buildings'
import { SPECIES } from '../content/species'
import type {
  BuildingInstance,
  DepositId,
  ResourceBag,
  ResourceId,
  RunState,
} from '../types'
import {
  RUSH_COST_PER_SECOND,
  SOOTHE_BASE_COST,
  SOOTHE_COST_GROWTH,
} from './balance'
import { pushLog } from './createRun'
import { depositsInRangeOf } from './production'
import {
  availableRecipes,
  canAfford,
  grant,
  idleVillagers,
  spend,
  storageUsed,
} from './queries'
import { unassign } from './society'
import { clearMultiplier } from './traits'

/** Player commands. Each returns `null` on success or a reason for failure. */
export type ActionError = string | null

// ---------------------------------------------------------------------------
// Building placement
// ---------------------------------------------------------------------------

export function canPlaceBuilding(
  s: RunState,
  defId: string,
  tileKey: string,
): ActionError {
  const def = BUILDINGS[defId]
  if (!def) return 'Unknown building.'
  if (!s.unlockedBuildings.includes(defId)) return 'You do not have this blueprint.'
  const tile = s.tiles[tileKey]
  if (!tile) return 'Nothing there.'
  if (tile.blocked) return 'The ground will not take a foundation.'
  if (tile.buildingId) return 'Something is already built here.'
  if (tile.deposit) return 'Clear the deposit tile — build beside it instead.'
  if (!s.glades[tile.gladeId]?.cleared) return 'That glade has not been cleared.'
  if (def.unique && Object.values(s.buildings).some((b) => b.defId === defId)) {
    return `You may only have one ${def.name}.`
  }
  if (!canAfford(s.stock, def.cost)) return 'Not enough materials.'
  if (def.gatherRadius) {
    const deposits = depositsInRangeOf(s, tileKey, def.gatherRadius)
    const needed = [
      ...new Set(
        def.recipes
          .map((r) => r.requiresDeposit)
          .filter((d): d is DepositId => d !== undefined),
      ),
    ]
    const reachable = needed.some((d) => (deposits[d]?.length ?? 0) > 0)
    if (needed.length > 0 && !reachable) return 'No usable deposits within range.'
  }
  return null
}

export function placeBuilding(s: RunState, defId: string, tileKey: string): ActionError {
  const error = canPlaceBuilding(s, defId, tileKey)
  if (error) return error
  const def = BUILDINGS[defId]
  spend(s.stock, def.cost)

  const id = `b${Object.keys(s.buildings).length}_${Math.round(s.clock * 100)}`
  const instance: BuildingInstance = {
    id,
    defId,
    tile: tileKey,
    built: def.buildSeconds <= 0,
    buildProgress: 0,
    workers: [],
    activeRecipeId: def.recipes[0]?.id ?? '',
    recipeProgress: 0,
    paused: false,
    depositsInRange: def.gatherRadius
      ? depositsInRangeOf(s, tileKey, def.gatherRadius)
      : {},
  }
  // Default a gathering camp to a recipe it can actually run.
  const usable = availableRecipes(instance)
  if (usable.length > 0) instance.activeRecipeId = usable[0].id

  s.buildings[id] = instance
  s.tiles[tileKey].buildingId = id
  return null
}

export function demolishBuilding(s: RunState, buildingId: string): ActionError {
  const building = s.buildings[buildingId]
  if (!building) return 'No such building.'
  const def = BUILDINGS[building.defId]
  if (def?.category === 'hearth') return 'The hearth cannot be dismantled.'

  for (const workerId of [...building.workers]) unassign(s, workerId)

  // Half the materials come back, rounded down.
  const refund: ResourceBag = {}
  for (const [id, amount] of Object.entries(def?.cost ?? {}) as [ResourceId, number][]) {
    const qty = Math.floor((amount ?? 0) / 2)
    if (qty > 0) refund[id] = qty
  }
  grant(s.stock, refund, s.storageCap, storageUsed(s))

  delete s.tiles[building.tile].buildingId
  delete s.buildings[buildingId]
  return null
}

// ---------------------------------------------------------------------------
// Workers
// ---------------------------------------------------------------------------

/**
 * Assigns the best available villager. "Best" means the largest species work
 * bonus for the building's tags, so one-click staffing does the sensible thing.
 */
export function assignWorker(
  s: RunState,
  buildingId: string,
  villagerId?: string,
): ActionError {
  const building = s.buildings[buildingId]
  if (!building) return 'No such building.'
  const def = BUILDINGS[building.defId]
  if (!def) return 'No such building.'
  if (def.workerSlots <= 0) return 'This building needs no workers.'
  if (building.workers.length >= def.workerSlots) return 'All slots are full.'

  let chosen = villagerId ? s.villagers[villagerId] : undefined
  if (chosen && chosen.assignment !== null) return `${chosen.name} is already busy.`

  if (!chosen) {
    const idle = idleVillagers(s)
    if (idle.length === 0) return 'No idle villagers.'
    chosen = idle.reduce((best, v) => (bonusFor(v.species, def.tags) > bonusFor(best.species, def.tags) ? v : best))
  }

  chosen.assignment = buildingId
  building.workers.push(chosen.id)
  return null
}

function bonusFor(species: keyof typeof SPECIES, tags: string[]): number {
  const bonuses = SPECIES[species].workBonus as Record<string, number | undefined>
  let sum = 0
  for (const tag of tags) sum += bonuses[tag] ?? 0
  return sum
}

export function removeWorker(
  s: RunState,
  buildingId: string,
  villagerId?: string,
): ActionError {
  const building = s.buildings[buildingId]
  if (!building) return 'No such building.'
  const target = villagerId ?? building.workers[building.workers.length - 1]
  if (!target) return 'Nobody works here.'
  unassign(s, target)
  return null
}

export function setRecipe(s: RunState, buildingId: string, recipeId: string): ActionError {
  const building = s.buildings[buildingId]
  if (!building) return 'No such building.'
  const def = BUILDINGS[building.defId]
  if (!def?.recipes.some((r) => r.id === recipeId)) return 'Unknown recipe.'
  if (building.activeRecipeId === recipeId) return null
  building.activeRecipeId = recipeId
  // Switching product loses banked work — same rule as the real thing.
  building.recipeProgress = 0
  return null
}

export function togglePause(s: RunState, buildingId: string): ActionError {
  const building = s.buildings[buildingId]
  if (!building) return 'No such building.'
  building.paused = !building.paused
  return null
}

// ---------------------------------------------------------------------------
// Glade clearing
// ---------------------------------------------------------------------------

export function addClearer(s: RunState, gladeId: string): ActionError {
  const glade = s.glades[gladeId]
  if (!glade) return 'No such glade.'
  if (glade.cleared) return 'Already cleared.'
  if (!isReachable(s, gladeId)) return 'Clear an adjacent glade first.'
  const idle = idleVillagers(s)
  if (idle.length === 0) return 'No idle villagers.'
  // Send the best axe first — harpies and pathfinders clear faster.
  const villager = idle.reduce((best, v) =>
    clearMultiplier(v) > clearMultiplier(best) ? v : best,
  )
  villager.assignment = `clearing:${gladeId}`
  glade.clearers++
  return null
}

export function removeClearer(s: RunState, gladeId: string): ActionError {
  const glade = s.glades[gladeId]
  if (!glade) return 'No such glade.'
  const worker = Object.values(s.villagers).find(
    (v) => v.assignment === `clearing:${gladeId}`,
  )
  if (!worker) return 'Nobody is clearing there.'
  unassign(s, worker.id)
  return null
}

/** A glade can be worked only if it borders one you already hold. */
export function isReachable(s: RunState, gladeId: string): boolean {
  const glade = s.glades[gladeId]
  if (!glade) return false
  return glade.neighbors.some((id) => s.glades[id]?.cleared)
}

// ---------------------------------------------------------------------------
// Amber sinks
// ---------------------------------------------------------------------------

/** Amber to finish a construction site on the spot. */
export function rushCost(s: RunState, buildingId: string): number {
  const building = s.buildings[buildingId]
  const def = building ? BUILDINGS[building.defId] : undefined
  if (!building || !def || building.built) return 0
  const remaining = Math.max(0, def.buildSeconds - building.buildProgress)
  return Math.max(5, Math.ceil(remaining * RUSH_COST_PER_SECOND))
}

/** Pays amber to finish a site immediately — the classic impatience lever. */
export function rushConstruction(s: RunState, buildingId: string): ActionError {
  const building = s.buildings[buildingId]
  if (!building) return 'No such building.'
  if (building.built) return 'Already finished.'
  const cost = rushCost(s, buildingId)
  if ((s.stock.amber ?? 0) < cost) return 'Not enough amber.'
  const def = BUILDINGS[building.defId]
  spend(s.stock, { amber: cost })
  building.built = true
  building.buildProgress = def?.buildSeconds ?? building.buildProgress
  s.stats.buildingsBuilt++
  if (def?.gatherRadius) {
    building.depositsInRange = depositsInRangeOf(s, building.tile, def.gatherRadius)
  }
  pushLog(s, `${def?.name ?? 'A building'} rushed for ${cost} amber.`, 'info')
  return null
}

/** Amber cost of the next petition to the Queen — it steepens with use. */
export function sootheCost(s: RunState): number {
  return SOOTHE_BASE_COST + s.soothesUsed * SOOTHE_COST_GROWTH
}

/** Buys back a point of the Queen's patience. */
export function sootheQueen(s: RunState): ActionError {
  if (s.impatience < 1) return 'The Queen is not impatient.'
  const cost = sootheCost(s)
  if ((s.stock.amber ?? 0) < cost) return 'Not enough amber.'
  spend(s.stock, { amber: cost })
  s.impatience = Math.max(0, s.impatience - 1)
  s.soothesUsed++
  pushLog(s, `A gift of ${cost} amber reaches the Citadel. The Queen is soothed.`, 'good')
  return null
}

/** Villagers can be pulled off everything at once — useful before a storm. */
export function recallEveryone(s: RunState): void {
  for (const v of Object.values(s.villagers)) {
    if (v.assignment) unassign(s, v.id)
  }
}
