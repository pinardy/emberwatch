import { describe, expect, it } from 'vitest'
import { BUILDINGS, STARTING_BLUEPRINTS } from '../content/buildings'
import { CORNERSTONES } from '../content/cornerstones'
import { GLADE_EVENTS } from '../content/gladeEvents'
import { ORDERS } from '../content/orders'
import { DECREES } from '../content/decrees'
import { RESOURCE_LIST } from '../content/resources'
import { ALL_RUN_MODIFIER_LIST } from '../content/runModifiers'
import { SPECIES } from '../content/species'
import { EDIBLE } from '../content/resources'
import type {
  BuildingInstance,
  ConditionSpec,
  GladeEventOptionDef,
  Order,
  PendingChoice,
  ResourceBag,
  ResourceId,
  RoyalDecree,
  RunState,
  ServiceNeed,
  SpeciesId,
  Vec2,
} from '../types'
import {
  DUMP_LOT,
  addClearer,
  assignWorker,
  dumpStock,
  findPlacement,
  isReachable,
  placeBuilding,
  canUpgradeBuilding,
  removeWorker,
  reclaimGlade,
  setRecipe,
  spareGlade,
  upgradeBuilding,
} from './actions'
import { GLADES_PER_REPUTATION, IMPATIENCE_PER_VILLAGER_LOST, ROAD_MAX_LENGTH } from './balance'
import { createRun } from './createRun'
import { computeModifiers } from './modifiers'
import { pendingBlight } from './blights'
import { storageBlocked } from './forecast'
import { impatienceParts, resolveBreakdowns } from './society'
import {
  appeaseThreat,
  optionAffordable,
  relevantBlueprints,
  resolveGladeEvent,
  takeChoice,
} from './events'
import {
  HEARTH_STORM_END_REACH,
  SERVICE_COVERAGE_RATIO,
  activeRecipe,
  canAfford,
  comfortableHousing,
  foodStock,
  idleVillagers,
  population,
  isWarmAt,
  serviceCoverage,
  storageUsed,
  totalHousing,
} from './queries'
import { dist } from './geometry'
import {
  benefitsFromRoad,
  canPlaceRoad,
  placeRoad,
  roadCost,
  roadLinkOf,
  roadNetwork,
} from './roads'
import { tick } from './tick'
import { productionRate } from './forecast'
import { DECLINE_CHOICE, orderDeclineBlocked, orderGoal, orderReputation } from './orders'
import { categoryRate, decreeGoal, decreeReputation } from './structure'
import { baseServiceCapacity, isInsulated, isUpgrading, tierOf, workerSlotsOf } from './upgrades'

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
  /** Decrees met / lapsed. */
  decreesMet: number
  decreesMissed: number
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
  /** Glades left to the forest at the end. */
  spared: number
  /** Villagers the Storm's cold took. */
  frozen: number
  /** Upgrade tiers standing at the end, across every building. */
  upgrades: number
  /** Map modifiers the seed drew (or the test forced). */
  modifiers: string
  /** Orders still open at the end, with progress — stuck ones explain slow runs. */
  openOrders: string
  /** Road stretches laid, and workplaces joined to a hub by road at the end. */
  roads: number
  roadLinked: number
  /** Minute the first whole point of reputation landed (Infinity if never). */
  firstRepMinute: number
  /** Share of the final reputation earned in the run's last three minutes. */
  lateShare: number
  /** Reputation at the end of each whole minute. */
  curve: number[]
  /** Why a lost run was lost: the deadline, impatience before it, or an empty hearth. */
  cause: string
  /** Storm blights forecast, struck and turned aside. */
  blights: { forecast: number; struck: number; blunted: number }
  /** Minutes a firekeeper burned offerings at the hearth. */
  wardMinutes: number
  /** Impatience the Queen added for stalling (species below threshold). */
  stallImpatience: number
  /** Impatience by cause over the whole run (see `ImpatienceSources`). */
  impatienceBy: ImpatienceSources
  /** Resolve above (or below) each present species' live reputation threshold at the end. */
  overThreshold: number[]
}

/**
 * Where the Queen's impatience came from: the passive rates (calendar and
 * hostility, species below threshold, reputation standing still, the deadline)
 * and the jumps between them — villagers lost, and everything else (lapsed
 * decrees, declined offers, glade events, threat strikes, net of relief).
 */
interface ImpatienceSources {
  calendar: number
  stalling: number
  stagnation: number
  deadline: number
  losses: number
  events: number
}

/** Snapshot of resolve versus the threshold each species must beat. */
function describeResolve(s: RunState): string {
  const mods = computeModifiers(s)
  return resolveBreakdowns(s, mods)
    .map((b) => `${b.species}=${b.current.toFixed(0)}/${b.threshold}`)
    .join(' ')
}

/** Resolve minus the live reputation threshold, per species present. */
function overThreshold(s: RunState): number[] {
  const mods = computeModifiers(s)
  const present = new Set(Object.values(s.villagers).map((v) => v.species))
  return resolveBreakdowns(s, mods)
    .filter((b) => present.has(b.species))
    .map((b) => b.current - b.threshold)
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
function tryPlace(s: RunState, defId: string, accept?: (pos: Vec2) => boolean): boolean {
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
  // The spot the search found is the best on offer; refuse it if it is not
  // good enough (a home out in the cold) and let the caller fall back.
  if (accept && !accept(pos)) return false
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
    if (b.built && !saturated(s, b)) slots += workerSlotsOf(b)
  }
  return slots / Math.max(1, population(s))
}

/** Build order. First entry whose condition holds and which can be placed wins. */
function build(s: RunState, economyOnly = false): void {
  // Keep at most two sites open so construction actually finishes.
  if (openSites(s) >= 2) return
  const pop = population(s)

  // Housing and storage need no workers, so they are never gated.
  if (totalHousing(s) < pop + 4 && buildHousing(s)) return
  // A decree for homes is worth raising them early.
  if (decreeWants(s)?.housing && buildHousing(s)) return
  if (
    storageUsed(s) > s.storageCap * 0.8 &&
    (tryPlace(s, 'warehouse') || tryUpgrade(s, ['warehouse']))
  ) {
    return
  }
  // Homes that sprawled past the hearth's reach get a brazier before the Storm.
  if (warmSprawl(s)) return
  // The coming Storm's blight wants goods made: raise a producer if none stands.
  if (prepareForBlight(s)) return

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

  // Comfort is resolve for everyone and costs no worker: once the venues are
  // seen to, raise shelters into lodges with the planks left over.
  if (comfortUpgrade(s)) return

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
 * Out of housing. A new home goes up while there is warm ground for it; once
 * the hearth's reach is full, raising a home that already stands (more beds,
 * insulated walls) beats sprawling into the cold. Only when nothing can be
 * upgraded does a home go up out in the cold.
 */
function buildHousing(s: RunState): boolean {
  for (const defId of ['cabin', 'shelter']) {
    if (tryPlace(s, defId, (pos) => isWarmAt(s, pos))) return true
  }
  if (tryUpgrade(s, ['cabin', 'shelter'])) return true
  return tryPlace(s, 'cabin') || tryPlace(s, 'shelter')
}

/**
 * Most of the settlement sleeping in comfort (cabins, lodges) is worth a
 * resolve bonus to every species. A shelter takes two tiers to get there, so
 * this keeps a plank reserve for venues and only works on one at a time.
 */
function comfortUpgrade(s: RunState): boolean {
  const pop = population(s)
  if (pop < 12 || comfortableHousing(s) >= pop * 0.6) return false
  if ((s.stock.plank ?? 0) < 15) return false
  if (Object.values(s.buildings).some((b) => b.defId === 'shelter' && isUpgrading(b))) return false
  return tryUpgrade(s, ['shelter'])
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
      !isInsulated(b) &&
      // The hearth's reach pulls in through the Storm: plan for its end.
      !isWarmAt(s, b.pos, HEARTH_STORM_END_REACH) &&
      // A planned (or guttering) brazier already covers it.
      !braziers.some((w) => dist(w.pos, b.pos) <= reach),
  )
  const target = cold[0]
  if (!target || !canAfford(s.stock, BUILDINGS.brazier.cost)) return false
  const pos = findPlacement(s, 'brazier', target.pos)
  if (!pos || dist(pos, target.pos) > reach) return false
  return placeBuilding(s, 'brazier', pos) === null
}

/** Wood the bot keeps in hand before it spends any on roads. */
const ROAD_WOOD_RESERVE = 35

/**
 * Joins one unconnected workplace to the road network per decision: a road
 * from its door to the nearest point that already leads to a hub (the hearth,
 * a warehouse, or a connected road end), bending once around a crag or a
 * deposit when the straight line is blocked. Only with wood to spare, and
 * never at the cost of the Storm's fuel. Staffed workplaces nearest the
 * network go first — the cheapest bonus on offer.
 */
function layRoads(s: RunState): boolean {
  const wood = s.stock.wood ?? 0
  if (wood < ROAD_WOOD_RESERVE + 2) return false
  if (s.season.season === 'storm' && wood < 80) return false
  const net = roadNetwork(s)
  const targets: Vec2[] = [
    ...net.hubs.map((h) => h.pos),
    ...net.nodes.filter((_, i) => net.hubDistance[i] < Infinity),
  ]
  const nearest = (p: Vec2) => Math.min(...targets.map((t) => dist(p, t)))
  const memo = roadFailed.get(s) ?? new Set<string>()
  roadFailed.set(s, memo)
  const candidates = Object.values(s.buildings)
    .filter(
      (b) =>
        b.built &&
        b.workers.length > 0 &&
        benefitsFromRoad(BUILDINGS[b.defId]) &&
        !roadLinkOf(s, b).connected &&
        !memo.has(`${b.id}:${s.stats.gladesCleared}`),
    )
    .sort((a, b) => nearest(a.pos) - nearest(b.pos))
  const building = candidates[0]
  if (!building) return false
  const from = building.pos
  const ordered = [...targets].sort((a, b) => dist(from, a) - dist(from, b)).slice(0, 4)
  for (const to of ordered) {
    for (const route of routesBetween(from, to)) {
      const pieces = splitRoute(route)
      const cost = pieces.reduce((sum, [a, b]) => sum + (roadCost(dist(a, b)).wood ?? 0), 0)
      if (wood - cost < ROAD_WOOD_RESERVE) continue
      if (pieces.some(([a, b]) => canPlaceRoad(s, a, b) !== null)) continue
      for (const [a, b] of pieces) placeRoad(s, a, b)
      return true
    }
  }
  memo.add(`${building.id}:${s.stats.gladesCleared}`)
  return false
}

const roadFailed = new WeakMap<RunState, Set<string>>()

/** A straight line, then a bend either side of it at two widths. */
function routesBetween(a: Vec2, b: Vec2): Vec2[][] {
  const length = dist(a, b)
  if (length < 0.5) return []
  const nx = -(b.y - a.y) / length
  const ny = (b.x - a.x) / length
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const routes: Vec2[][] = [[a, b]]
  for (const k of [1.2, -1.2, 2.4, -2.4]) {
    routes.push([a, { x: mid.x + nx * k, y: mid.y + ny * k }, b])
  }
  return routes
}

/** Breaks a polyline into stretches no longer than a road may be. */
function splitRoute(points: Vec2[]): [Vec2, Vec2][] {
  const out: [Vec2, Vec2][] = []
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const n = Math.max(1, Math.ceil(dist(a, b) / ROAD_MAX_LENGTH))
    for (let k = 0; k < n; k++) {
      out.push([
        { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n },
        k === n - 1 ? b : { x: a.x + ((b.x - a.x) * (k + 1)) / n, y: a.y + ((b.y - a.y) * (k + 1)) / n },
      ])
    }
  }
  return out
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
  /*
   * Short on capacity: upgrading a venue that stands needs no extra worker
   * and burns no extra goods, so it comes before raising a second one.
   */
  const required = Math.ceil(pop * SERVICE_COVERAGE_RATIO)
  for (const need of neededServices(s)) {
    const chain = SERVICE_CHAIN[need]
    const capacity = Object.values(s.buildings)
      .filter((b) => b.defId === chain.service && b.built)
      .reduce((sum, b) => sum + baseServiceCapacity(b), 0)
    if (capacity <= 0 || capacity >= required) continue
    if (tryUpgrade(s, [chain.service]) || tryPlace(s, chain.service)) return true
  }
  return false
}

/**
 * Starts the next tier on the least-upgraded standing instance of any of
 * `defIds` that can take one right now (built, idle, affordable).
 */
function tryUpgrade(s: RunState, defIds: string[]): boolean {
  // One upgrade at a time: they only get builders the new sites leave idle.
  if (Object.values(s.buildings).some(isUpgrading)) return false
  const candidate = Object.values(s.buildings)
    .filter((b) => defIds.includes(b.defId) && canUpgradeBuilding(s, b.id) === null)
    .sort((a, b) => tierOf(a) - tierOf(b))[0]
  return !!candidate && upgradeBuilding(s, candidate.id) === null
}

/** producer building id → the set of recipes the settlement needs from it. */
function wantedRecipes(s: RunState): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const need of neededServices(s)) {
    const chain = SERVICE_CHAIN[need]
    const set = out.get(chain.producer) ?? new Set<string>()
    /*
     * A recipe whose input comes off the same workshop (training gear is cut
     * from fabric, both at the weaver) needs that recipe running too, ahead
     * of it. Without this, a settlement that wanted brawling but not rest set
     * its only weaver to gear and waited forever for fabric nobody wove.
     */
    const recipes = BUILDINGS[chain.producer]?.recipes ?? []
    const target = recipes.find((r) => r.id === chain.recipe)
    for (const input of Object.keys(target?.inputs ?? {})) {
      const feeder = recipes.find((r) => r.id !== chain.recipe && input in r.outputs)
      if (feeder) set.add(feeder.id)
    }
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

/** A workshop whose wanted recipe burns resin is built or under way. */
function resinConsumerPlanned(s: RunState): boolean {
  for (const [producer, recipes] of wantedRecipes(s)) {
    const usesResin = [...recipes].some(
      (id) => (BUILDINGS[producer]?.recipes.find((r) => r.id === id)?.inputs.resin ?? 0) > 0,
    )
    if (usesResin && countPlanned(s, producer) > 0) return true
  }
  return false
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

  /*
   * Resin gates incense and scrolls, so dedicate one woodcutter to tapping —
   * once a workshop that burns it has been started. Tapping from minute one,
   * for a chain that is minutes away, halves the wood of a settlement that
   * cannot yet afford a warehouse, and slow builders never dig out of that.
   */
  if (wantsResin(s) && resinConsumerPlanned(s)) {
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

/**
 * New sites under construction. Upgrades wait for builders until these are
 * done, so they do not count toward the bot's limit on open sites.
 */
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
  // Output an open order or the live decree is counting is never surplus.
  if (servesDecree(s, b) || servesOrder(s, b)) return false
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

  // The coming Storm's blight asks for a good: its makers jump the queue.
  const prepGood = blightGood(s)

  const priority = (b: BuildingInstance): number => {
    const def = BUILDINGS[b.defId]
    if (!def) return 0
    // The hearth's firekeeper is staffed by `tendWard`, never as filler.
    if (def.ward) return -1
    const outputs = Object.keys(activeRecipe(b)?.outputs ?? {}) as ResourceId[]
    // Emergencies first: an empty larder or a dying hearth ends runs.
    if (hungry && outputs.some((id) => EDIBLE.includes(id))) return 7
    if (cold && outputs.includes('wood')) return 7
    if (prepGood && outputs.includes(prepGood)) return 6
    if (saturated(s, b)) return -1
    // Then services and their supply chains — they are what keeps resolve up.
    if (def.category === 'service') return 5
    // A live decree's producers come next: the deadline is real.
    if (servesDecree(s, b)) return 4.5
    if (serviceProducers.has(b.defId)) return 4
    if (def.tags.includes('cooking')) return 3
    if (MATERIAL_CHAIN.has(b.defId)) return 3
    if (def.tags.includes('gathering') || def.tags.includes('farming')) return 2
    return 1
  }

  const targets = Object.values(s.buildings)
    .filter((b) => b.built && workerSlotsOf(b) > b.workers.length)
    .map((b) => ({ b, p: priority(b) }))
    .filter((t) => t.p >= 0)
    .sort((a, c) => c.p - a.p)

  for (const { b: building, p } of targets) {
    // In an emergency, dig into the builder reserve — but never the last
    // builder while a site is open, or a stalled warehouse starves everyone.
    const keep = p >= 7 ? (openSites(s) > 0 ? 1 : 0) : reserve
    while (
      idleVillagers(s).length > keep &&
      building.workers.length < workerSlotsOf(building)
    ) {
      if (assignWorker(s, building.id) !== null) break
    }
  }
}

/** The good the coming Storm's blight asks to be made, if one is forecast. */
function blightGood(s: RunState): ResourceId | null {
  const goal = pendingBlight(s)?.resolveBy
  return goal?.kind === 'produced' || goal?.kind === 'stock' ? goal.resource : null
}

/** Places a producer of the forecast blight's good when none is standing. */
function prepareForBlight(s: RunState): boolean {
  const good = blightGood(s)
  if (!good) return false
  const makers = STARTING_BLUEPRINTS.filter((id) =>
    BUILDINGS[id]?.recipes.some((r) => (r.outputs[good] ?? 0) > 0),
  )
  if (makers.some((id) => countPlanned(s, id) > 0)) return false
  return makers.some((id) => tryPlace(s, id))
}

/** Hostility at which the bot sets a firekeeper to burn offerings, and stops. */
const WARD_START = 26
const WARD_STOP = 14

/**
 * The hearth's offerings: once the forest's hostility bites, one villager
 * burns herbs at the hearth (and a herbalist camp is kept on herbs to feed
 * it); when hostility has been calmed, or the herbs run out, they go back to
 * the idle pool.
 */
function tendWard(s: RunState): void {
  const hearth = Object.values(s.buildings).find((b) => BUILDINGS[b.defId]?.ward)
  if (!hearth) return
  const herbs = s.stock.herb ?? 0
  const staffed = hearth.workers.length > 0
  if (staffed && (s.hostility < WARD_STOP || herbs < 2)) {
    removeWorker(s, hearth.id)
    return
  }
  if (!staffed && s.hostility >= WARD_START && population(s) >= 12) {
    if (herbs >= 6) assignWorker(s, hearth.id)
    // Keep one herbalist on herbs while the forest needs calming.
    const herbalists = Object.values(s.buildings).filter(
      (b) => b.defId === 'herbalistsCamp' && b.built,
    )
    if (herbalists.length > 0 && !herbalists.some((b) => activeRecipe(b)?.id === 'herb')) {
      setRecipe(s, herbalists[herbalists.length - 1].id, 'herb')
    }
  }
}

/**
 * A full store that is stopping production: when no warehouse can be afforded
 * (the usual deadlock — it needs the stone the stopped stonecutters make),
 * dump some of the largest surplus to get the producers working again.
 */
function dumpSurplus(s: RunState): void {
  if (storageUsed(s) < s.storageCap) return
  if (storageBlocked(s, computeModifiers(s)).length === 0) return
  if (canAfford(s.stock, BUILDINGS.warehouse.cost)) return
  let worst: ResourceId | null = null
  let excess = 0
  for (const [id, amount] of Object.entries(s.stock) as [ResourceId, number][]) {
    if (id === 'amber' || EDIBLE.includes(id)) continue
    const over = amount - stockTarget(s, id) * 0.6
    if (over > excess) {
      excess = over
      worst = id
    }
  }
  if (worst) dumpStock(s, worst, Math.min(DUMP_LOT, Math.ceil(excess)))
}

/**
 * Glades the bot reclaims before it weighs leaving the rest to the forest:
 * enough for two of the Citadel's reclaimed-land points and the ground and
 * deposits a full settlement needs.
 */
const GLADES_BEFORE_SPARING = 2 * GLADES_PER_REPUTATION
/** Past that, hostility at which the bot spares the glades on its border. */
const SPARE_AT_HOSTILITY = 25

/**
 * Keeps a crew on the cheapest reachable glade. Expansion is not optional — the
 * starting glade cannot supply a growing settlement — so this runs *before*
 * staffing and takes its people first. Once the settlement holds enough land
 * and the forest is pressing, every further glade costs hostility for loot it
 * no longer needs, so the bot leaves the glades on its border to the forest
 * instead (they calm it for as long as they stand).
 */
function explore(s: RunState): void {
  const pop = population(s)
  // A hungry settlement needs its hands at home, not in the woods.
  if (pop < 6 || s.starving) return

  // An open order for glades is worth clearing for first.
  const gladeOrder = s.orders.some((o) => orderGoal(o)?.kind === 'gladesCleared')
  if (
    !gladeOrder &&
    s.stats.gladesCleared >= GLADES_BEFORE_SPARING &&
    s.hostility >= SPARE_AT_HOSTILITY
  ) {
    for (const g of Object.values(s.glades)) {
      if (g.cleared || g.spared || !isReachable(s, g.id)) continue
      // A crew more than halfway through finishes the job.
      if (g.clearers > 0 && g.clearProgress >= g.clearWork / 2) continue
      spareGlade(s, g.id)
    }
  }

  const inProgress = Object.values(s.glades).find((g) => !g.cleared && g.clearers > 0)
  const crew = Math.min(4, Math.max(2, Math.floor(pop / 8)))
  if (inProgress) {
    // Top the existing crew up as the settlement grows.
    while (inProgress.clearers < crew && addClearer(s, inProgress.id) === null) {
      /* keep adding */
    }
    return
  }

  const border = Object.values(s.glades).filter((g) => !g.cleared && isReachable(s, g.id))
  let target = border.filter((g) => !g.spared).sort((a, b) => a.clearWork - b.clearWork)[0]
  if (!target && gladeOrder) {
    // The order is worth more than the truce: break it on the cheapest glade.
    target = border.sort((a, b) => a.clearWork - b.clearWork)[0]
    if (target) reclaimGlade(s, target.id)
  }
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
      // A greedy option is worth it when it pays reputation and its risk is
      // one the bot can settle: a threat it can pay off right away, or a
      // lingering task it is already most of the way through.
      let index = def.options.findIndex(
        (o) =>
          optionAffordable(s.stock, o) &&
          (o.reputation ?? 0) >= 1 &&
          !o.villagerLoss &&
          (o.impatience ?? 0) <= 0 &&
          (!o.threat || canAffordAfter(s, o, o.threat.appease)) &&
          (!o.condition || conditionWithinReach(s, o.condition)),
      )
      if (index < 0) {
        index = def.options.findIndex(
          (o) =>
            optionAffordable(s.stock, o) &&
            !o.villagerLoss &&
            (o.impatience ?? 0) <= 0 &&
            !o.threat &&
            !o.condition &&
            (o.hostility ?? 0) <= 0,
        )
      }
      if (index < 0) {
        index = def.options.findIndex(
          (o) =>
            optionAffordable(s.stock, o) && !o.villagerLoss && !o.threat,
        )
      }
      resolveGladeEvent(s, index >= 0 ? index : def.options.length - 1)
    } else if (choice.kind === 'blueprint') {
      // Prefer anything that unblocks a service the settlement needs; failing
      // that, a strong cornerstone beats a blueprint nobody will staff.
      const wanted = new Set(
        neededServices(s).flatMap((n) => [
          SERVICE_CHAIN[n].service,
          SERVICE_CHAIN[n].producer,
        ]),
      )
      const buildings = choice.options.filter((id) => BUILDINGS[id])
      const stones = choice.options.filter((id) => !BUILDINGS[id])
      // Finishing a chain beats starting one: a producer for a venue already
      // drafted comes first (the order `relevantBlueprints` ranks them in).
      const ranked = relevantBlueprints(s)
      const finisher = choice.options
        .filter((id) => ranked.includes(id))
        .sort((a, b) => ranked.indexOf(a) - ranked.indexOf(b))[0]
      const pick =
        finisher ??
        choice.options.find((id) => wanted.has(id)) ??
        stones.find((id) => cornerstoneScore(id) >= 2) ??
        buildings[0] ??
        choice.options[0]
      takeChoice(s, pick)
    } else if (choice.kind === 'order') {
      takeChoice(s, pickOrder(s, choice))
    } else if (choice.kind === 'decree') {
      takeChoice(s, pickDecree(s, choice))
    } else if (choice.kind === 'cornerstone') {
      const best = [...choice.options].sort((a, b) => cornerstoneScore(b) - cornerstoneScore(a))[0]
      takeChoice(s, best)
    } else {
      takeChoice(s, choice.options[0])
    }
  }
}

/** True when paying `price` would still be possible after the option's own cost. */
function canAffordAfter(s: RunState, o: GladeEventOptionDef, price: ResourceBag): boolean {
  const after: ResourceBag = { ...s.stock }
  for (const [id, n] of Object.entries(o.cost ?? {})) after[id as ResourceId] = (after[id as ResourceId] ?? 0) - (n ?? 0)
  for (const [id, n] of Object.entries(o.gain ?? {})) after[id as ResourceId] = (after[id as ResourceId] ?? 0) + (n ?? 0)
  return canAfford(after, price)
}

/** A lingering task the settlement is already well on the way to meeting. */
function conditionWithinReach(s: RunState, c: ConditionSpec): boolean {
  const goal = c.resolveBy
  if (goal.kind === 'gladesCleared') {
    const open = Object.values(s.glades).filter((g) => !g.cleared && isReachable(s, g.id)).length
    return open >= goal.amount + 1 && (c.deadline ?? Infinity) >= 200 * goal.amount
  }
  if (goal.kind === 'stock') return (s.stock[goal.resource] ?? 0) >= goal.amount * 0.6
  return false
}

/**
 * How much a cornerstone is worth to this bot: 3 for what moves the meters
 * (resolve, reputation, patience), 2 for a strong economy, 1 for the rest.
 */
function cornerstoneScore(id: string): number {
  const def = CORNERSTONES[id]
  if (!def) return 0
  let score = 1
  for (const e of def.effects) {
    if (
      e.kind === 'resolveFlat' ||
      e.kind === 'reputationRate' ||
      e.kind === 'impatienceRate' ||
      e.kind === 'needsFewerServices'
    ) {
      score = Math.max(score, e.kind === 'resolveFlat' && e.species !== 'all' ? 2 : 3)
    } else if (
      e.kind === 'hostilityRate' ||
      e.kind === 'gladeHostility' ||
      e.kind === 'stormResolve' ||
      (e.kind === 'productionSpeed' && e.tag === 'all')
    ) {
      score = Math.max(score, 2)
    }
  }
  return score
}

/** What the live decree asks the bot to push, if anything. */
function decreeWants(s: RunState): { resources: ResourceId[]; housing: boolean } | null {
  const goal = s.decree ? decreeGoal(s.decree) : undefined
  if (!goal) return null
  if (goal.kind === 'produced') return { resources: [goal.resource], housing: false }
  if (goal.kind === 'stockCategory' || goal.kind === 'producedCategory') {
    const ids = RESOURCE_LIST.filter((r) => r.category === goal.category).map((r) => r.id)
    return { resources: ids, housing: false }
  }
  if (goal.kind === 'buildingsOfCategory' && goal.category === 'housing') {
    return { resources: [], housing: true }
  }
  return null
}

/** True when the building's current recipe makes what the live decree asks for. */
function servesDecree(s: RunState, b: BuildingInstance): boolean {
  const wants = decreeWants(s)
  if (!wants || wants.resources.length === 0) return false
  const outputs = activeRecipe(b)?.outputs ?? {}
  return wants.resources.some((id) => ((outputs as Record<string, number>)[id] ?? 0) > 0)
}

/** True when the building's current recipe makes what an open order counts. */
function servesOrder(s: RunState, b: BuildingInstance): boolean {
  const outputs = (activeRecipe(b)?.outputs ?? {}) as Record<string, number>
  return s.orders.some((order) => {
    const goal = orderGoal(order)
    if (!goal) return false
    if (goal.kind === 'produced' || goal.kind === 'stock') return (outputs[goal.resource] ?? 0) > 0
    if (goal.kind === 'producedCategory' || goal.kind === 'stockCategory') {
      return RESOURCE_LIST.some((r) => r.category === goal.category && (outputs[r.id] ?? 0) > 0)
    }
    return false
  })
}

/**
 * How promising an order looks to a competent player: how far along it is,
 * plus whether the settlement is already making what it asks for. It reads
 * only what the order card shows and what the player can see in the panels.
 */
function orderPromise(s: RunState, order: Order): number {
  const goal = orderGoal(order)
  const def = ORDERS[order.defId]
  if (!goal || !def) return 0
  const mods = computeModifiers(s)
  let score = order.progress + 0.1 * def.reputationReward
  switch (goal.kind) {
    case 'stock':
    case 'produced':
      // Nothing makes it yet: a slot that would sit idle.
      score += productionRate(s, mods, goal.resource) > 0 ? 0.5 : -0.2
      break
    case 'stockCategory':
    case 'producedCategory':
      if (categoryRate(s, mods, goal.category) > 0) score += 0.5
      break
    case 'gladesCleared':
    case 'staffed':
      score += 0.5
      break
    case 'population':
    case 'housing':
      score += 0.4
      break
    case 'buildingsOfCategory':
    case 'buildingId':
      score += 0.2
      break
    default:
      break
  }
  return score
}

/** Takes the more promising order; asks for another pair if both look hopeless. */
function pickOrder(s: RunState, choice: PendingChoice): string {
  const ranked = [...(choice.orders ?? [])].sort((a, b) => orderPromise(s, b) - orderPromise(s, a))
  const best = ranked[0]
  if (!best) return choice.options[0]
  if (orderPromise(s, best) < 0.3 && !orderDeclineBlocked(s, choice)) return DECLINE_CHOICE
  return best.id
}

/** Rough chance of meeting a decree in time, from what the settlement does now. */
function decreeOdds(s: RunState, decree: RoyalDecree): number {
  const goal = decreeGoal(decree)
  if (!goal) return 0
  const mods = computeModifiers(s)
  switch (goal.kind) {
    case 'produced':
      return (productionRate(s, mods, goal.resource) * decree.timeLimit) / goal.amount
    case 'stockCategory': {
      const rate = categoryRate(s, mods, goal.category)
      return (decree.progress * goal.amount + rate * decree.timeLimit * 0.25) / goal.amount
    }
    case 'producedCategory':
      return (categoryRate(s, mods, goal.category) * decree.timeLimit) / goal.amount
    case 'gladesCleared':
      return Object.values(s.glades).some((g) => !g.cleared && g.clearers > 0) ? 0.9 : 0.6
    case 'buildingsOfCategory':
      return goal.category === 'housing' ? 0.8 : 0.4
    default:
      return 0.4
  }
}

/** Takes the decree most likely to be met; begs off when neither looks likely. */
function pickDecree(s: RunState, choice: PendingChoice): string {
  const ranked = [...(choice.decrees ?? [])]
    .map((d) => ({ d, odds: decreeOdds(s, d) + 0.05 * (DECREES[d.defId]?.reputationReward ?? 0) }))
    .sort((a, b) => b.odds - a.odds)
  const best = ranked[0]
  if (!best || best.odds < 0.5) return DECLINE_CHOICE
  return best.d.id
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
  decrees: number
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
  const sources: ReputationSources = { orders: 0, decrees: 0, glades: 0, events: 0, resolve: 0 }
  let wardSeconds = 0
  let stallImpatience = 0
  let frozen = 0
  const impatienceBy: ImpatienceSources = {
    calendar: 0,
    stalling: 0,
    stagnation: 0,
    deadline: 0,
    losses: 0,
    events: 0,
  }
  const impatienceNow = () => s.impatience + s.impatienceProgress
  let firstRepMinute = Infinity
  let decreesMissed = 0
  /** `[clock, reputation]` every few seconds, for the shape of the climb. */
  const repCurve: [number, number][] = [[0, 0]]

  while (s.phase === 'playing' && s.clock < maxSeconds) {
    const beforeChoices = s.reputation
    const impBeforeChoices = impatienceNow()
    answerChoices(s)
    sources.events += s.reputation - beforeChoices
    impatienceBy.events += impatienceNow() - impBeforeChoices
    if (s.phase !== 'playing') break

    if (sinceDecision >= DECISION_INTERVAL) {
      sinceDecision = 0
      // Threats compound; a competent player pays them off when they can.
      for (const threat of [...s.threats]) appeaseThreat(s, threat.id)
      dumpSurplus(s)
      build(s, economyOnly)
      layRoads(s)
      explore(s)
      tuneRecipes(s)
      tendWard(s)
      staff(s)
    }
    if (s.buildings.hearth?.workers.length) wardSeconds += STEP
    const parts = impatienceParts(s, computeModifiers(s))
    stallImpatience += parts.stalling * STEP

    const openOrders = s.orders.map((o) => o.defId)
    const gladesBefore = s.stats.gladesCleared
    const liveDecree = s.decree?.defId
    const decreesBefore = s.feats?.decreesMet ?? 0
    const impBefore = impatienceNow()
    const lostBefore = s.stats.villagersLost
    const ticked = s.pendingChoices.length === 0
    const frostBefore = s.frostExposure ?? 0
    tick(s, STEP)
    if (s.season.season === 'storm' && (s.frostExposure ?? 0) < frostBefore) frozen++
    if (ticked) {
      impatienceBy.calendar += (parts.calendar + parts.hostility) * STEP
      impatienceBy.stalling += parts.stalling * STEP
      impatienceBy.stagnation += parts.stagnation * STEP
      impatienceBy.deadline += parts.deadline * STEP
      const losses = (s.stats.villagersLost - lostBefore) * IMPATIENCE_PER_VILLAGER_LOST
      impatienceBy.losses += losses
      impatienceBy.events += impatienceNow() - impBefore - parts.total * STEP - losses
    }
    if (liveDecree && !s.decree && (s.feats?.decreesMet ?? 0) === decreesBefore) decreesMissed++
    if (liveDecree && (s.feats?.decreesMet ?? 0) > decreesBefore) {
      sources.decrees += decreeReputation(s, DECREES[liveDecree])
    }
    sinceDecision += STEP
    const stillOpen = new Set(s.orders.map((o) => o.defId))
    for (const id of openOrders) {
      if (stillOpen.has(id)) continue
      sources.orders += orderReputation(s, { defId: id, writ: id.startsWith('writ_') })
    }
    sources.glades +=
      Math.floor(s.stats.gladesCleared / GLADES_PER_REPUTATION) -
      Math.floor(gladesBefore / GLADES_PER_REPUTATION)
    if (firstRepMinute === Infinity && s.reputation >= 1) firstRepMinute = s.clock / 60
    if (s.clock - repCurve[repCurve.length - 1][0] >= 5) repCurve.push([s.clock, s.reputation])
  }
  const finalRep = Math.max(1, s.reputation)
  const lateFrom = [...repCurve].reverse().find(([t]) => t <= s.clock - 180)?.[1] ?? 0
  const lateShare = Math.max(0, s.reputation - lateFrom) / finalRep
  // Resolve is whatever the discrete sources do not explain.
  sources.resolve = Math.max(
    0,
    s.reputation +
      s.reputationProgress -
      sources.orders -
      sources.decrees -
      sources.glades -
      sources.events,
  )

  return {
    phase: s.phase,
    years: s.season.year,
    reputation: s.reputation,
    impatience: s.impatience,
    population: population(s),
    gladesCleared: s.stats.gladesCleared,
    ordersCompleted: s.stats.ordersCompleted,
    decreesMet: s.feats?.decreesMet ?? 0,
    decreesMissed,
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
    spared: Object.values(s.glades).filter((g) => g.spared && !g.cleared).length,
    frozen,
    upgrades: Object.values(s.buildings).reduce((sum, b) => sum + tierOf(b), 0),
    modifiers: s.runModifiers.join(','),
    openOrders: s.orders.map((o) => `${o.defId}@${Math.round(o.progress * 100)}%`).join(','),
    roads: s.roads?.length ?? 0,
    roadLinked: Object.values(s.buildings).filter((b) => roadLinkOf(s, b).percent > 0).length,
    firstRepMinute,
    lateShare,
    curve: Array.from({ length: Math.floor(s.clock / 60) }, (_, m) =>
      [...repCurve].reverse().find(([t]) => t <= (m + 1) * 60)?.[1] ?? 0,
    ),
    cause: lossCause(s, impatienceBy),
    blights: s.stormBlights ?? { forecast: 0, struck: 0, blunted: 0 },
    wardMinutes: wardSeconds / 60,
    stallImpatience,
    impatienceBy,
    overThreshold: overThreshold(s),
  }
}

/**
 * Why a run was lost, in the harness's words ('-' for a win): 'abandoned'
 * when the last villager left, otherwise whichever source fed the Queen's
 * impatience most — the deadline overtime, reputation standing still,
 * species below threshold, villagers lost, decrees and events, or the plain
 * calendar.
 */
function lossCause(s: RunState, by: ImpatienceSources): string {
  if (s.phase !== 'lost') return '-'
  if (population(s) === 0) return 'abandoned'
  const named: [string, number][] = [
    ['deadline', by.deadline],
    ['stagnation', by.stagnation],
    ['unmet-needs', by.stalling],
    ['villagers-lost', by.losses],
    ['decrees/events', by.events],
    ['calendar', by.calendar],
  ]
  return named.sort((a, b) => b[1] - a[1])[0][0]
}

/**
 * One trio from the starting species and three that need a charter. The
 * fourth, beaver/lizard/fox, was the weakest of all ten possible trios when
 * it was added (lizards' and foxes' deep needs, brawling and rest, both sat
 * behind the weaver at the end of the draft), so the parity check now
 * covers it.
 */
const TRIOS: SpeciesId[][] = [
  ['human', 'beaver', 'lizard'],
  ['human', 'fox', 'harpy'],
  ['beaver', 'lizard', 'harpy'],
  ['beaver', 'lizard', 'fox'],
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
const median = (xs: number[]) => {
  if (xs.length === 0) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function summarise(label: string, reports: BotReport[]): string {
  const wins = reports.filter((r) => r.phase === 'won')
  const losses = reports.filter((r) => r.phase === 'lost')
  const stalls = reports.filter((r) => r.phase === 'playing')
  const src = (k: keyof ReputationSources) => mean(wins.map((r) => r.sources[k])).toFixed(1)
  return (
    `${label.padEnd(20)} won ${wins.length}/${reports.length} lost ${losses.length} stall ${stalls.length} early-collapse ${reports.filter(isEarlyCollapse).length}` +
    ` · avg win ${mean(wins.map((r) => r.exactMinutes)).toFixed(1)}min · longest ${Math.max(...reports.map((r) => r.exactMinutes)).toFixed(1)}min` +
    ` · rep in wins: orders ${src('orders')} decrees ${src('decrees')} glades ${src('glades')} events ${src('events')} resolve ${src('resolve')}` +
    ` · upgrades/run ${mean(reports.map((r) => r.upgrades)).toFixed(1)}` +
    ` · roads/run ${mean(reports.map((r) => r.roads)).toFixed(1)} linked ${mean(reports.map((r) => r.roadLinked)).toFixed(1)}` +
    ` · first rep ${median(reports.map((r) => r.firstRepMinute)).toFixed(1)}min (median)` +
    ` · last-3min share in wins ${(mean(wins.map((r) => r.lateShare)) * 100).toFixed(0)}%` +
    `\n${''.padEnd(20)} tension: median imp at win ${median(wins.map((r) => r.impatience)).toFixed(1)}` +
    ` · median resolve over threshold at win ${median(wins.flatMap((r) => r.overThreshold)).toFixed(1)}` +
    ` · all glades cleared ${((reports.filter((r) => r.gladesCleared >= 14).length / Math.max(1, reports.length)) * 100).toFixed(0)}%` +
    ` · glades ${histogram(reports.map((r) => r.gladesCleared))}` +
    ` · median braziers in wins ${median(wins.map((r) => r.braziers)).toFixed(1)}` +
    ` · villagers lost ${reports.reduce((n, r) => n + r.lost, 0)} (${mean(reports.map((r) => r.lost)).toFixed(2)}/run, ${reports.reduce((n, r) => n + r.frozen, 0)} to frost)` +
    ` · spared/run ${mean(reports.map((r) => r.spared)).toFixed(1)}` +
    ` · causes ${histogram(losses.map((r) => r.cause))}`
  )
}

/** `value×count` pairs, most common first. */
function histogram(values: (string | number)[]): string {
  const counts = new Map<string | number, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => (typeof a[0] === 'number' && typeof b[0] === 'number' ? b[0] - a[0] : b[1] - a[1]))
    .map(([v, n]) => `${v}×${n}`)
    .join(' ') || '-'
}

function logRun(seed: number, r: BotReport): void {
  console.log(
    `seed ${seed}: ${r.phase} · Y${r.years} ${r.minutes}min · rep ${r.reputation} imp ${r.impatience} · pop ${r.population} lost ${r.lost} · glades ${r.gladesCleared} spared ${r.spared} · frozen ${r.frozen} · orders ${r.ordersCompleted} · decrees ${r.decreesMet}/${r.decreesMet + r.decreesMissed} · bld ${r.buildings} · host ${r.hostility} · braziers ${r.braziers} · upgrades ${r.upgrades} · roads ${r.roads}/${r.roadLinked} linked · first rep ${r.firstRepMinute.toFixed(1)}min · late ${(r.lateShare * 100).toFixed(0)}% · ${r.resolve} · unmet ${r.unmetNeeds}${r.starving ? ' STARVING' : ''}${r.coldHearth ? ' COLD' : ''}` +
      ` · cause ${r.cause} · impBy cal ${r.impatienceBy.calendar.toFixed(1)} stall ${r.impatienceBy.stalling.toFixed(1)} stag ${r.impatienceBy.stagnation.toFixed(1)} dl ${r.impatienceBy.deadline.toFixed(1)} lost ${r.impatienceBy.losses.toFixed(1)} ev ${r.impatienceBy.events.toFixed(1)} · over ${r.overThreshold.map((x) => x.toFixed(0)).join('/')} · blights ${r.blights.struck}/${r.blights.blunted} of ${r.blights.forecast} · wards ${r.wardMinutes.toFixed(1)} · stallImp ${r.stallImpatience.toFixed(1)}` +
      `\n    services: ${r.services}\n    drafted: ${r.drafted}\n    land: ${r.modifiers || 'none'} · open orders: ${r.openOrders}\n    reputation by minute: ${r.curve.join(' ')}`,
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
    // The Citadel-locked lands too: an upgrade can put any of them in play.
    const results = ALL_RUN_MODIFIER_LIST.map((def) => {
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
