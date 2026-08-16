import { describe, expect, it } from 'vitest'
import { BUILDINGS, STARTING_BLUEPRINTS } from '../content/buildings'
import { GLADE_EVENTS } from '../content/gladeEvents'
import { SPECIES } from '../content/species'
import type { RunState, ServiceNeed, SpeciesId } from '../types'
import {
  addClearer,
  assignWorker,
  findPlacement,
  isReachable,
  placeBuilding,
  setRecipe,
} from './actions'
import { createRun } from './createRun'
import { computeModifiers } from './modifiers'
import { resolveBreakdowns } from './society'
import { appeaseThreat, resolveGladeEvent, takeChoice } from './events'
import {
  SERVICE_COVERAGE_RATIO,
  canAfford,
  foodStock,
  idleVillagers,
  population,
  serviceCoverage,
  storageUsed,
  totalHousing,
} from './queries'
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
  const pos = findPlacement(s, defId)
  if (!pos) return false
  return placeBuilding(s, defId, pos) === null
}

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
function build(s: RunState): void {
  // Keep at most two sites open so construction actually finishes.
  if (openSites(s) >= 2) return
  const pop = population(s)

  // Housing and storage need no workers, so they are never gated.
  if (totalHousing(s) < pop + 4 && (tryPlace(s, 'cabin') || tryPlace(s, 'shelter'))) return
  if (storageUsed(s) > s.storageCap * 0.8 && tryPlace(s, 'warehouse')) return

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
  if (slotPressure(s) < 1.6 && buildServices(s)) return

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

/** Fills worker slots, keeping a few villagers free to build and clear. */
function staff(s: RunState): void {
  const reserve = builderReserve(s)

  // Producers that feed a wanted service — a venue without goods is worthless,
  // so these outrank the raw economy.
  const serviceProducers = new Set(wantedRecipes(s).keys())

  // Services and their supply chains first — they are what keeps resolve up.
  const priority = (defId: string): number => {
    const def = BUILDINGS[defId]
    if (!def) return 0
    if (def.category === 'service') return 5
    if (serviceProducers.has(defId)) return 4
    if (def.tags.includes('cooking')) return 3
    if (def.tags.includes('gathering') || def.tags.includes('farming')) return 2
    return 1
  }

  const targets = Object.values(s.buildings)
    .filter((b) => b.built && (BUILDINGS[b.defId]?.workerSlots ?? 0) > b.workers.length)
    .sort((a, c) => priority(c.defId) - priority(a.defId))

  for (const building of targets) {
    while (
      idleVillagers(s).length > reserve &&
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
  if (pop < 6) return

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
      // and never one that unleashes a threat the bot would have to pay off.
      let index = def.options.findIndex(
        (o) =>
          (!o.requires || canAfford(s.stock, o.requires)) &&
          !o.villagerLoss &&
          !o.impatience &&
          !o.threat &&
          (o.hostility ?? 0) <= 0,
      )
      if (index < 0) {
        index = def.options.findIndex(
          (o) =>
            (!o.requires || canAfford(s.stock, o.requires)) &&
            !o.villagerLoss &&
            !o.threat,
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

/** Plays one run to its conclusion (or `maxMinutes` of game time). */
function playRun(seed: number, species: SpeciesId[], maxMinutes = 45): BotReport {
  const s = createRun({ seed, species })
  let sinceDecision = Infinity
  const maxSeconds = maxMinutes * 60

  while (s.phase === 'playing' && s.clock < maxSeconds) {
    answerChoices(s)
    if (s.phase !== 'playing') break

    if (sinceDecision >= DECISION_INTERVAL) {
      sinceDecision = 0
      // Threats compound; a competent player pays them off when they can.
      for (const threat of [...s.threats]) appeaseThreat(s, threat.id)
      build(s)
      explore(s)
      tuneRecipes(s)
      staff(s)
    }

    tick(s, STEP)
    sinceDecision += STEP
  }

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
    hostility: Math.round(s.hostility),
    resolve: describeResolve(s),
    unmetNeeds: describeUnmet(s),
    starving: s.starving,
    coldHearth: s.coldHearth,
    services: describeServices(s),
    drafted: s.unlockedBuildings
      .filter((b) => !STARTING_BLUEPRINTS.includes(b))
      .join(','),
  }
}

const SEEDS = [1, 20260726, 777, 424242, 99, 31337, 8080, 555000]

describe('balance harness', () => {
  it('a competent player can win, and the run has a real shape', () => {
    const reports = SEEDS.map((seed) => playRun(seed, ['human', 'beaver', 'lizard']))

    for (const [i, r] of reports.entries()) {
      console.log(
        `seed ${SEEDS[i]}: ${r.phase} · Y${r.years} ${r.minutes}min · rep ${r.reputation} imp ${r.impatience} · pop ${r.population} · glades ${r.gladesCleared} · orders ${r.ordersCompleted} · bld ${r.buildings} · host ${r.hostility} · ${r.resolve} · unmet ${r.unmetNeeds}${r.starving ? ' STARVING' : ''}${r.coldHearth ? ' COLD' : ''}` +
          `\n    services: ${r.services}\n    drafted: ${r.drafted}`,
      )
    }

    const wins = reports.filter((r) => r.phase === 'won').length
    const stalls = reports.filter((r) => r.phase === 'playing').length

    // A roguelite that can stalemate is broken: every run must reach a verdict.
    expect(stalls).toBe(0)

    /*
     * The bot plays competently but not well — it never trades, never rebalances
     * a recipe under pressure, and over-expands. Somewhere around half to most
     * maps is the shape we want: a real player should comfortably beat this, and
     * a careless one should still lose sometimes.
     */
    expect(wins).toBeGreaterThanOrEqual(3)
    expect(wins).toBeLessThan(SEEDS.length)

    // A win should take a real settlement, not a lucky opening.
    for (const r of reports.filter((x) => x.phase === 'won')) {
      expect(r.buildings).toBeGreaterThan(8)
      expect(r.population).toBeGreaterThan(10)
      expect(r.minutes).toBeGreaterThan(8)
      /*
       * And it should not drag: the target is a 15-35 minute run. The bound
       * leaves room for outlier maps whose species draw fights the draft —
       * the bot also never touches the amber levers (rerolls, soothing the
       * Queen, caravan trading) that a real player would reach for on
       * exactly those maps.
       */
      expect(r.minutes).toBeLessThan(45)
    }
  }, 180_000)

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
