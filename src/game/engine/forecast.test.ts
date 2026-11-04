import { describe, expect, it } from 'vitest'
import { HEARTH_FUEL_PER_SECOND, SEASON_LENGTH } from './balance'
import { createRun } from './createRun'
import { collectWarnings } from './diagnostics'
import { takeChoice } from './events'
import {
  buildingStatus,
  foodForecast,
  formatDuration,
  hearthForecast,
  meterRates,
  secondsUntilStorm,
  storageBlocked,
} from './forecast'
import { computeModifiers } from './modifiers'
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
