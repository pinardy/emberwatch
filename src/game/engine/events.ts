import { BLUEPRINT_POOL, BUILDINGS, BUILDING_LIST } from '../content/buildings'
import { CORNERSTONES, RARITY_WEIGHTS } from '../content/cornerstones'
import { GLADE_EVENTS } from '../content/gladeEvents'
import { ORDERS, describeGoal, evaluateGoal } from '../content/orders'
import { SPECIES, VILLAGER_TRAIT_LIST, villagerName } from '../content/species'
import { EDIBLE, resourceName } from '../content/resources'
import type {
  BuildingDef,
  GladeEventOptionDef,
  ResourceBag,
  ResourceId,
  RunState,
  ServiceNeed,
  SpeciesId,
} from '../types'
import {
  CLEAR_RATE_PER_VILLAGER,
  GLADES_PER_REPUTATION,
  HOSTILITY_PER_GLADE_CLEARED,
  IMPATIENCE_PER_VILLAGER_LOST,
  REROLL_BASE_COST,
  REROLL_COST_GROWTH,
  REWARD_MILESTONES,
  VILLAGER_TRAIT_CHANCE,
} from './balance'
import {
  blueprintDraftSize,
  cornerstoneDraftSize,
  cornerstonePool,
  freeRerollsLeft,
  gladeEventOptions,
} from './citadel'
import { drawOrder, pushLog } from './createRun'
import type { Modifiers } from './modifiers'
import { refreshDepositCaches } from './production'
import { canAfford, grant, population, spend, storageUsed } from './queries'
import { makeRng } from './rng'
import { addCondition, refreshCharterOffer, takeCharter } from './structure'
import { addImpatience, addReputation, pickVictim, removeVillager, unassign } from './society'
import { clearMultiplier } from './traits'
import { recordEvent } from './timeline'

/** Scales a resource bag, rounding to whole units. */
function scaleBag(bag: ResourceBag, factor: number): ResourceBag {
  if (factor === 1) return bag
  const out: ResourceBag = {}
  for (const [id, amount] of Object.entries(bag)) {
    const qty = Math.round((amount ?? 0) * factor)
    if (qty > 0) out[id as ResourceId] = qty
  }
  return out
}

/** Advances any glade with villagers assigned to clearing it. */
export function stepClearing(s: RunState, dt: number, mods: Modifiers): void {
  // Per-glade clearing power: harpies and pathfinders count for more.
  const power: Record<string, number> = {}
  for (const v of Object.values(s.villagers)) {
    if (!v.assignment?.startsWith('clearing:')) continue
    const gladeId = v.assignment.slice('clearing:'.length)
    power[gladeId] = (power[gladeId] ?? 0) + CLEAR_RATE_PER_VILLAGER * clearMultiplier(v)
  }

  for (const glade of Object.values(s.glades)) {
    if (glade.cleared || glade.clearers <= 0) continue
    glade.clearProgress += (power[glade.id] ?? 0) * mods.clearSpeed * dt
    if (glade.clearProgress < glade.clearWork) continue

    // --- glade taken ------------------------------------------------------
    glade.cleared = true
    glade.clearProgress = glade.clearWork
    s.stats.gladesCleared++
    recordEvent(s, 'glade')

    // Send the clearing crew back to the idle pool.
    for (const v of Object.values(s.villagers)) {
      if (v.assignment === `clearing:${glade.id}`) unassign(s, v.id)
    }
    glade.clearers = 0

    for (const id of glade.neighbors) s.glades[id].discovered = true
    glade.discovered = true

    const loot = scaleBag(glade.reward, mods.gladeLoot)
    const added = grant(s.stock, loot, s.storageCap, storageUsed(s))
    s.stats.resourcesProduced += added
    s.hostility += HOSTILITY_PER_GLADE_CLEARED * mods.gladeHostility

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

// ---------------------------------------------------------------------------
// Option prices
// ---------------------------------------------------------------------------

/** True when the stockpile can pay everything a glade-event option asks for. */
export function optionAffordable(stock: ResourceBag, option: GladeEventOptionDef): boolean {
  if (option.requires && !canAfford(stock, option.requires)) return false
  if (option.foodCost && edibleTotal(stock) < option.foodCost) return false
  return true
}

function edibleTotal(stock: ResourceBag): number {
  let sum = 0
  for (const id of EDIBLE) sum += stock[id] ?? 0
  return sum
}

/**
 * Plain-text price of an option, e.g. "10 food, 5 Ale". Pure, so the UI can
 * show `foodCost` alongside the resource bag without knowing the rule.
 */
export function describeOptionCost(option: GladeEventOptionDef): string {
  const parts: string[] = []
  if (option.foodCost) parts.push(`${option.foodCost} food`)
  for (const [id, amount] of Object.entries(option.cost ?? {})) {
    if ((amount ?? 0) > 0) parts.push(`${amount} ${resourceName(id as ResourceId)}`)
  }
  return parts.join(', ')
}

/**
 * Pays `amount` food from whatever is edible, one unit at a time from the
 * largest stack — the same order villagers eat in, so a price never wipes out
 * a whole food type (and its variety bonus) while another stack sits full.
 */
export function spendFood(stock: ResourceBag, amount: number): void {
  for (let paid = 0; paid < amount; paid++) {
    let best: ResourceId | null = null
    for (const id of EDIBLE) {
      if ((stock[id] ?? 0) <= 0) continue
      if (!best || (stock[id] ?? 0) > (stock[best] ?? 0)) best = id
    }
    if (!best) return
    stock[best] = (stock[best] ?? 0) - 1
    if ((stock[best] ?? 0) <= 0) delete stock[best]
  }
}

/** Applies the chosen option of the front-of-queue glade event. */
export function resolveGladeEvent(s: RunState, optionIndex: number): void {
  const choice = s.pendingChoices[0]
  if (!choice || choice.kind !== 'gladeEvent') return
  const def = GLADE_EVENTS[choice.options[0]]
  const option = def ? gladeEventOptions(s, def)[optionIndex] : undefined
  if (!def || !option) return
  if (!optionAffordable(s.stock, option)) return

  if (option.cost) spend(s.stock, option.cost)
  if (option.foodCost) spendFood(s.stock, option.foodCost)
  if (option.gain) {
    const added = grant(s.stock, option.gain, s.storageCap, storageUsed(s))
    s.stats.resourcesProduced += added
  }
  if (option.hostility) s.hostility = Math.max(0, s.hostility + option.hostility)
  if (option.impatience) addImpatience(s, option.impatience)
  if (option.reputation) addReputation(s, option.reputation)
  if (option.villagerLoss) {
    for (let i = 0; i < option.villagerLoss; i++) {
      const victim = pickVictim(s)
      if (!victim) break
      removeVillager(s, victim.id)
      s.stats.villagersLost++
      recordEvent(s, 'lost', victim.species)
      pushLog(s, `${victim.name} the ${SPECIES[victim.species].name.slice(0, -1)} is lost.`, 'bad')
    }
  }
  if (option.villagerGain) {
    for (let i = 0; i < option.villagerGain; i++) addVillager(s)
  }

  if (option.threat) {
    const gladeId = choice.gladeId ?? ''
    s.threats.push({
      ...option.threat,
      id: `t${s.threatCounter++}`,
      gladeId,
      timer: option.threat.interval,
    })
    recordEvent(s, 'threat', option.threat.name)
    pushLog(s, `${option.threat.name} is loose. Appease it before it strikes.`, 'bad')
  }

  if (option.ongoing) {
    s.ongoing.push({ ...option.ongoing, id: `g${s.ongoing.length}_${def.id}` })
    pushLog(s, `${option.ongoing.name}: ${option.ongoing.description}`, 'info')
  }

  if (option.condition) addCondition(s, option.condition, choice.gladeId ?? '')

  pushLog(s, `${def.name}: ${option.label}.`, option.hostility && option.hostility > 0 ? 'bad' : 'info')
  s.pendingChoices.shift()
}

// ---------------------------------------------------------------------------
// Threats
// ---------------------------------------------------------------------------

/**
 * Threats strike on a timer until they are appeased. Each strike is logged, so
 * a player who ignores one can read exactly what it is costing them.
 */
export function stepThreats(s: RunState, dt: number): void {
  for (const threat of s.threats) {
    threat.timer -= dt
    if (threat.timer > 0) continue
    threat.timer += threat.interval

    const strike = threat.strike
    const parts: string[] = []
    if (strike.hostility) {
      s.hostility = Math.max(0, s.hostility + strike.hostility)
      parts.push(`hostility +${strike.hostility}`)
    }
    if (strike.impatience) {
      addImpatience(s, strike.impatience)
      parts.push(`the Queen frets`)
    }
    if (strike.stockLoss) {
      for (const [id, amount] of Object.entries(strike.stockLoss)) {
        const key = id as keyof typeof s.stock
        const taken = Math.min(s.stock[key] ?? 0, amount ?? 0)
        if (taken > 0) {
          spend(s.stock, { [key]: taken })
          parts.push(`${taken} ${key} stolen`)
        }
      }
    }
    if (strike.villagerLoss) {
      for (let i = 0; i < strike.villagerLoss; i++) {
        const victim = pickVictim(s)
        if (!victim) break
        removeVillager(s, victim.id)
        s.stats.villagersLost++
        recordEvent(s, 'lost', victim.species)
        addImpatience(s, IMPATIENCE_PER_VILLAGER_LOST)
        parts.push(`${victim.name} is taken`)
      }
    }
    pushLog(s, `${threat.icon} ${threat.name} strikes — ${parts.join(', ') || 'the settlement shudders'}.`, 'bad')
  }
}

/** Pays a threat off. Returns an error string, or null on success. */
export function appeaseThreat(s: RunState, threatId: string): string | null {
  const threat = s.threats.find((t) => t.id === threatId)
  if (!threat) return 'No such threat.'
  if (!canAfford(s.stock, threat.appease)) return 'Not enough to appease it.'
  spend(s.stock, threat.appease)
  s.threats = s.threats.filter((t) => t.id !== threatId)
  recordEvent(s, 'appeased', threat.name)
  pushLog(s, `${threat.icon} ${threat.name} has been dealt with.`, 'good')
  return null
}

/** Adds a villager of a random species from the run's pool. */
export function addVillager(s: RunState): string | null {
  const rng = makeRng(s.seed, s.rngCursor)
  const species = rng.pick(s.speciesPool)
  const trait = rng.chance(VILLAGER_TRAIT_CHANCE)
    ? rng.pick(VILLAGER_TRAIT_LIST).id
    : undefined
  s.rngCursor = rng.cursor()
  const index = Object.keys(s.villagers).length + s.stats.villagersLost
  const id = `v${index}_${s.clock.toFixed(0)}`
  s.villagers[id] = {
    id,
    species,
    name: villagerName(index),
    assignment: null,
    ...(trait ? { trait } : {}),
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
  const pool = cornerstonePool(s).filter((c) => !s.cornerstones.includes(c.id))
  const options: string[] = []
  const remaining = [...pool]
  const size = cornerstoneDraftSize(s)
  for (let i = 0; i < size && remaining.length > 0; i++) {
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
  const demand = serviceDemand(present)

  const ordered = [...demand.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([need]) => need)

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
    for (const good of serviceGoods(unlockedVenue.id)) {
      const producers = producersOf(good)
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

/** Which of these species want each service need, in need order of first appearance. */
export function serviceDemand(species: SpeciesId[]): Map<ServiceNeed, SpeciesId[]> {
  const demand = new Map<ServiceNeed, SpeciesId[]>()
  for (const sp of species) {
    for (const need of SPECIES[sp].needs) {
      demand.set(need, [...(demand.get(need) ?? []), sp])
    }
  }
  return demand
}

/** The goods a service venue hands out (its first recipe's inputs). */
function serviceGoods(venueId: string): ResourceId[] {
  return Object.keys(BUILDINGS[venueId]?.recipes[0]?.inputs ?? {}) as ResourceId[]
}

/** Buildings with a recipe that yields `good`. */
function producersOf(good: ResourceId): BuildingDef[] {
  return BUILDING_LIST.filter((b) =>
    b.recipes.some((r) => ((r.outputs as Record<string, number>)[good] ?? 0) > 0),
  )
}

export interface DraftAppeal {
  /** The need this building serves as a venue, and who in this run wants it. */
  serves?: { need: ServiceNeed; species: SpeciesId[] }
  /** Wanted needs whose venues hand out goods this building produces. */
  supplies: { need: ServiceNeed; species: SpeciesId[] }[]
}

/**
 * Why a blueprint matters to *this* settlement: which of its species want the
 * service it provides, and which wanted services it would supply. Uses the
 * same need → venue → goods → producer chain as `relevantBlueprints`, over the
 * species drawn for the run (residents and those still to arrive).
 */
export function draftAppeal(s: RunState, defId: string): DraftAppeal {
  const def = BUILDINGS[defId]
  const species = [...new Set([...s.speciesPool, ...Object.values(s.villagers).map((v) => v.species)])]
  const demand = serviceDemand(species)
  const appeal: DraftAppeal = { supplies: [] }
  if (!def) return appeal

  if (def.service) {
    appeal.serves = { need: def.service.need, species: demand.get(def.service.need) ?? [] }
  }
  for (const [need, wanting] of demand) {
    const venues = BUILDING_LIST.filter((b) => b.service?.need === need)
    const supplied = venues.some((v) =>
      serviceGoods(v.id).some((good) => producersOf(good).some((p) => p.id === defId)),
    )
    if (supplied) appeal.supplies.push({ need, species: wanting })
  }
  return appeal
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
  const size = blueprintDraftSize(s)
  for (const id of rng.shuffle(pool)) {
    if (options.length >= size) break
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
    recordEvent(s, 'cornerstone', CORNERSTONES[optionId]?.name ?? optionId)
    pushLog(s, `Cornerstone laid: ${CORNERSTONES[optionId]?.name ?? optionId}.`, 'good')
  } else if (choice.kind === 'blueprint') {
    if (!choice.options.includes(optionId)) return
    if (!s.unlockedBuildings.includes(optionId)) s.unlockedBuildings.push(optionId)
    pushLog(s, `Blueprint acquired: ${BUILDINGS[optionId]?.name ?? optionId}.`, 'good')
  } else if (choice.kind === 'charter') {
    if (!takeCharter(s, choice, optionId)) return
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
    } else if (choice.kind === 'charter') {
      refreshCharterOffer(s, choice)
    }
  }
}

/** Amber cost of the next draft reroll — it steepens with use. */
export function rerollCost(s: RunState): number {
  if (freeRerollsLeft(s) > 0) return 0
  return REROLL_BASE_COST + s.rerollsUsed * REROLL_COST_GROWTH
}

/**
 * Re-draws the options of the open draft for amber. A well-loved roguelite
 * lever: it converts a lucky economy into slightly better luck.
 */
export function rerollChoice(s: RunState): string | null {
  const choice = s.pendingChoices[0]
  if (!choice) return 'Nothing to reroll.'
  if (choice.kind === 'gladeEvent') return 'The forest does not renegotiate.'
  if (choice.kind === 'charter') return 'A royal charter is not up for negotiation.'
  const cost = rerollCost(s)
  if ((s.stock.amber ?? 0) < cost) return 'Not enough amber.'

  if (choice.kind === 'blueprint') {
    const rng = makeRng(s.seed, s.rngCursor)
    const pool = BLUEPRINT_POOL.filter(
      (id) => !s.unlockedBuildings.includes(id) && !choice.options.includes(id),
    )
    const fresh = rng.shuffle(pool).slice(0, blueprintDraftSize(s))
    s.rngCursor = rng.cursor()
    if (fresh.length === 0) return 'There is nothing else to offer.'
    choice.options = fresh
  } else {
    const rng = makeRng(s.seed, s.rngCursor)
    const pool = cornerstonePool(s).filter(
      (c) => !s.cornerstones.includes(c.id) && !choice.options.includes(c.id),
    )
    const options: string[] = []
    const remaining = [...pool]
    const size = cornerstoneDraftSize(s)
    for (let i = 0; i < size && remaining.length > 0; i++) {
      const pick = rng.weighted(remaining, (c) => RARITY_WEIGHTS[c.rarity])
      options.push(pick.id)
      remaining.splice(remaining.indexOf(pick), 1)
    }
    s.rngCursor = rng.cursor()
    if (options.length === 0) return 'There is nothing else to offer.'
    choice.options = options
  }

  if (cost === 0 && s.citadel && freeRerollsLeft(s) > 0) {
    // A Citadel favour: free, and it does not steepen the amber price.
    s.citadel.freeRerolls--
    pushLog(s, 'The offer is redrawn — a favour from the Citadel.', 'info')
    return null
  }
  spend(s.stock, { amber: cost })
  s.rerollsUsed++
  pushLog(s, `The offer is redrawn for ${cost} amber.`, 'info')
  return null
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
