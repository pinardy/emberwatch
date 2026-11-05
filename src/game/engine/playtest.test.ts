import { describe, expect, it } from 'vitest'
import { BUILDINGS, STARTING_BLUEPRINTS } from '../content/buildings'
import { GLADE_EVENTS } from '../content/gladeEvents'
import { ORDERS } from '../content/orders'
import { RUN_MODIFIER_LIST } from '../content/runModifiers'
import { SPECIES } from '../content/species'
import { EDIBLE } from '../content/resources'
import type { BuildingInstance, ResourceId, RunState, ServiceNeed, SpeciesId } from '../types'
import {
  addClearer,
  assignWorker,
  findPlacement,
  isReachable,
  placeBuilding,
  removeWorker,
  setRecipe,
} from './actions'
import { GLADES_PER_REPUTATION } from './balance'
import { createRun } from './createRun'
import { computeModifiers } from './modifiers'
import { resolveBreakdowns } from './society'
import {
  appeaseThreat,
  optionAffordable,
  orderReputation,
  resolveGladeEvent,
  takeChoice,
} from './events'
import {
  SERVICE_COVERAGE_RATIO,
  activeRecipe,
  canAfford,
  foodStock,
  idleVillagers,
  population,
  isWarmAt,
  serviceCoverage,
  storageUsed,
  totalHousing,
} from './queries'
import { dist } from './geometry'
import { tick } from './tick'

/**
 * End-to-end balance harness.
 *
 * A heuristic bot plays whole runs: it builds a food and wood economy, houses
 * everyone, stands up the service chains its species demand, and clears glades.
 * It is not a great player — it is a *competent* one — which makes it a useful
 * floor for balance. If a competent player cannot finish a run, the numbers in
 * `balance.ts` are wrong.
 */

const STEP = 0.25
/** How often the bot re-evaluates. Humans do not act 8 times a second. */
const DECISION_INTERVAL = 2

/** Service need → the building that supplies it and the goods chain behind it. */
const SERVICE_CHAIN: Record<
  ServiceNeed,
  { service: string; producer: string; recipe: string }
> = {
  luxury: { service: 'tavern', producer: 'brewery', recipe: 'aleBerry' },
  religion: { service: 'temple', producer: 'apothecaryWorkshop', recipe: 'incense' },
  education: { service: 'guildHouse', producer: 'scribesOffice', recipe: 'scroll' },
  rest: { service: 'bathHouse', producer: 'weaver', recipe: 'fabric' },
  treatment: { service: 'apothecary', producer: 'apothecaryWorkshop', recipe: 'tea' },
  brawling: { service: 'arena', producer: 'weaver', recipe: 'gear' },
}

interface BotReport {
  phase: RunState['phase']
  years: number
  reputation: number
  impatience: number
  population: number
  gladesCleared: number
  ordersCompleted: number
  buildings: number
  minutes: number
  /** Diagnostics — these are what tell you *why* a run went the way it did. */
  hostility: number
  resolve: string
  unmetNeeds: string
  starving: boolean
  coldHearth: boolean
  services: string
  drafted: string
  exactMinutes: number
  sources: ReputationSources
  lost: number
  /** Braziers raised to warm homes beyond the hearth. */
  braziers: number
  /** Map modifiers the seed drew (or the test forced). */
  modifiers: string
  /** Orders still open at the end, with progress — stuck ones explain slow runs. */
  openOrders: string
}

/** Snapshot of resolve versus the threshold each species must beat. */
function describeResolve(s: RunState): string {
  const mods = computeModifiers(s)
  return resolveBreakdowns(s, mods)
    .map((b) => `${b.species}=${b.current.toFixed(0)}/${b.threshold}`)
    .join(' ')
}

function describeUnmet(s: RunState): string {
  const mods = computeModifiers(s)
  const unmet = new Set<string>()
  for (const b of resolveBreakdowns(s, mods)) {
    for (const [need, met] of Object.entries(b.needDetail)) if (!met) unmet.add(need)
  }
  return unmet.size === 0 ? 'none' : [...unmet].join(',')
}

/**
 * Per-need service diagnosis: venues built, how many are staffed, whether the
 * goods are in stock, and the capacity against what the population requires.
 */
function describeServices(s: RunState): string {
  const coverage = serviceCoverage(s)
  const required = Math.ceil(population(s) * SERVICE_COVERAGE_RATIO)
  const parts: string[] = []
  for (const need of neededServices(s)) {
    const chain = SERVICE_CHAIN[need]
    const venues = Object.values(s.buildings).filter(
      (b) => b.defId === chain.service && b.built,
    )
    const staffed = venues.filter((b) => b.workers.length > 0).length
    const good = Object.keys(BUILDINGS[chain.service]?.recipes[0]?.inputs ?? {})[0]
    const producers = Object.values(s.buildings).filter(
      (b) => b.defId === chain.producer && b.built,
    )
    const producersStaffed = producers.filter((b) => b.workers.length > 0).length
    const onRecipe = producers.filter((b) => b.activeRecipeId === chain.recipe).length
    parts.push(
      `${need}[venue ${staffed}/${venues.length} prod ${producersStaffed}/${producers.length} onRecipe ${onRecipe} ${good}=${Math.floor(s.stock[good as never] ?? 0)} cap ${coverage[need].capacity}/${required}]`,
    )
  }
  return parts.join(' ')
}

/** Every instance, including sites still under construction. */
function countPlanned(s: RunState, defId: string): number {
  return Object.values(s.buildings).filter((b) => b.defId === defId).length
}

/** Only finished instances — what actually contributes capacity. */
function countBuilt(s: RunState, defId: string): number {
  return Object.values(s.buildings).filter((b) => b.defId === defId && b.built).length
}

/**
 * Tries to place `defId` at the legal spot the engine's placement search
 * suggests — camps beside their deposits, everything else packed around the
 * hearth. Building compactly is what a competent player does, and it keeps
 * housing inside the hearth's warmth once the Storm chills distant homes.
 */
function tryPlace(s: RunState, defId: string): boolean {
  if (!s.unlockedBuildings.includes(defId)) return false
  const def = BUILDINGS[defId]
  if (!def || !canAfford(s.stock, def.cost)) return false
  /*
   * A failed placement search scans every ring around its anchors, which is
   * the harness's dominant cost on crowded maps. Space only opens up when a
   * glade is cleared, so a failure is remembered until then.
   */
  const memo = noRoom.get(s)
  const key = `${defId}:${s.stats.gladesCleared}`
  if (memo?.has(key)) return false
  const pos = findPlacement(s, defId)
  if (!pos) {
    if (memo) memo.add(key)
    else noRoom.set(s, new Set([key]))
    return false
  }
  return placeBuilding(s, defId, pos) === null
}

const noRoom = new WeakMap<RunState, Set<string>>()

/** Needs demanded by the species actually living here. */
function neededServices(s: RunState): ServiceNeed[] {
  const present = new Set<SpeciesId>(Object.values(s.villagers).map((v) => v.species))
  const needs = new Set<ServiceNeed>()
  for (const sp of present) for (const need of SPECIES[sp].needs) needs.add(need)
  return [...needs]
}

/**
 * Worker slots per villager. Above ~1 the settlement is spread too thin and the
 * deeper production chains — which is where service goods come from — go
 * unstaffed. Building past that point actively makes a run worse.
 */
function slotPressure(s: RunState): number {
  let slots = 0
  for (const b of Object.values(s.buildings)) {
    if (b.built) slots += BUILDINGS[b.defId]?.workerSlots ?? 0
  }
  return slots / Math.max(1, population(s))
}

/** Build order. First entry whose condition holds and which can be placed wins. */
function build(s: RunState, economyOnly = false): void {
  // Keep at most two sites open so construction actually finishes.
  if (openSites(s) >= 2) return
  const pop = population(s)

  // Housing and storage need no workers, so they are never gated.
  if (totalHousing(s) < pop + 4 && (tryPlace(s, 'cabin') || tryPlace(s, 'shelter'))) return
  if (storageUsed(s) > s.storageCap * 0.8 && tryPlace(s, 'warehouse')) return
  // Homes that sprawled past the hearth's reach get a brazier before the Storm.
  if (warmSprawl(s)) return

  // 1. Wood first — it is the input to nearly everything.
  if (countPlanned(s, 'woodcuttersCamp') < 2 && tryPlace(s, 'woodcuttersCamp')) return

  /*
   * 2. Food, scaled to the population and never gated behind staffing. The
   *    Storm halves gathering and stops farms outright, so a settlement of 25
   *    needs several camps plus a larder to ride it out. Starving is the single
   *    fastest way to lose a run.
   */
  const foodCamps =
    countPlanned(s, 'foragersCamp') + countPlanned(s, 'trappersCamp') + countPlanned(s, 'smallFarm')
  const foodTarget = Math.max(2, Math.ceil(pop / 9))
  if (
    foodCamps < foodTarget &&
    (tryPlace(s, 'foragersCamp') || tryPlace(s, 'trappersCamp') || tryPlace(s, 'smallFarm'))
  ) {
    return
  }

  /*
   * 3. Services are the largest resolve lever in the game, so they get the
   *    most generous staffing budget and are considered before any further
   *    expansion of the raw economy. Venues are priced in planks and bricks, so
   *    when we cannot afford one yet this falls through to the material chain
   *    below and comes back to it later.
   */
  if (!economyOnly && slotPressure(s) < 1.6 && buildServices(s)) return

  // 4. The material chain that pays for those venues.
  if (slotPressure(s) > 1.25) return
  if (countPlanned(s, 'stonecuttersCamp') < 1 && tryPlace(s, 'stonecuttersCamp')) return
  if (countPlanned(s, 'herbalistsCamp') < 2 && tryPlace(s, 'herbalistsCamp')) return
  if (countPlanned(s, 'lumberMill') < 1 && tryPlace(s, 'lumberMill')) return
  if (countPlanned(s, 'clayPit') < 1 && tryPlace(s, 'clayPit')) return
  if (countPlanned(s, 'brickyard') < 1 && tryPlace(s, 'brickyard')) return
  // 5. Cooked food doubles the value of every unit gathered.
  if (countPlanned(s, 'cookhouse') < 1 && tryPlace(s, 'cookhouse')) return

  // 6. A cookhouse doubles what every one of those camps is worth.
  if (countPlanned(s, 'cookhouse') < 2 && pop > 18 && tryPlace(s, 'cookhouse')) return
}

/**
 * Housing packed around the hearth eventually spills past its warmth radius,
 * and those homes chill in the Storm. A competent player plants a brazier
 * among them rather than eating the resolve penalty.
 */
function warmSprawl(s: RunState): boolean {
  if (!s.unlockedBuildings.includes('brazier')) return false
  const braziers = Object.values(s.buildings).filter((b) => BUILDINGS[b.defId]?.warmth)
  const reach = BUILDINGS.brazier?.warmth?.radius ?? 0
  const cold = Object.values(s.buildings).filter(
    (b) =>
      b.built &&
      BUILDINGS[b.defId]?.category === 'housing' &&
      !isWarmAt(s, b.pos) &&
      // A planned (or guttering) brazier already covers it.
      !braziers.some((w) => dist(w.pos, b.pos) <= reach),
  )
  const target = cold[0]
  if (!target || !canAfford(s.stock, BUILDINGS.brazier.cost)) return false
  const pos = findPlacement(s, 'brazier', target.pos)
  if (!pos || dist(pos, target.pos) > reach) return false
  return placeBuilding(s, 'brazier', pos) === null
}

/** Stands up service venues and the chains that supply them. */
function buildServices(s: RunState): boolean {
  const pop = population(s)

  /*
   * Services cost a villager each and do nothing without goods to hand out, so
   * they wait until the settlement is fed and has hands to spare. Building an
   * unsupplied tavern at six villagers is how a run starves.
   */
  if (pop < 10 || foodStock(s) < pop) return false

  // Tapping resin costs a whole camp's output.
  if (
    wantsResin(s) &&
    pop >= 14 &&
    countPlanned(s, 'woodcuttersCamp') < 3 &&
    tryPlace(s, 'woodcuttersCamp')
  ) {
    return true
  }

  // Producers first: a venue is only worth staffing once something fills it.
  // Some producers serve two needs from different recipes (a weaver makes
  // either fabric or training gear), so we need one instance per recipe or one
  // of the two needs silently never gets supplied.
  for (const [producer, recipes] of wantedRecipes(s)) {
    if (countPlanned(s, producer) < recipes.size && tryPlace(s, producer)) return true
  }

  // Then the venues, but only where the goods will actually arrive — either we
  // make them, or a glade haul or caravan has left us a stack.
  for (const need of neededServices(s)) {
    const chain = SERVICE_CHAIN[need]
    if (countPlanned(s, chain.service) >= 1) continue
    const good = Object.keys(BUILDINGS[chain.service]?.recipes[0]?.inputs ?? {})[0]
    const supplied =
      countBuilt(s, chain.producer) >= 1 || (s.stock[good as never] ?? 0) >= 10
    if (supplied && tryPlace(s, chain.service)) return true
  }
  const required = Math.ceil(pop * SERVICE_COVERAGE_RATIO)
  for (const need of neededServices(s)) {
    const chain = SERVICE_CHAIN[need]
    const capacity =
      countBuilt(s, chain.service) * (BUILDINGS[chain.service]?.service?.capacity ?? 0)
    if (capacity > 0 && capacity < required && tryPlace(s, chain.service)) return true
  }
  return false
}

/** producer building id → the set of recipes the settlement needs from it. */
function wantedRecipes(s: RunState): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const need of neededServices(s)) {
    const chain = SERVICE_CHAIN[need]
    const set = out.get(chain.producer) ?? new Set<string>()
    set.add(chain.recipe)
    out.set(chain.producer, set)
  }
  return out
}

/** True when any needed service good is made from resin. */
function wantsResin(s: RunState): boolean {
  return [...wantedRecipes(s).values()].some(
    (set) => set.has('incense') || set.has('scroll'),
  )
}

/** True when any needed service good is made from plant fiber. */
function wantsFiber(s: RunState): boolean {
  return [...wantedRecipes(s).values()].some(
    (set) => set.has('fabric') || set.has('gear') || set.has('scroll'),
  )
}

/** Spreads the needed recipes across the producer instances we have. */
function tuneRecipes(s: RunState): void {
  const wanted = wantedRecipes(s)

  // Resin gates incense and scrolls, so dedicate one woodcutter to tapping.
  if (wantsResin(s)) {
    const camps = Object.values(s.buildings).filter(
      (b) => b.defId === 'woodcuttersCamp' && b.built,
    )
    if (camps.length > 1 && !camps.some((b) => b.activeRecipeId === 'resin')) {
      setRecipe(s, camps[0].id, 'resin')
    }
  }

  /*
   * Herbalists default to herbs, but fabric, scrolls and training gear all
   * start from plant fiber. Without a fiber camp, rest, education and brawling
   * can never be supplied, which silently handicaps every species that wants
   * them (harpies want both of theirs from fiber).
   */
  if (wantsFiber(s)) {
    const camps = Object.values(s.buildings).filter(
      (b) => b.defId === 'herbalistsCamp' && b.built,
    )
    const wantsHerb = [...wanted.values()].some((set) => set.has('tea') || set.has('incense'))
    camps.forEach((camp, index) => {
      const target = wantsHerb && index % 2 === 0 ? 'herb' : 'fiber'
      if (camp.activeRecipeId !== target) setRecipe(s, camp.id, target)
    })
  }

  for (const [producer, recipes] of wanted) {
    const instances = Object.values(s.buildings).filter(
      (b) => b.defId === producer && b.built,
    )
    // Round-robin so each needed good has somewhere to come from.
    const list = [...recipes]
    instances.forEach((building, index) => {
      const target = list[index % list.length]
      if (building.activeRecipeId !== target) setRecipe(s, building.id, target)
    })
  }
}

/** Sites currently under construction. */
function openSites(s: RunState): number {
  return Object.values(s.buildings).filter((b) => !b.built).length
}

/**
 * Idle villagers are the settlement's builders, so a few are always held back.
 * The reserve does not scale with the number of sites — the builder pool is
 * split across them, so queueing more work makes each site slower, not the
 * settlement poorer.
 */
function builderReserve(s: RunState): number {
  return openSites(s) > 0 ? Math.max(3, Math.round(population(s) * 0.2)) : 2
}

/** Material producers that venues are priced in. */
const MATERIAL_CHAIN = new Set(['lumberMill', 'brickyard', 'clayPit', 'stonecuttersCamp'])

/** How much of a good is "enough" — past this, its producers can spare a hand. */
function stockTarget(s: RunState, id: ResourceId): number {
  const pop = population(s)
  if (EDIBLE.includes(id)) {
    // Keep a Storm's worth of food in hand before the Storm arrives.
    return s.season.season === 'drizzle' ? pop * 7 + 40 : pop * 11 + 40
  }
  if (id === 'wood') return 120
  return 60
}

/** True when everything a building's current recipe makes is already in surplus. */
function saturated(s: RunState, b: BuildingInstance): boolean {
  const recipe = activeRecipe(b)
  const outputs = Object.keys(recipe?.outputs ?? {}) as ResourceId[]
  if (outputs.length === 0) return false
  if (EDIBLE.some((id) => outputs.includes(id))) {
    return foodStock(s) >= stockTarget(s, outputs[0])
  }
  return outputs.every((id) => (s.stock[id] ?? 0) >= stockTarget(s, id))
}

/**
 * Pulls one worker off a building whose output is piling up. Staffing is
 * otherwise first-come and permanent, so the camps built in the first minutes
 * would hold their crews forever while the deeper chains — where service goods
 * come from — sit empty and the stockpile fills with wood nobody needs.
 */
function releaseSurplus(s: RunState): void {
  for (const b of Object.values(s.buildings)) {
    if (!b.built || b.workers.length === 0) continue
    if (BUILDINGS[b.defId]?.category === 'service') continue
    if (saturated(s, b)) {
      removeWorker(s, b.id)
      return
    }
  }
}

/** Fills worker slots, keeping a few villagers free to build and clear. */
function staff(s: RunState): void {
  releaseSurplus(s)
  const reserve = builderReserve(s)
  const pop = population(s)
  const hungry = s.starving || foodStock(s) < pop * 4
  const cold = (s.stock.wood ?? 0) < 30

  // Producers that feed a wanted service — a venue without goods is worthless,
  // so these outrank the raw economy.
  const serviceProducers = new Set(wantedRecipes(s).keys())
  if (wantsFiber(s) || serviceProducers.has('apothecaryWorkshop')) {
    serviceProducers.add('herbalistsCamp')
  }

  const priority = (b: BuildingInstance): number => {
    const def = BUILDINGS[b.defId]
    if (!def) return 0
    const outputs = Object.keys(activeRecipe(b)?.outputs ?? {}) as ResourceId[]
    // Emergencies first: an empty larder or a dying hearth ends runs.
    if (hungry && outputs.some((id) => EDIBLE.includes(id))) return 7
    if (cold && outputs.includes('wood')) return 7
    if (saturated(s, b)) return -1
    // Then services and their supply chains — they are what keeps resolve up.
    if (def.category === 'service') return 5
    if (serviceProducers.has(b.defId)) return 4
    if (def.tags.includes('cooking')) return 3
    if (MATERIAL_CHAIN.has(b.defId)) return 3
    if (def.tags.includes('gathering') || def.tags.includes('farming')) return 2
    return 1
  }

  const targets = Object.values(s.buildings)
    .filter((b) => b.built && (BUILDINGS[b.defId]?.workerSlots ?? 0) > b.workers.length)
    .map((b) => ({ b, p: priority(b) }))
    .filter((t) => t.p >= 0)
    .sort((a, c) => c.p - a.p)

  for (const { b: building, p } of targets) {
    // In an emergency, dig into the builder reserve — but never the last
    // builder while a site is open, or a stalled warehouse starves everyone.
    const keep = p >= 7 ? (openSites(s) > 0 ? 1 : 0) : reserve
    while (
      idleVillagers(s).length > keep &&
      building.workers.length < (BUILDINGS[building.defId]?.workerSlots ?? 0)
    ) {
      if (assignWorker(s, building.id) !== null) break
    }
  }
}

/**
 * Keeps a crew on the cheapest reachable glade. Expansion is not optional — the
 * starting glade cannot supply a growing settlement — so this runs *before*
 * staffing and takes its people first.
 */
function explore(s: RunState): void {
  const pop = population(s)
  // A hungry settlement needs its hands at home, not in the woods.
  if (pop < 6 || s.starving) return

  const inProgress = Object.values(s.glades).find((g) => !g.cleared && g.clearers > 0)
  const crew = Math.min(4, Math.max(2, Math.floor(pop / 8)))
  if (inProgress) {
    // Top the existing crew up as the settlement grows.
    while (inProgress.clearers < crew && addClearer(s, inProgress.id) === null) {
      /* keep adding */
    }
    return
  }

  const target = Object.values(s.glades)
    .filter((g) => !g.cleared && isReachable(s, g.id))
    .sort((a, b) => a.clearWork - b.clearWork)[0]
  if (!target) return
  for (let i = 0; i < crew; i++) {
    if (addClearer(s, target.id) !== null) break
  }
}

/** Resolves whatever the sim is blocking on, preferring cheap safe options. */
function answerChoices(s: RunState): void {
  let guard = 0
  while (s.pendingChoices.length > 0 && guard++ < 20) {
    const choice = s.pendingChoices[0]
    if (choice.kind === 'gladeEvent') {
      const def = GLADE_EVENTS[choice.options[0]]
      // Prefer an affordable option that does not cost villagers or patience —
      // and never one that unleashes a threat the bot would have to pay off, or
      // leaves a lingering condition it has no plan to lift.
      let index = def.options.findIndex(
        (o) =>
          optionAffordable(s.stock, o) &&
          !o.villagerLoss &&
          !o.impatience &&
          !o.threat &&
          !o.condition &&
          (o.hostility ?? 0) <= 0,
      )
      if (index < 0) {
        index = def.options.findIndex(
          (o) =>
            optionAffordable(s.stock, o) && !o.villagerLoss && !o.threat,
        )
      }
      resolveGladeEvent(s, index >= 0 ? index : def.options.length - 1)
    } else if (choice.kind === 'blueprint') {
      // Prefer anything that unblocks a service the settlement needs.
      const wanted = new Set(
        neededServices(s).flatMap((n) => [
          SERVICE_CHAIN[n].service,
          SERVICE_CHAIN[n].producer,
        ]),
      )
      const pick = choice.options.find((id) => wanted.has(id)) ?? choice.options[0]
      takeChoice(s, pick)
    } else {
      takeChoice(s, choice.options[0])
    }
  }
}

interface PlayOptions {
  /** Never builds service venues or their supply chains — the idle economy. */
  economyOnly?: boolean
  maxMinutes?: number
  /** Force these map modifiers instead of the ones the seed draws. */
  modifiers?: string[]
}

/** Where a run's reputation came from. */
interface ReputationSources {
  orders: number
  glades: number
  events: number
  resolve: number
}

/** Plays one run to its conclusion (or `maxMinutes` of game time). */
function playRun(
  seed: number,
  species: SpeciesId[],
  options: PlayOptions = {},
): BotReport {
  const { economyOnly = false, maxMinutes = 45, modifiers } = options
  const s = createRun({ seed, species, modifiers })
  let sinceDecision = Infinity
  const maxSeconds = maxMinutes * 60
  const sources: ReputationSources = { orders: 0, glades: 0, events: 0, resolve: 0 }

  while (s.phase === 'playing' && s.clock < maxSeconds) {
    const beforeChoices = s.reputation
    answerChoices(s)
    sources.events += s.reputation - beforeChoices
    if (s.phase !== 'playing') break

    if (sinceDecision >= DECISION_INTERVAL) {
      sinceDecision = 0
      // Threats compound; a competent player pays them off when they can.
      for (const threat of [...s.threats]) appeaseThreat(s, threat.id)
      build(s, economyOnly)
      explore(s)
      tuneRecipes(s)
      staff(s)
    }

    const openOrders = s.orders.map((o) => o.defId)
    const gladesBefore = s.stats.gladesCleared
    tick(s, STEP)
    sinceDecision += STEP
    const stillOpen = new Set(s.orders.map((o) => o.defId))
    for (const id of openOrders) {
      if (!stillOpen.has(id)) sources.orders += orderReputation(s, ORDERS[id]?.reputationReward ?? 0)
    }
    sources.glades +=
      Math.floor(s.stats.gladesCleared / GLADES_PER_REPUTATION) -
      Math.floor(gladesBefore / GLADES_PER_REPUTATION)
  }
  // Resolve is whatever the discrete sources do not explain.
  sources.resolve = Math.max(
    0,
    s.reputation + s.reputationProgress - sources.orders - sources.glades - sources.events,
  )

  return {
    phase: s.phase,
    years: s.season.year,
    reputation: s.reputation,
    impatience: s.impatience,
    population: population(s),
    gladesCleared: s.stats.gladesCleared,
    ordersCompleted: s.stats.ordersCompleted,
    buildings: Object.values(s.buildings).filter((b) => b.built).length,
    minutes: Math.round(s.clock / 60),
    exactMinutes: s.clock / 60,
    hostility: Math.round(s.hostility),
    resolve: describeResolve(s),
    unmetNeeds: describeUnmet(s),
    starving: s.starving,
    coldHearth: s.coldHearth,
    services: describeServices(s),
    drafted: s.unlockedBuildings
      .filter((b) => !STARTING_BLUEPRINTS.includes(b))
      .join(','),
    sources,
    lost: s.stats.villagersLost,
    braziers: countPlanned(s, 'brazier'),
    modifiers: s.runModifiers.join(','),
    openOrders: s.orders.map((o) => `${o.defId}@${Math.round(o.progress * 100)}%`).join(','),
  }
}

/** One trio from the starting species and two that need a charter. */
const TRIOS: SpeciesId[][] = [
  ['human', 'beaver', 'lizard'],
  ['human', 'fox', 'harpy'],
  ['beaver', 'lizard', 'harpy'],
]

const ALL_SEEDS = [
  1, 20260726, 777, 424242, 99, 31337, 8080, 555000, 2024, 13, 4242, 90210, 1234567,
  271828, 314159, 8675309, 42, 1001, 65535, 7, 123, 5150, 60606, 98765,
]

/**
 * Env knobs for local balance sweeps, e.g.
 *   PLAYTEST_SEEDS=8 PLAYTEST_VERBOSE=1 npx vitest run playtest --reporter=verbose --silent=false
 * PLAYTEST_SEED=<n> replays a single seed across every trio.
 */
const ENV: Record<string, string | undefined> =
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}
/*
 * Every seed by default. The trio-parity check compares win rates across
 * three groups, and at 16 seeds a single lucky or unlucky map moves a trio by
 * six points — enough to trip a 25-point band on noise alone.
 */
const SEED_COUNT = Number(ENV.PLAYTEST_SEEDS ?? ALL_SEEDS.length)
const SEEDS = ENV.PLAYTEST_SEED ? [Number(ENV.PLAYTEST_SEED)] : ALL_SEEDS.slice(0, SEED_COUNT)
/** The economy-only bot is a control group; half the seeds are enough. */
const ECON_SEEDS = SEEDS.slice(0, Math.max(1, Math.ceil(SEEDS.length / 2)))

/** Seeds per forced map modifier (trios rotate across them). */
const MODIFIER_SEED_COUNT = Number(ENV.PLAYTEST_MODIFIER_SEEDS ?? 6)

/** The Queen's deadline must end every run by about this point. */
const VERDICT_BY_MINUTES = 40

const isEarlyCollapse = (r: BotReport) => r.phase === 'lost' && r.population === 0 && r.exactMinutes < 12
const winShare = (rs: BotReport[]) => rs.filter((r) => r.phase === 'won').length / rs.length
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

function summarise(label: string, reports: BotReport[]): string {
  const wins = reports.filter((r) => r.phase === 'won')
  const losses = reports.filter((r) => r.phase === 'lost')
  const stalls = reports.filter((r) => r.phase === 'playing')
  const src = (k: keyof ReputationSources) => mean(wins.map((r) => r.sources[k])).toFixed(1)
  return (
    `${label.padEnd(20)} won ${wins.length}/${reports.length} lost ${losses.length} stall ${stalls.length} early-collapse ${reports.filter(isEarlyCollapse).length}` +
    ` · avg win ${mean(wins.map((r) => r.exactMinutes)).toFixed(1)}min · longest ${Math.max(...reports.map((r) => r.exactMinutes)).toFixed(1)}min` +
    ` · rep in wins: orders ${src('orders')} glades ${src('glades')} events ${src('events')} resolve ${src('resolve')}`
  )
}

function logRun(seed: number, r: BotReport): void {
  console.log(
    `seed ${seed}: ${r.phase} · Y${r.years} ${r.minutes}min · rep ${r.reputation} imp ${r.impatience} · pop ${r.population} lost ${r.lost} · glades ${r.gladesCleared} · orders ${r.ordersCompleted} · bld ${r.buildings} · host ${r.hostility} · braziers ${r.braziers} · ${r.resolve} · unmet ${r.unmetNeeds}${r.starving ? ' STARVING' : ''}${r.coldHearth ? ' COLD' : ''}` +
      `\n    services: ${r.services}\n    drafted: ${r.drafted}\n    land: ${r.modifiers || 'none'} · open orders: ${r.openOrders}`,
  )
}

describe('balance harness', () => {
  it('a competent player can win, and the run has a real shape', () => {
    const lines: string[] = []
    const byTrio = TRIOS.map((trio) => {
      const reports = SEEDS.map((seed) => playRun(seed, trio))
      if (ENV.PLAYTEST_VERBOSE) reports.forEach((r, i) => logRun(SEEDS[i], r))
      lines.push(summarise(trio.join('/'), reports))
      return reports
    })
    const competent = byTrio.flat()
    const econ = TRIOS.flatMap((trio) => {
      const reports = ECON_SEEDS.map((seed) => playRun(seed, trio, { economyOnly: true }))
      if (ENV.PLAYTEST_VERBOSE) reports.forEach((r, i) => logRun(ECON_SEEDS[i], r))
      return reports
    })
    lines.push(summarise('all trios', competent))
    lines.push(summarise('economy-only', econ))
    console.log(lines.join('\n'))

    // A roguelite that can stalemate is broken: every run must reach a verdict,
    // and the Queen's deadline must deliver it in reasonable time.
    for (const r of [...competent, ...econ]) {
      expect(r.phase).not.toBe('playing')
      expect(r.exactMinutes).toBeLessThan(VERDICT_BY_MINUTES)
    }

    // A settlement that slips should have time to notice and respond: emptying
    // out inside the first twelve minutes must be rare.
    expect(competent.filter(isEarlyCollapse).length).toBeLessThanOrEqual(
      Math.ceil(competent.length * 0.05),
    )

    /*
     * The bot plays competently but not well — it never trades, never soothes
     * the Queen, and takes whatever the draft hands it. Most maps but not all
     * is the shape we want: a real player should comfortably beat this, and a
     * careless one should still lose sometimes.
     */
    const competentShare = winShare(competent)
    expect(competentShare).toBeGreaterThanOrEqual(0.4)
    expect(competentShare).toBeLessThan(0.95)

    // Services are the game. Idling above threshold with none must not win.
    const econShare = winShare(econ)
    expect(econShare).toBeLessThanOrEqual(0.1)
    expect(econShare).toBeLessThanOrEqual(competentShare / 4)

    // Buying a charter must not make the game harder (or much easier).
    const shares = byTrio.map(winShare)
    expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(0.25)

    const wins = competent.filter((x) => x.phase === 'won')
    // Reputation must come mostly from what the player did, not from idling.
    expect(mean(wins.map((r) => r.sources.resolve))).toBeLessThan(10)

    // A win should take a real settlement, not a lucky opening.
    for (const r of wins) {
      expect(r.buildings).toBeGreaterThan(8)
      expect(r.population).toBeGreaterThan(10)
      expect(r.minutes).toBeGreaterThan(8)
    }
  }, 300_000)

  /*
   * Every run now draws one or two map modifiers, so the sweep above already
   * mixes them in — but a seed sample can miss one entirely. Force each in
   * turn on a smaller set (rotating the trios) and compare against the same
   * seeds with no modifier, so no single twist makes runs unwinnable or turns
   * them into a formality.
   */
  it('no single map modifier makes runs unwinnable or trivial', () => {
    const seeds = ALL_SEEDS.slice(0, MODIFIER_SEED_COUNT)
    const sweep = (modifiers: string[]) =>
      seeds.map((seed, i) => playRun(seed, TRIOS[i % TRIOS.length], { modifiers }))
    const baseline = sweep([])
    const lines = [summarise('no modifier', baseline)]
    const results = RUN_MODIFIER_LIST.map((def) => {
      const reports = sweep([def.id])
      lines.push(summarise(def.id, reports))
      return { id: def.id, reports }
    })
    console.log(lines.join('\n'))

    const baseShare = winShare(baseline)
    for (const { id, reports } of results) {
      const share = winShare(reports)
      const wins = reports.filter((r) => r.phase === 'won')
      // Winnable: a competent player still takes a fair share of these maps,
      // and not far fewer than without the modifier.
      expect(share, `${id} win share`).toBeGreaterThanOrEqual(1 / 3)
      expect(share, `${id} vs baseline`).toBeGreaterThanOrEqual(baseShare - 0.5)
      // Not trivial: wins still take a real settlement and a real while.
      expect(mean(wins.map((r) => r.exactMinutes)), `${id} avg win`).toBeGreaterThanOrEqual(12)
      for (const r of wins) expect(r.exactMinutes, `${id} win time`).toBeGreaterThan(8)
      // And a twist must not empty the settlement in the opening minutes.
      expect(reports.filter(isEarlyCollapse).length, `${id} early collapses`).toBeLessThanOrEqual(1)
      for (const r of reports) expect(r.exactMinutes).toBeLessThan(VERDICT_BY_MINUTES)
    }
  }, 300_000)

  it('grows a settlement past its starting six villagers', () => {
    const s = createRun({ seed: 4242, species: ['human', 'fox', 'harpy'] })
    let sinceDecision = Infinity
    while (s.phase === 'playing' && s.clock < 600) {
      answerChoices(s)
      if (sinceDecision >= DECISION_INTERVAL) {
        sinceDecision = 0
        build(s)
        explore(s)
        staff(s)
      }
      tick(s, STEP)
      sinceDecision += STEP
    }
    expect(population(s)).toBeGreaterThan(6)
    expect(totalHousing(s)).toBeGreaterThan(0)
    expect(foodStock(s)).toBeGreaterThan(0)
    expect(s.stats.buildingsBuilt).toBeGreaterThan(3)
  }, 60_000)
})
