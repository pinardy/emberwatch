import { describe, expect, it } from 'vitest'
import { BUILDINGS } from '../content/buildings'
import { findPlacement } from './actions'
import {
  HEARTH_FUEL_PER_SECOND,
  IMPATIENCE_OVERTIME_BASE,
  QUEEN_DEADLINE_YEAR,
  SEASON_LENGTH,
  YEAR_SECONDS,
} from './balance'
import { createRun } from './createRun'
import { collectWarnings } from './diagnostics'
import { takeChoice } from './events'
import {
  buildingStatus,
  deadlineForecast,
  foodForecast,
  foodProductionRate,
  formatDuration,
  hearthForecast,
  meterRates,
  secondsUntilStorm,
  storageBlocked,
  stormFoodForecast,
  yearLengthFor,
} from './forecast'
import { computeModifiers, seasonLengthFor } from './modifiers'
import { depositsInRangeOf } from './production'
import { idleVillagers, storageUsed } from './queries'
import { QUEEN_DEADLINE_SECONDS, deadlineOvertimeRate } from './society'
import { DEADLINE_PASSED_LOG, tick } from './tick'
import type { BuildingInstance, RunState, Season } from '../types'

/** Baseline seasons and rates: the seed's map modifiers are tested elsewhere. */
function newRun(): RunState {
  const state = createRun({ seed: 4242, species: ['human', 'beaver', 'lizard'], modifiers: [] })
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
    // Enough for a normal Storm, not for this one.
    expect(stormFoodForecast(short, computeModifiers(short)).shortfall).toBeGreaterThan(1)
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

describe('forecasts under season-changing map modifiers', () => {
  /** A larder run on land with `modifiers`, partway through `season` of Year 2. */
  function landRun(modifiers: string[], season: 'drizzle' | 'clearance', elapsed: number): RunState {
    const state = createRun({ seed: 4242, species: ['human', 'beaver', 'lizard'], modifiers })
    while (state.pendingChoices.length > 0) takeChoice(state, state.pendingChoices[0].options[0])
    for (const id of FOODS) delete state.stock[id as keyof typeof state.stock]
    state.foodDebt = 0
    state.season = { year: 2, season, elapsed, length: SEASON_LENGTH[season] }
    return state
  }

  /** Real seconds until the coming Storm ends, by ticking. */
  function secondsToStormEnd(state: RunState): number {
    const start = state.clock
    runThroughStorm(state)
    return state.clock - start
  }

  it('Long Storms: the Storm countdown, its length and the larder forecast match the tick', () => {
    const state = landRun(['longStorms'], 'clearance', 40)
    const mods = computeModifiers(state)
    expect(secondsUntilStorm(state)).toBeCloseTo(SEASON_LENGTH.clearance - 40)
    const forecast = stormFoodForecast(state, mods)
    expect(forecast.horizon).toBeCloseTo(SEASON_LENGTH.clearance - 40 + SEASON_LENGTH.storm * 1.25)
    // The hearth forecast budgets wood for the longer Storm too.
    delete state.stock.wood
    const hearth = hearthForecast(state, mods)
    expect(hearth.stormShortfall).toBeCloseTo(
      (SEASON_LENGTH.clearance - 40) * hearth.rate + SEASON_LENGTH.storm * 1.25 * hearth.stormRate,
    )
    state.stock.wood = 400
    expect(secondsToStormEnd(state)).toBeCloseTo(forecast.horizon, 0)
  })

  it('Long Storms: food for a normal Storm is flagged short, and really runs out', () => {
    const probe = landRun(['longStorms'], 'clearance', 0)
    const forecast = stormFoodForecast(probe, computeModifiers(probe))
    const baseNeeded =
      (forecast.needed * (SEASON_LENGTH.clearance + SEASON_LENGTH.storm)) / forecast.horizon

    const short = landRun(['longStorms'], 'clearance', 0)
    short.stock.berry = Math.ceil(baseNeeded) + 1
    short.stock.wood = 400
    // Enough for a normal Storm, not for this one.
    expect(stormFoodForecast(short, computeModifiers(short)).shortfall).toBeGreaterThan(1)
    expect(runThroughStorm(short).hungry).toBe(true)

    const enough = landRun(['longStorms'], 'clearance', 0)
    enough.stock.berry = Math.ceil(forecast.needed) + 1
    enough.stock.wood = 400
    expect(stormFoodForecast(enough, computeModifiers(enough)).shortfall).toBe(0)
    expect(runThroughStorm(enough).hungry).toBe(false)
  })

  it('Early Frost: the first Storm comes when the countdown says it will', () => {
    const state = createRun({
      seed: 4242,
      species: ['human', 'beaver', 'lizard'],
      modifiers: ['earlyFrost'],
    })
    while (state.pendingChoices.length > 0) takeChoice(state, state.pendingChoices[0].options[0])
    const promised = secondsUntilStorm(state)!
    expect(promised).toBeLessThan(SEASON_LENGTH.drizzle + SEASON_LENGTH.clearance - 60)
    expect(stormFoodForecast(state, computeModifiers(state)).horizon).toBeCloseTo(
      promised + SEASON_LENGTH.storm,
    )
    let guard = 0
    while (state.season.season !== 'storm' && guard++ < 10_000) {
      tick(state, 0.125)
      state.pendingChoices = []
    }
    expect(state.clock).toBeCloseTo(promised, 0)
  })
})

describe("the Queen's deadline", () => {
  function runWith(modifiers: string[]): RunState {
    const state = createRun({ seed: 4242, species: ['human', 'beaver', 'lizard'], modifiers })
    while (state.pendingChoices.length > 0) takeChoice(state, state.pendingChoices[0].options[0])
    state.hostility = 0
    state.stock.wood = 400
    state.stock.berry = 400
    return state
  }

  /** Puts the run `elapsed` seconds into `season` of `year`, clock to match. */
  function at(state: RunState, year: number, season: Season, elapsed: number): RunState {
    const mods = computeModifiers(state)
    let clock = 0
    for (let y = 1; y < year; y++) clock += yearLengthFor(y, mods)
    for (const s of ['drizzle', 'clearance', 'storm'] as Season[]) {
      if (s === season) break
      clock += seasonLengthFor(s, year, mods)
    }
    state.clock = clock + elapsed
    state.season = { year, season, elapsed, length: seasonLengthFor(season, year, mods) }
    return state
  }

  const deadlineWarning = (state: RunState) => collectWarnings(state).find((w) => w.id === 'deadline')

  it('falls at the start of Year 5 at standard season lengths', () => {
    expect(QUEEN_DEADLINE_SECONDS).toBe((QUEEN_DEADLINE_YEAR - 1) * YEAR_SECONDS)
    const state = at(runWith([]), 4, 'clearance', 40)
    const forecast = deadlineForecast(state, computeModifiers(state))
    expect(forecast).toMatchObject({
      passed: false,
      imminent: true,
      secondsPast: 0,
      overtimePerMinute: 0,
      landsIn: { year: 5, season: 'drizzle' },
    })
    expect(forecast.secondsLeft).toBeCloseTo(SEASON_LENGTH.clearance - 40 + SEASON_LENGTH.storm)
    expect(forecast.startPerMinute).toBeCloseTo(IMPATIENCE_OVERTIME_BASE * 60)
  })

  it('counts down only through its last year, and warns a year ahead', () => {
    const early = at(runWith([]), 3, 'storm', 100)
    expect(deadlineForecast(early, computeModifiers(early)).imminent).toBe(false)
    expect(deadlineWarning(early)).toBeUndefined()

    const lastYear = at(runWith([]), 4, 'drizzle', 0)
    expect(deadlineForecast(lastYear, computeModifiers(lastYear)).secondsLeft).toBe(YEAR_SECONDS)
    expect(deadlineWarning(lastYear)).toEqual({
      id: 'deadline',
      severity: 'caution',
      text: "👑 The Queen's deadline is in 6m 40s. After it her impatience climbs faster every minute.",
    })

    // The last minute is a danger, so it heads the strip.
    const lastMinute = at(runWith([]), 4, 'storm', SEASON_LENGTH.storm - 45)
    expect(deadlineWarning(lastMinute)).toMatchObject({ severity: 'danger', text: /is in 45s/ })
  })

  it('reports the overtime the tick applies once it has passed', () => {
    const state = at(runWith([]), 5, 'drizzle', 120)
    const mods = computeModifiers(state)
    const forecast = deadlineForecast(state, mods)
    expect(forecast).toMatchObject({ passed: true, imminent: false, secondsLeft: 0, landsIn: null })
    expect(forecast.secondsPast).toBeCloseTo(120)
    expect(forecast.overtimePerMinute).toBeCloseTo(deadlineOvertimeRate(state) * 60)
    expect(forecast.overtimePerMinute).toBeGreaterThan(forecast.startPerMinute)
    // The overtime is exactly what the meter gains over a run just short of it.
    const before = { ...state, clock: QUEEN_DEADLINE_SECONDS }
    expect(
      meterRates(state, mods).impatiencePerMinute - meterRates(before, mods).impatiencePerMinute,
    ).toBeCloseTo(forecast.overtimePerMinute, 9)
    expect(deadlineWarning(state)).toBeUndefined()
  })

  it('logs (and so toasts) once, the moment the overtime starts', () => {
    const state = at(runWith([]), 4, 'storm', SEASON_LENGTH.storm - 0.25)
    const said = () => state.log.filter((e) => e.text === DEADLINE_PASSED_LOG).length
    tick(state, 0.125)
    expect(said()).toBe(0)
    expect(deadlineOvertimeRate(state)).toBe(0)
    tick(state, 0.125)
    expect(state.season.year).toBe(5)
    expect(said()).toBe(1)
    tick(state, 0.125)
    expect(deadlineOvertimeRate(state)).toBeGreaterThan(0)
    expect(said()).toBe(1)
  })

  it('Long Storms: the deadline lands in Year 4\'s Storm, and is said there', () => {
    const state = at(runWith(['longStorms']), 4, 'drizzle', 0)
    const mods = computeModifiers(state)
    expect(yearLengthFor(4, mods)).toBeCloseTo(YEAR_SECONDS + SEASON_LENGTH.storm * 0.25)
    const forecast = deadlineForecast(state, mods)
    // Three long years have gone by: less than a standard year is left.
    expect(forecast.secondsLeft).toBeCloseTo(QUEEN_DEADLINE_SECONDS - 3 * yearLengthFor(2, mods))
    expect(forecast.secondsLeft).toBeLessThan(YEAR_SECONDS)
    expect(forecast.landsIn).toEqual({ year: 4, season: 'storm' })
    expect(deadlineWarning(state)?.text).toContain(`is in ${formatDuration(forecast.secondsLeft)}.`)

    // Tick to the deadline: it passes mid-Storm, before Year 5 begins.
    let guard = 0
    while (deadlineOvertimeRate(state) === 0 && guard++ < 10_000) {
      tick(state, 0.125)
      state.pendingChoices = []
    }
    expect(state.season).toMatchObject({ year: 4, season: 'storm' })
    expect(state.log.some((e) => e.text === DEADLINE_PASSED_LOG)).toBe(true)
    expect(deadlineForecast(state, mods).passed).toBe(true)
  })

  it('Early Frost: a short first year leaves Year 5 starting before the deadline', () => {
    const state = at(runWith(['earlyFrost']), 4, 'storm', SEASON_LENGTH.storm - 0.125)
    const mods = computeModifiers(state)
    expect(yearLengthFor(1, mods)).toBeLessThan(yearLengthFor(2, mods))
    tick(state, 0.125)
    expect(state.season).toMatchObject({ year: 5, season: 'drizzle' })
    // Year 5 has begun, but the Queen's clock has not run out: no overtime, no
    // "deadline has passed", and the countdown is still on.
    expect(deadlineOvertimeRate(state)).toBe(0)
    expect(state.log.some((e) => e.text === DEADLINE_PASSED_LOG)).toBe(false)
    const forecast = deadlineForecast(state, mods)
    expect(forecast.secondsLeft).toBeCloseTo(yearLengthFor(2, mods) - yearLengthFor(1, mods))
    expect(forecast).toMatchObject({ imminent: true, landsIn: { year: 5, season: 'drizzle' } })
    expect(deadlineWarning(state)).toBeDefined()
  })
})
