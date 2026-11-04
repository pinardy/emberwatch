import { describe, expect, it } from 'vitest'
import { BLUEPRINT_POOL, BUILDINGS, BUILDING_LIST, STARTING_BLUEPRINTS } from '../content/buildings'
import { GLADE_EVENTS, GLADE_EVENT_LIST } from '../content/gladeEvents'
import { ORDER_LIST, evaluateGoal } from '../content/orders'
import { RESOURCES } from '../content/resources'
import { VILLAGER_TRAITS } from '../content/species'
import { TERRAIN } from '../content/terrain'
import { pairsWith, serviceCapacity } from './adjacency'
import { collectWarnings } from './diagnostics'
import { describePlacement } from './placement'
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
} from './actions'
import {
  ADJACENCY_RANGE,
  BRAZIER_FOOTPRINT,
  BRAZIER_FUEL_PER_SECOND,
  BRAZIER_WARMTH_RADIUS,
  CARAVAN_OFFERS,
  HEARTH_FUEL_PER_SECOND,
  HEARTH_WARMTH_RADIUS,
  OPENING_BLUEPRINT_PICKS,
  SEASON_LENGTH,
  STARTING_VILLAGERS,
  TRADE_LOT,
} from './balance'
import { createRun } from './createRun'
import {
  addVillager,
  appeaseThreat,
  relevantBlueprints,
  rerollChoice,
  rerollCost,
  resolveGladeEvent,
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
  canAfford,
  foodStock,
  idleVillagers,
  isWarmAt,
  population,
  serviceCoverage,
  storageUsed,
  totalHousing,
  warmHousing,
  warmthSources,
} from './queries'
import { makeRng } from './rng'
import { resolveBreakdowns, stepBraziers, stormFuelPerSecond } from './society'
import { tick } from './tick'
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
import type { RunState } from '../types'

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
  const index = def.options.findIndex(
    (o) => !o.requires || canAfford(state.stock, o.requires),
  )
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
    // A thin woodpile mid-Storm raises the fuel caution.
    state.stock.wood = 1
    expect(collectWarnings(state).some((w) => w.id === 'fuel')).toBe(true)
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
