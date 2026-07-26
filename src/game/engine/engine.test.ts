import { describe, expect, it } from 'vitest'
import { BUILDINGS } from '../content/buildings'
import { GLADE_EVENTS } from '../content/gladeEvents'
import { ORDER_LIST, evaluateGoal } from '../content/orders'
import { placeBuilding, assignWorker, canPlaceBuilding, addClearer } from './actions'
import { OPENING_BLUEPRINT_PICKS, SEASON_LENGTH, STARTING_VILLAGERS } from './balance'
import { createRun } from './createRun'
import { relevantBlueprints, resolveGladeEvent, takeChoice } from './events'
import { hexDistance, hexKey, hexesInRadius } from './hex'
import { MAP_RADIUS } from './mapgen'
import { computeModifiers } from './modifiers'
import {
  canAfford,
  foodStock,
  idleVillagers,
  population,
  storageUsed,
  totalHousing,
} from './queries'
import { makeRng } from './rng'
import { tick } from './tick'
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
