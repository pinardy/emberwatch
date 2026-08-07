import { describe, expect, it } from 'vitest'
import { BUILDINGS } from '../content/buildings'
import { GLADE_EVENTS, GLADE_EVENT_LIST } from '../content/gladeEvents'
import { ORDER_LIST, evaluateGoal } from '../content/orders'
import { RESOURCES } from '../content/resources'
import { VILLAGER_TRAITS } from '../content/species'
import {
  placeBuilding,
  assignWorker,
  canPlaceBuilding,
  addClearer,
  rushConstruction,
  rushCost,
  sootheCost,
  sootheQueen,
} from './actions'
import {
  CARAVAN_OFFERS,
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
import { hexDistance, hexKey, hexesInRadius } from './hex'
import { MAP_RADIUS } from './mapgen'
import { computeModifiers } from './modifiers'
import { adjacencyMultiplier, seasonMultiplier } from './production'
import {
  canAfford,
  foodStock,
  idleVillagers,
  population,
  storageUsed,
  totalHousing,
  warmHousing,
} from './queries'
import { makeRng } from './rng'
import { resolveBreakdowns } from './society'
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

describe('hex geometry', () => {
  it('counts the right number of tiles for a radius', () => {
    // Centred hexagon of radius r has 3r² + 3r + 1 tiles.
    const r = 4
    expect(hexesInRadius({ q: 0, r: 0 }, r)).toHaveLength(3 * r * r + 3 * r + 1)
  })

  it('measures distance symmetrically', () => {
    expect(hexDistance({ q: 0, r: 0 }, { q: 2, r: -1 })).toBe(2)
    expect(hexDistance({ q: 2, r: -1 }, { q: 0, r: 0 })).toBe(2)
  })
})

describe('map generation', () => {
  it('assigns every tile to a glade and is reproducible', () => {
    const a = newRun()
    const b = newRun()
    expect(Object.keys(a.tiles)).toHaveLength(3 * MAP_RADIUS ** 2 + 3 * MAP_RADIUS + 1)
    for (const tile of Object.values(a.tiles)) {
      expect(a.glades[tile.gladeId]).toBeDefined()
    }
    expect(Object.keys(b.tiles).length).toBe(Object.keys(a.tiles).length)
    expect(b.glades.glade0.tiles.length).toBe(a.glades.glade0.tiles.length)
  })

  it('starts with exactly one cleared glade containing the hearth', () => {
    const state = newRun()
    const cleared = Object.values(state.glades).filter((g) => g.cleared)
    expect(cleared).toHaveLength(1)
    expect(cleared[0].id).toBe('glade0')
    expect(state.tiles[hexKey(0, 0)].buildingId).toBe('hearth')
  })

  it('reveals the starting glade neighbours and nothing further', () => {
    const state = newRun()
    const discovered = Object.values(state.glades).filter((g) => g.discovered)
    expect(discovered.length).toBe(state.glades.glade0.neighbors.length + 1)
  })

  it('gives the starting glade workable deposits', () => {
    const state = newRun()
    const deposits = state.glades.glade0.tiles
      .map((key) => state.tiles[key].deposit?.id)
      .filter(Boolean)
    expect(deposits.length).toBeGreaterThan(0)
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
  it('refuses tiles outside cleared glades', () => {
    const state = newRun()
    const foreign = Object.values(state.tiles).find(
      (t) => !state.glades[t.gladeId].cleared && !t.blocked && !t.deposit,
    )!
    expect(canPlaceBuilding(state, 'shelter', foreign.key)).toMatch(/not been cleared/)
  })

  it('refuses a gathering camp with no deposits in range', () => {
    const state = newRun()
    // Strip every deposit so no camp can be useful anywhere.
    for (const tile of Object.values(state.tiles)) delete tile.deposit
    const free = state.glades.glade0.tiles.find((k) => !state.tiles[k].buildingId)!
    expect(canPlaceBuilding(state, 'woodcuttersCamp', free)).toMatch(/deposits/)
  })

  it('spends materials and finishes construction with idle builders', () => {
    const state = newRun()
    const free = state.glades.glade0.tiles.find(
      (k) => !state.tiles[k].buildingId && !state.tiles[k].deposit && !state.tiles[k].blocked,
    )!
    const woodBefore = state.stock.wood ?? 0
    expect(placeBuilding(state, 'shelter', free)).toBeNull()
    expect(state.stock.wood).toBe(woodBefore - (BUILDINGS.shelter.cost.wood ?? 0))

    const housingBefore = totalHousing(state)
    run(state, 30)
    expect(totalHousing(state)).toBe(housingBefore + (BUILDINGS.shelter.housing ?? 0))
  })
})

describe('production', () => {
  it('harvests from a deposit in range', () => {
    const state = newRun()
    const treeTile = state.glades.glade0.tiles.find(
      (k) => state.tiles[k].deposit?.id === 'trees',
    )
    if (!treeTile) return // seed-dependent; other tests cover the generic path

    const spot = state.glades.glade0.tiles.find(
      (k) =>
        !state.tiles[k].buildingId &&
        !state.tiles[k].deposit &&
        !state.tiles[k].blocked &&
        hexDistance(state.tiles[k], state.tiles[treeTile]) <= 3,
    )!
    expect(placeBuilding(state, 'woodcuttersCamp', spot)).toBeNull()
    const buildingId = state.tiles[spot].buildingId!
    run(state, 20) // let it finish building
    expect(state.buildings[buildingId].built).toBe(true)
    expect(assignWorker(state, buildingId)).toBeNull()

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
    for (const tile of Object.values(state.tiles)) {
      if (canPlaceBuilding(state, 'tradingPost', tile.key) === null) {
        placeBuilding(state, 'tradingPost', tile.key)
        break
      }
    }
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
    for (const tile of Object.values(state.tiles)) {
      if (canPlaceBuilding(state, 'shelter', tile.key) === null) {
        placeBuilding(state, 'shelter', tile.key)
        break
      }
    }
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
  it('counts housing inside the hearth warmth radius', () => {
    const state = newRun()
    // Everything starts compact, so all housing is warm.
    expect(warmHousing(state, HEARTH_WARMTH_RADIUS)).toBe(totalHousing(state))

    // A far shelter houses people but does not count as warm.
    const far = Object.values(state.tiles).find(
      (t) =>
        hexDistance(t, { q: 0, r: 0 }) > HEARTH_WARMTH_RADIUS + 1 &&
        !t.blocked &&
        !t.deposit &&
        !t.buildingId,
    )!
    state.glades[far.gladeId].cleared = true
    expect(placeBuilding(state, 'shelter', far.key)).toBeNull()
    const shelter = Object.values(state.buildings).find((b) => b.tile === far.key)!
    shelter.built = true
    expect(warmHousing(state, HEARTH_WARMTH_RADIUS)).toBe(
      totalHousing(state) - (BUILDINGS.shelter.housing ?? 0),
    )
  })

  it('chills distant homes during the Storm', () => {
    const state = newRun()
    const far = Object.values(state.tiles).find(
      (t) =>
        hexDistance(t, { q: 0, r: 0 }) > HEARTH_WARMTH_RADIUS + 1 &&
        !t.blocked &&
        !t.deposit &&
        !t.buildingId,
    )!
    state.glades[far.gladeId].cleared = true
    placeBuilding(state, 'shelter', far.key)
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

    // Find a camp spot with a free neighbour for the mill.
    let campTile: string | null = null
    let millTile: string | null = null
    for (const tile of Object.values(state.tiles)) {
      if (canPlaceBuilding(state, 'woodcuttersCamp', tile.key) !== null) continue
      const neighbor = hexesInRadius(tile, 1).find(
        (h) =>
          hexKey(h.q, h.r) !== tile.key &&
          canPlaceBuilding(state, 'lumberMill', hexKey(h.q, h.r)) === null,
      )
      if (neighbor) {
        campTile = tile.key
        millTile = hexKey(neighbor.q, neighbor.r)
        break
      }
    }
    expect(campTile).toBeTruthy()
    placeBuilding(state, 'woodcuttersCamp', campTile!)
    placeBuilding(state, 'lumberMill', millTile!)
    const camp = Object.values(state.buildings).find((b) => b.defId === 'woodcuttersCamp')!
    const mill = Object.values(state.buildings).find((b) => b.defId === 'lumberMill')!
    camp.built = true
    mill.built = true
    expect(adjacencyMultiplier(state, mill)).toBeCloseTo(1.2)

    // Alone in a field, no bonus.
    delete state.buildings[camp.id]
    delete state.tiles[camp.tile].buildingId
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
