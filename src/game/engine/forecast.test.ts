import { describe, expect, it } from 'vitest'
import { BUILDINGS } from '../content/buildings'
import { findPlacement } from './actions'
import { HEARTH_FUEL_PER_SECOND, SEASON_LENGTH } from './balance'
import { createRun } from './createRun'
import { collectWarnings } from './diagnostics'
import { takeChoice } from './events'
import {
  buildingStatus,
  foodForecast,
  foodProductionRate,
  formatDuration,
  hearthForecast,
  meterRates,
  secondsUntilStorm,
  storageBlocked,
  stormFoodForecast,
} from './forecast'
import { computeModifiers } from './modifiers'
import { depositsInRangeOf } from './production'
import { idleVillagers, storageUsed } from './queries'
import { tick } from './tick'
import type { BuildingInstance, RunState } from '../types'

function newRun(): RunState {
  const state = createRun({ seed: 4242, species: ['human', 'beaver', 'lizard'] })
  while (state.pendingChoices.length > 0) takeChoice(state, state.pendingChoices[0].options[0])
  return state
}

/** Drops a finished, staffed building straight into the run. */
function addStaffed(state: RunState, defId: string, recipeId: string): BuildingInstance {
  const worker = idleVillagers(state)[0]
  const building: BuildingInstance = {
    id: `test-${defId}`,
    defId,
    pos: { x: 0, y: 0 },
    gladeId: 'glade0',
    built: true,
    buildProgress: 0,
    workers: [worker.id],
    activeRecipeId: recipeId,
    recipeProgress: 0,
    paused: false,
    depositsInRange: {},
  }
  worker.assignment = building.id
  state.buildings[building.id] = building
  return building
}

describe('forecasts', () => {
  it('counts down to the next Storm across seasons', () => {
    const state = newRun()
    state.season.elapsed = 50
    expect(secondsUntilStorm(state)).toBe(SEASON_LENGTH.drizzle - 50 + SEASON_LENGTH.clearance)
    state.season.season = 'clearance'
    state.season.length = SEASON_LENGTH.clearance
    expect(secondsUntilStorm(state)).toBe(SEASON_LENGTH.clearance - 50)
    state.season.season = 'storm'
    expect(secondsUntilStorm(state)).toBeNull()
  })

  it('reports the same meter rates the tick applies', () => {
    const state = newRun()
    state.hostility = 80 // past the threshold, so hostility feeds impatience
    const mods = computeModifiers(state)
    const rates = meterRates(state, mods)
    const hostilityBefore = state.hostility
    const impatienceBefore = state.impatience + state.impatienceProgress
    tick(state, 0.125)
    expect(state.hostility - hostilityBefore).toBeCloseTo(
      (rates.hostilityPerMinute / 60) * 0.125,
      9,
    )
    expect(state.impatience + state.impatienceProgress - impatienceBefore).toBeCloseTo(
      (rates.impatiencePerMinute / 60) * 0.125,
      // The tick raises hostility before it measures impatience, hence the looser bound.
      6,
    )
  })

  it('projects hearth fuel at the current and the Storm rate', () => {
    const state = newRun()
    state.stock.wood = 16
    const mods = computeModifiers(state)
    const hearth = hearthForecast(state, mods)
    expect(hearth.stormRate).toBeCloseTo(HEARTH_FUEL_PER_SECOND * mods.hearthFuel)
    expect(hearth.stormRunway).toBeCloseTo(16 / hearth.stormRate)
    expect(hearth.runway).toBeGreaterThan(hearth.stormRunway)
    // 16 wood cannot carry a whole Storm at 0.16/s.
    expect(hearth.stormShortfall).toBeGreaterThan(0)
  })

  it('projects how long the larder lasts', () => {
    const state = newRun()
    const mods = computeModifiers(state)
    const food = foodForecast(state, mods)
    expect(food.rate).toBeGreaterThan(0)
    expect(food.runway).toBeCloseTo(food.meals / food.rate)
    for (const id of Object.keys(state.stock)) {
      if (id !== 'wood' && id !== 'stone' && id !== 'plank' && id !== 'amber') {
        delete state.stock[id as keyof typeof state.stock]
      }
    }
    expect(foodForecast(state, mods).runway).toBe(0)
  })

  it('formats durations compactly', () => {
    expect(formatDuration(42.2)).toBe('43s')
    expect(formatDuration(125)).toBe('2m 05s')
    expect(formatDuration(900)).toBe('15m')
    expect(formatDuration(Infinity)).toBe('∞')
  })
})

describe('building status', () => {
  it('names the missing inputs of a staffed workshop', () => {
    const state = newRun()
    const mill = addStaffed(state, 'lumberMill', 'plank')
    delete state.stock.wood
    mill.recipeProgress = 16 // held at the brim
    const mods = computeModifiers(state)
    const status = buildingStatus(state, mill, mods)
    expect(status).toEqual({ kind: 'waitingInputs', missing: [['wood', 2]], held: true })
  })

  it('reports working, paused, unstaffed and off-season', () => {
    const state = newRun()
    const mill = addStaffed(state, 'lumberMill', 'plank')
    state.stock.wood = 20
    const mods = computeModifiers(state)
    expect(buildingStatus(state, mill, mods).kind).toBe('working')
    mill.paused = true
    expect(buildingStatus(state, mill, mods).kind).toBe('paused')
    mill.paused = false
    mill.workers = []
    expect(buildingStatus(state, mill, mods).kind).toBe('noWorkers')

    const farm = addStaffed(state, 'smallFarm', 'grain')
    farm.depositsInRange = {}
    state.season.season = 'storm'
    const status = buildingStatus(state, farm, mods)
    // Farms need fertile soil in range first; either reason means "not now".
    expect(['offSeason', 'noDeposit']).toContain(status.kind)
  })

  it('flags producers held at the brim by a full stockpile', () => {
    const state = newRun()
    const mill = addStaffed(state, 'lumberMill', 'plank')
    state.stock.wood = 20
    state.storageCap = storageUsed(state)
    const mods = computeModifiers(state)
    expect(buildingStatus(state, mill, mods)).toEqual({ kind: 'storageFull', held: false })
    expect(storageBlocked(state, mods)).toHaveLength(0)

    mill.recipeProgress = 16
    expect(storageBlocked(state, mods).map((b) => b.id)).toEqual([mill.id])
    expect(collectWarnings(state).map((w) => w.id)).toContain('storage-full')
  })
})

describe('forward-looking warnings', () => {
  it('stays quiet at the start of a run', () => {
    const ids = collectWarnings(newRun()).map((w) => w.id)
    expect(ids).not.toContain('hearth-low')
    expect(ids).not.toContain('food-low')
    expect(ids).not.toContain('storage-full')
  })

  it('warns before the hearth runs out, not only after', () => {
    const state = newRun()
    state.season.season = 'storm'
    state.season.length = SEASON_LENGTH.storm
    state.stock.wood = 3
    expect(state.coldHearth).toBe(false)
    expect(collectWarnings(state).map((w) => w.id)).toContain('hearth-low')

    state.stock.wood = 12 // 75s at the storm rate, short of a 110s storm
    expect(collectWarnings(state).map((w) => w.id)).toContain('hearth-storm')
  })

  it('warns in Clearance when the woodpile will not last the Storm', () => {
    const state = newRun()
    state.season.season = 'clearance'
    state.season.length = SEASON_LENGTH.clearance
    state.stock.wood = 10
    const warning = collectWarnings(state).find((w) => w.id === 'hearth-storm')
    expect(warning?.text).toMatch(/Not enough wood for the Storm/)
  })

  it('warns when food is about to run out', () => {
    const state = newRun()
    for (const id of ['berry', 'root', 'mushroom', 'meat', 'egg', 'grain', 'vegetable', 'insect']) {
      delete state.stock[id as keyof typeof state.stock]
    }
    state.stock.berry = 2
    expect(collectWarnings(state).map((w) => w.id)).toContain('food-low')
  })
})

// ---------------------------------------------------------------------------
// Food for the coming Storm
// ---------------------------------------------------------------------------

const FOODS = ['berry', 'root', 'mushroom', 'meat', 'egg', 'grain', 'vegetable', 'insect', 'herb']

/** A run with an empty larder, parked `elapsed` seconds into `season`. */
function larderRun(season: 'drizzle' | 'clearance' | 'storm', elapsed: number): RunState {
  const state = newRun()
  for (const id of FOODS) delete state.stock[id as keyof typeof state.stock]
  state.foodDebt = 0
  state.season.season = season
  state.season.length = SEASON_LENGTH[season]
  state.season.elapsed = elapsed
  return state
}

/**
 * Ticks until the Storm that was coming (or raging) has ended, holding the
 * population steady the way the forecast assumes. Reports whether anyone went
 * hungry along the way.
 */
function runThroughStorm(state: RunState): { hungry: boolean } {
  const year = state.season.year
  let hungry = false
  let guard = 0
  while (!(state.season.year > year && state.season.season === 'drizzle') && guard++ < 10_000) {
    tick(state, 0.125)
    for (const sp of Object.keys(state.despair)) {
      state.despair[sp as keyof typeof state.despair] = 0
    }
    state.pendingChoices = []
    if (state.starving) hungry = true
  }
  return { hungry }
}

describe('food forecast for the coming Storm', () => {
  it('counts the meals eaten until the Storm ends against the larder', () => {
    const state = larderRun('clearance', 40)
    state.stock.berry = 20
    const mods = computeModifiers(state)
    const storm = stormFoodForecast(state, mods)
    const rate = foodForecast(state, mods).rate
    expect(storm.horizon).toBeCloseTo(SEASON_LENGTH.clearance - 40 + SEASON_LENGTH.storm)
    expect(storm.needed).toBeCloseTo(rate * storm.horizon)
    expect(storm.produced).toBe(0)
    expect(storm.shortfall).toBeCloseTo(storm.needed - 20)
  })

  it('matches real ticks: enough food lasts the Storm, a little less does not', () => {
    const probe = larderRun('clearance', 0)
    const needed = stormFoodForecast(probe, computeModifiers(probe)).needed

    const enough = larderRun('clearance', 0)
    enough.stock.berry = Math.ceil(needed) + 1
    expect(stormFoodForecast(enough, computeModifiers(enough)).shortfall).toBe(0)
    expect(runThroughStorm(enough).hungry).toBe(false)

    const short = larderRun('clearance', 0)
    short.stock.berry = Math.floor(needed) - 6
    expect(stormFoodForecast(short, computeModifiers(short)).shortfall).toBeGreaterThan(5)
    expect(runThroughStorm(short).hungry).toBe(true)
  })

  it('predicts what a staffed camp gathers, halved in the Storm', () => {
    const state = larderRun('drizzle', 80)
    state.stock.berry = 30
    // Room for everything the camp brings in, so nothing stops at the brim.
    const warehouse = addStaffed(state, 'warehouse', '')
    warehouse.workers = []
    for (const v of Object.values(state.villagers)) {
      if (v.assignment === warehouse.id) v.assignment = null
    }
    state.storageCap = 999
    const pos = findPlacement(state, 'foragersCamp')
    expect(pos).toBeTruthy()
    const camp = addStaffed(state, 'foragersCamp', 'berry')
    camp.pos = pos!
    camp.depositsInRange = depositsInRangeOf(state, pos!, BUILDINGS.foragersCamp.gatherRadius!)
    expect(camp.depositsInRange.vegetation?.length).toBeGreaterThan(0)
    // Deposits running dry are outside the estimate; keep the bushes full.
    for (const id of camp.depositsInRange.vegetation ?? []) state.deposits[id].amount = null
    const mods = computeModifiers(state)

    expect(foodProductionRate(state, mods, 'storm')).toBeCloseTo(
      foodProductionRate(state, mods, 'drizzle') * 0.5,
    )
    const forecast = stormFoodForecast(state, mods)
    const before = state.producedTotals.berry ?? 0
    runThroughStorm(state)
    const gathered = (state.producedTotals.berry ?? 0) - before
    expect(forecast.produced).toBeGreaterThan(20)
    // Whole batches land in steps, so allow a batch or two either way.
    expect(Math.abs(gathered - forecast.produced)).toBeLessThan(10)
  })

  it('never counts a farm harvest during the Storm', () => {
    const state = larderRun('clearance', 0)
    state.deposits.testSoil = {
      id: 'testSoil',
      kind: 'fertileSoil',
      pos: { x: 0, y: 0 },
      radius: 0.5,
      amount: null,
      gladeId: 'glade0',
    }
    const farm = addStaffed(state, 'smallFarm', 'grain')
    farm.depositsInRange = { fertileSoil: ['testSoil'] }
    const mods = computeModifiers(state)
    expect(foodProductionRate(state, mods, 'clearance')).toBeGreaterThan(0)
    expect(foodProductionRate(state, mods, 'storm')).toBe(0)

    // In the Storm itself the farm adds nothing, however long is left.
    state.season.season = 'storm'
    state.season.length = SEASON_LENGTH.storm
    state.season.elapsed = 10
    expect(stormFoodForecast(state, mods).produced).toBe(0)
  })

  it('warns in Clearance and late Drizzle when the larder will not last', () => {
    const state = larderRun('clearance', 20)
    state.stock.berry = 15
    const warning = collectWarnings(state).find((w) => w.id === 'food-storm')
    expect(warning?.text).toMatch(/Food won't last the Storm — about \d+ meals short/)
    expect(warning?.text).toMatch(/Foragers' Camp/)

    state.season.season = 'drizzle'
    state.season.length = SEASON_LENGTH.drizzle
    state.season.elapsed = SEASON_LENGTH.drizzle - 30
    expect(collectWarnings(state).map((w) => w.id)).toContain('food-storm')
  })

  it('stays quiet with food to spare, early in Drizzle, and when food-low speaks', () => {
    const fed = larderRun('clearance', 20)
    fed.stock.berry = 200
    expect(collectWarnings(fed).map((w) => w.id)).not.toContain('food-storm')

    const early = larderRun('drizzle', 10)
    early.stock.berry = 30
    expect(collectWarnings(early).map((w) => w.id)).not.toContain('food-storm')

    // Nearly empty: the runway warning is the louder, more urgent one.
    const empty = larderRun('clearance', 20)
    empty.stock.berry = 2
    const ids = collectWarnings(empty).map((w) => w.id)
    expect(ids).toContain('food-low')
    expect(ids).not.toContain('food-storm')
  })

  it('stays quiet at the start of a fresh run', () => {
    expect(collectWarnings(newRun()).map((w) => w.id)).not.toContain('food-storm')
  })
})
