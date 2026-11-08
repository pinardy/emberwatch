import { BUILDINGS } from '../../content/buildings'
import type { BuildingInstance, DepositId, RunState, Vec2 } from '../../types'
import { findPlacement, placeBuilding, setRecipe } from '../actions'
import { DEPOSIT_INFO, gladeAt } from '../mapgen'
import { hasLiveDeposit } from '../production'
import { canAfford, population, terrainWarmsHomes } from '../queries'
import { recipesOf } from '../upgrades'

/*
 * The bot's play on the map's layouts and biomes (`content/layouts.ts`),
 * kept apart from its general play in `play.ts`. Nothing here does anything
 * on the rings in the old woodland, so a run on today's map plays exactly as
 * it did:
 *
 *  - warm ground (the Cinderwood's ash): once the hearth's warm ring is
 *    full, homes go up on the ash instead of out in the cold;
 *  - a biome's or layout's own deposits (deadfall, fireweed, tumbled
 *    stonework): a camp in reach of one works it with the recipe made for it,
 *    which out-yields the plain one, and goes back to the plain one when it
 *    is worked out;
 *  - the ruins' salvage: one Stonecutters' Camp on the stonework, for the
 *    bricks the venues are priced in.
 *
 * River and ridge need nothing of their own: a barrier only changes which
 * glades are reachable, and the bot's clearing already follows that.
 */

/** The deposits only a biome or a layout has (they carry a note saying so). */
function isLocalDeposit(kind: DepositId): boolean {
  return !!DEPOSIT_INFO[kind].note
}

/** Whether `recipeId` can run on this building now (its deposit is in reach). */
export function canRunRecipe(s: RunState, b: BuildingInstance, recipeId: string): boolean {
  const recipe = recipesOf(b).find((r) => r.id === recipeId)
  if (!recipe) return false
  return !recipe.requiresDeposit || hasLiveDeposit(s, b, recipe.requiresDeposit)
}

/**
 * True while a camp runs the recipe made for a local deposit in its reach:
 * the general recipe tuning leaves it be (it out-yields the plain recipes).
 */
export function keepsLocalRecipe(s: RunState, b: BuildingInstance): boolean {
  const recipe = recipesOf(b).find((r) => r.id === b.activeRecipeId)
  return !!recipe?.requiresDeposit && isLocalDeposit(recipe.requiresDeposit) && canRunRecipe(s, b, recipe.id)
}

/**
 * Sets every camp in reach of a local deposit to its recipe (resin tapping
 * excepted: that is wanted for its own chain), and any camp whose recipe has
 * lost its deposit to one that can still run.
 */
export function tuneTerrainRecipes(s: RunState): void {
  for (const b of Object.values(s.buildings)) {
    if (!b.built || !BUILDINGS[b.defId]?.gatherRadius) continue
    const recipes = recipesOf(b)
    const local = recipes.find(
      (r) => r.requiresDeposit && isLocalDeposit(r.requiresDeposit) && canRunRecipe(s, b, r.id),
    )
    if (local && b.activeRecipeId !== local.id && b.activeRecipeId !== 'resin') {
      setRecipe(s, b.id, local.id)
      continue
    }
    if (canRunRecipe(s, b, b.activeRecipeId)) continue
    const fallback = recipes.find((r) => canRunRecipe(s, b, r.id))
    if (fallback) setRecipe(s, b.id, fallback.id)
  }
}

/** A cleared glade of warm ground with room for a home, nearest the hearth first. */
function warmGroundSpot(s: RunState, defId: string): Vec2 | null {
  const glades = Object.values(s.glades)
    .filter((g) => g.cleared && terrainWarmsHomes(g.terrain))
    .sort((a, b) => Math.hypot(a.center.x, a.center.y) - Math.hypot(b.center.x, b.center.y))
  for (const glade of glades) {
    const pos = findPlacement(s, defId, glade.center)
    if (pos && gladeAt(s.glades, pos)?.id === glade.id) return pos
  }
  return null
}

/**
 * Out of warm beds by the hearth: a home on warm ground (the Cinderwood's
 * ash) stays warm through every Storm, so it goes there rather than into the
 * cold. False on any map without warm ground.
 */
export function warmGroundHome(s: RunState): boolean {
  for (const defId of ['cabin', 'shelter']) {
    if (!s.unlockedBuildings.includes(defId) || !canAfford(s.stock, BUILDINGS[defId].cost)) continue
    const pos = warmGroundSpot(s, defId)
    if (pos && placeBuilding(s, defId, pos) === null) return true
  }
  return false
}

/**
 * The ruins' salvage: a Stonecutters' Camp on tumbled stonework is a source
 * of bricks before any brickyard, so one goes up there once the settlement
 * can staff it. False where there is no salvage in reach.
 */
export function salvageCamp(s: RunState): boolean {
  if (population(s) < 8) return false
  const defId = 'stonecuttersCamp'
  if (!s.unlockedBuildings.includes(defId) || !canAfford(s.stock, BUILDINGS[defId].cost)) return false
  const salvaging = Object.values(s.buildings).some(
    (b) => b.defId === defId && (b.activeRecipeId === 'salvage' || canRunRecipe(s, b, 'salvage')),
  )
  if (salvaging) return false
  const site = Object.values(s.deposits).find(
    (d) => d.kind === 'ruins' && s.glades[d.gladeId]?.cleared && (d.amount ?? 0) > 4,
  )
  if (!site) return false
  const pos = findPlacement(s, defId, site.pos)
  return !!pos && placeBuilding(s, defId, pos) === null
}
