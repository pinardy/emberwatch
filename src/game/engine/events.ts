import { feats } from './feats'
import { BLUEPRINT_POOL, BUILDINGS, BUILDING_LIST } from '../content/buildings'
import { CORNERSTONES, RARITY_WEIGHTS } from '../content/cornerstones'
import { GLADE_EVENTS } from '../content/gladeEvents'
import { SPECIES, VILLAGER_TRAIT_LIST, speciesSingular, villagerName } from '../content/species'
import { EDIBLE, resourceName } from '../content/resources'
import type {
  ActiveThreat,
  BuildingDef,
  Glade,
  GladeEventOptionDef,
  ResourceBag,
  ResourceId,
  RunState,
  ServiceNeed,
  SpeciesId,
  ThreatSpec,
} from '../types'
import {
  CLEAR_RATE_PER_VILLAGER,
  DRAFT_PITY,
  GLADES_PER_REPUTATION,
  HOSTILITY_PER_GLADE_CLEARED,
  IMPATIENCE_PER_VILLAGER_LOST,
  REROLL_BASE_COST,
  REROLL_COST_GROWTH,
  REWARD_MILESTONES,
  TARGETED_REDRAW_SURCHARGE,
  THREAT_APPEASE_GROWTH,
  THREAT_STRIKE_GROWTH,
  THREAT_STRIKES_BEFORE_LOSS,
  VILLAGER_TRAIT_CHANCE,
} from './balance'
import {
  blueprintDraftSize,
  cornerstoneDraftSize,
  cornerstonePool,
  freeRerollsLeft,
  gladeEventOptions,
} from './citadel'
import { pushLog } from './runLog'
import type { Modifiers } from './modifiers'
import { refreshDepositCaches } from './production'
import { canAfford, edibleTotal, grantProduced, population, spend } from './queries'
import { makeRng } from './rng'
import { touchVillagers } from './runCache'
import { addCondition, refreshCharterOffer, takeCharter, takeQueenChoice } from './structure'
import { addImpatience, addReputation, loseVillager, pickVictim, unassign } from './society'
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
    grantProduced(s, loot)
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
// What a glade's event puts at stake
// ---------------------------------------------------------------------------

/** Kinds of outcome a glade's waiting event can lead to, worst first. */
export type GladeStake = 'lives' | 'threat' | 'condition' | 'reputation' | 'pact'

/**
 * What the event waiting in a glade could lead to — read from its options,
 * never naming the event — so the map can say "a threat may wait here" and
 * clearing order is a decision rather than whichever glade is cheapest.
 * Empty for a glade with no event (or one already cleared).
 */
export function gladeStakes(s: RunState, gladeId: string): GladeStake[] {
  const glade = s.glades[gladeId]
  return glade ? gladeStakesOf(glade) : []
}

/** `gladeStakes` for a glade in hand (pure: reads only its waiting event). */
export function gladeStakesOf(glade: Pick<Glade, 'cleared' | 'eventId'>): GladeStake[] {
  const def = !glade.cleared && glade.eventId ? GLADE_EVENTS[glade.eventId] : undefined
  if (!def) return []
  const found = new Set<GladeStake>()
  for (const o of def.options) {
    if (o.villagerLoss || o.threat?.strike.villagerLoss) found.add('lives')
    if (o.threat) found.add('threat')
    if (o.condition) found.add('condition')
    if (o.reputation || o.condition?.onResolve?.reputation) found.add('reputation')
    if (o.ongoing) found.add('pact')
  }
  const order: GladeStake[] = ['lives', 'threat', 'condition', 'reputation', 'pact']
  return order.filter((k) => found.has(k))
}

/** Short words for each stake, for plates' titles and the Inspector. */
export const GLADE_STAKE_LABEL: Record<GladeStake, { text: string }> = {
  lives: { text: 'lives' },
  threat: { text: 'a threat' },
  condition: { text: 'a lingering task' },
  reputation: { text: 'reputation' },
  pact: { text: 'a pact' },
}

/** "a threat, lives or reputation" — the stakes in a sentence. */
export function describeStakes(stakes: GladeStake[]): string {
  const words = stakes.map((k) => GLADE_STAKE_LABEL[k].text)
  if (words.length <= 1) return words[0] ?? ''
  return `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}`
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

/**
 * Why an option cannot be chosen, in words: "Needs 10 food — you have 6".
 * Null when the stockpile can pay. Mirrors `optionAffordable`.
 */
export function describeOptionShortfall(
  stock: ResourceBag,
  option: GladeEventOptionDef,
): string | null {
  const parts: string[] = []
  if (option.foodCost) {
    const have = Math.floor(edibleTotal(stock))
    if (have < option.foodCost) parts.push(`${option.foodCost} food — you have ${have}`)
  }
  for (const [id, amount] of Object.entries(option.requires ?? {})) {
    const have = Math.floor(stock[id as ResourceId] ?? 0)
    if (have < (amount ?? 0)) {
      parts.push(`${amount} ${resourceName(id as ResourceId)} — you have ${have}`)
    }
  }
  return parts.length > 0 ? `Needs ${parts.join('; ')}` : null
}

/** Units of food of any kind in the stockpile: what a `foodCost` is paid from. */
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
    grantProduced(s, option.gain)
  }
  if (option.hostility) s.hostility = Math.max(0, s.hostility + option.hostility)
  if (option.impatience) addImpatience(s, option.impatience)
  if (option.reputation) addReputation(s, option.reputation)
  if (option.villagerLoss) {
    for (let i = 0; i < option.villagerLoss; i++) {
      const victim = pickVictim(s)
      if (!victim) break
      loseVillager(s, victim)
      pushLog(s, `${victim.name} the ${speciesSingular(victim.species)} is lost.`, 'bad')
    }
  }
  if (option.villagerGain) {
    for (let i = 0; i < option.villagerGain; i++) addVillager(s)
  }

  if (option.threat) unleashThreat(s, option.threat, choice.gladeId ?? '')

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
 * Sets a threat loose. Its numbers are copied, never shared with the content
 * that declared it: an ignored threat raises them in place as it grows bolder.
 */
export function unleashThreat(s: RunState, spec: ThreatSpec, gladeId: string): ActiveThreat {
  const threat: ActiveThreat = {
    ...spec,
    appease: { ...spec.appease },
    strike: {
      ...spec.strike,
      ...(spec.strike.stockLoss ? { stockLoss: { ...spec.strike.stockLoss } } : {}),
    },
    id: `t${s.threatCounter++}`,
    gladeId,
    timer: spec.interval,
    strikes: 0,
  }
  s.threats.push(threat)
  recordEvent(s, 'threat', spec.name)
  pushLog(s, `${spec.name} is loose. Appease it before it strikes.`, 'bad')
  return threat
}

/**
 * An ignored threat grows bolder: after each strike its next one hits
 * `THREAT_STRIKE_GROWTH` harder and paying it off costs `THREAT_APPEASE_GROWTH`
 * more. From `THREAT_STRIKES_BEFORE_LOSS` strikes on it also takes a villager.
 * The numbers are raised on the threat itself, so the threat bar always shows
 * the next strike and today's price.
 */
export function escalateThreat(threat: ActiveThreat): void {
  threat.strikes = (threat.strikes ?? 0) + 1
  const strike = threat.strike
  const grow = 1 + THREAT_STRIKE_GROWTH
  if (strike.stockLoss) {
    for (const [id, amount] of Object.entries(strike.stockLoss)) {
      strike.stockLoss[id as ResourceId] = Math.ceil((amount ?? 0) * grow)
    }
  }
  if (strike.hostility) strike.hostility = Math.round(strike.hostility * grow * 2) / 2
  if (strike.impatience) strike.impatience = Math.round(strike.impatience * grow * 100) / 100
  if (threat.strikes >= THREAT_STRIKES_BEFORE_LOSS && !strike.villagerLoss) strike.villagerLoss = 1
  for (const [id, amount] of Object.entries(threat.appease)) {
    // Amber prices climb too; everything rounds up to whole units.
    threat.appease[id as ResourceId] = Math.ceil((amount ?? 0) * (1 + THREAT_APPEASE_GROWTH))
  }
}

/**
 * Threats strike on a timer until they are appeased. Each strike is logged, so
 * a player who ignores one can read exactly what it is costing them — and
 * each one makes the next worse (see `escalateThreat`).
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
        loseVillager(s, victim)
        addImpatience(s, IMPATIENCE_PER_VILLAGER_LOST)
        parts.push(`${victim.name} is taken`)
      }
    }
    const before = threat.strike.villagerLoss ?? 0
    escalateThreat(threat)
    const bolder =
      !before && threat.strike.villagerLoss
        ? ' It grows bold: its next strike will take a villager.'
        : ' It grows bolder.'
    pushLog(
      s,
      `${threat.icon} ${threat.name} strikes — ${parts.join(', ') || 'the settlement shudders'}.${bolder}`,
      'bad',
    )
  }
}

/** Pays a threat off. Returns an error string, or null on success. */
export function appeaseThreat(s: RunState, threatId: string): string | null {
  const threat = s.threats.find((t) => t.id === threatId)
  if (!threat) return 'No such threat.'
  if (!canAfford(s.stock, threat.appease)) return 'Not enough to appease it.'
  spend(s.stock, threat.appease)
  s.threats = s.threats.filter((t) => t.id !== threatId)
  feats(s).threatsAppeased++
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
  touchVillagers(s)
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
  // A pick laid as the run ends is noise: within a point of victory, the
  // milestones pass without a draft.
  if (s.reputation >= s.maxReputation - 1) {
    s.cornerstonesTaken = Math.max(s.cornerstonesTaken, reached)
    return
  }
  while (s.cornerstonesTaken < reached) {
    const index = s.cornerstonesTaken
    s.cornerstonesTaken++
    // Lead with a blueprint: early on, options matter more than multipliers.
    if (index % 2 === 0) offerBlueprint(s)
    else offerCornerstone(s)
  }
}

export function offerCornerstone(s: RunState, commonOnly = false): void {
  const rng = makeRng(s.seed, s.rngCursor)
  const options = drawCornerstones(s, rng, cornerstoneDraftSize(s), [], commonOnly)
  s.rngCursor = rng.cursor()
  if (options.length === 0) return
  s.pendingChoices.push({ kind: 'cornerstone', options })
}

/** Up to `size` cornerstones not yet laid (nor in `exclude`), by rarity weight. */
function drawCornerstones(
  s: RunState,
  rng: ReturnType<typeof makeRng>,
  size: number,
  exclude: string[] = [],
  commonOnly = false,
): string[] {
  const remaining = cornerstonePool(s).filter(
    (c) =>
      !s.cornerstones.includes(c.id) &&
      !exclude.includes(c.id) &&
      (!commonOnly || c.rarity === 'common'),
  )
  const options: string[] = []
  for (let i = 0; i < size && remaining.length > 0; i++) {
    const pickDef = rng.weighted(remaining, (c) => RARITY_WEIGHTS[c.rarity])
    options.push(pickDef.id)
    remaining.splice(remaining.indexOf(pickDef), 1)
  }
  return options
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

/**
 * The next locked blueprint of `need`'s chain: its venue while none is
 * unlocked, then a workshop for a good that venue hands out and nothing here
 * makes yet. `null` once the chain is whole (or nothing of it can be drafted).
 * Ordered the way the draft ranks pieces, so the same chain always asks for
 * the same next piece.
 */
export function chainPieceFor(s: RunState, need: ServiceNeed): string | null {
  const drafted = (id: string) => s.unlockedBuildings.includes(id)
  const venues = BUILDING_LIST.filter((b) => b.service?.need === need)
  const venue = venues.find((v) => drafted(v.id))
  if (!venue) return venues.find((v) => BLUEPRINT_POOL.includes(v.id))?.id ?? null
  for (const good of serviceGoods(venue.id)) {
    const producers = producersOf(good)
    if (producers.some((p) => drafted(p.id))) continue
    const piece = producers.find((p) => BLUEPRINT_POOL.includes(p.id))
    if (piece) return piece.id
  }
  return null
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

/** True when a draft is owed a piece of a wanted service chain (the pity rule). */
export function draftOwesChain(s: RunState): boolean {
  return (s.draftDrought ?? DRAFT_PITY) >= DRAFT_PITY
}

/**
 * A blueprint draft's options, drawn at random from the locked pool and laid
 * out in random order. Nothing is guaranteed — except that after `DRAFT_PITY`
 * drafts in a row with nothing toward a wanted service, the next one carries
 * the most useful chain piece, so a needed service is never starved for good
 * (the run's first draft is owed one too). A `mixed` draft trades one
 * blueprint slot for a cornerstone, so "finish the chain" competes with a
 * run-long perk.
 */
function buildBlueprintOptions(
  s: RunState,
  mixed: boolean,
  {
    exclude = [],
    pity = true,
    force,
  }: {
    exclude?: string[]
    pity?: boolean
    /** A blueprint that must be among the options (a targeted redraw). */
    force?: string
  } = {},
): string[] {
  const rng = makeRng(s.seed, s.rngCursor)
  const pool = BLUEPRINT_POOL.filter(
    (id) => !s.unlockedBuildings.includes(id) && !exclude.includes(id),
  )
  if (pool.length === 0) {
    s.rngCursor = rng.cursor()
    return []
  }
  const size = blueprintDraftSize(s)
  const cornerstone = mixed ? drawCornerstones(s, rng, 1, exclude) : []
  const blueprintSlots = Math.max(1, size - cornerstone.length)
  const options: string[] = []
  // `relevantBlueprints` is priority-ordered, so take from the front.
  const relevant = relevantBlueprints(s).filter((id) => !exclude.includes(id))
  if (force && pool.includes(force)) options.push(force)
  else if (pity && relevant.length > 0 && draftOwesChain(s)) options.push(relevant[0])
  for (const id of rng.shuffle(pool)) {
    if (options.length >= blueprintSlots) break
    if (!options.includes(id)) options.push(id)
  }
  const out = rng.shuffle([...options, ...cornerstone])
  s.rngCursor = rng.cursor()
  return out
}

/**
 * Offers a blueprint draft. Milestone drafts are `mixed` (one option is a
 * cornerstone); the opening drafts, dealt before the clock starts, are not.
 */
export function offerBlueprint(s: RunState, mixed = s.clock > 0): void {
  const options = buildBlueprintOptions(s, mixed)
  if (options.length === 0) {
    // Nothing left to unlock — hand out a cornerstone instead.
    offerCornerstone(s)
    return
  }
  s.pendingChoices.push({ kind: 'blueprint', options, ...(mixed ? { mixed } : {}) })
}

/** Lays a cornerstone (the caller retires the choice). */
function layCornerstone(s: RunState, optionId: string): void {
  s.cornerstones.push(optionId)
  recordEvent(s, 'cornerstone', CORNERSTONES[optionId]?.name ?? optionId)
  pushLog(s, `Cornerstone laid: ${CORNERSTONES[optionId]?.name ?? optionId}.`, 'good')
}

/**
 * Counts blueprint drafts that passed without a piece of a wanted chain on
 * offer (judged before the pick changes what is wanted), for the pity rule.
 */
function noteDraftOffer(s: RunState, options: string[]): void {
  const relevant = relevantBlueprints(s)
  if (relevant.length === 0 || options.some((id) => relevant.includes(id))) s.draftDrought = 0
  else s.draftDrought = (s.draftDrought ?? DRAFT_PITY) + 1
}

/**
 * Applies a pick from a queued choice — the front one unless `index` says
 * otherwise (the Founding panel takes its picks in any order).
 */
export function takeChoice(s: RunState, optionId: string, index = 0): void {
  const choice = s.pendingChoices[index]
  if (!choice) return
  if (choice.kind === 'cornerstone') {
    if (!choice.options.includes(optionId)) return
    if (s.cornerstones.includes(optionId)) return
    layCornerstone(s, optionId)
  } else if (choice.kind === 'blueprint') {
    if (!choice.options.includes(optionId)) return
    noteDraftOffer(s, choice.options)
    if (!BUILDINGS[optionId] && CORNERSTONES[optionId]) {
      // A mixed draft's cornerstone.
      if (s.cornerstones.includes(optionId)) return
      layCornerstone(s, optionId)
    } else {
      if (!s.unlockedBuildings.includes(optionId)) s.unlockedBuildings.push(optionId)
      pushLog(s, `Blueprint acquired: ${BUILDINGS[optionId]?.name ?? optionId}.`, 'good')
    }
  } else if (choice.kind === 'charter') {
    if (!takeCharter(s, choice, optionId)) return
  } else if (choice.kind === 'order' || choice.kind === 'decree') {
    if (!takeQueenChoice(s, choice, optionId)) return
  } else {
    return
  }
  s.pendingChoices.splice(index, 1)
  // Taken out of turn (a founding cornerstone or writ while a blueprint draft
  // is still showing), nothing the player can see is redrawn: only offers the
  // pick has made stale change.
  refreshQueuedChoices(s, index === 0 || choice.kind === 'blueprint')
}

/**
 * Re-rolls the options of any *still queued* draft.
 *
 * Drafts can be queued several deep — the opening draft is three picks, and a
 * milestone can land while one is open. Their options were computed before the
 * player chose, so without this the same building is offered (and granted) twice
 * and half a service chain never appears.
 */
function refreshQueuedChoices(s: RunState, redraw = true): void {
  const stale = s.pendingChoices
  for (let i = 0; i < stale.length; i++) {
    const choice = stale[i]
    if (choice.kind === 'blueprint') {
      if (!redraw && !choice.options.some((id) => s.unlockedBuildings.includes(id) || s.cornerstones.includes(id))) {
        continue
      }
      const fresh = buildBlueprintOptions(s, !!choice.mixed)
      if (fresh.length === 0) {
        // Nothing left to draft — swap in a cornerstone offer instead.
        stale.splice(i, 1)
        offerCornerstone(s)
        if (choice.founding && stale.length > 0) stale[stale.length - 1].founding = true
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
export function rerollChoice(s: RunState, index = 0): string | null {
  const choice = s.pendingChoices[index]
  if (!choice) return 'Nothing to reroll.'
  if (choice.kind === 'gladeEvent') return 'The forest does not renegotiate.'
  if (choice.kind === 'charter') return 'A royal charter is not up for negotiation.'
  if (choice.kind === 'order' || choice.kind === 'decree') return 'The Queen does not haggle.'
  const cost = rerollCost(s)
  if ((s.stock.amber ?? 0) < cost) return 'Not enough amber.'

  if (choice.kind === 'blueprint') {
    // A redraw is a fresh hand: none of what was shown, and no pity piece.
    const fresh = buildBlueprintOptions(s, !!choice.mixed, {
      exclude: choice.options,
      pity: false,
    })
    if (fresh.length === 0) return 'There is nothing else to offer.'
    choice.options = fresh
  } else {
    const rng = makeRng(s.seed, s.rngCursor)
    const options = drawCornerstones(s, rng, cornerstoneDraftSize(s), choice.options)
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

/**
 * Amber for a targeted redraw — asking the Queen's architect for a blueprint
 * toward one service. It rides the reroll ladder (and steepens it), plus a
 * surcharge, and a Citadel free reroll does not cover it.
 */
export function targetedRedrawCost(s: RunState): number {
  return REROLL_BASE_COST + s.rerollsUsed * REROLL_COST_GROWTH + TARGETED_REDRAW_SURCHARGE
}

/**
 * Services a targeted redraw of the draft at `index` could ask for: each need
 * of the run's species whose chain still has a locked piece that the draft
 * is not already showing, with that piece. Empty for anything but a
 * blueprint draft.
 */
export function redrawTargets(s: RunState, index = 0): { need: ServiceNeed; piece: string }[] {
  const choice = s.pendingChoices[index]
  if (!choice || choice.kind !== 'blueprint') return []
  const out: { need: ServiceNeed; piece: string }[] = []
  for (const need of serviceDemand(s.speciesPool).keys()) {
    const piece = chainPieceFor(s, need)
    if (piece && !choice.options.includes(piece)) out.push({ need, piece })
  }
  return out
}

/**
 * The targeted redraw: a fresh hand for the open blueprint draft, like a
 * reroll, except that one card is the next piece of `need`'s chain (see
 * `chainPieceFor`). The rest is drawn at random, so the draft is still a
 * choice — and the pick can still be something else.
 */
export function redrawToward(s: RunState, need: ServiceNeed, index = 0): string | null {
  const choice = s.pendingChoices[index]
  if (!choice || choice.kind !== 'blueprint') return 'Only a blueprint draft can be redrawn toward a service.'
  const target = redrawTargets(s, index).find((t) => t.need === need)
  if (!target) return 'Nothing more of that service can be drafted here.'
  const cost = targetedRedrawCost(s)
  if ((s.stock.amber ?? 0) < cost) return 'Not enough amber.'
  const fresh = buildBlueprintOptions(s, !!choice.mixed, {
    exclude: choice.options.filter((id) => id !== target.piece),
    pity: false,
    force: target.piece,
  })
  if (!fresh.includes(target.piece)) return 'There is nothing else to offer.'
  choice.options = fresh
  spend(s.stock, { amber: cost })
  s.rerollsUsed++
  pushLog(
    s,
    `📐 The Queen's architect redraws the offer around ${BUILDINGS[target.piece]?.name ?? target.piece}, for ${cost} amber.`,
    'info',
  )
  return null
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
      pushLog(s, `${v.name} the ${speciesSingular(v.species)} arrived at the hearth.`, 'good')
    }
  }
}
