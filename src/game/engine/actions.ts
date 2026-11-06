import { BUILDINGS } from '../content/buildings'
import { RESOURCES } from '../content/resources'
import { SPECIES } from '../content/species'
import type {
  BuildingInstance,
  DepositId,
  ResourceBag,
  ResourceId,
  RunState,
  Vec2,
} from '../types'
import {
  BUILDING_GAP,
  DEMOLISH_REFUND_BUILT,
  FOOTPRINT_RADIUS,
  RUSH_COST_PER_SECOND,
  SOOTHE_BASE_COST,
  SOOTHE_COST_GROWTH,
} from './balance'
import { pushLog } from './runLog'
import { dist } from './geometry'
import { gladeAt, insideWorld } from './mapgen'
import { completeUpgrade, depositsInRangeOf } from './production'
import {
  availableRecipes,
  canAfford,
  grant,
  idleVillagers,
  spend,
  storageUsed,
} from './queries'
import { invalidateRoadNetwork } from './roads'
import { unassign } from './society'
import { clearMultiplier } from './traits'
import {
  displayName,
  gatherRadiusOf,
  isUpgrading,
  maxTier,
  nextUpgrade,
  recipesOf,
  tierName,
  tierOf,
  workerSlotsOf,
} from './upgrades'

/** Player commands. Each returns `null` on success or a reason for failure. */
export type ActionError = string | null

// ---------------------------------------------------------------------------
// Building placement
// ---------------------------------------------------------------------------

/** Footprint radius for a building def: its own override, else its category's. */
export function footprintOf(defId: string): number {
  const def = BUILDINGS[defId]
  return def ? (def.footprint ?? FOOTPRINT_RADIUS[def.category]) : 0.6
}

export function canPlaceBuilding(s: RunState, defId: string, pos: Vec2): ActionError {
  const def = BUILDINGS[defId]
  if (!def) return 'Unknown building.'
  if (!s.unlockedBuildings.includes(defId)) return 'You do not have this blueprint.'
  const radius = footprintOf(defId)
  if (!insideWorld(s.world, pos, radius)) return 'Beyond the forest edge.'
  const glade = gladeAt(s.glades, pos)
  if (!glade?.cleared) return 'That ground has not been cleared.'
  for (const obstacle of s.obstacles) {
    if (dist(pos, obstacle.pos) < radius + obstacle.radius) {
      return 'The ground will not take a foundation.'
    }
  }
  for (const deposit of Object.values(s.deposits)) {
    if (dist(pos, deposit.pos) < radius + deposit.radius) {
      return 'A deposit is in the way — build beside it.'
    }
  }
  for (const other of Object.values(s.buildings)) {
    if (dist(pos, other.pos) < radius + footprintOf(other.defId) + BUILDING_GAP) {
      return 'Too close to another building.'
    }
  }
  if (def.unique && Object.values(s.buildings).some((b) => b.defId === defId)) {
    return `You may only have one ${def.name}.`
  }
  if (!canAfford(s.stock, def.cost)) return 'Not enough materials.'
  if (def.gatherRadius) {
    const deposits = depositsInRangeOf(s, pos, def.gatherRadius)
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

export function placeBuilding(s: RunState, defId: string, pos: Vec2): ActionError {
  const error = canPlaceBuilding(s, defId, pos)
  if (error) return error
  const def = BUILDINGS[defId]
  spend(s.stock, def.cost)

  const id = `b${Object.keys(s.buildings).length}_${Math.round(s.clock * 100)}`
  const instance: BuildingInstance = {
    id,
    defId,
    pos: { x: pos.x, y: pos.y },
    gladeId: gladeAt(s.glades, pos)?.id ?? 'glade0',
    built: def.buildSeconds <= 0,
    buildProgress: 0,
    workers: [],
    activeRecipeId: def.recipes[0]?.id ?? '',
    recipeProgress: 0,
    paused: false,
    tier: 0,
    depositsInRange: def.gatherRadius
      ? depositsInRangeOf(s, pos, def.gatherRadius)
      : {},
  }
  // Default a gathering camp to a recipe it can actually run.
  const usable = availableRecipes(instance)
  if (usable.length > 0) instance.activeRecipeId = usable[0].id

  s.buildings[id] = instance
  invalidateRoadNetwork(s)
  return null
}

/**
 * Finds a legal position for a building: rings of candidate points spiralling
 * out from each anchor. Camps anchor on the deposits they need; everything
 * else packs in around the hearth. Used by the balance bot, the tests, and
 * the "find a spot" UI helper — a competent-but-not-clever placement.
 */
export function findPlacement(s: RunState, defId: string, near?: Vec2): Vec2 | null {
  const def = BUILDINGS[defId]
  if (!def) return null
  const hearth = Object.values(s.buildings).find(
    (b) => BUILDINGS[b.defId]?.category === 'hearth',
  )
  const home = hearth?.pos ?? { x: 0, y: 0 }

  const anchors: Vec2[] = []
  if (near) anchors.push(near)
  else {
    const needed = new Set(
      def.recipes.map((r) => r.requiresDeposit).filter((d): d is DepositId => d !== undefined),
    )
    if (def.gatherRadius && needed.size > 0) {
      const usable = Object.values(s.deposits)
        .filter(
          (d) =>
            needed.has(d.kind) &&
            s.glades[d.gladeId]?.cleared &&
            (d.amount === null || d.amount > 0),
        )
        .sort((a, b) => dist(a.pos, home) - dist(b.pos, home))
      if (usable.length === 0) return null
      anchors.push(...usable.slice(0, 4).map((d) => d.pos))
    } else {
      anchors.push(home)
    }
  }

  const step = 0.5
  for (const anchor of anchors) {
    const maxRing = Math.ceil((def.gatherRadius ?? 8) / step)
    for (let ring = 1; ring <= maxRing; ring++) {
      const r = ring * step
      const count = Math.max(6, Math.ceil((2 * Math.PI * r) / step))
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + ring * 0.7
        const pos = { x: anchor.x + Math.cos(angle) * r, y: anchor.y + Math.sin(angle) * r }
        if (canPlaceBuilding(s, defId, pos) === null) return pos
      }
    }
  }
  return null
}

type RefundSubject = Pick<BuildingInstance, 'defId' | 'built' | 'buildProgress'> &
  Partial<Pick<BuildingInstance, 'tier' | 'upgradeProgress'>>

/**
 * Share of the cost a building returns when it comes down: all of it while
 * nobody has worked on the site, sliding to `DEMOLISH_REFUND_BUILT` as
 * construction progresses, and that share once it stands.
 */
export function demolishRefundShare(building: RefundSubject): number {
  if (building.built) return DEMOLISH_REFUND_BUILT
  const seconds = BUILDINGS[building.defId]?.buildSeconds ?? 0
  if (seconds <= 0 || building.buildProgress <= 0) return 1
  const done = Math.min(1, building.buildProgress / seconds)
  return 1 - (1 - DEMOLISH_REFUND_BUILT) * done
}

/**
 * Materials handed back when a building is torn down, rounded down. A bare
 * definition id means a finished building.
 */
/** Adds `share` of each cost entry to `into`, rounding down per resource. */
function addShare(into: Record<string, number>, cost: ResourceBag, share: number): void {
  for (const [id, amount] of Object.entries(cost)) {
    into[id] = (into[id] ?? 0) + (amount ?? 0) * share
  }
}

/**
 * Materials a building has cost so far: its base cost, every finished upgrade
 * tier, and the tier currently under way (paid in full when it was started).
 */
export function demolishSpent(building: RefundSubject): ResourceBag {
  const def = BUILDINGS[building.defId]
  const tiers = def?.upgrades ?? []
  const done = Math.min(building.tier ?? 0, tiers.length)
  const total: Record<string, number> = {}
  addShare(total, def?.cost ?? {}, 1)
  for (let i = 0; i < done; i++) addShare(total, tiers[i].cost, 1)
  if (building.built && building.upgradeProgress !== undefined && tiers[done]) {
    addShare(total, tiers[done].cost, 1)
  }
  return total as ResourceBag
}

/**
 * What tearing a building down returns. The base cost follows
 * `demolishRefundShare`; every finished upgrade tier returns
 * `DEMOLISH_REFUND_BUILT` like a finished building; and an upgrade still in
 * progress slides from a full refund (no work done) down to that share, the
 * same rule a construction site follows.
 */
export function demolishRefund(building: string | RefundSubject): ResourceBag {
  const raw = refundBeforeRounding(building)
  const refund: ResourceBag = {}
  for (const [id, amount] of Object.entries(raw)) {
    // The epsilon keeps a share like 0.7 × 10 from flooring to 6.
    const qty = Math.floor(amount + 1e-9)
    if (qty > 0) refund[id as ResourceId] = qty
  }
  return refund
}

/**
 * The refund as a share of everything spent on the building (0..1), before
 * per-resource rounding — the rule's share, which is what the UI states.
 */
export function demolishRefundPercent(building: RefundSubject): number {
  const total = (bag: Record<string, number | undefined>) =>
    Object.values(bag).reduce<number>((a, n) => a + (n ?? 0), 0)
  const spent = total(demolishSpent(building))
  return spent > 0 ? total(refundBeforeRounding(building)) / spent : 0
}

function refundBeforeRounding(building: string | RefundSubject): Record<string, number> {
  const subject: RefundSubject =
    typeof building === 'string' ? { defId: building, built: true, buildProgress: 0 } : building
  const def = BUILDINGS[subject.defId]
  const tiers = def?.upgrades ?? []
  const done = Math.min(subject.tier ?? 0, tiers.length)
  const raw: Record<string, number> = {}
  addShare(raw, def?.cost ?? {}, demolishRefundShare(subject))
  for (let i = 0; i < done; i++) addShare(raw, tiers[i].cost, DEMOLISH_REFUND_BUILT)
  const pending = tiers[done]
  if (subject.built && subject.upgradeProgress !== undefined && pending) {
    const progress =
      pending.buildSeconds > 0 ? Math.min(1, subject.upgradeProgress / pending.buildSeconds) : 1
    addShare(raw, pending.cost, 1 - (1 - DEMOLISH_REFUND_BUILT) * progress)
  }
  return raw
}

export function demolishBuilding(s: RunState, buildingId: string): ActionError {
  const building = s.buildings[buildingId]
  if (!building) return 'No such building.'
  const def = BUILDINGS[building.defId]
  if (def?.category === 'hearth') return 'The hearth cannot be dismantled.'

  for (const workerId of [...building.workers]) unassign(s, workerId)

  grant(s.stock, demolishRefund(building), s.storageCap, storageUsed(s))

  delete s.buildings[buildingId]
  invalidateRoadNetwork(s)
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
  const slots = workerSlotsOf(building)
  if (slots <= 0) return 'This building needs no workers.'
  if (building.workers.length >= slots) return 'All slots are full.'

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
  // Recipes unlocked by an upgrade tier count once that tier is reached.
  if (!recipesOf(building).some((r) => r.id === recipeId)) return 'Unknown recipe.'
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

/** Amber to finish a construction site — or an upgrade under way — on the spot. */
export function rushCost(s: RunState, buildingId: string): number {
  const building = s.buildings[buildingId]
  const def = building ? BUILDINGS[building.defId] : undefined
  if (!building || !def) return 0
  let remaining: number
  if (!building.built) {
    remaining = Math.max(0, def.buildSeconds - building.buildProgress)
  } else {
    const upgrade = nextUpgrade(building)
    if (!upgrade || !isUpgrading(building)) return 0
    remaining = Math.max(0, upgrade.buildSeconds - (building.upgradeProgress ?? 0))
  }
  return Math.max(5, Math.ceil(remaining * RUSH_COST_PER_SECOND))
}

/** Pays amber to finish a site immediately — the classic impatience lever. */
export function rushConstruction(s: RunState, buildingId: string): ActionError {
  const building = s.buildings[buildingId]
  if (!building) return 'No such building.'
  if (building.built && !isUpgrading(building)) return 'Already finished.'
  const cost = rushCost(s, buildingId)
  if ((s.stock.amber ?? 0) < cost) return 'Not enough amber.'
  const def = BUILDINGS[building.defId]
  if (building.built) {
    // Rushing an upgrade: the next tier stands at once.
    spend(s.stock, { amber: cost })
    completeUpgrade(s, building)
    pushLog(s, `${displayName(building)} rushed for ${cost} amber.`, 'info')
    return null
  }
  spend(s.stock, { amber: cost })
  building.built = true
  building.buildProgress = def?.buildSeconds ?? building.buildProgress
  s.stats.buildingsBuilt++
  const radius = gatherRadiusOf(building)
  if (radius) building.depositsInRange = depositsInRangeOf(s, building.pos, radius)
  pushLog(s, `${def?.name ?? 'A building'} rushed for ${cost} amber.`, 'info')
  return null
}

// ---------------------------------------------------------------------------
// Upgrades
// ---------------------------------------------------------------------------

/** Why a building cannot start its next upgrade right now, or null if it can. */
export function canUpgradeBuilding(s: RunState, buildingId: string): ActionError {
  const building = s.buildings[buildingId]
  if (!building) return 'No such building.'
  const def = BUILDINGS[building.defId]
  if (!def) return 'No such building.'
  if (maxTier(building.defId) === 0) return `The ${def.name} cannot be upgraded.`
  if (!building.built) return 'Finish building it first.'
  if (isUpgrading(building)) return 'An upgrade is already under way.'
  const upgrade = nextUpgrade(building)
  if (!upgrade) return `The ${displayName(building)} is fully upgraded.`
  if (!canAfford(s.stock, upgrade.cost)) return 'Not enough materials.'
  return null
}

/**
 * Starts raising a building to its next tier: pays the materials and opens an
 * upgrade site that idle builders work like any construction. The building
 * keeps working at its current tier until the upgrade completes, so a venue
 * never drops its coverage and no worker has to be shuffled off it.
 */
export function upgradeBuilding(s: RunState, buildingId: string): ActionError {
  const error = canUpgradeBuilding(s, buildingId)
  if (error) return error
  const building = s.buildings[buildingId]
  const upgrade = nextUpgrade(building)!
  spend(s.stock, upgrade.cost)
  building.tier = tierOf(building)
  building.upgradeProgress = 0
  pushLog(
    s,
    `Builders begin raising the ${displayName(building)} into a ${tierName(building.defId, tierOf(building) + 1)}.`,
    'info',
  )
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

// ---------------------------------------------------------------------------
// Stockpile
// ---------------------------------------------------------------------------

/** Units thrown out per press of "dump". */
export const DUMP_LOT = 20

/**
 * Throws `amount` of a good out of the stockpile (at most what is there), to
 * make room when the store is full of something nobody needs. Amber takes no
 * space and cannot be dumped. Returns an error, or null on success.
 */
export function dumpStock(s: RunState, resource: ResourceId, amount: number = DUMP_LOT): ActionError {
  if (resource === 'amber') return 'Amber takes no room in the stockpile.'
  const have = Math.floor(s.stock[resource] ?? 0)
  const qty = Math.min(have, Math.max(0, Math.floor(amount)))
  if (qty <= 0) return 'There is none to dump.'
  spend(s.stock, { [resource]: qty })
  pushLog(s, `${qty} ${RESOURCES[resource]?.name ?? resource} dumped to make room in the stockpile.`, 'info')
  return null
}

/** Villagers can be pulled off everything at once — useful before a storm. */
export function recallEveryone(s: RunState): void {
  for (const v of Object.values(s.villagers)) {
    if (v.assignment) unassign(s, v.id)
  }
}
