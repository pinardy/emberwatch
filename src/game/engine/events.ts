import { BLUEPRINT_POOL, BUILDINGS, BUILDING_LIST } from '../content/buildings'
import { CORNERSTONE_LIST, CORNERSTONES, RARITY_WEIGHTS } from '../content/cornerstones'
import { GLADE_EVENTS } from '../content/gladeEvents'
import { ORDERS, describeGoal, evaluateGoal } from '../content/orders'
import { SPECIES, villagerName } from '../content/species'
import type { RunState, ServiceNeed } from '../types'
import {
  CLEAR_RATE_PER_VILLAGER,
  GLADES_PER_REPUTATION,
  HOSTILITY_PER_GLADE_CLEARED,
  REWARD_MILESTONES,
} from './balance'
import { drawOrder, pushLog } from './createRun'
import type { Modifiers } from './modifiers'
import { refreshDepositCaches } from './production'
import { canAfford, grant, population, spend, storageUsed } from './queries'
import { makeRng } from './rng'
import { addImpatience, addReputation, removeVillager, unassign } from './society'

/** Advances any glade with villagers assigned to clearing it. */
export function stepClearing(s: RunState, dt: number, mods: Modifiers): void {
  for (const glade of Object.values(s.glades)) {
    if (glade.cleared || glade.clearers <= 0) continue
    glade.clearProgress += glade.clearers * CLEAR_RATE_PER_VILLAGER * mods.clearSpeed * dt
    if (glade.clearProgress < glade.clearWork) continue

    // --- glade taken ------------------------------------------------------
    glade.cleared = true
    glade.clearProgress = glade.clearWork
    s.stats.gladesCleared++

    // Send the clearing crew back to the idle pool.
    for (const v of Object.values(s.villagers)) {
      if (v.assignment === `clearing:${glade.id}`) unassign(s, v.id)
    }
    glade.clearers = 0

    for (const id of glade.neighbors) s.glades[id].discovered = true
    glade.discovered = true

    const added = grant(s.stock, glade.reward, s.storageCap, storageUsed(s))
    s.stats.resourcesProduced += added
    s.hostility += HOSTILITY_PER_GLADE_CLEARED

    refreshDepositCaches(s)

    pushLog(s, `${glade.name} has been cleared. The forest pushes back.`, 'good')

    /*
     * Reclaimed land is what the Queen actually sent you for, so expansion pays
     * reputation as well as costing hostility. Without this, clearing is a pure
     * downside once you have the deposits you need, and the run has no engine
     * other than waiting for resolve to tick over.
     */
    if (s.stats.gladesCleared % GLADES_PER_REPUTATION === 0) {
      addReputation(s, 1)
      pushLog(s, `The Citadel notes your reclaimed land. +1 reputation.`, 'good')
    }

    if (glade.eventId) {
      s.pendingChoices.push({
        kind: 'gladeEvent',
        options: [glade.eventId],
        gladeId: glade.id,
      })
    }
  }
}

/** Applies the chosen option of the front-of-queue glade event. */
export function resolveGladeEvent(s: RunState, optionIndex: number): void {
  const choice = s.pendingChoices[0]
  if (!choice || choice.kind !== 'gladeEvent') return
  const def = GLADE_EVENTS[choice.options[0]]
  const option = def?.options[optionIndex]
  if (!def || !option) return
  if (option.requires && !canAfford(s.stock, option.requires)) return

  if (option.cost) spend(s.stock, option.cost)
  if (option.gain) {
    const added = grant(s.stock, option.gain, s.storageCap, storageUsed(s))
    s.stats.resourcesProduced += added
  }
  if (option.hostility) s.hostility = Math.max(0, s.hostility + option.hostility)
  if (option.impatience) addImpatience(s, option.impatience)
  if (option.reputation) addReputation(s, option.reputation)
  if (option.villagerLoss) {
    for (let i = 0; i < option.villagerLoss; i++) {
      const victim = Object.values(s.villagers)[0]
      if (!victim) break
      removeVillager(s, victim.id)
      s.stats.villagersLost++
    }
  }

  // "Stragglers' Camp" style options that bring people with them.
  if (def.id === 'stragglersCamp' && optionIndex === 0) {
    for (let i = 0; i < 3; i++) addVillager(s)
  }

  pushLog(s, `${def.name}: ${option.label}.`, option.hostility && option.hostility > 0 ? 'bad' : 'info')
  s.pendingChoices.shift()
}

/** Adds a villager of a random species from the run's pool. */
export function addVillager(s: RunState): string | null {
  const rng = makeRng(s.seed, s.rngCursor)
  const species = rng.pick(s.speciesPool)
  s.rngCursor = rng.cursor()
  const index = Object.keys(s.villagers).length + s.stats.villagersLost
  const id = `v${index}_${s.clock.toFixed(0)}`
  s.villagers[id] = {
    id,
    species,
    name: villagerName(index),
    assignment: null,
  }
  return id
}

// ---------------------------------------------------------------------------
// Reputation milestones
// ---------------------------------------------------------------------------

/**
 * Reputation milestones alternate cornerstone and blueprint picks, which keeps
 * the run feeling like it is compounding in two directions at once.
 */
export function checkMilestones(s: RunState): void {
  const reached = REWARD_MILESTONES.filter((m) => s.reputation >= m).length
  while (s.cornerstonesTaken < reached) {
    const index = s.cornerstonesTaken
    s.cornerstonesTaken++
    // Lead with a blueprint: early on, options matter more than multipliers.
    if (index % 2 === 0) offerBlueprint(s)
    else offerCornerstone(s)
  }
}

export function offerCornerstone(s: RunState): void {
  const rng = makeRng(s.seed, s.rngCursor)
  const pool = CORNERSTONE_LIST.filter((c) => !s.cornerstones.includes(c.id))
  const options: string[] = []
  const remaining = [...pool]
  for (let i = 0; i < 3 && remaining.length > 0; i++) {
    const pickDef = rng.weighted(remaining, (c) => RARITY_WEIGHTS[c.rarity])
    options.push(pickDef.id)
    remaining.splice(remaining.indexOf(pickDef), 1)
  }
  s.rngCursor = rng.cursor()
  if (options.length === 0) return
  s.pendingChoices.push({ kind: 'cornerstone', options })
}

/**
 * Buildings that would move the settlement toward satisfying a service its
 * residents actually want — either the venue itself or, once that is unlocked,
 * something that produces the goods it hands out.
 *
 * Derived from the building data rather than a hand-written table, so adding a
 * service or a recipe automatically feeds into the draft.
 */
export function relevantBlueprints(s: RunState): string[] {
  const present = [...new Set(Object.values(s.villagers).map((v) => v.species))]

  // How many residents care about each need — a venue that serves two species
  // is worth more than one that serves a single villager.
  const demand = new Map<ServiceNeed, number>()
  for (const sp of present) {
    for (const need of SPECIES[sp].needs) {
      demand.set(need, (demand.get(need) ?? 0) + 1)
    }
  }

  const ordered = [...demand.entries()].sort((a, b) => b[1] - a[1]).map(([need]) => need)

  const missingVenue: string[] = []
  const missingSupply: string[] = []

  for (const need of ordered) {
    const venues = BUILDING_LIST.filter((b) => b.service?.need === need)
    const unlockedVenue = venues.find((v) => s.unlockedBuildings.includes(v.id))
    if (!unlockedVenue) {
      for (const v of venues) missingVenue.push(v.id)
      continue
    }
    // Venue is available; make sure something can supply the goods it hands out.
    for (const good of Object.keys(unlockedVenue.recipes[0]?.inputs ?? {})) {
      const producers = BUILDING_LIST.filter((b) =>
        b.recipes.some((r) => ((r.outputs as Record<string, number>)[good] ?? 0) > 0),
      )
      if (producers.some((p) => s.unlockedBuildings.includes(p.id))) continue
      for (const p of producers) missingSupply.push(p.id)
    }
  }

  /*
   * Finishing a chain beats starting another. A venue with nothing to hand out
   * is a wasted villager, so an unlocked-but-unsupplied service is the most
   * valuable thing the next draft can fix.
   */
  return [...missingSupply, ...missingVenue].filter(
    (id) => !s.unlockedBuildings.includes(id) && BLUEPRINT_POOL.includes(id),
  )
}

/**
 * Three blueprint options: one guaranteed to advance a service the settlement
 * actually wants (so a draft can never leave you unable to raise resolve), plus
 * two at random for variety.
 */
function buildBlueprintOptions(s: RunState): string[] {
  const rng = makeRng(s.seed, s.rngCursor)
  const pool = BLUEPRINT_POOL.filter((id) => !s.unlockedBuildings.includes(id))
  if (pool.length === 0) {
    s.rngCursor = rng.cursor()
    return []
  }
  // `relevantBlueprints` is priority-ordered, so take from the front.
  const relevant = relevantBlueprints(s)
  const options: string[] = []
  if (relevant.length > 0) options.push(relevant[0])
  for (const id of rng.shuffle(pool)) {
    if (options.length >= 3) break
    if (!options.includes(id)) options.push(id)
  }
  s.rngCursor = rng.cursor()
  return options
}

export function offerBlueprint(s: RunState): void {
  const options = buildBlueprintOptions(s)
  if (options.length === 0) {
    // Nothing left to unlock — hand out a cornerstone instead.
    offerCornerstone(s)
    return
  }
  s.pendingChoices.push({ kind: 'blueprint', options })
}

export function takeChoice(s: RunState, optionId: string): void {
  const choice = s.pendingChoices[0]
  if (!choice) return
  if (choice.kind === 'cornerstone') {
    if (!choice.options.includes(optionId)) return
    if (s.cornerstones.includes(optionId)) return
    s.cornerstones.push(optionId)
    pushLog(s, `Cornerstone laid: ${CORNERSTONES[optionId]?.name ?? optionId}.`, 'good')
  } else if (choice.kind === 'blueprint') {
    if (!choice.options.includes(optionId)) return
    if (!s.unlockedBuildings.includes(optionId)) s.unlockedBuildings.push(optionId)
    pushLog(s, `Blueprint acquired: ${BUILDINGS[optionId]?.name ?? optionId}.`, 'good')
  } else {
    return
  }
  s.pendingChoices.shift()
  refreshQueuedChoices(s)
}

/**
 * Re-rolls the options of any *still queued* draft.
 *
 * Drafts can be queued several deep — the opening draft is three picks, and a
 * milestone can land while one is open. Their options were computed before the
 * player chose, so without this the same building is offered (and granted) twice
 * and half a service chain never appears.
 */
function refreshQueuedChoices(s: RunState): void {
  const stale = s.pendingChoices
  for (let i = 0; i < stale.length; i++) {
    const choice = stale[i]
    if (choice.kind === 'blueprint') {
      const fresh = buildBlueprintOptions(s)
      if (fresh.length === 0) {
        // Nothing left to draft — swap in a cornerstone offer instead.
        stale.splice(i, 1)
        offerCornerstone(s)
        i--
        continue
      }
      choice.options = fresh
    } else if (choice.kind === 'cornerstone') {
      choice.options = choice.options.filter((id) => !s.cornerstones.includes(id))
      if (choice.options.length === 0) {
        stale.splice(i, 1)
        i--
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export function stepOrders(s: RunState): void {
  let completedAny = false
  for (const order of s.orders) {
    if (order.complete) continue
    const def = ORDERS[order.defId]
    if (!def) continue
    order.progress = evaluateGoal(def.goal, s)
    if (order.progress >= 1) {
      order.complete = true
      completedAny = true
      s.stats.ordersCompleted++
      addReputation(s, def.reputationReward)
      if (def.reward) {
        const added = grant(s.stock, def.reward, s.storageCap, storageUsed(s))
        s.stats.resourcesProduced += added
      }
      pushLog(
        s,
        `Order complete — ${describeGoal(def.goal)}. +${def.reputationReward} reputation.`,
        'good',
      )
    }
  }
  if (completedAny) {
    // Retire completed orders and top the list back up to three.
    s.orders = s.orders.filter((o) => !o.complete)
    while (s.orders.length < 3) {
      if (!drawOrder(s)) break
    }
  }
}

// ---------------------------------------------------------------------------
// Newcomers
// ---------------------------------------------------------------------------

export function stepNewcomers(
  s: RunState,
  dt: number,
  interval: number,
  housing: number,
): void {
  if (population(s) >= housing) {
    // No spare beds — hold the timer so a newcomer arrives soon after a build.
    s.newcomerTimer = Math.min(s.newcomerTimer + dt, interval)
    return
  }
  s.newcomerTimer += dt
  while (s.newcomerTimer >= interval && population(s) < housing) {
    s.newcomerTimer -= interval
    const id = addVillager(s)
    if (id) {
      const v = s.villagers[id]
      pushLog(s, `${v.name} the ${SPECIES[v.species].name.slice(0, -1)} arrived at the hearth.`, 'good')
    }
  }
}
