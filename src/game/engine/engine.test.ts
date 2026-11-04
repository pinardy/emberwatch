import { describe, expect, it } from 'vitest'
import { BLUEPRINT_POOL, BUILDINGS, BUILDING_LIST, STARTING_BLUEPRINTS } from '../content/buildings'
import { CHARTERS } from '../content/charters'
import { DECREES, DECREE_LIST } from '../content/decrees'
import { GLADE_EVENTS, GLADE_EVENT_LIST } from '../content/gladeEvents'
import { ORDER_LIST, evaluateGoal } from '../content/orders'
import { RESOURCES } from '../content/resources'
import { VILLAGER_TRAITS } from '../content/species'
import { TERRAIN } from '../content/terrain'
import { pairsWith, serviceCapacity } from './adjacency'
import {
  placeBuilding,
  assignWorker,
  canPlaceBuilding,
  footprintOf,
  addClearer,
  findPlacement,
  rushConstruction,
  rushCost,
  sootheCost,
  sootheQueen,
  demolishBuilding,
  demolishRefund,
  demolishRefundShare,
  isUnstartedSite,
} from './actions'
import {
  ADJACENCY_RANGE,
  BRAZIER_FOOTPRINT,
  BRAZIER_FUEL_PER_SECOND,
  BRAZIER_WARMTH_RADIUS,
  CARAVAN_OFFERS,
  CHARTER_REPUTATION,
  DECREE_FIRST_DELAY,
  DECREE_INTERVAL,
  DECREE_MISS_IMPATIENCE,
  DEPARTURE_GRACE,
  HEARTH_FUEL_PER_SECOND,
  HEARTH_WARMTH_RADIUS,
  OPENING_BLUEPRINT_PICKS,
  REPUTATION_UNSERVED_SHARE,
  REWARD_MILESTONES,
  SEASON_LENGTH,
  SECONDS_TO_LEAVE,
  STARTING_VILLAGERS,
  STARVING_MIN_SEVERITY,
  TRADE_LOT,
} from './balance'
import { collectWarnings } from './diagnostics'
import { hearthForecast } from './forecast'
import { describePlacement } from './placement'
import { createRun } from './createRun'
import {
  addVillager,
  appeaseThreat,
  describeOptionCost,
  optionAffordable,
  relevantBlueprints,
  rerollChoice,
  rerollCost,
  resolveGladeEvent,
  spendFood,
  stepThreats,
  takeChoice,
} from './events'
import { dist, pointInPolygon } from './geometry'
import { gladeAt } from './mapgen'
import { computeModifiers } from './modifiers'
import {
  adjacencyMultiplier,
  seasonMultiplier,
  terrainBuildMultiplier,
  terrainOf,
  terrainWorkMultiplier,
  workRate,
} from './production'
import {
  foodStock,
  secondsUntilDeparture,
  idleVillagers,
  population,
  storageUsed,
  totalHousing,
  warmHousing,
  isWarmAt,
  serviceCoverage,
  warmthSources,
} from './queries'
import { makeRng } from './rng'
import {
  QUEEN_DEADLINE_SECONDS,
  hungerSeverity,
  resolveBreakdowns,
  secondsPastDeadline,
  stepDepartures,
  stepImpatience,
  stepReputation,
  stepBraziers,
  stormFuelPerSecond,
} from './society'
import {
  checkCharter,
  goalFeasible,
  goalProgress,
  issueDecree,
  stepConditions,
  stepDecree,
} from './structure'
import { tick } from './tick'
import { loadRun } from '../persistence'
import {
  buyOffer,
  hasTradingPost,
  sellPrice,
  sellResource,
  stepCaravan,
} from './trade'
import {
  buildMultiplier,
  clearMultiplier,
  despairRate,
  ignoresColdHearth,
  mealMultiplier,
} from './traits'
import type { BuildingInstance, RunState } from '../types'

const SEED = 123456

/**
 * A run ready to be simulated. `createRun` deliberately opens on the blueprint
 * draft and the sim halts until it is answered, so we take the first option —
 * exactly what a player does before the clock starts.
 */
function newRun(): RunState {
  const state = createRun({ seed: SEED, species: ['human', 'beaver', 'lizard'] })
  drainChoices(state)
  return state
}

/** A run left exactly as `createRun` produced it, drafts still pending. */
function freshRun(): RunState {
  return createRun({ seed: SEED, species: ['human', 'beaver', 'lizard'] })
}

/**
 * Runs the sim for `seconds` in fixed steps, standing in for a player by
 * resolving any choice the sim blocks on (it halts while one is pending).
 */
function run(state: RunState, seconds: number, step = 0.125): void {
  for (let t = 0; t < seconds; t += step) {
    tick(state, step)
    drainChoices(state)
  }
}

/** Always takes the first offered option. */
function drainChoices(state: RunState): void {
  let guard = 0
  while (state.pendingChoices.length > 0 && guard++ < 20) {
    const choice = state.pendingChoices[0]
    if (choice.kind === 'gladeEvent') resolveGladeEvent(state, chooseAffordable(state))
    else takeChoice(state, choice.options[0])
  }
}

/** Picks the first glade-event option the settlement can actually pay for. */
function chooseAffordable(state: RunState): number {
  const choice = state.pendingChoices[0]
  const def = GLADE_EVENTS[choice.options[0]]
  const index = def.options.findIndex((o) => optionAffordable(state.stock, o))
  return index >= 0 ? index : def.options.length - 1
}

describe('rng', () => {
  it('is deterministic for a seed and cursor', () => {
    const a = makeRng(42, 0)
    const b = makeRng(42, 0)
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()])
  })

  it('resumes from a stored cursor', () => {
    const a = makeRng(7, 0)
    a.next()
    a.next()
    const resumed = makeRng(7, a.cursor())
    const continued = makeRng(7, 2)
    expect(resumed.next()).toBe(continued.next())
  })

  it('spreads shuffle across all items', () => {
    const rng = makeRng(9, 0)
    const shuffled = rng.shuffle([1, 2, 3, 4, 5])
    expect([...shuffled].sort()).toEqual([1, 2, 3, 4, 5])
  })
})

describe('world geometry', () => {
  it('tests point-in-polygon on a square', () => {
    const square = [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 },
    ]
    expect(pointInPolygon({ x: 0, y: 0 }, square)).toBe(true)
    expect(pointInPolygon({ x: 2, y: 0 }, square)).toBe(false)
  })

  it('measures distance symmetrically', () => {
    const a = { x: 1, y: 2 }
    const b = { x: -3, y: 5 }
    expect(dist(a, b)).toBeCloseTo(dist(b, a))
    expect(dist(a, b)).toBeCloseTo(5)
  })
})

describe('map generation', () => {
  it('scatters every feature inside its own glade and is reproducible', () => {
    const a = newRun()
    const b = newRun()
    expect(Object.keys(a.glades).length).toBeGreaterThan(10)
    for (const deposit of Object.values(a.deposits)) {
      const glade = a.glades[deposit.gladeId]
      expect(glade).toBeDefined()
      expect(pointInPolygon(deposit.pos, glade.polygon)).toBe(true)
    }
    for (const obstacle of a.obstacles) {
      expect(pointInPolygon(obstacle.pos, a.glades[obstacle.gladeId].polygon)).toBe(true)
    }
    // Same seed, same world.
    expect(Object.keys(b.glades)).toEqual(Object.keys(a.glades))
    expect(b.glades.glade0.polygon).toEqual(a.glades.glade0.polygon)
    expect(Object.keys(b.deposits)).toEqual(Object.keys(a.deposits))
  })

  it('starts with exactly one cleared glade containing the hearth', () => {
    const state = newRun()
    const cleared = Object.values(state.glades).filter((g) => g.cleared)
    expect(cleared).toHaveLength(1)
    expect(cleared[0].id).toBe('glade0')
    expect(state.buildings.hearth.pos).toEqual({ x: 0, y: 0 })
    expect(gladeAt(state.glades, state.buildings.hearth.pos)?.id).toBe('glade0')
  })

  it('reveals the starting glade neighbours and nothing further', () => {
    const state = newRun()
    const discovered = Object.values(state.glades).filter((g) => g.discovered)
    expect(discovered.length).toBe(state.glades.glade0.neighbors.length + 1)
  })

  it('gives the starting glade workable deposits', () => {
    const state = newRun()
    const starters = Object.values(state.deposits).filter((d) => d.gladeId === 'glade0')
    expect(starters.length).toBeGreaterThan(0)
  })
})

describe('run setup', () => {
  it('creates the starting population and three orders', () => {
    const state = newRun()
    expect(population(state)).toBe(STARTING_VILLAGERS)
    expect(state.orders).toHaveLength(3)
    expect(state.speciesPool).toEqual(['human', 'beaver', 'lizard'])
    expect(idleVillagers(state)).toHaveLength(STARTING_VILLAGERS)
  })

  it('opens on a blueprint draft that offers something useful', () => {
    const state = freshRun()
    expect(state.pendingChoices).toHaveLength(OPENING_BLUEPRINT_PICKS)
    expect(state.pendingChoices[0].kind).toBe('blueprint')
    // The guaranteed-relevant slot must advance a service the settlers want.
    const wanted = relevantBlueprints(state)
    expect(state.pendingChoices[0].options).toContain(wanted[0])
  })

  it('never grants the same blueprint twice across a multi-pick draft', () => {
    const state = freshRun()
    const taken: string[] = []
    while (state.pendingChoices.length > 0) {
      const choice = state.pendingChoices[0]
      if (choice.kind !== 'blueprint') break
      const pick = choice.options[0]
      taken.push(pick)
      takeChoice(state, pick)
    }
    expect(new Set(taken).size).toBe(taken.length)
    expect(new Set(state.unlockedBuildings).size).toBe(state.unlockedBuildings.length)
  })

  it('starts within its stockpile capacity', () => {
    const state = newRun()
    expect(storageUsed(state)).toBeLessThanOrEqual(state.storageCap)
  })
})

describe('building placement', () => {
  it('refuses ground outside cleared glades', () => {
    const state = newRun()
    const foreign = Object.values(state.glades).find((g) => !g.cleared)!
    expect(canPlaceBuilding(state, 'shelter', foreign.center)).toMatch(/not been cleared/)
  })

  it('refuses overlap with the hearth and other buildings', () => {
    const state = newRun()
    expect(canPlaceBuilding(state, 'shelter', state.buildings.hearth.pos)).toMatch(
      /Too close/,
    )
    const pos = findPlacement(state, 'shelter')!
    expect(placeBuilding(state, 'shelter', pos)).toBeNull()
    expect(canPlaceBuilding(state, 'shelter', pos)).toMatch(/Too close/)
  })

  it('refuses a gathering camp with no deposits in range', () => {
    const state = newRun()
    // Strip every deposit so no camp can be useful anywhere.
    state.deposits = {}
    let sawRangeError = false
    for (let x = -4; x <= 4 && !sawRangeError; x += 0.5) {
      for (let y = -4; y <= 4 && !sawRangeError; y += 0.5) {
        const error = canPlaceBuilding(state, 'woodcuttersCamp', { x, y })
        if (error && /deposits/.test(error)) sawRangeError = true
      }
    }
    expect(sawRangeError).toBe(true)
    // And the placement search agrees there is nowhere useful.
    expect(findPlacement(state, 'woodcuttersCamp')).toBeNull()
  })

  it('spends materials and finishes construction with idle builders', () => {
    const state = newRun()
    const pos = findPlacement(state, 'shelter')!
    expect(pos).toBeTruthy()
    const woodBefore = state.stock.wood ?? 0
    expect(placeBuilding(state, 'shelter', pos)).toBeNull()
    expect(state.stock.wood).toBe(woodBefore - (BUILDINGS.shelter.cost.wood ?? 0))

    const housingBefore = totalHousing(state)
    run(state, 30)
    expect(totalHousing(state)).toBe(housingBefore + (BUILDINGS.shelter.housing ?? 0))
  })
})

describe('production', () => {
  it('harvests from a deposit in range', () => {
    const state = newRun()
    // The placement search anchors camps on the deposits they need.
    const pos = findPlacement(state, 'woodcuttersCamp')!
    expect(pos).toBeTruthy()
    expect(placeBuilding(state, 'woodcuttersCamp', pos)).toBeNull()
    const building = Object.values(state.buildings).find(
      (b) => b.defId === 'woodcuttersCamp',
    )!
    expect(Object.keys(building.depositsInRange).length).toBeGreaterThan(0)
    run(state, 20) // let it finish building
    expect(building.built).toBe(true)
    expect(assignWorker(state, building.id)).toBeNull()

    const produced = state.producedTotals.wood ?? 0
    run(state, 40)
    expect((state.producedTotals.wood ?? 0)).toBeGreaterThan(produced)
  })

  it('never exceeds the stockpile cap', () => {
    const state = newRun()
    run(state, 60)
    const used = Object.entries(state.stock)
      .filter(([id]) => id !== 'amber')
      .reduce((sum, [, n]) => sum + (n ?? 0), 0)
    expect(used).toBeLessThanOrEqual(state.storageCap + 0.001)
  })
})

describe('seasons and upkeep', () => {
  it('cycles drizzle → clearance → storm and increments the year', () => {
    const state = newRun()
    // A full year outlasts the starting larder, and a settlement that starves
    // to death stops the clock. Stock it well so we are testing the calendar.
    state.stock = {
      wood: 400,
      berry: 300,
      root: 300,
      mushroom: 300,
      meat: 300,
      grain: 300,
      vegetable: 300,
    }
    run(state, SEASON_LENGTH.drizzle + 1)
    expect(state.season.season).toBe('clearance')
    run(state, SEASON_LENGTH.clearance + 1)
    expect(state.season.season).toBe('storm')
    run(state, SEASON_LENGTH.storm + 1)
    expect(state.season.season).toBe('drizzle')
    expect(state.season.year).toBe(2)
  })

  it('consumes food over time', () => {
    const state = newRun()
    const before = foodStock(state)
    run(state, 60)
    expect(foodStock(state)).toBeLessThan(before)
  })

  it('starves and drops resolve when food runs out', () => {
    const state = newRun()
    state.stock = { wood: 200 }
    const resolveBefore = state.resolve.human
    run(state, 60)
    expect(state.starving).toBe(true)
    expect(state.resolve.human).toBeLessThan(resolveBefore)
  })

  it('raises hostility as time passes', () => {
    const state = newRun()
    run(state, 120)
    expect(state.hostility).toBeGreaterThan(0)
  })

  it('burns wood at the hearth during the storm', () => {
    const state = newRun()
    state.season = { year: 1, season: 'storm', elapsed: 0, length: SEASON_LENGTH.storm }
    state.stock = { berry: 400, wood: 50 }
    run(state, 20)
    expect(state.coldHearth).toBe(false)
    expect(state.stock.wood!).toBeLessThan(50)
  })

  it('reports a cold hearth when the storm finds no wood', () => {
    const state = newRun()
    state.season = { year: 1, season: 'storm', elapsed: 0, length: SEASON_LENGTH.storm }
    state.stock = { berry: 400 }
    run(state, 5)
    expect(state.coldHearth).toBe(true)
  })
})

describe('glade clearing', () => {
  it('only allows crews on glades bordering cleared ground', () => {
    const state = newRun()
    const adjacent = state.glades.glade0.neighbors[0]
    const distant = Object.values(state.glades).find(
      (g) => !g.cleared && !state.glades.glade0.neighbors.includes(g.id),
    )!
    expect(addClearer(state, adjacent)).toBeNull()
    expect(addClearer(state, distant.id)).toMatch(/adjacent/)
  })

  it('clears a glade, pays the reward, and frees the crew', () => {
    const state = newRun()
    const target = state.glades.glade0.neighbors[0]
    for (let i = 0; i < STARTING_VILLAGERS; i++) addClearer(state, target)
    expect(state.glades[target].clearers).toBe(STARTING_VILLAGERS)

    // Plenty of time for any glade size, and food so nothing else interferes.
    state.stock = { ...state.stock, berry: 400, wood: 200 }
    run(state, 400)

    expect(state.glades[target].cleared).toBe(true)
    expect(state.stats.gladesCleared).toBe(1)
    expect(state.glades[target].clearers).toBe(0)
    expect(idleVillagers(state).length).toBeGreaterThan(0)
  })
})

describe('orders', () => {
  it('evaluates every order goal without throwing', () => {
    const state = newRun()
    for (const def of ORDER_LIST) {
      const progress = evaluateGoal(def.goal, state)
      expect(progress).toBeGreaterThanOrEqual(0)
      expect(progress).toBeLessThanOrEqual(1)
    }
  })

  it('grants reputation and redraws when an order completes', () => {
    const state = newRun()
    // Force a stock order to completion.
    state.orders = [{ id: 'test', defId: 'stock_plank_30', progress: 0, complete: false }]
    state.stock.plank = 40
    state.storageCap = 999
    tick(state, 0.125)
    expect(state.reputation).toBeGreaterThan(0)
    expect(state.orders.some((o) => o.defId === 'stock_plank_30')).toBe(false)
    expect(state.orders.length).toBe(3)
  })
})

describe('win and loss', () => {
  it('wins at maximum reputation', () => {
    const state = newRun()
    state.reputation = state.maxReputation
    tick(state, 0.125)
    expect(state.phase).toBe('won')
  })

  it('loses when impatience fills', () => {
    const state = newRun()
    state.impatience = state.maxImpatience
    tick(state, 0.125)
    expect(state.phase).toBe('lost')
  })

  it('loses when the last villager leaves', () => {
    const state = newRun()
    state.villagers = {}
    tick(state, 0.125)
    expect(state.phase).toBe('lost')
  })

  it('halts the sim while a choice is pending', () => {
    const state = newRun()
    state.pendingChoices = [{ kind: 'cornerstone', options: ['sturdyScaffolds'] }]
    const clock = state.clock
    // Raw ticks — the `run` helper deliberately answers choices for us.
    for (let i = 0; i < 80; i++) tick(state, 0.125)
    expect(state.clock).toBe(clock)
    expect(state.pendingChoices).toHaveLength(1)
  })
})

describe('cornerstone modifiers', () => {
  it('folds effects into a single modifier set', () => {
    const state = newRun()
    state.cornerstones = ['sturdyScaffolds', 'campfireTales', 'stormShroud']
    const mods = computeModifiers(state)
    expect(mods.buildSpeed).toBeCloseTo(1.3)
    expect(mods.resolveFlat.all).toBe(2)
    expect(mods.hostilityRate).toBeCloseTo(0.7)
  })

  it('raises resolve for all species via a cornerstone', () => {
    const plain = newRun()
    const buffed = newRun()
    buffed.cornerstones = ['heraldOfTheFlame']
    run(plain, 20)
    run(buffed, 20)
    expect(buffed.resolve.human).toBeGreaterThan(plain.resolve.human)
  })
})

describe('determinism', () => {
  it('two runs with the same seed evolve identically', () => {
    const a = newRun()
    const b = newRun()
    run(a, 200)
    run(b, 200)
    expect(b.hostility).toBeCloseTo(a.hostility, 6)
    expect(population(b)).toBe(population(a))
    expect(b.season).toEqual(a.season)
    expect(b.stock).toEqual(a.stock)
  })

  it('survives a save/load round trip', () => {
    const original = newRun()
    run(original, 120)
    const restored = JSON.parse(JSON.stringify(original)) as RunState
    run(original, 60)
    run(restored, 60)
    expect(restored.hostility).toBeCloseTo(original.hostility, 6)
    expect(restored.stock).toEqual(original.stock)
    expect(restored.rngCursor).toBe(original.rngCursor)
  })
})

describe('traits', () => {
  it('gives each species a rule-bending trait the engine respects', () => {
    expect(ignoresColdHearth('lizard')).toBe(true)
    expect(ignoresColdHearth('human')).toBe(false)
    expect(despairRate('human')).toBeLessThan(1)
    expect(mealMultiplier({ id: 'x', species: 'fox', name: 'T', assignment: null })).toBeLessThan(1)
    expect(clearMultiplier({ id: 'x', species: 'harpy', name: 'T', assignment: null })).toBeGreaterThan(1)
    expect(buildMultiplier({ id: 'x', species: 'beaver', name: 'T', assignment: null })).toBeGreaterThan(1)
  })

  it('spares lizards the cold-hearth penalty', () => {
    const state = newRun()
    state.coldHearth = true
    const mods = computeModifiers(state)
    const byId = Object.fromEntries(resolveBreakdowns(state, mods).map((b) => [b.species, b]))
    expect(byId.lizard.penalties).toBeGreaterThan(byId.human.penalties)
  })

  it('rolls personal quirks that the trait table knows', () => {
    const state = newRun()
    for (const v of Object.values(state.villagers)) {
      if (v.trait) expect(VILLAGER_TRAITS[v.trait]).toBeDefined()
    }
  })
})

describe('threats', () => {
  function armThreat(state: RunState): void {
    state.threats.push({
      id: 't0',
      gladeId: 'glade1',
      name: 'Test Menace',
      icon: '🐺',
      description: 'test',
      interval: 10,
      timer: 1,
      appease: { wood: 5 },
      strike: { hostility: 8, stockLoss: { berry: 4 } },
      whileActive: [{ kind: 'resolveFlat', species: 'all', amount: -3 }],
    })
  }

  it('strikes on a timer and resets', () => {
    const state = newRun()
    armThreat(state)
    const hostilityBefore = state.hostility
    const berriesBefore = state.stock.berry ?? 0
    stepThreats(state, 2)
    expect(state.hostility).toBeCloseTo(hostilityBefore + 8)
    expect(state.stock.berry ?? 0).toBe(berriesBefore - 4)
    expect(state.threats[0].timer).toBeCloseTo(9)
  })

  it('weighs on resolve while it lives', () => {
    const state = newRun()
    armThreat(state)
    expect(computeModifiers(state).resolveFlat.all).toBe(-3)
  })

  it('can be appeased for its price, and only if affordable', () => {
    const state = newRun()
    armThreat(state)
    state.threats[0].appease = { tool: 99 }
    expect(appeaseThreat(state, 't0')).not.toBeNull()
    state.threats[0].appease = { wood: 5 }
    const wood = state.stock.wood ?? 0
    expect(appeaseThreat(state, 't0')).toBeNull()
    expect(state.threats).toHaveLength(0)
    expect(state.stock.wood ?? 0).toBe(wood - 5)
  })

  it('takes a villager chosen by the run RNG, not always the first', () => {
    const victims = new Set<string>()
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const state = createRun({ seed, species: ['human', 'beaver', 'lizard'] })
      drainChoices(state)
      const first = Object.keys(state.villagers)[0]
      armThreat(state)
      state.threats[0].strike = { villagerLoss: 1 }
      const cursor = state.rngCursor
      stepThreats(state, 2)
      expect(state.rngCursor).toBeGreaterThan(cursor)
      victims.add(state.villagers[first] ? 'other' : 'first')
    }
    expect(victims.has('other')).toBe(true)

    // Deterministic: the same state loses the same villager.
    const a = newRun()
    armThreat(a)
    a.threats[0].strike = { villagerLoss: 1 }
    const b = JSON.parse(JSON.stringify(a)) as RunState
    stepThreats(a, 2)
    stepThreats(b, 2)
    expect(Object.keys(b.villagers)).toEqual(Object.keys(a.villagers))
  })
})

describe('food costs', () => {
  const option = { label: 'Feed', description: 'Spend 10 food.', foodCost: 10 }

  it('accepts any edible stock, not just berries', () => {
    expect(optionAffordable({ meat: 6, root: 4 }, option)).toBe(true)
    expect(optionAffordable({ berry: 9 }, option)).toBe(false)
    expect(optionAffordable({ wood: 50 }, option)).toBe(false)
  })

  it('draws from the largest stacks first', () => {
    const stock = { berry: 3, meat: 12, root: 8, wood: 20 }
    spendFood(stock, 10)
    expect(stock).toEqual({ berry: 3, meat: 5, root: 5, wood: 20 })
  })

  it('describes the price including food', () => {
    expect(describeOptionCost({ ...option, cost: { ale: 5 } })).toBe('10 food, 5 Ale')
  })

  it('lets a food-priced glade option be paid with meat', () => {
    const state = newRun()
    state.stock = { meat: 20 }
    state.pendingChoices.unshift({ kind: 'gladeEvent', options: ['drownedShrine'] })
    const reputation = state.reputation
    resolveGladeEvent(state, 0)
    expect(state.reputation).toBe(reputation + 1)
    expect(state.stock.meat).toBe(10)
  })
})

describe('ongoing effects & rule-bending cornerstones', () => {
  it('folds event-granted pacts into the modifiers', () => {
    const state = newRun()
    state.ongoing.push({
      id: 'g0',
      name: 'Test Pact',
      icon: '🌩️',
      description: 'test',
      effects: [{ kind: 'farmsInStorm', percent: 30 }],
    })
    expect(computeModifiers(state).farmsInStorm).toBeCloseTo(0.3)
  })

  it('lets greenhouse farms work through the Storm', () => {
    const state = newRun()
    state.cornerstones = ['greenhouseFrames']
    const mods = computeModifiers(state)
    expect(seasonMultiplier('smallFarm', 'storm', mods)).toBeCloseTo(0.4)
    expect(seasonMultiplier('smallFarm', 'storm')).toBe(0)
  })
})

describe('trade & amber sinks', () => {
  /** Stands up a built Trading Post so caravans start calling. */
  function withTradingPost(state: RunState): void {
    state.unlockedBuildings.push('tradingPost')
    const pos = findPlacement(state, 'tradingPost')!
    placeBuilding(state, 'tradingPost', pos)
    const post = Object.values(state.buildings).find((b) => b.defId === 'tradingPost')!
    post.built = true
  }

  it('caravans arrive with rotating offers and a wanted good', () => {
    const state = newRun()
    expect(hasTradingPost(state)).toBe(false)
    stepCaravan(state, 999)
    expect(state.caravan.here).toBe(false)

    withTradingPost(state)
    state.caravan.timer = 1
    stepCaravan(state, 2)
    expect(state.caravan.here).toBe(true)
    expect(state.caravan.offers).toHaveLength(CARAVAN_OFFERS)
    expect(state.caravan.wants).toBeTruthy()
  })

  it('buys a lot and pays double for the wanted good', () => {
    const state = newRun()
    withTradingPost(state)
    state.caravan.timer = 1
    stepCaravan(state, 2)

    state.stock.amber = 500
    const offer = state.caravan.offers[0]
    const before = state.stock[offer.resource] ?? 0
    expect(buyOffer(state, 0)).toBeNull()
    expect(state.stock[offer.resource] ?? 0).toBe(before + offer.amount)
    expect(buyOffer(state, 0)).not.toBeNull() // already sold

    const wants = state.caravan.wants
    expect(sellPrice(state, wants, TRADE_LOT)).toBeGreaterThan(
      RESOURCES[wants].value * TRADE_LOT,
    )
    state.stock[wants] = TRADE_LOT
    const amber = state.stock.amber ?? 0
    expect(sellResource(state, wants)).toBeNull()
    expect(state.stock.amber ?? 0).toBeGreaterThan(amber)
  })

  it('rerolls an open draft for a steepening amber price', () => {
    const state = freshRun()
    const before = [...state.pendingChoices[0].options]
    state.stock.amber = 100
    const cost = rerollCost(state)
    expect(rerollChoice(state)).toBeNull()
    expect(state.pendingChoices[0].options).not.toEqual(before)
    expect(state.stock.amber).toBe(100 - cost)
    expect(rerollCost(state)).toBeGreaterThan(cost)
  })

  it('rushes construction for amber', () => {
    const state = newRun()
    placeBuilding(state, 'shelter', findPlacement(state, 'shelter')!)
    const site = Object.values(state.buildings).find((b) => !b.built)!
    state.stock.amber = 100
    const cost = rushCost(state, site.id)
    expect(cost).toBeGreaterThan(0)
    expect(rushConstruction(state, site.id)).toBeNull()
    expect(site.built).toBe(true)
    expect(state.stock.amber).toBe(100 - cost)
  })

  it('soothes the Queen at a steepening price', () => {
    const state = newRun()
    state.impatience = 5
    state.stock.amber = 200
    const cost = sootheCost(state)
    expect(sootheQueen(state)).toBeNull()
    expect(state.impatience).toBe(4)
    expect(state.stock.amber).toBe(200 - cost)
    expect(sootheCost(state)).toBeGreaterThan(cost)
  })
})

describe('placement: warmth & adjacency', () => {
  /** A cleared glade whose centre is far enough that homes there are cold. */
  function farGlade(state: RunState) {
    const glade = Object.values(state.glades)
      .filter((g) => dist(g.center, { x: 0, y: 0 }) > HEARTH_WARMTH_RADIUS + 3)
      .sort((a, b) => dist(b.center, { x: 0, y: 0 }) - dist(a.center, { x: 0, y: 0 }))[0]!
    glade.discovered = true
    glade.cleared = true
    return glade
  }

  it('counts housing inside the hearth warmth radius', () => {
    const state = newRun()
    // Everything starts compact, so all housing is warm.
    expect(warmHousing(state, HEARTH_WARMTH_RADIUS)).toBe(totalHousing(state))

    // A far shelter houses people but does not count as warm.
    const glade = farGlade(state)
    const pos = findPlacement(state, 'shelter', glade.center)!
    expect(dist(pos, { x: 0, y: 0 })).toBeGreaterThan(HEARTH_WARMTH_RADIUS)
    expect(placeBuilding(state, 'shelter', pos)).toBeNull()
    const shelter = Object.values(state.buildings).find((b) => b.defId === 'shelter')!
    shelter.built = true
    expect(warmHousing(state, HEARTH_WARMTH_RADIUS)).toBe(
      totalHousing(state) - (BUILDINGS.shelter.housing ?? 0),
    )
  })

  it('chills distant homes during the Storm', () => {
    const state = newRun()
    const glade = farGlade(state)
    placeBuilding(state, 'shelter', findPlacement(state, 'shelter', glade.center)!)
    Object.values(state.buildings).forEach((b) => {
      b.built = true
    })
    // Overflow the warm beds so somebody actually sleeps out there.
    while (population(state) <= 6) addVillager(state)

    const mods = computeModifiers(state)
    state.season.season = 'drizzle'
    const mild = resolveBreakdowns(state, mods)[0].penalties
    state.season.season = 'storm'
    const stormy = resolveBreakdowns(state, mods)[0].penalties
    expect(stormy).toBeLessThan(mild)
  })

  it('speeds up a mill placed beside its camp', () => {
    const state = newRun()
    state.stock.wood = 200
    state.stock.stone = 200
    state.unlockedBuildings.push('lumberMill')

    placeBuilding(state, 'woodcuttersCamp', findPlacement(state, 'woodcuttersCamp')!)
    const camp = Object.values(state.buildings).find((b) => b.defId === 'woodcuttersCamp')!

    // Scan a tight ring around the camp for a legal mill spot within range.
    let millPos: { x: number; y: number } | null = null
    outer: for (let r = 1.5; r <= ADJACENCY_RANGE - 0.05; r += 0.2) {
      for (let a = 0; a < Math.PI * 2; a += 0.25) {
        const p = { x: camp.pos.x + Math.cos(a) * r, y: camp.pos.y + Math.sin(a) * r }
        if (canPlaceBuilding(state, 'lumberMill', p) === null) {
          millPos = p
          break outer
        }
      }
    }
    expect(millPos).toBeTruthy()
    placeBuilding(state, 'lumberMill', millPos!)
    const mill = Object.values(state.buildings).find((b) => b.defId === 'lumberMill')!
    camp.built = true
    mill.built = true
    expect(adjacencyMultiplier(state, mill)).toBeCloseTo(1.2)

    // Alone in a field, no bonus.
    delete state.buildings[camp.id]
    expect(adjacencyMultiplier(state, mill)).toBe(1)
  })
})

describe('glade event content invariants', () => {
  it('every event can always be resolved via its last option', () => {
    for (const def of GLADE_EVENT_LIST) {
      const last = def.options[def.options.length - 1]
      expect(last.requires, `${def.id} last option must be requires-free`).toBeUndefined()
      expect(last.foodCost, `${def.id} last option must be free`).toBeUndefined()
    }
  })

  it('threats always have a positive interval and a payable price', () => {
    for (const def of GLADE_EVENT_LIST) {
      for (const option of def.options) {
        if (!option.threat) continue
        expect(option.threat.interval).toBeGreaterThan(0)
        expect(Object.keys(option.threat.appease).length).toBeGreaterThan(0)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Mid-run structure
// ---------------------------------------------------------------------------

/** Total impatience including the fractional accumulator. */
function impatienceOf(state: RunState): number {
  return state.impatience + state.impatienceProgress
}

/** Drops a finished building of `defId` into the run (no placement rules). */
function standBuilding(state: RunState, defId: string): void {
  const id = `test_${defId}_${Object.keys(state.buildings).length}`
  state.buildings[id] = {
    id,
    defId,
    pos: { x: 99, y: 99 },
    gladeId: 'glade0',
    built: true,
    buildProgress: 0,
    workers: [],
    activeRecipeId: BUILDINGS[defId].recipes[0]?.id ?? '',
    recipeProgress: 0,
    paused: false,
    depositsInRange: {},
  }
}

/** Opens a glade event and picks the option with the given label. */
function chooseEvent(state: RunState, eventId: string, label: string): void {
  state.pendingChoices.unshift({ kind: 'gladeEvent', options: [eventId], gladeId: 'glade1' })
  const index = GLADE_EVENTS[eventId].options.findIndex((o) => o.label === label)
  expect(index, `${eventId} has an option "${label}"`).toBeGreaterThanOrEqual(0)
  resolveGladeEvent(state, index)
}

describe("royal decrees (timed Queen's orders)", () => {
  it('issues the first decree after the opening delay, with a countdown', () => {
    const state = newRun()
    expect(state.decree).toBeNull()
    expect(state.decreeTimer).toBe(DECREE_FIRST_DELAY)
    state.decreeTimer = 0.1
    stepDecree(state, 0.125)
    expect(state.decree).not.toBeNull()
    const def = DECREES[state.decree!.defId]
    expect(state.decree!.timeLeft).toBe(def.timeLimit)
    expect(state.log[0].text).toContain('Royal decree')
  })

  it('counts produce/build/clear goals from the moment it is issued', () => {
    const state = newRun()
    state.producedTotals.plank = 500
    // Only the lumber mill is unlocked, so plank and wood levies are on offer.
    state.unlockedBuildings = ['lumberMill', 'woodcuttersCamp']
    for (let i = 0; i < 40 && state.decree?.defId !== 'decree_planks'; i++) {
      state.decree = null
      issueDecree(state)
    }
    expect(state.decree?.defId).toBe('decree_planks')
    expect(state.decree!.baseline).toBe(500)
    expect(state.decree!.progress).toBe(0)
  })

  it('pays more when met in time, then schedules the next', () => {
    const state = newRun()
    state.storageCap = 999
    state.decree = {
      id: 'dtest',
      defId: 'decree_planks',
      progress: 0,
      complete: false,
      timeLeft: 100,
      timeLimit: 240,
      baseline: state.producedTotals.plank ?? 0,
    }
    const reputation = state.reputation
    const amber = state.stock.amber ?? 0
    const completed = state.stats.ordersCompleted
    state.producedTotals.plank = (state.producedTotals.plank ?? 0) + 30
    stepDecree(state, 0.125)
    expect(state.reputation).toBe(reputation + DECREES.decree_planks.reputationReward)
    expect(state.stock.amber ?? 0).toBe(amber + (DECREES.decree_planks.reward?.amber ?? 0))
    expect(state.stats.ordersCompleted).toBe(completed + 1)
    expect(state.decree).toBeNull()
    expect(state.decreeTimer).toBe(DECREE_INTERVAL)
    expect(state.log[0].tone).toBe('good')
  })

  it('costs impatience when the deadline passes, and is replaced later', () => {
    const state = newRun()
    state.decree = {
      id: 'dtest',
      defId: 'decree_glade',
      progress: 0,
      complete: false,
      timeLeft: 0.1,
      timeLimit: 270,
      baseline: state.stats.gladesCleared,
    }
    const before = impatienceOf(state)
    stepDecree(state, 0.125)
    expect(state.decree).toBeNull()
    expect(impatienceOf(state)).toBeCloseTo(before + DECREE_MISS_IMPATIENCE)
    expect(state.log[0].text).toContain('lapsed')
    expect(state.log[0].tone).toBe('bad')
    // After the interval, a fresh decree takes its place.
    stepDecree(state, DECREE_INTERVAL + 0.1)
    expect(state.decree).not.toBeNull()
  })

  it('only decrees goals the settlement can actually pursue', () => {
    const state = newRun()
    state.unlockedBuildings = [...STARTING_BLUEPRINTS]
    for (let i = 0; i < 40; i++) {
      state.decree = null
      issueDecree(state)
      const def = DECREES[state.decree!.defId]
      expect(goalFeasible(def.goal, state), def.id).toBe(true)
      expect(['decree_ale', 'decree_fabric', 'decree_service']).not.toContain(def.id)
    }
  })

  it('every decree has a positive time limit and a reward', () => {
    for (const def of DECREE_LIST) {
      expect(def.timeLimit).toBeGreaterThan(0)
      expect(def.reputationReward).toBeGreaterThan(0)
    }
  })
})

describe("the Queen's charter (mid-run milestone)", () => {
  /** A run sitting at the charter milestone with the regular milestones taken. */
  function atCharter(): RunState {
    const state = newRun()
    state.reputation = CHARTER_REPUTATION
    state.cornerstonesTaken = REWARD_MILESTONES.filter((m) => m <= CHARTER_REPUTATION).length
    return state
  }

  it('is offered exactly once, at the reputation milestone', () => {
    const below = newRun()
    below.reputation = CHARTER_REPUTATION - 1
    below.cornerstonesTaken = REWARD_MILESTONES.length
    checkCharter(below)
    expect(below.pendingChoices).toHaveLength(0)

    const state = atCharter()
    tick(state, 0.125)
    const choice = state.pendingChoices.find((c) => c.kind === 'charter')
    expect(choice).toBeDefined()
    expect(choice!.options).toHaveLength(3)
    const families = choice!.options.map((id) => CHARTERS[id].family)
    expect(families).toEqual(['perk', 'patience', 'blueprint'])
    expect(choice!.blueprintId).toBeDefined()
    expect(state.unlockedBuildings).not.toContain(choice!.blueprintId)

    state.pendingChoices = []
    checkCharter(state)
    expect(state.pendingChoices).toHaveLength(0)
  })

  it('draws the same offer from the same seed', () => {
    const a = atCharter()
    const b = atCharter()
    checkCharter(a)
    checkCharter(b)
    expect(b.pendingChoices).toEqual(a.pendingChoices)
  })

  it('a patience charter raises the ceiling and is recorded', () => {
    const state = atCharter()
    checkCharter(state)
    state.pendingChoices[0].options[1] = 'royalIndulgence'
    const max = state.maxImpatience
    takeChoice(state, 'royalIndulgence')
    expect(state.maxImpatience).toBe(max + 4)
    expect(state.charter).toBe('royalIndulgence')
    expect(state.ongoing.some((o) => o.id === 'charter_royalIndulgence')).toBe(true)
    expect(state.pendingChoices).toHaveLength(0)
  })

  it('a perk charter folds into the modifiers', () => {
    const state = atCharter()
    checkCharter(state)
    state.pendingChoices[0].options[0] = 'guildCharter'
    takeChoice(state, 'guildCharter')
    const mods = computeModifiers(state)
    expect(mods.productionSpeed.all).toBeCloseTo(0.15)
    expect(mods.buildSpeed).toBeCloseTo(1.2)
  })

  it("the architect's warrant unlocks a blueprint and delivers its materials", () => {
    const state = atCharter()
    state.storageCap = 999
    checkCharter(state)
    const blueprint = state.pendingChoices[0].blueprintId!
    const cost = BUILDINGS[blueprint].cost
    const before = { ...state.stock }
    takeChoice(state, 'architectsWarrant')
    expect(state.unlockedBuildings).toContain(blueprint)
    for (const [id, amount] of Object.entries(cost)) {
      const key = id as keyof typeof before
      expect(state.stock[key] ?? 0).toBe((before[key] ?? 0) + (amount ?? 0))
    }
  })

  it('cannot be rerolled, and ignores ids that are not on offer', () => {
    const state = atCharter()
    state.stock.amber = 999
    checkCharter(state)
    expect(rerollChoice(state)).not.toBeNull()
    takeChoice(state, 'notACharter')
    expect(state.pendingChoices).toHaveLength(1)
    expect(state.charter).toBeNull()
  })
})

describe('lingering glade conditions', () => {
  const conditionOptions = GLADE_EVENT_LIST.flatMap((def) =>
    def.options.filter((o) => o.condition).map((o) => ({ event: def.id, option: o })),
  )

  it('content offers at least five, each with a well-formed goal', () => {
    expect(conditionOptions.length).toBeGreaterThanOrEqual(5)
    const state = newRun()
    for (const { event, option } of conditionOptions) {
      const c = option.condition!
      expect(c.deadline === undefined || c.deadline > 0, event).toBe(true)
      if (c.consume) expect(c.resolveBy.kind, `${event} consumes a stock goal`).toBe('stock')
      // A condition with neither an ongoing cost nor a deadline would be inert.
      expect(Boolean(c.whileActive?.length) || c.deadline !== undefined, event).toBe(true)
      const progress = goalProgress(c.resolveBy, state, 0)
      expect(progress).toBeGreaterThanOrEqual(0)
      expect(progress).toBeLessThanOrEqual(1)
    }
  })

  it('a chosen option leaves a condition whose effects weigh on the sim', () => {
    const state = newRun()
    state.stock.plank = 0
    chooseEvent(state, 'sunkenGranary', 'Breach the dyke')
    expect(state.conditions).toHaveLength(1)
    expect(state.conditions[0].name).toBe('Flooded Paths')
    expect(computeModifiers(state).buildSpeed).toBeCloseTo(0.75)
    tick(state, 0.125)
    expect(state.conditions).toHaveLength(1)
  })

  it('lifts when the goal is met, consuming tribute goods', () => {
    const state = newRun()
    state.storageCap = 999
    state.stock.incense = 0
    state.hostility = 30
    chooseEvent(state, 'drownedShrine', 'Bargain with the spirit')
    expect(state.conditions[0].timeLeft).toBe(180)
    state.stock.incense = 12
    stepConditions(state, 0.125)
    expect(state.conditions).toHaveLength(0)
    expect(state.stock.incense).toBe(2)
    expect(state.hostility).toBe(25)
    expect(state.log[0].tone).toBe('good')
  })

  it('fails when its deadline passes, applying the penalty', () => {
    const state = newRun()
    state.stock.incense = 0
    state.hostility = 30
    chooseEvent(state, 'drownedShrine', 'Bargain with the spirit')
    for (let t = 0; t < 179; t += 1) stepConditions(state, 1)
    expect(state.conditions).toHaveLength(1)
    stepConditions(state, 2)
    expect(state.conditions).toHaveLength(0)
    expect(state.hostility).toBe(45)
    expect(state.log[0].tone).toBe('bad')
  })

  it('counting goals ignore what already stood, and rewards pay out', () => {
    const state = newRun()
    standBuilding(state, 'tavern')
    chooseEvent(state, 'blightTouchedGrove', 'Let it run its course')
    expect(computeModifiers(state).resolveFlat.all).toBe(-3)
    stepConditions(state, 0.125)
    expect(state.conditions).toHaveLength(1)
    standBuilding(state, 'temple')
    stepConditions(state, 0.125)
    expect(state.conditions).toHaveLength(0)
    expect(computeModifiers(state).resolveFlat.all).toBe(0)

    const wager = newRun()
    chooseEvent(wager, 'queensSurveyors', 'Promise them a frontier to map')
    const reputation = wager.reputation
    wager.stats.gladesCleared += 2
    stepConditions(wager, 0.125)
    expect(wager.conditions).toHaveLength(0)
    expect(wager.reputation).toBe(reputation + 2)
  })

  it('survives a save/load round trip, and old saves gain defaults', () => {
    const state = newRun()
    state.stock.plank = 0
    chooseEvent(state, 'sunkenGranary', 'Breach the dyke')
    state.decreeTimer = 5
    const restored = JSON.parse(JSON.stringify(state)) as RunState
    run(state, 30)
    run(restored, 30)
    expect(restored.conditions).toEqual(state.conditions)
    expect(restored.decree).toEqual(state.decree)
    expect(restored.rngCursor).toBe(state.rngCursor)

    // A save from before these features loads with safe defaults.
    const legacy = JSON.parse(JSON.stringify(newRun())) as Partial<RunState>
    delete legacy.conditions
    delete legacy.conditionCounter
    delete legacy.decree
    delete legacy.decreeTimer
    delete legacy.charterOffered
    delete legacy.charter
    const store = new Map<string, string>([['emberwatch.run.v1', JSON.stringify(legacy)]])
    const original = globalThis.localStorage
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    } as unknown as Storage
    try {
      const loaded = loadRun()!
      expect(loaded.conditions).toEqual([])
      expect(loaded.conditionCounter).toBe(0)
      expect(loaded.decree).toBeNull()
      expect(loaded.decreeTimer).toBe(DECREE_FIRST_DELAY)
      expect(loaded.charterOffered).toBe(false)
      expect(loaded.charter).toBeNull()
      tick(loaded, 0.125)
      expect(loaded.phase).toBe('playing')
    } finally {
      globalThis.localStorage = original
    }
  })
})

describe('departure countdown', () => {
  it('reports seconds until each despairing species leaves, and warns about it', () => {
    const state = newRun()
    for (const sp of state.speciesPool) {
      const id = addVillager(state)
      if (id) state.villagers[id].species = sp
    }
    expect(secondsUntilDeparture(state)).toEqual({})
    state.resolve.beaver = -20
    state.despair.beaver = SECONDS_TO_LEAVE - 40
    expect(secondsUntilDeparture(state).beaver).toBeCloseTo(40)
    expect(secondsUntilDeparture(state).human).toBeUndefined()
    const warning = collectWarnings(state).find((w) => w.id === 'leaving-beaver')
    expect(warning?.text).toBe('🚪 Beavers will start leaving in 40s.')
    // Humans grind despair out at half speed, so their countdown is longer.
    state.resolve.human = -20
    state.despair.human = 0
    expect(secondsUntilDeparture(state).human).toBeCloseTo(
      SECONDS_TO_LEAVE / despairRate('human'),
    )
  })
})

describe('pacing: departures, hunger and the Queen', () => {
  function despairing(state: RunState): void {
    for (const sp of state.speciesPool) state.resolve[sp] = -20
  }

  const beavers = (state: RunState) =>
    Object.values(state.villagers).filter((v) => v.species === 'beaver').length

  it('lets one villager leave per species, then holds a grace period', () => {
    const state = newRun()
    // Make sure there are beavers to lose.
    for (let i = 0; i < 4; i++) {
      const id = addVillager(state)
      if (id) state.villagers[id].species = 'beaver'
    }
    despairing(state)
    const before = beavers(state)
    // Beavers have no despair trait, so they leave on the plain timer.
    stepDepartures(state, SECONDS_TO_LEAVE - 1)
    expect(beavers(state)).toBe(before)
    stepDepartures(state, 1)
    expect(beavers(state)).toBe(before - 1)
    expect(state.despair.beaver).toBe(-DEPARTURE_GRACE)
    // The next beaver waits out the grace period *and* a full despair timer.
    stepDepartures(state, SECONDS_TO_LEAVE)
    expect(beavers(state)).toBe(before - 1)
    stepDepartures(state, DEPARTURE_GRACE)
    expect(beavers(state)).toBe(before - 2)
  })

  it('ramps hunger in rather than slamming resolve on the first missed meal', () => {
    const state = newRun()
    state.starving = true
    state.foodDebt = 1
    expect(hungerSeverity(state)).toBeCloseTo(STARVING_MIN_SEVERITY)
    state.foodDebt = population(state) * 2
    expect(hungerSeverity(state)).toBe(1)
    state.starving = false
    expect(hungerSeverity(state)).toBe(0)
  })

  it('stops newcomers arriving while the settlement starves', () => {
    const state = newRun()
    state.stock = { wood: 200 }
    state.foodDebt = 50
    state.starving = true
    state.newcomerTimer = 999
    const before = population(state)
    tick(state, 0.125)
    expect(state.starving).toBe(true)
    expect(population(state)).toBeLessThanOrEqual(before)
  })

  it("escalates impatience past the Queen's deadline, whatever the cornerstones say", () => {
    const early = newRun()
    early.hostility = 0
    early.clock = QUEEN_DEADLINE_SECONDS - 60
    stepImpatience(early, 10, computeModifiers(early))
    expect(secondsPastDeadline(early)).toBe(0)
    expect(early.impatience + early.impatienceProgress).toBeLessThan(0.1)

    const late = newRun()
    late.hostility = 0
    late.clock = QUEEN_DEADLINE_SECONDS + 600
    // Even a Queen soothed to stillness by cornerstones keeps her deadline.
    const calm = { ...computeModifiers(late), impatienceRate: 0 }
    stepImpatience(late, 10, calm)
    expect(secondsPastDeadline(late)).toBe(600)
    expect(late.impatience + late.impatienceProgress).toBeGreaterThan(0.4)
  })

  it('pays resolve reputation mostly for served needs, not idle contentment', () => {
    const state = newRun()
    const mods = computeModifiers(state)
    const breakdowns = resolveBreakdowns(state, mods)
    for (const sp of state.speciesPool) state.resolve[sp] = 40

    state.reputationProgress = 0
    const idle = stepReputation(state, 10, mods, breakdowns.map((b) => ({ ...b, needsMet: 0 })))
    state.reputationProgress = 0
    const full = stepReputation(state, 10, mods, breakdowns.map((b) => ({ ...b, needsMet: 1 })))

    expect(idle).toBeGreaterThan(0)
    expect(idle / full).toBeCloseTo(REPUTATION_UNSERVED_SHARE)
  })
})

// ---------------------------------------------------------------------------
// Placement depth: terrain, braziers, neighbourhoods
// ---------------------------------------------------------------------------

/** Drops a finished building at an exact spot, bypassing placement rules. */
function put(state: RunState, defId: string, pos: { x: number; y: number }) {
  const id = `test_${defId}_${Object.keys(state.buildings).length}`
  state.buildings[id] = {
    id,
    defId,
    pos,
    gladeId: gladeAt(state.glades, pos)?.id ?? Object.keys(state.glades)[0],
    built: true,
    buildProgress: BUILDINGS[defId].buildSeconds,
    workers: [],
    activeRecipeId: BUILDINGS[defId].recipes[0]?.id ?? '',
    recipeProgress: 0,
    paused: false,
    depositsInRange: {},
  }
  return state.buildings[id]
}

/** A spot well away from the hearth, for setups that must not touch it. */
const FAR = { x: 12, y: 9 }

describe('terrain yields', () => {
  it('declares a multiplier per terrain and building', () => {
    expect(terrainWorkMultiplier('smallFarm', 'fertile')).toBeCloseTo(1.25)
    expect(terrainWorkMultiplier('smallFarm', 'rock')).toBeCloseTo(0.8)
    expect(terrainWorkMultiplier('stonecuttersCamp', 'rock')).toBeCloseTo(1.2)
    expect(terrainWorkMultiplier('brickyard', 'rock')).toBeCloseTo(1.2)
    expect(terrainWorkMultiplier('copperMine', 'rock')).toBeCloseTo(1.15)
    expect(terrainWorkMultiplier('clayPit', 'marsh')).toBeCloseTo(1.25)
    expect(terrainWorkMultiplier('woodcuttersCamp', 'forest')).toBeCloseTo(1.15)
    // Unrelated buildings are unaffected; a clearing is neutral for everyone.
    expect(terrainWorkMultiplier('lumberMill', 'rock')).toBe(1)
    for (const id of Object.keys(BUILDINGS)) {
      expect(terrainWorkMultiplier(id, 'clearing')).toBe(1)
      expect(terrainBuildMultiplier(id, 'clearing')).toBe(1)
    }
    expect(terrainBuildMultiplier('shelter', 'marsh')).toBeCloseTo(0.8)
    expect(terrainBuildMultiplier('shelter', 'fertile')).toBe(1)
  })

  it('every terrain effect names a real tag or resource', () => {
    for (const terrain of Object.values(TERRAIN)) {
      for (const effect of terrain.effects) {
        if (effect.kind === 'workSpeed') {
          expect(BUILDING_LIST.some((d) => d.tags.includes(effect.tag))).toBe(true)
        }
        if (effect.kind === 'yield') expect(RESOURCES[effect.resource]).toBeDefined()
      }
    }
  })

  it('speeds up a brickyard standing on rocky ground', () => {
    const state = newRun()
    const yard = put(state, 'brickyard', FAR)
    const glade = state.glades[yard.gladeId]
    expect(assignWorker(state, yard.id)).toBeNull()
    const mods = computeModifiers(state)

    glade.terrain = 'clearing'
    const plain = workRate(state, yard, mods)
    expect(plain).toBeGreaterThan(0)
    glade.terrain = 'rock'
    expect(terrainOf(state, yard)).toBe('rock')
    expect(workRate(state, yard, mods)).toBeCloseTo(plain * 1.2)
  })

  it('slows construction on marsh', () => {
    const progressOn = (terrain: 'clearing' | 'marsh') => {
      const state = newRun()
      const pos = findPlacement(state, 'shelter')!
      expect(placeBuilding(state, 'shelter', pos)).toBeNull()
      const site = Object.values(state.buildings).find((b) => b.defId === 'shelter')!
      state.glades[site.gladeId].terrain = terrain
      tick(state, 1)
      return site.buildProgress
    }
    const plain = progressOn('clearing')
    expect(plain).toBeGreaterThan(0)
    expect(progressOn('marsh')).toBeCloseTo(plain * 0.8)
  })

  it('shows the ground in the placement hint', () => {
    const state = newRun()
    const pos = findPlacement(state, 'brickyard')!
    gladeAt(state.glades, pos)!.terrain = 'rock'
    const preview = describePlacement(state, 'brickyard', pos)
    expect(preview.terrain).toBe('rock')
    expect(preview.terrainEffects).toHaveLength(1)
    expect(preview.parts.join(' ')).toContain('+20% masonry')
    // Neutral for a building the ground does nothing for.
    expect(describePlacement(state, 'lumberMill', pos).terrainEffects).toHaveLength(0)
  })
})

describe('brazier warmth', () => {
  /** A Storm settlement with one shelter beyond the hearth and people in it. */
  function coldSuburb() {
    const state = newRun()
    const shelter = put(state, 'shelter', { x: HEARTH_WARMTH_RADIUS + 4, y: 0 })
    while (population(state) <= 6) addVillager(state)
    state.season.season = 'storm'
    state.stock.wood = 50
    return { state, shelter }
  }

  it('is a cheap, small starting blueprint', () => {
    expect(STARTING_BLUEPRINTS).toContain('brazier')
    expect(BLUEPRINT_POOL).not.toContain('brazier')
    expect(footprintOf('brazier')).toBe(BRAZIER_FOOTPRINT)
    expect(BUILDINGS.brazier.warmth?.radius).toBe(BRAZIER_WARMTH_RADIUS)
    expect(BRAZIER_WARMTH_RADIUS).toBeLessThan(HEARTH_WARMTH_RADIUS)
  })

  it('warms housing within its radius that the hearth cannot reach', () => {
    const { state, shelter } = coldSuburb()
    const housing = BUILDINGS.shelter.housing ?? 0
    const before = warmHousing(state, HEARTH_WARMTH_RADIUS)
    expect(isWarmAt(state, shelter.pos)).toBe(false)

    const brazier = put(state, 'brazier', {
      x: shelter.pos.x,
      y: shelter.pos.y + BRAZIER_WARMTH_RADIUS - 0.5,
    })
    expect(isWarmAt(state, shelter.pos)).toBe(true)
    expect(warmHousing(state, HEARTH_WARMTH_RADIUS)).toBe(before + housing)
    expect(warmthSources(state).map((w) => w.kind)).toEqual(
      expect.arrayContaining(['hearth', 'brazier']),
    )

    // A site still under construction warms nobody.
    brazier.built = false
    expect(isWarmAt(state, shelter.pos)).toBe(false)
  })

  it('lifts the storm chill off its homes', () => {
    const { state, shelter } = coldSuburb()
    const mods = computeModifiers(state)
    const chilled = resolveBreakdowns(state, mods)[0].penalties
    expect(chilled).toBeLessThan(0)
    put(state, 'brazier', { x: shelter.pos.x + 1.5, y: shelter.pos.y })
    stepBraziers(state, 0.125)
    expect(resolveBreakdowns(state, mods)[0].penalties).toBeGreaterThan(chilled)
  })

  it('burns wood only while the Storm rages', () => {
    const { state } = coldSuburb()
    put(state, 'brazier', FAR)
    state.stock.wood = 10
    stepBraziers(state, 10)
    expect(state.stock.wood).toBeCloseTo(10 - BRAZIER_FUEL_PER_SECOND * 10)

    state.season.season = 'clearance'
    state.stock.wood = 10
    stepBraziers(state, 10)
    expect(state.stock.wood).toBe(10)
  })

  it('goes cold without wood, and its homes chill again', () => {
    const { state, shelter } = coldSuburb()
    const brazier = put(state, 'brazier', { x: shelter.pos.x + 1.5, y: shelter.pos.y })
    delete state.stock.wood
    expect(stepBraziers(state, 0.125)).toBe(1)
    expect(brazier.unlit).toBe(true)
    expect(isWarmAt(state, shelter.pos)).toBe(false)
    expect(collectWarnings(state).some((w) => w.id === 'cold-braziers')).toBe(true)
    // Already cold: not reported twice.
    expect(stepBraziers(state, 0.125)).toBe(0)

    // Wood relights it; the Storm passing resets it either way.
    state.stock.wood = 5
    stepBraziers(state, 0.125)
    expect(brazier.unlit).toBe(false)
    brazier.unlit = true
    state.season.season = 'drizzle'
    stepBraziers(state, 0.125)
    expect(brazier.unlit).toBe(false)
  })

  it('adds its burn to the Storm fuel forecast', () => {
    const { state } = coldSuburb()
    const mods = computeModifiers(state)
    const hearthOnly = stormFuelPerSecond(state, HEARTH_FUEL_PER_SECOND, mods.hearthFuel)
    put(state, 'brazier', FAR)
    expect(stormFuelPerSecond(state, HEARTH_FUEL_PER_SECOND, mods.hearthFuel)).toBeCloseTo(
      hearthOnly + BRAZIER_FUEL_PER_SECOND * mods.hearthFuel,
    )
    // The HUD's hearth forecast counts the brazier's burn too.
    expect(hearthForecast(state, mods).stormRate).toBeCloseTo(
      hearthOnly + BRAZIER_FUEL_PER_SECOND * mods.hearthFuel,
    )
    // A thin woodpile mid-Storm raises the hearth fuel warning.
    state.stock.wood = 1
    expect(
      collectWarnings(state).some((w) => w.id === 'hearth-low' || w.id === 'hearth-storm'),
    ).toBe(true)
  })

  it('hints how many homes a brazier ghost would warm, and whether a home is warm', () => {
    const { state, shelter } = coldSuburb()
    const near = { x: shelter.pos.x, y: shelter.pos.y + 1.5 }
    expect(describePlacement(state, 'brazier', near).warms).toBe(1)
    expect(describePlacement(state, 'shelter', near).warm).toBe(false)
    expect(describePlacement(state, 'shelter', { x: 1.5, y: 1.5 }).warm).toBe(true)
  })
})

describe('multi-partner adjacency', () => {
  it('every adjacency names a real partner', () => {
    for (const def of BUILDING_LIST) {
      for (const bonus of def.adjacency ?? []) {
        expect(!!bonus.nearId !== !!bonus.nearCategory, `${def.id}: one partner key`).toBe(true)
        if (bonus.nearId) expect(BUILDINGS[bonus.nearId], `${def.id} → ${bonus.nearId}`).toBeDefined()
        expect(bonus.percent).toBeGreaterThan(0)
      }
    }
  })

  it('stacks speed bonuses from different partners', () => {
    const state = newRun()
    const yard = put(state, 'brickyard', FAR)
    expect(adjacencyMultiplier(state, yard)).toBe(1)

    const pit = put(state, 'clayPit', { x: FAR.x + 1.6, y: FAR.y })
    expect(adjacencyMultiplier(state, yard)).toBeCloseTo(1.2)
    put(state, 'stonecuttersCamp', { x: FAR.x - 1.6, y: FAR.y })
    expect(adjacencyMultiplier(state, yard)).toBeCloseTo(1.3)

    // A second clay pit adds nothing: each bonus counts one partner.
    const second = put(state, 'clayPit', { x: FAR.x, y: FAR.y + 1.6 })
    expect(adjacencyMultiplier(state, yard)).toBeCloseTo(1.3)

    // Out-of-range or unbuilt partners do not count.
    delete state.buildings[pit.id]
    second.built = false
    put(state, 'clayPit', { x: FAR.x + ADJACENCY_RANGE + 1, y: FAR.y })
    expect(adjacencyMultiplier(state, yard)).toBeCloseTo(1.1)
  })

  it('homes near a service raise its capacity, up to three', () => {
    const state = newRun()
    const tavern = put(state, 'tavern', FAR)
    const base = BUILDINGS.tavern.service!.capacity
    expect(serviceCapacity(state, tavern)).toBe(base)

    put(state, 'shelter', { x: FAR.x + 1.6, y: FAR.y })
    expect(serviceCapacity(state, tavern)).toBe(Math.floor(base * 1.1))
    put(state, 'cabin', { x: FAR.x - 1.6, y: FAR.y })
    put(state, 'shelter', { x: FAR.x, y: FAR.y + 1.6 })
    expect(serviceCapacity(state, tavern)).toBe(Math.floor(base * 1.3))
    put(state, 'shelter', { x: FAR.x, y: FAR.y - 1.6 })
    expect(serviceCapacity(state, tavern)).toBe(Math.floor(base * 1.3))

    // The supplier next door stacks on top.
    put(state, 'brewery', { x: FAR.x + 1.4, y: FAR.y + 1.4 })
    expect(serviceCapacity(state, tavern)).toBe(Math.floor(base * 1.4))

    // The sim's coverage uses the effective number once staffed and supplied.
    expect(assignWorker(state, tavern.id)).toBeNull()
    state.stock.ale = 5
    expect(serviceCoverage(state).luxury.capacity).toBe(Math.floor(base * 1.4))
  })

  it('pairs buildings in either direction for the partner pulse', () => {
    expect(pairsWith('tavern', 'shelter')).toBe(true)
    expect(pairsWith('cabin', 'temple')).toBe(true)
    expect(pairsWith('woodcuttersCamp', 'smelter')).toBe(true)
    expect(pairsWith('lumberMill', 'shelter')).toBe(false)
  })

  it('lists every satisfied partner in the placement hint', () => {
    const state = newRun()
    put(state, 'clayPit', { x: FAR.x + 1.6, y: FAR.y })
    put(state, 'stonecuttersCamp', { x: FAR.x - 1.6, y: FAR.y })
    const preview = describePlacement(state, 'brickyard', FAR)
    expect(preview.adjacency.map((a) => a.percent)).toEqual([20, 10])
    const hint = preview.parts.join(' · ')
    expect(hint).toContain('Clay Pit')
    expect(hint).toContain('Stonecutters')

    put(state, 'shelter', { x: FAR.x, y: FAR.y + 1.6 })
    put(state, 'shelter', { x: FAR.x, y: FAR.y - 1.6 })
    expect(describePlacement(state, 'tavern', FAR).parts.join(' ')).toContain(
      '+20% capacity beside 2 homes',
    )
  })
})

describe('demolition refunds', () => {
  /** Places `defId` wherever it fits and returns the new site. */
  function site(state: RunState, defId: string): BuildingInstance {
    const spot = findPlacement(state, defId)
    expect(spot, `${defId} has somewhere to stand`).toBeTruthy()
    const before = new Set(Object.keys(state.buildings))
    expect(placeBuilding(state, defId, spot!)).toBeNull()
    const id = Object.keys(state.buildings).find((k) => !before.has(k))!
    return state.buildings[id]
  }

  it('hands back every material for a site nobody has worked on', () => {
    const state = newRun()
    state.storageCap = 1000
    const wood = state.stock.wood ?? 0
    const camp = site(state, 'woodcuttersCamp')
    expect(state.stock.wood).toBe(wood - BUILDINGS.woodcuttersCamp.cost.wood!)
    expect(isUnstartedSite(camp)).toBe(true)
    expect(demolishRefundShare(camp)).toBe(1)
    expect(demolishRefund(camp)).toEqual(BUILDINGS.woodcuttersCamp.cost)

    expect(demolishBuilding(state, camp.id)).toBeNull()
    expect(state.buildings[camp.id]).toBeUndefined()
    expect(state.stock.wood).toBe(wood)
  })

  it('slides from a full refund to half as construction progresses', () => {
    const state = newRun()
    state.storageCap = 1000
    state.stock.plank = 8
    state.stock.brick = 4
    const cabin = site(state, 'cabin')
    const seconds = BUILDINGS.cabin.buildSeconds

    cabin.buildProgress = seconds / 2
    expect(isUnstartedSite(cabin)).toBe(false)
    expect(demolishRefundShare(cabin)).toBeCloseTo(0.75)
    expect(demolishRefund(cabin)).toEqual({ plank: 6, brick: 3 })

    cabin.buildProgress = seconds * 0.99
    expect(demolishRefundShare(cabin)).toBeGreaterThan(0.5)
    expect(demolishRefundShare(cabin)).toBeLessThan(0.51)

    cabin.built = true
    cabin.buildProgress = seconds
    expect(demolishRefundShare(cabin)).toBe(0.5)
    expect(demolishRefund(cabin)).toEqual({ plank: 4, brick: 2 })
    // A bare definition id means a finished building.
    expect(demolishRefund('cabin')).toEqual({ plank: 4, brick: 2 })

    expect(demolishBuilding(state, cabin.id)).toBeNull()
    expect(state.stock.plank).toBe(4)
    expect(state.stock.brick).toBe(2)
  })

  it('treats rushed and instantly built buildings as finished', () => {
    const state = newRun()
    state.storageCap = 1000
    state.stock.amber = 500
    const camp = site(state, 'woodcuttersCamp')
    expect(rushConstruction(state, camp.id)).toBeNull()
    expect(isUnstartedSite(camp)).toBe(false)
    expect(demolishRefundShare(camp)).toBe(0.5)
    // Something built on placement keeps its progress at zero but is finished.
    expect(demolishRefundShare({ defId: 'woodcuttersCamp', built: true, buildProgress: 0 })).toBe(
      0.5,
    )
  })
})
